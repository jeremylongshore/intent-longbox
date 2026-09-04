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
 */
export function lintMigration(filename: string, sql: string): string[] {
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
