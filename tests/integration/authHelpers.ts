// Seeding the identity substrate for the E03-D09 suites, and the two cookie
// helpers every one of them needs.
//
// It lives beside `helpers.ts` rather than inside it because these functions
// know about 048's construction — two chains, a device credential, a PIN under a
// pepper — and `helpers.ts` is the lane's plumbing. A suite that wants a shop
// asks for a shop; a suite that wants a signed-in phone asks here.
//
// **No shop's name, no person's name, no code from anywhere real** (048 §7.1's
// header rule, applied to fixtures): every value below is obviously synthetic,
// because an invitation-and-PIN flow is exactly the surface where a "realistic"
// example becomes somebody's name in a repository.
import type pg from "pg";
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from "fastify";
import { withTransaction } from "../../src/db.js";
import {
  DEVICE_COOKIE,
  OPERATOR_COOKIE,
  issueDeviceSession,
  issueOperatorSession,
  mintDeviceCredential,
  setOperatorPin,
  type IssuedSession,
} from "../../src/services/auth/index.js";
import { TEST_PIN_PEPPER } from "../testConfig.js";

/** A PIN that satisfies 048 §3.5's policy: six digits, no run, no repeat. */
export const TEST_PIN = "428713";

export interface SeededIdentity {
  shopId: string;
  locationId: string;
  deviceId: string;
  credentialId: string;
  deviceSecret: string;
  ownerId: string;
  operatorId: string;
}

/**
 * One shop's identity rows: a location, a phone with a live credential, an owner
 * and an operator, both with memberships, and a PIN for each on that phone.
 */
export async function seedIdentity(
  pool: pg.Pool,
  shopId: string,
  opts: { suffix?: string } = {}
): Promise<SeededIdentity> {
  const suffix = opts.suffix ?? Math.random().toString(36).slice(2, 8);
  const location = await pool.query(
    `INSERT INTO location (shop_id, kind, name) VALUES ($1,'store','Counter') RETURNING id`,
    [shopId]
  );
  const locationId = (location.rows[0] as { id: string }).id;

  const device = await pool.query(
    `INSERT INTO device (shop_id, location_id, label, kind) VALUES ($1,$2,'counter phone','phone')
     RETURNING id`,
    [shopId, locationId]
  );
  const deviceId = (device.rows[0] as { id: string }).id;

  const owner = await insertUser(pool, `owner-${suffix}@example.invalid`, "Owner One");
  const operator = await insertUser(pool, `operator-${suffix}@example.invalid`, "Operator Two");
  await grant(pool, owner, shopId, "owner");
  await grant(pool, operator, shopId, "operator");

  const minted = await withTransaction(pool, async (tx) => {
    const credential = await mintDeviceCredential(tx, { shopId, deviceId, enrolledBy: owner });
    for (const appUserId of [owner, operator]) {
      const set = await setOperatorPin(tx, {
        shopId,
        deviceId,
        appUserId,
        pin: TEST_PIN,
        pepper: TEST_PIN_PEPPER,
      });
      if (!set.ok) throw new Error(`seed PIN refused: ${set.refusal}`);
    }
    return credential;
  });

  return {
    shopId,
    locationId,
    deviceId,
    credentialId: minted.credentialId,
    deviceSecret: minted.secret,
    ownerId: owner,
    operatorId: operator,
  };
}

export async function insertUser(pool: pg.Pool, email: string, displayName: string): Promise<string> {
  const res = await pool.query(`INSERT INTO app_user (email, display_name) VALUES ($1,$2) RETURNING id`, [
    email.toLowerCase(),
    displayName,
  ]);
  return (res.rows[0] as { id: string }).id;
}

export async function grant(
  pool: pg.Pool,
  appUserId: string,
  shopId: string,
  role: "owner" | "manager" | "operator" | "support_break_glass"
): Promise<string> {
  const isBreakGlass = role === "support_break_glass";
  const res = await pool.query(
    `INSERT INTO membership (app_user_id, shop_id, scope_kind, role, effective_until, reason)
     VALUES ($1,$2,'shop',$3,$4,$5) RETURNING id`,
    [
      appUserId,
      shopId,
      role,
      // 034 §2.7's CHECK: a break-glass grant with no expiry and no reason is
      // the failure mode the role exists to prevent.
      isBreakGlass ? new Date(Date.now() + 60 * 60 * 1000) : null,
      isBreakGlass ? "test grant" : null,
    ]
  );
  return (res.rows[0] as { id: string }).id;
}

/** Issue a device session directly, bypassing the route, for suites testing something else. */
export async function openDevice(pool: pg.Pool, id: SeededIdentity): Promise<IssuedSession> {
  return withTransaction(pool, (tx) =>
    issueDeviceSession(tx, {
      shopId: id.shopId,
      locationId: id.locationId,
      deviceId: id.deviceId,
      deviceCredentialId: id.credentialId,
      now: new Date(),
    })
  );
}

export async function openOperator(
  pool: pg.Pool,
  device: IssuedSession,
  appUserId: string
): Promise<IssuedSession> {
  return withTransaction(pool, (tx) =>
    issueOperatorSession(tx, { parent: device.row, appUserId, now: new Date() })
  );
}

/**
 * `app.inject`, already carrying a live device + operator session and the
 * same-origin header — the shape every suite that exercises a shop-scoped route
 * now needs, because after E03-D09 there are no anonymous ones.
 *
 * **It adds no `Idempotency-Key`**, deliberately. That header is 042 §5.1's and
 * several suites assert its ABSENCE produces `400 IDEMPOTENCY_KEY_REQUIRED`; a
 * helper that supplied one would quietly delete those assertions. What it does
 * supply is the pair a suite can only forget — the cookies and
 * `sec-fetch-site` — so a forgotten one fails as the thing under test rather
 * than as a 401 about something else.
 */
export type AuthedInject = (opts: InjectOptions) => Promise<LightMyRequestResponse>;

export function injectAs(app: FastifyInstance, cookie: string): AuthedInject {
  return (opts) =>
    app.inject({
      ...opts,
      headers: { "sec-fetch-site": "same-origin", cookie, ...(opts.headers ?? {}) },
    });
}

export interface SignedIn {
  inject: AuthedInject;
  identity: SeededIdentity;
  device: IssuedSession;
  operator: IssuedSession;
  cookie: string;
}

/** Seed the identity rows, open both chains, and hand back a signed-in injector. */
export async function signIn(
  pool: pg.Pool,
  app: FastifyInstance,
  shopId: string,
  opts: { as?: "owner" | "operator" } = {}
): Promise<SignedIn> {
  const identity = await seedIdentity(pool, shopId);
  const device = await openDevice(pool, identity);
  const operator = await openOperator(
    pool,
    device,
    opts.as === "owner" ? identity.ownerId : identity.operatorId
  );
  const cookie = cookieHeader(device.token, operator.token);
  return { inject: injectAs(app, cookie), identity, device, operator, cookie };
}

/** The `Cookie` header a request carries for one or both chains. */
export function cookieHeader(device?: string, operator?: string): string {
  const parts: string[] = [];
  if (device !== undefined) parts.push(`${DEVICE_COOKIE}=${device}`);
  if (operator !== undefined) parts.push(`${OPERATOR_COOKIE}=${operator}`);
  return parts.join("; ");
}

/**
 * The headers a same-origin mutating request carries.
 *
 * `sec-fetch-site: same-origin` is 048 §5.1's own mechanism and is REQUIRED on
 * every non-safe method; `idempotency-key` is 042 §5.1's, enforced by the hook
 * ahead of the multipart parser (R10). A helper spells both so a suite that
 * forgets one gets a test failure about the thing it was testing rather than a
 * 401 about the thing it was not.
 */
export function writeHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "sec-fetch-site": "same-origin",
    "idempotency-key": `key-${Math.random().toString(36).slice(2)}`,
    ...extra,
  };
}
