// Clear one person's password, so they can be given a new one.
//
//   pnpm clear-credential --user <app-user-uuid> --reason squatted_credential|lost_credential \
//     [--by <uuid>] [--note "<what happened>"]
//
// ============================================================================
// ⚠ BREAK-GLASS ONLY, AND THE REMEDY 063 §5 R2 ASSUMED EXISTED
// ============================================================================
//
// **This script exists because the security lens went looking for it and found
// nothing** (063 §5 R2, the lens's F3). The residual R2 accepts is real: `POST
// /api/v1/credentials` runs on an OPERATOR session, which 048 §3.5 rules is an
// attribution of record and NOT non-repudiable — a coworker who watches a PIN
// can set a FIRST password for somebody who has none. Provision-never-replace
// bounds that (they cannot overwrite a live password, and the one they set opens
// nothing without a second factor), and R2 said the remedy was to notice and
// have the row cleared.
//
// There was no clearing at any level. `migrations/031`'s `ENABLE ALWAYS`
// trigger refuses a DELETE on `user_credential` to EVERYONE including the schema
// owner, and no route and no script cleared one — so a watched PIN was a
// PERMANENT lockout of the privileged surface, remediable only by disabling a
// trigger by hand.
//
// ============================================================================
// WHY IT IS AN UPDATE PLUS A FACT AND NEVER A DELETE
// ============================================================================
//
// The trigger stays exactly as it is, and the row stays. `user_credential` is
// 048 §9.1's LOCKOUT ANCHOR for the first factor: a row that could be deleted is
// a lockout that could be reset by deleting it, and the failure history the delay
// is derived from would go with it. So a clearance sets `password_hash` to NULL —
// inside `031`'s own three-column licence — and what happened is a row in
// `user_credential_clearance` (`migrations/037`), naming the reason, the person
// who did it and a free-text note.
//
// **A NULL digest verifies against nothing**: `verifyPassword` pays the decoy's
// cost and answers with 048 §9.3's constant refusal, exactly as it does for a
// person who never had a credential.
//
// ⚠ **AND A CLEARED ROW IS ABSENT FOR PROVISIONING PURPOSES — THIS PARAGRAPH
// USED TO SAY THE OPPOSITE, AND THE CODE AGREED WITH IT.** `provisionPassword`
// keyed on the ROW, so after a clearance the counter-phone route still answered
// `409`, this script's own closing message promised a path that did not exist,
// and `--reason lost_credential` had no outcome at all: a cleared person was
// unreachable by EVERY surface, which made a clearance a better lockout than the
// squat it was meant to remedy. The invariant re-verification blocked on it and
// the acting head ruled that the code changes, not the message. So
// `provisionPassword` INSERTs, and when the conflict costs it the insert it
// REVIVES — `UPDATE … WHERE app_user_id = $1 AND password_hash IS NULL` — inside
// `031`'s three-column licence, which is a negative check on four IMMUTABLE
// columns and says nothing about the value of the hash. The affected-row count
// is still the authorization: a LIVE hash matches neither statement and still
// refuses `already_set`, and `replacePassword` behind a fresh second factor
// stays the only path that overwrites one.
//
// A clearance is therefore a TERMINAL act, not a screen: the person is then
// provisioned from the counter phone by the ordinary first-password route, which
// treats a cleared row as absent. What it does NOT do is undo the squat's
// exposure — a coworker who watched a PIN once can watch it again, and 063 §5 R2
// keeps that residual with its PIN-watcher sentence intact.
//
// ============================================================================
// WHAT IT DOES NOT DO
// ============================================================================
//
//   * **It does not touch the second factor.** A person's authenticator and
//     recovery set are untouched; `pnpm retire-authenticator` is that act.
//   * **It writes no `authorization_decision` row**, and the reason is
//     mechanical rather than a preference: that table's `shop_id` is `NOT NULL`
//     and a credential clearance has no shop — the credential crosses every shop
//     the person works at (063 §3.1). A row there would either invent a tenant or
//     multiply one act across several. `user_credential_clearance` IS the record.
//   * **Nothing verifies `--by`.** It is an accountability record and not an
//     authentication, on 058 R1's shape: what stands in for a check is that
//     running this needs the schema owner's database URL and shell access.
//   * **It is not the route.** A support-facing clearance with a session behind
//     it belongs to **E11-B09** (`longbox-e5b.11.9`), which owes break-glass
//     administration a surface.
//
// ⚠ **`--note` MUST NOT CARRY A CREDENTIAL VALUE.** It is a sentence about what
// happened, stored in the clear, and read later by whoever asks why a password
// was cleared.
import "dotenv/config";
import { parseArgs } from "node:util";
import pg from "pg";
import { resolveMigrateUrl } from "./migrateUrl.js";
import { withTransaction } from "../src/db.js";
import { clearPassword } from "../src/services/auth/index.js";
import type { CredentialClearanceReason } from "../src/services/auth/index.js";

const REASONS: readonly CredentialClearanceReason[] = ["squatted_credential", "lost_credential"];

const { values } = parseArgs({
  options: {
    user: { type: "string" },
    reason: { type: "string" },
    by: { type: "string" },
    note: { type: "string" },
  },
});

async function main(): Promise<void> {
  const user = values.user;
  const reason = values.reason as CredentialClearanceReason | undefined;
  if (!user || !reason || !REASONS.includes(reason)) {
    throw new Error(
      `usage: pnpm clear-credential --user <app-user-uuid> --reason ${REASONS.join("|")} ` +
        `[--by <uuid>] [--note "<what happened>"]`
    );
  }

  const pool = new pg.Pool({ connectionString: resolveMigrateUrl() });
  try {
    const out = await withTransaction(
      pool,
      (tx) =>
        clearPassword(tx, {
          appUserId: user,
          reason,
          clearedBy: values.by ?? null,
          ...(values.note !== undefined ? { note: values.note } : {}),
        }),
      // A PERSON-SCOPED ACT, DECLARED AS ONE (E03-B04), on
      // `retire-authenticator`'s reasoning: `user_credential` and
      // `user_credential_clearance` carry no `shop_id`, so there is no tenant
      // for this transaction to name. The scope makes the transaction SAY what
      // it is rather than leaving a reader to infer it from the tables.
      { tenant: { service: "second-factor" } }
    );

    console.log(
      out.cleared
        ? `cleared: that person's password no longer verifies, and the clearance is recorded ` +
            `(${reason}). The row itself is still there — it is the lockout anchor and cannot be ` +
            `deleted — so they can be given a new password from the counter phone: ` +
            `POST /api/v1/credentials, on their own operator session. Their second factor is ` +
            `untouched.`
        : `nothing to clear: that person has no credential row at all. They can be given a ` +
            `password from the counter phone as they are.`
    );
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
