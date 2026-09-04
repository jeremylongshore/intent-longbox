// 046 §11 I4, and the invariant it names: **a `shop_credentials` row cannot name
// a variable outside its shop's namespace, and cannot name a host outside the
// allowlist.** I4 says in as many words that it "fails on the current tree —
// `registry.ts:34` accepts any name and `:63`/`:72` accept any host". This file
// is the assertion that stops being true.
//
// Bead: longbox-e5b.3.11 (alias E03-D01). Docs: 046 §4 B7, §5 A7/A15, §7.3,
// §11 I4/I5; 019 T24/T31; CLAUDE.md locked decision 2.
//
// THE EXFILTRATION PRIMITIVE, WRITTEN OUT ONCE so the tests below can refer to
// it: a row reading (`key_ref = 'ANTHROPIC_API_KEY'`, `base_url =
// 'https://attacker.example'`) sends the estate's own key to a host of the
// row-writer's choosing. Both halves are refused here, and the DB-level half is
// proved as the least-privileged role in
// `tests/integration/credential-namespace.test.ts`.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GATEWAY_HOST_ALLOWLIST_ENV,
  GatewayConfigError,
  REGISTERED_PROVIDER_HOSTS,
  assertGatewayConfigOrThrow,
  gatewayHostAllowlist,
} from "../../src/config.js";
import {
  CREDENTIAL_SUFFIXES,
  KEY_REF_PATTERN,
  credentialRowShape,
  credentialRowShapeForShop,
  deriveKeyRef,
  findNamespaceClash,
  isRegisteredProviderUrl,
  keyRefNamespace,
  legalKeyRefs,
  reportCredentialRefusal,
  resolveKeyRef,
  setCredentialRefusalSink,
  type CredentialRefusalEvent,
  type KeyRefRefusal,
} from "../../src/providers/credentialPolicy.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, "..", "..");

describe("the derived name is the name the rule accepts", () => {
  it("derives LONGBOX_<SLUG>_<SUFFIX> and STRIPS a hyphenated slug's separators", () => {
    expect(deriveKeyRef("gotham", "anthropic")).toBe("LONGBOX_GOTHAM_ANTHROPIC_KEY");
    // Stripped, not underscored. `LONGBOX_GOTHAM_CITY_…` is exactly the name the
    // sibling-slug defect below turned on, so the fold never produces it.
    expect(deriveKeyRef("gotham-city", "pricecharting")).toBe("LONGBOX_GOTHAMCITY_PRICECHARTING_KEY");
    expect(keyRefNamespace("gotham-city")).toBe("LONGBOX_GOTHAMCITY_");
  });

  it("every derived name, and the eBay pair's second half, satisfies the CHECK's pattern", () => {
    for (const slug of ["gotham", "gotham-city", "shop9"]) {
      for (const kind of ["anthropic", "openai_compat", "shopify", "pricecharting", "ebay"] as const) {
        expect(deriveKeyRef(slug, kind)).toMatch(KEY_REF_PATTERN);
        expect(legalKeyRefs(slug)).toContain(deriveKeyRef(slug, kind));
      }
      // `EBAY_KEY_SECRET` is a NAMED member of the closed set, not a
      // `${key_ref}_SECRET` consequence — deriving a second name by appending to
      // a validated one is how a prefix rule re-enters through the back door.
      expect(`${keyRefNamespace(slug)}EBAY_KEY_SECRET`).toMatch(KEY_REF_PATTERN);
      expect(legalKeyRefs(slug)).toContain(`${keyRefNamespace(slug)}EBAY_KEY_SECRET`);
      expect(legalKeyRefs(slug)).toHaveLength(CREDENTIAL_SUFFIXES.length);
    }
  });

  it("refuses the shapes that name a global secret", () => {
    for (const hostile of ["ANTHROPIC_API_KEY", "DATABASE_URL", "LLM_API_KEY", "AWS_SECRET_ACCESS_KEY"]) {
      expect(hostile).not.toMatch(KEY_REF_PATTERN);
    }
  });

  it("refuses a name whose suffix is not one of the six, however well-formed it looks", () => {
    // The closed set is what makes the slug segment unambiguous. Without it,
    // any trailing `_[A-Z0-9_]+` was a legal "provider", which is what gave the
    // sibling slug somewhere to hide.
    for (const bad of [
      "LONGBOX_GOTHAM_STRIPE_KEY",
      "LONGBOX_GOTHAM_ANTHROPIC_TOKEN",
      "LONGBOX_GOTHAM_ANTHROPIC_KEY_BACKUP",
      "LONGBOX_GOTHAM_ANTHROPIC",
    ]) {
      expect(bad).not.toMatch(KEY_REF_PATTERN);
    }
  });
});

describe("THE SIBLING-SLUG DEFECT (invariant review of 610501e) is closed at both layers", () => {
  // `gotham` and `gotham-city` are two real shops in one estate. The first
  // version of this control tested `keyRef.startsWith(keyRefNamespace(slug))`,
  // so shop `gotham` — namespace `LONGBOX_GOTHAM_` — accepted
  // `LONGBOX_GOTHAM_CITY_ANTHROPIC_KEY`, which is the OTHER shop's variable. It
  // satisfied the CHECK too. That is 046 §5 A7's cross-shop key-ref confusion
  // surviving inside the control written to prevent it.
  const SIBLING = "LONGBOX_GOTHAM_CITY_ANTHROPIC_KEY";

  afterEach(() => vi.unstubAllEnvs());

  it("the sibling name is not even well-formed any more — the DB half refuses it", () => {
    // A CHECK cannot look up which shop owns a row, so it can never refuse the
    // sibling by comparing slugs. What it CAN do is leave no second slug segment
    // for `CITY` to hide in, which is what the closed suffix set does.
    expect(SIBLING).not.toMatch(KEY_REF_PATTERN);
  });

  it("shop 'gotham' is refused the sibling's variable EVEN WHEN IT IS SET", () => {
    vi.stubEnv(SIBLING, "sk-gotham-citys-key");
    const out = resolveKeyRef(SIBLING, "gotham");
    expect(out.ok).toBe(false);
    expect(JSON.stringify(out)).not.toContain("sk-gotham-citys-key");
  });

  it("and neither shop's fold is a prefix of the other's, which is why equality is the test", () => {
    // The fold makes the two namespaces disjoint rather than nested…
    expect(keyRefNamespace("gotham")).toBe("LONGBOX_GOTHAM_");
    expect(keyRefNamespace("gotham-city")).toBe("LONGBOX_GOTHAMCITY_");
    expect(keyRefNamespace("gotham-city").startsWith(keyRefNamespace("gotham"))).toBe(false);
    // …and the legal sets share no member in either direction.
    for (const ref of legalKeyRefs("gotham-city")) {
      expect(legalKeyRefs("gotham")).not.toContain(ref);
      expect(resolveKeyRef(ref, "gotham").ok).toBe(false);
    }
    for (const ref of legalKeyRefs("gotham")) {
      expect(resolveKeyRef(ref, "gotham-city").ok).toBe(false);
    }
  });

  it("each shop still resolves its OWN key — the fix is not a blanket refusal", () => {
    vi.stubEnv("LONGBOX_GOTHAM_ANTHROPIC_KEY", "sk-gotham");
    vi.stubEnv("LONGBOX_GOTHAMCITY_ANTHROPIC_KEY", "sk-gotham-city");
    expect(resolveKeyRef("LONGBOX_GOTHAM_ANTHROPIC_KEY", "gotham")).toEqual({
      ok: true,
      value: "sk-gotham",
    });
    expect(resolveKeyRef("LONGBOX_GOTHAMCITY_ANTHROPIC_KEY", "gotham-city")).toEqual({
      ok: true,
      value: "sk-gotham-city",
    });
  });

  it("the fold's non-injectivity is REAL, and register-shop is where it is refused", () => {
    // Stated as an assertion rather than a comment so the next reader cannot
    // mistake it for an oversight: `gotham-city` and `gothamcity` DO collide.
    expect(keyRefNamespace("gothamcity")).toBe(keyRefNamespace("gotham-city"));
    // The refusal predicate, which `scripts/register-shop.ts` runs inside its
    // transaction before the INSERT — the only place a second colliding slug can
    // be created.
    expect(findNamespaceClash("gothamcity", ["gotham", "gotham-city"])).toBe("gotham-city");
    expect(findNamespaceClash("gotham-city", ["gotham", "gothamcity"])).toBe("gothamcity");
    // A non-colliding neighbour is allowed through — the check is a collision
    // test, not a similarity test.
    expect(findNamespaceClash("gotham-city", ["gotham"])).toBeUndefined();
    expect(findNamespaceClash("metropolis", ["gotham", "gotham-city"])).toBeUndefined();
    // Re-registering the SAME slug is the UNIQUE constraint's business, not this
    // predicate's; it must not be reported as a namespace clash with itself.
    expect(findNamespaceClash("gotham", ["gotham"])).toBeUndefined();
  });

  it("`gotham.city` cannot exist at all — migration 014 constrains shop.slug", () => {
    // The other end of the same defect: a slug carrying `.` or `_` would fold
    // into a name whose segmentation nobody intended. The charset CHECK is
    // asserted against the database in tests/integration/credential-namespace.test.ts;
    // this is the same rule as the CLI has always applied.
    const SLUG_CHARSET = /^[a-z0-9-]+$/;
    expect(SLUG_CHARSET.test("gotham.city")).toBe(false);
    expect(SLUG_CHARSET.test("gotham_city")).toBe(false);
    expect(SLUG_CHARSET.test("Gotham")).toBe(false);
    expect(SLUG_CHARSET.test("gotham-city")).toBe(true);
    expect(SLUG_CHARSET.test("gotham")).toBe(true);
  });
});

describe("resolveKeyRef refuses before it reads the environment (the control, 046 §5 A7)", () => {
  let seen: CredentialRefusalEvent[] = [];
  let restore: (e: CredentialRefusalEvent) => void;

  beforeEach(() => {
    seen = [];
    restore = setCredentialRefusalSink((e) => seen.push(e));
  });
  afterEach(() => {
    setCredentialRefusalSink(restore);
    vi.unstubAllEnvs();
  });

  it("resolves a name inside the shop's namespace", () => {
    vi.stubEnv("LONGBOX_GOTHAM_ANTHROPIC_KEY", "sk-gotham");
    expect(resolveKeyRef("LONGBOX_GOTHAM_ANTHROPIC_KEY", "gotham")).toEqual({ ok: true, value: "sk-gotham" });
    expect(seen).toEqual([]);
  });

  it("refuses a global secret name THAT IS SET, and never reads its value", () => {
    // The sharpest case: the variable exists, holds a real value, and is refused
    // anyway. A test where the name happens to be unset proves nothing — it
    // would pass against the old `process.env[keyRef]` too.
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-the-estate-key");
    const out = resolveKeyRef("ANTHROPIC_API_KEY", "gotham");
    expect(out).toEqual({ ok: false, reason: "malformed" });
    expect(JSON.stringify(out)).not.toContain("sk-the-estate-key");
  });

  it("refuses ANOTHER SHOP'S well-formed, set variable — the cross-tenant half", () => {
    vi.stubEnv("LONGBOX_OTHERSHOP_ANTHROPIC_KEY", "sk-other-shop");
    const out = resolveKeyRef("LONGBOX_OTHERSHOP_ANTHROPIC_KEY", "gotham");
    expect(out).toEqual({ ok: false, reason: "out_of_namespace" });
    expect(JSON.stringify(out)).not.toContain("sk-other-shop");
  });

  it("separates 'declared but unset' from a refusal", () => {
    expect(resolveKeyRef("LONGBOX_GOTHAM_SHOPIFY_KEY", "gotham")).toEqual({ ok: false, reason: "unset" });
    vi.stubEnv("LONGBOX_GOTHAM_SHOPIFY_KEY", "");
    expect(resolveKeyRef("LONGBOX_GOTHAM_SHOPIFY_KEY", "gotham")).toEqual({ ok: false, reason: "unset" });
    // An unset variable is ordinary configuration, not a security event.
    expect(seen).toEqual([]);
  });

  it("THE DETECTOR: a refusal emits a structured warning naming the shop, and never a value", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-the-estate-key");
    resolveKeyRef("ANTHROPIC_API_KEY", "gotham");
    resolveKeyRef("LONGBOX_OTHERSHOP_EBAY_KEY", "gotham");
    expect(seen).toEqual([
      {
        event: "credential.key_ref_refused",
        reason: "malformed",
        shop_slug: "gotham",
        key_ref: "ANTHROPIC_API_KEY",
        expected_prefix: "LONGBOX_GOTHAM_",
      },
      {
        event: "credential.key_ref_refused",
        reason: "out_of_namespace",
        shop_slug: "gotham",
        key_ref: "LONGBOX_OTHERSHOP_EBAY_KEY",
        expected_prefix: "LONGBOX_GOTHAM_",
      },
    ]);
    expect(JSON.stringify(seen)).not.toContain("sk-the-estate-key");
  });

  // -------------------------------------------------------------------------
  // E03-B05 (050 §9 I11): the refusal event covers EVERY refusal reason,
  // including the new `retired` one.
  // -------------------------------------------------------------------------
  it("I11: the `retired` reason emits the SAME event shape, with a name and no value", () => {
    // `retired` is decided from two TABLES rather than from a name, so it cannot
    // be produced inside `resolveKeyRef` — but it must be the same event, or an
    // operator watching `credential.key_ref_refused` sees every refusal kind
    // except the one a rotation produces.
    vi.stubEnv("LONGBOX_GOTHAM_ANTHROPIC_KEY", "test-planted-canary-key");
    reportCredentialRefusal("retired", "gotham", "LONGBOX_GOTHAM_ANTHROPIC_KEY");
    expect(seen).toEqual([
      {
        event: "credential.key_ref_refused",
        reason: "retired",
        shop_slug: "gotham",
        key_ref: "LONGBOX_GOTHAM_ANTHROPIC_KEY",
        expected_prefix: "LONGBOX_GOTHAM_",
      },
    ]);
    // The variable IS set, and the event still carries only its name.
    expect(JSON.stringify(seen)).not.toContain("test-planted-canary-key");
  });

  it("I11: every refusal reason produces an event, and the set is closed", () => {
    // The both-directions half. A reason added without a sink emission would be
    // a refusal an operator never hears about; a reason emitted without being in
    // the type would not compile.
    const reasons: KeyRefRefusal[] = ["malformed", "out_of_namespace", "retired"];
    for (const reason of reasons) reportCredentialRefusal(reason, "gotham", "LONGBOX_GOTHAM_ANTHROPIC_KEY");
    expect(seen.map((e) => e.reason)).toEqual(reasons);
    for (const event of seen) {
      expect(Object.keys(event).sort()).toEqual(
        ["event", "expected_prefix", "key_ref", "reason", "shop_slug"].sort()
      );
    }
  });
});

describe("base_url is refused unless it is a registered provider host (046 §5 A15)", () => {
  it("accepts the registered hosts over https, with or without a path", () => {
    expect(isRegisteredProviderUrl("https://api.anthropic.com")).toBe(true);
    expect(isRegisteredProviderUrl("https://api.openai.com/v1")).toBe(true);
    expect(isRegisteredProviderUrl("https://api.sandbox.ebay.com")).toBe(true);
  });

  it("refuses an arbitrary host, a lookalike host and a cleartext downgrade", () => {
    expect(isRegisteredProviderUrl("https://attacker.example")).toBe(false);
    expect(isRegisteredProviderUrl("https://api.anthropic.com.attacker.example")).toBe(false);
    expect(isRegisteredProviderUrl("http://api.anthropic.com")).toBe(false);
    expect(isRegisteredProviderUrl("not-a-url")).toBe(false);
  });
});

describe("the Zod contract carries the same rule as the column (042 §3, 046 §11 I4)", () => {
  it("accepts a well-formed row for its own shop", () => {
    const row = { kind: "anthropic", key_ref: deriveKeyRef("gotham", "anthropic"), base_url: null };
    expect(credentialRowShape.safeParse(row).success).toBe(true);
    expect(credentialRowShapeForShop("gotham").safeParse(row).success).toBe(true);
  });

  it("REFUSES THE HOSTILE ROW AT THE CONTRACT LAYER — both halves at once", () => {
    const hostile = { kind: "anthropic", key_ref: "ANTHROPIC_API_KEY", base_url: "https://attacker.example" };
    const parsed = credentialRowShape.safeParse(hostile);
    expect(parsed.success).toBe(false);
    const paths = parsed.success ? [] : parsed.error.issues.map((i) => i.path.join("."));
    expect(paths).toContain("key_ref");
    expect(paths).toContain("base_url");
  });

  it("refuses another shop's well-formed name when the shop is known", () => {
    const row = { kind: "anthropic", key_ref: "LONGBOX_OTHERSHOP_ANTHROPIC_KEY", base_url: null };
    expect(credentialRowShape.safeParse(row).success).toBe(true); // shape alone is fine
    expect(credentialRowShapeForShop("gotham").safeParse(row).success).toBe(false); // the shop clause is not
  });

  it("refuses the SIBLING-SLUG name at the contract layer too, in both directions", () => {
    // The Zod half used the same `startsWith` the resolver did, so it had the
    // same hole. It now tests exact membership for the same reason.
    const sibling = { kind: "anthropic", key_ref: "LONGBOX_GOTHAM_CITY_ANTHROPIC_KEY", base_url: null };
    expect(credentialRowShape.safeParse(sibling).success).toBe(false); // not even well-formed now
    expect(credentialRowShapeForShop("gotham").safeParse(sibling).success).toBe(false);
    expect(credentialRowShapeForShop("gotham-city").safeParse(sibling).success).toBe(false);
    // Each shop's own derived row still parses, so the tightening is not a
    // blanket refusal dressed up as a fix.
    for (const slug of ["gotham", "gotham-city"]) {
      const own = { kind: "anthropic", key_ref: deriveKeyRef(slug, "anthropic"), base_url: null };
      expect(credentialRowShapeForShop(slug).safeParse(own).success).toBe(true);
    }
  });
});

describe("the database rule and the application rule are ONE rule", () => {
  const migration = readFileSync(
    path.join(repoRoot, "migrations", "014_credential_namespace_and_host_allowlist.sql"),
    "utf8"
  );

  it("migration 014 carries the SAME key_ref pattern the resolver enforces, character for character", () => {
    // Two copies of one rule, asserted equal — the alternative is a CHECK and a
    // resolver that drift and a sibling name that only one of them refuses,
    // which is precisely the shape of the defect this commit is fixing.
    const pattern = "^LONGBOX_[A-Z0-9]+_(ANTHROPIC|OPENAI|SHOPIFY|PRICECHARTING|EBAY)_KEY(_SECRET)?$";
    expect(migration).toContain(pattern);
    expect(KEY_REF_PATTERN.source).toBe(pattern);
    // …and every suffix in the closed set is named by that regex.
    for (const suffix of CREDENTIAL_SUFFIXES) {
      expect(`LONGBOX_GOTHAM_${suffix}`).toMatch(new RegExp(pattern));
    }
  });

  it("migration 014 constrains shop.slug, so the set of possible env folds is checkable", () => {
    expect(migration).toContain("shop_slug_charset");
    expect(migration).toContain("^[a-z0-9-]+$");
  });

  it("migration 014 names exactly the hosts REGISTERED_PROVIDER_HOSTS names", () => {
    // A database rule and an application rule that can disagree silently are two
    // rules. This is the assertion that keeps them one.
    for (const host of REGISTERED_PROVIDER_HOSTS) {
      expect(migration).toContain(host.replace(/\./g, "\\."));
    }
    const inSql = migration.match(/api\\\.[a-z.\\]+com/g) ?? [];
    const distinct = new Set(inSql.map((h) => h.replace(/\\/g, "")));
    expect([...distinct].sort()).toEqual([...REGISTERED_PROVIDER_HOSTS].sort());
  });

  it("is expand-only: it adds constraints and drops no table, column or type", () => {
    expect(migration).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(migration).not.toMatch(/\bDROP\s+COLUMN\b/i);
    expect(migration).not.toMatch(/ALTER\s+COLUMN[\s\S]{0,40}\bTYPE\b/i);
  });

  // -------------------------------------------------------------------------
  // E03-B05: the VERSION table restates the same rule, so make it the same rule.
  // -------------------------------------------------------------------------
  const version021 = readFileSync(
    path.join(repoRoot, "migrations", "021_shop_credential_version.sql"),
    "utf8"
  );

  it("migration 021 carries the SAME key_ref pattern, character for character", () => {
    // A CHECK cannot be shared between two tables, so the expression is written
    // twice — which is exactly the condition under which two copies drift. The
    // assertion is what keeps `shop_credential_version` from accepting a name
    // `shop_credentials` refuses, which would be the sibling-slug defect
    // re-entering through the table that replaced it.
    expect(version021).toContain(KEY_REF_PATTERN.source);
  });

  it("migration 021 stores a NAME and never a value (locked decision 2)", () => {
    // The negative that matters most in this whole bead. A column of any of
    // these shapes on a credential table is a raw key in the database.
    //
    // COMMENTS ARE STRIPPED FIRST, and for the reason the neighbouring scanners
    // give: the header explains WHY the encrypted column was rejected and names
    // the shapes it rejected. A scanner that fired on that would teach the next
    // author to stop writing the explanation down.
    const code = version021
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    for (const forbidden of [/\bsecret\s+text/i, /\bciphertext\b/i, /\benvelope_key/i, /\bkey_value\b/i]) {
      expect(code).not.toMatch(forbidden);
    }
  });

  it("migrations 021–023 are expand-only and declare no contract step", () => {
    for (const name of [
      "021_shop_credential_version.sql",
      "022_shop_credential_retirement.sql",
      "023_cost_log_spend_owner.sql",
    ]) {
      const sql = readFileSync(path.join(repoRoot, "migrations", name), "utf8");
      const code = sql
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n");
      expect(code, name).not.toMatch(/\bDROP\s+TABLE\b/i);
      expect(code, name).not.toMatch(/\bDROP\s+COLUMN\b/i);
      expect(code, name).not.toMatch(/ALTER\s+COLUMN[\s\S]{0,40}\bTYPE\b/i);
      // 044 §2: `SET NOT NULL` is a CONTRACTING shape. `023` needs the NOT NULL
      // property and gets it from a `NOT VALID` CHECK instead, which enforces on
      // every INSERT while leaving rows that predate attribution alone.
      expect(code, name).not.toMatch(/SET\s+NOT\s+NULL/i);
      expect(sql, name).not.toMatch(/^--\s*contract:/im);
    }
  });
});

describe("the gateway override is scope-checked at boot (046 §11 I5)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is silent when neither half is set", () => {
    expect(() => assertGatewayConfigOrThrow({} as NodeJS.ProcessEnv)).not.toThrow();
  });

  it("refuses a half-configured pair, in both directions", () => {
    expect(() =>
      assertGatewayConfigOrThrow({ LLM_BASE_URL: "https://api.openai.com/v1" } as NodeJS.ProcessEnv)
    ).toThrow(GatewayConfigError);
    expect(() => assertGatewayConfigOrThrow({ LLM_API_KEY: "k" } as NodeJS.ProcessEnv)).toThrow(
      GatewayConfigError
    );
  });

  it("accepts a registered host and REFUSES one off the allowlist — a presence check is not a scope check", () => {
    expect(() =>
      assertGatewayConfigOrThrow({
        LLM_BASE_URL: "https://api.openai.com/v1",
        LLM_API_KEY: "k",
      } as NodeJS.ProcessEnv)
    ).not.toThrow();
    expect(() =>
      assertGatewayConfigOrThrow({
        LLM_BASE_URL: "https://attacker.example/v1",
        LLM_API_KEY: "k",
      } as NodeJS.ProcessEnv)
    ).toThrow(/not a registered provider host/);
  });

  it("widens only by an explicit operator variable, and the widening is scoped to the gateway", () => {
    const env = {
      LLM_BASE_URL: "https://gateway.internal.example/v1",
      LLM_API_KEY: "k",
      [GATEWAY_HOST_ALLOWLIST_ENV]: "gateway.internal.example",
    } as unknown as NodeJS.ProcessEnv;
    expect(() => assertGatewayConfigOrThrow(env)).not.toThrow();
    expect(gatewayHostAllowlist(env)).toContain("gateway.internal.example");
    // The per-shop column allowlist is NOT widened by it: a row still may not
    // name the gateway, because a row is the thing a future write surface
    // controls and the environment is not.
    expect(isRegisteredProviderUrl("https://gateway.internal.example/v1")).toBe(false);
  });

  it("never puts the gateway key in the refusal message", () => {
    try {
      assertGatewayConfigOrThrow({
        LLM_BASE_URL: "https://attacker.example",
        LLM_API_KEY: "sk-gateway-secret",
      } as NodeJS.ProcessEnv);
      throw new Error("expected a refusal");
    } catch (err) {
      expect((err as Error).message).not.toContain("sk-gateway-secret");
    }
  });
});
