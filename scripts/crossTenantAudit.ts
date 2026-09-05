// THE DAILY CROSS-TENANT AUDIT QUERY (019 T24's second half).
//
// **WHY IT LIVES UNDER `scripts/` AND NOT UNDER `src/db/`.** Its only runtime
// caller is a CLI, and `scripts/migrationDiscipline.ts` set the precedent: logic a
// CLI runs and a test asserts on lives beside the CLI, so `depcruise`'s no-orphans
// rule over `src/` keeps meaning what it says. When E13-B04.1 gives it a scheduled
// home inside the running process it moves — and that move is the signal that it
// has become part of the system rather than an operator's tool.
//
// WHY THIS IS IN E03-B04 AND NOT DEFERRED. 019 T24 is non-waivable and asks for
// two instruments, not one: *"runtime per-request tenant assertion and a daily
// cross-tenant audit query"*. The bead's own 2026-09-03 directive (019 §3.0 /
// 020 §Implementation) says it in as many words — *"T24 needs a RUNTIME detector:
// per-request tenant assertion plus a daily cross-tenant audit query with a
// heartbeat (T34) — CI property tests alone cannot fire K1 in production"* — and
// 034 §3.4 makes the consequence concrete: *"Any occurrence in the daily
// cross-tenant audit query is K1 — pause live batches until the P0 bead closes
// with an invariant-review PASS."* Row-level security PREVENTS; it does not
// DETECT, and a bead that shipped the prevention and left the detection to
// somebody else would have closed T24 with one of its two halves.
//
// **WHAT STAYS ELSEWHERE.** The daily SCHEDULE and its T34 heartbeat are
// E13-B04.1's, beside every other detector's cadence. This module is the query
// and its exit code; nothing here runs on a timer.
//
// ============================================================================
// WHY IT RUNS AS THE SCHEMA OWNER, WHICH LOOKS WRONG AND IS THE ONLY WAY
// ============================================================================
//
// An audit for rows that cross tenants cannot run under a tenant context: the
// context is exactly what hides the rows it is looking for. The owner is the one
// principal that sees across shops (`migrations/029` (a)), so the audit connects
// on `MIGRATE_DATABASE_URL` — the same connection `pnpm migrate` uses and the
// same one `assertSchemaOwnerOrThrow` already recognises.
//
// **It reports COUNTS and identifiers, never row contents.** A detector for a
// tenancy breach that printed the rows would be a tenancy breach with a cron
// entry: 022 P3's rule about staff data and 019 T35's about operator identifiers
// both apply to whatever this prints, so it prints an edge, a count, and — for a
// hit — the pair of shop ids, which are the two tenants an operator must be told
// about to act on it.

/** The minimum client surface this module needs. */
export interface AuditClient {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
}

/**
 * A foreign key between two shop-scoped tables, as the catalog reports it.
 *
 * Derived rather than listed, for `rowLevelSecurity.ts`'s reason: a hand-kept list
 * of joins would be a second copy of the schema, and the first table somebody adds
 * would be outside the audit with nothing to notice it.
 */
export interface TenantEdge {
  readonly constraint: string;
  readonly child: string;
  readonly parent: string;
  /** Column pairs, child-side and parent-side, in matching order. */
  readonly childColumns: readonly string[];
  readonly parentColumns: readonly string[];
}

/**
 * Every FK from a shop-scoped table to a shop-scoped table.
 *
 * A constraint that already carries `shop_id` on BOTH sides (041 §3.2's composite
 * supersession FKs) is included and will always count zero — that is the point of
 * it, and an audit that skipped the edges the schema already makes safe would not
 * be able to prove they still are.
 */
export const TENANT_EDGES_SQL = `
  SELECT k.conname::text AS constraint,
         c.relname::text AS child,
         cf.relname::text AS parent,
         (SELECT array_agg(a.attname::text ORDER BY x.ord)
            FROM unnest(k.conkey) WITH ORDINALITY AS x(attnum, ord)
            JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = x.attnum) AS child_columns,
         (SELECT array_agg(a.attname::text ORDER BY x.ord)
            FROM unnest(k.confkey) WITH ORDINALITY AS x(attnum, ord)
            JOIN pg_attribute a ON a.attrelid = k.confrelid AND a.attnum = x.attnum) AS parent_columns
    FROM pg_constraint k
    JOIN pg_class c ON c.oid = k.conrelid
    JOIN pg_class cf ON cf.oid = k.confrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE k.contype = 'f'
     AND n.nspname = 'public'
     AND EXISTS (SELECT 1 FROM pg_attribute x
                  WHERE x.attrelid = c.oid AND x.attname = 'shop_id' AND NOT x.attisdropped)
     AND EXISTS (SELECT 1 FROM pg_attribute y
                  WHERE y.attrelid = cf.oid AND y.attname = 'shop_id' AND NOT y.attisdropped)
   ORDER BY 1
`;

/** Postgres identifiers this module is willing to interpolate. */
const SAFE_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

function safe(name: string): string {
  if (!SAFE_IDENTIFIER.test(name)) throw new Error(`unsafe identifier from the catalog: ${name}`);
  return name;
}

/**
 * The count of rows on one edge whose tenant disagrees with their parent's.
 *
 * `IS DISTINCT FROM` rather than `<>`: a NULL on either side is a disagreement
 * worth seeing, and `<>` would answer NULL and be counted as "no".
 */
export function buildEdgeAudit(edge: TenantEdge): string {
  const child = safe(edge.child);
  const parent = safe(edge.parent);
  const on = edge.childColumns
    .map((col, i) => `c.${safe(col)} = p.${safe(edge.parentColumns[i] ?? "")}`)
    .join(" AND ");
  return (
    `SELECT count(*)::int AS mismatches FROM ${child} c ` +
    `JOIN ${parent} p ON ${on} WHERE c.shop_id IS DISTINCT FROM p.shop_id`
  );
}

/**
 * The SECOND predicate the ruling asks for, and the one place it is definable.
 *
 * "A row written under a service scope into a shop with no matching grant" is a
 * question most tables cannot answer: an `auth_attempt` is a REFUSAL and refers to
 * no grant, a device session belongs to a phone rather than to a person, and a
 * webhook receipt names a store. **An OPERATOR session can answer it**: it names
 * an `app_user`, it names a `shop_id`, and 048 §6.1 says the person must hold a
 * membership at that shop for the session to mean anything. A row failing this is
 * either a session issued for a shop its person never joined, or a membership that
 * ended without its sessions ending — both are 019 T35(c)'s reconciliation seen
 * from the tenancy side, and both are K1 under 034 §3.4.
 *
 * It is deliberately NOT the same query as `unreconciledBreakGlassSessions`
 * (054 §4): that one asks about break-glass grants specifically, this asks whether
 * ANY operator session stands on a grant at its own shop.
 */
export const UNGRANTED_SESSIONS_SQL = `
  SELECT count(*)::int AS mismatches
    FROM app_session s
   WHERE s.kind = 'operator'
     AND s.app_user_id IS NOT NULL
     AND NOT EXISTS (
           SELECT 1 FROM membership m
            WHERE m.app_user_id = s.app_user_id
              AND m.shop_id = s.shop_id
              AND m.effective_from <= s.issued_at
              AND (m.effective_until IS NULL OR m.effective_until > s.issued_at)
         )
`;

/** One check's result. `mismatches > 0` is a K1 (034 §3.4). */
export interface AuditFinding {
  readonly check: string;
  readonly detail: string;
  readonly mismatches: number;
}

export interface AuditResult {
  readonly edges: number;
  readonly findings: readonly AuditFinding[];
  /** True when every check counted zero. */
  readonly clean: boolean;
}

/**
 * Run every check and return the counts.
 *
 * Every edge is reported, not only the failing ones, because "the audit ran and
 * found nothing" and "the audit ran over nothing" are different facts and a
 * detector that cannot tell them apart is the stale-detector failure 019 T34
 * exists to catch (E13-B04.1 turns that into a heartbeat).
 */
export async function runCrossTenantAudit(client: AuditClient): Promise<AuditResult> {
  const edges = (await client.query(TENANT_EDGES_SQL)).rows as Array<{
    constraint: string;
    child: string;
    parent: string;
    child_columns: string[];
    parent_columns: string[];
  }>;

  const findings: AuditFinding[] = [];
  for (const row of edges) {
    const edge: TenantEdge = {
      constraint: row.constraint,
      child: row.child,
      parent: row.parent,
      childColumns: row.child_columns,
      parentColumns: row.parent_columns,
    };
    const res = await client.query(buildEdgeAudit(edge));
    const mismatches = (res.rows[0] as { mismatches: number }).mismatches;
    findings.push({
      check: `${edge.child} → ${edge.parent}`,
      detail: edge.constraint,
      mismatches,
    });
  }

  const ungranted = (await client.query(UNGRANTED_SESSIONS_SQL)).rows[0] as { mismatches: number };
  findings.push({
    check: "operator sessions without a grant at their own shop",
    detail: "app_session ⋈ membership",
    mismatches: ungranted.mismatches,
  });

  return {
    edges: edges.length,
    findings,
    clean: findings.every((f) => f.mismatches === 0),
  };
}
