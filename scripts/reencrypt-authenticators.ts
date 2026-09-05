// Re-seal every second factor still sealed under an old key version.
//
//   pnpm reencrypt-authenticators [--dry-run] [--by <app-user-uuid>]
//
// ============================================================================
// THIS IS STEP 2 OF 048 §4.2's ADDITIVE ROTATION, AND UNTIL NOW IT DID NOT EXIST
// ============================================================================
//
// The rotation model is 050 §4's, borrowed rather than invented: every key
// version present in the environment can DECRYPT, the HIGHEST present ENCRYPTS.
// So introducing `LONGBOX_AUTHENTICATOR_KEY_V2` is a variable and a restart —
// new enrollments seal under V2, every existing row still opens under the V1 key
// it names, and no row is touched. **Removing V1 takes every second factor still
// sealed under it**, which `.env.example` states rather than leaves to be
// discovered, and this command is what makes the removal safe.
//
// ============================================================================
// IT PRODUCES FACTS. IT DOES NOT REWRITE A SECRET COLUMN
// ============================================================================
//
// One person's re-seal is a `user_authenticator_retirement` with reason
// `replaced` plus a NEW `user_authenticator` row, in ONE transaction — the same
// shape an enrollment has, and for a reason 048 R18 makes structural: **the AAD
// is the row's id**, so a ciphertext belongs to the row it was computed for. An
// in-place rewrite would carve an exception into "a sealed secret is written
// once", which is the sentence that makes a MOVED ciphertext fail to
// authenticate rather than decrypt to a working factor. `migrations/031`'s
// `ENABLE ALWAYS` trigger enforces it, so the exception is not available to
// carve.
//
// **The TOTP secret itself does not change**, so nobody re-scans anything and no
// authenticator app is disturbed. `last_used_step` is carried forward with the
// secret, because it is a fact about the secret: a successor with a NULL replay
// guard would make the code the owner used thirty seconds ago valid again, which
// is 048 R19's replay reintroduced by a maintenance job.
//
// ============================================================================
// WHAT IT PRINTS, AND WHAT IT NEVER PRINTS
// ============================================================================
//
// A person's id, the version it moved from and the version it moved to. **No
// secret, no ciphertext, no nonce, no otpauth URI and no code.** A re-seal is
// invisible to the person it is about, which is the whole point of it.
//
// It runs as the SCHEMA OWNER, like every other operator tool here: it INSERTs
// into `user_authenticator`, whose app-role grant is COLUMN-SCOPED to the replay
// guard — the app role could not do this and must not be able to.
import "dotenv/config";
import { parseArgs } from "node:util";
import pg from "pg";
import { resolveMigrateUrl } from "./migrateUrl.js";
import { withTransaction } from "../src/db.js";
import {
  authenticatorsBelowVersion,
  requireAuthenticatorKey,
  resealAuthenticator,
} from "../src/services/auth/index.js";

const { values } = parseArgs({
  options: { "dry-run": { type: "boolean", default: false }, by: { type: "string" } },
});

async function main(): Promise<void> {
  // The ring is read the same way the server reads it, so a misconfigured
  // environment fails here rather than half way through a table.
  const keyring = requireAuthenticatorKey();
  const pool = new pg.Pool({ connectionString: resolveMigrateUrl() });
  try {
    // Read as the SCHEMA OWNER outside a tenant context: `user_authenticator`
    // carries no `shop_id` and no policy (it is a declared RLS exemption — a
    // second factor belongs to a PERSON, who may hold memberships at more than
    // one shop), so there is no tenant this worklist could be scoped by.
    const pending = await authenticatorsBelowVersion(pool, keyring.current);

    console.log("");
    console.log(`Current key version: V${String(keyring.current)}`);
    console.log(`Authenticators sealed under an older version: ${String(pending.length)}`);

    if (pending.length === 0) {
      console.log("");
      console.log("Nothing to do. Every live authenticator is already at the current version,");
      console.log("so the older keys may be removed from the environment.");
      return;
    }

    if (values["dry-run"] === true) {
      console.log("");
      console.log("--dry-run: WRITING NOTHING. The work this would do:");
      for (const row of pending) {
        console.log(`  person ${row.appUserId}: V${String(row.keyVersion)} -> V${String(keyring.current)}`);
      }
      console.log("");
      console.log("Re-run without --dry-run to perform it.");
      return;
    }

    // ONE TRANSACTION PER PERSON, deliberately. A single transaction over the
    // whole table would hold `FOR UPDATE` on every live authenticator in the
    // estate for the length of the job — every second-factor verification
    // anywhere would block behind a maintenance command — and a failure half way
    // would roll back work that was already correct. Per person, a failure stops
    // the job with the finished ones committed, and re-running picks up exactly
    // the remainder, because the worklist is a predicate over `key_version`.
    let moved = 0;
    for (const row of pending) {
      const outcome = await withTransaction(
        pool,
        (tx) =>
          resealAuthenticator(tx, {
            appUserId: row.appUserId,
            keyring,
            now: new Date(),
            ...(values.by !== undefined ? { resealedBy: values.by } : {}),
          }),
        { tenant: { service: "second-factor" } }
      );
      if (outcome.resealed) {
        moved += 1;
        console.log(
          `  person ${row.appUserId}: V${String(outcome.from)} -> V${String(outcome.to)} (re-sealed)`
        );
      } else {
        // `already_current` means another run of this command got there first;
        // `no_authenticator` means the person's factor was retired between the
        // worklist read and now. Both are correct outcomes and neither is an
        // error — the worklist is a snapshot and the transaction is the truth.
        console.log(`  person ${row.appUserId}: skipped (${outcome.reason})`);
      }
    }

    console.log("");
    console.log(`Re-sealed ${String(moved)} of ${String(pending.length)}.`);
    console.log("");
    console.log("Only when this reports zero remaining may an older");
    console.log("LONGBOX_AUTHENTICATOR_KEY_V<n> be removed from the environment.");
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
