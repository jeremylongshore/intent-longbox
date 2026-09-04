// The device principal: resolving a presented device secret to a live,
// unrevoked credential and the phone it belongs to.
//
// **What this file is NOT.** It does not ENROLL a device. Minting a credential —
// the one-time, short-lived, shop-scoped enrollment code an owner creates in a
// privileged session, and the `device` + `device_credential` rows written in that
// transaction — is 048 §7.3, and is **E03-D07's** (048 §10.2, §12.4 row 4). What
// lands here is the other half, which E03-D09 cannot do without: given a secret a
// phone already holds, decide whether it names a live credential.
//
// The two are genuinely separable and the split is not a convenience: enrollment
// needs the E05 screens and carries E13's delivery decision, while VERIFICATION is
// what every request on the device chain depends on. `scripts/register-shop.ts`
// mints one credential for local development, which is the seam E03-D07 replaces
// with a real flow rather than a shape it has to undo.
import type { Queryable, Tx } from "../../db.js";
import { digestsMatch, mintToken, tokenHash } from "./secrets.js";

export interface DeviceCredentialRow {
  credential_id: string;
  device_id: string;
  shop_id: string;
  location_id: string;
  token_hash: string;
}

/**
 * Resolve a presented secret to a live credential, or nothing.
 *
 * The revocation predicate is a `NOT EXISTS` over `device_credential_revocation`,
 * whose `UNIQUE (credential_id)` is 034 §2.7's grant/release idiom again: the
 * credential row was never wrong, and its ending is a separate fact. **Revoking
 * it kills the device session and every operator session above it on the next
 * request** — 048 §7.3 — which is §3.3's derivation doing its job with no sweep.
 */
export async function resolveDeviceCredential(
  db: Queryable,
  secret: string
): Promise<DeviceCredentialRow | undefined> {
  const res = await db.query(
    `SELECT c.id AS credential_id, c.device_id, c.shop_id, d.location_id, c.token_hash
       FROM device_credential c
       JOIN device d ON d.id = c.device_id
      WHERE c.token_hash = $1
        AND NOT EXISTS (
              SELECT 1 FROM device_credential_revocation r WHERE r.credential_id = c.id)`,
    [tokenHash(secret)]
  );
  const row = res.rows[0] as DeviceCredentialRow | undefined;
  // The lookup is already an indexed equality on the digest, so this comparison
  // adds nothing cryptographically — it is here so the ONE place a caller could
  // later pass a candidate digest from somewhere else is already constant-time.
  if (!row || !digestsMatch(row.token_hash, tokenHash(secret))) return undefined;
  return row;
}

/**
 * Mint a credential for an existing device. Returns the secret ONCE.
 *
 * The secret is 256 bits from a CSPRNG and the database stores `sha256` of it
 * (034 v1.2.0 §2.8, as amended by 048 §7.4). The residual is stated at §7.4 and
 * is not softened here: this makes the device credential **bearer material
 * sitting in a browser cookie jar on a phone that lives on a shop counter**. It
 * is not a second factor and must never be described as one — it authenticates
 * an APP INSTANCE, which is a claim about a phone and not about a person. Its
 * compensating controls are that it is `HttpOnly` and `__Host-` prefixed, that it
 * is revocable in one row, and that on its own it reaches exactly *my shops* and
 * the operator picker (048 R8, I1). A passkey-style keypair in the phone's secure
 * element is the correct end state and is filed for E03-B05.
 */
export async function mintDeviceCredential(
  tx: Tx,
  args: { shopId: string; deviceId: string; enrolledBy?: string | null }
): Promise<{ credentialId: string; secret: string }> {
  const secret = mintToken();
  const res = await tx.query(
    `INSERT INTO device_credential (shop_id, device_id, token_hash, enrolled_by)
     VALUES ($1,$2,$3,$4) RETURNING id`,
    [args.shopId, args.deviceId, tokenHash(secret), args.enrolledBy ?? null]
  );
  return { credentialId: (res.rows[0] as { id: string }).id, secret };
}
