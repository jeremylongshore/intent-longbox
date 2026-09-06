// `pnpm audit:privacy-requests` — is anything Shopify told us about still
// unanswered, and is any of it late (E03-B08, 000-docs/064 §6).
//
//   pnpm audit:privacy-requests
//
// **THE K1 SHAPE, deliberately borrowed from `pnpm audit:cross-tenant`** (034
// §3.4): it prints COUNTS, it names no person and no payload, and it exits
// NON-ZERO on any OVERDUE request, so a scheduler needs no output parsing to know
// something is wrong. The daily SCHEDULE and the 019 T34 heartbeat are
// **E13-B04-D1 (`longbox-e5b.13.4.1`)**'s, not this command's — a detector nobody
// runs reports nothing.
//
// **WHAT A NON-ZERO EXIT MEANS, and what it deliberately does not.** It means a
// privacy request passed the PROVISIONAL window this repository stamped it with
// and nobody has recorded an answer. It is a workflow failure, and this file does
// NOT call it a K1: 019 §3.4's K1 list is closed, and what a person is entitled
// to on what clock is E03-B09's material and counsel's (E01-B06). No statute is
// cited here and none may be — the phrase for these three topics is *the topics
// Shopify requires an app to handle*.
//
// **IT RUNS AS THE SCHEMA OWNER**, which is the only role that can see all of it:
// `privacy_request` carries a policy, and the requests that matter most are
// precisely the ones with a NULL tenant — a `shop/redact` for a store that has
// already been offboarded. A tenant context is exactly what would hide them.
//
// **IT PRINTS THE STORE DOMAIN, AND THAT IS A DECISION.** A store domain names a
// MERCHANT, never a customer, and an operator who cannot tell which shop is
// overdue cannot act on the finding. Nothing else identifying is printed: no
// customer identifier exists in these tables, `operator_id` is never projected
// (022 P3 — an audit reports the work, not the worker), and the message bytes are
// stored nowhere at all.
import "dotenv/config";
import pg from "pg";
import { outstandingPrivacyRequests, privacyRequestCounts } from "../src/services/privacy.js";
import { assertSchemaOwnerOrThrow } from "../src/services/roleSeparation.js";
import { resolveMigrateUrl } from "./migrateUrl.js";

async function main(): Promise<void> {
  const client = new pg.Client({ connectionString: resolveMigrateUrl() });
  await client.connect();
  try {
    await assertSchemaOwnerOrThrow(client);

    const counts = await privacyRequestCounts(client);
    for (const bucket of counts) {
      console.log(`${bucket.topic} → ${bucket.outcome ?? "(unanswered)"}: ${String(bucket.requests)}`);
    }

    const outstanding = await outstandingPrivacyRequests(client);
    const overdue = outstanding.filter((r) => r.overdue);
    for (const row of overdue) {
      // K6 — WHY it is still outstanding, when the queue knows. An operator who
      // cannot tell a dead-lettered job from a `shop/redact` that was never
      // automated from a null-tenant request triages by guessing, and only the
      // first of the three needs a person right now.
      const why =
        row.deadLetterReason !== null
          ? ` [job dead-lettered: ${row.deadLetterReason}]`
          : row.shopId === null
            ? " (no Longbox shop matched this store — no job was enqueued)"
            : " (no job: this topic is answered by a person)";
      console.error(
        `OVERDUE: ${row.topic} for ${row.shopDomain} — request ${row.privacyRequestId}, ` +
          `received ${row.receivedAt.toISOString()}, due ${row.dueAt.toISOString()}${why}`
      );
    }

    console.log(
      `privacy-request audit: ${String(counts.reduce((n, b) => n + b.requests, 0))} request(s) recorded, ` +
        `${String(outstanding.length)} outstanding, ${String(overdue.length)} overdue`
    );
    if (counts.length === 0) {
      // Not a failure, and not silence either: a reconciliation over an empty
      // table is green for the wrong reason, which is the stale detector 019 T34
      // exists to catch one threshold over.
      console.log(
        "note: no privacy requests have ever been recorded. That is the expected state for a " +
          "database with no connector install; it is NOT evidence that the webhook path works."
      );
    }
    if (overdue.length > 0) {
      console.error(
        `${String(overdue.length)} privacy request(s) are past the window they were stamped with ` +
          `and carry no fulfilment fact. Answer each with \`pnpm privacy-fulfil --request <id> ` +
          `--outcome <…> --by <uuid>\`. The window is a PROVISIONAL floor this repository chose so ` +
          `that silence is detectable — it is not anybody's deadline, and what is actually owed is ` +
          `E03-B09's and counsel's (E01-B06).`
      );
      process.exitCode = 1;
    }
  } finally {
    await client.end();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
