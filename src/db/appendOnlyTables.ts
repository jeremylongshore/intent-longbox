// The declared append-only trigger set: ONE list, THREE readers.
//
// WHY THIS FILE EXISTS (041 §9.2 item 4). Before it, the trigger set was spelled
// four times — `migrations/001_init.sql:174-181`, `migrations/003_reserve_principle_slots.sql:237-248`,
// `migrations/005_listing_status_observation.sql:141-155` and the two integration
// tests — and the copies already disagreed with each other. A property nobody can
// read off a single line is a property nobody can test. So the set is declared
// here, once, and read by:
//
//   1. the CI gate-test (`tests/integration/migrations.test.ts`), which asserts
//      equality in BOTH directions against `pg_trigger`: every declared trigger
//      exists and is `ENABLE ALWAYS`, and no table carries a `%_append_only`
//      trigger without appearing here;
//   2. the runtime detector (`src/services/appendOnlyDetector.ts`), which runs at
//      boot and on a timer against the live database;
//   3. every future migration that adds an append-only table — its trigger loop
//      must add the row here in the same PR, and the both-directions assertion in
//      reader 1 is what makes forgetting that a red build rather than a silent hole.
//
// SQL cannot import TypeScript, so `migrations/006_append_only_enable_always.sql`
// carries the same list inline and cites this file as its source of truth. That
// duplication is deliberate and bounded: reader 1 fails the moment the two drift.
//
// EXEMPTIONS ARE ROWS, NEVER ABSENCES (041 §9.2 item 4). A table that is
// deliberately mutable is recorded in `APPEND_ONLY_EXEMPTIONS` with the record
// that exempted it, whether it is `temporary` or `permanent`, and — for a table the
// design has settled but the tree does not contain yet — `pending: true`. An absence
// is indistinguishable from an oversight; a declared exemption is a decision a
// reviewer can argue with, and a pending row is one the gate-test makes someone flip
// deliberately when the table lands.
//
// AND THE ROW CARRIES THE §2.5 EXTERNAL-OBSERVATION FLAG, so the two properties a
// table declares — is it append-only, and may `observed_at` order its derivation —
// live on one line rather than in two lists that can disagree.

/** One append-only table and the trigger that enforces its immutability. */
export interface AppendOnlyTrigger {
  /** Table name in the `public` schema. */
  readonly table: string;
  /** Trigger name — by convention `<table>_append_only`. */
  readonly trigger: string;
  /** The migration that created the trigger, for the reader chasing provenance. */
  readonly since: string;
  /**
   * 041 §2.5 / §9.2 item 4 — the external-observation flag. TRUE only for a table
   * whose rows are Longbox's record of a fact owned by ANOTHER system; such a table
   * may order its derivation by `observed_at`, because the external system owns the
   * ordering of its own observations. FALSE for every table recording a Longbox act,
   * where `observed_at` renders and never decides and the order is `session_seq`
   * then `created_at` (041 §5.3).
   *
   * It lives on this row so the two properties a table declares — is it append-only,
   * and may `observed_at` order it — are read off one line. `listing_status_observation`
   * is the only table flagged today; it already indexes and reads
   * `(shopify_draft_id, observed_at DESC, id DESC)` (`005:94-95`,
   * `src/services/listingStatus.ts:141`), which is what forced 041 v1.0.0's flat
   * prohibition to be corrected rather than the shipped migration to be defected.
   *
   * NOT READ YET. The §2.5 envelope check that asserts no undeclared table orders by
   * `observed_at`, and that the declared ones satisfy §2.5's three conditions, is
   * E02-B07/E02-D04's — the envelope migration is where `observed_at` reaches the
   * other tables. Declared here now so that migration has one place to read.
   */
  readonly ordersByObservedAt: boolean;
  /**
   * 041 §5.3 / §10 row 2 — the per-session commit counter. TRUE for a table that is
   * SESSION-scoped (carries `scan_session_id`), which is 041 I1's own criterion:
   * "for shop-scoped, session-scoped tables — `session_seq`". Such a table gains a
   * nullable `session_seq bigint`, a `UNIQUE (scan_session_id, session_seq)` index,
   * and an assignment inside the request transaction under the anchor lock
   * (`assignSessionSeq`, `src/services/scanSession.ts`).
   *
   * FALSE for a table with no session: `corpus_version`, `retention_policy`,
   * `retention_hold`, `retention_hold_release`, `media_deletion` (keyed on a photo)
   * and `listing_status_observation` (keyed on a draft). Ordering those by a
   * session's counter would be a claim 041 §2.0's consistency model does not make —
   * "above a session … nothing orders anything".
   *
   * READ BY THREE: `migrations/007_observation_envelope.sql`'s loop restates this
   * list (SQL cannot import TypeScript), `tests/integration/migrations.test.ts`
   * asserts the two agree in BOTH directions, and `assignSessionSeq` takes its
   * `max()` across exactly these tables.
   */
  readonly sessionSeq: boolean;
}

/**
 * Every table whose immutability is enforced by a `forbid_mutation()` trigger
 * that MUST be `ENABLE ALWAYS` (`pg_trigger.tgenabled = 'A'`).
 *
 * Sorted by table name so the test's `toEqual` reads as a diffable list.
 */
export const APPEND_ONLY_TABLES: readonly AppendOnlyTrigger[] = [
  {
    table: "candidate_set",
    trigger: "candidate_set_append_only",
    since: "001_init.sql",
    ordersByObservedAt: false,
    sessionSeq: true,
  },
  {
    table: "condition_assessment",
    trigger: "condition_assessment_append_only",
    since: "001_init.sql",
    ordersByObservedAt: false,
    sessionSeq: true,
  },
  {
    table: "corpus_version",
    trigger: "corpus_version_append_only",
    since: "001_init.sql",
    ordersByObservedAt: false,
    sessionSeq: false,
  },
  {
    table: "cost_log",
    trigger: "cost_log_append_only",
    since: "001_init.sql",
    ordersByObservedAt: false,
    sessionSeq: true,
  },
  {
    table: "human_confirmation",
    trigger: "human_confirmation_append_only",
    since: "001_init.sql",
    ordersByObservedAt: false,
    sessionSeq: true,
  },
  {
    table: "listing_status_observation",
    trigger: "listing_status_observation_append_only",
    since: "005_listing_status_observation.sql",
    ordersByObservedAt: true,
    sessionSeq: false,
  },
  {
    table: "llm_rerank",
    trigger: "llm_rerank_append_only",
    since: "001_init.sql",
    ordersByObservedAt: false,
    sessionSeq: true,
  },
  {
    table: "media_deletion",
    trigger: "media_deletion_append_only",
    since: "003_reserve_principle_slots.sql",
    ordersByObservedAt: false,
    sessionSeq: false,
  },
  {
    table: "pricing_snapshot",
    trigger: "pricing_snapshot_append_only",
    since: "001_init.sql",
    ordersByObservedAt: false,
    sessionSeq: true,
  },
  {
    table: "retention_hold",
    trigger: "retention_hold_append_only",
    since: "003_reserve_principle_slots.sql",
    ordersByObservedAt: false,
    sessionSeq: false,
  },
  {
    table: "retention_hold_release",
    trigger: "retention_hold_release_append_only",
    since: "003_reserve_principle_slots.sql",
    ordersByObservedAt: false,
    sessionSeq: false,
  },
  {
    table: "retention_policy",
    trigger: "retention_policy_append_only",
    since: "003_reserve_principle_slots.sql",
    ordersByObservedAt: false,
    sessionSeq: false,
  },
  {
    table: "scan_photo",
    trigger: "scan_photo_append_only",
    since: "001_init.sql",
    ordersByObservedAt: false,
    sessionSeq: true,
  },
  {
    table: "scan_session_transition",
    trigger: "scan_session_transition_append_only",
    since: "010_scan_session_transition.sql",
    ordersByObservedAt: false,
    sessionSeq: true,
  },
  {
    table: "shopify_draft",
    trigger: "shopify_draft_append_only",
    since: "001_init.sql",
    ordersByObservedAt: false,
    sessionSeq: true,
  },
];

/** A table declared exempt from the append-only set, with the record that exempted it. */
export interface AppendOnlyExemption {
  readonly table: string;
  /**
   * `temporary` — it joins the set when a named record's step lands.
   * `permanent` — it is not a witness table and never will be.
   */
  readonly kind: "temporary" | "permanent";
  readonly reason: string;
  /**
   * TRUE for a table the design has decided about but the tree does not contain yet.
   * The gate-test asserts a pending row is ABSENT from the schema, so the flag has to
   * be flipped deliberately when the table lands rather than quietly going stale.
   */
  readonly pending?: boolean;
  /**
   * What the application role may do with this table (E02-D06).
   *
   * `"full"` (the default) — the table is deliberately mutable BY THE APPLICATION,
   * so the app role gets SELECT/INSERT/UPDATE/DELETE.
   * `"none"` — exempt from the append-only trigger AND from the application
   * entirely: the app never reads or writes it, so it gets no privilege at all.
   *
   * THE FIELD LIVES HERE RATHER THAN IN A THIRD LIST IN `appRoleGrants.ts`, and
   * the invariant review asked for one or the other explicitly. One list wins for
   * the same reason this file exists at all: a property spelled in two places is a
   * property that can disagree with itself, and a reader asking "what is this
   * table's status?" should not have to know that the answer is split across two
   * modules. Exemption is already a row with a reason; the app's access to that
   * table is one more column on the same row, and it stays visible next to the
   * reason it was exempted.
   */
  readonly appGrant?: "full" | "none";
}

/**
 * Tables that carry no append-only trigger, and the record that says why.
 *
 * These are NOT append-only tables with a missing trigger — they are tables the
 * design deliberately allows to change, and naming them here is what keeps the
 * both-directions assertion honest instead of merely permissive. 041 §9.2 item 4
 * declares three; the config tables below are the tree's own, unlisted there because
 * 041 was reasoning about witness tables.
 */
export const APPEND_ONLY_EXEMPTIONS: readonly AppendOnlyExemption[] = [
  {
    table: "scan_session",
    kind: "temporary",
    reason:
      "An identity, not an observation (locked decision 4). Its status column is the workflow " +
      "state machine's cursor; 040 §8.2 step 4 replaces that with an observation table, and the " +
      "trigger lands with that migration, not before. (041 §9.2 item 4, exempt temporary.)",
  },
  {
    table: "request_idempotency",
    kind: "permanent",
    reason:
      "041 §8.5 / A11: not a witness table — an operational cache recording only what this " +
      "server replied to a key it has already seen, holding response bodies that must be " +
      "SWEEPABLE so a deletion right can be honoured. Deleting an expired key destroys no " +
      "history. This reverses 040 §8.1 step 6, which put a trigger on it. AND (042 A5, the " +
      "third reason the draft had not seen) the row is UPDATEd by construction: 042 §5.3 " +
      "INSERTs it, does the work, then completes it with the response — legal precisely " +
      "because of this exemption. Landed by migrations/009_request_idempotency.sql at " +
      "E02-B10, so the `pending` flag is gone; the ROUTE wiring is still E02-B08's and the " +
      "retention window stays E13-B01's.",
  },
  {
    table: "physical_item_active_listing",
    kind: "permanent",
    pending: true,
    reason:
      "041 §9.2 item 4: a materialized index over the log (036 §5.2, §6.2) — keys only, " +
      '"there is nothing here to preserve"; a row is INSERTed on bind and DELETEd on release, ' +
      "and deleting one destroys no history because the facts it indexes stay in the log. " +
      "Does not exist yet (041 §1 E19): 036 §7.1's migration is unwritten.",
  },
  {
    table: "shop",
    kind: "permanent",
    reason: "Configuration, not a witness — a shop's name and slug are edited in place by design.",
  },
  {
    table: "shop_credentials",
    kind: "permanent",
    reason: "Configuration: a key_ref is rotated in place; the secret it names never lives here.",
  },
  {
    table: "shop_pricing_policy",
    kind: "permanent",
    reason:
      "Configuration. A policy change is already modelled as a new row (003:seed comment), but " +
      "the table is not trigger-locked pending E08's policy-versioning decision.",
  },
  {
    table: "schema_migrations",
    kind: "permanent",
    appGrant: "none",
    reason:
      "The migration runner's own ledger; it is infrastructure, not domain data — and the " +
      "application role gets NO privilege on it at all (E02-D06). The app never reads or writes " +
      "it: the only reference to the name anywhere outside `scripts/migrate.ts` is this row. " +
      "Granting it the uniform exempt-table DML would be actively unsafe, not merely generous: " +
      "a DELETE on this ledger makes the next `pnpm migrate` re-apply `003`, whose trigger loop " +
      "is DROP-then-CREATE, and `CREATE TRIGGER` always lands at the bypassable `tgenabled='O'` " +
      "default — so a row deleted here silently downgrades the append-only guarantee that " +
      "migration `006` exists to hold at 'A'.",
  },
];

/** Convenience for the SQL `IN (...)`-shaped callers and for assertions. */
export const APPEND_ONLY_TABLE_NAMES: readonly string[] = APPEND_ONLY_TABLES.map((t) => t.table);

/**
 * The session-scoped witness tables — those that carry `session_seq` (041 §5.3).
 *
 * `assignSessionSeq` takes its `max()` across exactly this set, because the counter
 * is per SESSION and not per table: the order it establishes is the order of two
 * rows about one session, whichever tables they sit in, and Postgres has no
 * cross-table unique constraint to enforce that. What makes it correct across the
 * set is the anchor lock (041 §4.2), under which every assignment happens; the
 * per-table `UNIQUE (scan_session_id, session_seq)` index is the loud failure if
 * that ever stops being true.
 */
export const SESSION_SEQ_TABLE_NAMES: readonly string[] = APPEND_ONLY_TABLES.filter((t) => t.sessionSeq).map(
  (t) => t.table
);
