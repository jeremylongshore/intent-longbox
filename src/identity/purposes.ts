// The CLOSED vocabulary of reasons to turn a key into a person, and the
// inventory of places allowed to ask.
//
// Bead: longbox-e5b.3.27 (alias E03-D17). Docs: 000-docs/060 §3, §4; 019 T35(b)
// (NON-WAIVABLE); 034 §3.3; 048 §12.4 row 6, §3.5; 054 §8; 022 P3.
//
// TWO CLOSED LISTS, AND THEY CLOSE DIFFERENTLY ON PURPOSE.
//
// `IDENTITY_PURPOSES` is closed by a CHECK CONSTRAINT in `migrations/035` as
// well as by this union: adding a fifth is a migration and a decision, on
// `032`'s argument for `origin` — the vocabulary of reasons to resolve a person
// must not be extensible by whoever writes the next INSERT.
//
// `DECLARED_ACCESSORS` is closed by CODE ALONE, and cannot be a constraint: an
// accessor is a route template or a script path, and the set grows every time
// somebody adds a screen. That asymmetry is exactly what makes the audit worth
// running — `pnpm audit:identity-access` reconciles the rows in the table
// against this list, and a row from an accessor nobody declared is the finding
// 019 T35(b) is asking for. A CHECK would have made that finding impossible to
// have by making the row impossible to write, which sounds stronger and is
// weaker: the write would fail inside a request nobody was auditing, and the
// author would delete the accessor's audit call to make their route work.

/**
 * Why an accessor asked. Closed here AND by `migrations/035`'s CHECK.
 *
 * Each member has a live caller. **A purpose with no caller is not declared** —
 * 022 P3's CFO constraint is *"never build a per-operator surface and then
 * restrict it"*, and a vocabulary is a surface's first half. In particular
 * `break_glass_reconciliation` is deliberately ABSENT: E11-B09 is the bead that
 * gives break-glass its read path, and it adds the purpose in the migration that
 * adds the reader (000-docs/060 §3.3).
 */
export const IDENTITY_PURPOSES = [
  "session_display_name",
  "operator_picker_roster",
  "invitation_addressee",
  "authenticator_enrollment",
] as const;

export type IdentityPurpose = (typeof IDENTITY_PURPOSES)[number];

/** What each purpose is for, in a sentence a reviewer can disagree with. */
export const PURPOSE_PROSE: Readonly<Record<IdentityPurpose, string>> = {
  session_display_name:
    "The person a session names, resolved so the phone that HOLDS that session can render " +
    "'signed in as …'. One person, always the caller's own — never a third party's, and never " +
    "beside a scan session, a batch or an item (034 §2.5, 048 §3.5).",
  operator_picker_roster:
    "The shop's roster of display names, rendered to a live device session so somebody can tap " +
    "their own name (048 §3.5). A roster is a list of who could be holding the phone; a " +
    "leaderboard is a list of what they did, and the difference is one sort order — which is why " +
    "this read is ordered by display name and carries no per-person datum at all.",
  invitation_addressee:
    "The person an invitation NAMES, resolved at redemption so the receipt can say who joined " +
    "(048 §7.1). The invitation was written for them before the code existed, so the name is one " +
    "the shop already holds; resolving it discloses nothing the inviter did not supply.",
  authenticator_enrollment:
    "The person a second factor is being enrolled for, resolved by a schema-owner CLI to label " +
    "the otpauth URI it prints once (048 §4.3). It has no tenant: a second factor belongs to a " +
    "PERSON, who may hold memberships at more than one shop (034 §2.6).",
};

/**
 * The KIND of key an accessor resolved. Closed here and by `migrations/035`.
 *
 * 034 §3.3 names four paths; **054 §8 adds the fifth** — `authorization_decision`'s
 * `membership_id` and `session_chain_id` join to a person exactly as `operator_id`
 * does, and saying so is what stops the accessor being built around the four
 * column names 034 happened to list in 2026 while a fifth path sat beside it.
 * `shop_roster` is the bulk shape: a read keyed on a SHOP that produces people.
 */
export const IDENTITY_KEY_KINDS = [
  "app_user_id",
  "operator_id",
  // ⚠ THE TWO THE GATE AUDIT'S F7 ADDED, AND THE HAZARD THEY CLOSE IS THE ONE
  // 034 §3.3 IS ABOUT. That section names THREE columns — `operator_id`,
  // `created_by`, `confirmed_by` — and A5 puts the two legacy strings INSIDE the
  // contract rather than outside it: T35 keys on operator identifiers of any
  // shape, and an unverified one is per-operator data that is also unreliable.
  // At v1.0.0 this enum held neither, so the FIRST reader of a pre-G2 attribution
  // string could not have written its fact at all — the CHECK would have refused
  // it — and the author's cheapest fix would have been to skip the accessor. A
  // gate whose correct use is impossible is a gate somebody routes around.
  //
  // No caller today, and that is not the same objection as the one that keeps
  // `break_glass_reconciliation` out of `IDENTITY_PURPOSES`: a PURPOSE is a
  // reason somebody may ask, which is a surface's first half; a KEY KIND is the
  // shape of a column that already exists in this schema and is already named by
  // a ratified contract. E02-D10 retires both columns eventually, at which point
  // these two become historical rather than wrong.
  "created_by",
  "confirmed_by",
  "membership_id",
  "session_chain_id",
  "shop_roster",
] as const;

export type IdentityKeyKind = (typeof IDENTITY_KEY_KINDS)[number];

/** One declared place that may resolve a person, and what it is allowed to ask for. */
export interface DeclaredAccessor {
  /** HTTP method, or the literal `CLI` (`authorization_decision`'s idiom). */
  readonly method: string;
  /** The route TEMPLATE, or the script path. Never a URL. */
  readonly path: string;
  /** The purposes this accessor may cite. Never empty. */
  readonly purposes: readonly IdentityPurpose[];
  /** Why this surface needs a person's name at all. */
  readonly reason: string;
}

/**
 * Every place in this system that may turn a key into a person.
 *
 * FIVE ROWS TODAY, and the list is short because that is the control. 022 P3's
 * cheapest satisfaction of 019 T35 is *"never to build a per-operator surface"*;
 * this list is the inventory of the reads that came closest and the argument for
 * each one being an authentication affordance rather than a surface.
 */
export const DECLARED_ACCESSORS: readonly DeclaredAccessor[] = [
  {
    method: "POST",
    path: "/api/v1/operator-sessions",
    purposes: ["session_display_name"],
    reason:
      "Tapping a name and entering a PIN opens an operator session, and the 201 says whose. The " +
      "person resolved is the person who just authenticated on that phone.",
  },
  {
    method: "POST",
    path: "/api/v1/privileged-sessions",
    purposes: ["session_display_name"],
    reason:
      "The same read one principal up (048 §4.1): a privileged sign-in's 201 says whose session it " +
      "is. The person resolved is the caller.",
  },
  {
    method: "GET",
    path: "/api/v1/operators",
    purposes: ["operator_picker_roster"],
    reason:
      "The operator picker (048 §3.5, I7). It renders only to a live device session — 'who works " +
      "here' is a per-shop datum a passer-by on the same Wi-Fi has no claim on.",
  },
  {
    method: "POST",
    path: "/api/v1/invitations/redemptions",
    purposes: ["invitation_addressee"],
    reason:
      "Redeeming an invitation grants a membership and sets a PIN in one act (048 §7.2); the 201 " +
      "names the person the invitation was written for.",
  },
  {
    method: "CLI",
    path: "scripts/enroll-authenticator.ts",
    purposes: ["authenticator_enrollment"],
    reason:
      "`pnpm enroll-authenticator` labels the otpauth URI with the person's login identifier so " +
      "the authenticator app shows something the holder recognises (048 §4.3). A CLI and not a " +
      "route because 048 §4.1 puts the second factor inside a session established by password + " +
      "TOTP; E03-D11 landed that session and the issuance surface is still nobody's route.",
  },
];

/** `POST /api/v1/operators` — the key an audit groups on. */
export function accessorKey(method: string, path: string): string {
  return `${method} ${path}`;
}

/** The declared accessor keys, sorted, for a reader that only needs the set. */
export const DECLARED_ACCESSOR_KEYS: readonly string[] = DECLARED_ACCESSORS.map((a) =>
  accessorKey(a.method, a.path)
).sort();

/** Is this (method, path, purpose) triple one somebody declared? */
export function isDeclaredAccess(method: string, path: string, purpose: string): boolean {
  const row = DECLARED_ACCESSORS.find((a) => a.method === method && a.path === path);
  if (row === undefined) return false;
  return (row.purposes as readonly string[]).includes(purpose);
}

/** The METHOD and TEMPLATE Fastify matched, as the hook already observes them. */
export interface ObservedRoute {
  readonly method: string;
  /** `req.routeOptions.url` — the registered TEMPLATE, never `req.url`. */
  readonly path: string;
}

/** Thrown when a surface resolves a person under a pair or a purpose nobody declared. */
export class UndeclaredAccessorError extends Error {
  constructor(
    readonly method: string,
    readonly path: string,
    readonly purpose: string
  ) {
    super(
      `refusing to resolve a person: ${method} ${path} is not declared to cite '${purpose}' ` +
        `(src/identity/purposes.ts). Add a DECLARED_ACCESSORS row with the reason this surface ` +
        `needs a person's name, in the same PR that adds the read — 019 T35(b).`
    );
    this.name = "UndeclaredAccessorError";
  }
}

/**
 * **The accessor context for an HTTP surface, built from the REQUEST rather than
 * from a literal** (the security lens's F3).
 *
 * At v1.0.0 both halves of the pair were a string the caller typed, which
 * inverts the comparison `authorization_decision` draws one table over: that
 * table takes `req.method` and `req.routeOptions.url` from the request the hook
 * already matched, so a row cannot claim to have come from a route it did not.
 * Here a route could have recorded any pair at all, and both of the audit's
 * findings could only ever have caught an author who declared HONESTLY.
 *
 * So the pair is now OBSERVED: `req.method` plus the template Fastify matched.
 * And the triple is checked here rather than at the audit — a surface citing a
 * purpose it was not declared for **fails the request** instead of writing a
 * plausible row for somebody to find later. That is the fail-closed direction
 * and it is the same one the auth hook takes for an undeclared tenant route.
 *
 * ⚠ **WHAT THIS DOES NOT FIX, STATED RATHER THAN IMPLIED.** The METHOD and the
 * PATH are now observed; the **PURPOSE is still a literal**, and it cannot be
 * observed — a route may legitimately cite more than one, and nothing in a
 * request says which read is about to happen. An author who declares
 * `session_display_name` in `DECLARED_ACCESSORS` and then writes a roster read
 * citing it produces a row that is internally consistent and wrong. What the
 * observation buys is that the pair cannot be INVENTED, which is the half the
 * lens reproduced; 000-docs/060 §4.4 carries the remainder as a residual.
 */
export function httpAccessor(
  observed: ObservedRoute,
  purpose: IdentityPurpose,
  shopId: string | null
): { method: string; path: string; purpose: IdentityPurpose; shopId: string | null } {
  const method = observed.method.toUpperCase();
  if (!isDeclaredAccess(method, observed.path, purpose)) {
    throw new UndeclaredAccessorError(method, observed.path, purpose);
  }
  return { method, path: observed.path, purpose, shopId };
}
