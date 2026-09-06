// Enrol a second factor for one person, and print their recovery codes ONCE.
//
//   pnpm enroll-authenticator --user <app-user-uuid> [--issuer Longbox]
//
// ============================================================================
// WHY THIS IS A SCRIPT AND NOT A ROUTE (E03-D06)
// ============================================================================
//
// The same shape as `issue-invitation`, one bead later, and for a reason that is
// one layer deeper. 048 §4.1 puts the second factor in "a session established by
// password + TOTP", and when this script was written **neither half of that
// session existed**: `user_credential` was 048 §10.1's M3 remainder that no bead in
// §10.2 owned, and `app_session` modelled exactly two kinds, both bound to an
// enrolled phone.
//
// ⚠ **E03-D11 BUILT BOTH, AND THIS SCRIPT IS STILL THE ONLY WAY TO ENROL** — for a
// reason that is now narrower and sharper than the one above. There IS a privileged
// session (`migrations/031`, 000-docs/057) and it would carry an enrollment route
// perfectly well; what there is NOT is any way to provision the FIRST factor in a
// running deployment, because `setPassword` has no production caller at all (057 §9
// R2a). So the chain that would let a person enrol over HTTP does not close, and
// this script is where an owner's second factor comes from. The bead that closes it
// is E03-D24 `longbox-e5b.3.34`.
//
// A `POST /api/v1/mfa/enrollments` shipped by this bead would therefore be
// reachable from exactly one place: an OPERATOR session on the shared counter
// phone. 048 §4.1 refuses that in its own words — *"requiring a phone-based second
// factor from a person standing at a shared phone is a ceremony that produces a
// shared authenticator, which is worse than no second factor because it looks like
// one"* — and an owner's operator session "cannot reach an owner surface" at all.
// So the route would be either unreachable or wrong.
//
// The CLI is the honest artifact. It runs where an operator already has the
// database and the key: on the host, as the schema owner, with the person standing
// there to scan the code.
//
// ============================================================================
// WHAT IT PRINTS, AND WHAT IT WILL NEVER PRINT AGAIN
// ============================================================================
//
// The `otpauth://` URI once (it contains the secret, by construction), and the
// recovery codes once. The secret is sealed with AES-256-GCM before it touches the
// database and the plaintext dies with the process; the codes are stored as
// argon2id digests over `code ‖ pepper` and are not recoverable from them.
//
// **Do not add a `--show-again` flag**, for the reason `issue-invitation` says it:
// a secret you can ask for twice is a secret stored somewhere.
import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import pg from "pg";
import { resolveMigrateUrl } from "./migrateUrl.js";
import { withTransaction } from "../src/db.js";
import {
  enrollAuthenticator,
  mintTotpSecret,
  otpauthUri,
  requireAuthenticatorKey,
  requirePinPepper,
} from "../src/services/auth/index.js";
// E03-D17: the otpauth label needs a login identifier, and turning an
// `app_user_id` into one is the audited accessor's job wherever it happens —
// including in a schema-owner CLI, which is the tree `pnpm arch`'s rule scans
// for exactly this reason (058 F6's lesson, one bead over).
import { resolvePersonForAuthenticatorEnrollment } from "../src/identity/index.js";

const { values } = parseArgs({
  options: { user: { type: "string" }, issuer: { type: "string", default: "Longbox" } },
});

async function main(): Promise<void> {
  const user = values.user;
  if (!user) {
    throw new Error("usage: pnpm enroll-authenticator --user <app-user-uuid> [--issuer Longbox]");
  }

  // Both fail closed, before anything is minted or read: an enrollment that got as
  // far as showing somebody a QR code and then discovered it had no key would have
  // shown a secret it could not store.
  const keyring = requireAuthenticatorKey();
  const pepper = requirePinPepper();

  const pool = new pg.Pool({ connectionString: resolveMigrateUrl() });
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    // The access fact carries a NULL `shop_id` — a second factor belongs to a
    // PERSON, who may hold memberships at more than one shop (034 §2.6) — which
    // `migrations/035`'s CHECK ties to `accessor_method = 'CLI'` and which only
    // the schema owner can write, because the tenant policy refuses an unscoped
    // row to the application role.
    const row = await resolvePersonForAuthenticatorEnrollment(
      pool,
      {
        method: "CLI",
        path: "scripts/enroll-authenticator.ts",
        purpose: "authenticator_enrollment",
        shopId: null,
      },
      user
    );
    if (!row) throw new Error(`no app_user with id ${user}`);

    // THE SECRET LIVES IN THIS PROCESS AND NOWHERE ELSE UNTIL IT IS CONFIRMED
    // (048 §4.3). There is no pending-enrollment table, deliberately: the only
    // honest place for a secret nobody has yet proved they hold is memory.
    const secret = mintTotpSecret();
    console.log("");
    console.log("Scan this in an authenticator app. It is shown ONCE and stored nowhere:");
    console.log("");
    console.log(`  ${otpauthUri({ secret, label: row.email, issuer: values.issuer ?? "Longbox" })}`);
    console.log("");
    const code = await rl.question("Enter the six-digit code the app shows now: ");

    const out = await withTransaction(
      pool,
      (tx) =>
        enrollAuthenticator(tx, {
          appUserId: row.id,
          secret,
          confirmationCode: code,
          keyring,
          pepper,
          now: new Date(),
        }),
      // A PERSON-SCOPED ACT, DECLARED AS ONE (E03-B04). `user_authenticator`,
      // `recovery_code` and `app_user` carry no `shop_id`, and the `auth_attempt`
      // row a failure appends carries a NULL one — so there is no tenant for this
      // transaction to name. This CLI runs as the schema owner and would bypass
      // the policies anyway; the scope is declared so the transaction SAYS what it
      // is, and so the route E03-D11 turns this into starts with a context that is
      // already right rather than one somebody has to remember to add.
      { tenant: { service: "second-factor" } }
    );

    if (!out.ok) {
      throw new Error(
        out.refusal === "role_not_privileged"
          ? "that person holds no live owner, manager or support_break_glass membership. 048 §4.1 " +
              "requires a second factor of those three roles and EXEMPTS the operator, because a " +
              "phone-based second factor for somebody standing at a shared counter phone produces a " +
              "shared authenticator — worse than none, because it looks like one."
          : "that code did not verify against the secret just shown. Nothing was written: a secret " +
              "that is never confirmed never becomes an authenticator row (048 §4.3). Run it again."
      );
    }

    console.log("");
    console.log("Enrolled. Recovery codes — shown ONCE, stored only as argon2id digests:");
    console.log("");
    for (const recoveryCode of out.enrolled.recoveryCodes) console.log(`  ${recoveryCode}`);
    console.log("");
    console.log("Print them and put them somewhere physical. Each works once, ONLY together with");
    console.log("this person's password, and using one retires this authenticator and forces a");
    console.log("fresh enrollment (048 §8.1). Enrolling again supersedes every code above.");
  } finally {
    rl.close();
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
