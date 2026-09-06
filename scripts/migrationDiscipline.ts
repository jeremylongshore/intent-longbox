// Expand/contract discipline for `migrations/*.sql`, as pure functions.
//
// WHY THIS FILE EXISTS (E02-B10; 000-docs/044). Every ratified record in this
// repository tells the next author to write expand-only migrations — 041 §10
// ("Every migration below is expand-only, idempotent by hand … and adds no
// UPDATE path"), 040 §8 ("a shipped migration is never edited, every statement is
// `IF NOT EXISTS` / `DROP-then-ADD`"), 029 §5. All three say it in prose, and
// prose is enforced by review only. That is the same weakness 029 §3.3 names for
// the module boundary, and the same answer applies: **the rule becomes a check
// that runs, or it erodes.**
//
// The check is deliberately narrow. It does not parse SQL — a SQL parser here
// would be a second, weaker Postgres, and every false positive it produced would
// train an author to reach for the escape hatch. It looks for the four statement
// shapes that can BREAK A RUNNING DEPLOY when they land before the last writer is
// gone, and it asks for one thing when it finds them: a `-- contract:` header
// that names the expand migration being retired and the 000-docs/006 decision-log
// row that authorised the retirement. A contract step is legitimate — 040 §8.2 is
// one, planned and ratified — and the header is how a legitimate one is told from
// an accident.
//
// THE LEDGER'S CHECKSUM IS THE OTHER HALF. A migration file is never renamed once
// applied, because the runner's ledger keys on the filename (041 §10). Nothing,
// until now, kept the CONTENTS honest: editing a shipped file changed what a fresh
// database gets while every already-migrated database kept the old shape, and the
// runner printed `skip` either way. `checksum()` is what makes that divergence a
// loud failure instead of a silent one.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

/**
 * Every migration off disk, in filename order.
 *
 * It lives HERE rather than in `migrate.ts` because `migrate.ts` is a CLI that
 * runs `main()` on import — anything importing it to reach one helper would
 * migrate a database as a side effect. Three callers need the list: the runner,
 * the fixture generator, and the tests.
 */
export function readMigrations(): Array<{ filename: string; sql: string }> {
  return readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((filename) => ({ filename, sql: readFileSync(join(migrationsDir, filename), "utf8") }));
}

/**
 * **Two migration files may not share a numeric prefix** (E03-D11, the
 * consistency lens's K6; 041 §10, 044 §7).
 *
 * ⚠ **THIS IS A STRUCTURAL SAFEGUARD AND NOT A RESPONSE TO A BUG THAT HAPPENED.**
 * 041 §10's rule is *"a file number is claimed when the file is written, never
 * reserved in prose"*, which is right and which makes a collision the ordinary
 * outcome of two branches in flight at once: each reads the tree, sees the same
 * highest number, and takes the next one. Nothing downstream would say so — the
 * runner's ledger keys on the FILENAME, so `031_a.sql` and `031_b.sql` are two
 * distinct rows that both apply, in `readdirSync` order, with no complaint. The
 * failure surfaces later as two databases with different schemas and the same
 * ledger count, which is the shape of defect nobody debugs quickly.
 *
 * It is deliberately a check on the PREFIX and not on the whole name, because
 * the prefix is the only part the runner and the fixtures agree on.
 */
export function findDuplicateMigrationNumbers(
  filenames: readonly string[]
): Array<{ prefix: string; files: string[] }> {
  const byPrefix = new Map<string, string[]>();
  for (const filename of filenames) {
    const m = /^(\d+)/.exec(filename);
    if (!m) continue;
    const prefix = m[1]!;
    byPrefix.set(prefix, [...(byPrefix.get(prefix) ?? []), filename]);
  }
  return [...byPrefix.entries()]
    .filter(([, files]) => files.length > 1)
    .map(([prefix, files]) => ({ prefix, files: [...files].sort() }))
    .sort((a, b) => a.prefix.localeCompare(b.prefix));
}

/** SHA-256 over the file's exact bytes, hex. The class is pinned the way 041 A5 pins `content_hash`. */
export function checksum(sql: string): string {
  return createHash("sha256").update(sql, "utf8").digest("hex");
}

/**
 * The header a contract migration must carry.
 *
 * `retires` names the expand migration whose visible effect this file removes;
 * `row` names the 000-docs/006 decision-log entry that authorised it. Both are
 * required, because a contract step with no expand step to retire is not a
 * contract step — it is a schema change nobody planned — and a contract step with
 * no decision-log row is one nobody signed.
 */
export interface ContractHeader {
  readonly retires: string;
  readonly row: string;
}

/** `-- contract: retires <file>; 006 row: <text>` — one line, anywhere in the file's comments. */
const CONTRACT_HEADER =
  /^[ \t]*--[ \t]*contract:[ \t]*retires[ \t]+(\S+)[ \t]*;[ \t]*006[ \t]+row:[ \t]*(.+?)[ \t]*$/im;

export function parseContractHeader(sql: string): ContractHeader | undefined {
  const m = CONTRACT_HEADER.exec(sql);
  if (!m) return undefined;
  const retires = m[1]!;
  const row = m[2]!;
  if (row.length === 0) return undefined;
  return { retires, row };
}

/**
 * Strip `--` line comments and `/* *\/` block comments.
 *
 * Deliberately naive about string literals: a `--` inside a quoted string would be
 * treated as a comment. Every migration in this repository is machine-shaped DDL,
 * and the cost of the naive version is a MISSED detection, never a false one —
 * which is the right direction for a rule whose false positives would teach people
 * to route around it. The comment blocks in `003` and `006` quote `ALTER TABLE …
 * DISABLE TRIGGER` and `UPDATE … SET` at length, so NOT stripping comments is what
 * would produce nonsense.
 */
export function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, "");
}

/** One statement shape that removes or narrows something a running deploy may still use. */
export interface ContractingStatement {
  /** `drop table` | `drop column` | `alter column type` | `set not null` */
  readonly kind: string;
  /** The matched text, collapsed to one line, for the error message. */
  readonly snippet: string;
}

const CONTRACTING_PATTERNS: ReadonlyArray<{ kind: string; re: RegExp }> = [
  { kind: "drop table", re: /\bDROP\s+TABLE\b[^;]*/gi },
  { kind: "drop column", re: /\bDROP\s+COLUMN\b[^;]*/gi },
  // `ALTER TABLE … ALTER COLUMN … TYPE …` — a type change rewrites values under a
  // reader that was compiled against the old type.
  { kind: "alter column type", re: /\bALTER\s+(?:COLUMN\s+)?\S+\s+(?:SET\s+DATA\s+)?TYPE\b[^;]*/gi },
  // `SET NOT NULL` on an EXISTING column: a writer that omits the column starts failing.
  // `ADD COLUMN … NOT NULL DEFAULT …` is expand and is deliberately not matched.
  { kind: "set not null", re: /\bALTER\s+(?:COLUMN\s+)?\S+\s+SET\s+NOT\s+NULL\b[^;]*/gi },
];

/** Every contracting statement in `sql`, comments already removed. */
export function findContractingStatements(sql: string): ContractingStatement[] {
  const body = stripSqlComments(sql);
  const found: ContractingStatement[] = [];
  for (const { kind, re } of CONTRACTING_PATTERNS) {
    for (const m of body.matchAll(re)) {
      found.push({ kind, snippet: m[0].replace(/\s+/g, " ").trim().slice(0, 120) });
    }
  }
  return found;
}

/**
 * Lint one migration file. Returns the human-readable errors; empty means clean.
 *
 * The rule, in one sentence: **a migration is expand-only unless it declares
 * itself a contract step.** Declaring costs one comment line and buys the reader
 * the two facts they will want — which expand migration is being retired, and
 * which decision-log row authorised it.
 *
 * **This is the ERROR half of `lintMigrationDetailed`** (E03-D20). It keeps its
 * original signature because three callers and the runner depend on it, and
 * because the warning half is a different question — *what will refuse at G3?* —
 * that a caller has to ask on purpose.
 */
export function lintMigration(filename: string, sql: string): string[] {
  return lintMigrationDetailed(filename, sql).errors;
}

function lintExpandContract(filename: string, sql: string): string[] {
  const contracting = findContractingStatements(sql);
  const header = parseContractHeader(sql);
  const errors: string[] = [];

  if (contracting.length > 0 && !header) {
    const kinds = [...new Set(contracting.map((c) => c.kind))].sort().join(", ");
    errors.push(
      `${filename}: contains ${contracting.length} contracting statement(s) [${kinds}] but declares no ` +
        `\`-- contract:\` header. Migrations are expand-only by default (041 §10, 040 §8, 000-docs/044 §2). ` +
        `If this really is a contract step, add a line of the form:\n` +
        `  -- contract: retires 0NN_<expand-migration>.sql; 006 row: <decision-log entry>\n` +
        `First offending statement: ${contracting[0]!.snippet}`
    );
  }
  if (header && contracting.length === 0) {
    errors.push(
      `${filename}: declares a \`-- contract:\` header but contains no contracting statement. ` +
        `A header on an expand migration is a claim the file does not support; remove it.`
    );
  }
  if (header && !/^\d{3}_[a-z0-9_]+\.sql$/.test(header.retires)) {
    errors.push(
      `${filename}: \`-- contract: retires ${header.retires}\` does not name a migration file ` +
        `(expected 0NN_slug.sql). The header must name the expand migration this step retires.`
    );
  }
  return errors;
}

/** What the ledger holds for one applied file. */
export interface LedgerRow {
  readonly filename: string;
  readonly checksum: string | null;
}

/** What `pnpm migrate` intends to do with one file. */
export type PlanAction = "apply" | "skip" | "adopt-checksum";

export interface PlanEntry {
  readonly filename: string;
  readonly action: PlanAction;
  readonly checksum: string;
}

/**
 * Thrown when an already-applied migration's bytes no longer match the ledger.
 *
 * This is the failure the checksum exists for, and it is loud on purpose. A file
 * edited after it was applied gives a fresh database one schema and every existing
 * database another, and the runner's `skip` line looks identical in both cases.
 * The fix is never to force the checksum: it is a NEW migration that makes the
 * intended change (000-docs/044 §4), because the shipped one has already run
 * somewhere you cannot reach.
 */
export class MigrationChecksumError extends Error {
  constructor(
    readonly filename: string,
    readonly recorded: string,
    readonly actual: string
  ) {
    super(
      `refusing to migrate: ${filename} was already applied, but its contents have changed since.\n` +
        `  ledger:  ${recorded}\n` +
        `  on disk: ${actual}\n` +
        `A shipped migration is never edited (041 §10, 000-docs/044 §4): the old bytes already ran on ` +
        `every database that applied it, so editing them makes a fresh database diverge silently from ` +
        `an existing one. Revert the edit and add a NEW migration that makes the change.`
    );
    this.name = "MigrationChecksumError";
  }
}

/**
 * Decide, per file, what the runner will do — without touching a database.
 *
 * `adopt-checksum` is the one soft case, and it exists because the ledger predates
 * this column: a row applied before checksums existed has `checksum IS NULL`, and
 * there is no honest baseline to compare it against. The runner records the
 * on-disk digest and says so out loud, so the adoption is visible in the log
 * rather than inferred from its absence. From the next run on, that file is
 * verified like any other.
 */
export function planMigrations(
  files: ReadonlyArray<{ filename: string; sql: string }>,
  ledger: ReadonlyArray<LedgerRow>
): PlanEntry[] {
  const byName = new Map(ledger.map((r) => [r.filename, r]));
  return files.map((f) => {
    const sum = checksum(f.sql);
    const row = byName.get(f.filename);
    if (!row) return { filename: f.filename, action: "apply", checksum: sum };
    if (row.checksum === null) return { filename: f.filename, action: "adopt-checksum", checksum: sum };
    if (row.checksum !== sum) throw new MigrationChecksumError(f.filename, row.checksum, sum);
    return { filename: f.filename, action: "skip", checksum: sum };
  });
}

// ============================================================================
// THE FIFTH SHAPE, AND THE INDEX-LOCK RULE
// (E03-D20; 000-docs/044 §2 A1, §4 A1, §9, §10; 000-docs/056 §9 and §14)
// ============================================================================
//
// WHY A FIFTH SHAPE. The four shapes above break a running deploy by REMOVING
// something a live reader or writer still names, so the danger is NEW schema
// under OLD code and the answer is to land the contract step after the last
// writer is gone. Enabling row-level security removes nothing and breaks a
// running deploy anyway, in the opposite direction: after `migrations/029` the
// application role with no tenant context reads ZERO rows from every policied
// table, so the dangerous state is OLD CODE against the NEW schema — and it
// fails SILENTLY, as an empty result rather than as an error (056 §6, §14).
// Rolling the code back alone is a total read outage nothing reports; rolling
// the schema back alone makes the boot assertion refuse to bind a port. So the
// declaration this shape asks for is not *what does this retire* — it retires
// nothing — but *what must ship and roll back WITH it*.
//
// WHY AN INDEX RULE THAT ONLY WARNS TODAY. A plain `CREATE INDEX` takes
// `ACCESS EXCLUSIVE` for the duration of the build: a write outage on a
// populated table, and free on an empty one. 034:421 puts the first live shop
// item behind **G3** while this rule lands at G2, so today every table these
// builds touch is empty or synthetic. `G3_LIVE_SHOP_ROWS` is the one thing a
// reader has to flip when that stops being true.

/**
 * **PROVISIONAL (000-docs/044 §9).** `false` while no database this repository
 * migrates can hold a live shop row.
 *
 * 034:421 — *"019 §5 puts T24 in CI at G2 as a Core Safe criterion, and places
 * Pilot A behind G3. RLS (E03-B04) is a G2 deliverable; the first live shop item
 * is a G3 event."* Until that event a non-concurrent index build locks a table
 * that is empty or synthetic, so the rule below WARNS. After it, the same build
 * is a write outage, so the rule REFUSES.
 *
 * **It is a flag and not a date, on purpose.** G3 has no scheduled date in any
 * ratified record — 014 §5's gate frame (014:245-258) states G3's REQUIRED PROOF
 * and what it unlocks (014:254), not a calendar — and a date hardcoded here would
 * be a fabricated fact that starts refusing migrations on a day nobody chose. The
 * flip is a deliberate act: the change that opens the first live shop sets this to
 * `true`, writes the 000-docs/006 row that records the date, and answers whatever
 * warnings the flip turns into refusals (044 §9 names the two honest answers).
 */
export const G3_LIVE_SHOP_ROWS = false;

/** A statement that introduces or reshapes a tenant boundary (044 §2 A1). */
const TENANT_BOUNDARY_PATTERNS: ReadonlyArray<{ kind: string; re: RegExp }> = [
  // `ALTER TABLE … ENABLE ROW LEVEL SECURITY` — from this statement forward, a
  // connection with no `longbox.shop_id` set reads nothing from the table.
  { kind: "enable row level security", re: /\bENABLE\s+ROW\s+LEVEL\s+SECURITY\b[^;]*/gi },
  // `FORCE` additionally binds the table OWNER, which is the role migrations and
  // every operator CLI run as (E02-D06). Strictly larger blast radius than ENABLE.
  { kind: "force row level security", re: /\bFORCE\s+ROW\s+LEVEL\s+SECURITY\b[^;]*/gi },
  // A policy is what makes an enabled table readable at all — enabled with no
  // policy denies everything — so creating one is part of the same deploy unit,
  // and RESHAPING one changes what a live reader sees without touching a column.
  // 056 F1 is exactly that failure, caught in review rather than in production.
  { kind: "create policy", re: /\bCREATE\s+POLICY\b[^;]*/gi },
  // ⚠ `ALTER POLICY` and `DROP POLICY` are NOT matched, and the omission is a
  // decision rather than an oversight (044 §2 A1). Every policy in this repository
  // is written DROP-then-CREATE — `029:220` does it in the loop, for the
  // re-runnability §7 requires, because `CREATE POLICY` has no `IF NOT EXISTS` —
  // so the CREATE half is caught and matching the DROP would double every count.
  // A bare `ALTER POLICY` in some future file would slip past this lint, and the
  // mechanism that sees it is not a regex: the boot assertion compares every LIVE
  // policy's normalised `qual` and `with_check` against the declared set
  // (`src/services/roleSeparation.ts:343-346`), so a reshape fails to bind a port.
];

/**
 * Every tenant-boundary statement in `sql`, comments already removed.
 *
 * Deliberately SEPARATE from `findContractingStatements` rather than a fifth row
 * in its table, because the two demand different halves of the header: a contract
 * step names the expand migration it retires, and a boundary step retires nothing
 * and names the DEPLOY UNIT it must ship and roll back with.
 *
 * As naive about string literals as everything else here, and in the same
 * direction: `029` builds its policies inside `format()` calls in a `DO` block, so
 * the match lands on the string rather than on the executed statement — and the
 * file is still correctly identified as the one that turns the boundary on.
 */
export function findTenantBoundaryStatements(sql: string): ContractingStatement[] {
  const body = stripSqlComments(sql);
  const found: ContractingStatement[] = [];
  for (const { kind, re } of TENANT_BOUNDARY_PATTERNS) {
    for (const m of body.matchAll(re)) {
      found.push({ kind, snippet: m[0].replace(/\s+/g, " ").trim().slice(0, 120) });
    }
  }
  return found;
}

/** The header a migration that moves a tenant boundary must carry (044 §2 A1). */
export interface DeployUnitHeader {
  /** The code and schema that must ship together, and the order they roll back in. */
  readonly deployUnit: string;
  readonly row: string;
}

/** `-- contract: deploy unit <text>; 006 row: <text>` — the boundary half of §2's mechanism. */
const DEPLOY_UNIT_HEADER =
  /^[ \t]*--[ \t]*contract:[ \t]*deploy[ \t]+unit[ \t]+(.+?)[ \t]*;[ \t]*006[ \t]+row:[ \t]*(.+?)[ \t]*$/im;

export function parseDeployUnitHeader(sql: string): DeployUnitHeader | undefined {
  const m = DEPLOY_UNIT_HEADER.exec(sql);
  if (!m) return undefined;
  const deployUnit = m[1]!;
  const row = m[2]!;
  if (deployUnit.length === 0 || row.length === 0) return undefined;
  return { deployUnit, row };
}

/** One `CREATE INDEX` that holds `ACCESS EXCLUSIVE` for the duration of its build. */
export interface IndexBuild {
  /** The table the index is built on, or `undefined` when the naive match read none. */
  readonly table: string | undefined;
  readonly snippet: string;
}

const CREATE_TABLE =
  /\bCREATE\s+(?:UNLOGGED\s+|TEMP(?:ORARY)?\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_][A-Za-z0-9_]*)/gi;
// ⚠ `ALTER TABLE … ADD CONSTRAINT … UNIQUE` and `… ADD PRIMARY KEY` are NOT
// matched, and they build an index under ACCESS EXCLUSIVE exactly as a plain
// `CREATE INDEX` does. Matching them would need the `USING INDEX` form to be told
// from the building form, which is parsing — a third stated miss rather than a
// second, weaker Postgres (044 §9).
const CREATE_INDEX_NOT_CONCURRENTLY = /\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+(?!CONCURRENTLY\b)[^;]*/gi;
const INDEX_TARGET = /\bON\s+(?:ONLY\s+)?([A-Za-z_][A-Za-z0-9_]*)/i;

/**
 * Every non-`CONCURRENTLY` index build in `sql` on a table this file did not create.
 *
 * **The same-file exemption is what makes the rule usable rather than ceremony.**
 * Nearly every migration here creates a table and indexes it three lines later;
 * that table holds no rows, so the lock is instantaneous and asking the author to
 * declare it would teach them the declaration means nothing. What is left is the
 * shape that actually costs something — an index built on a table that was already
 * there: `029`'s eighteen, and whatever the next one is.
 *
 * It misses one case, stated rather than hidden: a file that creates a table, then
 * POPULATES it, then indexes it. That is a missed detection, never a false one,
 * which is §2's stated direction for every naive rule in this file.
 */
export function findNonConcurrentIndexBuilds(sql: string): IndexBuild[] {
  const body = stripSqlComments(sql);
  const createdHere = new Set<string>();
  for (const m of body.matchAll(CREATE_TABLE)) createdHere.add(m[1]!.toLowerCase());

  const found: IndexBuild[] = [];
  for (const m of body.matchAll(CREATE_INDEX_NOT_CONCURRENTLY)) {
    const statement = m[0];
    const target = INDEX_TARGET.exec(statement)?.[1];
    if (target !== undefined && createdHere.has(target.toLowerCase())) continue;
    found.push({ table: target, snippet: statement.replace(/\s+/g, " ").trim().slice(0, 120) });
  }
  return found;
}

/** `-- index lock: <justification>` — one line, and the justification may not be empty. */
const INDEX_LOCK_HEADER = /^[ \t]*--[ \t]*index[ \t]+lock:[ \t]*(.+?)[ \t]*$/im;

export function parseIndexLockHeader(sql: string): string | undefined {
  const m = INDEX_LOCK_HEADER.exec(sql);
  if (!m) return undefined;
  const justification = m[1]!;
  return justification.length === 0 ? undefined : justification;
}

/** Which of the two E03-D20 shapes a grandfather row covers. */
export type GrandfatheredShape = "tenant boundary" | "non-concurrent index";

/**
 * A migration that predates the rule it would otherwise fail (044 §10).
 *
 * **What an entry MEANS, precisely:** this file has already been applied
 * everywhere it will ever be applied, so the statement the rule guards against has
 * already happened and cannot happen again — the runner skips an applied file by
 * checksum and never re-runs its index builds. It is NOT a waiver for a file that
 * has yet to reach a database, and it is not a way to avoid writing a header.
 *
 * **A shipped migration is never edited** (044 §4), so naming the old bytes here
 * with a reason is the only honest way to apply a new rule to them.
 */
export interface GrandfatheredMigration {
  readonly filename: string;
  readonly shapes: ReadonlyArray<GrandfatheredShape>;
  readonly reason: string;
}

export const MIGRATION_LINT_GRANDFATHER: ReadonlyArray<GrandfatheredMigration> = [
  {
    filename: "029_row_level_security.sql",
    shapes: ["tenant boundary", "non-concurrent index"],
    reason:
      "Landed under 000-docs/056 (E03-B04, merged to main as a451de8) BEFORE this rule existed, and a " +
      "shipped migration is never edited (044 §4) — so the rule applies forward and this file is NAMED " +
      "rather than rewritten. Both halves are already argued in the record it landed under: its deploy " +
      "unit, its rollback order and the silent-empty-read failure are 056 §14, and its eighteen " +
      "non-CONCURRENTLY index builds are 056 §9's stated decision, free because 034:421 puts the first " +
      "live shop item behind G3.",
  },
];

function grandfatheredFor(filename: string, shape: GrandfatheredShape): boolean {
  return MIGRATION_LINT_GRANDFATHER.some((g) => g.filename === filename && g.shapes.includes(shape));
}

/** What one file's lint produced: refusals, and the warnings that become refusals at G3. */
export interface MigrationLint {
  readonly errors: string[];
  readonly warnings: string[];
}

export interface MigrationLintOptions {
  /**
   * Whether any table in this schema may hold a live shop row. Defaults to
   * `G3_LIVE_SHOP_ROWS`; the parameter exists so the post-G3 refusal is TESTED
   * before G3 rather than trusted (029 §5 move 8 — prove the gate can fail).
   */
  readonly liveShopRows?: boolean;
}

/**
 * Lint one migration file, errors and warnings both.
 *
 * Three rules, in the order they were added: the expand/contract rule (§2, E02-B10),
 * the tenant-boundary rule (§2 A1, E03-D20) and the index-lock rule (§9, E03-D20).
 */
export function lintMigrationDetailed(
  filename: string,
  sql: string,
  options: MigrationLintOptions = {}
): MigrationLint {
  const liveShopRows = options.liveShopRows ?? G3_LIVE_SHOP_ROWS;
  const errors = lintExpandContract(filename, sql);
  const warnings: string[] = [];

  // ---- the fifth shape: a tenant boundary moves (044 §2 A1) ----------------
  const boundary = grandfatheredFor(filename, "tenant boundary") ? [] : findTenantBoundaryStatements(sql);
  const deployUnit = parseDeployUnitHeader(sql);
  if (boundary.length > 0 && !deployUnit) {
    const kinds = [...new Set(boundary.map((b) => b.kind))].sort().join(", ");
    errors.push(
      `${filename}: contains ${boundary.length} tenant-boundary statement(s) [${kinds}] but declares no ` +
        `\`-- contract: deploy unit\` header. A boundary retires nothing and is therefore NOT covered by the ` +
        `\`retires\` header — what it needs declared is the code that must ship and roll back WITH it ` +
        `(000-docs/044 §2 A1, §4 A1; 056 §14). Rolling the code back alone leaves every read returning zero ` +
        `rows, silently; rolling the schema back alone makes the boot assertion refuse to serve. Add:\n` +
        `  -- contract: deploy unit <what ships together, and the rollback order>; 006 row: <decision-log entry>\n` +
        `First offending statement: ${boundary[0]!.snippet}`
    );
  }
  if (deployUnit && boundary.length === 0) {
    errors.push(
      `${filename}: declares a \`-- contract: deploy unit\` header but moves no tenant boundary. ` +
        `A header on a file that enables no row-level security and creates no policy is a claim the file ` +
        `does not support; remove it.`
    );
  }

  // ---- the index-lock rule (044 §9) ---------------------------------------
  const builds = grandfatheredFor(filename, "non-concurrent index") ? [] : findNonConcurrentIndexBuilds(sql);
  const indexLock = parseIndexLockHeader(sql);
  if (builds.length > 0 && !indexLock) {
    const tables = [...new Set(builds.map((b) => b.table ?? "«unread»"))].sort().join(", ");
    if (liveShopRows) {
      errors.push(
        `${filename}: builds ${builds.length} index(es) without CONCURRENTLY on ` +
          `${builds.length === 1 ? "a table" : "tables"} this file did not create [${tables}]. A plain ` +
          `\`CREATE INDEX\` holds ACCESS EXCLUSIVE for the duration of the build, which is a write outage ` +
          `once the table has rows (000-docs/044 §9; 056 §9). Either build it \`CONCURRENTLY\` — outside a ` +
          `transaction, and an interrupted build leaves an INVALID index to drop and rebuild — or declare ` +
          `why the lock is free here:\n` +
          `  -- index lock: <why this table is empty, or why the outage is acceptable and who agreed it>\n` +
          `First offending statement: ${builds[0]!.snippet}`
      );
    } else {
      // ONE compact line per file, deliberately: ten paragraphs of remedy text on
      // every `pnpm migrate` would teach the reader to scroll past the eleventh.
      // The full remedy is the error message above, printed when it can act.
      warnings.push(
        `${filename}: ${builds.length} non-CONCURRENTLY index build(s) on pre-existing table(s) ` +
          `[${tables}] — free today, because \`G3_LIVE_SHOP_ROWS\` is false and no table can hold a live ` +
          `shop row yet (034:421), and a REFUSAL when that flag flips (000-docs/044 §9, §10).`
      );
    }
  }
  if (indexLock && builds.length === 0) {
    errors.push(
      `${filename}: declares an \`-- index lock:\` header but builds no non-CONCURRENTLY index on a ` +
        `pre-existing table. A header on a file that takes no such lock is a claim the file does not ` +
        `support; remove it.`
    );
  }

  return { errors, warnings };
}
