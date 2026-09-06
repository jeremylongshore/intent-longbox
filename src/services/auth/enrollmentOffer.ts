// THE ENROLMENT OFFER — an unconfirmed second-factor secret, sealed, held by
// the CLIENT, and in no table and no map.
//
// Bead: longbox-e5b.3.34 (alias E03-D24). Docs: 000-docs/063 §3.4; 048 §4.2,
// §4.3, R18; 057 §4.6, §4.8.
//
// ============================================================================
// THE PROBLEM THIS SOLVES, AND WHY THE OBVIOUS ANSWERS ARE WORSE
// ============================================================================
//
// 048 §4.3 rules that **a secret that is never confirmed never becomes a row**:
// the person scans the secret, produces a code from it, and only then is
// anything written. `pnpm enroll-authenticator` satisfies that by holding the
// secret in MEMORY across one operator's decision — which is honest for a
// terminal and unavailable to a request/response surface, because the two halves
// are two requests and the process may not even be the same one.
//
// Three answers were on the table (063 §6 A1–A3):
//
//   * **a row for the unconfirmed secret.** It stores a live TOTP secret for
//     somebody who has not proved they hold it — the exact object §4.3's
//     sentence exists to keep out of the database — and it grows a table nobody
//     reaps.
//   * **a map in this process.** It works on one instance and silently stops
//     working on two, and a restart mid-enrolment becomes an unexplainable
//     refusal. An authentication flow whose correctness depends on the process
//     count is a flow that fails the first time somebody scales it.
//   * **let the CLIENT choose the secret.** Then the server accepts key material
//     from a body and cannot say anything at all about its entropy: a buggy
//     client that enrols a constant is invisible until it is a breach.
//
// So the secret is minted by the SERVER, sealed, and handed to the client to
// hand back. **The ring, the envelope and the AAD binding are 048 R18's, reused
// rather than re-derived** — the same `seal`/`open` the stored column uses, so
// there is no second cryptographic construction in this system to review.
//
// ============================================================================
// WHAT THE AAD BINDS, AND WHY EACH PART OF IT IS THERE
// ============================================================================
//
// `authenticator-offer:v1:<app_user_id>:<expires_at_ms>` — and every field is
// load-bearing:
//
//   * **the person**, so a ticket minted for one person cannot be confirmed as
//     another. This is 048 R18's own property ("a ciphertext moved between rows
//     fails to authenticate instead of decrypting to a working factor") applied
//     to a value that is not a row: the confirming call names no person at all —
//     it takes the person from the SESSION — so a lifted ticket is refused
//     because the session's person is not the one inside the seal;
//   * **the expiry**, so the lifetime is INSIDE the authenticated bytes. A
//     client that edits the wire's `expires_at` changes nothing, because the
//     value the server compares against is the one it must reconstruct to open
//     the ciphertext at all;
//   * **a version tag**, so a later shape is a different AAD rather than an
//     ambiguity.
//
// ============================================================================
// ⚠ A TICKET IS SINGLE-USE, AND THE DATABASE IS WHAT MAKES IT SO
// ============================================================================
//
// **v1.0.0 SAID THE OPPOSITE AND THE SECURITY LENS BROKE IT** (063 §3.4, the
// lens's F2). The sentence was: *"a ticket is NOT single-use and is NOT a
// credential — confirming one twice enrols twice, and the second enrolment
// supersedes the first exactly as any re-enrolment does."* The lens replayed a
// ticket FORTY SECONDS after its first confirmation under a new
// `Idempotency-Key` and got a second `201`: a second authenticator, and eight
// FRESH recovery codes, which silently retired the set the person had just
// written off the screen. For the person in 048 §8.1's re-enrolment state that
// is the set they need most, and "supersedes exactly as any re-enrolment does"
// is precisely the wrong property for an artifact nobody re-presented on purpose.
//
// So the ticket joins 048 R15's idiom, which this schema already uses three
// times: **single use is a CONSTRAINT or it is a race.** `enrolOwnAuthenticator`
// INSERTs `authenticator_offer_use (ticket_digest)` inside the transaction that
// writes the authenticator, and the PRIMARY KEY is what refuses the second one.
// A genuine RETRY still works, because `replayIfSettled` runs before any of it;
// what the constraint bites is a RE-SUBMISSION under a new key, which is a
// second act.
//
// Holding a ticket still grants nothing on its own: the confirming route
// requires the privileged session, and the code must be generated from the
// secret inside the seal.
import { randomUUID } from "node:crypto";
import type { Tx } from "../../db.js";
import { AeadOpenError, open, seal, type AuthenticatorKeyring } from "./aead.js";
import { mintTotpSecret } from "./totp.js";

/**
 * PROVISIONAL ten minutes (042 A3), with its derivation stated and no
 * measurement behind it: an offer lives from "show me a QR code" to "here is the
 * code my phone shows", which is one scan and one six-digit type — under a
 * minute done attentively, and ten gives room for a person who is interrupted
 * mid-enrolment by a customer at the counter. It is a floor that may be RAISED
 * freely; lowering it after seeing a result it would change needs a 006 row
 * (018 C3). **Never quoted as a security property in any artifact** (021 B16).
 */
export const PROVISIONAL_OFFER_TTL_MS = 10 * 60 * 1000;

/** The wire format's own tag, so a later shape is a different thing. */
const OFFER_VERSION = "v1";

export interface EnrollmentOffer {
  /** The plaintext secret. Held for the length of one response and never stored. */
  readonly secret: Buffer;
  /** What the client sends back. Opaque to it, and to everything but this file. */
  readonly ticket: string;
  readonly expiresAt: Date;
}

function aadFor(appUserId: string, expiresAtMs: number): string {
  return `authenticator-offer:${OFFER_VERSION}:${appUserId}:${String(expiresAtMs)}`;
}

/**
 * Mint a secret and seal it into a ticket for this person.
 *
 * The ticket carries its own key version, so a ring that has gained a `..._V2`
 * between the two halves of one enrolment still opens the ticket it issued — the
 * same additive-rotation property 048 §4.2 gives the stored column.
 */
export function mintEnrollmentOffer(args: {
  keyring: AuthenticatorKeyring;
  appUserId: string;
  now: Date;
  ttlMs?: number;
}): EnrollmentOffer {
  const secret = mintTotpSecret();
  const expiresAt = new Date(args.now.getTime() + (args.ttlMs ?? PROVISIONAL_OFFER_TTL_MS));
  const sealed = seal(args.keyring, secret, aadFor(args.appUserId, expiresAt.getTime()));
  const ticket = [
    OFFER_VERSION,
    String(sealed.keyVersion),
    String(expiresAt.getTime()),
    sealed.nonce.toString("base64url"),
    sealed.ciphertext.toString("base64url"),
  ].join(".");
  return { secret, ticket, expiresAt };
}

export type OfferRefusal = "malformed" | "expired" | "did_not_authenticate";

/**
 * Open a ticket for THIS person, or say why not.
 *
 * ⚠ **THE PERSON IS AN ARGUMENT AND NEVER A FIELD OF THE TICKET**, which is the
 * whole of the binding: the caller passes the person their SESSION names, that
 * value goes into the AAD, and a ticket minted for anybody else fails to
 * authenticate. A ticket that carried its own person id would be a claim the
 * server then had to decide whether to believe.
 *
 * The expiry is checked BEFORE the open, so an expired ticket costs no
 * decryption — and it is checked again implicitly by the AAD, because the value
 * compared is the value the seal was made over.
 *
 * Every refusal reaches the wire as ONE code (`AUTHENTICATOR_ENROLLMENT_REFUSED`,
 * no details): a caller holding a ticket must not learn which half of it the
 * server disliked.
 */
export function openEnrollmentOffer(args: {
  keyring: AuthenticatorKeyring;
  appUserId: string;
  ticket: string;
  now: Date;
}): { ok: true; secret: Buffer } | { ok: false; refusal: OfferRefusal } {
  const parts = args.ticket.split(".");
  if (parts.length !== 5 || parts[0] !== OFFER_VERSION) return { ok: false, refusal: "malformed" };
  const keyVersion = Number(parts[1]);
  const expiresAtMs = Number(parts[2]);
  if (!Number.isInteger(keyVersion) || !Number.isInteger(expiresAtMs)) {
    return { ok: false, refusal: "malformed" };
  }
  if (expiresAtMs <= args.now.getTime()) return { ok: false, refusal: "expired" };

  const nonce = Buffer.from(parts[3]!, "base64url");
  const ciphertext = Buffer.from(parts[4]!, "base64url");
  try {
    const secret = open(args.keyring, {
      ciphertext,
      nonce,
      keyVersion,
      aad: aadFor(args.appUserId, expiresAtMs),
    });
    return { ok: true, secret };
  } catch (err) {
    // `AeadOpenError` is the ONLY expected failure and it means exactly one
    // thing: this ticket was not sealed for this person, under a key this
    // process holds, with this expiry. Anything else is a defect and is
    // re-thrown rather than flattened into a refusal (057 §4.6's rule for the
    // re-seal job, one construction over).
    if (err instanceof AeadOpenError) return { ok: false, refusal: "did_not_authenticate" };
    throw err;
  }
}

/**
 * A label for an otpauth URI when the person's login identifier is unavailable.
 *
 * Not used by the route — which resolves the identifier through the identity
 * accessor, because an authenticator app showing `Longbox: 7f3a…` is one nobody
 * can tell from the other one on the same phone (048 §4.3) — and here so a
 * caller with no accessor context has an obviously synthetic fallback rather
 * than an empty string.
 */
export function fallbackLabel(): string {
  return `longbox-${randomUUID().slice(0, 8)}`;
}

/**
 * Thrown when a ticket has already been confirmed (048 R15; the security lens's
 * F2). The caller turns it into the route's ONE refusal, because a caller
 * holding a ticket must not learn which half of it the server disliked.
 */
export class EnrollmentOfferAlreadySpent extends Error {
  constructor() {
    super("enrollment offer already confirmed");
    this.name = "EnrollmentOfferAlreadySpent";
  }
}

/**
 * **Spend the ticket, in the transaction that writes the authenticator.**
 *
 * `ON CONFLICT DO NOTHING RETURNING …` and a row count, which is
 * `grantInvitation`'s construction one credential over: the second confirmation
 * of one ticket is a failed INSERT decided by the database, not a `SELECT` two
 * callers can both pass. The digest is the caller's, because
 * `enrolOwnAuthenticator` already computes it for the idempotency hash, and
 * computing it twice is two places for it to be computed differently.
 */
export async function spendEnrollmentOffer(
  tx: Tx,
  args: { ticketDigest: string; appUserId: string; authenticatorId?: string }
): Promise<void> {
  const res = await tx.query(
    `INSERT INTO authenticator_offer_use (ticket_digest, app_user_id, authenticator_id)
     VALUES ($1,$2,$3)
     ON CONFLICT (ticket_digest) DO NOTHING
     RETURNING ticket_digest`,
    [args.ticketDigest, args.appUserId, args.authenticatorId ?? null]
  );
  if (res.rows.length === 0) throw new EnrollmentOfferAlreadySpent();
}
