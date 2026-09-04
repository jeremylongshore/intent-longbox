// The consumer write-shape lint (043 A2(b), an E02-D07 acceptance line).
//
// THE RULE. A consumer's idempotency is enforced by a DATABASE CONSTRAINT or by
// a provider-side natural key, NEVER by a read-then-write check (043 §3.2). At
// least-once delivery plus `SKIP LOCKED` plus the visibility window means two
// workers can process two deliveries of one event AT THE SAME TIME, not merely
// one after the other — and a consumer that is idempotent by *checking then
// writing* is not idempotent under that interleaving, while one that is
// idempotent by a *unique constraint* is.
//
// WHY A LINT AND NOT A REVIEW COMMENT. 042 I22 takes the same posture toward
// lock order and states the reason: a rule whose violation is otherwise an
// intermittent failure gets a lint. A read-then-write consumer passes every test
// that delivers twice in sequence and fails only under a real race, on a
// machine that is not the author's.
//
// THIS ANALYSER IS DELIBERATELY SHALLOW, AND ITS SCOPE IS STATED RATHER THAN
// ASSUMED. It reads the SQL literals in ONE file and asks whether that file
// SELECTs a table and then writes the same table with no `ON CONFLICT`. It does
// NOT resolve imports, so a consumer that reads a table here and writes it
// through a helper elsewhere is not caught by this function — the companion
// assertion in `consumer-write-shape.test.ts` covers that one write directly.
// Two constructs are treated as protection, both because they are:
//
//   * `ON CONFLICT` on the write — the constraint IS the idempotency;
//   * `FOR UPDATE` on the read — the row lock makes the read-then-write atomic,
//     which is the anchor-lock pattern 041 §4.2 requires everywhere else. A lint
//     that flagged it would be telling every correct handler in the tree to stop
//     taking its lock.

export interface WriteShapeFinding {
  readonly table: string;
  readonly reason: string;
}

/** Strip line and block comments so a SQL word inside prose is not a match. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, " ");
}

/** Every backtick template literal and every quoted string, as raw text. */
function literals(src: string): string[] {
  const out: string[] = [];
  for (const re of [/`(?:[^`\\]|\\.)*`/g, /"(?:[^"\\]|\\.)*"/g, /'(?:[^'\\]|\\.)*'/g]) {
    out.push(...(src.match(re) ?? []));
  }
  return out;
}

const IDENT = "([a-z_][a-z0-9_]*)";

/**
 * Analyse one source file for the unprotected read-then-write shape.
 *
 * @returns one finding per table read and then written with no protection.
 */
export function analyzeWriteShape(source: string): WriteShapeFinding[] {
  const selected = new Set<string>();
  const written = new Map<string, string>(); // table → the statement that wrote it

  for (const raw of literals(stripComments(source))) {
    const sql = raw.replace(/\s+/g, " ");
    const protectedRead = /\bFOR UPDATE\b/i.test(sql);
    const protectedWrite = /\bON CONFLICT\b/i.test(sql);

    if (!protectedRead) {
      for (const m of sql.matchAll(new RegExp(`\\bFROM\\s+${IDENT}`, "gi"))) selected.add(m[1]!);
      for (const m of sql.matchAll(new RegExp(`\\bJOIN\\s+${IDENT}`, "gi"))) selected.add(m[1]!);
    }
    if (!protectedWrite) {
      for (const m of sql.matchAll(new RegExp(`\\bINSERT\\s+INTO\\s+${IDENT}`, "gi"))) {
        written.set(m[1]!, sql);
      }
      for (const m of sql.matchAll(new RegExp(`\\bUPDATE\\s+${IDENT}\\s+SET`, "gi"))) {
        written.set(m[1]!, sql);
      }
    }
  }

  const findings: WriteShapeFinding[] = [];
  for (const [table, statement] of written) {
    if (!selected.has(table)) continue;
    findings.push({
      table,
      reason:
        `reads ${table} and then writes it with no ON CONFLICT and no FOR UPDATE — the ` +
        `read-then-write shape 043 §3.2 forbids. Under CONCURRENT duplicate delivery both ` +
        `workers pass the check and both write. Make the write idempotent by a constraint ` +
        `(ON CONFLICT on a unique index) or take the row lock on the read. Statement: ` +
        statement.slice(0, 160),
    });
  }
  return findings;
}
