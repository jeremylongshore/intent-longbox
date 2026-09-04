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
      const insert = body.search(IDEMPOTENCY_INSERT);
      const lock = body.search(ANCHOR_LOCK);
      if (insert === -1 || lock === -1) continue; // this chunk takes at most one of them
      if (insert > lock) {
        findings.push({
          rule: "fixed-lock-order",
          message:
            `${file.path}: mutating handler #${i + 1} takes the scan_session anchor lock BEFORE ` +
            `its request_idempotency INSERT (042 §5.3(b), I22). The fixed order is idempotency ` +
            `row first, anchor second, in every handler, always — the idempotency row is the ` +
            `request's IDENTITY and the session is its SUBJECT, so a replay must be recognised ` +
            `before it takes any lock on domain state. Two handlers with opposite orders ` +
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
    ...checkLockOrder(files),
    ...checkScanSessionStatusWriters(files),
    ...checkSupersedesWriters(files),
  ];
}
