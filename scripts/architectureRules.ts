// The NON-GRAPH half of the architecture gate (E02-B10; 029 §5 move 8 defect N2,
// 042 I5, 042 I22, 040 §8.2 step 1). Pure functions over file text, so every rule
// has a negative fixture and none of them needs a database or a build.
//
// WHY A SECOND MECHANISM AT ALL. `depcruise` reads the IMPORT GRAPH, and 029 says
// plainly what that cannot see: `src/routes/scanSessions.ts` does its damage
// through `db.query` on a `Pool` handed in as a PARAMETER — six calls, no import.
// "Import-graph analysis alone cannot close this." Every rule here is one of those:
// a property of what a file SAYS, not of what it imports.
//
// EVERY EXEMPTION IS A ROW WITH A REASON AND A KIND (042 §3.4, amendment A8).
// `exemption` is a deliberate, permanent allowance. `defect` is a violation that
// exists today, is named, and has a closing bead — and **042 A8 rules that no
// defect-kind row may exist at G2**, so the rows below are also the list of what
// G2 is waiting on. That distinction is the whole difference between a declared
// allowlist and a waiver by declaration.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { findDuplicateMigrationNumbers } from "./migrationDiscipline.js";

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export interface SourceFile {
  /** Repo-relative, forward slashes: `src/routes/scanSessions.ts`. */
  readonly path: string;
  readonly text: string;
}

export type ExemptionKind = "exemption" | "defect";

export interface Finding {
  readonly rule: string;
  readonly message: string;
}

// ---------------------------------------------------------------------------
// Rule 1 — 042 I5(b): no `SELECT *` outside a declared exemption list.
// ---------------------------------------------------------------------------

export interface SelectStarRow {
  readonly path: string;
  /** How many `SELECT *` occurrences that file is allowed. Exact, never a ceiling. */
  readonly count: number;
  readonly kind: ExemptionKind;
  readonly reason: string;
  /** Required when `kind === "defect"`. */
  readonly closingBead?: string;
}

/**
 * 042 I5(b): "no file under `src/` contains `SELECT *` outside a declared
 * exemption list, each row carrying a reason; the list is expected to hold
 * `getSessionEvents`'s trail read and nothing else."
 *
 * At E02-B10 it held two more than that, declared as DEFECTS rather than quietly
 * folded in. **E02-D08 removed both** — `getScanSession` and `lockScanSession` now
 * name their columns — so the list is back to the one row 042 predicted, and its
 * kind is `exemption` because that is what it now is. Turning a named defect into
 * an exemption to make a gate green is still the move this file exists to prevent;
 * what makes this legitimate is that the occurrences are GONE, not reclassified.
 */
export const SELECT_STAR_ROWS: readonly SelectStarRow[] = [
  {
    path: "src/services/scanSession.ts",
    count: 1,
    kind: "exemption",
    reason:
      "`getSessionEvents`'s trail read, and 042 I5 names it in advance: the list \"is expected to " +
      "hold `getSessionEvents`'s trail read and nothing else\". It is legitimate because 041 I9 " +
      "makes the trail COMPLETE — a column list there would silently drop a column a later " +
      "migration adds, which is the opposite defect. **The bound belongs on the PROJECTION, not " +
      "on the read**: `src/contracts/v1/schemas.ts` declares a per-table DTO and " +
      "`getSessionDetail` projects onto it, so a new column reaches the log and does not reach a " +
      "response body. E02-D08 removed the other two — `getScanSession` and `lockScanSession` now " +
      "name `id, shop_id, created_at`, which is what stops `scan_session.status` leaking from a " +
      "projection that does not select it (040 A8, 042 E15). The kind flipped from `defect` to " +
      "`exemption` with them.",
  },
];

const SELECT_STAR = /SELECT\s+\*/gi;

export function checkSelectStar(files: readonly SourceFile[]): Finding[] {
  const findings: Finding[] = [];
  const byPath = new Map(SELECT_STAR_ROWS.map((r) => [r.path, r]));
  const seen = new Set<string>();

  for (const file of files) {
    if (!file.path.startsWith("src/")) continue;
    const n = (file.text.match(SELECT_STAR) ?? []).length;
    if (n === 0) continue;
    seen.add(file.path);
    const row = byPath.get(file.path);
    if (!row) {
      findings.push({
        rule: "no-select-star",
        message:
          `${file.path}: ${n} \`SELECT *\` occurrence(s) and no declared row (042 I5(b)). ` +
          `A response derived from \`SELECT *\` ships whatever the schema happens to hold, ` +
          `which is how \`scan_session.status\` reached a response body 040 spent a document ` +
          `retiring. Name the columns, or add a row to SELECT_STAR_ROWS with a reason and — ` +
          `if it is a violation rather than a design — kind "defect" and a closing bead.`,
      });
      continue;
    }
    if (n !== row.count) {
      findings.push({
        rule: "no-select-star",
        message:
          `${file.path}: declared ${row.count} \`SELECT *\` occurrence(s), found ${n}. ` +
          (n > row.count
            ? `A new one was added; name the columns instead.`
            : `One was removed — good. Lower the count in SELECT_STAR_ROWS (and delete the row ` +
              `entirely when it reaches 0) so the declaration keeps meaning what it says.`),
      });
    }
  }
  for (const row of SELECT_STAR_ROWS) {
    if (!seen.has(row.path)) {
      findings.push({
        rule: "no-select-star",
        message: `${row.path}: declared in SELECT_STAR_ROWS but contains no \`SELECT *\` (or does not exist). Remove the stale row.`,
      });
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Rule 2 — 029 §5 move 8 defect N2: the route layer does not touch the database.
// ---------------------------------------------------------------------------

export interface RouteDbRow {
  readonly path: string;
  readonly dbQuery: number;
  readonly insertInto: number;
  readonly providerImports: number;
  /** `import … from "pg"` — including a TYPE-only import, which is what the tree has. */
  readonly pgImports: number;
  readonly kind: ExemptionKind;
  readonly closingBead?: string;
  readonly reason: string;
}

/**
 * The declared inventory of route-layer database access — **now empty**.
 *
 * 029 §5 move 8 obliges the gate to assert "that no file under `src/routes/`
 * contains `db.query` or `INSERT INTO`". E02-B10 could not satisfy that and said
 * so: the route file owned the calls, and moving them was 029 §5 moves 2 and 6,
 * fenced to E02-D09 and E02-D08. Both have now run. E02-D09 took `insertInto` to
 * zero; E02-D08 took `dbQuery`, `providerImports` and `pgImports` there.
 *
 * The rule still ships as an EXACT COUNT and not as a bare zero, because the
 * shape is what makes an inventory shrink DELIBERATELY: a new call fails the
 * gate, and a removed call also fails it until someone lowers the number. With
 * no rows, the default below (zero of everything) governs every route file, so
 * the first reintroduced statement fails with no row to hide behind.
 */
export const ROUTE_DB_ROWS: readonly RouteDbRow[] = [
  // EMPTY, AND THAT IS THE POINT. E02-D08 executed 029 §5 move 6: the three
  // remaining `db.query` reads (`requireShop`, `latestPolicy`, the shop list),
  // the `pg` type import and the provider import all moved into
  // `src/services/sessionApi.ts`, and `src/routes/scanSessions.ts` now validates
  // and calls one function per route. The default row below — zero of
  // everything — therefore governs every file under `src/routes/`, so a single
  // reintroduced `db.query` fails the gate with no row to hide behind.
  //
  // The three `.dependency-cruiser.cjs` `pathNot` exemptions that named this file
  // went with them, and `tests/contract/architecture-gate.test.ts` asserts the
  // config no longer names it anywhere.
];

const DB_QUERY = /\bdb\.query\s*[(<]/g;
const INSERT_INTO = /\bINSERT\s+INTO\b/gi;
const PROVIDER_IMPORT = /from\s+["'][^"']*providers\//g;
const PG_IMPORT = /from\s+["']pg["']/g;

export function checkRouteDbAccess(files: readonly SourceFile[]): Finding[] {
  const findings: Finding[] = [];
  const byPath = new Map(ROUTE_DB_ROWS.map((r) => [r.path, r]));

  for (const file of files) {
    if (!file.path.startsWith("src/routes/")) continue;
    const actual = {
      dbQuery: (file.text.match(DB_QUERY) ?? []).length,
      insertInto: (file.text.match(INSERT_INTO) ?? []).length,
      providerImports: (file.text.match(PROVIDER_IMPORT) ?? []).length,
      pgImports: (file.text.match(PG_IMPORT) ?? []).length,
    };
    const row = byPath.get(file.path) ?? {
      path: file.path,
      dbQuery: 0,
      insertInto: 0,
      providerImports: 0,
      pgImports: 0,
      kind: "exemption" as ExemptionKind,
      reason: "undeclared route file — the default is zero of everything",
    };
    for (const key of ["dbQuery", "insertInto", "providerImports", "pgImports"] as const) {
      if (actual[key] !== row[key]) {
        findings.push({
          rule: "routes-do-not-touch-the-database",
          message:
            `${file.path}: declared ${row[key]} \`${key}\` occurrence(s), found ${actual[key]} ` +
            `(029 §5 move 8, defect N2). The HTTP edge is thin: a route validates and calls one ` +
            `function. ` +
            (actual[key] > row[key]
              ? `Move the statement into the module that owns the table (029 §2.10).`
              : `One was removed — lower the count in ROUTE_DB_ROWS, and delete the row when every ` +
                `count reaches 0.`),
        });
      }
    }
  }
  for (const row of ROUTE_DB_ROWS) {
    if (!files.some((f) => f.path === row.path)) {
      findings.push({
        rule: "routes-do-not-touch-the-database",
        message: `${row.path}: declared in ROUTE_DB_ROWS but not present. Remove the stale row.`,
      });
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Rule 3 — 029 §2.8 / §5 move 7 (V5): reporting is the ONLY writer of cost_log.
// ---------------------------------------------------------------------------

/** The one module allowed to `INSERT INTO cost_log`. Relocates to `src/modules/reporting/` at E02-B03 move 3. */
export const COST_LOG_WRITER = "src/services/costLog.ts";

const COST_LOG_INSERT = /INSERT\s+INTO\s+cost_log\b/gi;

export function checkCostLogWriters(files: readonly SourceFile[]): Finding[] {
  // `.match()` and not `.test()`: a /g regex's `test()` advances `lastIndex`
  // between calls, so filtering with it skips every other match. That bug was in
  // this function's first version and the negative fixture below caught it.
  const writers = files
    .filter((f) => f.path.startsWith("src/") && (f.text.match(COST_LOG_INSERT) ?? []).length > 0)
    .map((f) => f.path)
    .sort();

  if (writers.length === 1 && writers[0] === COST_LOG_WRITER) return [];
  return [
    {
      rule: "cost-log-has-one-writer",
      message:
        `cost_log is written from [${writers.join(", ") || "nothing"}]; the only writer may be ` +
        `${COST_LOG_WRITER} (029 §2.8: reporting is strictly downstream, and §5 move 7 inverts ` +
        `the cost write so resolution EMITS a cost fact that reporting records). A second writer ` +
        `is a second definition of what a call costs, which is the thing 019's cost thresholds ` +
        `are measured from.`,
    },
  ];
}

// ---------------------------------------------------------------------------
// Rule 3b — 054 §4.4 (E03-B03): the actor audit has ONE writer.
// ---------------------------------------------------------------------------

/** The one module allowed to `INSERT INTO authorization_decision`. */
export const AUTHORIZATION_DECISION_WRITER = "src/services/auth/authorizationAudit.ts";

const AUTHORIZATION_DECISION_INSERT = /INSERT\s+INTO\s+authorization_decision\b/gi;

/**
 * `cost_log`'s rule, one table over, and the reason is sharper here.
 *
 * A second writer of a cost row is a second definition of what a call costs. A
 * second writer of an AUTHORIZATION DECISION is a row asserting that a permission
 * was granted when no decision function granted it — an audit table whose rows
 * mean two different things, which is an audit table that cannot be read at all.
 * The single writer is also what makes 054 §4.3's recording rule (every refusal;
 * an allowance only where the route mutates) a property of the system rather than
 * of one call site.
 *
 * `.match()` and not `.test()`, for the reason rule 3 records: a /g regex's
 * `test()` advances `lastIndex` between calls and skips every other match.
 */
export function checkAuthorizationDecisionWriters(files: readonly SourceFile[]): Finding[] {
  const writers = files
    .filter(
      (f) => f.path.startsWith("src/") && (f.text.match(AUTHORIZATION_DECISION_INSERT) ?? []).length > 0
    )
    .map((f) => f.path)
    .sort();

  if (writers.length === 1 && writers[0] === AUTHORIZATION_DECISION_WRITER) return [];
  return [
    {
      rule: "authorization-decision-has-one-writer",
      message:
        `authorization_decision is written from [${writers.join(", ") || "nothing"}]; the only ` +
        `writer may be ${AUTHORIZATION_DECISION_WRITER} (054 §4.4). A second writer can record a ` +
        `decision no decision function took, and 019 T35 makes what this table holds ` +
        `non-waivable — an audit of authority with two authors is not an audit.`,
    },
  ];
}

// ---------------------------------------------------------------------------
// Rule 3c — 000-docs/058 §3 (E03-D14): the origin designation has ONE writer.
// ---------------------------------------------------------------------------

/** The one module allowed to write `app_user_origin` or its retirement. */
export const ORIGIN_DESIGNATION_WRITER = "src/services/auth/origin.ts";

const ORIGIN_DESIGNATION_INSERT = /INSERT\s+INTO\s+app_user_origin(_retirement)?\b/gi;

/**
 * Rule 3b's shape, one table over, for a reason that is sharper again.
 *
 * `authorization_decision` with two writers is an audit table whose rows mean two
 * different things. `app_user_origin` with two writers is worse: it decides WHO
 * 019 T35(c)'s reconciliation watches, so a second writer is a second definition
 * of who Longbox's own people are — and a second writer of the RETIREMENT can
 * take a person out of the audited population from a call site nobody reviewed as
 * a security change.
 *
 * The privilege layer already refuses the application role both tables (058
 * §3(c), `appGrant: "none"`), so this rule is the second of the two and guards
 * the case the first cannot see: a schema-owner CLI or a future in-process job
 * reaching for the INSERT directly.
 *
 * ⚠ **IT SCANS `scripts/` AS WELL AS `src/`, AND THE FIRST VERSION DID NOT** (the
 * security lens's F6). Rules 3 and 3b are scoped to `src/` because their tables
 * are written only by the running system. This one is not: the ONLY writers of a
 * designation today are reached from `pnpm designate-staff` and
 * `pnpm retire-staff-designation`, so a rule blind to `scripts/` was blind to the
 * exact tree the act lives in — a second writer added beside the CLI would have
 * passed. It is therefore called from `architectureGate.ts` with BOTH trees, on
 * `checkServiceScopeSites`'s precedent, and never from `runArchitectureRules`,
 * which is handed `src/` alone. The allowlist is unchanged: one file, in `src/`.
 *
 * `.match()` and not `.test()`, for the reason rule 3 records: a /g regex's
 * `test()` advances `lastIndex` between calls and skips every other match.
 */
export function checkOriginDesignationWriters(files: readonly SourceFile[]): Finding[] {
  const writers = files
    .filter((f) => (f.text.match(ORIGIN_DESIGNATION_INSERT) ?? []).length > 0)
    .map((f) => f.path)
    .sort();

  if (writers.length === 1 && writers[0] === ORIGIN_DESIGNATION_WRITER) return [];
  return [
    {
      rule: "origin-designation-has-one-writer",
      message:
        `app_user_origin / app_user_origin_retirement is written from ` +
        `[${writers.join(", ") || "nothing"}]; the only writer may be ${ORIGIN_DESIGNATION_WRITER} ` +
        `(000-docs/058 §3). A second writer of a designation is a second definition of who Longbox's ` +
        `own people are, and a second writer of a RETIREMENT can narrow the population 019 T35(c) ` +
        `reconciles — which is non-waivable.`,
    },
  ];
}

// ---------------------------------------------------------------------------
// Rule 3d — 059 §5 (E03-D15): a READ of the actor audit may not be TYPED as acts.
// ---------------------------------------------------------------------------

/** Files that mention the table at all — the only ones this rule has an opinion about. */
const AUDIT_TABLE_MENTION = /authorization_decision/;

/**
 * A DECLARED numeric field under one of the three forbidden nouns. Anchored on
 * `: number`, so it catches the type and not the prose: this file, 059 and the
 * audit module all discuss the nouns at length, and a checker that counted
 * discussion would teach the next author to stop explaining themselves.
 */
const COUNT_NOUN_FIELD = /\b(acts|effects|requests)\s*\??\s*:\s*number\b/g;

/**
 * **The data-model lens's condition on 059, as a boundary rather than a habit.**
 *
 * 059 §3 rules that one row of `authorization_decision` is one AUTHORIZATION — one
 * evaluation of the grants — and never one act: a client replaying an
 * `Idempotency-Key` is re-authorized, so two rows may be one act performed once
 * (054 I9a). The whole read model depends on nobody ever presenting a count of
 * those rows as a count of acts, and at v1.0.0 that depended on a field name and
 * a regex over source text — *"a convention and not a boundary; a convention
 * decays exactly where this record predicts it will."*
 *
 * So the rule is rule 3b's shape, one column over: in any file that reads or
 * names this table, a numeric field called `acts`, `effects` or `requests` is a
 * red build. The type cannot express the wrong noun, and the comment explaining
 * why is no longer load-bearing.
 *
 * **Scope is `src/` AND `scripts/`**, which is why this is called from
 * `architectureGate.ts` with both trees rather than from `runArchitectureRules`
 * — the same reason `checkServiceScopeSites` is (NOTE 5: a pure rule does not
 * reach for the filesystem). A CLI that printed *"three acts"* from this table
 * would be exactly as wrong as a service that returned it.
 */
export function checkAuthorizationDecisionCountNouns(files: readonly SourceFile[]): Finding[] {
  const findings: Finding[] = [];
  for (const file of files) {
    if (!file.path.startsWith("src/") && !file.path.startsWith("scripts/")) continue;
    if (!AUDIT_TABLE_MENTION.test(file.text)) continue;
    // `.match()` and not `.test()`, for the reason rules 3, 3b and 3c record: a /g
    // regex's `test()` advances `lastIndex` between calls and skips every other
    // match.
    const nouns = [...new Set((file.text.match(COUNT_NOUN_FIELD) ?? []).map((m) => m.trim()))].sort();
    if (nouns.length === 0) continue;
    findings.push({
      rule: "authorization-decision-counts-are-decisions",
      message:
        `${file.path} reads or names authorization_decision and declares [${nouns.join(", ")}]; a ` +
        `count of rows in that table is a count of AUTHORIZATIONS and never of acts, effects or ` +
        `requests (059 §3, §5). A replayed Idempotency-Key is re-authorized, so two rows may be ` +
        `one act performed once — the reader's type is where that stops being a comment.`,
    });
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Rule 4 — 042 I22(a): a fixed lock acquisition order in every mutating handler.
// ---------------------------------------------------------------------------

/**
 * 042 §5.3(b), amendment A6, REQUIRED: "The `request_idempotency` INSERT is taken
 * BEFORE the anchor `SELECT … FROM scan_session … FOR UPDATE`, in every handler,
 * always." Two handlers that take the two locks in opposite orders deadlock under
 * concurrency, Postgres kills one with `40P01`, and the symptom is an intermittent
 * failure at the counter that reproduces on nobody's laptop.
 *
 * **WIDENED AT E02-D08, AFTER THE RULE WAS FOUND BLIND.** The first version scanned
 * `src/routes/` only and split on `.post(` / `.put(` registrations, which was right
 * for the tree it was written against. E02-D08 then moved every handler body into
 * `src/services/sessionApi.ts` (029 §5 move 6) and reached the two locks through
 * `runIdempotent()` and `lockOrRefuse()` rather than by spelling the SQL — so the
 * rule had **zero markers to see** and a reversed-order handler produced zero
 * findings. A rule that cannot see the code it governs is worse than no rule,
 * because the gate stays green while the property stops holding.
 *
 * Two changes close it, and both are about REACH rather than strictness:
 *   - the scan covers `src/routes/` **and** `src/services/`, split on exported
 *     function declarations as well as route registrations, because a handler is
 *     wherever the two locks are taken and not wherever Fastify is called;
 *   - each lock is recognised through its HELPER as well as its SQL —
 *     `runIdempotent` / `beginIdempotency` for the identity, `lockScanSession` /
 *     `lockOrRefuse` for the anchor. A rule that only reads SQL is one refactor
 *     away from blind, which is exactly what happened here.
 *
 * **No exceptions and no opt-out comment** (042 I22(a), literally). There is no
 * escape hatch in this function on purpose, and
 * `tests/contract/architecture-gate.test.ts` asserts BOTH directions: the real
 * `sessionApi.ts` passes, and a synthetic handler that locks before it inserts
 * FAILS — because a rule that has never failed is indistinguishable from one that
 * cannot.
 */
const HANDLER_SPLIT =
  /\.(post|put|patch|delete)\s*[(<]|(?:export\s+)?(?:async\s+)?function\s+\w+|(?:export\s+)?const\s+\w+\s*=\s*async\s*\(/g;

/**
 * The identity lock, however it is spelled. `runIdempotent` is the only caller of
 * `beginIdempotency`, which holds the INSERT — so a handler that goes through it
 * takes the row first by construction, and one that inlines the SQL is still seen.
 */
const IDEMPOTENCY_INSERT =
  /INSERT\s+INTO\s+request_idempotency\b|\brunIdempotent\s*\(|\bbeginIdempotency\s*\(/i;

/** The anchor lock, however it is spelled. */
const ANCHOR_LOCK = /(FROM\s+scan_session[\s\S]{0,200}?FOR\s+UPDATE)|\b(lockScanSession|lockOrRefuse)\s*\(/i;

/**
 * The SESSION lock — the SECOND position, added by E03-D09 (048 K1).
 *
 * ⚠ **THE ORDINALS IN THESE FOUR COMMENTS NAME THE SLOT IN THE ORDER AS IT
 * STANDS, NOT THE ORDER THE POSITION WAS ADDED IN** (E03-D11, the gate
 * audit's N1). They used to mean both at once — this one said "third" because
 * 048 K1 made the order three long, while sitting SECOND in it — and a reader
 * comparing two comments would have concluded the list was inconsistent. The
 * bead that added each is kept, because that is the history; the number is the
 * slot, because that is what the lint enforces.
 *
 * 048 inserts the authentication row's `SELECT … FOR NO KEY UPDATE` BETWEEN
 * 042's two, and the position is argued rather than assumed: identity-of-the-
 * request stays first because a replay must be recognised before it locks any
 * domain state, and the session lock comes second because **authentication is a
 * precondition of touching the subject at all** — a request that is going to be
 * refused for a dead session must not first take a lock on a live session's
 * anchor.
 *
 * Recognised through its helpers as well as its SQL, for the reason the widening
 * at E02-D08 taught: a rule that only reads SQL is one refactor away from blind,
 * and that is not hypothetical here — every caller reaches this lock through
 * `sessionLock` on the idempotent request rather than by spelling it.
 */
const SESSION_LOCK =
  /(FROM\s+app_session[\s\S]{0,200}?FOR\s+NO\s+KEY\s+UPDATE)|\b(lockSession|lockAndRotate|sessionLock)\s*[(:]/i;

/**
 * The FIRST-FACTOR lock — the THIRD position, added by E03-D11 (048 §9.1, 057 §4.5).
 * (Third in the order; the fifth position to be added to it. See the note above.)
 *
 * `verifyPassword` takes `SELECT … FOR UPDATE` on the person's `user_credential`
 * row as ITS lockout anchor — 048 §9.1's construction again, keyed per person,
 * which is §9.1's own key "for a password". It sits **after** the session lock
 * and **before** the authenticator lock, and the ordering between the two
 * credentials is not arbitrary: **the sign-in path takes BOTH in one
 * transaction**, because 048 §4.3's per-person budget is SHARED across all three
 * factors and two anchors over one count is the write-skew shape §9.1 exists to
 * close. Two handlers taking them in opposite orders would deadlock at exactly
 * the moment two people signed in at once, which reproduces on nobody's laptop.
 *
 * First factor before second is the order the FLOW has anyway (a code presented
 * without a password must not consume a step — R19), so the lint pins the order
 * the code already wants rather than imposing one on it.
 */
const CREDENTIAL_LOCK =
  /(FROM\s+user_credential[\s\S]{0,200}?FOR\s+UPDATE)|\b(lockCredential|verifyPassword)\s*\(/i;

/**
 * The AUTHENTICATOR lock — the FOURTH position, added by E03-D06 (048 §4.3, R19).
 * (Fourth in the order, and fourth to be added; see the note above the session
 * lock for why the two numbers are not always the same.)
 *
 * `verifyTotp` and `redeemRecoveryCode` take `SELECT … FOR UPDATE` on the live
 * `user_authenticator` row as their lockout anchor (048 §9.1's construction,
 * MIRRORED rather than extended, because an `operator_pin` row is keyed on a
 * device a second factor does not have). It sits **after** the session lock and
 * **before** the `scan_session` anchor, on the session lock's own reasoning one
 * step further: the request's identity is recognised first, then the session that
 * says who is asking, then the CREDENTIAL that says they are still who they claim,
 * and only then the domain subject. A handler that locked a book before checking
 * a second factor would hold domain state through an argon2id verification.
 *
 * ⚠ **NOTHING MATCHES IT TODAY**, and the rule is cheap precisely because of that:
 * E03-D06 registers no route, so no transaction takes both this lock and either
 * of the other three. It is added now, while the answer is obvious and free, so
 * that E03-D11's route inherits the order instead of choosing one — which is the
 * same reason 042 I22 existed before there were two handlers to deadlock.
 * `tests/contract/architecture-gate.test.ts` asserts BOTH directions against
 * synthetic handlers, so a rule that has never fired is still known to work.
 */
const AUTHENTICATOR_LOCK =
  /(FROM\s+user_authenticator[\s\S]{0,200}?FOR\s+UPDATE)|\b(lockLiveAuthenticator|verifyTotp|redeemRecoveryCode)\s*\(/i;

/**
 * The STORE-CLAIM lock — **the FIFTH position in the ORDER, and the SIXTH
 * ADDED to it**, by E03-D22 (056 §11 R10, §6.3; 042 v1.6.1; 000-docs/061 §5).
 *
 * ⚠ **THAT PHRASING IS THE ONE FRAMING, AND IT IS USED IN ALL THREE PLACES**
 * (the E03-D22 INVARIANT REVIEW, which found this comment, the record's §5 and
 * the RTM each counting differently; the gate audit's N1 before it had only
 * asked this comment to follow 042's idiom, which is a narrower ask and is
 * credited correctly here rather than to the reviewer who did the wider work). Two counts are genuinely in play — 042's change-log idiom counts
 * POSITIONS THE ORDER HAS (E03-D06's row says "a FOURTH position", E03-D11's "a
 * FIFTH", this bead's "a SIXTH"), while `CREDENTIAL_LOCK` below numbers by
 * SEQUENCE ("the THIRD position … the fifth position to be added"). Saying both
 * halves in one sentence is what stops a reader arriving from either direction
 * concluding the other is wrong. This lock sits between the authenticator lock
 * and the `scan_session` anchor.
 *
 * `claimStoreDomain` writes `shop.shopify_domain` inside the install callback's
 * transaction, which takes a row lock on the shop's own `shop` row and — the
 * part that is the point — waits on `shop_shopify_domain_is_one_store` while a
 * concurrent claimant is uncommitted. It is a LOCK on the tenant row, so it
 * belongs in this order rather than beside it.
 *
 * **Why it sits AFTER the three identity positions and not before them.** The
 * authentication hook takes `app_session` before any handler body exists, and
 * the privileged sign-in takes both credential locks while establishing the
 * session that a shop-config write would run under — so nothing a handler takes
 * can precede them. This is the lint pinning the order the code already has,
 * exactly as the credential positions did.
 *
 * **Why it sits BEFORE the `scan_session` anchor.** Coarse before fine, and the
 * hierarchy is real: a `scan_session` belongs to a shop. A handler that held a
 * session anchor and then reached for the tenant row would deadlock against one
 * doing the reverse, and the reverse is the one the callback already does.
 *
 * ⚠ **THE PATTERN MATCHES THE LOCK'S SHAPE AND NOT ONLY ITS NAME** (the
 * invariant review). `claimStoreDomain` and the `UPDATE … shopify_domain` it
 * runs are the shape that exists today; the third alternative catches
 * `SELECT … FROM shop … FOR [NO KEY] UPDATE`, which is the shape somebody
 * reaches for when they "optimise" the claim into an explicit row lock. That
 * refactor would REMOVE the guarantee — the btree unique is what serialises two
 * shops, not the row lock (000-docs/061 §3.1) — and without this alternative it
 * would also take the position INVISIBLY, so the lint would stop policing the
 * very handler it was added for. A negative fixture pins it.
 *
 * ⚠ **NO CHUNK TAKES TWO OF THESE TODAY** — `completeInstall` takes this one and
 * none of the other four (a provider callback carries no `Idempotency-Key`, no
 * cookie and no scan session). The position is registered now, while the answer
 * is free, for the reason the authenticator lock was: so the handler written six
 * months from now inherits an order instead of choosing one.
 */
const SHOP_CLAIM_LOCK =
  /(UPDATE\s+shop\s+SET[\s\S]{0,200}?shopify_domain)|(FROM\s+shop\b[\s\S]{0,200}?FOR\s+(NO\s+KEY\s+)?UPDATE)|\bclaimStoreDomain\s*\(/i;

/** The layers where a handler can live. A rule keyed on one layout goes blind on the next. */
const HANDLER_LAYERS = ["src/routes/", "src/services/"];

/**
 * Split a file into one chunk per handler — a route registration OR an exported
 * function, since E02-D08 the two are different files.
 */
export function splitMutatingHandlers(text: string): string[] {
  const starts: number[] = [];
  for (const m of text.matchAll(HANDLER_SPLIT)) starts.push(m.index);
  return starts.map((start, i) => text.slice(start, starts[i + 1] ?? text.length));
}

export function checkLockOrder(files: readonly SourceFile[]): Finding[] {
  const findings: Finding[] = [];
  for (const file of files) {
    if (!HANDLER_LAYERS.some((layer) => file.path.startsWith(layer))) continue;
    for (const [i, body] of splitMutatingHandlers(file.text).entries()) {
      // SIX POSITIONS SINCE E03-D22, checked over every PAIR so a chunk that
      // takes only two of the six is still policed:
      //   request_idempotency INSERT → app_session (FOR NO KEY UPDATE)
      //     → user_credential (FOR UPDATE) → user_authenticator (FOR UPDATE)
      //     → shop store-claim (UPDATE) → scan_session anchor (FOR UPDATE)
      const positions: Array<{ name: string; at: number }> = [
        { name: "its request_idempotency INSERT", at: body.search(IDEMPOTENCY_INSERT) },
        { name: "the app_session lock", at: body.search(SESSION_LOCK) },
        { name: "the user_credential lock", at: body.search(CREDENTIAL_LOCK) },
        { name: "the user_authenticator lock", at: body.search(AUTHENTICATOR_LOCK) },
        { name: "the shop store-claim lock", at: body.search(SHOP_CLAIM_LOCK) },
        { name: "the scan_session anchor lock", at: body.search(ANCHOR_LOCK) },
      ].filter((p) => p.at !== -1);

      const violations: Array<[first: string, second: string]> = [];
      for (let a = 0; a < positions.length; a += 1) {
        for (let b = a + 1; b < positions.length; b += 1) {
          // `positions` is in the DECLARED order, so an earlier entry appearing
          // later in the body is the violation — whichever pair it is.
          if (positions[a]!.at > positions[b]!.at) {
            violations.push([positions[b]!.name, positions[a]!.name]);
          }
        }
      }
      for (const [first, second] of violations) {
        findings.push({
          rule: "fixed-lock-order",
          message:
            `${file.path}: mutating handler #${i + 1} takes ${first} BEFORE ` +
            `${second} (042 §5.3(b) I22, extended to three positions by 048 K1, to four by ` +
            `E03-D06, to five by E03-D11 and to six by E03-D22). The fixed order is ` +
            `request_idempotency INSERT, then the app_session row FOR NO KEY UPDATE, then the ` +
            `user_credential row FOR UPDATE, then the user_authenticator row FOR UPDATE, then ` +
            `the shop store-claim UPDATE, then the scan_session anchor FOR UPDATE, in every ` +
            `handler, always — the idempotency row is the request's IDENTITY, the session says ` +
            `who is asking, the first factor and then the second say they are still who they ` +
            `claim, then the TENANT row the act configures, and only then is the domain subject ` +
            `touched. The two credential positions are taken TOGETHER by the privileged sign-in, ` +
            `because their per-person lockout budget is shared (048 §4.3, 057 §4.5), so their ` +
            `order is load-bearing rather than notional; the store claim is coarse-before-fine ` +
            `over the anchor it contains (000-docs/061 §5). Two handlers with opposite orders ` +
            `deadlock (40P01) intermittently, at a counter, reproducing on nobody's laptop.`,
        });
      }
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Rule 5 — 040 §8.2 step 1, staged: who still writes `scan_session.status`.
// ---------------------------------------------------------------------------

/**
 * 040 §8.2 step 1 makes this bead responsible for "a non-graph lint assertion that
 * no file under `src/` contains `UPDATE scan_session`" — as the PRECONDITION of the
 * contract step that drops the column. The contract step itself is deliberately not
 * taken here (see `migrations/010`'s header): `setSessionStatus` still has two call
 * sites, so dropping the column would break the deploy.
 *
 * The assertion therefore ships as an exact writer inventory, exactly like rule 2.
 * When E02-D08 removes the last writer this returns a finding until the number is
 * lowered to zero — and THAT is the green light for the contract migration, rather
 * than someone's memory that the writers are gone.
 */
export const SCAN_SESSION_STATUS_WRITERS: readonly { path: string; count: number }[] = [
  { path: "src/services/scanSession.ts", count: 1 },
];

const STATUS_UPDATE = /UPDATE\s+scan_session\b/gi;

export function checkScanSessionStatusWriters(files: readonly SourceFile[]): Finding[] {
  const findings: Finding[] = [];
  const declared = new Map(SCAN_SESSION_STATUS_WRITERS.map((r) => [r.path, r.count]));
  for (const file of files) {
    if (!file.path.startsWith("src/")) continue;
    const n = (file.text.match(STATUS_UPDATE) ?? []).length;
    const want = declared.get(file.path) ?? 0;
    if (n !== want) {
      findings.push({
        rule: "scan-session-status-writers",
        message:
          `${file.path}: declared ${want} \`UPDATE scan_session\` writer(s), found ${n} ` +
          `(040 §8.2 step 1). ` +
          (n > want
            ? `The column is DEPRECATED — state is derived from the log (040 §3.1). Write a record, ` +
              `not a status.`
            : `A writer was removed. Lower the count; when every count reaches zero, 040 §8.2's ` +
              `contract migration (drop the column, add scan_session to the trigger loop) is ` +
              `unblocked and E02-B10's contract step can be written.`),
      });
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Rule 6 — 041 §3.3: `supersedes_id` has exactly one writer.
// ---------------------------------------------------------------------------

/**
 * The one module allowed to name `supersedes_id` in an INSERT (041 §3.3: "One
 * helper writes `supersedes_id`, for every table, and no route or service writes
 * it directly").
 *
 * Same shape as rule 3 and for a stronger reason. `cost_log`'s second writer is a
 * second definition of what a call costs; a second `supersedes_id` writer is a
 * second definition of what a CORRECTION is — and 041 §3.3's three properties
 * (the refusal translated into a product answer, the outcome baseline being the
 * superseded row, one idempotent path) are properties of a single writer, not of
 * the column. None of them survives a second one, and none of them is visible in
 * the import graph, which is why this is a text rule.
 */
export const SUPERSEDES_WRITER = "src/services/supersession.ts";

/**
 * `supersedes_id` named within an INSERT's column list.
 *
 * Deliberately NOT a bare `/supersedes_id/`: the column is discussed in comments
 * across `src/` and in this file, and a rule that fires on prose teaches authors
 * to stop writing prose. The window is the INSERT statement, which is the only
 * place naming the column is a WRITE.
 *
 * TWO WIDENINGS, both from the invariant review of this rule's first version, and
 * both closing a way a real writer could slip past a rule that LOOKED strict:
 *   - **The window is 1200 characters, not 400.** A column list broken over several
 *     lines with a comment between them — the house style everywhere in this repo —
 *     easily exceeds 400, and `supersedes_id` conventionally sits LAST. A writer
 *     that documented itself would have been invisible to a 400-character window,
 *     which is the worst possible failure mode: the rule stays green and the
 *     property stops holding.
 *   - **The table name may be quoted.** `INSERT INTO "human_confirmation"` is the
 *     same write, and `\w+` alone does not match it.
 * The cost of both is a wider net over comments that happen to follow an INSERT,
 * and the negative fixtures below pin that the rule still does not fire on prose.
 */
const SUPERSEDES_INSERT = /INSERT\s+INTO\s+"?\w+"?[\s\S]{0,1200}?supersedes_id/gi;

/**
 * Every file under `src/` that writes `supersedes_id`, sorted.
 *
 * Exported so the gate-test can assert the REAL tree against it without restating
 * the pattern beside it — a second copy of a regex is a second rule that drifts,
 * which is the same defect `src/db/appendOnlyTables.ts` exists to prevent for the
 * trigger set.
 */
export function findSupersedesWriters(files: readonly SourceFile[]): string[] {
  return files
    .filter((f) => f.path.startsWith("src/") && (f.text.match(SUPERSEDES_INSERT) ?? []).length > 0)
    .map((f) => f.path)
    .sort();
}

export function checkSupersedesWriters(files: readonly SourceFile[]): Finding[] {
  const writers = findSupersedesWriters(files);

  if (writers.length === 1 && writers[0] === SUPERSEDES_WRITER) return [];
  return [
    {
      rule: "supersedes-id-has-one-writer",
      message:
        `supersedes_id is written from [${writers.join(", ") || "nothing"}]; the only writer may be ` +
        `${SUPERSEDES_WRITER} (041 §3.3). A correction is not an INSERT with an extra column: it is ` +
        `a read of the predecessor, a scope check, a \`session_seq\` assignment under the anchor ` +
        `lock and an insert, in that order, with one place that turns a refusal into an answer a ` +
        `person can act on (022 P6). A second writer is a second, unreviewed definition of all four.`,
    },
  ];
}

// ---------------------------------------------------------------------------
// Rule 7 — 047 A8: `identityKey` and `edition_signature` stay two functions.
// ---------------------------------------------------------------------------

/**
 * The two files A8 keeps apart, and it is worth restating WHY a lint rule guards
 * two functions that both compile fine today.
 *
 * `identityKey` (workflow) answers "did this operator ACCEPT or CORRECT what was
 * on the screen" for 019 T3 and T20, over two payloads within one session. It
 * uses `title + issue + variant` and DELIBERATELY EXCLUDES publisher and year,
 * with the reason written at `confirmationOutcome.ts:44-49`: including them
 * "would score a plain acceptance as a correction and inflate T3". `019:57` makes
 * that exclusion non-editable without a `000-docs/006` row.
 *
 * `edition_signature` (catalog) answers "which edition is this, in the whole
 * corpus" for dedupe and the Q2/Q3 lookup. It uses `series + issue + variant +
 * printing` (030 §3.3) and is versioned by `normalization_version` beside the
 * pack version.
 *
 * They look alike. 047 §9.3: "Two functions with two names drift into one the
 * first time a builder notices they look alike, and the drift is silent because
 * both still compile." The drift has two shapes and this rule closes both:
 *
 *   MECHANICAL — one exported field-list constant imported by both, so a change
 *   to the catalog's fields silently changes what T3 counts. Closed by
 *   `checkIdentityFunctionSeparation`.
 *
 *   HUMAN — a PR that edits both functions in one diff. That is, by construction,
 *   a change to a 019 measurement rule, and it is only legitimate with a 006 row.
 *   Closed by `checkIdentityPairEdit`, which the gate runs over the PR's changed
 *   files.
 */
export const IDENTITY_KEY_FILE = "src/services/confirmationOutcome.ts";
export const EDITION_SIGNATURE_FILE = "src/catalog/editionSignature.ts";

/**
 * THE CATALOG SIDE IS A SET, NOT ONE FILE, and E04-B02's invariant review is why.
 *
 * A8 names `edition_signature` as a FUNCTION, and the first version of this rule
 * read that as one file. But the comic field list does not live in one file: the
 * signature function's own four-field literal is in `editionSignature.ts`, and
 * `comicIdentity.ts` holds `comicSignatureInput` (which composes those same four
 * fields across the definition and the edition) and `comicSignatureClaim` (which
 * maps a flat payload onto them). Either of those is a field list, and a diff
 * that edited `comicSignatureClaim` beside `identityKey` would have been the
 * paired edit A8 forbids — passing a rule that only watched the other file.
 *
 * So both are subjects: neither may share an import with `identityKey`, and a PR
 * touching `identityKey` and ANY of them needs the 006 row.
 */
export const CATALOG_IDENTITY_FILES: readonly string[] = [
  EDITION_SIGNATURE_FILE,
  "src/catalog/comicIdentity.ts",
  // E04-B03. A second pack's field list is a field list: `cardSignatureClaim`
  // maps a flat payload onto `set|number|variant|parallel|language`, and a diff
  // that edited it beside `identityKey` is the paired edit A8 forbids just as
  // much as one that edited the comic mapper. A subject set that grew a member
  // and did not grow this row would have passed while watching the wrong file.
  "src/catalog/cardIdentity.ts",
  // E04-B04. A manifest is a field list too — `identitySchema.definition` and
  // `.edition` name every field and flag which of them sit in which key — and it
  // is the field list a FUTURE pack author writes, which makes it the likeliest
  // place for the merge A8 forbids to reappear. A diff editing a manifest's field
  // declarations beside `identityKey` is the paired edit, whatever the shape of
  // the list.
  "src/catalog/comicManifest.ts",
  "src/catalog/cardManifests.ts",
];

/** `from "…"` / `require("…")`, capturing the specifier. */
const IMPORT_SPECIFIER = /(?:from\s+|require\s*\(\s*)["']([^"']+)["']/g;

function importSpecifiers(text: string): string[] {
  return [...text.matchAll(IMPORT_SPECIFIER)].map((m) => m[1]!);
}

/** `import … from "./x.js"` resolved against the importing file's directory. */
function resolveSpecifier(fromPath: string, specifier: string): string {
  if (!specifier.startsWith(".")) return specifier;
  const dir = fromPath.split("/").slice(0, -1);
  const parts = specifier.split("/");
  for (const part of parts) {
    if (part === "." || part === "") continue;
    else if (part === "..") dir.pop();
    else dir.push(part);
  }
  return dir.join("/").replace(/\.js$/, ".ts");
}

/**
 * A8's first half. Three assertions, and each one closes a different way the
 * mechanical merge could be performed:
 *
 *  1. **Neither file imports the other.** The direct merge — `identityKey`
 *     calling the signature function, or vice versa.
 *  2. **They share no imported module.** The indirect merge, and the one A8
 *     actually names: "one exported `FIELDS` array imported by both". A shared
 *     field list REQUIRES a shared import, so forbidding the shared import
 *     forbids the shared constant without having to guess what someone would
 *     name it.
 *  3. **Neither exports a field-list-shaped constant.** Belt and braces for the
 *     case where the array is exported from one of the two and imported by a
 *     third file that then feeds both.
 *
 * The rule is deliberately not "the field lists differ": two lists that happen to
 * be equal today are still two decisions, and a rule that compared them would
 * fire on a coincidence and stay silent on the merge.
 */
export function checkIdentityFunctionSeparation(files: readonly SourceFile[]): Finding[] {
  const findings: Finding[] = [];
  const byPath = new Map(files.map((f) => [f.path, f]));
  const identity = byPath.get(IDENTITY_KEY_FILE);
  const missing = [IDENTITY_KEY_FILE, ...CATALOG_IDENTITY_FILES].filter((p) => !byPath.has(p));

  if (missing.length > 0) {
    // A rule that silently passes when its subject is renamed is a rule that has
    // stopped working. 047 §9.3 is about these functions; if a file moved, the
    // rule must be moved with it deliberately.
    return [
      {
        rule: "identity-key-and-edition-signature-stay-apart",
        message:
          `expected every A8 subject file to exist (047 §9.3); missing [${missing.join(", ")}]. ` +
          `If a file was renamed, update IDENTITY_KEY_FILE / CATALOG_IDENTITY_FILES in the same PR ` +
          `— and note that a rename touching both sides is itself the paired edit rule 7's second ` +
          `half governs.`,
      },
    ];
  }

  const identityImports = importSpecifiers(identity!.text).map((sp) => resolveSpecifier(identity!.path, sp));

  for (const catalogPath of CATALOG_IDENTITY_FILES) {
    const catalog = byPath.get(catalogPath)!;
    const catalogImports = importSpecifiers(catalog.text).map((sp) => resolveSpecifier(catalog.path, sp));

    if (identityImports.includes(catalogPath) || catalogImports.includes(IDENTITY_KEY_FILE)) {
      findings.push({
        rule: "identity-key-and-edition-signature-stay-apart",
        message:
          `${IDENTITY_KEY_FILE} and ${catalogPath} import each other (047 §9.3, A8). They answer ` +
          `different questions — "did this operator accept or correct" versus "which edition is ` +
          `this in the whole corpus" — and an import edge is the first step of the merge that would ` +
          `move a 019 T1/T3 measurement rule. Reuse the NORMALISATION by copying the rule, not the ` +
          `field list; §9.3 says in terms that the normalisation "should be reused" and the field ` +
          `list must not be.`,
      });
    }

    // The indirect merge, and the one A8 actually names: "one exported FIELDS
    // array imported by both". A shared field list REQUIRES a shared import, so
    // forbidding the shared import forbids the shared constant without having to
    // guess what someone would name it. Imports INSIDE the catalog subject set do
    // not count — `comicIdentity.ts` imports `editionSignature.ts` on purpose,
    // and that edge is the pack reusing its own normalisation.
    const shared = identityImports
      .filter((sp) => catalogImports.includes(sp))
      .filter((sp) => !CATALOG_IDENTITY_FILES.includes(sp))
      .sort();
    if (shared.length > 0) {
      findings.push({
        rule: "identity-key-and-edition-signature-stay-apart",
        message:
          `${IDENTITY_KEY_FILE} and ${catalogPath} both import [${shared.join(", ")}] (047 §9.3, A8). ` +
          `A shared field-list constant requires a shared import, so the shared import is what the ` +
          `guard forbids: one exported FIELDS array with two importers is exactly the mechanical ` +
          `merge A8 exists to make unavailable. If the shared module is genuinely field-list-free, ` +
          `the honest fix is still to inline what each side needs — these functions are versioned ` +
          `differently (one by 019, one by the pack) and cannot share a dependency that either ` +
          `version could move.`,
      });
    }
  }

  // ⚠ `FIELDS` / `FIELD_LIST` ONLY, and NOT `KEYS`. The first version of this
  // pattern included `KEYS` and immediately fired on `COPY_FACT_KEYS` in
  // `comicIdentity.ts` — which is a DENYLIST of attribute names an edition may
  // never carry (047 A6), the opposite of an identity field list and something
  // that must stay exported so the write path and its tests can name it. The
  // honest fix is to narrow the pattern rather than exempt the file: an exemption
  // row would have switched the whole file off, and nothing is lost, because a
  // denylist cannot become a shared identity field list without being renamed —
  // and if either side ever imported it, the shared-import check above fires.
  for (const path of [IDENTITY_KEY_FILE, ...CATALOG_IDENTITY_FILES]) {
    const file = byPath.get(path)!;
    if (/export\s+(?:const|let|var)\s+\w*(?:FIELDS|FIELD_LIST)\b/.test(file.text)) {
      findings.push({
        rule: "identity-key-and-edition-signature-stay-apart",
        message:
          `${file.path} exports a field-list-shaped constant (047 §9.3, A8). None of these files may ` +
          `export its field list, because an exported list is one import away from being the SAME ` +
          `list — and the two sides must be able to disagree about their fields forever. Keep the ` +
          `list an inline literal inside the function.`,
      });
    }
  }

  return findings;
}

/**
 * A8's second half: a PR that edits BOTH functions without a `000-docs/006` row
 * FAILS.
 *
 * Pure over a changed-file list so it has a negative fixture like every other
 * rule here; the gate feeds it `git diff --name-only` against the PR's merge
 * base. `006-OD-STAT-status.md` is the decision log, and 047 §9.3 leans on
 * `019:57` — T1's exclusion rule is "non-editable without a 006 row". A diff
 * touching both functions IS an edit to that rule whether or not the author
 * meant it to be, which is the whole reason the check is mechanical.
 *
 * ⚠ IT DOES NOT ASK WHAT THE 006 ROW SAYS. A gate that tried to would be reading
 * prose and guessing; what it can prove is that the author was made to write one,
 * in the same PR, where a reviewer will see it next to the diff. That is the
 * property 019's non-editability rule actually needs.
 */
export const DECISION_LOG_FILE = "000-docs/006-OD-STAT-status.md";

export function checkIdentityPairEdit(changedFiles: readonly string[]): Finding[] {
  const changed = new Set(changedFiles.map((f) => f.trim()).filter((f) => f.length > 0));
  if (!changed.has(IDENTITY_KEY_FILE)) return [];
  const catalogTouched = CATALOG_IDENTITY_FILES.filter((p) => changed.has(p));
  if (catalogTouched.length === 0) return [];
  if (changed.has(DECISION_LOG_FILE)) return [];
  return [
    {
      rule: "identity-pair-edit-needs-a-006-row",
      message:
        `this change edits ${IDENTITY_KEY_FILE} AND [${catalogTouched.join(", ")}] and adds no row to ` +
        `${DECISION_LOG_FILE} (047 §9.3, A8). Editing both sides in one diff is, by construction, a ` +
        `change to a 019 measurement rule: \`identityKey\` decides T3's confirm-versus-correct and ` +
        `\`019:57\` makes T1's field exclusion non-editable without a 006 row. If the change really ` +
        `is a measurement decision, file the row and say what moved and why. If it is not, split the ` +
        `PR — the two sides are owned by different layers and versioned by different things, so a ` +
        `change that needs to touch both is rarer than it looks.`,
    },
  ];
}

// ---------------------------------------------------------------------------
// Rule 8 — 014 §3.4 / 030 §6 rule 1: no core code branches on a vertical.
// ---------------------------------------------------------------------------

/**
 * "Plug-and-play requires a **vertical pack**, not scattered `if comic`
 * statements" (014 §3.4), restated as a prohibition because 030 §6 has to test
 * it: "**No `if (vertical === 'comic')` in core code.** Vertical-conditional
 * behaviour lives in a pack. `platform`, `catalog`, `workflow`, `condition`,
 * `valuation`, `commerce` and `reporting` may read `vertical` **only** to select
 * a pack."
 *
 * ⚠ WHY A TEXT RULE AND NOT A DEPENDENCY-CRUISER RULE. A branch on a string
 * literal has no import edge — it is the same blind spot `checkRouteDbAccess`
 * exists for. And it is not hypothetical: E04-B03 found `!fields.series &&
 * !fields.issue` in `src/services/identityResolution.ts`, a comic branch wearing
 * FIELD NAMES instead of a vertical literal, which would have skipped every card
 * lookup as an unusable claim while type-checking cleanly. The field-name shape
 * is beyond a regex's reach; the literal shape is not, and this rule closes the
 * half that can be closed mechanically.
 *
 * WHAT COUNTS AS A BRANCH, deliberately narrowly: an equality comparison against
 * a registered vertical literal, or a `case` label of one. What does NOT count is
 * a MAP KEY (`{ "comic": … }`), a registry lookup, an object property, a default
 * constant or any mention in a comment or a string message — every one of those
 * is a pack being SELECTED, which §6 rule 1 expressly permits. A rule that fired
 * on all of them would fire on `packRegistry.ts` doing exactly the right thing.
 */
export const VERTICAL_LITERALS: readonly string[] = ["comic", "sports-card", "tcg-card"];

/** The two pack modules, which own their own vertical by definition. */
export const VERTICAL_PACK_FILES: readonly string[] = [
  "src/catalog/comicIdentity.ts",
  "src/catalog/cardIdentity.ts",
];

const VERTICAL_BRANCH = (literal: string): RegExp =>
  new RegExp(
    // `x === "comic"` / `x !== 'comic'` / `"comic" === x`, and `case "comic":`
    `(?:[!=]==?\\s*["']${literal}["'])|(?:["']${literal}["']\\s*[!=]==?)|(?:\\bcase\\s+["']${literal}["'])`,
    "g"
  );

export function checkNoVerticalBranching(files: readonly SourceFile[]): Finding[] {
  const findings: Finding[] = [];

  for (const file of files) {
    if (!file.path.startsWith("src/")) continue;
    if (VERTICAL_PACK_FILES.includes(file.path)) continue;

    // Comment lines are prose about the rule, not the rule being broken — this
    // very file's neighbours quote `if (vertical === 'comic')` to explain why it
    // is forbidden, and a rule that could not tell the two apart would make the
    // explanation unwritable.
    const code = file.text
      .split("\n")
      .filter((line) => {
        const t = line.trimStart();
        return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
      })
      .join("\n");

    for (const literal of VERTICAL_LITERALS) {
      if (VERTICAL_BRANCH(literal).test(code)) {
        findings.push({
          rule: "no-vertical-branching-in-core",
          message:
            `${file.path} branches on the vertical literal ${JSON.stringify(literal)} ` +
            `(014 §3.4, 030 §6 rule 1). Core code may read \`vertical\` ONLY to select a pack — a ` +
            `map lookup, never a comparison. Whatever this branch does differently for one ` +
            `vertical is a PACK function: add a slot to \`VerticalPack\` in ` +
            `src/catalog/packRegistry.ts and let every pack answer it, which is also the only ` +
            `shape that makes the third vertical free. If the file genuinely owns a vertical, it ` +
            `is a pack module and belongs in VERTICAL_PACK_FILES — deliberately, in the same PR.`,
        });
      }
    }
  }

  return findings;
}

/**
 * Every `.ts` file under `dir`, repo-relative with forward slashes.
 *
 * It lives beside the rules rather than in the CLI so a test can call the rules on
 * the REAL tree without importing a module that runs `process.exit` on load.
 */
export function collectSources(dir: string, extensions: readonly string[] = [".ts"]): SourceFile[] {
  const out: SourceFile[] = [];
  const walk = (abs: string): void => {
    for (const entry of readdirSync(abs)) {
      const child = join(abs, entry);
      if (statSync(child).isDirectory()) walk(child);
      // E03-D11: the extension list is a PARAMETER because one rule reads SQL —
      // a `mfa_verified_at` column would arrive in a migration before it ever
      // reached a type, so a walker that only saw TypeScript would police the
      // half of the tree the mistake does not start in.
      else if (extensions.some((ext) => child.endsWith(ext))) {
        out.push({
          path: relative(REPO_ROOT, child).split(sep).join("/"),
          text: readFileSync(child, "utf8"),
        });
      }
    }
  };
  walk(dir);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** Every non-graph rule, in one call. */
// ---------------------------------------------------------------------------
// Rule 9 — E03-B04: every transaction under `src/` NAMES its tenant, and the
// GUC is written in exactly one file.
// ---------------------------------------------------------------------------

/**
 * WHY A LINT AND NOT A TYPE. `TransactionOptions.tenant` is optional, because the
 * migrate-role callers — the CLIs, the fixture generator, the migration runner —
 * own the schema and bypass the policies by ownership, and making the field
 * required would force them to invent a tenant they do not have. Inside `src/`
 * there is no such caller: every transaction on the request path, the worker path
 * or the authentication path is about one shop or is one of the declared
 * cross-tenant scopes, and a transaction that names neither reads and writes
 * nothing (`migrations/029`). That failure is SILENT — an empty result, never an
 * error — which is exactly the shape `checkLockOrder`'s history says a rule has to
 * exist for.
 *
 * The check is textual and deliberately narrow: a `withTransaction(`/
 * `withTransactionResult(` call under `src/` must have a `tenant:` within the 600
 * characters that follow it. That window is long enough for the callback bodies in
 * this repository and short enough that it cannot be satisfied by the NEXT call's
 * option object — and a false negative here costs a missed detection, never a
 * false alarm, which is the direction 000-docs/044 §2 argues for.
 */
/**
 * Comments are stripped before either of the two rules below reads a file.
 *
 * Both ask "which files DO this", and both are documented in prose in the files
 * that do it — `src/db.ts` explains the `SET LOCAL` it delegates, and
 * `src/db/rowLevelSecurity.ts` names the scopes in the reason it gives for a row.
 * A rule that counted those would be counting explanations, which is the fastest
 * way to teach an author to stop writing them. Line comments and block comments
 * only: a `--` inside a SQL template literal is SQL and stays.
 */
export function stripJsComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const TRANSACTION_CALL = /\bwithTransaction(?:Result)?\s*\(/g;
const TENANT_OPTION = /tenant\s*:/;

/**
 * The text of one call, from its opening paren to the paren that closes it.
 *
 * Paren-balanced rather than a fixed window, and the difference is not pedantry:
 * the callbacks in this repository run to hundreds of lines with option objects
 * at the end, so a window wide enough to cover them would also cover the NEXT
 * call's options and report green on a call that declared nothing. Quotes and
 * template literals are skipped so a paren inside a SQL string cannot unbalance
 * the count.
 */
export function callText(text: string, openParen: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let i = openParen; i < text.length; i += 1) {
    const ch = text[i]!;
    const prev = i > 0 ? text[i - 1] : "";
    if (quote !== null) {
      if (ch === quote && prev !== "\\") quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) return text.slice(openParen, i + 1);
    }
  }
  return text.slice(openParen);
}

export function checkTransactionsDeclareTenant(files: readonly SourceFile[]): Finding[] {
  const findings: Finding[] = [];
  for (const file of files) {
    if (!file.path.startsWith("src/")) continue;
    // `src/db.ts` DEFINES the helper and calls it from `scopedDb`, where the
    // context is the parameter; it is the one file the rule cannot ask about.
    if (file.path === "src/db.ts") continue;
    const text = stripJsComments(file.text);
    for (const match of text.matchAll(TRANSACTION_CALL)) {
      const open = (match.index ?? 0) + match[0].length - 1;
      if (TENANT_OPTION.test(callText(text, open))) continue;
      const line = text.slice(0, match.index ?? 0).split("\n").length;
      findings.push({
        rule: "transaction-declares-its-tenant",
        message:
          `${file.path}:${String(line)} opens a transaction without a \`tenant\` (E03-B04, 034 §3.2). ` +
          `Every transaction under src/ is about ONE shop — \`{ tenant: { shopId } }\`, taken from ` +
          `the session (048 §6.1) — or is one of the declared cross-tenant scopes in ` +
          `src/db/tenantContext.ts. A transaction that names neither sees no rows and writes none, ` +
          `and it fails as an empty result rather than as an error.`,
      });
    }
  }
  return findings;
}

/**
 * The tenant GUC is written in ONE file, and read only by the policies.
 *
 * `src/db/tenantContext.ts` builds the `BEGIN` + `set_config` statement and
 * validates the uuid it interpolates; a second site would be a second place that
 * shape check could be forgotten, and interpolation is the whole of that defence.
 * The rule is also what stops a well-meaning caller from "just setting it" outside
 * a transaction — the sticky-connection hazard 034 §3.2 names and 046 K-5
 * reproduces.
 */
export const TENANT_GUC_WRITER = "src/db/tenantContext.ts";

// `set_config(` with no argument pattern, deliberately: `tenantContext.ts` builds
// the setting NAME from a constant, so a rule keyed on the literal `'longbox.` saw
// nothing at all and reported the writer as "nothing" — a rule that passes for the
// wrong reason. Nothing else in this repository calls `set_config`.
const SET_CONFIG = /set_config\s*\(/gi;
const SET_LOCAL = /SET\s+LOCAL\s+longbox\./gi;

export function checkTenantGucWriters(files: readonly SourceFile[]): Finding[] {
  const writers = files
    .filter((f) => f.path.startsWith("src/"))
    .filter((f) => {
      const text = stripJsComments(f.text);
      return (text.match(SET_CONFIG) ?? []).length > 0 || (text.match(SET_LOCAL) ?? []).length > 0;
    })
    .map((f) => f.path)
    .sort();

  if (writers.length === 1 && writers[0] === TENANT_GUC_WRITER) return [];
  return [
    {
      rule: "tenant-context-has-one-writer",
      message:
        `the tenant GUC is set from [${writers.join(", ") || "nothing"}]; the only writer may be ` +
        `${TENANT_GUC_WRITER} (E03-B04). It validates the uuid it interpolates and travels with ` +
        `\`BEGIN\`, so a second site is both a second place that shape check can be forgotten and ` +
        `a place the context could be set OUTSIDE a transaction — which is sticky connection state ` +
        `and outlives the request (034 §3.2, 046 K-5).`,
    },
  ];
}

/**
 * The cross-tenant scopes are an EXACT INVENTORY, never a ceiling.
 *
 * A service scope is the one hole in the tenant boundary: inside one, a statement
 * sees every shop's rows on the tables that carry the second policy. The union in
 * `src/db/tenantContext.ts` says WHICH scopes exist and why; this says how many
 * places may name each, and the count is exact for the reason 000-docs/044 §6
 * gives for every other inventory here — a NEW occurrence fails the gate, and a
 * REMOVED one also fails it until somebody lowers the number, so the list shrinks
 * deliberately instead of drifting.
 */
export const SERVICE_SCOPE_SITES: readonly { scope: string; count: number }[] = [
  // `resolvePrincipal`'s reads, and `resolvePrivileged`'s (E03-D11). Two
  // resolvers rather than one because the privileged cookie is read by a route
  // that must NOT consult the other two (048 §4.1), and both face the same
  // question a cookie cannot answer: the row a digest finds IS the tenant.
  { scope: "session-resolution", count: 2 },
  // The poller's shop enumeration — the ONE read a per-shop drain cannot scope,
  // because `shop` is policied on its own `id` (the invariant review's WARN 3).
  { scope: "outbox-sweep", count: 1 },
  // The credential lookup and the failure row it may append.
  { scope: "device-session-open", count: 2 },
  // `verifyInvitation` and `verifyEnrollmentCode` — both presented with no session.
  { scope: "code-redemption", count: 2 },
  // `myShops`, the one read whose correct answer spans tenants.
  { scope: "my-shops", count: 1 },
  // The three MFA CLIs, E03-D11's re-encryption CLI, and TWO route-side sites in
  // `api.ts`: the privileged sign-in, and the FRESH-factor check that inviting an
  // owner re-presents (057 §4.4b). Both are person-scoped reads that no tenant
  // context can ask — `user_authenticator` carries no `shop_id` — and the second
  // exists because the one privileged act whose damage the session's expiry does
  // NOT bound is naming another owner.
  { scope: "second-factor", count: 6 },
  // The OAuth callback's state lookup, its cross-tenant domain-claim check (F8),
  // the webhook's domain lookup, and the webhook's own transaction (whose receipt
  // may carry a NULL shop_id).
  { scope: "connector-inbound", count: 4 },
];

/**
 * The files that DECLARE rather than USE: the scope union itself, the table-to-scope
 * map that names each scope in its reasons, the transaction helper that TAKES a
 * scope as a parameter, and this rule's own file.
 */
const SCOPE_DECLARATION_FILES = [
  TENANT_GUC_WRITER,
  "src/db/rowLevelSecurity.ts",
  "src/db.ts",
  "scripts/architectureRules.ts",
];

/**
 * Every way of ENTERING a scope, counted independently of the scope names.
 *
 * ⚠ **THE SECURITY LENS'S F7, AND IT IS THE HOLE A LITERAL COUNT ALWAYS HAS.** The
 * per-scope counts below match string literals, so a scope reached through a
 * variable — `serviceDb(pool, scopeFromSomewhere)` — contributes ZERO to every one
 * of them and the inventory reports green while a seventh call site exists. So the
 * two counts are taken separately and required to agree: the number of ways INTO a
 * scope must equal the number of times a scope is NAMED. A variable-driven call
 * makes the first exceed the second, and the rule says so.
 */
const SCOPE_ENTRY = /\bserviceDb\s*\(|\bservice\s*:/g;

export function checkServiceScopeSites(files: readonly SourceFile[]): Finding[] {
  const findings: Finding[] = [];
  const searchable = files
    .filter((f) => f.path.startsWith("src/") || f.path.startsWith("scripts/"))
    .filter((f) => !SCOPE_DECLARATION_FILES.includes(f.path))
    .map((f) => ({ path: f.path, text: stripJsComments(f.text) }));

  let declaredTotal = 0;
  for (const { scope, count } of SERVICE_SCOPE_SITES) {
    declaredTotal += count;
    const pattern = new RegExp(`["'\`]${scope}["'\`]`, "g");
    const seen = searchable.flatMap((f) => (f.text.match(pattern) ?? []).map(() => f.path));
    if (seen.length === count) continue;
    findings.push({
      rule: "service-scope-inventory",
      message:
        `the cross-tenant scope "${scope}" is named at ${String(seen.length)} site(s) ` +
        `[${[...new Set(seen)].join(", ") || "nothing"}]; the declared count is ${String(count)} ` +
        `(E03-B04). A service scope is the one place a statement sees every shop's rows, so the ` +
        `number is exact rather than a ceiling: a new site is a widening of the tenant boundary ` +
        `and belongs in 000-docs/056 with its reason, and a removed one lowers the number here.`,
    });
  }

  const entries = searchable.flatMap((f) => (f.text.match(SCOPE_ENTRY) ?? []).map(() => f.path));
  if (entries.length !== declaredTotal) {
    findings.push({
      rule: "service-scope-entry-count",
      message:
        `${String(entries.length)} call site(s) ENTER a cross-tenant scope ` +
        `[${[...new Set(entries)].join(", ") || "nothing"}] while the per-scope literal counts add up ` +
        `to ${String(declaredTotal)} (E03-B04, security lens F7). The two disagree when a scope is ` +
        `passed as a VARIABLE — which every literal count in this file is blind to — so the entry ` +
        `count is taken separately and required to match. A scope reached through a variable is a ` +
        `cross-tenant read nobody can grep for.`,
    });
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Rule 12 — 057 §4.3 (session-convened cannon brief, consistency question
// K3; the dispatched lens raised no finding of that number, so the label is a
// pointer to the brief and NOT an attribution): the freshness window has NO
// column, and the absence is enforced rather than remembered.
// ---------------------------------------------------------------------------

/**
 * **`mfa_verified_at` exists nowhere — not in a migration, not in a projection,
 * not in a type.**
 *
 * 048 §4.1 requires a privileged action to sit in a session established by
 * password and a second factor *"within a freshness window"*, and 057 §4.3 rules
 * that the window IS the privileged chain's absolute expiry: it is carried
 * unchanged across every rotation, so it already measures the elapsed time since
 * both factors were presented. A column beside it would be **a second thing that
 * can disagree with the first**, which is the shape 040 A8 retired from
 * `scan_session`, 042 I5 generalised and 047 §5.1 refused to reintroduce.
 *
 * ⚠ **THE REASON IT IS A LINT AND NOT A REVIEW NOTE.** The absence is the whole
 * decision, and an absence is the one thing a test cannot assert by exercising
 * the system: every behavioural test passes just as well with a redundant column
 * present and quietly drifting. The obvious change six months from now is *"add
 * `mfa_verified_at` so the freshness check is explicit"* — which reads like an
 * improvement, ships green, and reintroduces the class of bug three ratified
 * records spent sections removing. This makes that edit a build failure with the
 * argument attached.
 *
 * Comments are stripped first, in both dialects, because 048, 057, `policy.ts`,
 * `sessions.ts` and `migrations/031` all NAME the column in prose to explain why
 * it does not exist — and a rule that punished saying so would push the reasoning
 * out of the tree, which is the opposite of what it is for.
 */
export const FORBIDDEN_FRESHNESS_COLUMN = "mfa_verified_at";

/**
 * The rule's own file DECLARES the string and cannot therefore be judged by it —
 * the same carve-out `SCOPE_DECLARATION_FILES` makes one rule up, and for the
 * same reason: a checker that failed on its own subject would be unwritable.
 */
const FRESHNESS_DECLARATION_FILES = ["scripts/architectureRules.ts"];

export function checkNoFreshnessColumn(files: readonly SourceFile[]): Finding[] {
  const findings: Finding[] = [];
  for (const file of files) {
    if (FRESHNESS_DECLARATION_FILES.includes(file.path)) continue;
    const body = file.path.endsWith(".sql")
      ? file.text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, "")
      : stripJsComments(file.text);
    if (!body.includes(FORBIDDEN_FRESHNESS_COLUMN)) continue;
    findings.push({
      rule: "no-mfa-verified-at-column",
      message:
        `${file.path} names \`${FORBIDDEN_FRESHNESS_COLUMN}\` outside a comment (057 §4.3). ` +
        `048 §4.1's freshness window is the privileged chain's ABSOLUTE EXPIRY, which is carried ` +
        `unchanged across every rotation and therefore already measures the time since both ` +
        `factors were presented. A column beside it is a SECOND thing that can disagree with the ` +
        `first — the shape 040 A8 retired from scan_session, 042 I5 generalised and 047 §5.1 ` +
        `refused to reintroduce. If the expiry has stopped being carried across rotation, fix ` +
        `THAT; if this is a deliberate reversal, it needs a 000-docs/006 row and an amendment to ` +
        `057 §4.3, not a column.`,
    });
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Rule 13 — 041 §10 / 044 §7 (the consistency lens's K6): one number, one file.
// ---------------------------------------------------------------------------

/**
 * **Two migration files may not share a numeric prefix.**
 *
 * The predicate lives in `migrationDiscipline.ts` beside the other migration
 * rules; this is the gate's adapter for it, so `pnpm arch` reports it in the same
 * place as everything else a reviewer already looks. See that function for why a
 * collision is the ORDINARY outcome of two branches in flight rather than an
 * accident, and why nothing downstream would notice: the runner's ledger keys on
 * the FILENAME, so both files apply and the divergence shows up later as two
 * databases with the same ledger count and different schemas.
 */
export function checkMigrationNumbers(filenames: readonly string[]): Finding[] {
  return findDuplicateMigrationNumbers(filenames).map(({ prefix, files }) => ({
    rule: "one-migration-per-number",
    message:
      `migrations/ has ${String(files.length)} files numbered ${prefix} — ${files.join(", ")} ` +
      `(041 §10, 044 §7). A file number is CLAIMED when the file is written and never reserved in ` +
      `prose, so two branches in flight will each take the next free integer and collide; nothing ` +
      `downstream says so, because the runner's ledger keys on the FILENAME and both files apply ` +
      `in directory order. Renumber the later one — it has not been applied anywhere yet, which is ` +
      `the only moment renaming a migration is free (041 §10's own rule).`,
  }));
}

// ---------------------------------------------------------------------------
// Rule 14 — 019 T35(b) / 034 §3.3 (E03-D17): `src/identity/` is the ONLY place
// that turns a key into a person, and the ONLY writer of `identity_access`.
// ---------------------------------------------------------------------------

/** The audited accessor. Every path below is relative to the repo root. */
export const IDENTITY_ACCESSOR_DIR = "src/identity/";

/** The one file that may INSERT the access fact. */
export const IDENTITY_ACCESS_WRITER = "src/identity/access.ts";

const IDENTITY_ACCESS_INSERT = /INSERT\s+INTO\s+identity_access\b/gi;

/**
 * A SQL string literal, as this rule is willing to recognise one.
 *
 * Backtick-delimited (this repository writes every statement as a template
 * literal) and containing a SQL verb as a WORD. Prose in a comment is stripped
 * before this runs, so what is left is code — but a `.ts` file also holds plain
 * strings, and requiring a verb keeps the rule from having an opinion about
 * `` `a display_name is a person's own` `` in a thrown message.
 */
const SQL_LITERAL = /`([^`]*)`/g;
const SQL_VERB = /\b(SELECT|INSERT|UPDATE|DELETE)\b/i;

/**
 * The columns a projection may not name outside the accessor.
 *
 * 034 §3.3 names three — `operator_id`, `created_by`, `confirmed_by` — and A5
 * puts the two legacy strings INSIDE the contract rather than outside it: T35
 * keys on operator identifiers of any shape, and an unverified one is
 * per-operator data that is also unreliable. `display_name` is the fourth and is
 * the one this bead's accessors actually carry: it is what turns any of the
 * others into a SURFACE, because a surface needs a name.
 */
export const PERSON_PROJECTION_COLUMNS: readonly string[] = [
  "display_name",
  "operator_id",
  "created_by",
  "confirmed_by",
  // ⚠ THE THREE THE SECURITY LENS'S F1 ADDED, AND WHY A COLUMN LIST BEATS A
  // TABLE LIST. v1.0.0's rule keyed on the person TABLE plus four column names,
  // and `src/services/auth/recovery.ts` projected a named human's name and a
  // note about how to reach them out of `shop_recovery_nomination` — a DIFFERENT
  // table — with no audit fact, no caller, and a green gate. 060 §1 E3's grep had
  // enumerated reads of `app_user`, so I1's claim was false in the tree it
  // governs.
  //
  // A person's attributes are not the property of one table. `email` is here for
  // the same reason and costs nothing today: the sign-in's lookup names it in a
  // WHERE and not in a projection, and `projectionText` reads SELECT lists and
  // RETURNING tails only — so the one legitimate email read (the otpauth label,
  // inside the accessor) is exempt by living in the module, and the next one
  // anywhere else is a red build.
  "contact_name",
  "contact_note",
  "email",
];

/** `FROM app_user` / `JOIN app_user`, and NOT `app_user_origin` or `app_user_id`. */
const PERSON_TABLE_READ = /\b(FROM|JOIN)\s+app_user(?![_a-z])/i;

/** Every `SELECT … FROM` projection plus every `RETURNING …` tail, concatenated. */
export function projectionText(sql: string): string {
  const parts: string[] = [];
  const select = /\bSELECT\b/gi;
  let m: RegExpExecArray | null;
  while ((m = select.exec(sql)) !== null) {
    const rest = sql.slice(m.index + m[0].length);
    const from = rest.search(/\bFROM\b/i);
    parts.push(from === -1 ? rest : rest.slice(0, from));
  }
  const returning = /\bRETURNING\b/gi;
  while ((m = returning.exec(sql)) !== null) parts.push(sql.slice(m.index + m[0].length));
  return parts.join(" \n ");
}

export interface PersonJoinRow {
  readonly path: string;
  /** How many violating literals this file is allowed. Exact, never a ceiling. */
  readonly count: number;
  readonly kind: ExemptionKind;
  readonly reason: string;
  readonly closingBead?: string;
}

/**
 * **The declared exemptions, which is one row.**
 *
 * A short list is the control rather than a convenience: 022 P3's cheapest
 * satisfaction of 019 T35 is *"never to build a per-operator surface"*, and every
 * row here is a read that came close enough to need an argument.
 */
// ⚠⚠ **THIS FILE IS SCANNED BY ITS OWN RULE. NO BACKTICKED SQL SAMPLE BELOW.**
//
// `checkIdentityPersonJoins` walks every backtick-delimited literal in every file
// it is handed, INCLUDING this one — so a markdown-backticked sample statement in
// a `reason` string makes the rule file violate the rule it defines. Exempting
// the rule file was available and is the wrong fix: a checker that cannot be
// checked is the shape 029 §5 move 8's *"prove the gate can fail"* exists to
// refuse. Quote SQL in these strings with plain text, never with backticks.
export const PERSON_JOIN_ROWS: readonly PersonJoinRow[] = [
  {
    path: "src/services/auth/credentials.ts",
    count: 1,
    kind: "exemption",
    reason:
      // ⚠ NO BACKTICKS IN THIS STRING, AND THAT IS NOT A STYLE CHOICE. The rule
      // below scans backtick-delimited literals in every file it is handed,
      // INCLUDING this one, so markdown backticks around a sample statement here
      // make the rule file violate its own rule. Exempting the rule file would
      // have been the wrong fix: a checker that cannot be checked is the shape
      // 029 §5 move 8's "prove the gate can fail" exists to refuse.
      "The sign-in lookup — SELECT u.id FROM app_user u WHERE u.email = lower($1). It PROJECTS " +
      "u.id alone and resolves a value the CALLER supplied, so it discloses nothing about a " +
      "person the caller did not already name; the rule flags it only because it reads the person " +
      "TABLE, which is the stronger boundary this rule draws on purpose. It is not routed through " +
      "the accessor for a reason that is a control rather than a convenience: it is the FIRST " +
      "statement of an unauthenticated sign-in, so an accessor call here would let anybody with a " +
      "socket append to `identity_access` without holding a session — an audit table a stranger " +
      "can grow. 000-docs/060 §5.3 argues it; a failed sign-in is already recorded, as an " +
      "`auth_attempt` failure (048 §9.1).",
  },
];

/**
 * A query over `auth_attempt` — 048 R17's substrate/surface rule, written as an
 * inventory rather than as an assertion.
 *
 * 048 I7 requires that *"every query over `auth_attempt` in the tree is either
 * the single-pair lockout derivation or an audited break-glass query"*, and 048
 * §12.4 row 6 hands the fourth name to this scope. All four readers today are
 * lockout derivations, one per factor. Nothing is moved into the accessor — a
 * lockout count is not a person-resolution, and pretending it is would put a
 * hot-path read behind an audit that has nothing to record.
 */
export interface AuthAttemptReadRow {
  readonly path: string;
  readonly count: number;
  readonly reason: string;
}

export const AUTH_ATTEMPT_READ_ROWS: readonly AuthAttemptReadRow[] = [
  {
    path: "src/services/auth/pin.ts",
    count: 1,
    reason: "The PIN's single-pair lockout derivation (048 §9.1) — the original, and the anchor.",
  },
  {
    path: "src/services/auth/credentials.ts",
    count: 1,
    reason:
      "`personWait` — the SHARED per-person budget across all THREE factors (057 §4.5, 048 §4.3). " +
      "It is ONE statement and not three: `authenticator.ts`'s `secondFactorWait` DELEGATES to it " +
      "rather than spelling its own, precisely so two budgets cannot become two by an edit to one " +
      "of them. The inventory therefore holds one row for three factors, which is the shape the " +
      "shared budget requires and the reason `authenticator.ts` is absent from this list.",
  },
  {
    path: "src/services/auth/invitations.ts",
    count: 1,
    reason:
      "The per-shop code-redemption delay (048 R14): the one derivation keyed on a SHOP rather " +
      "than on a pair, because the caller of a redemption is not yet a person.",
  },
];

const AUTH_ATTEMPT_READ = /\bFROM\s+auth_attempt\b/gi;

/**
 * **The half of 019 T35(b) that no import graph can see.**
 *
 * `.dependency-cruiser.cjs`'s `identity-public-surface-only` stops a caller
 * IMPORTING past the barrel. Nothing in an import graph stops a caller writing
 * `` `SELECT u.display_name FROM app_user u …` `` in its own file — which is
 * exactly how `readUser` and `readPerson` came to be two copies of one statement
 * in two files before this bead, neither of them audited and neither of them
 * visible to any rule. So the boundary is asserted over TEXT, in three parts:
 *
 *   1. no SQL literal outside `src/identity/` may PROJECT a person's attributes
 *      or any of 034 §3.3's three attribution column names;
 *   2. no SQL literal outside it may read the person TABLE at all (`FROM`/`JOIN
 *      app_user`), beyond one declared exemption;
 *   3. `identity_access` has exactly ONE writer, on `authorizationAudit.ts`'s
 *      precedent — a second writer is a second definition of what counts as
 *      resolving a person, and the audit would be reconciling one of two
 *      vocabularies.
 *
 * Plus 048 R17's fourth name: every `FROM auth_attempt` in the tree is a declared
 * lockout derivation.
 *
 * **SCOPE IS `src/` AND `scripts/`**, which is why it is called from
 * `architectureGate.ts` with both trees rather than from `runArchitectureRules`
 * (the invariant review's NOTE 5: a pure rule does not reach for the filesystem).
 * 058 F6 taught this one bead ago and it applies with more force here: one of the
 * five migrated callers IS a CLI (`pnpm enroll-authenticator`), so a rule blind
 * to `scripts/` would have been blind to the only accessor that reads an email.
 *
 * **WHAT IT CANNOT SEE, STATED RATHER THAN IMPLIED.** It reads template literals.
 * A statement assembled from concatenated fragments, or built by a query builder,
 * is invisible to it — and there is no such construction in this repository
 * today, which is what makes the rule worth having and also what bounds it. The
 * database-level guarantee is a different one and it is real: the application
 * role holds INSERT and no SELECT on `identity_access` (`appGrant: "insert-only"`),
 * so no arrangement of application SQL can read the audit back.
 */
export function checkIdentityPersonJoins(files: readonly SourceFile[]): Finding[] {
  const findings: Finding[] = [];
  const declared = new Map(PERSON_JOIN_ROWS.map((r) => [r.path, r]));

  for (const file of files) {
    if (file.path.startsWith(IDENTITY_ACCESSOR_DIR)) continue;
    const text = stripJsComments(file.text);

    let violations = 0;
    let m: RegExpExecArray | null;
    const literals = new RegExp(SQL_LITERAL.source, "g");
    while ((m = literals.exec(text)) !== null) {
      const sql = m[1] ?? "";
      if (!SQL_VERB.test(sql)) continue;
      const projected = PERSON_PROJECTION_COLUMNS.filter((c) =>
        new RegExp(`\\b${c}\\b`).test(projectionText(sql))
      );
      const readsTable = PERSON_TABLE_READ.test(sql);
      if (projected.length === 0 && !readsTable) continue;
      violations += 1;
    }

    const allowed = declared.get(file.path)?.count ?? 0;
    // AN EQUALITY, NOT A CEILING (`SELECT_STAR_ROWS`' discipline). A declared
    // file that stops holding its statement fails too, because a stale exemption
    // is a hole nobody is looking at. The check is per-SCANNED-file rather than a
    // sweep over the declaration list: a rule that reported on a path absent from
    // its input would be un-unit-testable on a fixture, and would be reporting on
    // a tree it was never shown. `tests/contract/architecture-gate.test.ts`
    // asserts against the REAL tree that every declared path exists in it.
    if (violations === allowed) continue;

    findings.push({
      rule: "identity-is-the-only-person-join",
      message:
        `${file.path} holds ${String(violations)} statement(s) that project a person's ` +
        `attributes (${PERSON_PROJECTION_COLUMNS.join(", ")}) or read \`app_user\` directly; ` +
        `${String(allowed)} declared (019 T35(b), 034 §3.3). Turning a key into a person happens ` +
        `in \`${IDENTITY_ACCESSOR_DIR}\` and nowhere else, because that is the only place the ` +
        `access writes an \`identity_access\` fact. Call an accessor through ` +
        `\`src/identity/index.ts\`, or — if this read genuinely projects an id and nothing else — ` +
        `add a PERSON_JOIN_ROWS row saying why, in the same PR.`,
    });
  }

  return findings;
}

/**
 * Rule 14d — the PUBLIC-SURFACE rule, extended to `scripts/` (the security
 * lens's F3b).
 *
 * `.dependency-cruiser.cjs`'s `identity-public-surface-only` covers `src/` and
 * only `src/`, because `pnpm depcruise` cruises `src`. `scripts/` imports the
 * module too — `pnpm enroll-authenticator` is one of the five migrated callers —
 * so the strongest boundary in this bead stopped at a directory edge, and a CLI
 * could have imported `src/identity/accessors.ts` directly and taken the person
 * query WITHOUT the audit fact, which is the whole control.
 *
 * Adding `scripts/` to the cruise was the other option and was not taken: the
 * cruise's module census is asserted byte-for-byte by the scratch-tree fixture
 * above, and widening the cruised set changes that census for every rule at once
 * to close one hole. A text rule over import specifiers is narrower, lives beside
 * the other two halves of this boundary, and needs no config change.
 */
export function checkIdentityImportSurface(files: readonly SourceFile[]): Finding[] {
  const findings: Finding[] = [];
  const deep = /from\s+["'][^"']*\/identity\/(?!index\.js)[^"']+["']/g;
  for (const file of files) {
    if (file.path.startsWith(IDENTITY_ACCESSOR_DIR)) continue;
    const hits = (stripJsComments(file.text).match(deep) ?? []).length;
    if (hits === 0) continue;
    findings.push({
      rule: "identity-public-surface-only",
      message:
        `${file.path} imports ${String(hits)} time(s) past \`src/identity/index.js\`. The accessor's ` +
        `only door is its barrel (034 §3.3): reaching into \`accessors.ts\` or \`access.ts\` takes ` +
        `the person query WITHOUT the audit fact, which is the control. ` +
        `\`pnpm depcruise\` says this for \`src/\`; this rule says it for \`scripts/\` too.`,
    });
  }
  return findings;
}

/** Rule 14b — one writer for the access fact (rule 3b's shape, one table over). */
export function checkIdentityAccessWriters(files: readonly SourceFile[]): Finding[] {
  const writers = files
    .filter((f) => (f.text.match(IDENTITY_ACCESS_INSERT) ?? []).length > 0)
    .map((f) => f.path)
    .sort();

  if (writers.length === 1 && writers[0] === IDENTITY_ACCESS_WRITER) return [];
  return [
    {
      rule: "identity-access-has-one-writer",
      message:
        `identity_access is written from [${writers.join(", ") || "nothing"}]; the only writer may ` +
        `be ${IDENTITY_ACCESS_WRITER} (000-docs/060 §3). A second writer is a second definition of ` +
        `what counts as resolving a person, and \`pnpm audit:identity-access\` would then be ` +
        `reconciling one of two vocabularies against one declared inventory.`,
    },
  ];
}

/** Rule 14c — 048 R17/I7: every `FROM auth_attempt` is a declared lockout derivation. */
export function checkAuthAttemptReads(files: readonly SourceFile[]): Finding[] {
  const findings: Finding[] = [];
  const declared = new Map(AUTH_ATTEMPT_READ_ROWS.map((r) => [r.path, r]));

  for (const file of files) {
    const count = (stripJsComments(file.text).match(AUTH_ATTEMPT_READ) ?? []).length;
    // Per-scanned-file and an EQUALITY, for `checkIdentityPersonJoins`' stated
    // reason: a declared reader that stops reading fails here, and the existence
    // of every declared path in the real tree is asserted by the contract test
    // rather than by a rule reporting on files it was never handed.
    const allowed = declared.get(file.path)?.count ?? 0;
    if (count === allowed) continue;
    findings.push({
      rule: "auth-attempt-is-substrate-not-surface",
      message:
        `${file.path} reads auth_attempt ${String(count)} time(s); ${String(allowed)} declared ` +
        `(048 R17, I7). Every query over this table must be a single-pair (or single-shop) lockout ` +
        `derivation or an audited break-glass query — a failure log read for any other reason is a ` +
        `per-operator surface, which 019 T35 signs at zero.`,
    });
  }

  return findings;
}

export function runArchitectureRules(files: readonly SourceFile[]): Finding[] {
  return [
    ...checkSelectStar(files),
    ...checkRouteDbAccess(files),
    ...checkCostLogWriters(files),
    ...checkAuthorizationDecisionWriters(files),
    ...checkLockOrder(files),
    ...checkScanSessionStatusWriters(files),
    ...checkSupersedesWriters(files),
    ...checkIdentityFunctionSeparation(files),
    ...checkNoVerticalBranching(files),
    ...checkTransactionsDeclareTenant(files),
    ...checkTenantGucWriters(files),
    // NOTE: `checkServiceScopeSites` is NOT called here — and neither is
    // `checkOriginDesignationWriters`, for the same reason and with a sharper
    // edge (058 F6): the only writers of an origin designation are reached from
    // `scripts/`, so a rule handed `src/` alone would be blind to the tree the
    // act lives in. It needs the `scripts/`
    // tree as well as `src/`, and a pure rule that reaches for the filesystem is
    // not a pure rule — the invariant review's NOTE 5. `scripts/architectureGate.ts`
    // collects both trees and calls it; `tests/contract/architecture-gate.test.ts`
    // does the same, so the rule is exercised with its inputs supplied rather than
    // discovered.
  ];
}
