// Issue an invitation for one person at one shop, and print the code ONCE.
//
//   pnpm issue-invitation --shop <uuid> --by <owner-app-user-uuid> \
//     --email new.person@example.invalid --name "New Person" \
//     [--role operator|manager|owner] [--location <uuid>]
//
// ============================================================================
// WHY THIS IS A SCRIPT AND NOT A ROUTE (E03-D07)
// ============================================================================
//
// 048 §7.1 makes issuing an invitation an owner-or-manager act, and §4.1 makes
// every privileged act require a session whose MFA completion is inside a
// freshness window. **Privileged sessions do not exist yet** — TOTP, its
// authenticator table and the freshness window are E03-D06's — so a
// `POST /api/v1/invitations` route shipped by this bead would be a route that
// CALLS ITSELF privileged while nothing enforces privilege. That is a worse
// artifact than an honest CLI, and it is the kind of thing that stays wrong
// because the label reads right.
//
// So the ROLE half is enforced (`issueInvitation` refuses an inviter with no
// live membership at the shop), the SESSION half is not attempted, and the route
// is declared `pending: true` on the auth allowlist with E03-D06 named as the
// bead that lands it. The walk asserts the path is absent until then.
//
// ============================================================================
// WHAT IT PRINTS, AND WHAT IT MUST NEVER PRINT AGAIN
// ============================================================================
//
// The code, once, to stdout. It is not written to the database in any form
// (`migrations/024` stores `sha256` and nothing else), not logged, and not
// recoverable: an owner who loses it issues another and lets the first expire.
// **Do not add a `--show-again` flag.** A code you can ask for twice is a code
// stored somewhere, and 048 §7.1's "shown once" is the whole of its custody
// story.
//
// It runs as the SCHEMA OWNER, like `register-shop`, because it is an operator
// tool rather than a request path: `resolveMigrateUrl` is the same rule spelled
// once (E02-D06).
import "dotenv/config";
import { parseArgs } from "node:util";
import pg from "pg";
import { resolveMigrateUrl } from "./migrateUrl.js";
import { withTransaction } from "../src/db.js";
import { issueInvitation, type InvitableRole } from "../src/services/auth/index.js";

const ROLES: readonly InvitableRole[] = ["owner", "manager", "operator"];

const { values } = parseArgs({
  options: {
    shop: { type: "string" },
    by: { type: "string" },
    email: { type: "string" },
    name: { type: "string" },
    role: { type: "string", default: "operator" },
    location: { type: "string" },
  },
});

async function main(): Promise<void> {
  const { shop, by, email, name, location } = values;
  const role = values.role as InvitableRole;
  if (!shop || !by || !email || !name) {
    throw new Error(
      "usage: pnpm issue-invitation --shop <uuid> --by <app-user-uuid> --email <address> " +
        '--name "<display name>" [--role operator|manager|owner] [--location <uuid>]'
    );
  }
  if (!ROLES.includes(role)) {
    // `support_break_glass` is deliberately not in the list, and the CHECK on
    // `invitation.role` refuses it at the database too: 034 §2.6 says it "is
    // never granted at ratification and never grants itself", and a code that
    // could mint one would be the quieter second path 048 §8.2 refuses to build.
    throw new Error(`--role must be one of ${ROLES.join(", ")} (support_break_glass is never invitable)`);
  }

  const pool = new pg.Pool({ connectionString: resolveMigrateUrl() });
  try {
    const out = await withTransaction(pool, async (tx) => {
      // The person is created here if they are new, because the invitation NAMES
      // the person it was written for (`migrations/024`) — whoever holds the code
      // cannot decide who they are. `app_user.email` is a login identifier and
      // not a delivery channel: 048 §7.2 is explicit that no mailer exists and
      // this bead does not invent one.
      const person = await tx.query(
        `INSERT INTO app_user (email, display_name) VALUES (lower($1), $2)
         ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
         RETURNING id`,
        [email, name]
      );
      const appUserId = (person.rows[0] as { id: string }).id;
      return issueInvitation(tx, {
        shopId: shop,
        appUserId,
        role,
        locationId: location ?? null,
        invitedBy: by,
        now: new Date(),
      });
    });

    if (!out.ok) {
      throw new Error(
        out.refusal === "not_permitted"
          ? "the inviter's live role at that shop may not issue this invitation — either it does " +
              "not carry `membership.invite` (owner or manager, shop-scoped) or it may not hand out " +
              "the role asked for (048 §7.1, 054 §3, §5)"
          : "that shop already has the maximum number of outstanding invitations (048 §7.1a). " +
              "Let one expire or wait for it to be redeemed."
      );
    }

    console.log("");
    console.log("Invitation code (shown ONCE, and stored nowhere):");
    console.log(`  ${out.invitation.code}`);
    console.log("");
    console.log(`  expires: ${out.invitation.expiresAt.toISOString()}`);
    console.log(`  role:    ${role}`);
    console.log("");
    console.log("Hand it to the person face to face and have them enter it on an enrolled");
    console.log("phone at this shop. It works on no other device (048 §7.1a).");
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
