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
 * **`ON CONFLICT … DO UPDATE SET email = EXCLUDED.email` is a no-op UPDATE and
 * is deliberate** — it is the idiom that makes `RETURNING id` produce a row on
 * the conflicting path too, where `DO NOTHING` returns nothing at all. The
 * DISPLAY NAME of an existing person is NOT overwritten: a second invitation
 * for an address that already exists must not let the inviter rename somebody
 * who already works somewhere, and 034 §2.5 makes a display name the person's
 * own.
 *
 * `email` is a LOGIN IDENTIFIER and not a delivery channel (048 §7.2: no mailer
 * exists and this system does not invent one). It is lowercased on the way in so
 * the sign-in path's `lower($1)` lookup finds it.
 */
export async function upsertPerson(tx: Tx, args: { email: string; displayName: string }): Promise<string> {
  const res = await tx.query(
    `INSERT INTO app_user (email, display_name) VALUES (lower($1), $2)
     ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
     RETURNING id`,
    [args.email, args.displayName]
  );
  return (res.rows[0] as { id: string }).id;
}
