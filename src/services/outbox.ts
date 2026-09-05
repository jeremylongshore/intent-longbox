// The outbox runtime — platform's, and platform's only (029 §2.9, 043 §4.1).
//
// PLATFORM NEVER KNOWS WHAT A JOB MEANS; COMMERCE NEVER KNOWS HOW IT WAS
// SCHEDULED. Everything in this file is about owing an effect, claiming it and
// recording what happened. What a `draft_requested` row *means* — a productSet
// call, a shopify_draft row, a listing guard — lives in `src/consumers/`, and
// the only thing joining the two is a registry keyed on the event name. That is
// why the names in `src/events/catalogue.ts` carry a module segment: it makes
// the routing rule checkable rather than conventional.
//
// THE ONE PROPERTY THE WHOLE FILE EXISTS FOR (043 §2.1): an effect that leaves
// Longbox is never performed by the request that decides it. The request appends
// an `outbox` row inside its own transaction — the same transaction as the fact
// that justifies the effect — and commits. If the request rolls back there is no
// row and no effect. If it commits, the effect is OWED: not maybe-sent, not
// sent-and-unrecorded, but owed, with a row saying so.
//
// THERE IS NO STATUS COLUMN AND THERE IS NO REAPER (043 §2.4). Terminal, in
// flight and due are PREDICATES over `outbox_attempt`, exported below as the one
// definition the claim query, the tests and any future view share. A crashed
// worker's row becomes claimable again when its `started` row ages past
// `attempt_visibility` — not because something repaired state, but because a
// predicate's inputs changed. Nothing has to notice; nothing has to run.
//
// ⚠ THE CLAIM AND THE `started` INSERT ARE ONE TRANSACTION ON ONE CONNECTION
// (043 A1, REQUIRED). `claimBatch` below runs both inside `withTransaction`, so
// the row lock is released only when the `started` row is durable. Split them
// and there is a window in which the lock is gone and the log says nothing — a
// second claimer sees a row that is not terminal, not in flight and due, and
// takes it. The design's whole claim is that the lease derives from the log; a
// lock released before the log records it is a lease derived from nothing.
// `tests/integration/outbox-skip-locked.test.ts` asserts the property that
// follows and includes a split-transaction fixture that makes it FAIL.
//
// ⚠ THE CLOCK ASSUMPTION, NAMED RATHER THAN ASSUMED (043 A7). The in-flight
// predicate compares a stored `created_at` against `now()`, so it is correct
// ONLY WHILE `attempt_visibility` exceeds the worst-case clock skew across every
// host that runs a worker. Two rules follow and both are enforced here: every
// timestamp is SERVER-SIDE — `now()` evaluated inside the claim transaction,
// never a worker or client wall clock — and beyond a single host, NTP or a
// monotonic source is a REQUIREMENT, not an operational nicety. One host makes
// the assumption vacuous today; E13-B03's second worker is what makes it
// load-bearing, and it should not discover this paragraph for itself.
//
// Bead: longbox-e5b.2.17 (alias E02-D07). Docs: 043 v1.1.2 §2–§9, §11;
// 041 §4 (the request transaction); 042 §7 (the outbound event contract);
// 019 T17 / T19 / T22.

import type pg from "pg";
import { randomUUID } from "node:crypto";
import { serviceDb, tenantDb, withTransaction, type Queryable, type Tx } from "../db.js";
import { catalogueEntry, isCatalogueEvent } from "../events/catalogue.js";

// ---------------------------------------------------------------------------
// Parameters — PROVISIONAL floors, explicitly NON-EVIDENTIARY (043 §5.3)
// ---------------------------------------------------------------------------

/**
 * The four numbers 043 §5.3 configures.
 *
 * **These are NOT measurements.** They are circuit-breaker floors, adopted under
 * 042 A3's ruling that "018 A3 caps claims of fact, not safety floors … A system
 * with no limit at all is not epistemically humble — it is unprotected". They
 * are **never** quoted as reliability, throughput or latency in any artifact at
 * any class (021 B16), and they support no claim of fact.
 *
 * They close by measurement: the observed attempt-count and time-to-delivery
 * distributions across the 019 §5 pilot batches, **segmented by whether a real
 * Shopify credential was configured** — a stub client never fails, so a mixed
 * sample would report a reliability that belongs to the stub.
 *
 * 018 C3's red line: a ceiling may be RAISED freely, because it binds less.
 * LOWERING one after seeing a result it would change requires a 006 row saying
 * so in those words.
 */
export interface OutboxParams {
  /**
   * PROVISIONAL 6. With base 30 s and ceiling 30 min, the five delays between
   * six attempts span **≈15.5 minutes** of wall clock at the jitter's mean
   * (30 s + 1 + 2 + 4 + 8 min), and the 30-minute ceiling is **never reached**
   * within the budget — 2^5 × 30 s = 16 min. The derivation is a ceiling, not an
   * estimate: a provider incident that outlives a quarter of an hour is not a
   * blip a retry loop should paper over — it is a "declared provider outage",
   * the exact phrase 019 T17 uses to exclude such a window from the
   * draft-success denominator. The ceiling is set where the system should stop
   * pretending and start telling the owner.
   *
   * (043 v1.0.0–v1.1.1 said "roughly 75 minutes" here; **v1.1.2 corrected the
   * arithmetic on main**. The figure above is the one the code produces and the
   * one `tests/outbox-predicates.test.ts` asserts.)
   */
  readonly maxAttempts: number;
  /** PROVISIONAL 30 s — above any plausible transient, below any operator's patience. */
  readonly backoffBaseMs: number;
  /** PROVISIONAL 30 min — keeps a long outage from stretching one job across a working day. */
  readonly backoffCeilingMs: number;
  /** PROVISIONAL 5 min — the in-flight window (043 §5.4). See the clock assumption above. */
  readonly attemptVisibilityMs: number;
  /** How often the poller wakes. Not a latency promise; see 043 §4.2. */
  readonly pollIntervalMs: number;
  /** Rows claimed per cycle. A bound on one cycle's work, not a throughput figure. */
  readonly batchSize: number;
}

export const DEFAULT_OUTBOX_PARAMS: OutboxParams = {
  maxAttempts: 6,
  backoffBaseMs: 30_000,
  backoffCeilingMs: 30 * 60_000,
  attemptVisibilityMs: 5 * 60_000,
  pollIntervalMs: 5_000,
  batchSize: 10,
};

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new Error(`env ${name} must be a positive integer`);
  return n;
}

/**
 * Read the four floors from the environment, falling back to the provisional
 * defaults. Env-overridable so a deployment can RAISE a ceiling without a code
 * change (018 C3 permits raising freely); lowering one is a 006 row.
 */
export function loadOutboxParams(): OutboxParams {
  return {
    maxAttempts: envInt("OUTBOX_MAX_ATTEMPTS", DEFAULT_OUTBOX_PARAMS.maxAttempts),
    backoffBaseMs: envInt("OUTBOX_BACKOFF_BASE_MS", DEFAULT_OUTBOX_PARAMS.backoffBaseMs),
    backoffCeilingMs: envInt("OUTBOX_BACKOFF_CEILING_MS", DEFAULT_OUTBOX_PARAMS.backoffCeilingMs),
    attemptVisibilityMs: envInt("OUTBOX_ATTEMPT_VISIBILITY_MS", DEFAULT_OUTBOX_PARAMS.attemptVisibilityMs),
    pollIntervalMs: envInt("OUTBOX_POLL_INTERVAL_MS", DEFAULT_OUTBOX_PARAMS.pollIntervalMs),
    batchSize: envInt("OUTBOX_BATCH_SIZE", DEFAULT_OUTBOX_PARAMS.batchSize),
  };
}

// ---------------------------------------------------------------------------
// Attempt kinds and the detail allowlist
// ---------------------------------------------------------------------------

export const ATTEMPT_KINDS = ["started", "delivered", "failed", "dead_lettered", "replay_requested"] as const;
export type AttemptKind = (typeof ATTEMPT_KINDS)[number];

/**
 * The two kinds that end a row's life. Exported because the terminal predicate,
 * the dead-letter view and every test must agree on the same two names.
 */
export const TERMINAL_KINDS: readonly AttemptKind[] = ["delivered", "dead_lettered"];

/**
 * The refusal codes 043 §4.3 and §5 name, plus the two the runtime itself
 * produces. `listing_left_draft` and `no_observation_evidence` are 043 A5's
 * GUARD REFUSALS: they are reported on their own line, distinct from the 019 T17
 * aggregate, because a guard working is not unreliability. `outbox_dead_letter`
 * carries that distinction as a column so it cannot be lost in whoever writes
 * the report.
 */
export const GUARD_REASON_CODES = ["listing_left_draft", "no_observation_evidence"] as const;
export const REASON_CODES = [
  ...GUARD_REASON_CODES,
  /** The Shopify response carried `userErrors`: a permanent failure (043 §5.2). */
  "permanent_provider_error",
  /** `maxAttempts` reached without the failure clearing. */
  "attempt_ceiling_reached",
  /** No consumer is registered for the event name. A deployment defect, not a retryable one. */
  "no_consumer_registered",
  /**
   * The session no longer carries the facts the job needs (its confirmation or
   * its pricing snapshot is gone). Retrying cannot bring them back, so this is
   * terminal — and it is reported distinctly from a provider failure because it
   * is not one.
   */
  "session_not_draftable",
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

/**
 * `outbox_attempt.detail`'s allowlisted keys (043 §2.5, §11 I6).
 *
 * A detail row holds CODES AND REFERENCES: an HTTP status, a provider error
 * code, a reference id, a duration, a refusal reason. It never holds a response
 * body, a provider's exception MESSAGE, an operator name, a model or provider
 * name, a percentage or any shop content. That is 042 §4.3's "the server emits
 * no operator prose" applied to a table instead of a wire, plus 022 P8 (cost
 * stays in `cost_log`) and 019 T35.
 *
 * `error_class` is a constructor name (`TypeError`, `FetchError`) and never a
 * message: the class of failure is diagnostic, the message is prose that can
 * carry anything the provider felt like saying.
 */
export const ATTEMPT_DETAIL_KEYS = [
  "reason_code",
  "http_status",
  "error_code",
  "error_class",
  "duration_ms",
  "ref_table",
  "ref_id",
  "attempt_ceiling",
  /**
   * Whether the provider client was a STUB rather than a real credentialled one.
   *
   * 043 §5.3's closing evidence is explicit that the attempt-count and
   * time-to-delivery distributions must be **segmented by whether a real Shopify
   * credential was configured** — "a stub client never fails, so a mixed sample
   * would report a reliability that belongs to the stub". Without this flag on
   * the row, that segmentation is unrecoverable after the fact: nothing else in
   * the attempt log says which client answered.
   *
   * It is a boolean about Longbox's own configuration, not shop content, a
   * provider name or a measurement — so it belongs on an allowlist whose whole
   * purpose is to keep the other three out.
   */
  "stub",
] as const;
export type AttemptDetailKey = (typeof ATTEMPT_DETAIL_KEYS)[number];
export type AttemptDetail = Partial<Record<AttemptDetailKey, string | number | boolean | null>>;

export class AttemptDetailError extends Error {
  constructor(readonly keys: readonly string[]) {
    super(
      `refusing to write outbox_attempt.detail: ${keys.join(", ")} is not an allowlisted key. ` +
        `Detail carries codes and references only — never a response body, a provider exception ` +
        `message, an operator name, a model or provider name, a percentage or shop content ` +
        `(043 §2.5, §11 I6; 042 §4.3; 022 P6/P8; 021 B16/B19; 019 T35). ` +
        `Allowed: ${ATTEMPT_DETAIL_KEYS.join(", ")}.`
    );
    this.name = "AttemptDetailError";
  }
}

/** Fail closed on an undeclared key rather than silently persisting prose. */
export function assertAttemptDetail(detail: AttemptDetail | undefined): AttemptDetail | undefined {
  if (detail === undefined) return undefined;
  const allowed = new Set<string>(ATTEMPT_DETAIL_KEYS);
  const bad = Object.keys(detail).filter((k) => !allowed.has(k));
  if (bad.length > 0) throw new AttemptDetailError(bad);
  return detail;
}

// ---------------------------------------------------------------------------
// The eligibility predicates — ONE definition, three readers (043 §2.4)
// ---------------------------------------------------------------------------

/**
 * Terminal: an attempt row exists with kind ∈ {delivered, dead_lettered}.
 *
 * Exported as SQL rather than inlined into the claim query so the claim, the
 * tests and any future read model share one sentence. A predicate spelled twice
 * is a predicate that can disagree with itself — the same reasoning
 * `src/db/appendOnlyTables.ts` gives for the trigger set.
 */
export function terminalPredicateSql(alias = "o"): string {
  return `EXISTS (
      SELECT 1 FROM outbox_attempt a
       WHERE a.outbox_id = ${alias}.id
         AND a.kind IN ('delivered', 'dead_lettered')
    )`;
}

/**
 * In flight: the NEWEST attempt is `started` and its `created_at` is within
 * `attempt_visibility`.
 *
 * "Newest" breaks ties on `id DESC` so a `started` and its terminal partner
 * written in the same millisecond still resolve to one deterministic row — the
 * same tie-break `listing_status_observation` uses, for the same reason.
 *
 * @param visibilityParam the bind placeholder holding the window in milliseconds.
 */
export function inFlightPredicateSql(alias = "o", visibilityParam = "$1"): string {
  // A row with NO attempts yields NULL from the scalar subquery, and NULL is not
  // "in flight" — `coalesce(…, false)` says so rather than leaving a three-valued
  // result to propagate into the claim's WHERE, where NULL and false behave the
  // same by accident rather than by statement.
  return `coalesce((
      SELECT a.kind = 'started'
             AND a.created_at > now() - (${visibilityParam}::bigint * interval '1 millisecond')
        FROM outbox_attempt a
       WHERE a.outbox_id = ${alias}.id
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT 1
    ), false)`;
}

/**
 * Due: there is no failure to back off from, or the newest failure's backoff has
 * elapsed.
 *
 * `delay(n) = min(base × 2^(n-1), ceiling) × random(0.5, 1.5)`, **computed at
 * claim time and never stored** (043 §5.2). The jitter is `random()` evaluated
 * per row per claim, which is what decorrelates a batch that failed together:
 * with 035's Pilot C at ≥300 items, a shop that scans during a provider incident
 * has ≈300 jobs that failed within minutes of each other, and without jitter
 * they would all retry at the same instant when it ends — converting one outage
 * into a self-inflicted second one. **The number of jobs is small; the
 * correlation between them is total.**
 *
 * @param jitterExpr overridable so a test can pin the jitter to a constant and
 *   assert the deterministic half of the formula. Production never passes it.
 */
export function duePredicateSql(
  alias = "o",
  baseParam = "$2",
  ceilingParam = "$3",
  jitterExpr = "(0.5 + random())"
): string {
  return `NOT EXISTS (
      SELECT 1
        FROM (
          SELECT a.created_at, a.attempt_no
            FROM outbox_attempt a
           WHERE a.outbox_id = ${alias}.id AND a.kind = 'failed'
           ORDER BY a.created_at DESC, a.id DESC
           LIMIT 1
        ) last_failed
       WHERE now() < last_failed.created_at
             + (least(${baseParam}::double precision * power(2, last_failed.attempt_no - 1),
                      ${ceilingParam}::double precision) * ${jitterExpr})
               * interval '1 millisecond'
    )`;
}

/**
 * The claim query (043 §7.2), verbatim in shape.
 *
 * `FOR UPDATE OF o SKIP LOCKED` is the whole of the multi-process story: a
 * second process's claim transaction SKIPS rows the first holds and takes
 * different ones. No lease table, no worker registry, no partitioning, no leader
 * election. E13's horizontal scaling costs nothing here because the mechanism
 * was never single-process-dependent — it is single-POLLER-per-process by
 * choice, not by constraint.
 *
 * The `ORDER BY` delivers 043 §3.2's guarantee and nothing more. Sorting by
 * `(scan_session_id, session_seq)` is what makes within-session order hold; it
 * confers NO cross-session promise. Under `SKIP LOCKED` the drain order is not
 * even the claim order — worker A skips a row worker B holds and takes a later
 * one — so a consumer that observes the order and depends on it has depended on
 * nothing this design promises.
 *
 * Binds: $1 attempt_visibility ms · $2 backoff base ms · $3 backoff ceiling ms ·
 * $4 limit · $5 shop_id (NULL drains every shop).
 */
export function claimQuerySql(jitterExpr?: string): string {
  return `
    SELECT o.id, o.shop_id, o.scan_session_id, o.event, o.ref_table, o.ref_id,
           o.correlation_id, o.definition_version
      FROM outbox o
     WHERE ($5::uuid IS NULL OR o.shop_id = $5::uuid)
       AND NOT ${terminalPredicateSql("o")}
       AND NOT ${inFlightPredicateSql("o", "$1")}
       AND ${duePredicateSql("o", "$2", "$3", jitterExpr)}
     ORDER BY o.scan_session_id, o.session_seq NULLS LAST, o.created_at, o.id
     LIMIT $4
       FOR UPDATE OF o SKIP LOCKED`;
}

// ---------------------------------------------------------------------------
// Backoff, as a pure function (the TypeScript twin of duePredicateSql)
// ---------------------------------------------------------------------------

/**
 * `min(base × 2^(n-1), ceiling) × random(0.5, 1.5)`.
 *
 * The SQL predicate above is the one the claim uses; this is the same formula in
 * TypeScript, for the caller that wants to say when a row will next be due
 * without asking the database. `rand` is injected so the jitter is testable —
 * the anti-thundering-herd property is "two rows failing in the same instant get
 * different due times", which needs a random that a test can drive.
 */
export function backoffDelayMs(
  attemptNo: number,
  params: Pick<OutboxParams, "backoffBaseMs" | "backoffCeilingMs">,
  rand: () => number = Math.random
): number {
  if (!Number.isInteger(attemptNo) || attemptNo < 1) {
    throw new Error(`backoffDelayMs: attemptNo must be >= 1, got ${String(attemptNo)}`);
  }
  const uncapped = params.backoffBaseMs * Math.pow(2, attemptNo - 1);
  const capped = Math.min(uncapped, params.backoffCeilingMs);
  return Math.round(capped * (0.5 + rand()));
}

/**
 * A permanent failure is never retried (043 §5.2) — 042 §4.4's `retryable`
 * distinction one layer down. A Shopify `userErrors` entry (an invalid price, a
 * missing required field) will fail identically forever; a 429, a 502 or a
 * dropped connection will not. `src/services/shopify.ts` already separates the
 * three cases; what was missing was the consequence.
 */
export function isTerminalFailure(outcome: { permanent?: boolean }, attemptNo: number, max: number): boolean {
  return outcome.permanent === true || attemptNo >= max;
}

// ---------------------------------------------------------------------------
// Enqueue — INSIDE the caller's transaction, always
// ---------------------------------------------------------------------------

export interface EnqueueArgs {
  readonly shopId: string;
  /** A name from `src/events/catalogue.ts`. Anything else is refused. */
  readonly event: string;
  /** The committed witness row. Omitted for the one command event, which self-references. */
  readonly refTable?: string;
  readonly refId?: string;
  readonly scanSessionId?: string | null;
  /** 041 §5.3. NULL until scan_session.session_seq exists (E02-B10). */
  readonly sessionSeq?: number | null;
  readonly definitionVersion?: string | null;
  /** 042 §4.7. NULL until E02-B08 mints one (043 §1 E9). */
  readonly correlationId?: string | null;
  readonly occurredAt?: Date | null;
  readonly authoredBy: "human" | "system" | "provider";
  readonly operatorId?: string | null;
  readonly actorVerified?: boolean;
  readonly actorRole?: string | null;
}

export interface EnqueueResult {
  readonly id: string;
  /**
   * TRUE when `UNIQUE (shop_id, event, ref_table, ref_id)` already held a row —
   * the same effect was already owed. Enqueueing is therefore idempotent for the
   * eight reference-shaped events by construction, with no read-then-write.
   *
   * It is ALWAYS false for the one command event, which self-references and so
   * has a fresh key every time. That is not an oversight: 043 §3.4 chose the
   * self-reference, and double-submit protection for a REQUEST is
   * `request_idempotency` (042 §5, E02-B08's execution), not this constraint. A
   * second `draft_requested` for a copy that already has a draft is caught one
   * layer later by 043 §4.3's fail-closed guard, which refuses it and
   * dead-letters `no_observation_evidence` — slow, and correct.
   */
  readonly alreadyEnqueued: boolean;
}

export class UnknownEventError extends Error {
  constructor(event: string) {
    super(
      `refusing to enqueue: "${event}" is not in the authored event catalogue ` +
        `(src/events/catalogue.ts, 043 §3.3). The catalogue is authored and never ` +
        `generated — adding a name is a deliberate act with a stated consumer, not a ` +
        `side effect of writing a producer.`
    );
    this.name = "UnknownEventError";
  }
}

/**
 * Append an `outbox` row **on the caller's transaction handle**.
 *
 * `tx` is the first parameter and is a `Tx`, not a `Queryable`, deliberately:
 * typing it `Queryable` would let a `pg.Pool` satisfy it, and an outbox row that
 * commits independently of the fact justifying it is exactly the half-written
 * chain this whole design exists to remove (029 §12; 041 §4.1's rule that every
 * writing function takes the handle first).
 *
 * The row id is minted HERE rather than by the column default, because the one
 * command event self-references (`ref_table='outbox'`, `ref_id=id`) and an
 * append-only table has no UPDATE with which to point a row at itself after the
 * fact. Minting in TypeScript makes the self-reference a single INSERT.
 */
export async function enqueue(tx: Tx, args: EnqueueArgs): Promise<EnqueueResult> {
  const entry = catalogueEntry(args.event);
  if (!entry) throw new UnknownEventError(args.event);

  const id = randomUUID();
  const refTable = entry.command === true ? "outbox" : (args.refTable ?? entry.refTable);
  const refId = entry.command === true ? id : args.refId;
  if (refId === undefined) {
    throw new Error(`enqueue(${args.event}): refId is required for a reference-shaped event`);
  }
  if (refTable !== entry.refTable) {
    throw new Error(
      `enqueue(${args.event}): the catalogue declares ref_table='${entry.refTable}', got '${refTable}'`
    );
  }

  const res = await tx.query(
    `INSERT INTO outbox
       (id, shop_id, scan_session_id, session_seq, event, ref_table, ref_id,
        definition_version, correlation_id, occurred_at, authored_by, operator_id,
        actor_verified, actor_role)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT ON CONSTRAINT outbox_one_effect_per_reference DO NOTHING
     RETURNING id`,
    [
      id,
      args.shopId,
      args.scanSessionId ?? null,
      args.sessionSeq ?? null,
      args.event,
      refTable,
      refId,
      args.definitionVersion ?? null,
      args.correlationId ?? null,
      args.occurredAt ?? null,
      args.authoredBy,
      args.operatorId ?? null,
      args.actorVerified ?? false,
      args.actorRole ?? null,
    ]
  );
  const inserted = res.rows[0] as { id: string } | undefined;
  if (inserted) return { id: inserted.id, alreadyEnqueued: false };

  // The unique constraint absorbed it: the same effect is already owed. Read the
  // existing row's id back so the caller can return it. This read follows a
  // constraint rather than preceding a write, which is the shape 043 §3.2
  // requires and the consumer-write-shape lint enforces.
  const existing = await tx.query(
    `SELECT id FROM outbox WHERE shop_id = $1 AND event = $2 AND ref_table = $3 AND ref_id = $4`,
    [args.shopId, args.event, refTable, refId]
  );
  const row = existing.rows[0] as { id: string } | undefined;
  if (!row) throw new Error(`enqueue(${args.event}): conflict absorbed but no existing row found`);
  return { id: row.id, alreadyEnqueued: true };
}

// ---------------------------------------------------------------------------
// The claim — one transaction, one connection (043 A1)
// ---------------------------------------------------------------------------

export interface Claim {
  readonly outboxId: string;
  readonly shopId: string;
  readonly scanSessionId: string | null;
  readonly event: string;
  readonly refTable: string;
  readonly refId: string;
  readonly correlationId: string | null;
  readonly definitionVersion: string | null;
  /** The attempt number this claim owns. Its `started` row is already durable. */
  readonly attemptNo: number;
}

interface ClaimRow {
  id: string;
  shop_id: string;
  scan_session_id: string | null;
  event: string;
  ref_table: string;
  ref_id: string;
  correlation_id: string | null;
  definition_version: string | null;
}

/**
 * Claim up to `limit` eligible rows and write each one's `started` attempt —
 * **in ONE transaction on ONE connection** (043 A1, REQUIRED).
 *
 * `withTransaction` holds a single `pg.PoolClient` for the callback's lifetime,
 * so the `FOR UPDATE … SKIP LOCKED` row locks taken by the SELECT are released
 * only at COMMIT — which is to say, only after every `started` row is durable.
 * The forbidden shape is claim-in-one-transaction, `started`-in-another: the
 * lock goes, the log says nothing, and a second claimer sees a row that is not
 * terminal, not in flight and due.
 *
 * The `UNIQUE (outbox_id, attempt_no, kind)` constraint makes that interleaving
 * fail LOUDLY rather than silently and is worth having as a backstop — but it
 * fails after both workers have already called the provider, so it is not the
 * fix. The fix is the transaction boundary, and 043 §4.3's provider-side upsert
 * is what makes even the backstop's failure survivable.
 *
 * LOCK ORDER (042 A6 / I22, 043 §7.2): a worker takes the `outbox` row FIRST and
 * anything else after. A worker that took a `scan_session` lock first and then an
 * outbox row could deadlock against a request holding them the other way, and
 * `40P01` at a counter is an intermittent failure that reproduces on nobody's
 * laptop.
 */
export async function claimBatch(
  pool: pg.Pool,
  params: OutboxParams,
  opts: { shopId?: string | null; limit?: number; jitterExpr?: string } = {}
): Promise<Claim[]> {
  const limit = opts.limit ?? params.batchSize;
  return withTransaction(
    pool,
    async (tx) => {
      const res = await tx.query(claimQuerySql(opts.jitterExpr), [
        params.attemptVisibilityMs,
        params.backoffBaseMs,
        params.backoffCeilingMs,
        limit,
        opts.shopId ?? null,
      ]);
      const candidates = res.rows as ClaimRow[];

      // ⚠ RE-CHECK ELIGIBILITY NOW THAT THE LOCKS ARE HELD. This is not belt and
      // braces; without it the claim is WRONG, and CI caught it where a local run
      // did not (two `started` rows for one outbox_id, identical `created_at`).
      //
      // WHY THE FIRST QUERY IS NOT ENOUGH. `withTransaction` runs at READ
      // COMMITTED, where every STATEMENT takes its own snapshot. The eligibility
      // predicates are subqueries over `outbox_attempt` — a DIFFERENT table from
      // the one being locked — so this is the interleaving:
      //
      //   A: BEGIN … locks row R, INSERTs started(1), COMMITs
      //   C: its claim SELECT started BEFORE A committed, so C's snapshot does
      //      not contain started(1); by the time C examines R, A's lock is gone.
      //      C evaluates "not in flight" against the stale snapshot → TAKES R.
      //
      // Postgres' EvalPlanQual re-check does not save us: it re-evaluates the
      // WHERE clause against the newest row version only when the LOCKED row was
      // concurrently UPDATEd. A did not update `outbox` — it inserted a child —
      // so there is nothing on R for the re-check to trigger on, and the stale
      // subquery result stands. (The `UNIQUE (outbox_id, attempt_no, kind)`
      // backstop does not fire either, because C's later `max(attempt_no)` query
      // takes a FRESH snapshot, sees A's row, and computes 2.)
      //
      // The fix is a second statement, after the locks are acquired: a fresh
      // snapshot that necessarily includes every committed claim, evaluated while
      // we hold the rows so no one else can change the answer underneath us. Two
      // claimers can never both survive it, because they can never both hold the
      // lock.
      // THE RE-CHECK IS TERMINAL + IN-FLIGHT ONLY, AND `due` IS DELIBERATELY
      // OMITTED. Those two are the ones a concurrent claimer's COMMIT can flip
      // against us, which is the whole hazard. `due` cannot: a `failed` row only
      // appears after someone claimed the row, and claiming is what in-flight and
      // terminal already cover. Re-evaluating `due` would also re-roll §5.2's
      // `random()` jitter, so a row the first statement admitted could be dropped
      // for no reason but a second dice throw — trading a correctness bug for a
      // non-deterministic one.
      const rows: ClaimRow[] = [];
      if (candidates.length > 0) {
        const stillEligible = await tx.query(
          `SELECT o.id
             FROM outbox o
            WHERE o.id = ANY($2::uuid[])
              AND NOT ${terminalPredicateSql("o")}
              AND NOT ${inFlightPredicateSql("o", "$1")}`,
          [params.attemptVisibilityMs, candidates.map((c) => c.id)]
        );
        const keep = new Set((stillEligible.rows as Array<{ id: string }>).map((r) => r.id));
        for (const c of candidates) if (keep.has(c.id)) rows.push(c);
      }

      const claims: Claim[] = [];
      for (const row of rows) {
        // `attempt_no` is derived under the row lock we already hold, so no
        // concurrent claimer can be computing the same number for this row.
        const next = await tx.query(
          `SELECT coalesce(max(attempt_no), 0) + 1 AS n FROM outbox_attempt WHERE outbox_id = $1`,
          [row.id]
        );
        const attemptNo = Number((next.rows[0] as { n: string | number }).n);
        await tx.query(
          `INSERT INTO outbox_attempt (shop_id, outbox_id, attempt_no, kind, authored_by)
           VALUES ($1, $2, $3, 'started', 'system')`,
          [row.shop_id, row.id, attemptNo]
        );
        claims.push({
          outboxId: row.id,
          shopId: row.shop_id,
          scanSessionId: row.scan_session_id,
          event: row.event,
          refTable: row.ref_table,
          refId: row.ref_id,
          correlationId: row.correlation_id,
          definitionVersion: row.definition_version,
          attemptNo,
        });
      }
      return claims;
    },
    // THE WORKER'S TENANT (E03-B04). A background job has no session, so 034 §3.2's
    // context has to come from somewhere else — and the answer taken here is the
    // one the bead prefers: the poller drains ONE SHOP AT A TIME and the claim
    // runs under that shop's own context, rather than a `longbox.service` bypass
    // policy over the whole `outbox` table. The rejected alternative is recorded
    // in 000-docs/056 §5: it would have made every row of the busiest table in the
    // system readable inside a declared scope, in order to save one query per
    // shop per tick.
    //
    // With no `shopId` the transaction sets no context, and for the APPLICATION
    // role that means it claims nothing — fail closed. It is not an error case:
    // the migrate-role callers in the integration lane own the tables and bypass
    // the policies, which is how a test drives a claim without naming a shop.
    { label: "outbox-claim", ...(opts.shopId ? { tenant: { shopId: opts.shopId } } : {}) }
  );
}

/**
 * Append one attempt row. Takes a `Queryable` because a terminal attempt is
 * written inside the consumer's OWN recording transaction (043 §4.1) when the
 * consumer has one, and on the pool when it does not.
 *
 * `created_at` is the column default — server-side `now()` — and is never passed
 * in (043 A7). There is no parameter for it and there must not be one.
 */
export async function recordAttempt(
  db: Queryable,
  args: {
    shopId: string;
    outboxId: string;
    attemptNo: number;
    kind: Exclude<AttemptKind, "started">;
    detail?: AttemptDetail;
    authoredBy?: "human" | "system" | "provider";
    operatorId?: string | null;
    reason?: string | null;
  }
): Promise<void> {
  const detail = assertAttemptDetail(args.detail);
  await db.query(
    `INSERT INTO outbox_attempt
       (shop_id, outbox_id, attempt_no, kind, detail, authored_by, operator_id, reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      args.shopId,
      args.outboxId,
      args.attemptNo,
      args.kind,
      detail === undefined ? null : JSON.stringify(detail),
      args.authoredBy ?? "system",
      args.operatorId ?? null,
      args.reason ?? null,
    ]
  );
}

// ---------------------------------------------------------------------------
// The consumer registry (043 §4.1, A2)
// ---------------------------------------------------------------------------

/** What a consumer is handed. It never sees the poller, the claim query or the params it did not ask for. */
export interface ConsumerContext {
  readonly pool: pg.Pool;
  readonly claim: Claim;
  readonly params: OutboxParams;
}

export type ConsumerOutcome =
  | { readonly status: "delivered"; readonly detail?: AttemptDetail }
  | { readonly status: "failed"; readonly permanent?: boolean; readonly detail?: AttemptDetail }
  | { readonly status: "dead_letter"; readonly reasonCode: ReasonCode; readonly detail?: AttemptDetail };

export type OutboxConsumer = (ctx: ConsumerContext) => Promise<ConsumerOutcome>;

/**
 * The registry, and it is where consumer idempotency is GATED (043 A2, REQUIRED).
 *
 * The rule — a consumer is idempotent under CONCURRENT duplicate delivery, by a
 * database constraint or a provider-side natural key, never by a read-then-write
 * check — is not proved against one hand-picked consumer. Registering a consumer
 * enrols it in `tests/integration/consumer-idempotency.test.ts`, which iterates
 * this registry and constructs the concurrent duplicate against EVERY entry, and
 * in `tests/contract/consumer-write-shape.test.ts`, which lints the handler
 * source for the read-then-write shape. **There is no way to add a consumer and
 * not be tested**, which is the property a per-instance test cannot have: a rule
 * enforced by one example is a rule enforced by whoever remembers the example.
 */
export interface ConsumerRegistry {
  register(event: string, consumer: OutboxConsumer): void;
  get(event: string): OutboxConsumer | undefined;
  /** Every registered entry, for the parametric contract test to iterate. */
  entries(): ReadonlyArray<readonly [string, OutboxConsumer]>;
}

export function createConsumerRegistry(): ConsumerRegistry {
  const map = new Map<string, OutboxConsumer>();
  return {
    register(event, consumer) {
      if (!isCatalogueEvent(event)) throw new UnknownEventError(event);
      if (map.has(event)) {
        throw new Error(
          `refusing to register a second consumer for "${event}". One event, one consumer: ` +
            `two handlers for one name is a dispatch ambiguity the registry cannot resolve, ` +
            `and fan-out is a second event name (043 §3.3's catalogue), not a second handler.`
        );
      }
      map.set(event, consumer);
    },
    get: (event) => map.get(event),
    entries: () => [...map.entries()],
  };
}

// ---------------------------------------------------------------------------
// The drain
// ---------------------------------------------------------------------------

export interface DrainLogger {
  info(msg: string): void;
  error(msg: string): void;
}

export interface DrainResult {
  readonly claimed: number;
  readonly delivered: number;
  readonly failed: number;
  readonly deadLettered: number;
}

/**
 * One drain cycle: claim, dispatch, record. Exported separately from the poller
 * so an integration test drives it deterministically rather than waiting on a
 * timer.
 *
 * THE EXTERNAL EFFECT HAPPENS BETWEEN TWO TRANSACTIONS, OUTSIDE BOTH. That is
 * not a compromise around 041 §4.1 — it is what 041 §4.1 requires once you
 * accept that a Shopify mutation cannot be rolled back. A consumer records its
 * own facts in its own transaction and returns an outcome; this function writes
 * only the attempt row.
 */
export async function drainOnce(
  pool: pg.Pool,
  registry: ConsumerRegistry,
  params: OutboxParams,
  opts: { shopId?: string | null; limit?: number; jitterExpr?: string; logger?: DrainLogger } = {}
): Promise<DrainResult> {
  const claims = await claimBatch(pool, params, opts);
  let delivered = 0;
  let failed = 0;
  let deadLettered = 0;

  for (const claim of claims) {
    const consumer = registry.get(claim.event);
    if (!consumer) {
      // A deployment defect, not a transient one: retrying cannot register a
      // handler. Dead-letter on the first attempt with a code that says which.
      await recordAttempt(tenantDb(pool, claim.shopId), {
        shopId: claim.shopId,
        outboxId: claim.outboxId,
        attemptNo: claim.attemptNo,
        kind: "dead_lettered",
        detail: { reason_code: "no_consumer_registered" },
      });
      deadLettered += 1;
      continue;
    }

    const startedAt = Date.now();
    let outcome: ConsumerOutcome;
    try {
      outcome = await consumer({ pool, claim, params });
    } catch (err) {
      // The CLASS of failure, never the message: an exception string is prose
      // that can carry a response body, a token or a shop's content, and
      // `detail` is allowlisted precisely so it cannot (043 §2.5, I6).
      outcome = {
        status: "failed",
        detail: { error_class: err instanceof Error ? err.constructor.name : "unknown" },
      };
    }
    const durationMs = Date.now() - startedAt;

    if (outcome.status === "delivered") {
      // Every attempt row is written through the claimed row's OWN tenant context
      // (E03-B04): `outbox_attempt` carries a `shop_id` and therefore a policy, and
      // a pool-level INSERT with no context would be refused by its `WITH CHECK`.
      await recordAttempt(tenantDb(pool, claim.shopId), {
        shopId: claim.shopId,
        outboxId: claim.outboxId,
        attemptNo: claim.attemptNo,
        kind: "delivered",
        detail: { ...outcome.detail, duration_ms: durationMs },
      });
      delivered += 1;
      continue;
    }

    if (outcome.status === "dead_letter") {
      await recordAttempt(tenantDb(pool, claim.shopId), {
        shopId: claim.shopId,
        outboxId: claim.outboxId,
        attemptNo: claim.attemptNo,
        kind: "dead_lettered",
        detail: { ...outcome.detail, reason_code: outcome.reasonCode, duration_ms: durationMs },
      });
      deadLettered += 1;
      continue;
    }

    // A failure. Permanent failures dead-letter on the first attempt with no
    // backoff (043 §5.2); transient ones dead-letter only when the PROVISIONAL
    // ceiling is reached (§5.3).
    const terminal = isTerminalFailure(outcome, claim.attemptNo, params.maxAttempts);
    if (terminal) {
      await recordAttempt(tenantDb(pool, claim.shopId), {
        shopId: claim.shopId,
        outboxId: claim.outboxId,
        attemptNo: claim.attemptNo,
        kind: "dead_lettered",
        detail: {
          ...outcome.detail,
          reason_code: outcome.permanent === true ? "permanent_provider_error" : "attempt_ceiling_reached",
          attempt_ceiling: params.maxAttempts,
          duration_ms: durationMs,
        },
      });
      deadLettered += 1;
    } else {
      await recordAttempt(tenantDb(pool, claim.shopId), {
        shopId: claim.shopId,
        outboxId: claim.outboxId,
        attemptNo: claim.attemptNo,
        kind: "failed",
        detail: { ...outcome.detail, duration_ms: durationMs },
      });
      failed += 1;
    }
  }

  return { claimed: claims.length, delivered, failed, deadLettered };
}

/**
 * Every shop in the estate, oldest first — the poller's outer loop (E03-B04).
 *
 * `shop` is the ONE table a sweep may read without a tenant: it carries no
 * `shop_id` column, so it carries no policy, and `src/db/rowLevelSecurity.ts`
 * records why with the reason on its exemption row. Everything the sweep does
 * AFTER this — the claim, the dispatch, every attempt row — happens under one
 * shop's context at a time.
 */
async function shopIdsToDrain(pool: pg.Pool): Promise<string[]> {
  // THE ONE READ THIS SWEEP CANNOT SCOPE, and it now says so. `shop` used to carry
  // no policy at all; the invariant review found the two reasons for that had
  // stopped holding, so the tenant table is policied on its own `id` and asking
  // WHICH shops exist is a declared cross-tenant scope. Everything after this line
  // — the claim, the dispatch, every attempt row — runs under one shop's context.
  const res = await serviceDb(pool, "outbox-sweep").query(`SELECT id FROM shop ORDER BY created_at`);
  return (res.rows as Array<{ id: string }>).map((r) => r.id);
}

/**
 * One drain cycle across EVERY shop, one shop at a time (E03-B04).
 *
 * **The cost is one claim query per shop per tick, and it is stated rather than
 * hidden.** The alternative was a cross-tenant claim inside a declared service
 * scope — one query per tick whatever the estate looks like — and it was rejected
 * because it would put a permissive policy on `outbox`, the busiest shop-scoped
 * table in the system, to save a query on a v0 with a handful of shops
 * (000-docs/056 §5). The number to watch is shops × ticks; when it stops being
 * negligible the fix is a service-scoped read of the shops that HAVE work, which
 * is a smaller widening than a cross-tenant claim and is E13-B03's to make.
 *
 * `batchSize` becomes per shop rather than per cycle, which is the second
 * consequence and the reason it is written here: a cycle can now do up to
 * shops × batchSize units of work.
 */
export async function drainAllShops(
  pool: pg.Pool,
  registry: ConsumerRegistry,
  params: OutboxParams,
  opts: { limit?: number; jitterExpr?: string; logger?: DrainLogger } = {}
): Promise<DrainResult> {
  const total: { claimed: number; delivered: number; failed: number; deadLettered: number } = {
    claimed: 0,
    delivered: 0,
    failed: 0,
    deadLettered: 0,
  };
  for (const shopId of await shopIdsToDrain(pool)) {
    const result = await drainOnce(pool, registry, params, { ...opts, shopId });
    total.claimed += result.claimed;
    total.delivered += result.delivered;
    total.failed += result.failed;
    total.deadLettered += result.deadLettered;
  }
  return total;
}

/**
 * The poller: ONE per process, `setInterval`, unref'd, returning a stop function
 * — the shape `scheduleAppendOnlyCheck` already uses
 * (`src/services/appendOnlyDetector.ts:169-190`).
 *
 * Choosing the shape already in the tree is not laziness; it is 041 §9.2 item
 * 4's reasoning about the trigger list applied to a runtime pattern — *a second
 * spelling of one thing is how two things start to drift.* The precedent is
 * tested, it is unref'd so it never holds the process open, and its stop function
 * is what makes an integration test deterministic.
 *
 * `LISTEN`/`NOTIFY` was the alternative and 043 §10 A4 records why it loses at
 * this scale: a notification is not durable, so a poller is required anyway as
 * the backstop, and then there are two mechanisms where one would do — and the
 * latency it buys is invisible, because the operator does not wait on the draft
 * (043 §4.2). E13-B03 owns the call to revisit it.
 *
 * NO OVERLAPPING CYCLES. A cycle that outlives its interval must not have a
 * second one start beside it: two cycles in one process would race for the same
 * rows, which `SKIP LOCKED` makes SAFE but which makes the "one poller per
 * process" sentence false. The in-flight flag keeps it true.
 *
 * HEARTBEAT (043 §5.4, §11 I20). Every cycle emits a liveness line. Routing it
 * into the estate notify path is E13-B04's, and adding the drain as 019 T34's
 * next heartbeat is an E00-B03 amend-by-row candidate with its text supplied and
 * NOT applied here — 019 is a ratified contract and this bead has no standing
 * over it (041 §9.3's precedent).
 */
export function startOutboxPoller(
  pool: pg.Pool,
  registry: ConsumerRegistry,
  params: OutboxParams = DEFAULT_OUTBOX_PARAMS,
  logger: DrainLogger = console
): () => void {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    void drainAllShops(pool, registry, params, { logger })
      .then((result) => {
        // The liveness signal fires on EVERY cycle, including an empty one — a
        // heartbeat that only beats when there is work is not a heartbeat.
        logger.info(
          `[outbox] drain cycle ok: claimed=${result.claimed} delivered=${result.delivered} ` +
            `failed=${result.failed} dead_lettered=${result.deadLettered}`
        );
      })
      .catch((err: unknown) => {
        logger.error(`[outbox] drain cycle could not run: ${(err as Error).message}`);
      })
      .finally(() => {
        running = false;
      });
  }, params.pollIntervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
