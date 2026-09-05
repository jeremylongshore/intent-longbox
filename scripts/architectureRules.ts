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
 * The SESSION lock — the third position, added by E03-D09 (048 K1).
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
 * The AUTHENTICATOR lock — the FOURTH position, added by E03-D06 (048 §4.3, R19).
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
      // FOUR POSITIONS SINCE E03-D06, checked over every PAIR so a chunk that
      // takes only two of the four is still policed:
      //   request_idempotency INSERT → app_session (FOR NO KEY UPDATE)
      //     → user_authenticator (FOR UPDATE) → scan_session anchor (FOR UPDATE)
      const positions: Array<{ name: string; at: number }> = [
        { name: "its request_idempotency INSERT", at: body.search(IDEMPOTENCY_INSERT) },
        { name: "the app_session lock", at: body.search(SESSION_LOCK) },
        { name: "the user_authenticator lock", at: body.search(AUTHENTICATOR_LOCK) },
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
            `${second} (042 §5.3(b) I22, extended to three positions by 048 K1 and to four by ` +
            `E03-D06). The fixed order is request_idempotency INSERT, then the app_session row ` +
            `FOR NO KEY UPDATE, then the user_authenticator row FOR UPDATE, then the ` +
            `scan_session anchor FOR UPDATE, in every handler, always — the idempotency row is ` +
            `the request's IDENTITY, the session says who is asking, the authenticator says ` +
            `they are still who they claim, and only then is the domain subject touched. Two ` +
            `handlers with opposite orders deadlock (40P01) intermittently, at a counter, ` +
            `reproducing on nobody's laptop.`,
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
export function collectSources(dir: string): SourceFile[] {
  const out: SourceFile[] = [];
  const walk = (abs: string): void => {
    for (const entry of readdirSync(abs)) {
      const child = join(abs, entry);
      if (statSync(child).isDirectory()) walk(child);
      else if (child.endsWith(".ts")) {
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
  ];
}
