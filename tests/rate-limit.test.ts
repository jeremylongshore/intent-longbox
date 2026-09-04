// L3: the rate posture (042 §8). Pure, with an injected clock, because a test
// that slept would be a test that flakes.
import { describe, expect, it } from "vitest";
import {
  PROVISIONAL_SHOP_METERED_BUDGET,
  PROVISIONAL_SHOP_ORDINARY_RATE,
  ShopRateLimiter,
} from "../src/services/rateLimit.js";

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
  });
});
