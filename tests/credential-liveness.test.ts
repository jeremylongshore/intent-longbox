// Liveness is a PREDICATE, and the newest live version wins — 050 §9 I3.
//
// Bead: longbox-e5b.3.5 (alias E03-B05), the code half. Docs: 050 §2 Q2, §4,
// §5(a), §9 I3; 041 §8.
//
// THE FOUR CASES 050 §9 I3 NAMES, and the third is the one the whole record
// exists for: **zero live versions with at least one version row is a refusal,
// and `process.env` is not read.** Without it, retiring a shop's last credential
// would silently move the shop onto the estate's key — a "deletion" that makes
// the system spend somebody else's money instead of stopping.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PROVISIONAL_CREDENTIAL_OVERLAP_DAYS,
  introduceCredentialVersion,
  isLive,
  nextVersionNo,
  pickLiveVersion,
  reportOverlap,
  resolveCredentialVersion,
  retireCredentialVersion,
  setCredentialOverlapSink,
  type CredentialOverlapEvent,
  type CredentialVersionRow,
} from "../src/providers/credentialVersions.js";
import {
  OFFBOARDING_REASON_CODE,
  OFFBOARDING_STEPS,
  TMPFS_ENV_FILE_PATH,
  offboardCredentialVersion,
  renderOffboardingReceipt,
} from "../src/providers/credentialOffboarding.js";
import { resolveVisionProvider, spendOwnerFor } from "../src/providers/registry.js";
import { setCredentialRefusalSink } from "../src/providers/credentialPolicy.js";
import { fakePool } from "./fakes.js";

const SLUG = "testshop";
const KEY_REF = "LONGBOX_TESTSHOP_ANTHROPIC_KEY";

/** The canary. Prefixed `test-` and suffixed `-key` per the fixture convention. */
const CANARY = "test-liveness-canary-key";

const ENV = ["LLM_BASE_URL", "LLM_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", KEY_REF];

let restoreRefusals: () => void;
let overlaps: CredentialOverlapEvent[];
let restoreOverlaps: (e: CredentialOverlapEvent) => void;

beforeEach(() => {
  for (const name of ENV) vi.stubEnv(name, "");
  restoreRefusals = setCredentialRefusalSink(() => undefined) as never;
  overlaps = [];
  restoreOverlaps = setCredentialOverlapSink((e) => overlaps.push(e));
});
afterEach(() => {
  setCredentialRefusalSink(restoreRefusals as never);
  setCredentialOverlapSink(restoreOverlaps);
  vi.unstubAllEnvs();
});

function version(overrides: Partial<CredentialVersionRow> = {}): CredentialVersionRow {
  return {
    id: `ver-${overrides.versionNo ?? 1}`,
    kind: "anthropic",
    keyRef: KEY_REF,
    versionNo: 1,
    introducedAt: new Date("2026-09-01T00:00:00Z"),
    retired: false,
    ...overrides,
  };
}

/** A pool holding exactly these versions for `anthropic`, and no legacy rows. */
function versionPool(rows: CredentialVersionRow[], opts: { legacyRow?: boolean } = {}) {
  return fakePool((text, values) => {
    if (text.includes("FROM shop_credential_version v")) {
      const kind = values?.[1];
      return {
        rows: rows
          .filter((r) => r.kind === kind)
          .map((r) => ({
            id: r.id,
            kind: r.kind,
            key_ref: r.keyRef,
            version_no: r.versionNo,
            introduced_at: r.introducedAt,
            retired: r.retired,
          })),
      };
    }
    if (text.includes("FROM shop_credentials")) {
      return opts.legacyRow === true && values?.[1] === "anthropic"
        ? { rows: [{ kind: "anthropic", key_ref: KEY_REF, base_url: null }] }
        : { rows: [] };
    }
    if (text.includes("FROM shop ")) return { rows: [{ slug: SLUG }] };
    return undefined;
  });
}

describe("isLive / pickLiveVersion — the predicate (050 §2 Q2)", () => {
  it("live means: an introduction exists and no retirement names it", () => {
    expect(isLive(version())).toBe(true);
    expect(isLive(version({ retired: true }))).toBe(false);
  });

  it("case 1 — one live version resolves", () => {
    const out = pickLiveVersion([version()]);
    expect(out.outcome).toBe("live");
    expect(out.outcome === "live" && out.chosen.versionNo).toBe(1);
  });

  it("case 2 — TWO live versions: the greater version_no wins and the overlap is kept", () => {
    // The window rotation exists to have. It is not an error and it is never
    // auto-closed (050 A4): auto-retiring the old key is how a shop stops
    // working at 09:00 on a Tuesday with nobody watching.
    const out = pickLiveVersion([version({ versionNo: 1 }), version({ versionNo: 2 })]);
    expect(out.outcome === "live" && out.chosen.versionNo).toBe(2);
    expect(out.outcome === "live" && out.live).toHaveLength(2);
  });

  it("case 3 — ZERO live with at least one version row is `all_retired`, never a fall-through", () => {
    const out = pickLiveVersion([version({ versionNo: 1, retired: true })]);
    expect(out.outcome).toBe("all_retired");
  });

  it("case 4 — no version rows at all", () => {
    expect(pickLiveVersion([]).outcome).toBe("no_versions");
  });

  it("does not mutate its input while sorting (the caller's array is the caller's)", () => {
    const rows = [version({ versionNo: 1 }), version({ versionNo: 5 })];
    pickLiveVersion(rows);
    expect(rows.map((r) => r.versionNo)).toEqual([1, 5]);
  });
});

describe("the overlap floor is REPORTED and never acted on (050 §2 Q2)", () => {
  it("says nothing about a single live version, or about a young overlap", () => {
    const now = new Date("2026-09-08T00:00:00Z");
    expect(reportOverlap("shop-1", "anthropic", [version()], now)).toBeUndefined();
    const young = [
      version({ versionNo: 1, introducedAt: new Date("2026-09-05T00:00:00Z") }),
      version({ versionNo: 2 }),
    ];
    expect(reportOverlap("shop-1", "anthropic", young, now)).toBeUndefined();
    expect(overlaps).toHaveLength(0);
  });

  it("reports an overlap older than the PROVISIONAL floor — and retires nothing", () => {
    const now = new Date("2026-09-20T00:00:00Z"); // 19 days after the older row
    const event = reportOverlap(
      "shop-1",
      "anthropic",
      [version({ versionNo: 1 }), version({ versionNo: 2 })],
      now
    );
    expect(event).toMatchObject({
      event: "credential.overlap_exceeded_floor",
      shop_id: "shop-1",
      floor_days: PROVISIONAL_CREDENTIAL_OVERLAP_DAYS,
    });
    expect(event?.oldest_overlap_days).toBe(19);
    expect(overlaps).toHaveLength(1);
  });

  it("the report carries version NUMBERS and no key_ref, so it cannot carry a value either", () => {
    const now = new Date("2026-09-20T00:00:00Z");
    reportOverlap("shop-1", "anthropic", [version({ versionNo: 1 }), version({ versionNo: 2 })], now);
    const serialised = JSON.stringify(overlaps[0]);
    expect(serialised).not.toContain(KEY_REF);
    expect(overlaps[0]?.live_version_nos).toEqual([1, 2]);
  });
});

describe("resolveCredentialVersion — the predicate against a pool", () => {
  it("reports the overlap itself rather than leaving it to a caller who might not ask", async () => {
    const { pool } = versionPool([version({ versionNo: 1 }), version({ versionNo: 2 })]);
    const out = await resolveCredentialVersion(pool, "shop-1", "anthropic", new Date("2026-09-30T00:00:00Z"));
    expect(out.outcome).toBe("live");
    expect(overlaps).toHaveLength(1);
  });
});

describe("resolveVisionProvider over the four cases (050 §9 I3)", () => {
  it("case 1 — the newest live version's key_ref resolves, and the version id comes back with it", async () => {
    vi.stubEnv(KEY_REF, CANARY);
    const { pool } = versionPool([version({ versionNo: 1 }), version({ versionNo: 2 })]);
    const resolved = await resolveVisionProvider(pool, "shop-1");
    expect(resolved.provider.id).toBe("anthropic");
    expect(resolved.credentialVersionId).toBe("ver-2");
  });

  it("case 3 — ZERO LIVE VERSIONS REFUSES, and process.env is never read", async () => {
    // The half that makes a deletion real (050 §5(a)). Both variables below are
    // SET: a fall-through would have resolved happily, which is exactly the
    // silent substitution this refuses.
    vi.stubEnv(KEY_REF, CANARY);
    vi.stubEnv("ANTHROPIC_API_KEY", "test-estate-global-key");
    const { pool } = versionPool([version({ versionNo: 1, retired: true })]);
    await expect(resolveVisionProvider(pool, "shop-1")).rejects.toThrow(/every\s+one of them is retired/);
    await expect(resolveVisionProvider(pool, "shop-1")).rejects.toThrow(/spend\s+Longbox's key/);
  });

  it("case 4 — no version rows at all takes the service-account path, attributed to Longbox", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-estate-global-key");
    const { pool } = versionPool([]);
    const resolved = await resolveVisionProvider(pool, "shop-1");
    expect(resolved.provider.id).toBe("anthropic");
    expect(resolved.credentialVersionId).toBeNull();
  });

  it("FAIL CLOSED: a legacy shop_credentials row with NO version row is refused, not ignored", async () => {
    // 050 does not rule on this case, because migration `021` backfills a
    // version for every existing config row. It is refused rather than read as
    // "declares nothing" because the alternative silently regresses 050 §1 E4.
    vi.stubEnv("ANTHROPIC_API_KEY", "test-estate-global-key");
    const { pool } = versionPool([], { legacyRow: true });
    await expect(resolveVisionProvider(pool, "shop-1")).rejects.toThrow(/deprecated shop_credentials table/);
  });

  it("the gateway override still outranks a live version, and the spend is Longbox's", async () => {
    vi.stubEnv("LLM_BASE_URL", "https://api.anthropic.com/v1");
    vi.stubEnv("LLM_API_KEY", "test-gateway-key");
    vi.stubEnv(KEY_REF, CANARY);
    const { pool } = versionPool([version()]);
    const resolved = await resolveVisionProvider(pool, "shop-1");
    expect(resolved.credentialVersionId).toBeNull();
  });
});

describe("spendOwnerFor — a predicate that never refuses (050 §2 Q4(c))", () => {
  it("a live version is `shop`; nothing declared is `longbox`", async () => {
    expect(await spendOwnerFor(versionPool([version()]).pool, "shop-1")).toBe("shop");
    expect(await spendOwnerFor(versionPool([]).pool, "shop-1")).toBe("longbox");
  });

  it("the gateway override is `longbox` even for a shop with a live version (050 §6.3)", async () => {
    vi.stubEnv("LLM_BASE_URL", "https://api.anthropic.com/v1");
    vi.stubEnv("LLM_API_KEY", "test-gateway-key");
    expect(await spendOwnerFor(versionPool([version()]).pool, "shop-1")).toBe("longbox");
  });

  it("A SHOP WHOSE CREDENTIAL IS BROKEN IS STILL `shop`, and it does not throw", async () => {
    // This is why it is a separate function from `resolveVisionProvider`. The
    // ceiling is taken BEFORE the provider is resolved, so a shop at its ceiling
    // with a broken credential must reach the manual path (050 §2 Q4(d)) rather
    // than a 503. It is charged against its OWN floor because it is not going to
    // spend Longbox's money.
    const { pool } = versionPool([version({ retired: true })]);
    await expect(spendOwnerFor(pool, "shop-1")).resolves.toBe("shop");
  });
});

// ---------------------------------------------------------------------------
// The WRITERS and the RECEIPT, without a database.
//
// The database halves are `tests/integration/credential-rotation.test.ts` (I2,
// I7) and `tests/integration/offboarding-receipt.test.ts` (I10), which is where
// the append-only trigger and the unique constraint are proved. What is proved
// HERE is the statement each writer sends and the text the receipt composes —
// the parts a `pg.Pool` can be faked out of, and the parts a reader of a diff
// most needs pinned.
// ---------------------------------------------------------------------------

describe("the writers send an INSERT and nothing else (050 §4)", () => {
  it("introduces a version with the caller's version number, defaulting authorship to `human`", async () => {
    const { pool, calls } = fakePool(() => ({ rows: [{ id: "ver-9" }] }));
    const id = await introduceCredentialVersion(pool, {
      shopId: "shop-1",
      kind: "anthropic",
      keyRef: KEY_REF,
      versionNo: 3,
    });
    expect(id).toBe("ver-9");
    expect(calls[0]?.text).toMatch(/INSERT INTO shop_credential_version/);
    expect(calls[0]?.values).toEqual(["shop-1", "anthropic", KEY_REF, 3, "human"]);
    // No UPDATE path exists in this module, and the trigger would refuse one
    // anyway — the statement really is the whole of what rotation does.
    expect(calls[0]?.text).not.toMatch(/UPDATE|DELETE/i);
  });

  it("takes the version number from `nextVersionNo` rather than computing max()+1 inline", async () => {
    // `UNIQUE (shop_id, kind, version_no)` is what makes a concurrent double
    // introduction fail loudly. A helper that silently retried it would turn a
    // race into a duplicate, so the number is chosen by the caller and the
    // constraint is left to bite.
    const { pool, calls } = fakePool(() => ({ rows: [{ highest: "4" }] }));
    expect(await nextVersionNo(pool, "shop-1", "anthropic")).toBe(5);
    expect(calls[0]?.text).toMatch(/coalesce\(max\(version_no\), 0\)/);
  });

  it("retires by INSERT, and never defaults `provider_revocation_instructed_at` to now()", async () => {
    // Defaulting it would record an instruction that may not have been given —
    // the false statement 041 §8.2 forbids in a receipt (050 §2 Q3).
    const { pool, calls } = fakePool(() => ({ rows: [{ id: "ret-1" }] }));
    await retireCredentialVersion(pool, {
      shopId: "shop-1",
      credentialVersionId: "ver-9",
      reasonCode: "rotation",
    });
    expect(calls[0]?.text).toMatch(/INSERT INTO shop_credential_retirement/);
    expect(calls[0]?.values).toEqual(["shop-1", "ver-9", "rotation", null, "human"]);
  });
});

describe("the offboarding receipt (050 §5, the shape half of I10)", () => {
  const retiredAt = new Date("2026-09-04T10:00:00Z");

  function receiptPool(instructedAt: Date | null) {
    return fakePool((text) =>
      text.includes("FROM shop_credential_retirement")
        ? { rows: [{ retired_at: retiredAt, provider_revocation_instructed_at: instructedAt }] }
        : { rows: [{ id: "ret-1" }] }
    );
  }

  it("names the three steps, the tmpfs path, and the residual — and no key value", async () => {
    vi.stubEnv(KEY_REF, CANARY);
    const { pool } = receiptPool(new Date("2026-09-04T12:00:00Z"));
    const receipt = await offboardCredentialVersion(pool, {
      shopId: "shop-1",
      credentialVersionId: "ver-9",
      kind: "anthropic",
      keyRef: KEY_REF,
      providerRevocationInstructedAt: new Date("2026-09-04T12:00:00Z"),
    });
    expect(receipt.reason_code).toBe(OFFBOARDING_REASON_CODE);
    expect(receipt.steps).toEqual(OFFBOARDING_STEPS);
    expect(receipt.rendered_env_file).toBe(TMPFS_ENV_FILE_PATH);

    const text = renderOffboardingReceipt(receipt);
    expect(text).toContain(KEY_REF);
    expect(text).not.toContain(CANARY);
    expect(text).toContain(TMPFS_ENV_FILE_PATH);
    expect(text).toMatch(/Step 1:.*Step 2:.*Step 3:/s);
    expect(text).toMatch(/instructed to revoke at the provider/i);
    // The sentence this module exists to keep out.
    expect(text).not.toMatch(/\bhas been revoked\b|\bwas revoked\b/i);
  });

  it("says plainly when the shop has NOT been instructed", async () => {
    const { pool } = receiptPool(null);
    const receipt = await offboardCredentialVersion(pool, {
      shopId: "shop-1",
      credentialVersionId: "ver-9",
      kind: "anthropic",
      keyRef: KEY_REF,
    });
    expect(receipt.provider_revocation_instructed_at).toBeNull();
    expect(renderOffboardingReceipt(receipt)).toMatch(/has not yet been instructed/i);
  });

  it("carries `authored_by` through to the retirement when the caller states one (048 §3.5)", async () => {
    const { pool, calls } = receiptPool(null);
    await offboardCredentialVersion(pool, {
      shopId: "shop-1",
      credentialVersionId: "ver-9",
      kind: "anthropic",
      keyRef: KEY_REF,
      authoredBy: "system",
    });
    // An attribution of record and nothing stronger — 048 §3.5's RULE, which 050
    // §2 Q2 adopts without amendment.
    expect(calls[0]?.values?.[4]).toBe("system");
  });

  it("the tmpfs path is under /run and never under /etc or /var (050 §2 Q1)", () => {
    // Four grounds, and the fourth is structural: the borg fabric does not reach
    // `/run` or `/dev/shm` by construction, so no exclude rule has to be
    // maintained for them. A persistent copy's exclusion is a line in a config
    // file somebody could remove.
    expect(TMPFS_ENV_FILE_PATH).toMatch(/^\/run\//);
    expect(TMPFS_ENV_FILE_PATH).not.toMatch(/^\/(etc|var)\//);
  });
});
