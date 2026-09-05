// The rate and abuse posture for v0 (042 §8), executed by E02-D08.
//
// PER SHOP, NEVER PER IP (§8.1), and the second reason is what makes it a
// decision rather than a default. It does not work: every operator in a shop is
// behind one counter's Wi-Fi (033 §5.1), so a per-IP bucket throttles the shop
// as a unit anyway while ALSO mistaking two shops behind one carrier for one
// shop. And it is a per-operator surface by the back door: a per-device bucket
// that fires is a record that THIS DEVICE exceeded a limit, and a device is one
// operator at a counter (034 §2.8). 019 T35 signs per-operator rendering at 0,
// NON-WAIVABLE. **A rate-limit dashboard is a speed dashboard with a different
// title.**
//
// TWO CLASSES, BECAUSE ONLY ONE OF THEM COSTS MONEY (§8.2). `POST …/identify`
// calls a paid provider; everything else is a database write.
//
// THE METERED CLASS FAILS CLOSED TO THE MANUAL PATH, NEVER TO AN ERROR (§8.3).
// 019 K4 is "the pipeline never blocks on a provider", and **a throttle we
// impose on ourselves is a provider outage we caused** — it would be incoherent
// to handle it worse than one we did not. So a shop that spends its metered
// budget gets the manual-search flow, which already exists and is already
// tested, and the ordinary class gets `429 RATE_LIMITED` with `Retry-After`.
//
// ⚠ EVERY NUMBER HERE IS A PROVISIONAL CIRCUIT-BREAKER FLOOR (042 A3), NOT A
// MEASUREMENT. 018 A3 caps claims of FACT; it says nothing about what may be
// CONFIGURED as a safety floor, and a system with no limit at all is not
// epistemically humble — it is unprotected, and it ships that way to a shop.
// These values are **explicitly NON-EVIDENTIARY**: they are never quoted as
// capacity, throughput or performance in any artifact at any class (021 B16),
// and they support no claim of fact whatsoever. A floor may be RAISED freely;
// LOWERING one after seeing a result it would change requires a 006 row saying
// so in those words (018 C3).

/**
 * PROVISIONAL 120 requests/min/shop.
 *
 * The derivation, stated so a reader can check that it is a CEILING and not an
 * estimate: take 035's largest batch (Pilot C's ≥300 items) and compress the
 * whole batch into one four-hour session — roughly a shop's entire month of
 * back-issue time (034 §4.6) spent at once — which is 75 items/hour. Each item
 * costs at most about ten mutating calls. That is ≈13 requests/minute for the
 * entire shop at a load no pilot shop will ever produce, and this floor is ≈9×
 * it. **A shop cannot reach it by working; a loop reaches it in seconds.**
 */
export const PROVISIONAL_SHOP_ORDINARY_RATE = 120;

/**
 * PROVISIONAL 500 paid identify calls/shop/day, for a shop spending ITS OWN
 * money. Identify is one call per item, so this is more than 1.5× the ENTIRE
 * Pilot C batch in a single day.
 */
export const PROVISIONAL_SHOP_METERED_BUDGET = 500;

/**
 * PROVISIONAL 150 paid identify calls/shop/day for a shop on the SERVICE
 * ACCOUNT — Longbox's own key (E03-B05, 050 §2 Q4(c), §6.4).
 *
 * WHY A SECOND, LOWER NUMBER AT ALL. Locked decision 2's "no global fallback for
 * a shop with a credential" closes the CONFUSION case; it does not close the
 * ABUSE case for a shop with none. A shop that can reach the service account can
 * spend an unbounded amount of somebody else's money by looping, which 042 §8.4
 * already recognised as a circuit-breaker case — and the money in that loop is
 * not the shop's.
 *
 * THE DERIVATION, so a reader can check it is a CEILING and not an estimate:
 * 150 is six times Pilot A's entire 25-item batch (`019:148`) in a single day.
 * **It cannot bind on work; it fires on a loop in minutes.**
 *
 * ⚠ NEITHER NUMBER IS A MEASUREMENT. Both are PROVISIONAL floors in 042 §8.4's
 * class, explicitly non-evidentiary, never quoted as capacity, cost, throughput
 * or reliability in any artifact at any class (021 B16). 018 C3's red line
 * applies unchanged: a floor may be RAISED freely; lowering one after seeing a
 * result it would change requires a `000-docs/006` row saying so in those words.
 * A throttle that fires during normal pilot work is itself a 006 finding.
 */
export const PROVISIONAL_SERVICE_ACCOUNT_METERED_BUDGET = 150;

/** Whose money a paid call spends (050 §2 Q4(a)). Two values, no `unknown`. */
/**
 * **The privileged sign-in's own budget, per submitted identifier per minute**
 * (E03-D11, 057 §4.5a; the security lens's F2 and F3/F4).
 *
 * ⚠ **IT IS A SEPARATE NUMBER BECAUSE IT DEFENDS A DIFFERENT THING, AND
 * INHERITING `ordinaryPerMinute` WAS THE BUG.** `PROVISIONAL_SHOP_ORDINARY_RATE`
 * is 120/min and is sized for a SHOP doing its work — a phone at a counter
 * moving through a box of books. `POST /api/v1/privileged-sessions` is an
 * anonymous, internet-facing route whose caller is a stranger with somebody's
 * email address, and 120 attempts a minute against one address is not a
 * circuit breaker, it is a comfortable guessing budget.
 *
 * **The number NARROWS the timing oracle and does not close it**, which is the
 * half a reader would otherwise miss — and the half an earlier version of this
 * comment got wrong. 048 §9.1 refuses to run argon2id while a person is inside
 * their lockout delay — correctly, because hashing on demand is a denial-of-
 * service surface the attacker paces — and the consequence measured on this
 * route is that a KNOWN address inside its delay answers in single-digit
 * milliseconds while an UNKNOWN one pays the decoy's full cost. That difference
 * is an enumeration oracle for *who works at which shop*.
 *
 * Lowering THIS bucket cuts the oracle's observation RATE from about 120/min to
 * about 5/min. **It does not equalise the two answers, because the two windows
 * do not match**: this bucket refills every MINUTE while `LOCKOUT_WINDOW_MS` is
 * FIFTEEN, so a warmed known address drops out of the bucket and back onto its
 * lockout roughly fourteen times an hour. Measured in minute two: a known
 * address answered 6-16 ms on four attempts of five; an unknown one paid about
 * 600 ms on all five.
 *
 * Closing the class would mean hashing while blocked, which 048 §9.3 REFUSES and
 * 057 does not reopen. So this is a narrowed residual with a row of its own
 * (057 §9 R10), not a defect that has been fixed. Do not restate it as one.
 *
 * **PROVISIONAL 5/min per identifier**, with its derivation stated and no
 * measurement behind it (042 A3): a person signing in mistypes a password once
 * or twice and re-reads a code off a phone once; five is above any honest
 * sequence and two orders of magnitude below a useful guessing rate. It is a
 * floor that may be RAISED freely; lowering it after seeing a result it would
 * change needs a 006 row (018 C3). **No artifact quotes it as a security
 * property.**
 */
export const PROVISIONAL_SIGN_IN_RATE_PER_IDENTIFIER = 5;

export type SpendOwner = "shop" | "longbox";

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface RateDecision {
  allowed: boolean;
  /** Only meaningful when refused; feeds `Retry-After` and `details`. */
  retryAfterSeconds: number;
}

interface Bucket {
  windowStart: number;
  count: number;
}

export interface RateLimiterOptions {
  ordinaryPerMinute?: number;
  /** The privileged sign-in's per-identifier budget (E03-D11). */
  signInPerMinute?: number;
  /** The `shop`-owned metered budget: a shop spending its own money. */
  meteredPerDay?: number;
  /** The `longbox`-owned metered budget: a shop on the service account. */
  serviceAccountPerDay?: number;
  /** Injected so the counting is unit-testable without sleeping. */
  now?: () => number;
}

/**
 * One bucket per shop per class, a counter, and a fallback. It is not
 * authentication, not abuse detection, not a WAF and not a quota product
 * (§8.5) — E03-B01's threat model owns the abuse surface, and what this gives it
 * is a boundary to reason about rather than the current state, which is nothing
 * at all (042 E21).
 */
export class ShopRateLimiter {
  private readonly ordinary = new Map<string, Bucket>();
  /** E03-D11: its own map, so the two adversaries cannot exhaust each other. */
  private readonly signIn = new Map<string, Bucket>();
  private readonly metered = new Map<string, Bucket>();
  private readonly now: () => number;
  readonly ordinaryPerMinute: number;
  readonly signInPerMinute: number;
  readonly meteredPerDay: number;
  readonly serviceAccountPerDay: number;

  /**
   * §8.4's guard: **every throttle event is counted from day one**, and a
   * throttle that ever fires during normal pilot work is itself a finding —
   * either the floor was miscalculated or something is wrong, and both are worth
   * a 006 row.
   */
  readonly events = { ordinaryThrottled: 0, meteredExhausted: 0 };

  constructor(opts: RateLimiterOptions = {}) {
    this.ordinaryPerMinute = opts.ordinaryPerMinute ?? PROVISIONAL_SHOP_ORDINARY_RATE;
    this.signInPerMinute = opts.signInPerMinute ?? PROVISIONAL_SIGN_IN_RATE_PER_IDENTIFIER;
    this.meteredPerDay = opts.meteredPerDay ?? PROVISIONAL_SHOP_METERED_BUDGET;
    this.serviceAccountPerDay = opts.serviceAccountPerDay ?? PROVISIONAL_SERVICE_ACCOUNT_METERED_BUDGET;
    this.now = opts.now ?? (() => Date.now());
  }

  private take(map: Map<string, Bucket>, shopId: string, limit: number, windowMs: number): RateDecision {
    const now = this.now();
    // A configured limit of zero REFUSES, including the first call of a window.
    // Without this the fresh-window branch below lets one request through per
    // window whatever the limit says, which would make a deliberately zeroed
    // budget (an operator disabling the metered class for a shop) silently
    // permit traffic.
    if (limit < 1) return { allowed: false, retryAfterSeconds: Math.ceil(windowMs / 1000) };
    const bucket = map.get(shopId);
    if (!bucket || now - bucket.windowStart >= windowMs) {
      map.set(shopId, { windowStart: now, count: 1 });
      return { allowed: true, retryAfterSeconds: 0 };
    }
    if (bucket.count < limit) {
      bucket.count += 1;
      return { allowed: true, retryAfterSeconds: 0 };
    }
    const remaining = windowMs - (now - bucket.windowStart);
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(remaining / 1000)) };
  }

  /** Every mutating route except the metered one, plus the reads that share the surface. */
  takeOrdinary(shopId: string): RateDecision {
    const decision = this.take(this.ordinary, shopId, this.ordinaryPerMinute, MINUTE_MS);
    if (!decision.allowed) this.events.ordinaryThrottled += 1;
    return decision;
  }

  /**
   * The DEVICE class (048 R14) — for the routes that have no session yet to be
   * keyed on, because they are how a caller acquires one.
   *
   * Keyed on `device_id`: the device is authenticated and the person is what is
   * being tested, so a stranger cannot exhaust a NAMED PERSON'S budget by
   * guessing at their PIN — which is 048 §9.1's "never a global lock a stranger
   * can trigger against a named person" arriving as a rate limit instead of as a
   * lockout. **This is not the per-operator surface 019 T35 forbids**: the key is
   * a phone, the counter is never rendered, never grouped and never exported, and
   * the class exists to bound cost while 048 §9.1's growing delay does the actual
   * credential-stuffing work.
   *
   * It reuses the ordinary floor rather than inventing a second number: an
   * authentication burst on one phone is not a different SHAPE of traffic from a
   * scan burst on the same phone, and a second provisional number would be a
   * second thing nobody has measured.
   */
  takeDevice(deviceId: string): RateDecision {
    const decision = this.take(this.ordinary, `device:${deviceId}`, this.ordinaryPerMinute, MINUTE_MS);
    if (!decision.allowed) this.events.ordinaryThrottled += 1;
    return decision;
  }

  /**
   * The bucket for a route that has NO principal to key on yet (E03-D09).
   *
   * `POST /api/v1/device-sessions` is anonymous by construction — the credential
   * in the body IS the authentication — so at `onRequest` there is no device, no
   * shop and no person. 042 §8.1 forbids an IP, and the alternative on the table
   * was no bucket at all: the invariant review found the route taking four
   * hundred anonymous POSTs, answering four hundred refusals and appending four
   * hundred `auth_attempt` rows without one throttle.
   *
   * So the key is the ROUTE ITSELF. It is coarse and it is deliberate: it bounds
   * the aggregate, and `openDeviceSession` takes a second bucket keyed on the
   * presented credential's DIGEST (048 R14) for the question this one cannot
   * answer — how many times this exact secret has been tried.
   *
   * **The trade is stated rather than discovered**: a flood can make device
   * enrollment unavailable estate-wide for a minute, on a route a shop touches
   * once per phone. That is the same shape 048 §9.1 accepts for the lockout —
   * the worst outcome available to a flooder is a wait — and it is strictly
   * better than the unmetered write path it replaces.
   */
  takeRoute(routeTemplate: string): RateDecision {
    const decision = this.take(this.ordinary, `route:${routeTemplate}`, this.ordinaryPerMinute, MINUTE_MS);
    if (!decision.allowed) this.events.ordinaryThrottled += 1;
    return decision;
  }

  /**
   * **The privileged sign-in, keyed on a DIGEST of the submitted identifier**
   * (E03-D11; 057 §4.5a).
   *
   * Never the address itself — a rate-limit key is held in a process and printed
   * in a log line the day somebody debugs it, and an address is a person. Never
   * an IP (042 §8.1, unchanged). Never the resolved `app_user_id` either, and
   * that is the point of keying on what was SUBMITTED: an unknown address and a
   * known one must be bucketed identically, or the bucket itself becomes the
   * oracle the bucket exists to close.
   *
   * **It is its own bucket map**, so a shop working hard at the counter cannot
   * exhaust the sign-in budget and a sign-in flood cannot exhaust the shop's.
   * They are different adversaries on different channels and 042 §8.1's
   * "per shop, never per IP" was written about the first one.
   */
  takeSignIn(identifierDigest: string): RateDecision {
    const decision = this.take(this.signIn, `sign-in:${identifierDigest}`, this.signInPerMinute, MINUTE_MS);
    if (!decision.allowed) this.events.ordinaryThrottled += 1;
    return decision;
  }

  /**
   * `POST …/identify`. A refusal here is NOT an error: the caller degrades to
   * the manual-search path, which is "not a failure; a different route to the
   * same rung" (040 §4.6).
   */
  takeMetered(shopId: string, owner: SpendOwner = "shop"): RateDecision {
    // ONE BUCKET PER SHOP, TWO POSSIBLE LIMITS (050 §2 Q4(c)). The key stays the
    // shop, not `owner:shop`, on purpose: a shop that gains a credential
    // mid-window must not get a fresh 500 calls on top of the 150 it already
    // spent of Longbox's money. The owner selects the CEILING; it never resets
    // the counter.
    const limit = owner === "shop" ? this.meteredPerDay : this.serviceAccountPerDay;
    const decision = this.take(this.metered, shopId, limit, DAY_MS);
    if (!decision.allowed) this.events.meteredExhausted += 1;
    return decision;
  }
}
