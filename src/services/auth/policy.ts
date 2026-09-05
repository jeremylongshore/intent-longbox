// The decisions in 048 that are pure functions of their inputs: cookie shape,
// session lifetimes, the PIN's shape, the lockout's growing delay, the
// same-origin check, and the rotation/grace verdicts.
//
// They live in one file with no database handle so every one of them is tested
// without a cluster — 048 §11's five concurrency invariants need Postgres, and
// these do not, and mixing the two makes the cheap half as slow as the expensive
// half.
//
// ⚠ EVERY NUMBER HERE IS A PROVISIONAL FLOOR WITH ITS DERIVATION STATED, AND
// NONE OF THEM IS A MEASUREMENT (048 §0, 042 A3). 048 §3.3 point 4 puts it
// exactly: "a session lifetime is a circuit breaker, not a claim about how long
// being wrong is acceptable", and the record deliberately declines to quote an
// industry figure in its place, "because a borrowed number is a manufactured
// measurement wearing a citation". No artifact quotes any of these as a security
// property, at any class (021 B16). A floor may be RAISED freely; lowering one
// after seeing a result it would change needs a 006 row saying so (018 C3).

/** 048 §3.6 — one cookie per principal, both `__Host-` prefixed. */
export const DEVICE_COOKIE = "__Host-lb_device";
export const OPERATOR_COOKIE = "__Host-lb_op";

/**
 * How long a device session may live at all, from first issuance.
 *
 * The derivation: a counter phone is enrolled once and worked for weeks (034
 * §2.8, 033 A13's "no re-login, no re-picking the box"), and the recovery from
 * an expired device session is not a PIN — it is an ENROLLMENT, which costs an
 * owner in a privileged session and a walk to the back room (048 §3.6). So the
 * absolute ceiling is set where re-enrolling is an occasional chore rather than
 * a weekly one, and the control that actually bounds a stolen device cookie is
 * revocation (one row, 048 §7.3), not this number.
 */
export const DEVICE_ABSOLUTE_MS = 30 * 24 * 60 * 60 * 1000;
/** A phone unused for this long stops working without anyone doing anything. */
export const DEVICE_IDLE_MS = 14 * 24 * 60 * 60 * 1000;
/** A device session older than this re-issues on its next request (048 §3.3). */
export const DEVICE_ROTATE_MS = 24 * 60 * 60 * 1000;

/**
 * The operator session's idle window — the gap between two customers.
 *
 * This is the number 048 §3.3 point 3 (R4) makes load-bearing: **idle expiry is
 * the control against a copied cookie**, and the reuse detector is a second,
 * later signal that the theft happened rather than a barrier that stops it. So
 * it is short enough that a lifted `__Host-lb_op` is worth something only within
 * one till queue, and long enough that the operator is not re-entering a PIN
 * between two books of the same box (022 P2: an override must be cheap).
 */
export const OPERATOR_IDLE_MS = 30 * 60 * 1000;
/** A shift's worth. Beyond it the person re-enters a PIN whatever they were doing. */
export const OPERATOR_ABSOLUTE_MS = 12 * 60 * 60 * 1000;
/** 048 §3.3 point 4: rotations must be RARE relative to requests. */
export const OPERATOR_ROTATE_MS = 10 * 60 * 1000;

/**
 * 048 §3.3 (K2) — the rotation race's grace window.
 *
 * Two requests from one client can both read the same live session and both
 * attempt to rotate it. `UNIQUE (rotated_from)` makes exactly one win; if the
 * LOSER treated its own token as reused, the security control would manufacture
 * the outage it exists to prevent — a phone that double-taps signs itself out.
 * The window is short enough that a stolen cookie cannot ride a legitimate
 * rotation and long enough to cover a double-tap and one network retry.
 */
export const ROTATION_GRACE_MS = 10 * 1000;

// ---------------------------------------------------------------------------
// 048 §3.5 (R6) — the PIN's shape.
// ---------------------------------------------------------------------------

/**
 * **Six digits. Not four, and not a range** (048 §3.5, R6). A range in a
 * decision record is a range an implementation resolves downward, and the
 * difference between four digits and six is two orders of magnitude of guessing
 * budget against a lockout whose whole design is that it degrades to DELAY
 * rather than closing a door — so the budget is never zero and the digit count
 * is doing real work.
 */
export const PIN_LENGTH = 6;

/**
 * Refused at SET time and never at verify time (048 §3.5): a verify-time check
 * leaks which PINs are impossible.
 *
 * Sequences, repeats and the standard leaked-PIN head. The shop's own postcode
 * and phone digits are refused too — they are passed in by the caller, because
 * this function knows nothing about a shop and should not learn.
 */
const TRIVIAL_PINS = new Set([
  "123456",
  "654321",
  "012345",
  "543210",
  "111111",
  "222222",
  "333333",
  "444444",
  "555555",
  "666666",
  "777777",
  "888888",
  "999999",
  "000000",
  "121212",
  "112233",
  "123123",
  "696969",
  "159753",
  "147258",
]);

export type PinRefusal = "not_six_digits" | "trivial" | "shop_digits";

/**
 * Whether a proposed PIN may be stored. `undefined` means acceptable.
 *
 * `shopDigits` is every digit string the shop itself publishes — its postcode,
 * its phone number — which a colleague, a customer or a passer-by can read off
 * the door. Supplying them is the caller's job precisely so this module has no
 * opinion about where a shop's digits live.
 */
export function pinRefusal(pin: string, shopDigits: readonly string[] = []): PinRefusal | undefined {
  if (!new RegExp(`^\\d{${PIN_LENGTH}}$`).test(pin)) return "not_six_digits";
  if (TRIVIAL_PINS.has(pin)) return "trivial";
  if (shopDigits.some((d) => d.replace(/\D/g, "").includes(pin))) return "shop_digits";
  // An ascending or descending run of any length is the same class as the two
  // literals above, and enumerating them would be a list that goes stale.
  const digits = [...pin].map(Number);
  const step = digits[1]! - digits[0]!;
  if ((step === 1 || step === -1) && digits.every((d, i) => i === 0 || d - digits[i - 1]! === step)) {
    return "trivial";
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// 048 §9.1 (R5) — lockout is a growing DELAY and never a terminal lock.
// ---------------------------------------------------------------------------

/**
 * The failure window the count is taken over. 048 §9.1 declares reading `now()`
 * here as **the third sanctioned exception** under 041 §2.6 (after 040 §3.4's
 * `abandoned` predicate and 041 §5.3's `session_seq`): "how many times has this
 * pair failed in the last interval" is a statement about NOW in exactly
 * `abandoned`'s sense — not replayable, and not meant to be.
 */
export const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;

/** Failures a pair may make before any wait at all — the fat-fingered operator. */
export const PAIR_FREE_ATTEMPTS = 3;
/** The per-`device_id` ceiling above the per-pair one (048 §9.1). */
export const DEVICE_FREE_ATTEMPTS = 10;

/** The first imposed wait, doubling per further failure. */
export const BACKOFF_BASE_MS = 2_000;
/**
 * The cap. **There is no state from which a correct PIN is refused; there is
 * only a state in which it is refused UNTIL** (048 §9.1, R5). A terminal lock on
 * a shared counter phone means the security control's failure mode is the shop's
 * revenue, and a control whose failure mode is revenue is a control that gets
 * disabled.
 */
export const BACKOFF_CEILING_MS = 5 * 60 * 1000;

/**
 * The wait a pair (or a device) must serve, given how many failures it has made
 * inside the window and when the most recent one was.
 *
 * Returns milliseconds still to wait — `0` means "verify now". Pure, so the
 * write-skew case (N concurrent attempts consuming N budget, not one) is proved
 * against a real database in `tests/integration/operator-pin.test.ts` and the
 * ARITHMETIC is proved here.
 */
export function requiredWaitMs(args: {
  failures: number;
  lastFailureAgeMs: number;
  freeAttempts: number;
}): number {
  const over = args.failures - args.freeAttempts;
  if (over <= 0) return 0;
  const delay = Math.min(BACKOFF_BASE_MS * 2 ** (over - 1), BACKOFF_CEILING_MS);
  return Math.max(0, delay - args.lastFailureAgeMs);
}

/**
 * The two classes, applied together: the per-pair delay and the per-device
 * ceiling, whichever is longer.
 *
 * The device class exists because the per-pair delay alone lets an attacker
 * holding the phone WALK THE ROSTER — six failures on each of eight display
 * names is eight fresh budgets (048 §9.1). The DoS trade is stated rather than
 * buried: a coworker can slow another operator down by mistyping their PIN, and
 * the device ceiling means a coworker can slow the whole phone down. That is
 * accepted, and it is why neither class CLOSES: the worst outcome available to a
 * griefer is a wait, not a shift-ending lock.
 */
export function lockoutWaitMs(args: {
  pairFailures: number;
  pairLastFailureAgeMs: number;
  deviceFailures: number;
  deviceLastFailureAgeMs: number;
}): number {
  return Math.max(
    requiredWaitMs({
      failures: args.pairFailures,
      lastFailureAgeMs: args.pairLastFailureAgeMs,
      freeAttempts: PAIR_FREE_ATTEMPTS,
    }),
    requiredWaitMs({
      failures: args.deviceFailures,
      lastFailureAgeMs: args.deviceLastFailureAgeMs,
      freeAttempts: DEVICE_FREE_ATTEMPTS,
    })
  );
}

// ---------------------------------------------------------------------------
// 048 §7 — the two redemption codes: how long they live, how many a shop may
// have outstanding, and how many times a shop may guess (E03-D07).
//
// **Every number below is a PROVISIONAL floor** (042 A3, 021 B16), set at build
// time and recorded rather than measured. None of them may be quoted as a
// security property, a capacity, a throughput or a reliability figure in any
// artifact at any class. What they are is the smallest set of bounds that makes
// 048 §7.1a's permission for a short invitation code true rather than asserted.
// ---------------------------------------------------------------------------

/**
 * How long an invitation is redeemable. A day, because 048 §7.2's delivery is
 * "the owner hands it to the employee in person" and the realistic gap is a
 * shift — the employee who is invited at closing time redeems it when they next
 * come in. Longer would leave a short code live over a weekend; much shorter
 * would push an owner to re-issue, and a flow that trains people to re-issue is
 * a flow with more live codes in it, not fewer.
 */
export const INVITATION_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * How long an enrollment code is redeemable. 048 §7.3 says **short-lived** in
 * those words, and the flow it describes is an owner reading a code off their
 * own screen to a phone standing next to them — which takes a minute, not a day.
 */
export const ENROLLMENT_TTL_MS = 15 * 60 * 1000;

/**
 * 048 §7.1a's "per-shop ceiling on OUTSTANDING codes", for each kind.
 *
 * It bounds the thing the expiry alone does not: a shop with a hundred live
 * invitations has a hundred simultaneous chances for a 40-bit code to be guessed,
 * so the effective keyspace of the short code shrinks by the number outstanding.
 * The ceiling is what keeps that divisor small enough for the length in
 * `codes.ts` to be the number it claims to be.
 *
 * Counted over UNEXPIRED, UNREDEEMED rows — both halves are predicates, because
 * neither table has a status column (`migrations/024`).
 */
export const MAX_OUTSTANDING_INVITATIONS_PER_SHOP = 10;
/** Fewer, because a shop enrolls a phone far less often than it hires a person. */
export const MAX_OUTSTANDING_ENROLLMENT_CODES_PER_SHOP = 5;

/**
 * 048 §7.1a's "per-shop ceiling on REDEMPTION ATTEMPTS", as the same shape §9.1
 * gives the PIN: a delay that grows with recent failures and NEVER closes.
 *
 * The key is **the shop the token names**, which is 048 R14's table verbatim —
 * never an IP (042 §8.1: one shop is one IP) and never a person (§9.1: "never a
 * global lock a stranger can trigger against a named person"). A wrong code
 * names no person at all, so there is nobody for it to be keyed on but the shop
 * whose door it is being tried on.
 *
 * **It never closes, for 048 R5's reason applied one flow over.** A terminal
 * lock here means an owner mid-onboarding, with a new employee standing at the
 * counter, cannot finish — so the control's failure mode is the shop's morning,
 * and a control whose failure mode is the shop's morning is a control that gets
 * disabled. The DoS trade is the same one §9.1 accepts and is smaller: the worst
 * a griefer achieves is that one shop's invitations are slow for a few minutes.
 *
 * The window is `LOCKOUT_WINDOW_MS`, deliberately shared rather than a fourth
 * number nobody has measured.
 */
export const SHOP_REDEMPTION_FREE_ATTEMPTS = 5;

/** The wait a shop must serve before another redemption is looked at. */
export function redemptionWaitMs(args: { failures: number; lastFailureAgeMs: number }): number {
  return requiredWaitMs({ ...args, freeAttempts: SHOP_REDEMPTION_FREE_ATTEMPTS });
}

// ---------------------------------------------------------------------------
// 048 §4.3, §8.1, §9.1 — the SECOND FACTOR's budget (E03-D06).
// ---------------------------------------------------------------------------

/**
 * Failures a PERSON may make on their second factor before any wait at all.
 *
 * Keyed on `app_user_id` alone — 048 §9.1's own key "for a password" — and shared
 * between TOTP and recovery codes, because they are two forms of one factor and
 * two budgets would be one budget an attacker doubles by alternating.
 *
 * Three rather than the PIN's three-for-a-fat-fingered-operator: a six-digit TOTP
 * code is read off a screen rather than remembered, so the honest-mistake rate is
 * lower, and the population is `owner` / `manager` / `support_break_glass` rather
 * than a queue at a till. **A PROVISIONAL floor** (042 A3), never quoted as a
 * security property.
 *
 * **It never closes**, for 048 R5's reason: there is no state from which a correct
 * code is refused, only a state in which it is refused *until*. A terminal lock on
 * an owner's second factor is an outage whose only exit is 048 §8.2's break-glass
 * runbook — a control whose failure mode is a support incident.
 */
export const SECOND_FACTOR_FREE_ATTEMPTS = 3;

/** The wait a person must serve before another second-factor attempt is looked at. */
export function secondFactorWaitMs(args: { failures: number; lastFailureAgeMs: number }): number {
  return requiredWaitMs({ ...args, freeAttempts: SECOND_FACTOR_FREE_ATTEMPTS });
}

// ---------------------------------------------------------------------------
// 048 §3.6 — the cookie, as a string this module owns end to end.
// ---------------------------------------------------------------------------

/**
 * `HttpOnly; Secure; SameSite=Strict; Path=/`, no `Domain`, nothing in it but
 * the token.
 *
 * The `__Host-` prefix is not decoration: a browser refuses the cookie unless it
 * is `Secure`, has `Path=/` and has NO `Domain`, which makes it unsettable by a
 * sibling subdomain — and the estate serves many applications under one
 * registrable domain behind one Caddy (048 §3.6, and §5's ops hand-off to E13).
 *
 * `SameSite=Strict`, not `Lax`: `Lax` exists to preserve top-level cross-site
 * NAVIGATION into a signed-in state, and there is no cross-site entry flow here
 * to preserve.
 *
 * No `Max-Age` beyond the session's own expiry — the cookie and the row expire
 * together, and a cookie that outlives its row is a token the server will refuse
 * while the browser still sends it.
 */
export function setCookie(name: string, token: string, expiresAt: Date): string {
  return (
    `${name}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; ` + `Expires=${expiresAt.toUTCString()}`
  );
}

/** Clearing one is the same cookie with an expiry in the past and no value. */
export function clearCookie(name: string): string {
  return `${name}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

/**
 * Read one cookie out of a `Cookie` header.
 *
 * Written here rather than taken from `@fastify/cookie` on purpose: the only
 * cookies this application has are two opaque tokens it mints itself, and a
 * signing/parsing plugin would add a dependency whose configuration surface
 * (signed cookies, `secret`, `parseOptions`) is larger than the feature. 048 §0
 * records that `package.json` has six runtime dependencies and no cookie
 * machinery; this keeps that true.
 */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    const value = part.slice(eq + 1).trim();
    return value.length > 0 ? value : undefined;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// 048 §5 (R9) — the CSRF mechanism this record owns outright.
// ---------------------------------------------------------------------------

/**
 * Whether a mutating request is same-origin.
 *
 * `Sec-Fetch-Site` is set by the browser and is unsettable by page script, and —
 * unlike a synchronizer token — **it cannot be quietly not-compared**, because
 * the comparison IS the hook and the hook is the thing without which no route
 * resolves a tenant. Where the header is absent (an older browser, a non-browser
 * client) the fallback is an `Origin` allowlist against the configured public
 * origin, and an absent `Origin` on a non-safelisted method is a refusal.
 *
 * `same-origin` and `none` both pass: `none` is a user-initiated navigation with
 * no initiator — typing the URL, or a bookmark — which is not a cross-site
 * request at all.
 */
export function isSameOriginRequest(
  headers: { secFetchSite?: string | undefined; origin?: string | undefined },
  allowedOrigins: readonly string[]
): boolean {
  const site = headers.secFetchSite;
  if (site !== undefined) return site === "same-origin" || site === "none";
  const origin = headers.origin;
  if (origin === undefined) return false;
  return allowedOrigins.includes(origin);
}

// ---------------------------------------------------------------------------
// 048 §3.3 — the rotation and grace verdicts, as pure decisions.
// ---------------------------------------------------------------------------

/** The timestamps a liveness/rotation decision reads off a session row. */
export interface SessionTiming {
  issuedAt: Date;
  rotateAfter: Date;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
}

export type LivenessVerdict = "live" | "idle_expired" | "absolutely_expired";

/** The two timestamp comparisons of 048 §3.3's predicate. The row half is SQL. */
export function timingVerdict(t: SessionTiming, now: Date): LivenessVerdict {
  if (now >= t.absoluteExpiresAt) return "absolutely_expired";
  if (now >= t.idleExpiresAt) return "idle_expired";
  return "live";
}

/** Whether this request must re-issue the session (048 §3.3's idle mechanism). */
export function shouldRotate(t: SessionTiming, now: Date): boolean {
  return now >= t.rotateAfter;
}

export type SpentTokenVerdict = "accept_successor" | "reuse";

/**
 * 048 §3.3 (K2) — what the loser of a rotation race does.
 *
 * "The loser re-reads, finds the winner's successor, and accepts it — ONLY if
 * the successor is bound to the same `device_id` and the same `app_user_id`, and
 * only within a stated grace window measured from the successor's `issued_at`.
 * Outside that window, or on any binding mismatch, it is reuse and is treated as
 * reuse."
 *
 * **What "accepts it" can and cannot mean, stated because the record does not
 * say and an implementation has to.** The loser cannot be handed the winner's
 * TOKEN — the database stores `sha256(token)` and never the token (048 §3.2), so
 * the server does not have it either. What the loser does is: authenticate as
 * the successor ROW, do its work, and set NO cookie. That is correct rather than
 * a compromise, because both requests come from one client and the winner's
 * response already carried the new cookie.
 */
export function spentTokenVerdict(args: {
  successorIssuedAt: Date;
  sameDevice: boolean;
  sameUser: boolean;
  now: Date;
}): SpentTokenVerdict {
  if (!args.sameDevice || !args.sameUser) return "reuse";
  const age = args.now.getTime() - args.successorIssuedAt.getTime();
  return age >= 0 && age <= ROTATION_GRACE_MS ? "accept_successor" : "reuse";
}
