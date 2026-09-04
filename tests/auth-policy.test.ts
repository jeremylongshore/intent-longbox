// L3 unit: the decisions in 048 that are pure functions — the PIN's shape, the
// lockout's arithmetic, the cookie's attributes, the same-origin check, and the
// rotation and grace verdicts.
//
// Everything here runs without a database ON PURPOSE. 048 §11 names five
// concurrency invariants that need Postgres and cannot be proved anywhere else;
// these are not among them, and proving arithmetic against a cluster would make
// the cheap half as slow as the expensive half while testing the same thing.
import { describe, expect, it } from "vitest";
import {
  BACKOFF_BASE_MS,
  BACKOFF_CEILING_MS,
  DEVICE_COOKIE,
  DEVICE_FREE_ATTEMPTS,
  OPERATOR_COOKIE,
  PAIR_FREE_ATTEMPTS,
  PIN_LENGTH,
  ROTATION_GRACE_MS,
  clearCookie,
  isSameOriginRequest,
  lockoutWaitMs,
  pinRefusal,
  readCookie,
  requiredWaitMs,
  setCookie,
  shouldRotate,
  spentTokenVerdict,
  timingVerdict,
} from "../src/services/auth/policy.js";

const NOW = new Date("2026-09-04T12:00:00.000Z");

function timing(overrides: Partial<Record<string, Date>> = {}) {
  return {
    issuedAt: new Date(NOW.getTime() - 60_000),
    rotateAfter: new Date(NOW.getTime() + 60_000),
    idleExpiresAt: new Date(NOW.getTime() + 600_000),
    absoluteExpiresAt: new Date(NOW.getTime() + 3_600_000),
    ...overrides,
  };
}

describe("the PIN's shape (048 §3.5, R6)", () => {
  it("is six digits, and neither four nor a range", () => {
    expect(PIN_LENGTH).toBe(6);
    expect(pinRefusal("428713")).toBeUndefined();
    // A range in a decision record is a range an implementation resolves
    // DOWNWARD, and four digits against a lockout that never closes is two
    // orders of magnitude of guessing budget.
    expect(pinRefusal("4287")).toBe("not_six_digits");
    expect(pinRefusal("42871345")).toBe("not_six_digits");
    expect(pinRefusal("42871a")).toBe("not_six_digits");
    expect(pinRefusal("")).toBe("not_six_digits");
  });

  it("refuses the trivial set AT SET TIME, which is the only time it may be checked", () => {
    for (const trivial of ["123456", "654321", "111111", "000000", "121212"]) {
      expect(pinRefusal(trivial), trivial).toBe("trivial");
    }
    // Runs of any length, rather than a literal list that goes stale.
    expect(pinRefusal("345678")).toBe("trivial");
    expect(pinRefusal("987654")).toBe("trivial");
  });

  it("refuses the shop's own published digits, which anyone at the door can read", () => {
    expect(pinRefusal("428713", ["+1 (555) 428-713-9"])).toBe("shop_digits");
    expect(pinRefusal("428713", ["90210"])).toBeUndefined();
  });

  it("says nothing at VERIFY time, because a verify-time denylist leaks which PINs are impossible", () => {
    // The property is structural: `pinRefusal` is the SET-time function and the
    // verification path (`verifyOperatorPin`) never calls it. This asserts the
    // only half a unit test can — that the refusal is a value a caller decides
    // what to do with, not an exception that would surface at either site.
    expect(typeof pinRefusal("123456")).toBe("string");
    expect(pinRefusal("428713")).toBeUndefined();
  });
});

describe("lockout is a growing delay and never a door (048 §9.1, R5)", () => {
  it("charges nothing for the fat-fingered operator's first attempts", () => {
    for (let failures = 0; failures <= PAIR_FREE_ATTEMPTS; failures += 1) {
      expect(
        requiredWaitMs({ failures, lastFailureAgeMs: 0, freeAttempts: PAIR_FREE_ATTEMPTS }),
        `${String(failures)} failures`
      ).toBe(0);
    }
  });

  it("doubles per further failure and then CAPS — there is no terminal state", () => {
    const wait = (failures: number) =>
      requiredWaitMs({ failures, lastFailureAgeMs: 0, freeAttempts: PAIR_FREE_ATTEMPTS });
    expect(wait(PAIR_FREE_ATTEMPTS + 1)).toBe(BACKOFF_BASE_MS);
    expect(wait(PAIR_FREE_ATTEMPTS + 2)).toBe(BACKOFF_BASE_MS * 2);
    expect(wait(PAIR_FREE_ATTEMPTS + 3)).toBe(BACKOFF_BASE_MS * 4);
    // The case R5 exists for: after ANY number of failures the wait is finite
    // and bounded, so a correct PIN always eventually succeeds. A terminal lock
    // on a shared counter phone makes the security control's failure mode the
    // shop's revenue, and a control whose failure mode is revenue gets disabled.
    expect(wait(1_000)).toBe(BACKOFF_CEILING_MS);
    expect(wait(1_000_000)).toBe(BACKOFF_CEILING_MS);
  });

  it("counts the wait DOWN as real time passes", () => {
    const failures = PAIR_FREE_ATTEMPTS + 3;
    const full = requiredWaitMs({ failures, lastFailureAgeMs: 0, freeAttempts: PAIR_FREE_ATTEMPTS });
    expect(requiredWaitMs({ failures, lastFailureAgeMs: full / 2, freeAttempts: PAIR_FREE_ATTEMPTS })).toBe(
      full / 2
    );
    expect(requiredWaitMs({ failures, lastFailureAgeMs: full, freeAttempts: PAIR_FREE_ATTEMPTS })).toBe(0);
    expect(requiredWaitMs({ failures, lastFailureAgeMs: full * 10, freeAttempts: PAIR_FREE_ATTEMPTS })).toBe(
      0
    );
  });

  it("takes the LONGER of the per-pair delay and the per-device ceiling", () => {
    // The device class exists because the per-pair delay alone lets an attacker
    // holding the phone WALK THE ROSTER: six failures on each of eight display
    // names is eight fresh budgets.
    const rosterWalk = lockoutWaitMs({
      pairFailures: 1,
      pairLastFailureAgeMs: 0,
      deviceFailures: DEVICE_FREE_ATTEMPTS + 4,
      deviceLastFailureAgeMs: 0,
    });
    expect(rosterWalk).toBeGreaterThan(0);
    // And one person's own mistakes do not wait on the device budget.
    const ownMistakes = lockoutWaitMs({
      pairFailures: PAIR_FREE_ATTEMPTS + 1,
      pairLastFailureAgeMs: 0,
      deviceFailures: PAIR_FREE_ATTEMPTS + 1,
      deviceLastFailureAgeMs: 0,
    });
    expect(ownMistakes).toBe(BACKOFF_BASE_MS);
  });

  it("gives the device class a HIGHER free budget than the pair, or it would be the only class", () => {
    expect(DEVICE_FREE_ATTEMPTS).toBeGreaterThan(PAIR_FREE_ATTEMPTS);
  });
});

describe("the cookie (048 §3.6, I6(a))", () => {
  const expiry = new Date("2026-10-01T00:00:00.000Z");

  it("carries every attribute the record names, and no Domain", () => {
    for (const name of [DEVICE_COOKIE, OPERATOR_COOKIE]) {
      const header = setCookie(name, "tok", expiry);
      expect(header.startsWith(`${name}=tok;`)).toBe(true);
      expect(header).toContain("Path=/");
      expect(header).toContain("HttpOnly");
      expect(header).toContain("Secure");
      expect(header).toContain("SameSite=Strict");
      // `__Host-` is refused by the browser without Secure + Path=/ + NO Domain,
      // which is what makes the cookie unsettable by a sibling subdomain — the
      // estate serves many applications under one registrable domain.
      expect(header).not.toContain("Domain=");
      expect(name.startsWith("__Host-")).toBe(true);
    }
  });

  it("is SameSite=Strict and not Lax, because there is no cross-site entry flow to preserve", () => {
    expect(setCookie(DEVICE_COOKIE, "t", expiry)).not.toContain("SameSite=Lax");
  });

  it("clears with the same attributes, so the browser matches the cookie it is replacing", () => {
    const cleared = clearCookie(OPERATOR_COOKIE);
    expect(cleared).toContain("Max-Age=0");
    expect(cleared).toContain("Path=/");
    expect(cleared).toContain("HttpOnly");
    expect(cleared).toContain("SameSite=Strict");
  });

  it("reads one cookie out of a header carrying several", () => {
    const header = `other=x; ${DEVICE_COOKIE}=dev-token; ${OPERATOR_COOKIE}=op-token`;
    expect(readCookie(header, DEVICE_COOKIE)).toBe("dev-token");
    expect(readCookie(header, OPERATOR_COOKIE)).toBe("op-token");
    expect(readCookie(header, "__Host-absent")).toBeUndefined();
    expect(readCookie(undefined, DEVICE_COOKIE)).toBeUndefined();
    // An empty value is ABSENT, not a token: a cleared cookie the browser still
    // sends must not resolve to a session lookup on the empty string.
    expect(readCookie(`${DEVICE_COOKIE}=`, DEVICE_COOKIE)).toBeUndefined();
  });
});

describe("the same-origin check (048 §5.1, R9)", () => {
  const origins = ["https://longbox.example"];

  it("accepts same-origin and a top-level navigation, and refuses every cross-site value", () => {
    expect(isSameOriginRequest({ secFetchSite: "same-origin" }, origins)).toBe(true);
    // `none` is a user-initiated navigation with no initiator — typing the URL,
    // or a bookmark — which is not a cross-site request at all.
    expect(isSameOriginRequest({ secFetchSite: "none" }, origins)).toBe(true);
    for (const site of ["cross-site", "same-site"]) {
      expect(isSameOriginRequest({ secFetchSite: site }, origins), site).toBe(false);
    }
    // `same-site` is refused DELIBERATELY: a sibling subdomain under one
    // registrable domain is exactly the attacker §3.6 and §5 defend against.
  });

  it("falls back to the Origin allowlist only when the header is absent", () => {
    expect(isSameOriginRequest({ origin: "https://longbox.example" }, origins)).toBe(true);
    expect(isSameOriginRequest({ origin: "https://attacker.example" }, origins)).toBe(false);
    // An absent Origin on a non-safelisted method is a REFUSAL, so an empty
    // allowlist fails closed rather than open.
    expect(isSameOriginRequest({}, origins)).toBe(false);
    expect(isSameOriginRequest({ origin: "https://longbox.example" }, [])).toBe(false);
  });

  it("does not let a supplied Origin override a cross-site Sec-Fetch-Site", () => {
    expect(
      isSameOriginRequest({ secFetchSite: "cross-site", origin: "https://longbox.example" }, origins)
    ).toBe(false);
  });
});

describe("liveness timing and rotation (048 §3.3)", () => {
  it("is live inside both expiries and names WHICH expiry ended it", () => {
    expect(timingVerdict(timing(), NOW)).toBe("live");
    expect(timingVerdict(timing({ idleExpiresAt: new Date(NOW.getTime() - 1) }), NOW)).toBe("idle_expired");
    expect(timingVerdict(timing({ absoluteExpiresAt: new Date(NOW.getTime() - 1) }), NOW)).toBe(
      "absolutely_expired"
    );
  });

  it("prefers the ABSOLUTE verdict when both have passed", () => {
    const both = timing({
      idleExpiresAt: new Date(NOW.getTime() - 10),
      absoluteExpiresAt: new Date(NOW.getTime() - 1),
    });
    expect(timingVerdict(both, NOW)).toBe("absolutely_expired");
  });

  it("rotates only once the rotation period has passed", () => {
    expect(shouldRotate(timing(), NOW)).toBe(false);
    expect(shouldRotate(timing({ rotateAfter: new Date(NOW.getTime() - 1) }), NOW)).toBe(true);
    // 048 §3.3 point 4: rotation is bounded by the PERIOD, not by the request
    // rate — the whole reason it is rotation rather than a `last_seen_at` write.
    expect(shouldRotate(timing({ rotateAfter: NOW }), NOW)).toBe(true);
  });
});

describe("the rotation race's grace window (048 K2)", () => {
  const base = { sameDevice: true, sameUser: true, now: NOW };

  it("accepts the winner's successor inside the window, on the same bindings", () => {
    expect(
      spentTokenVerdict({ ...base, successorIssuedAt: new Date(NOW.getTime() - ROTATION_GRACE_MS / 2) })
    ).toBe("accept_successor");
    // If the loser treated its own token as reused, the control would
    // MANUFACTURE the outage it exists to prevent: a phone that double-taps
    // would sign itself out.
    expect(spentTokenVerdict({ ...base, successorIssuedAt: NOW })).toBe("accept_successor");
  });

  it("is reuse outside the window", () => {
    expect(
      spentTokenVerdict({ ...base, successorIssuedAt: new Date(NOW.getTime() - ROTATION_GRACE_MS - 1) })
    ).toBe("reuse");
  });

  it("is reuse on ANY binding mismatch, whatever the clock says", () => {
    const inside = new Date(NOW.getTime() - 1);
    expect(spentTokenVerdict({ ...base, sameDevice: false, successorIssuedAt: inside })).toBe("reuse");
    expect(spentTokenVerdict({ ...base, sameUser: false, successorIssuedAt: inside })).toBe("reuse");
  });

  it("is reuse when the successor is dated in the future — a clock nobody may trust", () => {
    expect(spentTokenVerdict({ ...base, successorIssuedAt: new Date(NOW.getTime() + 1_000) })).toBe("reuse");
  });
});
