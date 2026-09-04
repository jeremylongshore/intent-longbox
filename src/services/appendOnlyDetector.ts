// The append-only-trigger bypass detector (E02-D05, 041 §9.2 item 3).
//
// Locked decision 4 is enforced by fourteen database triggers and nothing else.
// Migration 006 promotes them to ENABLE ALWAYS, which closes the
// session_replication_role door; the remaining door is an operator with psql and
// ownership of the tables, who can `ALTER TABLE ... DISABLE TRIGGER` at any moment
// after the migration ran. A CI gate-test structurally cannot see that — it only
// sees merge time. So the same query runs at runtime, and the server refuses to
// serve when it fails. 019/020: "a non-waivable line without a live detector is a
// waiver by omission."
//
// THE QUERY READS pg_trigger, NEVER information_schema.triggers. The view lists a
// DISABLED trigger identically to an enabled one — it has no column for tgenabled —
// which is how the repository's previous assertion passed with every append-only
// trigger switched off (041 §1 E13).

import { APPEND_ONLY_TABLES } from "../db/appendOnlyTables.js";

/** A declared trigger that exists but is not `ENABLE ALWAYS`. */
export interface DisabledTrigger {
  table: string;
  trigger: string;
  /** `pg_trigger.tgenabled`: 'O' origin (bypassable), 'D' disabled, 'R' replica. */
  tgenabled: string;
}

export interface AppendOnlyCheckResult {
  ok: boolean;
  /** Declared triggers with no row in `pg_trigger` at all. */
  missing: Array<{ table: string; trigger: string }>;
  /** Declared triggers present but not at tgenabled='A'. */
  disabled: DisabledTrigger[];
  /** Triggers named `%_append_only` in the database that nothing declares (041 §9.2 item 4). */
  undeclared: Array<{ table: string; trigger: string }>;
}

/** One row of the live trigger state, as the detector reads it. */
interface TriggerRow {
  table_name: string;
  trigger_name: string;
  tgenabled: string;
}

/** The minimum surface the detector needs; a `pg.Pool` satisfies it. */
export interface QueryablePool {
  query(text: string): Promise<{ rows: TriggerRow[] }>;
}

const TRIGGER_STATE_SQL = `
  SELECT c.relname AS table_name, tg.tgname AS trigger_name, tg.tgenabled
    FROM pg_trigger tg
    JOIN pg_class c ON c.oid = tg.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE NOT tg.tgisinternal
     AND n.nspname = 'public'
     AND tg.tgname LIKE '%\\_append\\_only'
`;

/**
 * Compare the declared append-only trigger set against the live database.
 *
 * Equality is asserted in both directions: a declared trigger that is absent or
 * bypassable is a failure, and so is a `%_append_only` trigger the declaration
 * does not know about — an undeclared trigger means a migration added an
 * append-only table without adding it to `src/db/appendOnlyTables.ts`, so nothing
 * would have noticed had it been created at the bypassable default.
 */
export async function checkAppendOnlyTriggers(pool: QueryablePool): Promise<AppendOnlyCheckResult> {
  const { rows } = await pool.query(TRIGGER_STATE_SQL);
  const live = new Map(rows.map((r) => [r.trigger_name, r]));

  const missing: AppendOnlyCheckResult["missing"] = [];
  const disabled: DisabledTrigger[] = [];
  for (const declared of APPEND_ONLY_TABLES) {
    const row = live.get(declared.trigger);
    if (!row) {
      missing.push({ table: declared.table, trigger: declared.trigger });
    } else if (row.tgenabled !== "A") {
      disabled.push({ table: declared.table, trigger: declared.trigger, tgenabled: row.tgenabled });
    }
  }

  const declaredNames = new Set(APPEND_ONLY_TABLES.map((t) => t.trigger));
  const undeclared = rows
    .filter((r) => !declaredNames.has(r.trigger_name))
    .map((r) => ({ table: r.table_name, trigger: r.trigger_name }));

  return {
    ok: missing.length === 0 && disabled.length === 0 && undeclared.length === 0,
    missing,
    disabled,
    undeclared,
  };
}

/** Human-readable one-liner naming exactly which triggers failed. */
export function describeAppendOnlyFailure(result: AppendOnlyCheckResult): string {
  const parts: string[] = [];
  if (result.missing.length > 0) {
    parts.push(`missing: ${result.missing.map((m) => m.trigger).join(", ")}`);
  }
  if (result.disabled.length > 0) {
    parts.push(`not ENABLE ALWAYS: ${result.disabled.map((d) => `${d.trigger}=${d.tgenabled}`).join(", ")}`);
  }
  if (result.undeclared.length > 0) {
    parts.push(`undeclared: ${result.undeclared.map((u) => u.trigger).join(", ")}`);
  }
  return parts.join("; ");
}

/** Minimal logger surface — Fastify's and `console` both satisfy it. */
export interface DetectorLogger {
  error(msg: string): void;
  info(msg: string): void;
}

/** How often the runtime detector re-reads pg_trigger. */
export const APPEND_ONLY_CHECK_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Boot assertion: fails closed. The caller must not start listening when this
 * throws — a server that serves writes while the append-only guarantee is off is
 * appending to a log that can be edited behind it.
 */
export async function assertAppendOnlyTriggersOrThrow(
  pool: QueryablePool,
  logger: DetectorLogger = console
): Promise<void> {
  const result = await checkAppendOnlyTriggers(pool);
  if (!result.ok) {
    const detail = describeAppendOnlyFailure(result);
    logger.error(`append-only trigger check FAILED at boot: ${detail}`);
    throw new Error(
      `refusing to serve: the append-only guarantee (locked decision 4) is not enforced — ${detail}. ` +
        `Re-run pnpm migrate (006_append_only_enable_always.sql) and investigate who disabled it.`
    );
  }
  logger.info(`append-only trigger check ok: ${APPEND_ONLY_TABLES.length} triggers ENABLE ALWAYS`);
}

/**
 * Periodic re-check. Catches an operator disabling a trigger after boot, which is
 * the failure a CI gate and a boot assertion both structurally miss.
 *
 * 041 §9.2 item 3 (A7, Kleppmann) is explicit that this five-minute job — not the
 * boot check — IS the detector: "a boot check on a service that is restarted weekly
 * is a weekly check", and the window between someone disabling a trigger and anyone
 * noticing is exactly the window in which invisible mutation is possible. The boot
 * check is retained as the deployed-with-it-off catch.
 *
 * NOTIFICATION. This repository has no notify/alert seam today — there is no Slack
 * client, no webhook sender and no notifier module in `src/` (`src/services/listingStatus.ts`
 * says the same of the T19 watcher). So a failure is logged at error level and
 * nothing is paged. Two owners, because these are two different pieces of work:
 *
 * TODO(E13-B04): route this detector's failures, and its liveness heartbeat, through
 * the estate notify path — the same path the rest of the estate's alerting uses
 * (041 §9.2 item 3). Do not invent an alerting integration here.
 *
 * TODO(E00-D01 → 019 v1.3.0 T34): applied — the 019 amend-by-row adds this detector as T34's SEVENTH
 * heartbeat, at this five-minute interval. 041 §9.3 rules YES on the substance (a
 * detector guarding the sole enforcement of locked decision 4, not itself monitored
 * for liveness, is the failure 020 names one level up) and supplies the row's text
 * and interval, but files it as a candidate rather than editing 019: 019 is a
 * ratified contract and E00-B03 owns its change control (018 §5).
 *
 * @returns a stop function; the interval is unref'd so it never holds the process open.
 */
export function scheduleAppendOnlyCheck(
  pool: QueryablePool,
  logger: DetectorLogger = console,
  intervalMs: number = APPEND_ONLY_CHECK_INTERVAL_MS
): () => void {
  const timer = setInterval(() => {
    void checkAppendOnlyTriggers(pool)
      .then((result) => {
        if (!result.ok) {
          logger.error(
            `append-only trigger check FAILED (runtime): ${describeAppendOnlyFailure(result)} ` +
              `— locked decision 4 is not enforced right now`
          );
        }
      })
      .catch((err: unknown) => {
        logger.error(`append-only trigger check could not run: ${(err as Error).message}`);
      });
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
