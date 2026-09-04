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
 * It holds two more than that, and they are declared as DEFECTS rather than
 * quietly folded in — 042 I5 says in the same breath that the invariant "fails on
 * the current tree" at `scanSession.ts:31` and `:85`, and turning a named defect
 * into an exemption to make a gate green is the move this file exists to prevent.
 */
export const SELECT_STAR_ROWS: readonly SelectStarRow[] = [
  {
    path: "src/services/scanSession.ts",
    count: 3,
    kind: "defect",
    closingBead: "E02-D08 `longbox-e5b.2.18` (029 §5 move 6; 042 I5, 040 A8/I20)",
    reason:
      "Three reads: `getScanSession` and `lockScanSession` select the whole scan_session row " +
      "(so `routes:111` returns `status`, which 040 retires), and `getSessionEvents` selects " +
      "the whole row of each of seven trail tables. The THIRD is legitimate and 042 I5 says " +
      "so — the trail is the complete unfiltered history (041 I9) and a column list there " +
      "would silently drop a column a later migration adds. The first two are the defect. " +
      "The count is 3 and not 1 because separating them means splitting the file, which is " +
      "E02-D09's read-per-owning-module work; until then the honest record is one row " +
      "that says which of the three is which.",
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
 * The declared, dated inventory of route-layer database access.
 *
 * 029 §5 move 8 obliges this bead to add "a lint or test assertion that no file
 * under `src/routes/` contains `db.query` or `INSERT INTO`". The tree does not
 * satisfy that today and cannot be made to by this bead: `src/routes/scanSessions.ts`
 * owns six `db.query` calls and one `INSERT INTO`, and moving them is 029 §5 moves
 * 2 and 6, executed by E02-D08 `longbox-e5b.2.18` and E02-D09 `longbox-e5b.2.19`
 * and explicitly fenced away from this one ("this bead does not re-litigate record
 * ownership"). Those two beads exist because E02-B07 and E02-B08 are CLOSED
 * decision beads — they produced 041 and 042 — and a closed bead cannot close a
 * defect row.
 *
 * So the rule ships as an EXACT COUNT rather than as a zero. A new call fails the
 * gate; a removed call also fails it, until someone lowers the number — which is
 * what makes the inventory shrink deliberately instead of drifting. The row is
 * kind=defect with its closing beads named, and 042 A8's ruling applies: **no
 * defect-kind row may exist at G2.**
 */
export const ROUTE_DB_ROWS: readonly RouteDbRow[] = [
  {
    path: "src/routes/scanSessions.ts",
    dbQuery: 3,
    insertInto: 0,
    providerImports: 1,
    pgImports: 1,
    kind: "defect",
    closingBead:
      "E02-D08 `longbox-e5b.2.18` (029 §5 move 6 — the three remaining reads). E02-D09 " +
      "`longbox-e5b.2.19` closed move 2's half: `insertInto` reached 0.",
    reason:
      "V1 and the `db.query` calls 029 §5 move 8 note N2 names. THE CLOSING BEADS ARE E02-D08 AND " +
      "E02-D09, NOT E02-B07/E02-B08: those two are CLOSED decision beads (they produced 041 and 042); a " +
      "closed bead cannot close a defect row, and naming one would make this row unclosable by construction. " +
      "The gate audit of this bead caught that, and 015 carries the two new rows.  The counts are 3 and 0, not the " +
      "six and three N2 recorded at `fb3f706`: E02-D04 moved the confirmation and draft INSERTs into " +
      "`scanSession.ts` behind the request transaction, and E02-D09 moved the last one — the " +
      "`condition_assessment` INSERT — into the condition module that owns the table (029 §5 move 2), " +
      "wrapping `POST …/condition` in the request transaction on the way, because 041 §3.3's " +
      "supersession writer needs the anchor lock. **`insertInto` is now 0 and stays 0**; the row " +
      "survives for the three `db.query` reads that remain — `requireShop`'s `shop` SELECT (one " +
      "call site, two callers), `latestPolicy`'s `shop_pricing_policy` SELECT, and the shop list " +
      "at `/api/shops`. Move 6 removes those and puts the provider registry behind workflow's " +
      "public API, which is E02-D08's.",
  },
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
 * **This rule PASSES VACUOUSLY TODAY** — `migrations/009` lands the table and no
 * handler writes to it yet (the wiring is E02-D08's). That is deliberate and it is
 * the point: the rule exists for "a handler written six months from now by someone
 * who has not read this section", so it has to be in place BEFORE the first handler
 * that could violate it. `tests/contract/architecture-gate.test.ts` proves it can
 * fail against a reversed-order fixture, because a rule that has never failed is
 * indistinguishable from a rule that cannot.
 *
 * **No exceptions and no opt-out comment** (042 I22(a), literally). There is no
 * escape hatch in this function on purpose.
 */
const HANDLER_SPLIT = /\.(post|put|patch|delete)\s*[(<]/g;
const IDEMPOTENCY_INSERT = /INSERT\s+INTO\s+request_idempotency\b/i;
const ANCHOR_LOCK = /(FROM\s+scan_session[\s\S]{0,200}?FOR\s+UPDATE)|(\blockScanSession\s*\()/i;

/** Split a route file into one chunk per mutating handler registration. */
export function splitMutatingHandlers(text: string): string[] {
  const starts: number[] = [];
  for (const m of text.matchAll(HANDLER_SPLIT)) starts.push(m.index);
  return starts.map((start, i) => text.slice(start, starts[i + 1] ?? text.length));
}

export function checkLockOrder(files: readonly SourceFile[]): Finding[] {
  const findings: Finding[] = [];
  for (const file of files) {
    if (!file.path.startsWith("src/routes/")) continue;
    for (const [i, body] of splitMutatingHandlers(file.text).entries()) {
      const insert = body.search(IDEMPOTENCY_INSERT);
      const lock = body.search(ANCHOR_LOCK);
      if (insert === -1 || lock === -1) continue; // nothing to order yet
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
