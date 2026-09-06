// A PERSON — `app_user`, and the one write that creates one.
//
// Bead: longbox-e5b.3.21 (alias E03-D11). Docs: 048 §7.1, §7.2; 034 §2.5, §2.13.
//
// It exists as a file because the SQL below had two copies — one in
// `scripts/issue-invitation.ts` and one about to be written in the route that
// replaces it — and two copies of a person-creating INSERT is two answers to
// "what happens when the address is already there". `scripts/register-shop.ts`
// has two more of its own; they are not folded in here, because that script
// creates an owner as part of a shop's first transaction and a merge would drag
// its bootstrap semantics into the ordinary path (057 §7 residual R5).
//
// ⚠ **THE READ THAT LIVED HERE IS GONE — E03-D17.** `readPerson` was a second
// copy of `api.ts`'s `readUser`: the same `SELECT u.id, u.display_name FROM
// app_user`, in two files, one of them unreferenced. Both are now
// `src/identity/`'s audited accessor, so a person-resolution writes an
// `identity_access` fact and cannot happen anywhere else (019 T35(b), 034 §3.3).
// **This file keeps only the WRITE**, which is the opposite disclosure
// direction: it carries a name INTO the database that the caller already holds.
// `RETURNING id` and not `RETURNING id, display_name`, for the same reason —
// no caller ever used the name, and returning one made a write into a read.
import type { Tx } from "../../db.js";

/**
 * Find or create the person an invitation names.
 *
 * ⚠ **THE INVITATION NAMES THE PERSON, SO THIS RUNS BEFORE THE CODE IS MINTED**
 * (048 §7.1): whoever holds the code cannot decide who they are, which is what
 * stops a code read aloud across a counter from becoming an account somebody
 * else chose the name for.
 *
 * ⚠ **IT RUNS IN THE `person-admission` SCOPE AND IN NO OTHER CONTEXT** — E03-D21,
 * 000-docs/062. `app_user` is policied on a LIVE MEMBERSHIP since `migrations/036`,
 * and this is the one statement in the system that reaches a person BEFORE any
 * grant exists: an invitation names its addressee before any code is minted, and
 * the addressee may hold nothing anywhere, or may already work at ANOTHER shop
 * whose row no tenant context here can see (034 §2.6). The scope may SELECT a
 * person and may INSERT an ACTIVE one, and may do nothing else to the table.
 *
 * ⚠ **`ON CONFLICT … DO UPDATE` IS GONE, AND ITS REMOVAL IS THE SECURITY PROPERTY
 * RATHER THAN A TIDY-UP** (E03-D21). It was a no-op UPDATE used only to make
 * `RETURNING id` produce a row on the conflicting path — but an `ON CONFLICT DO
 * UPDATE` is an UPDATE to row-level security, so keeping it would have meant
 * granting the admission scope the right to update ANY person's row, cross-tenant,
 * including their login identifier. `DO NOTHING` plus a read means the scope holds
 * `SELECT` and `INSERT` and nothing more, so **the running server can admit a
 * person and can never rename, suspend or deactivate one**. The display name of an
 * existing person is still not overwritten — now by construction rather than by a
 * carefully chosen `SET` clause — which is 034 §2.5's rule that a display name is
 * the person's own.
 *
 * **The read is a SECOND statement rather than a CTE, and that is the concurrency
 * fix.** A `WITH ins AS (INSERT … DO NOTHING RETURNING id) … UNION ALL SELECT …`
 * evaluates both halves against ONE snapshot, so a row another transaction commits
 * between the snapshot and the conflict is invisible to the fallback and the
 * statement returns nothing at all. Two statements in READ COMMITTED take two
 * snapshots, and the second sees what the first collided with.
 *
 * `email` is a LOGIN IDENTIFIER and not a delivery channel (048 §7.2: no mailer
 * exists and this system does not invent one). It is lowercased on the way in so
 * the sign-in path's `lower($1)` lookup finds it.
 */
export async function upsertPerson(tx: Tx, args: { email: string; displayName: string }): Promise<string> {
  const inserted = await tx.query(
    `INSERT INTO app_user (email, display_name) VALUES (lower($1), $2)
     ON CONFLICT (email) DO NOTHING
     RETURNING id`,
    [args.email, args.displayName]
  );
  const fresh = inserted.rows[0] as { id: string } | undefined;
  if (fresh) return fresh.id;

  // The address was already there. Projecting `u.id` ALONE from a value the
  // CALLER supplied is the same shape `credentials.ts`'s sign-in lookup is a
  // declared `pnpm arch` exemption for: it resolves nothing about a person the
  // caller did not already name. 000-docs/062 §3.3.
  const existing = await tx.query(`SELECT u.id FROM app_user u WHERE u.email = lower($1)`, [args.email]);
  const row = existing.rows[0] as { id: string } | undefined;
  if (!row) {
    // Unreachable under the admission scope, where the SELECT spans tenants: the
    // INSERT conflicted, so a row with this address exists. Reached only if this
    // function is ever called under an ordinary tenant context, where the policy
    // hides the person it just collided with — which is a caller bug and says so.
    // ⚠ The scope's NAME is deliberately not spelled in this string. `pnpm arch`
    // counts every literal occurrence of a scope name outside the declaration
    // files and holds the number EXACT, so a prose mention here would read as a
    // second entry point — which is the rule working, not a limitation.
    throw new Error(
      "upsertPerson: the address already exists and could not be read back. This function must run " +
        "inside the declared admission scope (`src/db/tenantContext.ts`, 000-docs/062 §3); under an " +
        "ordinary tenant context `app_user`'s policy hides a person who holds no live grant at that shop."
    );
  }
  return row.id;
}
