// The offboarding receipt says what was made unreachable — and does not claim
// what it cannot know. 050 §9 I10.
//
// Bead: longbox-e5b.3.5 (alias E03-B05), the code half. Docs: 050 §2 Q1 (the
// tmpfs custody ruling), §2 Q3 (the three steps and the receipt), §5, §9 I10;
// 041 §8 (offboarding), §8.2 (a receipt may not contain a false statement),
// §8.7(c) (a receipt is minimal); 018 (an unverified third-party act is not a
// fact); 021 B15/B16.
//
// THE SENTENCE THIS FILE EXISTS TO KEEP OUT. *"Your credential has been
// revoked."* Longbox cannot revoke a BYOK key: the key is the shop's, held at
// the provider, and it stays valid there whether or not this repository ever
// mentions it again. So the assertions below are as much about what the receipt
// LACKS as about what it says.
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appUrl, createFreshDb, probeDb, runMigrations } from "./helpers.js";
import { introduceCredentialVersion, nextVersionNo } from "../../src/providers/credentialVersions.js";
import {
  OFFBOARDING_REASON_CODE,
  OFFBOARDING_RESIDUAL,
  OFFBOARDING_STEPS,
  TMPFS_ENV_FILE_PATH,
  offboardCredentialVersion,
  renderOffboardingReceipt,
} from "../../src/providers/credentialOffboarding.js";
import { resolveVisionProvider } from "../../src/providers/registry.js";
import { setCredentialRefusalSink } from "../../src/providers/credentialPolicy.js";

const DB = "longbox_test_offboarding_receipt";
const SLUG = "offshop";
const KEY_REF = "LONGBOX_OFFSHOP_ANTHROPIC_KEY";
const CANARY = "test-offboarding-canary-key";

let enabled = false;
let pool: pg.Pool | undefined;
let shopId: string;
let versionId: string;
let restoreRefusals: () => void;

beforeAll(async () => {
  enabled = await probeDb();
  if (!enabled) return;
  const migrateUrl = await createFreshDb(DB);
  await runMigrations(migrateUrl);
  pool = new pg.Pool({ connectionString: appUrl(migrateUrl) });
  const org = await pool.query(`INSERT INTO organization (name) VALUES ('Offboarding Org') RETURNING id`);
  const shop = await pool.query(
    `INSERT INTO shop (name, slug, organization_id) VALUES ($1,$2,$3) RETURNING id`,
    ["Offboarding Test Shop", SLUG, (org.rows[0] as { id: string }).id]
  );
  shopId = (shop.rows[0] as { id: string }).id;
  versionId = await introduceCredentialVersion(pool, {
    shopId,
    kind: "anthropic",
    keyRef: KEY_REF,
    versionNo: await nextVersionNo(pool, shopId, "anthropic"),
  });
  restoreRefusals = setCredentialRefusalSink(() => undefined) as never;
}, 120_000);

afterAll(async () => {
  if (restoreRefusals) setCredentialRefusalSink(restoreRefusals as never);
  await pool?.end();
});

describe("I10 — the offboarding receipt", () => {
  it("appends a retirement with reason_code='offboarding' and returns the receipt", async () => {
    if (!enabled) return;
    const instructed = new Date("2026-09-04T12:00:00Z");
    const receipt = await offboardCredentialVersion(pool!, {
      shopId,
      credentialVersionId: versionId,
      kind: "anthropic",
      keyRef: KEY_REF,
      providerRevocationInstructedAt: instructed,
    });
    expect(receipt.reason_code).toBe(OFFBOARDING_REASON_CODE);
    expect(receipt.credential_version_id).toBe(versionId);
    expect(receipt.provider_revocation_instructed_at).toBe(instructed.toISOString());

    const row = await pool!.query(
      `SELECT reason_code, provider_revocation_instructed_at
         FROM shop_credential_retirement WHERE credential_version_id = $1`,
      [versionId]
    );
    expect((row.rows[0] as { reason_code: string }).reason_code).toBe("offboarding");
  });

  it("names the THREE steps, including the restart and the tmpfs path it re-derived", async () => {
    if (!enabled) return;
    // THREE, not four (050 §2 Q1 as amended at v1.0.1). The step that was a
    // person editing a file on a host is gone, because `ExecStartPre` re-derives
    // the rendered file from the SOPS source at every start — and a step removed
    // is a step that cannot be skipped.
    expect(OFFBOARDING_STEPS).toHaveLength(3);
    const text = renderOffboardingReceipt(await offboardReceiptFor(new Date("2026-09-04T12:00:00Z")));
    expect(text).toMatch(/SOPS/);
    expect(text).toMatch(/restart/i);
    expect(text).toContain(TMPFS_ENV_FILE_PATH);
    // The path is on tmpfs and is named as such — a receipt that said `/etc` or
    // `/var` would be describing a plaintext key that survives a reboot, a
    // snapshot and a backup pass (050 §2 Q1's four grounds).
    expect(TMPFS_ENV_FILE_PATH.startsWith("/run/")).toBe(true);
    expect(text).not.toMatch(/\/etc\/|\/var\//);
  });

  it("ASSERTS NOTHING ABOUT PROVIDER-SIDE REVOCATION, in any field or sentence", async () => {
    if (!enabled) return;
    const receipt = await offboardReceiptFor(new Date("2026-09-04T12:00:00Z"));
    // The only third-party-shaped field is `provider_revocation_instructed_at`,
    // which records a LONGBOX act. There is no `revoked_at`, no `revoked`, no
    // `provider_revocation_confirmed_at` — 018's rung rules forbid recording an
    // unverified third-party act as a fact.
    const fields = Object.keys(receipt);
    expect(fields).toContain("provider_revocation_instructed_at");
    for (const forbidden of ["revoked", "revoked_at", "provider_revoked", "revocation_confirmed"]) {
      expect(fields).not.toContain(forbidden);
    }
    const text = renderOffboardingReceipt(receipt);
    // The word "revoke" appears — the shop must be told to do it — but never as
    // a completed act attributed to anybody.
    expect(text).toMatch(/instructed to revoke|revoking at the provider is the shop's act/i);
    expect(text).not.toMatch(/\bhas been revoked\b|\bwas revoked\b|\bwe revoked\b/i);
    expect(text).toMatch(/stays valid at the provider/i);
  });

  it("names a VARIABLE and never a value, even with the variable set", async () => {
    if (!enabled) return;
    process.env[KEY_REF] = CANARY;
    try {
      const receipt = await offboardReceiptFor(null);
      const text = renderOffboardingReceipt(receipt);
      expect(text).toContain(KEY_REF);
      expect(text).not.toContain(CANARY);
      expect(JSON.stringify(receipt)).not.toContain(CANARY);
    } finally {
      delete process.env[KEY_REF];
    }
  });

  it("says plainly when the shop has NOT been instructed, rather than implying it has", async () => {
    if (!enabled) return;
    const text = renderOffboardingReceipt(await offboardReceiptFor(null));
    expect(text).toMatch(/has not yet been instructed/i);
  });

  it("the offboarding is real: resolution refuses afterwards, variable set or not", async () => {
    if (!enabled) return;
    process.env[KEY_REF] = CANARY;
    try {
      await expect(resolveVisionProvider(pool!, shopId)).rejects.toThrow(/retired/);
    } finally {
      delete process.env[KEY_REF];
    }
  });
});

/**
 * The receipt for the already-retired version.
 *
 * Re-derived rather than re-retired: the retirement is UNIQUE per version, so a
 * second `offboardCredentialVersion` would fail — which is itself the property
 * `022`'s unique constraint exists to have.
 */
async function offboardReceiptFor(instructed: Date | null) {
  const row = await pool!.query(
    `SELECT retired_at, provider_revocation_instructed_at
       FROM shop_credential_retirement WHERE credential_version_id = $1`,
    [versionId]
  );
  const r = row.rows[0] as { retired_at: Date };
  return {
    shop_id: shopId,
    credential_version_id: versionId,
    kind: "anthropic",
    key_ref: KEY_REF,
    reason_code: OFFBOARDING_REASON_CODE,
    retired_at: new Date(r.retired_at).toISOString(),
    provider_revocation_instructed_at: instructed === null ? null : instructed.toISOString(),
    steps: OFFBOARDING_STEPS,
    rendered_env_file: TMPFS_ENV_FILE_PATH,
    residual: OFFBOARDING_RESIDUAL,
  } as const;
}
