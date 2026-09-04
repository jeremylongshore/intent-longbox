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
import { withTransaction } from "../../db.js";
import { DEVICE_COOKIE, OPERATOR_COOKIE, readCookie } from "./policy.js";
import { recordFailure } from "./pin.js";
import {
  parentChainIsLive,
  resolveToken,
  revokeForReuse,
  type SessionRefusal,
  type SessionRow,
} from "./sessions.js";

/** What one request's cookies resolved to. */
export interface Principal {
  device: SessionRow;
  operator?: SessionRow;
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

  const device = await resolveToken(pool, deviceToken, now);
  if ("refusal" in device) return refuse(pool, device.refusal, device.row);

  const operatorToken = readCookie(cookieHeader, OPERATOR_COOKIE);
  if (!operatorToken) return { kind: "resolved", device: device.row, cookies: [] };

  const operator = await resolveToken(pool, operatorToken, now);
  if ("refusal" in operator) return refuse(pool, operator.refusal, operator.row);

  // The pairing check (R1). One comparison, not a state machine: the operator
  // row's parent chain must BE the device cookie's chain. K4's formula needs the
  // parent chain live anyway, and a matched pair makes that the same read.
  if (operator.row.parent_chain_id !== device.row.chain_id) {
    await recordPairMismatch(pool, operator.row);
    return { kind: "refused", refusal: "pair_mismatch", clearCookies: true };
  }
  if (!(await parentChainIsLive(pool, operator.row.parent_chain_id, now))) {
    return { kind: "refused", refusal: "chain_revoked", clearCookies: true };
  }

  return { kind: "resolved", device: device.row, operator: operator.row, cookies: [] };
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
    await withTransaction(pool, async (tx) => {
      await revokeForReuse(tx, row);
      await recordFailure(tx, {
        shopId: row.shop_id,
        deviceId: row.device_id,
        appUserId: row.app_user_id,
        method: "session_token",
        failureClass: "token_reuse",
      });
    });
  }
  return { kind: "refused", refusal, clearCookies: true };
}

async function recordPairMismatch(pool: pg.Pool, operator: SessionRow): Promise<void> {
  await withTransaction(pool, async (tx) => {
    await recordFailure(tx, {
      shopId: operator.shop_id,
      deviceId: operator.device_id,
      appUserId: operator.app_user_id,
      method: "session_token",
      failureClass: "cookie_pair_mismatch",
    });
  });
}
