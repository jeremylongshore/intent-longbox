// L3: the rate posture (042 §8). Pure, with an injected clock, because a test
// that slept would be a test that flakes.
import { describe, expect, it } from "vitest";
import {
  PROVISIONAL_SERVICE_ACCOUNT_METERED_BUDGET,
  PROVISIONAL_SHOP_METERED_BUDGET,
  PROVISIONAL_SHOP_ORDINARY_RATE,
  ShopRateLimiter,
} from "../src/services/rateLimit.js";
import {
  DEFAULT_SPEND_CEILINGS,
  SPEND_CEILING_ENV,
  SpendCeilingError,
  assertSpendCeilingsOrThrow,
  spendCeilings,
} from "../src/config.js";

function clock(start = 1_000_000): { now: () => number; advance: (ms: number) => void } {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe("the provisional floors (042 A3 — safety floors, never measurements)", () => {
  it("keeps the two numbers 042 §8.4 derived, and keeps them non-evidentiary", () => {
    // §8.4's derivation, and the reason these are CEILINGS: compress 035's
    // largest batch (Pilot C, ≥300 items) into one four-hour session — roughly a
    // shop's whole month of back-issue time — and that is ≈13 requests/minute
    // for the entire shop at a load no pilot shop will produce. The floor is ≈9×
    // it. A shop cannot reach it by working; a loop reaches it in seconds.
    expect(PROVISIONAL_SHOP_ORDINARY_RATE).toBe(120);
    // Identify is one call per item, so this is >1.5× the ENTIRE Pilot C batch
    // in a single day.
    expect(PROVISIONAL_SHOP_METERED_BUDGET).toBe(500);
  });
});

describe("ShopRateLimiter", () => {
  it("keys on the shop and on nothing else (042 §8.1 — never per IP, never per device)", () => {
    const c = clock();
    const limiter = new ShopRateLimiter({ ordinaryPerMinute: 2, now: c.now });
    expect(limiter.takeOrdinary("shop-a").allowed).toBe(true);
    expect(limiter.takeOrdinary("shop-a").allowed).toBe(true);
    expect(limiter.takeOrdinary("shop-a").allowed).toBe(false);
    // A second shop is untouched: the tenant is the shop, and the bucket is the
    // shop. A per-IP bucket would throttle both of these together whenever they
    // sat behind one carrier.
    expect(limiter.takeOrdinary("shop-b").allowed).toBe(true);
  });

  it("answers a refusal with a Retry-After a client can act on", () => {
    const c = clock();
    const limiter = new ShopRateLimiter({ ordinaryPerMinute: 1, now: c.now });
    limiter.takeOrdinary("shop-a");
    c.advance(20_000);
    const refused = limiter.takeOrdinary("shop-a");
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSeconds).toBe(40);
  });

  it("opens a fresh window once the old one has elapsed", () => {
    const c = clock();
    const limiter = new ShopRateLimiter({ ordinaryPerMinute: 1, now: c.now });
    limiter.takeOrdinary("shop-a");
    expect(limiter.takeOrdinary("shop-a").allowed).toBe(false);
    c.advance(60_000);
    expect(limiter.takeOrdinary("shop-a").allowed).toBe(true);
  });

  it("meters identify on a DAY, separately from the ordinary minute", () => {
    const c = clock();
    const limiter = new ShopRateLimiter({ ordinaryPerMinute: 1, meteredPerDay: 1, now: c.now });
    expect(limiter.takeMetered("shop-a").allowed).toBe(true);
    expect(limiter.takeMetered("shop-a").allowed).toBe(false);
    c.advance(60_000);
    // A minute is not a day: the metered budget does not refill with the
    // ordinary window, because only one of the two classes costs money.
    expect(limiter.takeMetered("shop-a").allowed).toBe(false);
    c.advance(24 * 60 * 60 * 1000);
    expect(limiter.takeMetered("shop-a").allowed).toBe(true);
  });

  it("counts every throttle event from day one (§8.4's guard)", () => {
    const c = clock();
    const limiter = new ShopRateLimiter({ ordinaryPerMinute: 1, meteredPerDay: 1, now: c.now });
    expect(limiter.events).toEqual({ ordinaryThrottled: 0, meteredExhausted: 0 });
    limiter.takeOrdinary("shop-a");
    limiter.takeOrdinary("shop-a");
    limiter.takeMetered("shop-a");
    limiter.takeMetered("shop-a");
    // "A throttle that ever fires during normal pilot work is ITSELF A FINDING —
    // either the floor was miscalculated or something is wrong, and both are
    // worth a 006 row." A count nobody keeps cannot produce that finding.
    expect(limiter.events).toEqual({ ordinaryThrottled: 1, meteredExhausted: 1 });
  });

  it("defaults to the provisional floors when nothing is configured", () => {
    const limiter = new ShopRateLimiter();
    expect(limiter.ordinaryPerMinute).toBe(PROVISIONAL_SHOP_ORDINARY_RATE);
    expect(limiter.meteredPerDay).toBe(PROVISIONAL_SHOP_METERED_BUDGET);
    expect(limiter.serviceAccountPerDay).toBe(PROVISIONAL_SERVICE_ACCOUNT_METERED_BUDGET);
  });
});

// ---------------------------------------------------------------------------
// E03-B05 (050 §2 Q4(c), §6.4): the metered ceiling is PER OWNER.
// ---------------------------------------------------------------------------

describe("the service-account floor (050 §6.4)", () => {
  it("is a SEPARATE, LOWER number, and the derivation is a ceiling", () => {
    // 150 is six times Pilot A's entire 25-item batch (019:148) in a single day,
    // so it cannot bind on work and fires on a loop in minutes. It is lower than
    // the shop's own floor because the money in that loop is not the shop's.
    expect(PROVISIONAL_SERVICE_ACCOUNT_METERED_BUDGET).toBe(150);
    expect(PROVISIONAL_SERVICE_ACCOUNT_METERED_BUDGET).toBeLessThan(PROVISIONAL_SHOP_METERED_BUDGET);
  });

  it("selects the ceiling by owner without resetting the shop's counter", () => {
    const c = clock();
    const limiter = new ShopRateLimiter({ meteredPerDay: 3, serviceAccountPerDay: 1, now: c.now });
    expect(limiter.takeMetered("shop-a", "longbox").allowed).toBe(true);
    expect(limiter.takeMetered("shop-a", "longbox").allowed).toBe(false);
    // One unit is spent, so the `shop` ceiling of 3 leaves TWO — not three.
    expect(limiter.takeMetered("shop-a", "shop").allowed).toBe(true);
    expect(limiter.takeMetered("shop-a", "shop").allowed).toBe(true);
    expect(limiter.takeMetered("shop-a", "shop").allowed).toBe(false);
    // …and the window still rolls.
    c.advance(24 * 60 * 60 * 1000);
    expect(limiter.takeMetered("shop-a", "shop").allowed).toBe(true);
  });

  it("defaults the owner to `shop`, so an un-migrated caller cannot silently get the low floor", () => {
    const limiter = new ShopRateLimiter({ meteredPerDay: 2, serviceAccountPerDay: 1 });
    expect(limiter.takeMetered("shop-a").allowed).toBe(true);
    expect(limiter.takeMetered("shop-a").allowed).toBe(true);
    expect(limiter.takeMetered("shop-a").allowed).toBe(false);
  });
});

describe("assertSpendCeilingsOrThrow — the boot-time refusal (050 §2 Q4(c))", () => {
  const defaults = { shop: 500, longbox: 150 };

  it("accepts the defaults, and accepts any tightening", () => {
    expect(assertSpendCeilingsOrThrow({ ...defaults }, defaults)).toEqual(defaults);
    expect(() => assertSpendCeilingsOrThrow({ shop: 1, longbox: 1 }, defaults)).not.toThrow();
  });

  it("ACCEPTS ZERO, which a media ceiling does not — and the difference is which way each fails", () => {
    // A media ceiling of zero refuses every upload and breaks the pilot. A
    // metered budget of zero puts every identify call on the MANUAL PATH, which
    // is a route an operator already has (042 §8.3, 050 §2 Q4(d)) — a legitimate
    // operator act meaning "this deployment spends no model money today".
    expect(() => assertSpendCeilingsOrThrow({ shop: 0, longbox: 0 }, defaults)).not.toThrow();
  });

  it("REFUSES a value more than 4x the default — it does not clamp", () => {
    // The same choice `assertMediaPolicyOrThrow` makes: a silent clamp leaves an
    // operator believing a ceiling they set is the one in force. Refusing is
    // loud, is fixed in one edit, and cannot be missed in a log nobody reads.
    expect(() => assertSpendCeilingsOrThrow({ shop: 2001, longbox: 150 }, defaults)).toThrow(
      SpendCeilingError
    );
    expect(() => assertSpendCeilingsOrThrow({ shop: 500, longbox: 601 }, defaults)).toThrow(
      /LONGBOX_METERED_BUDGET_SERVICE_ACCOUNT/
    );
    // Exactly 4x is the boundary and is allowed.
    expect(() => assertSpendCeilingsOrThrow({ shop: 2000, longbox: 600 }, defaults)).not.toThrow();
  });

  it("REFUSES a negative, a fraction and a non-number", () => {
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => assertSpendCeilingsOrThrow({ shop: bad, longbox: 150 }, defaults)).toThrow(
        SpendCeilingError
      );
    }
  });

  it("names the env var the operator has to edit", () => {
    expect(SPEND_CEILING_ENV.shop).toBe("LONGBOX_METERED_BUDGET_SHOP");
    expect(SPEND_CEILING_ENV.longbox).toBe("LONGBOX_METERED_BUDGET_SERVICE_ACCOUNT");
    expect(() => assertSpendCeilingsOrThrow({ shop: -1, longbox: 150 }, defaults)).toThrow(
      /LONGBOX_METERED_BUDGET_SHOP/
    );
  });

  it("DEFAULT_SPEND_CEILINGS is the PROVISIONAL pair, read from one place", () => {
    expect(DEFAULT_SPEND_CEILINGS).toEqual({
      shop: PROVISIONAL_SHOP_METERED_BUDGET,
      longbox: PROVISIONAL_SERVICE_ACCOUNT_METERED_BUDGET,
    });
    // A config with no ceilings gets the safe pair rather than "no limit".
    expect(spendCeilings({})).toEqual(DEFAULT_SPEND_CEILINGS);
  });
});
