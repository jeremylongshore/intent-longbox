// L1/L2 unit — E03-B08's replay and ordering predicates, with no cluster and no
// network. Every rule below is a pure function of its inputs, which is what makes
// the decision arguable rather than only observable.
//
// Bead: longbox-e5b.3.8 (alias E03-B08). Docs: 000-docs/064 §4, §5, §7; 053 §6,
// §8; 043 §2.4; 019 T32.
import { describe, expect, it } from "vitest";
import {
  COMPLIANCE_TOPICS,
  CUSTOMER_BEARING_SCOPES,
  KNOWN_TOPICS,
  PRIVACY_REQUEST_FULFILMENT_WINDOW_DAYS,
  SHOPIFY_MAX_SCOPES,
  TOPIC_APP_UNINSTALLED,
  TOPIC_POLICY,
  WEBHOOK_CLOCK_SKEW_SECONDS,
  WEBHOOK_HEADERS_ARE_NOT_SIGNED,
  WEBHOOK_RECEIPT_WINDOW_SECONDS,
  checkSignedDomain,
  classifyDelivery,
  domainInSignedBody,
  grantCouldReachACustomer,
  isAutoFulfillableTopic,
  isComplianceTopic,
  parseTriggeredAt,
  retirementCutoff,
  topicPolicy,
  usableTriggeredAt,
} from "../src/services/connectors/shopify/policy.js";
import { decidePrivacyGuard } from "../src/consumers/privacyRequestReceived.js";
import { GUARD_REASON_CODES, REASON_CODES } from "../src/services/outbox.js";

const HOUR = 3600;
const now = new Date("2026-09-06T12:00:00.000Z");

describe("the per-topic ordering ruling (000-docs/064 §5)", () => {
  it("decides EVERY known topic, and decides nothing else", () => {
    // The two lists agree in BOTH directions, which is what stops a topic
    // gaining an effect without somebody deciding what a late copy of it means —
    // and stops a policy row surviving a topic that was removed.
    expect(TOPIC_POLICY.map((t) => t.topic).sort()).toEqual([...KNOWN_TOPICS].sort());
  });

  it("gives every row a stated reason a reader can attack", () => {
    for (const row of TOPIC_POLICY) {
      expect(row.because.length).toBeGreaterThan(80);
      expect(row.effect.length).toBeGreaterThan(20);
    }
  });

  it("classifies the uninstall as event-time bounded and the three privacy topics as commutative", () => {
    expect(topicPolicy(TOPIC_APP_UNINSTALLED)?.ordering).toBe("event_time_bounded");
    for (const topic of COMPLIANCE_TOPICS) {
      expect(topicPolicy(topic)?.ordering).toBe("commutative");
    }
  });

  it("assigns NOTHING to `sequenced`, and the member exists for E10-B08", () => {
    // A class with no member today is a name waiting for the topic that needs it
    // (publish/sale/return/refund reconciliation). Asserting the emptiness means
    // the first `sequenced` topic is a deliberate act, and its author meets 043
    // §3.2's `session_seq` idiom rather than inventing a second ordering.
    expect(TOPIC_POLICY.filter((t) => t.ordering === "sequenced")).toEqual([]);
  });
});

describe("classifyDelivery — staleness first, then the body key (064 §4.3)", () => {
  it("accepts a fresh message nobody has sent before", () => {
    expect(
      classifyDelivery({
        now,
        triggeredAt: new Date(now.getTime() - 60_000),
        priorBodySeenAt: undefined,
        windowSeconds: HOUR,
      })
    ).toEqual({ disposition: "accepted", runEffects: true });
  });

  it("refuses a message older than the window, and runs no effect", () => {
    const verdict = classifyDelivery({
      now,
      triggeredAt: new Date(now.getTime() - (HOUR + 1) * 1000),
      priorBodySeenAt: undefined,
      windowSeconds: HOUR,
    });
    expect(verdict.disposition).toBe("stale");
    expect(verdict.runEffects).toBe(false);
  });

  it("accepts a message EXACTLY at the window edge", () => {
    // The boundary is stated rather than left to a reader of the `>`.
    expect(
      classifyDelivery({
        now,
        triggeredAt: new Date(now.getTime() - HOUR * 1000),
        priorBodySeenAt: undefined,
        windowSeconds: HOUR,
      }).disposition
    ).toBe("accepted");
  });

  it("refuses a repeat of bytes seen INSIDE the window", () => {
    expect(
      classifyDelivery({
        now,
        triggeredAt: undefined,
        priorBodySeenAt: new Date(now.getTime() - 60_000),
        windowSeconds: HOUR,
      })
    ).toEqual({ disposition: "replayed_body", runEffects: false });
  });

  it("ACCEPTS a repeat of bytes last seen OUTSIDE the window", () => {
    // Two byte-identical messages years apart are two events. Collapsing them
    // absolutely would make a second genuine `customers/redact` disappear, which
    // is a worse failure than recording a replay twice.
    expect(
      classifyDelivery({
        now,
        triggeredAt: undefined,
        priorBodySeenAt: new Date(now.getTime() - (HOUR + 1) * 1000),
        windowSeconds: HOUR,
      }).disposition
    ).toBe("accepted");
  });

  it("prefers `stale` when a message is both late AND a repeat", () => {
    // The order is deliberate: *something is delivering very late* is the fact a
    // human reading the receipt table needs; *we have seen these bytes* is a fact
    // this system already holds.
    expect(
      classifyDelivery({
        now,
        triggeredAt: new Date(now.getTime() - (HOUR + 1) * 1000),
        priorBodySeenAt: new Date(now.getTime() - 60_000),
        windowSeconds: HOUR,
      }).disposition
    ).toBe("stale");
  });

  it("accepts a message with NO stated event time", () => {
    // A header this system could not read must never turn a `customers/redact`
    // into a message nobody recorded.
    expect(parseTriggeredAt(undefined)).toBeUndefined();
    expect(parseTriggeredAt("not a date")).toBeUndefined();
    expect(parseTriggeredAt("")).toBeUndefined();
    expect(
      classifyDelivery({ now, triggeredAt: undefined, priorBodySeenAt: undefined, windowSeconds: HOUR })
        .disposition
    ).toBe("accepted");
  });
});

// ── F1 (security lens, CRITICAL): the store comes from the SIGNED BYTES ─────
describe("checkSignedDomain — the header selects nothing on its own (064 §4.0)", () => {
  const uninstall = (domain: string) => Buffer.from(JSON.stringify({ id: 1, myshopify_domain: domain }));
  const redact = (domain: string) => Buffer.from(JSON.stringify({ shop_domain: domain, customer: {} }));

  it("reads the store out of each topic's own payload field", () => {
    expect(domainInSignedBody(uninstall("a.myshopify.com"), TOPIC_APP_UNINSTALLED)).toBe("a.myshopify.com");
    expect(domainInSignedBody(redact("b.myshopify.com"), "customers/redact")).toBe("b.myshopify.com");
    expect(domainInSignedBody(redact("c.myshopify.com"), "shop/redact")).toBe("c.myshopify.com");
  });

  it("AGREES when the header matches the body, case-insensitively", () => {
    expect(
      checkSignedDomain(uninstall("victim.myshopify.com"), TOPIC_APP_UNINSTALLED, "victim.myshopify.com")
    ).toBe("agrees");
    expect(
      checkSignedDomain(uninstall("victim.myshopify.com"), TOPIC_APP_UNINSTALLED, "VICTIM.myshopify.com")
    ).toBe("agrees");
  });

  it("MISMATCHES when a captured message is re-addressed at another tenant", () => {
    // THE ATTACK, and it is why the security lens's first verdict was REJECT: one
    // captured signed message from ANY store — including the isolated dev store
    // this bead names as its own closing evidence — retired an unrelated shop's
    // live token and wrote a forged privacy obligation under that shop's tenant,
    // simply by changing a header the HMAC does not cover.
    expect(
      checkSignedDomain(
        uninstall("attackercapture.myshopify.com"),
        TOPIC_APP_UNINSTALLED,
        "victim.myshopify.com"
      )
    ).toBe("mismatch");
    expect(
      checkSignedDomain(redact("attackercapture.myshopify.com"), "customers/redact", "victim.myshopify.com")
    ).toBe("mismatch");
  });

  it("answers UNKNOWN — never `agrees` — for a shape this build cannot read", () => {
    // A wrong guess about a third party's payload (064 §0 A4) must fail CLOSED.
    // `unknown` records the message and refuses the DESTRUCTIVE effect; it must
    // never be able to pass as agreement.
    expect(checkSignedDomain(Buffer.from("not json"), TOPIC_APP_UNINSTALLED, "a.myshopify.com")).toBe(
      "unknown"
    );
    expect(checkSignedDomain(Buffer.from("[]"), TOPIC_APP_UNINSTALLED, "a.myshopify.com")).toBe("unknown");
    expect(checkSignedDomain(Buffer.from("{}"), TOPIC_APP_UNINSTALLED, "a.myshopify.com")).toBe("unknown");
    // A topic with no declared field — an unknown topic — is `unknown` too, and
    // an unknown topic has no effect to protect.
    expect(checkSignedDomain(redact("a.myshopify.com"), "orders/create", "a.myshopify.com")).toBe("unknown");
    // A non-string field is not a domain.
    expect(
      checkSignedDomain(
        Buffer.from(JSON.stringify({ myshopify_domain: 7 })),
        TOPIC_APP_UNINSTALLED,
        "a.myshopify.com"
      )
    ).toBe("unknown");
  });
});

describe("retirementCutoff — the uninstall's reach (064 §5)", () => {
  it("is UNBOUNDED when the provider stated no event time", () => {
    // The conservative direction under a missing header: retire everything. A
    // shop that must re-install has a remedy; a token this system believes is
    // live after Shopify killed it is a credential nobody manages.
    expect(retirementCutoff(undefined)).toBeUndefined();
  });

  it("adds the guard band, so cross-clock skew errs toward retiring one too many", () => {
    const at = new Date("2026-09-06T11:00:00.000Z");
    const laterNow = new Date(at.getTime() + 3600_000);
    const cutoff = retirementCutoff(at, WEBHOOK_CLOCK_SKEW_SECONDS, laterNow)!;
    expect(cutoff.getTime() - at.getTime()).toBe(WEBHOOK_CLOCK_SKEW_SECONDS * 1000);
  });

  // ── F2 (security lens, HIGH): the future direction ────────────────────────
  it("F2: a FUTURE stated time is treated as ABSENT and never widens the reach", () => {
    // The probe: `X-Shopify-Triggered-At: 2030-…` on a captured uninstall. The
    // only staleness test was `now - triggeredAt > window`, which is never true
    // for a future value, so the message was accepted AND the cutoff was pushed
    // to 2030 — retiring every version this shop would ever have, which disables
    // Decision B for exactly the adversary it was written against.
    const now = new Date("2026-09-06T12:00:00.000Z");
    const far = new Date("2030-01-01T00:00:00.000Z");
    expect(usableTriggeredAt(far, now)).toBeUndefined();
    expect(retirementCutoff(far, WEBHOOK_CLOCK_SKEW_SECONDS, now)).toBeUndefined();
    // Inside the band a future-ish value is usable — clocks are not perfect — but
    // the cutoff is still CLAMPED at `now`: the band absorbs skew and never
    // extends an event's authority past the moment it is acted on.
    const slightlyAhead = new Date(now.getTime() + 60_000);
    expect(usableTriggeredAt(slightlyAhead, now)).toEqual(slightlyAhead);
    expect(retirementCutoff(slightlyAhead, WEBHOOK_CLOCK_SKEW_SECONDS, now)!.getTime()).toBe(now.getTime());
  });

  it("F2: a future stated time does not make a delivery stale either — it is simply not used", () => {
    const now = new Date("2026-09-06T12:00:00.000Z");
    expect(
      classifyDelivery({
        now,
        triggeredAt: new Date("2030-01-01T00:00:00.000Z"),
        priorBodySeenAt: undefined,
        windowSeconds: HOUR,
      }).disposition
    ).toBe("accepted");
  });
});

// ── F3 (security lens, HIGH) + the invariant review's finding 1 ─────────────
describe("replayLookback — the window is a clock the attacker can outwait (064 §5.3)", () => {
  const now = new Date("2026-09-06T12:00:00.000Z");
  const longAgo = new Date(now.getTime() - (HOUR + 1) * 1000);

  it("declares `absolute` for app/uninstalled and `window` for the three commutative topics", () => {
    expect(topicPolicy(TOPIC_APP_UNINSTALLED)?.replayLookback).toBe("absolute");
    for (const topic of COMPLIANCE_TOPICS) {
      expect(topicPolicy(topic)?.replayLookback).toBe("window");
    }
  });

  it("F3: an ABSOLUTE lookback refuses the same bytes however long the attacker waits", () => {
    // The probe, and it restores §5.1's own counter-example: uninstall accepted →
    // merchant re-installs → wait past the window → replay the same bytes under a
    // fresh id with `triggered_at = now` → the re-installed token dies. The
    // disambiguator is §5.1's own sentence: two byte-identical uninstall payloads
    // are the same uninstall.
    expect(
      classifyDelivery({
        now,
        triggeredAt: now,
        priorBodySeenAt: longAgo,
        windowSeconds: HOUR,
        lookback: "absolute",
      }).disposition
    ).toBe("replayed_body");
  });

  it("keeps `window` behaviour for a request, where two identical bodies are two obligations", () => {
    expect(
      classifyDelivery({
        now,
        triggeredAt: now,
        priorBodySeenAt: longAgo,
        windowSeconds: HOUR,
        lookback: "window",
      }).disposition
    ).toBe("accepted");
  });

  it("defaults to `window` for a topic nobody declared, which has no effect to protect", () => {
    expect(
      classifyDelivery({ now, triggeredAt: now, priorBodySeenAt: longAgo, windowSeconds: HOUR }).disposition
    ).toBe("accepted");
  });
});

describe("the privacy guard (064 §7)", () => {
  it("answers automatically only for the two CUSTOMER topics", () => {
    expect(isAutoFulfillableTopic("customers/data_request")).toBe(true);
    expect(isAutoFulfillableTopic("customers/redact")).toBe(true);
    // `shop/redact` asks for a deletion of data this system genuinely holds, on a
    // policy nobody has ratified yet (E03-B09).
    expect(isAutoFulfillableTopic("shop/redact")).toBe(false);
    expect(isComplianceTopic("shop/redact")).toBe(true);
    expect(isComplianceTopic(TOPIC_APP_UNINSTALLED)).toBe(false);
  });

  it("refuses when a recorded grant could have reached a customer", () => {
    expect(
      decidePrivacyGuard({
        topic: "customers/redact",
        grantedScopes: ["write_products"],
        grantsRecorded: 1,
      })
    ).toEqual({ fulfil: true });
    for (const scope of CUSTOMER_BEARING_SCOPES) {
      expect(
        decidePrivacyGuard({
          topic: "customers/redact",
          grantedScopes: ["write_products", scope],
          grantsRecorded: 1,
        })
      ).toEqual({ fulfil: false, reasonCode: "customer_scope_was_granted" });
    }
    // Case and whitespace are the provider's, not ours.
    expect(
      decidePrivacyGuard({
        topic: "customers/redact",
        grantedScopes: [" Read_Customers "],
        grantsRecorded: 1,
      }).fulfil
    ).toBe(false);
  });

  // ── F7 (security lens): the third negative case ──────────────────────────
  it("F4: REFUSES when the store has NO recorded grant at all, rather than answering vacuously", () => {
    // The finding, and it is the one that made a stated residual undetectable.
    // The check is *no recorded grant carries a customer scope*, and an EMPTY set
    // satisfies it — so a shop on the legacy static path (which is the PILOT) got
    // an automatic `no_data_held` from a check that examined nothing, and the row
    // was indistinguishable from one a real check produced. Unknown means do not
    // touch (043 A3).
    //
    // ⚠ R1 is **stated, with a defence-in-depth branch, unreachable from the
    // shipped producer since F-A** — never "self-enforcing" (064 §9 R1). A store
    // with no recorded grant now resolves to a NULL tenant and is never enqueued,
    // so this branch is reached in production by nothing; the integration case
    // that exercises it constructs the outbox row by hand.
    expect(decidePrivacyGuard({ topic: "customers/redact", grantedScopes: [], grantsRecorded: 0 })).toEqual({
      fulfil: false,
      reasonCode: "no_recorded_grant",
    });
    expect(
      decidePrivacyGuard({ topic: "customers/data_request", grantedScopes: [], grantsRecorded: 0 }).fulfil
    ).toBe(false);
    // …and a grant that exists and carries nothing customer-bearing still passes,
    // so the fix is a REFUSAL of the vacuous case and not of the whole path.
    expect(
      decidePrivacyGuard({ topic: "customers/redact", grantedScopes: [], grantsRecorded: 1 }).fulfil
    ).toBe(true);
  });

  it("B6: a non-auto-fulfillable topic gets its OWN non-guard reason, not a false one", () => {
    // The gate audit's B6. A job for `shop/redact` is a PRODUCER defect — nothing
    // enqueues one — and filing it as `customer_scope_was_granted` put a FALSE
    // SENTENCE in `outbox_dead_letter`, which 041 §8.2 forbids, and counted a
    // deployment defect as a control doing its job.
    const verdict = decidePrivacyGuard({ topic: "shop/redact", grantedScopes: [], grantsRecorded: 1 });
    expect(verdict).toEqual({ fulfil: false, reasonCode: "privacy_topic_not_auto_fulfillable" });
    // It is a REASON CODE but NOT a guard refusal: a guard refusal says a control
    // worked, and nothing was controlled here.
    expect(REASON_CODES).toContain("privacy_topic_not_auto_fulfillable");
    expect(GUARD_REASON_CODES).not.toContain("privacy_topic_not_auto_fulfillable");
    // …while F4's refusal IS a guard refusal, because the guard is what was missing.
    expect(GUARD_REASON_CODES).toContain("no_recorded_grant");
  });

  it("no customer-bearing scope is inside the declared maximum", () => {
    // This is the FIRST of the three grounds `no_data_held` stands on, pinned
    // where it can be read: the connector cannot ask for the authority that would
    // make the claim false. A scope outside the maximum refuses the install.
    for (const scope of CUSTOMER_BEARING_SCOPES) {
      expect(SHOPIFY_MAX_SCOPES).not.toContain(scope);
    }
    expect(grantCouldReachACustomer([...SHOPIFY_MAX_SCOPES])).toBe(false);
  });
});

describe("the PROVISIONAL floors (064 §4.1, §6)", () => {
  it("states the receipt window as the provider's own retry horizon", () => {
    expect(WEBHOOK_RECEIPT_WINDOW_SECONDS).toBe(48 * 60 * 60);
  });

  it("keeps the fulfilment window a number this repository chose", () => {
    // The value is asserted so a change is deliberate. It is NOT a legal
    // deadline: what is actually owed is E03-B09's and counsel's (E01-B06), and
    // this floor exists so that silence is detectable.
    expect(PRIVACY_REQUEST_FULFILMENT_WINDOW_DAYS).toBe(25);
  });

  it("records, in the code, that the headers are not covered by the signature", () => {
    expect(WEBHOOK_HEADERS_ARE_NOT_SIGNED).toBe(true);
  });
});
