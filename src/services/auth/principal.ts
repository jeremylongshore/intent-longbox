// Resolving the two cookies to a principal, once per request, before any handler
// runs — and the refusals, which all look the same on the wire.
//
// 048 §3.6 (R1): the operator session's row carries `parent_session_id`, and the
// hook asserts that it resolves to the SAME CHAIN as the device cookie. **A pair
// that does not match is ONE refusal** — both cookies cleared, the client falls
// back to the device-session flow — and there is no reconciliation, no repair and
// no third state. Presenting an operator cookie with no device cookie, a device
// cookie from another device, or two cookies from two different chains are all
// the same refusal, which is §9.3's constant-answer rule applied to a shape §9.3
// did not previously cover.
//
// **And the mismatch is a SIGNAL, not just an error.** An operator token
// presented against a device chain it was not issued under is precisely the shape
// of a cookie lifted from one phone onto another, and it is recorded as an
// `auth_attempt` failure — the one place the two-cookie design buys a detection
// the single-cookie design could not express.
import type pg from "pg";
import { serviceDb, withTransaction } from "../../db.js";
import { DEVICE_COOKIE, OPERATOR_COOKIE, PRIVILEGED_COOKIE, readCookie } from "./policy.js";
import { recordFailure } from "./pin.js";
import {
  asDeviceBound,
  parentChainIsLive,
  resolveToken,
  revokeForReuse,
  type DeviceBoundSession,
  type SessionRefusal,
  type SessionRow,
} from "./sessions.js";

/** What one request's cookies resolved to. */
export interface Principal {
  device: DeviceBoundSession;
  operator?: DeviceBoundSession;
  /**
   * Tokens minted while resolving THIS request (the K2 grace path mints none).
   * They are set on the response by the `onSend` hook, never written here: a
   * cookie set from a resolver is a side effect in a function whose whole job is
   * to answer a question.
   */
  cookies: string[];
}

export type PrincipalOutcome =
  | { kind: "anonymous" }
  | { kind: "refused"; refusal: SessionRefusal | "pair_mismatch"; clearCookies: true }
  | ({ kind: "resolved" } & Principal);

/**
 * Resolve the device cookie, then the operator cookie on top of it.
 *
 * The order is not cosmetic: an operator session is only meaningful relative to a
 * live device session (048 §3.1's two principals), and resolving the person first
 * would make "which phone is this" a question answered after the person's
 * identity had already been trusted.
 */
export async function resolvePrincipal(
  pool: pg.Pool,
  cookieHeader: string | undefined,
  now: Date
): Promise<PrincipalOutcome> {
  const deviceToken = readCookie(cookieHeader, DEVICE_COOKIE);
  if (!deviceToken) return { kind: "anonymous" };

  // EVERY READ IN THIS FUNCTION RUNS IN THE `session-resolution` SCOPE (E03-B04).
  // A cookie is a digest, not a tenant: the row this finds is what establishes
  // `shop_id` for the whole request (048 §6.1), so the lookup cannot carry the
  // tenant it is about to produce. The scope is a member of the closed union in
  // `src/db/tenantContext.ts` and `pnpm arch` holds the number of call sites that
  // may name it. Everything AFTER this — the membership read, the permission
  // decision, the request's own transaction — runs on the resolved shop.
  const db = serviceDb(pool, "session-resolution");
  const device = await resolveToken(db, deviceToken, now);
  if ("refusal" in device) return refuse(pool, device.refusal, device.row);

  // ⚠ **THE COOKIE SLOT IS NOT THE KIND, AND THIS IS WHERE THAT IS CHECKED**
  // (E03-D11, 057 §4.2). Every session in this system is one row in one table
  // resolved by one digest, so a PRIVILEGED token pasted into `__Host-lb_device`
  // resolves perfectly well — and would then be a "device session" whose
  // `device_id`, `device_credential_id` and `location_id` are all NULL, with the
  // tenant resolving, the rate bucket keying on `undefined`, and every fact
  // downstream carrying a device that does not exist. `asDeviceBound` is the one
  // narrowing, it checks the KIND and the three columns, and a row that fails it
  // is 048 §9.3's constant refusal rather than a cast.
  const deviceRow = asDeviceBound(device.row);
  if (!deviceRow) return { kind: "refused", refusal: "unknown_token", clearCookies: true };

  const operatorToken = readCookie(cookieHeader, OPERATOR_COOKIE);
  if (!operatorToken) return { kind: "resolved", device: deviceRow, cookies: [] };

  const operator = await resolveToken(db, operatorToken, now);
  if ("refusal" in operator) return refuse(pool, operator.refusal, operator.row);
  const operatorRow = asDeviceBound(operator.row);
  if (!operatorRow) return { kind: "refused", refusal: "unknown_token", clearCookies: true };

  // The pairing check (R1). One comparison, not a state machine: the operator
  // row's parent chain must BE the device cookie's chain. K4's formula needs the
  // parent chain live anyway, and a matched pair makes that the same read.
  if (operatorRow.parent_chain_id !== deviceRow.chain_id) {
    await recordPairMismatch(pool, operatorRow);
    return { kind: "refused", refusal: "pair_mismatch", clearCookies: true };
  }
  if (!(await parentChainIsLive(db, operatorRow.parent_chain_id, now))) {
    return { kind: "refused", refusal: "chain_revoked", clearCookies: true };
  }

  return { kind: "resolved", device: deviceRow, operator: operatorRow, cookies: [] };
}

/** What the third cookie resolved to. Deliberately its own outcome type. */
export type PrivilegedOutcome =
  | { kind: "anonymous" }
  | { kind: "refused"; refusal: SessionRefusal | "wrong_kind" }
  | { kind: "resolved"; privileged: SessionRow };

/**
 * **Resolve the PRIVILEGED cookie, and only it** (048 §4.1, §12.4 row 3a).
 *
 * A separate function and a separate outcome type rather than a third branch of
 * `resolvePrincipal`, and the separation is the control (057 §4.2):
 *
 *   * a privileged route reads THIS cookie and no other, so an operator session
 *     on a shared counter phone can never satisfy one — which is 048 §4.1's
 *     *"never an operator session on a shared phone"* made unconstructible
 *     rather than checked;
 *   * a device or operator route reads the other two and never this one, so an
 *     owner who holds a live privileged cookie in the same browser does not
 *     thereby acquire a device session, and the counter flow is untouched;
 *   * there is no PAIR here and therefore no pair check. §3.6's mismatch rule
 *     exists because an operator session sits on a device session; a privileged
 *     session sits on nothing, and inventing a pairing for it would be a state
 *     machine on the wire for no gain — §3.6's own words about the case it
 *     refused.
 *
 * A token of the wrong KIND presented in this slot is refused, symmetrically
 * with `asDeviceBound` above and for the same reason.
 */
export async function resolvePrivileged(
  pool: pg.Pool,
  cookieHeader: string | undefined,
  now: Date
): Promise<PrivilegedOutcome> {
  const token = readCookie(cookieHeader, PRIVILEGED_COOKIE);
  if (!token) return { kind: "anonymous" };

  const db = serviceDb(pool, "session-resolution");
  const resolved = await resolveToken(db, token, now);
  if ("refusal" in resolved) {
    // Reuse revokes the chain here exactly as it does for the other two — see
    // `revokeForReuse`, whose test is `!== "device"` so this kind takes the
    // revoking branch rather than the one that looks for children it has none of.
    await refuse(pool, resolved.refusal, resolved.row);
    return { kind: "refused", refusal: resolved.refusal };
  }
  if (resolved.row.kind !== "privileged") return { kind: "refused", refusal: "wrong_kind" };
  return { kind: "resolved", privileged: resolved.row };
}

/**
 * A refusal, plus the one side effect a refusal may have.
 *
 * Reuse — a token presented after its successor exists and outside the grace
 * window — revokes the OPERATOR chain and never the device chain (048 K2). The
 * revocation runs in its own small transaction because the request has none yet:
 * the hook resolves before `runIdempotent` opens one, and deferring a security
 * action until a transaction the request may never open would make the detector
 * conditional on the route.
 */
async function refuse(
  pool: pg.Pool,
  refusal: SessionRefusal,
  row: SessionRow | undefined
): Promise<PrincipalOutcome> {
  if (refusal === "token_reuse" && row) {
    // The tenant is known HERE even though the lookup that found the row could not
    // name one: the row carries `shop_id`. So the revocation and its failure row
    // are written under an ordinary tenant context, not under a service scope —
    // the scope covers the reads that cannot name a tenant, never the writes that
    // can (E03-B04).
    await withTransaction(
      pool,
      async (tx) => {
        await revokeForReuse(tx, row);
        await recordFailure(tx, {
          shopId: row.shop_id,
          deviceId: row.device_id,
          appUserId: row.app_user_id,
          method: "session_token",
          failureClass: "token_reuse",
        });
      },
      { tenant: { shopId: row.shop_id } }
    );
  }
  return { kind: "refused", refusal, clearCookies: true };
}

async function recordPairMismatch(pool: pg.Pool, operator: SessionRow): Promise<void> {
  await withTransaction(
    pool,
    async (tx) => {
      await recordFailure(tx, {
        shopId: operator.shop_id,
        deviceId: operator.device_id,
        appUserId: operator.app_user_id,
        method: "session_token",
        failureClass: "cookie_pair_mismatch",
      });
    },
    { tenant: { shopId: operator.shop_id } }
  );
}
