// Device enrollment: issuing a one-time, short-lived, shop-scoped code, and
// redeeming it from the phone that is being enrolled.
//
// **The rule this file implements** (048 §7.3):
//
//   > An `owner` or `manager`, in a privileged session, creates a one-time,
//   > short-lived, shop-scoped enrollment code naming a location. The phone posts
//   > it once and receives a device session; the `device` and `device_credential`
//   > rows are written in that transaction. 034 §2.8's `device.location_id` is
//   > `NOT NULL` (its I7), so an enrollment names a location or fails.
//
// ============================================================================
// THE ONE PLACE 048 §7.1a's DEVICE BINDING CANNOT HOLD, AND WHAT REPLACES IT
// ============================================================================
//
// §7.1a says a token "is redeemable ONLY on a device that already holds a live
// device session enrolled to the same shop the token names". **For an invitation
// that is exactly right and `invitations.ts` enforces it. For an enrollment code
// it is not satisfiable, and reading it literally would make the flow it appears
// in impossible**: the caller of this redemption IS the phone being enrolled, so
// it holds no session, by construction — that is what enrollment means. §7.3's
// own sentence says so in the same record: *"The phone posts it once and
// receives a device session."*
//
// So the binding is unavailable, and §7.1a's other clause governs instead:
//
//   > "A short code without **both** is refused."
//
// **This code is therefore 128 bits** (`ENROLLMENT_CODE_LENGTH`, `codes.ts`) —
// scanned or pasted from the owner's privileged screen to a phone standing next
// to it, which is the case §7.1a says length costs nothing for. It is not a
// preference; with the binding gone there is no other permitted option.
//
// **And the per-shop attempt ceiling cannot rescue a shorter one, which is the
// second and independent reason.** A wrong invitation guess is made on a phone
// that names a shop, so it spends that shop's budget. **A wrong ENROLLMENT guess
// names no shop at all** — the shop is a property of the code, and a code that
// does not exist has no shop — so there is nothing for §7.1a's per-shop ceiling
// to be keyed on until the guess is already correct. What bounds guessing here
// is the route's aggregate bucket (`takeRoute`, taken in the authentication hook
// before any body is parsed) and the entropy, and of those two only the entropy
// is a real bound. 128 bits is doing the work, and it is stated here so nobody
// later "simplifies" this code to six characters for the same counter-ergonomics
// reason that is legitimate one file over.
//
// ============================================================================
// WHAT REDEMPTION IS ALLOWED TO CREATE
// ============================================================================
//
// A `device`, one `device_credential`, one `device_enrollment_code_use`, and a
// device session. **It creates no `app_user`, no `membership` and no
// `operator_pin`** — an enrolled phone on its own reaches exactly *my shops* and
// the operator picker (048 R8, I1), and a person still arrives by invitation.
// The residual 048 §7.4 states is unchanged and is not softened here: the device
// credential is bearer material in a cookie jar on a counter phone, it is not a
// second factor, and it must never be described as one.
//
// ============================================================================
// NO REAL NAMES, NO CODE VALUES (048 §7.1's header)
// ============================================================================
import type { Queryable, Tx } from "../../db.js";
import { digestOf, mintEnrollmentCode } from "./codes.js";
import { ENROLLMENT_TTL_MS, MAX_OUTSTANDING_ENROLLMENT_CODES_PER_SHOP } from "./policy.js";
import { membershipsAt } from "./memberships.js";
import { buildCommit } from "../../config.js";
import { recordAuthorizationDecision } from "./authorizationAudit.js";
import { PERMISSION_MATRIX_VERSION, authorize } from "./permissions.js";
import { recordFailure } from "./pin.js";
import { redemptionWait } from "./invitations.js";
import { mintDeviceCredential } from "./devices.js";

export type DeviceKind = "phone" | "kiosk" | "tablet";

export interface IssuedEnrollmentCode {
  codeId: string;
  /** Returned ONCE. Never logged, never stored, never in an envelope. */
  code: string;
  expiresAt: Date;
}

/**
 * `not_permitted` replaces `not_a_member` (E03-B03): the test is a ROLE and a
 * SCOPE, not a membership, and a refusal name that describes the wrong test is
 * how `issueInvitation`'s missing role check survived review next door.
 */
export type EnrollmentIssueRefusal = "too_many_outstanding" | "not_permitted" | "unknown_location";

/**
 * Issue an enrollment code.
 *
 * The issuer must hold a live `owner` or `manager` membership at the shop
 * (048 §7.3 — "an `owner` or `manager`, in a privileged session"). **The ROLE
 * half is checked here; the PRIVILEGED-SESSION half is not, because privileged
 * sessions do not exist yet** — 048 §4.1's MFA freshness window is E03-D06's,
 * and this bead does not fake it. That is why this function has no HTTP route in
 * this bead and is reached from `scripts/issue-enrollment-code.ts` instead: a
 * route that called itself privileged while nothing enforced privilege would be
 * a worse artifact than an honest CLI. The pending auth-allowlist row names
 * E03-D06 as the bead that lands it.
 *
 * The location must belong to the shop. Checked rather than trusted: this is the
 * one field that ends up `NOT NULL` on a `device` row (034 I7), and a location
 * from another shop would enroll a phone into the wrong tenant's counter.
 */
export async function issueEnrollmentCode(
  tx: Tx,
  args: {
    shopId: string;
    locationId: string;
    deviceLabel: string;
    deviceKind: DeviceKind;
    issuedBy: string;
    now: Date;
  }
): Promise<{ ok: true; enrollment: IssuedEnrollmentCode } | { ok: false; refusal: EnrollmentIssueRefusal }> {
  // E03-B03: the role list that was spelled here in SQL — `role IN
  // ('owner','manager')` — is now read off the matrix, so there is ONE statement
  // of who may equip a store and the CLI, the (pending) route and the tests all
  // read it. `device.enrollment.issue` is LOCATION-scoped: a manager granted at
  // one storefront may set up a phone AT THAT STOREFRONT and nowhere else, which
  // the old query could not express because it never looked at the scope.
  const memberships = await membershipsAt(tx, args.issuedBy, args.shopId);
  const verdict = authorize(memberships, "device.enrollment.issue", {
    atLocation: args.locationId,
    now: args.now,
  });
  // 054 §4.3 (S5′): the second of the two privileged acts, recorded on the same
  // terms as the first — the surface is the script, the chain is null, and the
  // row rides the issuance transaction because a CLI has none to be outside of.
  await recordAuthorizationDecision(tx, {
    shopId: args.shopId,
    routeMethod: "CLI",
    routePath: "scripts/issue-enrollment-code.ts",
    permission: "device.enrollment.issue",
    matrixVersion: PERMISSION_MATRIX_VERSION,
    matrixCommit: buildCommit(),
    membershipId: verdict.kind === "allowed" ? verdict.membershipId : null,
    role: verdict.role ?? null,
    sessionChainId: null,
    decision: verdict.kind === "allowed" ? "allowed" : "refused",
    refusalReason: verdict.kind === "allowed" ? null : verdict.kind === "refused_scope" ? "scope" : "role",
  });
  if (verdict.kind !== "allowed") return { ok: false, refusal: "not_permitted" };

  const location = await tx.query(`SELECT l.id FROM location l WHERE l.id = $1 AND l.shop_id = $2`, [
    args.locationId,
    args.shopId,
  ]);
  if (location.rows.length === 0) return { ok: false, refusal: "unknown_location" };

  const outstanding = await countOutstandingEnrollmentCodes(tx, args.shopId);
  if (outstanding >= MAX_OUTSTANDING_ENROLLMENT_CODES_PER_SHOP) {
    return { ok: false, refusal: "too_many_outstanding" };
  }

  const code = mintEnrollmentCode();
  const expiresAt = new Date(args.now.getTime() + ENROLLMENT_TTL_MS);
  const res = await tx.query(
    `INSERT INTO device_enrollment_code
       (shop_id, location_id, device_label, device_kind, code_digest, expires_at, issued_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [
      args.shopId,
      args.locationId,
      args.deviceLabel,
      args.deviceKind,
      digestOf(code),
      expiresAt,
      args.issuedBy,
    ]
  );
  return {
    ok: true,
    enrollment: { codeId: (res.rows[0] as { id: string }).id, code, expiresAt },
  };
}

/** Unexpired and unredeemed — two predicates, no status column (048 §7.1a). */
export async function countOutstandingEnrollmentCodes(db: Queryable, shopId: string): Promise<number> {
  const res = await db.query(
    `SELECT count(*)::int AS n FROM device_enrollment_code c
      WHERE c.shop_id = $1
        AND c.expires_at > now()
        AND NOT EXISTS (SELECT 1 FROM device_enrollment_code_use u WHERE u.code_id = c.id)`,
    [shopId]
  );
  return (res.rows[0] as { n: number }).n;
}

export interface EnrollmentCodeRow {
  id: string;
  shop_id: string;
  location_id: string;
  device_label: string;
  device_kind: DeviceKind;
  expires_at: Date;
  issued_by: string;
}

export type EnrollmentVerdict =
  { ok: true; code: EnrollmentCodeRow } | { ok: false; reason: "wait" | "unknown" | "spent" | "expired" };

/**
 * **Step one of two: decide, and record the failure.** Its own transaction,
 * which COMMITS whatever the verdict — `invitations.ts` explains why at length
 * and the reason is identical.
 *
 * **The order here differs from the invitation path's, and the difference is
 * forced.** 048 §9.1 puts the throttle before the credential test, and
 * `verifyInvitation` can obey it because the device session names a shop before
 * the token is touched. Here there is no session and the shop is a property of
 * the code, so the lookup has to come first for there to be a key at all. The
 * consequence is stated rather than discovered:
 *
 *   * an UNKNOWN code is bounded by the route's aggregate bucket only (taken in
 *     the hook, before any body parsing) and appends one `auth_attempt` row with
 *     a NULL `shop_id` — `020`'s column is nullable for exactly this case;
 *   * a KNOWN code's shop is then throttled by the per-shop delay, and a shop
 *     inside its delay is refused with NO new attempt row, as everywhere else.
 *
 * That asymmetry is the second reason this code is 128 bits (see the header): a
 * guessing attack never reaches the per-shop ceiling, so the ceiling is not what
 * bounds it and the entropy has to be.
 */
export async function verifyEnrollmentCode(
  tx: Tx,
  args: { code: string; now: Date }
): Promise<EnrollmentVerdict> {
  const res = await tx.query(
    `SELECT c.id, c.shop_id, c.location_id, c.device_label, c.device_kind, c.expires_at, c.issued_by,
            EXISTS (SELECT 1 FROM device_enrollment_code_use u WHERE u.code_id = c.id) AS spent
       FROM device_enrollment_code c WHERE c.code_digest = $1`,
    [digestOf(args.code)]
  );
  const row = res.rows[0] as (EnrollmentCodeRow & { spent: boolean }) | undefined;

  if (!row) {
    await recordFailure(tx, { method: "enrollment_code", failureClass: "unknown_enrollment_code" });
    return { ok: false, reason: "unknown" };
  }

  const wait = await redemptionWait(tx, row.shop_id, "enrollment_code", args.now);
  if (wait > 0) return { ok: false, reason: "wait" };

  const fail = async (failureClass: string, reason: "spent" | "expired"): Promise<EnrollmentVerdict> => {
    await recordFailure(tx, {
      shopId: row.shop_id,
      method: "enrollment_code",
      failureClass,
    });
    return { ok: false, reason };
  };

  if (row.spent) return fail("spent_enrollment_code", "spent");
  if (row.expires_at.getTime() <= args.now.getTime()) return fail("expired_enrollment_code", "expired");
  return { ok: true, code: row };
}

export class EnrollmentCodeAlreadySpent extends Error {
  constructor() {
    super("enrollment code already redeemed");
    this.name = "EnrollmentCodeAlreadySpent";
  }
}

export interface EnrolledDevice {
  deviceId: string;
  credentialId: string;
  /** The device credential's secret. Returned ONCE and stored nowhere. */
  deviceSecret: string;
  shopId: string;
  locationId: string;
}

/**
 * **Step two of two: enroll, in ONE transaction.**
 *
 * The `device`, its `device_credential` and the `device_enrollment_code_use` row
 * commit together (048 §7.3). `UNIQUE (code_id)` decides a race and the loser is
 * REFUSED — the whole INSERT set rolls back with the throw, so a losing
 * redemption leaves no orphan phone in the shop's inventory. That is 048 §7.1a's
 * "single-use is a constraint on both tables or it is a race on one of them",
 * with this table being the one it would have been a race on.
 */
export async function enrollDevice(tx: Tx, args: { code: EnrollmentCodeRow }): Promise<EnrolledDevice> {
  const device = await tx.query(
    `INSERT INTO device (shop_id, location_id, label, kind) VALUES ($1,$2,$3,$4) RETURNING id`,
    [args.code.shop_id, args.code.location_id, args.code.device_label, args.code.device_kind]
  );
  const deviceId = (device.rows[0] as { id: string }).id;

  const credential = await mintDeviceCredential(tx, {
    shopId: args.code.shop_id,
    deviceId,
    // The person who ISSUED the code enrolled this phone. The phone did not
    // enroll itself, and `device_credential.enrolled_by` is a claim about a
    // person — which is why it names the issuer and not the caller.
    enrolledBy: args.code.issued_by,
  });

  const use = await tx.query(
    `INSERT INTO device_enrollment_code_use (shop_id, code_id, device_id, device_credential_id)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (code_id) DO NOTHING
     RETURNING id`,
    [args.code.shop_id, args.code.id, deviceId, credential.credentialId]
  );
  if (use.rows.length === 0) throw new EnrollmentCodeAlreadySpent();

  return {
    deviceId,
    credentialId: credential.credentialId,
    deviceSecret: credential.secret,
    shopId: args.code.shop_id,
    locationId: args.code.location_id,
  };
}
