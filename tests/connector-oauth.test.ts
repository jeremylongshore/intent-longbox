// L3 unit: the connector's POLICY and its CUSTODY primitives — the rules that
// are pure functions of their inputs, tested without a cluster and without a
// network.
//
// Bead: longbox-e5b.3.6 (alias E03-B06). Docs: 000-docs/053 §3, §6, §7, §8;
// 046 §5 A13, §6.2 G-14; 019 T19 (auto-publish = 0, NON-WAIVABLE), T24; 050 §4
// (the liveness predicate this borrows), §5 (a receipt may not claim what it
// cannot know); 041 §8.2.
//
// EVERY TEST HERE IS THE NEGATIVE CASE OR ITS BOUNDARY. The positive path is
// proved end to end in `tests/integration/connector-oauth.test.ts` against a
// real Postgres; what a unit lane can do — and what a signature verifier most
// needs — is exercise the shapes that must be REFUSED, including the ones that
// look correct.
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CONNECTOR_OFFBOARDING_STEPS,
  ConnectorKeyError,
  RETIREMENT_MEANING,
  SHOPIFY_FORBIDDEN_SCOPES,
  SHOPIFY_MAX_SCOPES,
  SHOPIFY_REQUIRED_SCOPES,
  SHOPIFY_SCOPE_LIST_VERSION,
  STATE_USE_INDEX,
  STORE_CLAIM_INDEX,
  isStateUseConflict,
  isStoreClaimConflict,
  connectorKeyEnv,
  connectorResidual,
  expandGrantedScopes,
  isLive,
  isShopifyShopDomain,
  parseScopeList,
  pickLiveToken,
  renderConnectorReceipt,
  requireConnectorKey,
  revocationOutcome,
  scopeSatisfies,
  stateDigest,
  verifyQueryHmac,
  verifyWebhookHmac,
  type TokenVersionRow,
} from "../src/services/connectors/shopify/index.js";
import { TEST_CONNECTOR_KEY_V1 } from "./testConfig.js";

/** A fixture secret. It obeys E03-D04's convention: `test-…-key`, so it may only live here. */
const APP_SECRET = "test-shopify-app-secret-key";

describe("the scope list is a PINNED CONSTANT, not a preference (053 §6)", () => {
  it("asks for exactly two scopes, and this test is the pin", () => {
    // ⚠ THIS ASSERTION IS THE CONTROL, AND CHANGING IT IS THE POINT AT WHICH A
    // WIDENING BECOMES A DECISION. "Least scopes" is not a property of a
    // constant somebody wrote once; it is a property of a constant a build
    // refuses to let anyone change quietly. Adding a scope means editing this
    // line, in a PR, with the argument in `policy.ts` beside it.
    expect([...SHOPIFY_REQUIRED_SCOPES]).toEqual(["write_products", "read_products"]);
    expect([...SHOPIFY_MAX_SCOPES]).toEqual([...SHOPIFY_REQUIRED_SCOPES]);
    expect(SHOPIFY_SCOPE_LIST_VERSION).toBe(1);
  });

  it("asks for NO publication scope — the absence is what enforces T19", () => {
    // 019 T19 signs auto-publish at ZERO and marks it non-waivable; 033 B3 makes
    // publishing "a normal Shopify action, never the app's". Hardcoding
    // `status: "DRAFT"` is a code review away from being wrong; NOT HOLDING THE
    // CAPABILITY is not.
    const forbidden = SHOPIFY_FORBIDDEN_SCOPES.map((s) => s.scope);
    expect(forbidden).toContain("write_publications");
    expect(forbidden).toContain("write_product_listings");
    for (const scope of forbidden) {
      expect(SHOPIFY_MAX_SCOPES, `${scope} is both forbidden and requestable`).not.toContain(scope);
    }
  });

  it("asks for no customer, order or inventory scope, and says why for each", () => {
    for (const entry of SHOPIFY_FORBIDDEN_SCOPES) {
      // A forbidden list with no arguments is a list somebody edits. Each row
      // names the line it would breach.
      expect(entry.because.length, `${entry.scope} has no argument`).toBeGreaterThan(60);
    }
    const forbidden = SHOPIFY_FORBIDDEN_SCOPES.map((s) => s.scope);
    for (const scope of ["read_orders", "write_orders", "read_customers", "write_customers"]) {
      expect(forbidden).toContain(scope);
    }
  });
});

describe("scopeSatisfies — two-sided, and the second side is the control", () => {
  it("accepts the exact grant", () => {
    expect(scopeSatisfies(["write_products", "read_products"])).toMatchObject({ ok: true });
  });

  it("accepts a write-only grant, because Shopify's write subsumes its read", () => {
    // If this were a naive set-equality check, a provider that returns only
    // `write_products` for a request that asked for both would break every
    // install. The implication is applied in ONE direction, which the next case
    // proves.
    expect(scopeSatisfies(["write_products"])).toMatchObject({ ok: true });
    expect([...expandGrantedScopes(["write_products"])].sort()).toEqual(["read_products", "write_products"]);
  });

  it("REFUSES a read-only grant — the implication does not run backwards", () => {
    const verdict = scopeSatisfies(["read_products"]);
    expect(verdict).toMatchObject({ ok: false, reason: "insufficient" });
    expect(verdict.ok === false && verdict.reason === "insufficient" && verdict.missing).toEqual([
      "write_products",
    ]);
  });

  it("REFUSES a grant carrying authority nobody argued for", () => {
    // The half a reviewer should look at. A token with more power than the
    // declared list is a token whose blast radius is undocumented, and the way
    // that arrives is an app configuration drifting rather than an attack.
    const verdict = scopeSatisfies(["write_products", "read_products", "write_publications"]);
    expect(verdict).toMatchObject({ ok: false, reason: "excessive" });
    expect(verdict.ok === false && verdict.reason === "excessive" && verdict.surplus).toEqual([
      "write_publications",
    ]);
  });

  it("REFUSES an empty grant rather than treating it as 'no restrictions'", () => {
    expect(scopeSatisfies([])).toMatchObject({ ok: false, reason: "insufficient" });
    expect(parseScopeList("")).toEqual([]);
    expect(parseScopeList(" write_products , read_products ,")).toEqual(["write_products", "read_products"]);
  });
});

describe("isShopifyShopDomain — the SSRF control (053 §8.1)", () => {
  it("accepts a real store domain", () => {
    expect(isShopifyShopDomain("gotham-city-limit.myshopify.com")).toBe(true);
    expect(isShopifyShopDomain("a1.myshopify.com")).toBe(true);
  });

  const refused: ReadonlyArray<[string, string]> = [
    ["a bare attacker host", "attacker.example"],
    ["a suffix that is not the suffix", "gotham.myshopify.com.attacker.example"],
    ["a fragment smuggling the real host", "attacker.example#.myshopify.com"],
    ["a query smuggling the real host", "attacker.example?.myshopify.com"],
    ["userinfo in the authority", "user@attacker.example/.myshopify.com"],
    ["a port", "gotham.myshopify.com:8443"],
    ["a path", "gotham.myshopify.com/admin"],
    ["a scheme", "https://gotham.myshopify.com"],
    ["uppercase, which Shopify does not use and DNS folds", "GOTHAM.myshopify.com"],
    ["a leading hyphen", "-gotham.myshopify.com"],
    ["a trailing hyphen", "gotham-.myshopify.com"],
    ["a subdomain of a store", "evil.gotham.myshopify.com"],
    ["an underscore", "gotham_city.myshopify.com"],
    ["a newline that would satisfy an unanchored multiline match", "evil\ngotham.myshopify.com"],
    ["a trailing newline", "gotham.myshopify.com\n"],
    ["a trailing dot", "gotham.myshopify.com."],
    ["nothing at all", ""],
  ];

  for (const [name, value] of refused) {
    it(`REFUSES ${name}`, () => {
      // ⚠ EVERY ONE OF THESE IS A CREDENTIAL-EXFILTRATION ATTEMPT, not a
      // validation nicety: the next thing an install does with this value is
      // build `https://<shop>/admin/oauth/access_token` and POST the app's
      // CLIENT SECRET to it. A permissive check here turns this server into a
      // courier that delivers its own secret to whoever asked.
      expect(isShopifyShopDomain(value)).toBe(false);
    });
  }
});

describe("verifyQueryHmac — the OAuth callback's signature (053 §8.2)", () => {
  /** Sign a query the way Shopify does: sorted `k=v&…`, hmac excluded, hex. */
  function sign(params: Record<string, string>, secret = APP_SECRET): Record<string, string> {
    const message = Object.entries(params)
      .map(([k, v]) => `${k}=${v}`)
      .sort()
      .join("&");
    return { ...params, hmac: createHmac("sha256", secret).update(message, "utf8").digest("hex") };
  }

  const base = {
    shop: "gotham.myshopify.com",
    code: "authcode",
    state: "st-1",
    timestamp: "1757000000",
  };

  it("accepts a correctly signed query", () => {
    expect(verifyQueryHmac(sign(base), APP_SECRET)).toBe(true);
  });

  it("accepts a query with a parameter this build has never heard of", () => {
    // Shopify adds parameters over time and they are all inside the signed
    // message. A verifier that only signed the fields it knew would break the
    // day the provider added one — which is why the handler passes the RAW
    // query rather than the parsed contract object.
    expect(verifyQueryHmac(sign({ ...base, host: "abc123", brand_new: "x" }), APP_SECRET)).toBe(true);
  });

  it("REFUSES a tampered parameter", () => {
    const signed = sign(base);
    expect(verifyQueryHmac({ ...signed, shop: "attacker.myshopify.com" }, APP_SECRET)).toBe(false);
    expect(verifyQueryHmac({ ...signed, code: "other" }, APP_SECRET)).toBe(false);
  });

  it("REFUSES an added parameter, because the signature covers the whole message", () => {
    expect(verifyQueryHmac({ ...sign(base), injected: "x" }, APP_SECRET)).toBe(false);
  });

  it("REFUSES a DUPLICATED parameter outright, rather than picking first or last", () => {
    // The parameter-smuggling primitive: an attacker who can add a second
    // `shop=` and have the verifier sign one value while the application reads
    // the other. There is no first/last convention that is safe here, so the
    // duplicate is refused.
    const signed = sign(base);
    expect(verifyQueryHmac({ ...signed, shop: [base.shop, "attacker.myshopify.com"] }, APP_SECRET)).toBe(
      false
    );
  });

  it("REFUSES a wrong secret, an absent hmac and an empty secret", () => {
    expect(verifyQueryHmac(sign(base), "test-other-secret-key")).toBe(false);
    const { hmac: _hmac, ...unsigned } = sign(base);
    expect(verifyQueryHmac(unsigned, APP_SECRET)).toBe(false);
    // An empty secret is an UNCONFIGURED deployment, and a verifier with no key
    // accepts NOTHING. This is the assertion that stops "degrade to stub" from
    // ever reaching a signature check.
    expect(verifyQueryHmac(sign(base, ""), "")).toBe(false);
  });

  it("REFUSES a signature of the right length but the wrong bytes", () => {
    const signed = sign(base);
    const flipped = signed["hmac"]!.slice(0, -1) + (signed["hmac"]!.endsWith("a") ? "b" : "a");
    expect(verifyQueryHmac({ ...signed, hmac: flipped }, APP_SECRET)).toBe(false);
  });

  it("REFUSES a signature that would satisfy a differently-ordered message", () => {
    // The ordering is part of the construction: parameters are sorted before
    // signing, so a caller cannot reorder its way to a different message with
    // the same digest. Signing an UNSORTED message and presenting it proves the
    // verifier really sorts.
    const message = Object.entries(base)
      .map(([k, v]) => `${k}=${v}`)
      .reverse()
      .join("&");
    const wrong = createHmac("sha256", APP_SECRET).update(message, "utf8").digest("hex");
    expect(verifyQueryHmac({ ...base, hmac: wrong }, APP_SECRET)).toBe(false);
  });
});

describe("verifyWebhookHmac — the webhook's signature over the RAW body (053 §8.2)", () => {
  const body = Buffer.from(JSON.stringify({ shop_domain: "gotham.myshopify.com", b: 2, a: 1 }));
  const good = createHmac("sha256", APP_SECRET).update(body).digest("base64");

  it("accepts the correct base64 digest over the exact bytes", () => {
    expect(verifyWebhookHmac(body, good, APP_SECRET)).toBe(true);
  });

  it("REFUSES a digest computed over a RE-SERIALISATION of the parsed body", () => {
    // The failure this design exists to prevent, made concrete. `JSON.parse`
    // then `JSON.stringify` changes key order and whitespace, so a verifier
    // built on the parsed object rejects correct messages — and, worse, can be
    // made to accept wrong ones by anyone who understands the re-serialisation.
    const reserialised = Buffer.from(
      JSON.stringify(JSON.parse(body.toString("utf8")), Object.keys({}).sort())
    );
    expect(reserialised.equals(body)).toBe(false);
    expect(verifyWebhookHmac(reserialised, good, APP_SECRET)).toBe(false);
  });

  it("REFUSES a single flipped byte, a wrong secret, a missing header and an empty secret", () => {
    const tampered = Buffer.concat([body.subarray(0, body.length - 1), Buffer.from("X")]);
    expect(verifyWebhookHmac(tampered, good, APP_SECRET)).toBe(false);
    expect(verifyWebhookHmac(body, good, "test-other-secret-key")).toBe(false);
    expect(verifyWebhookHmac(body, undefined, APP_SECRET)).toBe(false);
    expect(verifyWebhookHmac(body, "", APP_SECRET)).toBe(false);
    expect(verifyWebhookHmac(body, good, "")).toBe(false);
  });

  it("REFUSES a hex digest where base64 is required, and a truncated one", () => {
    const hex = createHmac("sha256", APP_SECRET).update(body).digest("hex");
    expect(verifyWebhookHmac(body, hex, APP_SECRET)).toBe(false);
    expect(verifyWebhookHmac(body, good.slice(0, 20), APP_SECRET)).toBe(false);
  });

  it("REFUSES an empty body signed with the wrong secret and accepts one signed right", () => {
    const empty = Buffer.alloc(0);
    const sig = createHmac("sha256", APP_SECRET).update(empty).digest("base64");
    expect(verifyWebhookHmac(empty, sig, APP_SECRET)).toBe(true);
    expect(verifyWebhookHmac(empty, sig, "test-other-secret-key")).toBe(false);
  });
});

describe("stateDigest — the state is never in a column (053 §5.1)", () => {
  it("is a 64-character hex sha256 and is not the state", () => {
    const digest = stateDigest("some-state-value");
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digest).not.toContain("some-state-value");
    expect(stateDigest("some-state-value")).toBe(digest);
    expect(stateDigest("some-state-valuf")).not.toBe(digest);
  });
});

describe("isStoreClaimConflict — the ONE refusal the store claim may swallow (E03-D22)", () => {
  // 000-docs/061 §3. The claim's whole guarantee is a `23505`, and the danger of
  // catching one is catching the WRONG one: `connector_token_version` carries
  // `UNIQUE (shop_id, connector, version_no)` in the same transaction, and a
  // concurrent double-introduction raising THAT must not be reported to a
  // merchant as "another shop holds your store" — nor silently swallowed.
  it("names the index rather than matching a message", () => {
    expect(STORE_CLAIM_INDEX).toBe("shop_shopify_domain_is_one_store");
  });

  it("recognises a 23505 raised BY THAT INDEX", () => {
    expect(isStoreClaimConflict({ code: "23505", constraint: STORE_CLAIM_INDEX })).toBe(true);
  });

  it("REFUSES a 23505 from any other constraint in the same transaction", () => {
    expect(isStoreClaimConflict({ code: "23505", constraint: "connector_token_version_shop_no_key" })).toBe(
      false
    );
    expect(isStoreClaimConflict({ code: "23505", constraint: "connector_install_state_use_state_idx" })).toBe(
      false
    );
  });

  it("REFUSES a different SQLSTATE on the same index, and every shape that is not an error", () => {
    // A `23514` or a `42501` on this table means the CHECK or the policy refused,
    // which is a different fact about the world and must not become a callback
    // refusal that reads as "taken".
    expect(isStoreClaimConflict({ code: "42501", constraint: STORE_CLAIM_INDEX })).toBe(false);
    expect(isStoreClaimConflict({ code: "23505" })).toBe(false);
    expect(isStoreClaimConflict(new Error("duplicate key value violates unique constraint"))).toBe(false);
    expect(isStoreClaimConflict(null)).toBe(false);
    expect(isStoreClaimConflict(undefined)).toBe(false);
    expect(isStoreClaimConflict("23505")).toBe(false);
  });
});

describe("isStateUseConflict — the replay UNIQUE that was answering 500 (E03-D22 F8)", () => {
  // The security lens's F8. `UNIQUE (state_id)` on `connector_install_state_use`
  // is what 053 §5.2 calls "the whole mechanism" for a replayed callback, and it
  // is raised INSIDE the install transaction — where, before this bead, nothing
  // caught it. So the one refusal the schema is proudest of arrived as an
  // unhandled `23505`: a 500 with a stack, on a route where every other refusal
  // is one 4xx code.
  it("names the index rather than matching a message", () => {
    expect(STATE_USE_INDEX).toBe("connector_install_state_use_state_idx");
  });

  it("recognises a 23505 raised BY THAT INDEX", () => {
    expect(isStateUseConflict({ code: "23505", constraint: STATE_USE_INDEX })).toBe(true);
  });

  it("is DISJOINT from the store-claim predicate — neither may swallow the other's refusal", () => {
    // Two different facts about the world: one says the state was already spent,
    // the other says another shop holds the store. Reporting either as the other
    // is a lie in the log, and for the second a lie about the estate.
    expect(isStateUseConflict({ code: "23505", constraint: STORE_CLAIM_INDEX })).toBe(false);
    expect(isStoreClaimConflict({ code: "23505", constraint: STATE_USE_INDEX })).toBe(false);
  });

  it("REFUSES every shape that is not a 23505 from that index", () => {
    expect(isStateUseConflict({ code: "23505", constraint: "connector_token_version_shop_no_key" })).toBe(
      false
    );
    expect(isStateUseConflict({ code: "23503", constraint: STATE_USE_INDEX })).toBe(false);
    expect(isStateUseConflict({ code: "23505" })).toBe(false);
    expect(isStateUseConflict(new Error("duplicate key"))).toBe(false);
    expect(isStateUseConflict(null)).toBe(false);
  });
});

describe("the connector key ring (053 §3)", () => {
  it("REFUSES to produce a ring when the variable is absent — no plaintext mode", () => {
    expect(() => requireConnectorKey({})).toThrow(ConnectorKeyError);
    expect(() => requireConnectorKey({})).toThrow(/LONGBOX_CONNECTOR_KEY_V1 is not set/);
  });

  it("REFUSES a key that is not exactly thirty-two bytes", () => {
    // "short" — five bytes, base64. The refusal names the LENGTH and the
    // variable and never the value.
    expect(() => requireConnectorKey({ LONGBOX_CONNECTOR_KEY_V1: "c2hvcnQ=" })).toThrow(
      /decodes to 5 bytes; AES-256-GCM needs exactly 32/
    );
  });

  it("names its OWN variable, not the authenticator's — one key for two subsystems is two compromises", () => {
    expect(connectorKeyEnv(1)).toBe("LONGBOX_CONNECTOR_KEY_V1");
    expect(connectorKeyEnv(2)).toBe("LONGBOX_CONNECTOR_KEY_V2");
    // The authenticator's ring must NOT satisfy this loader: a deployment that
    // set only the authenticator key would otherwise silently seal connector
    // tokens under the second factor's key.
    expect(() => requireConnectorKey({ LONGBOX_AUTHENTICATOR_KEY_V1: TEST_CONNECTOR_KEY_V1 })).toThrow(
      ConnectorKeyError
    );
  });

  it("takes the HIGHEST version present as the one that seals", () => {
    const ring = requireConnectorKey({
      LONGBOX_CONNECTOR_KEY_V1: Buffer.alloc(32, 0x33).toString("base64"),
      LONGBOX_CONNECTOR_KEY_V2: Buffer.alloc(32, 0x44).toString("base64"),
    });
    expect(ring.current).toBe(2);
    expect([...ring.keys.keys()].sort()).toEqual([1, 2]);
  });

  it("never repeats a key value in any refusal it raises", () => {
    const value = Buffer.alloc(8, 0x55).toString("base64");
    try {
      requireConnectorKey({ LONGBOX_CONNECTOR_KEY_V1: value });
      expect.unreachable("a short key must be refused");
    } catch (err) {
      const text = `${(err as Error).message}\n${(err as Error).stack ?? ""}`;
      expect(text).not.toContain(value);
      expect(text).toContain("LONGBOX_CONNECTOR_KEY_V1");
    }
  });
});

describe("liveness is a predicate over two tables (053 §7.1, 050 §2 Q2)", () => {
  const version = (versionNo: number, retired: boolean, reason: string | null = null): TokenVersionRow => ({
    id: `v-${String(versionNo)}`,
    connector: "shopify",
    shopDomain: "gotham.myshopify.com",
    grantedScopes: ["write_products", "read_products"],
    versionNo,
    keyVersion: 1,
    introducedAt: new Date("2026-09-01T00:00:00Z"),
    retired,
    retiredReason: reason,
  });

  it("has no versions at all → the legacy path, not a refusal", () => {
    expect(pickLiveToken([])).toEqual({ outcome: "no_versions" });
  });

  it("one live version → it resolves", () => {
    const outcome = pickLiveToken([version(1, false)]);
    expect(outcome.outcome).toBe("live");
    expect(outcome.outcome === "live" && outcome.chosen.versionNo).toBe(1);
  });

  it("an overlap → the GREATER version wins, and the older stays live", () => {
    // An overlap is legal while a rotation is proven (050 §2 Q2): introducing
    // N+1 does not retire N. Auto-retiring is how a shop stops working at 09:00
    // on a Tuesday with nobody watching.
    const outcome = pickLiveToken([version(2, false), version(1, false)]);
    expect(outcome.outcome === "live" && outcome.chosen.versionNo).toBe(2);
    expect(outcome.outcome === "live" && outcome.live).toHaveLength(2);
  });

  it("every version retired → all_retired, which the resolver turns into a REFUSAL", () => {
    // The half that makes an uninstall real: never a fall-through to the static
    // admin token. `tests/consumers-registry.test.ts` asserts the refusal at the
    // client; this asserts the predicate under it.
    const outcome = pickLiveToken([version(2, true, "uninstall"), version(1, true, "rotation")]);
    expect(outcome.outcome).toBe("all_retired");
    expect(outcome.outcome === "all_retired" && outcome.retired).toHaveLength(2);
  });

  it("a retired NEWEST with a live older one still resolves the live one", () => {
    // The case a `max(version_no)` implementation gets wrong: liveness is
    // filtered BEFORE the ordering, never after.
    const outcome = pickLiveToken([version(2, true, "revocation"), version(1, false)]);
    expect(outcome.outcome === "live" && outcome.chosen.versionNo).toBe(1);
  });

  it("defines liveness in ONE place", () => {
    expect(isLive(version(1, false))).toBe(true);
    expect(isLive(version(1, true, "uninstall"))).toBe(false);
  });
});

describe("the receipt says what happened and never what it cannot know (041 §8.2, 050 §5)", () => {
  it("distinguishes the three endings, because they differ about the PROVIDER side", () => {
    expect(RETIREMENT_MEANING.uninstall).toMatch(/dead at Shopify/);
    expect(RETIREMENT_MEANING.rotation).toMatch(/Whether it still works at Shopify/);
    expect(RETIREMENT_MEANING.revocation).toMatch(/depends on the provider-side attempt/);
  });

  it("no longer says 'only the merchant can end it there' — the S2 correction", () => {
    // ⚠ THE SENTENCE THIS ASSERTS THE ABSENCE OF WAS IN THE FIRST VERSION OF THIS
    // FILE'S SUBJECT, AND IT WAS FALSE. `RETIREMENT_MEANING.revocation` read
    // "only the merchant can end it there, by uninstalling the app" — 050's true
    // sentence about a BYOK key, transplanted onto a credential it does not
    // describe, because an app holding an offline token can call Shopify's own
    // app-uninstall endpoint with that token. A receipt is the one artifact 041
    // §8.2 forbids untrue statements in, so the claim is gone and this test is
    // what stops it coming back.
    for (const reason of ["uninstall", "rotation", "revocation"] as const) {
      const text = `${RETIREMENT_MEANING[reason]} ${connectorResidual(reason)}`;
      expect(text, reason).not.toMatch(/only the merchant can/i);
      expect(text, reason).not.toMatch(/their act and only theirs/i);
    }
    // …and the replacement points at the RECORDED attempt rather than asserting
    // anything about Shopify's state.
    expect(RETIREMENT_MEANING.revocation).toMatch(/provider-side attempt recorded beside this reason/);
  });

  it("renders four provider-side outcomes, and 'no attempt' is one of them", () => {
    // The fourth case is the one the security lens made this record write down: a
    // revocation with NO provider call ended nothing at Shopify, and a receipt
    // that did not say so would be back where S2 found it.
    expect(revocationOutcome(null)).toMatch(/No provider-side revocation was attempted/);
    expect(revocationOutcome(null)).toMatch(/may remain usable at Shopify/);

    const at = new Date("2026-09-04T00:00:00.000Z");
    expect(revocationOutcome({ attemptedAt: at, httpStatus: null })).toMatch(/did not complete/);
    expect(revocationOutcome({ attemptedAt: at, httpStatus: null })).toMatch(/claims nothing/);

    const ok = revocationOutcome({ attemptedAt: at, httpStatus: 200 });
    expect(ok).toMatch(/Shopify answered 200/);
    // A 2xx is EVIDENCE A REQUEST SUCCEEDED and never a fact about another
    // system's present state (018). The sentence says so in those words.
    expect(ok).toMatch(/is not, by itself, a statement about the token's present state/);

    const bad = revocationOutcome({ attemptedAt: at, httpStatus: 404 });
    expect(bad).toMatch(/Shopify answered 404/);
    expect(bad).toMatch(/still usable at Shopify/);
  });

  it("states the backup scope HONESTLY — the S1 narrowing", () => {
    // The first version implied a backup copy of the ciphertext is a defended
    // copy. The estate's borg include set carries /etc — where the age key lives
    // — and the database dump in the SAME archive, so one archive can hold the
    // ciphertext, the ring's SOPS source and the key that opens it. Until
    // E13-D01 separates them the receipt may not imply otherwise.
    for (const reason of ["uninstall", "rotation", "revocation"] as const) {
      const residual = connectorResidual(reason);
      expect(residual, reason).toContain("E13-D01");
      expect(residual, reason).toMatch(/may also contain the key/);
    }
  });

  it("never claims Longbox revoked anything at the provider", () => {
    for (const reason of ["uninstall", "rotation", "revocation"] as const) {
      const residual = connectorResidual(reason);
      // The forbidden sentence, in the shapes it would actually take.
      expect(residual).not.toMatch(/we (have )?revoked/i);
      expect(residual).not.toMatch(/revoked at Shopify by (this|our)/i);
      expect(residual.length).toBeGreaterThan(120);
    }
    // For a rotation or a revocation the honest limit is that THIS SYSTEM
    // stopped, and what it means at Shopify is stated from what was observed.
    expect(connectorResidual("rotation")).toMatch(/will not present the token again/);
    expect(connectorResidual("revocation")).toMatch(/stated separately in this receipt/);
    // For an uninstall the merchant's act is attributed to the MERCHANT.
    expect(connectorResidual("uninstall")).toMatch(/because the merchant uninstalled/);
  });

  it("renders a receipt that names the steps and carries no credential VALUE", () => {
    const receipt = {
      shop_id: "11111111-1111-4111-8111-111111111111",
      connector: "shopify",
      connector_token_version_id: "22222222-2222-4222-8222-222222222222",
      version_no: 1,
      shop_domain: "gotham.myshopify.com",
      granted_scopes: ["write_products", "read_products"],
      reason_code: "revocation",
      retired_at: "2026-09-04T00:00:00.000Z",
      webhook_receipt_id: null,
      provider_revocation: null,
      meaning: RETIREMENT_MEANING.revocation,
      provider_outcome: revocationOutcome(null),
      steps: CONNECTOR_OFFBOARDING_STEPS,
      residual: connectorResidual("revocation"),
    } as const;
    const text = renderConnectorReceipt(receipt);
    expect(text).toContain("Step 1:");
    expect(text).toContain("Step 3:");
    expect(text).toContain("No signed provider message caused this ending.");

    // ⚠ THE ASSERTION IS ABOUT A VALUE, NOT ABOUT A WORD. The receipt says
    // "token version" and "sealed ciphertext" on purpose — it is describing what
    // was ended and what remains, which is the whole job of a receipt (041
    // §8.7(c)). What must be absent is a CREDENTIAL, and a word-blacklist would
    // fail the honest sentence while passing an interpolated secret.
    //
    // Two checks instead, and both are structural: no Shopify token prefix can
    // appear, and the receipt SHAPE has no field that could carry one — the type
    // has no such member, and this asserts it at runtime so a later `...row`
    // spread cannot widen it silently.
    expect(text).not.toMatch(/\bshp(at|ca|pa|ss)_/i);
    expect(Object.keys(receipt).sort()).toEqual(
      [
        "connector",
        "connector_token_version_id",
        "granted_scopes",
        "meaning",
        "reason_code",
        "residual",
        "retired_at",
        "shop_domain",
        "shop_id",
        "steps",
        "version_no",
        "webhook_receipt_id",
        "provider_revocation",
        "provider_outcome",
      ].sort()
    );
  });
});
