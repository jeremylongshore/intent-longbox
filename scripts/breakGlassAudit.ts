// 019 T35(c)'s RECONCILIATION, AGGREGATED FOR AN OPERATOR (E03-D14).
//
// Docs: 000-docs/058 §4; 019 T35(c) (NON-WAIVABLE — *"periodic reconciliation of
// Longbox-origin database sessions against break-glass rows"*; *"any unmatched
// session → K1"*), T34 (a detector that goes stale is itself a K1); 022 P3 (staff
// data serves learning and support, never covert measurement); 034 §3.4 (what a
// K1 costs); 054 §6.
//
// **WHY IT LIVES UNDER `scripts/` AND NOT UNDER `src/`.** `crossTenantAudit.ts`
// set the precedent one threshold over and the reasoning is unchanged: its only
// runtime caller is a CLI, so `depcruise`'s no-orphans rule over `src/` keeps
// meaning what it says. When E13-B04-D1 (`longbox-e5b.13.4.1`, whose acceptance
// carries the daily-schedule clause — not its parent E13-B04, which is health and
// readiness) gives it a scheduled home inside the running
// process it moves — and that move is the signal it has become part of the system
// rather than an operator's tool. The QUERY stays in `src/services/auth/`, where
// 034 §3.3 puts every read of a person; this file only counts what it returns.
//
// ============================================================================
// WHAT IT PRINTS, AND THE ONE IDENTIFIER IT IS WILLING TO PRINT
// ============================================================================
//
// **COUNTS, per shop, per population.** Never a session id, never an
// `app_user_id`, never a display name, never a timestamp of an individual
// session. 019 T35 signs per-operator rendering at zero and 022 P3 forbids the
// covert timeclock; a detector whose output was a list of people would be the
// artifact it exists to protect against, with a cron entry.
//
// ⚠ **IT NAMES NO PERSON BY IDENTIFIER, WHICH IS NOT THE SAME AS NAMING NO
// PERSON** (the security lens's F7). At pilot scale a count of one at a shop
// with one designated person identifies that person to anybody who knows the
// roster, and no projection can prevent that — the finding IS about somebody.
// What the output withholds is the identifier: nothing here can be JOINED to a
// session, a scan or a shift, which is the property 022 P3 asks for. Saying
// "names no person" flatly would be a stronger claim than the shape supports.
//
// The ONE identifier it prints is the **shop id**, and the line between them is
// the same one `crossTenantAudit.ts` draws: a shop id names a TENANT, which is
// what an operator must know to act on a finding, and it names no person. The
// person is reachable only through the identity module's audited accessor
// (E03-D17), which is where 034 §3.3 puts that read and where it stays.
import {
  liveOriginDesignationCount,
  unreconciledBreakGlassSessions,
  type UnreconciledSession,
} from "../src/services/auth/index.js";

/** The minimum client surface this module needs. */
export interface AuditClient {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
}

/**
 * The default lookback for the EXIT CODE, in hours.
 *
 * 24, to match the daily cadence 019 T24 and T35(c) describe, and it is a
 * PROVISIONAL floor rather than a signed value — 058 §4 says so in as many
 * words, so no artifact may quote it as a detection guarantee.
 *
 * **Why there is a window at all.** The history is append-only, so an
 * unreconciled session can never be repaired — only investigated. An audit with
 * no window therefore stays red forever after one incident, and an exit code
 * that is permanently red is an exit code a scheduler learns to ignore. The
 * INCIDENT is the K1 row in 000-docs/006; the exit code is for the cadence.
 * `--all` asks the unbounded question, which is the one an investigation wants.
 */
export const DEFAULT_LOOKBACK_HOURS = 24;

/** One shop's counts. No identifiers beyond the tenant. */
export interface ShopFinding {
  readonly shopId: string;
  /** Sessions of a person who was LONGBOX-ORIGIN when the session was issued. */
  readonly longboxOrigin: number;
  /** Sessions of a break-glass holder who is not Longbox-origin. */
  readonly breakGlassHolder: number;
}

export interface BreakGlassAuditResult {
  /** The window in hours, or null for "every session ever". */
  readonly windowHours: number | null;
  /** How many people are Longbox-origin right now — the "ran over nothing" guard. */
  readonly designations: number;
  readonly findings: readonly ShopFinding[];
  readonly unreconciled: number;
  /** True when nothing was found. */
  readonly clean: boolean;
}

/**
 * Fold the rows into per-shop counts, sorted, dropping every identifier but the
 * tenant.
 *
 * A pure function so a unit test can assert the projection without a database —
 * and because "this output contains no person" is a property worth proving
 * directly rather than inferring from a printed line.
 */
export function summariseUnreconciled(rows: readonly UnreconciledSession[]): ShopFinding[] {
  const byShop = new Map<string, { longboxOrigin: number; breakGlassHolder: number }>();
  for (const row of rows) {
    const entry = byShop.get(row.shopId) ?? { longboxOrigin: 0, breakGlassHolder: 0 };
    if (row.longboxOrigin) entry.longboxOrigin += 1;
    else entry.breakGlassHolder += 1;
    byShop.set(row.shopId, entry);
  }
  return [...byShop.entries()]
    .map(([shopId, counts]) => ({ shopId, ...counts }))
    .sort((a, b) => a.shopId.localeCompare(b.shopId));
}

/** `now()` as the DATABASE reports it — the only clock this audit's rows share. */
export async function databaseNow(client: AuditClient): Promise<Date> {
  const res = await client.query(`SELECT now() AS at`);
  return new Date((res.rows[0] as { at: Date | string }).at);
}

/**
 * Run the reconciliation over a window and return the counts.
 *
 * ⚠ **THE MOMENT COMES FROM THE CONNECTION, NOT FROM THIS PROCESS** (the security
 * lens's F8). Every timestamp this audit compares against — `issued_at`,
 * `effective_from`, a retirement's forced `created_at` — is written by the
 * database's clock, so a boundary taken from the client's would be a comparison
 * between two clocks. A scheduler on a host whose time has drifted forward would
 * silently shorten its own window and report clean. `options.now` remains, for
 * tests that need a stated moment; it is an override rather than the default.
 */
export async function runBreakGlassAudit(
  client: AuditClient,
  options: { readonly windowHours?: number | null; readonly now?: Date } = {}
): Promise<BreakGlassAuditResult> {
  const windowHours = options.windowHours === undefined ? DEFAULT_LOOKBACK_HOURS : options.windowHours;
  const now = options.now ?? (await databaseNow(client));
  const issuedSince = windowHours === null ? null : new Date(now.getTime() - windowHours * 3_600_000);

  const rows = await unreconciledBreakGlassSessions(client, { issuedSince });
  const findings = summariseUnreconciled(rows);
  return {
    windowHours,
    designations: await liveOriginDesignationCount(client, now),
    findings,
    unreconciled: rows.length,
    clean: rows.length === 0,
  };
}
