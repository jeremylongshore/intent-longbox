// `pnpm privacy-fulfil` — record the ANSWER to a privacy request, as a fact
// (E03-B08, 000-docs/064 §6).
//
//   pnpm privacy-fulfil --request <uuid> --outcome data_erased --by <app-user-uuid>
//   pnpm privacy-fulfil --request <uuid> --outcome not_applicable --by <uuid>
//   pnpm privacy-fulfil --request <uuid> --outcome data_exported --by <uuid> --procedure
//
// **IT IS A CLI AND NOT A ROUTE, on E03-D06 and E03-D07's precedent one bead
// over.** Answering a privacy request is a privileged act, and the act it
// records is performed OUTSIDE this system — somebody exported a file, ran a
// deletion, or established that the store was never a customer. A route would
// have to pretend the click was the act.
//
// **IT RUNS AS THE SCHEMA OWNER**, which is the only role that can: the two
// tables carry row-level-security policies, and a request whose store matched no
// install has a NULL tenant that no tenant context can reach (053 §5.5's nullable
// tenant, one table over). `assertSchemaOwnerOrThrow` refuses the application
// connection, so a caller that reached for `DATABASE_URL` gets a loud refusal
// rather than a silent zero-row write.
//
// **WHAT IT PRINTS AND WHAT IT CANNOT.** The request id, the topic and the
// outcome. Not a customer identifier — the tables hold none, and none is
// recoverable from them — and not the message body, which is stored nowhere at
// all: `connector_webhook_receipt` keeps a digest and a byte count.
//
// ⚠ **THIS COMMAND WRITES THE FACT. IT DOES NOT PERFORM THE DELETION.** The
// retention and deletion PROCEDURE is E03-B09's bead, and when it lands it calls
// `recordFulfilment` with `method: "deletion_procedure"` exactly as this file
// does. Until then, `--outcome data_erased` is an operator asserting they did the
// work, which is why `--by` is required for every outcome and named in the row.
import "dotenv/config";
import { parseArgs } from "node:util";
import pg from "pg";
import { PRIVACY_OUTCOMES, recordFulfilment, type PrivacyOutcome } from "../src/services/privacy.js";
import { assertSchemaOwnerOrThrow } from "../src/services/roleSeparation.js";
import { resolveMigrateUrl } from "./migrateUrl.js";

const { values } = parseArgs({
  options: {
    request: { type: "string" },
    outcome: { type: "string" },
    by: { type: "string" },
    procedure: { type: "boolean", default: false },
  },
});

function required(name: string, value: string | undefined): string {
  if (value === undefined || value.length === 0) {
    throw new Error(`--${name} is required`);
  }
  return value;
}

async function main(): Promise<void> {
  const requestId = required("request", values.request);
  const outcome = required("outcome", values.outcome);
  // `--by` is REQUIRED and nothing verifies it, exactly as `pnpm designate-staff`
  // says of its own (058 §5 R1). It is the only accountability record this
  // command produces, and a fact with no author is a fact nobody signed.
  const by = required("by", values.by);
  if (!(PRIVACY_OUTCOMES as readonly string[]).includes(outcome)) {
    throw new Error(
      `--outcome must be one of ${PRIVACY_OUTCOMES.join(", ")}; got ${JSON.stringify(outcome)}. ` +
        `The set is closed in the database as well as here (migrations/038), because each member ` +
        `is a different sentence a shop could be shown.`
    );
  }

  const client = new pg.Client({ connectionString: resolveMigrateUrl() });
  await client.connect();
  try {
    await assertSchemaOwnerOrThrow(client);

    const found = await client.query(
      `SELECT r.id, r.shop_id, r.topic, r.due_at,
              EXISTS (SELECT 1 FROM privacy_request_fulfilment f WHERE f.privacy_request_id = r.id)
                AS already_answered
         FROM privacy_request r
        WHERE r.id = $1`,
      [requestId]
    );
    const request = found.rows[0] as
      | { id: string; shop_id: string | null; topic: string; due_at: Date; already_answered: boolean }
      | undefined;
    if (!request) {
      throw new Error(
        `no privacy_request with id ${requestId}. Run \`pnpm audit:privacy-requests\` to list what ` +
          `is outstanding.`
      );
    }
    if (request.already_answered) {
      // Refused rather than absorbed, and the difference matters for a HUMAN
      // caller: the consumer's `ON CONFLICT DO NOTHING` is idempotency under
      // machine redelivery, while a person typing this twice has almost
      // certainly mistyped an id and should be told rather than reassured.
      throw new Error(
        `privacy_request ${requestId} already carries a fulfilment. The table is append-only: an ` +
          `answer is never replaced, and a different answer is a new request with its own evidence.`
      );
    }

    const wrote = await recordFulfilment(client, {
      shopId: request.shop_id,
      privacyRequestId: request.id,
      outcome: outcome as PrivacyOutcome,
      method: values.procedure ? "deletion_procedure" : "operator",
      operatorId: by,
    });
    if (!wrote) {
      throw new Error(`privacy_request ${requestId} was answered by something else during this run.`);
    }

    console.log(`privacy request ${request.id} (${request.topic}) recorded as ${outcome}.`);
    console.log(
      `method=${values.procedure ? "deletion_procedure" : "operator"} authored_by=human. ` +
        `This row records WHAT WAS DONE; it does not perform it.`
    );
  } finally {
    await client.end();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
