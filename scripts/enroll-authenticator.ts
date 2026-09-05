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
// password + TOTP", and **neither half of that session exists**: `user_credential`
// (the first factor) is 048 §10.1's M3 remainder that no bead in §10.2 owns, and
// `app_session` (`migrations/020`) models exactly two kinds, both bound to an
// enrolled phone by a CHECK and two composite foreign keys — there is no row shape
// for a person on their own laptop.
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
    const person = await pool.query(`SELECT id, email, display_name FROM app_user WHERE id = $1`, [user]);
    const row = person.rows[0] as { id: string; email: string; display_name: string } | undefined;
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

    const out = await withTransaction(pool, (tx) =>
      enrollAuthenticator(tx, {
        appUserId: row.id,
        secret,
        confirmationCode: code,
        keyring,
        pepper,
        now: new Date(),
      })
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
