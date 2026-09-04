// Contract — 043 §11 I2, I6 and I11, in their static half.
//
// Three separate promises about the two new tables, all checkable without a
// database because all three are about what the DECLARED lists and the migration
// say:
//
//   I2  both tables are on the append-only list, on NEITHER exemption list, and
//       on the replay-drill EXCLUSION list with a reason naming 043 §2.6's two
//       grounds. "An absence is indistinguishable from an oversight."
//   I6  no values and no operator prose reach either table.
//   I11 there is no mutable state anywhere in the drain — no status column, no
//       claimed_at, no lease, no UPDATE path.
//
// The behavioural halves (a trigger that actually refuses an UPDATE, a lease
// that actually expires) are the integration lane's; these are the ones that
// fail at merge time rather than at deploy time.
//
// Bead: longbox-e5b.2.17 (E02-D07). Docs: 043 §2.3, §2.4, §2.5, §2.6, §6.4, §11.
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  APPEND_ONLY_EXEMPTIONS,
  APPEND_ONLY_TABLES,
  APPEND_ONLY_TABLE_NAMES,
  REPLAY_DRILL_EXCLUSIONS,
  REPLAY_DRILL_EXCLUDED_TABLE_NAMES,
  REPLAY_DRILL_INCLUDED_DERIVATIONS,
} from "../../src/db/appendOnlyTables.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const migration = readFileSync(path.join(root, "migrations", "011_outbox.sql"), "utf8");
const outboxSrc = readFileSync(path.join(root, "src", "services", "outbox.ts"), "utf8");
const OUTBOX_TABLES = ["outbox", "outbox_attempt"] as const;

/**
 * The route files this file sweeps — from git's INDEX, never from a live `readdirSync`.
 *
 * WHY THE ENUMERATION MOVED (E02-D14). `tests/contract/architecture-gate.test.ts`
 * proves the Architecture gate can fail the only way a gate can be proven to
 * fail: it WRITES `src/routes/__arch_fixture_violation__.ts` into the real tree,
 * runs depcruise, and deletes it in a `finally`. Vitest runs test FILES in
 * parallel workers, and a `describe` body is evaluated when its file is
 * collected — so that write window overlapped this file's collection. A
 * `readdirSync` here saw two route files on some runs and three on others, which
 * made `it.each` emit 18 or 19 cases and the whole suite report 1049 or 1050 on
 * a byte-identical tree. Every run passed, which is what made it a lie rather
 * than a failure: a case count that moves on its own cannot be read as evidence
 * that a case ran.
 *
 * `git ls-files` reads the index, so it is deterministic under any concurrent
 * UNTRACKED write, and it is not a narrower sweep: a brand-new route is in the
 * index the moment it is staged, which is exactly when husky's pre-commit lane
 * and CI both see it. Nothing that can reach a commit escapes this. Same
 * mechanism, same reason, as `tests/contract/secret-fixture-convention.test.ts`.
 *
 * Sorted because `ls-files` order is git's, and an assertion whose ORDER is
 * borrowed from a tool is one upgrade away from a diff nobody asked for.
 *
 * REPO-RELATIVE, and deliberately NOT basenamed. `ls-files` recurses, so the day
 * someone adds `src/routes/admin/x.ts` a basename would read `x.ts` from the
 * wrong directory and this file would ENOENT instead of sweeping the new route.
 * The path git hands back is the path that opens.
 */
const routeFiles = execFileSync("git", ["ls-files", "-z", "--", "src/routes"], {
  cwd: root,
  encoding: "utf8",
})
  .split("\0")
  .filter((f) => f.endsWith(".ts"))
  .sort();

/**
 * The migration with its `--` comment lines removed.
 *
 * A negative assertion over a heavily commented file would be asserting that
 * nobody EXPLAINED the thing, which is the opposite of what these invariants
 * want: 011's header argues at length that `payload_hash` is struck and that
 * there is no reaper, and a test that failed on the argument would push the next
 * author to delete the reasoning to get a green build. The assertion is about
 * the SQL.
 */
const sql = migration.replace(/^\s*--.*$/gm, "");

/**
 * The migration with its `COMMENT ON …` statements removed as well.
 *
 * `COMMENT ON` bodies are documentation that happens to be SQL, and 011 uses
 * them heavily — the column comment for the unique constraint explains, in the
 * database itself, why `payload_hash` was struck. A negative assertion that
 * counted those would be a rule against explaining the schema at the schema,
 * which is the one place a future reader is guaranteed to look.
 */
const ddlOnly = sql.replace(/COMMENT ON [\s\S]*?;\n/g, "");

describe("I2 — both tables are declared append-only, and declared out of the replay drill", () => {
  it.each(OUTBOX_TABLES)("%s is on the append-only trigger list with its trigger name", (table) => {
    const row = APPEND_ONLY_TABLES.find((t) => t.table === table);
    expect(row, `${table} must be declared in src/db/appendOnlyTables.ts`).toBeDefined();
    expect(row!.trigger).toBe(`${table}_append_only`);
    expect(row!.since).toBe("011_outbox.sql");
    // 041 §2.5: only a table recording ANOTHER system's fact may order its
    // derivation by observed_at. An outbox row is Longbox's own record of intent.
    expect(row!.ordersByObservedAt).toBe(false);
  });

  it.each(OUTBOX_TABLES)("%s is on NEITHER exemption list", (table) => {
    expect(APPEND_ONLY_EXEMPTIONS.map((e) => e.table)).not.toContain(table);
  });

  it("the migration creates the triggers AND promotes them to ENABLE ALWAYS in the same loop", () => {
    // `CREATE TRIGGER` always lands at tgenabled='O', which one
    // `SET session_replication_role='replica'` turns off for the session (006
    // reproduces it). A new append-only table created at the default would be
    // governed by a trigger anyone could step around.
    expect(migration).toContain("EXECUTE FUNCTION forbid_mutation()");
    expect(migration).toContain("ENABLE ALWAYS TRIGGER");
    expect(migration).toContain("BEFORE UPDATE OR DELETE");
  });

  it.each(OUTBOX_TABLES)("%s is excluded from the replay drill BY A ROW, with BOTH reasons", (table) => {
    // 043 §6.4: the drill's whole point is that a derivation nobody replays is
    // not a derivation, so a table sitting outside it with no row saying why is
    // indistinguishable from a table someone forgot.
    const row = REPLAY_DRILL_EXCLUSIONS.find((e) => e.table === table);
    expect(row, `${table} must carry a declared replay-drill exclusion`).toBeDefined();
    // A8 (Q3): the two grounds are KEPT and declared INDEPENDENT — reason 2
    // suffices today; reason 1 is what remains if the attempt→outbox FK ever
    // changes shape. A record that keeps only the currently-decisive reason has
    // to re-derive the other one the day the structure moves.
    expect(row!.reasons).toHaveLength(2);
    for (const reason of row!.reasons) expect(reason.length).toBeGreaterThan(60);
    expect(row!.since).toContain("043");
  });

  it("the dead-letter VIEW is inside the drill, because it is an ordinary derivation", () => {
    expect(REPLAY_DRILL_INCLUDED_DERIVATIONS).toContain("outbox_dead_letter");
    expect(REPLAY_DRILL_EXCLUDED_TABLE_NAMES).not.toContain("outbox_dead_letter");
  });
});

describe("I11 — there is no mutable state anywhere in the drain (043 §2.4)", () => {
  it("neither table declares a status, claimed_at, lease or next_attempt column", () => {
    // THIS IS THE ASSERTION THAT FAILS FIRST IF SOMEBODY ADDS THE COLUMN UNDER
    // LOAD. 043 §2.4's escape hatch is a materialized index over the log
    // (041 §6.2's first form, keys only, maintained in the same transaction),
    // never a status column: a status column beside a complete attempt log is
    // 040's scan_session.status with a different name.
    // Only the two CREATE TABLE bodies: the surrounding prose says "there is no
    // status column" in several places, and a check that counted those would be
    // failing on the explanation rather than on the schema.
    const bodies = [
      ...ddlOnly.matchAll(/CREATE TABLE IF NOT EXISTS (outbox|outbox_attempt) \(([\s\S]*?)\n\);/g),
    ];
    expect(bodies.map((m) => m[1])).toEqual(["outbox", "outbox_attempt"]);
    for (const [, table, body] of bodies) {
      for (const banned of ["status", "claimed_at", "locked_at", "lease_until", "next_attempt_at"]) {
        expect(body!.toLowerCase(), `${table} must not declare a ${banned} column`).not.toContain(banned);
      }
    }
  });

  it("no source file issues an UPDATE or a DELETE against either table", () => {
    for (const table of OUTBOX_TABLES) {
      expect(outboxSrc).not.toMatch(new RegExp(`UPDATE\\s+${table}\\s+SET`, "i"));
      expect(outboxSrc).not.toMatch(new RegExp(`DELETE\\s+FROM\\s+${table}`, "i"));
    }
  });

  it("the migration adds no reaper, sweeper or repair job", () => {
    // A stale claim is not corrupt state that something must clean up; it is a
    // fact about the past that stops satisfying a predicate about the present.
    // Nothing has to notice and nothing has to run.
    expect(ddlOnly.toLowerCase()).not.toMatch(/\breap|\bsweep|\bcron\b/);
  });
});

describe("I6 — an outbox row carries no values and no operator prose (043 §2.5)", () => {
  it("the outbox table declares exactly 043 §2.3's columns — no payload, no hash", () => {
    const ddl = sql.slice(
      sql.indexOf("CREATE TABLE IF NOT EXISTS outbox ("),
      sql.indexOf("COMMENT ON TABLE outbox IS")
    );
    const columns = [...ddl.matchAll(/^\s{2}([a-z_]+)\s+[a-z]/gm)].map((m) => m[1]!);
    expect(columns.sort()).toEqual(
      [
        "actor_role",
        "actor_verified",
        "authored_by",
        "correlation_id",
        "created_at",
        "definition_version",
        "event",
        "id",
        "occurred_at",
        "operator_id",
        "ref_id",
        "ref_table",
        "scan_session_id",
        "session_seq",
        "shop_id",
      ].sort()
    );
    // 043 A6: STRUCK. `UNIQUE (shop_id, event, ref_table, ref_id)` already makes
    // the case it existed for unconstructible, and "a column that exists to
    // catch a case the schema already makes impossible … is a place a future
    // engineer will eventually repurpose."
    expect(ddlOnly).not.toContain("payload_hash");
    expect(ddl).toContain("UNIQUE (shop_id, event, ref_table, ref_id)");
  });

  it("outbox_attempt.detail is bounded by a declared allowlist rather than by a convention", () => {
    expect(outboxSrc).toContain("ATTEMPT_DETAIL_KEYS");
    expect(outboxSrc).toContain("assertAttemptDetail");
    // The one place a provider's prose could enter is the caught exception, and
    // the runtime records its CLASS.
    expect(outboxSrc).toContain("err.constructor.name");
    expect(outboxSrc).not.toMatch(/error_message|err\.message.*detail/);
  });

  it("the migration's own comment states the rule, so the next writer meets it at the column", () => {
    const detailComment = migration.slice(migration.indexOf("COMMENT ON COLUMN outbox_attempt.detail"));
    expect(detailComment).toContain("NEVER a response body");
    expect(detailComment).toContain("019 T35");
  });
});

describe("the synchronous Shopify call does not come back into the route (043 §4.1)", () => {
  // WHY THIS ASSERTION EXISTS AND NOTHING ELSE WOULD CATCH IT.
  // `src/routes/scanSessions.ts` is a BY-NAME exemption on
  // `providers-are-contained` in `.dependency-cruiser.cjs` (kind=defect, closing
  // bead E02-D08), because it still imports `providers/registry.js` for the
  // identify and price paths. That exemption is exactly wide enough to let a
  // future edit re-add `createShopifyClient` to this file and pass the
  // Architecture gate — the rule would see an import it has already been told to
  // ignore.
  //
  // So the thing E02-D07 actually removed — the provider call executing inside
  // the request, outside and before the transaction that records it (043 §1 E4's
  // orphaned-draft window) — has no structural guard at all. This is it: a
  // by-name check for the two symbols that would bring it back.
  it("finds route files to scan — an empty sweep is not a pass", () => {
    expect(routeFiles).toContain("src/routes/scanSessions.ts");
  });

  it.each(routeFiles)("%s neither calls createDraft nor imports the Shopify service", (file) => {
    const src = readFileSync(path.join(root, file), "utf8");
    // Comments are stripped: the route's own prose explains at length what it no
    // longer does, and a guard that punished the explanation would push the next
    // author to delete it.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, " ");
    expect(
      code,
      `${file} calls createDraft. The Shopify mutation belongs to the draft_requested ` +
        `consumer (043 §4.1): a provider call in a request handler cannot join the ` +
        `transaction that records it, which is the orphaned-draft window 043 §1 E4 names.`
    ).not.toMatch(/\bcreateDraft\b/);
    expect(
      code,
      `${file} imports the Shopify service. Routes reach channels through a job, not ` +
        `directly — and depcruise cannot catch this one, because this file is a by-name ` +
        `exemption on providers-are-contained (E02-D08).`
    ).not.toMatch(/services\/shopify/);
  });
});

describe("the app role's privileges follow from the declaration, with no third list", () => {
  it("both tables classify as append-only, so the grant step gives SELECT + INSERT only", () => {
    // `src/db/appRoleGrants.ts` refuses to grant anything to a live table that
    // neither declared list names, so this is also the assertion that a
    // `pnpm migrate` will not fail loudly at the grant step.
    for (const table of OUTBOX_TABLES) expect(APPEND_ONLY_TABLE_NAMES).toContain(table);
  });
});

describe("this file reports a fixed number of cases on an identical tree (E02-D14)", () => {
  /**
   * The number of cases `pnpm test` must attribute to THIS FILE, every run.
   *
   * Pinned to a literal, and the number it is compared against is DERIVED FROM
   * THIS FILE'S OWN SOURCE TEXT rather than from hand-maintained constants. The
   * first version of this guard added up two constants a human had to remember
   * to bump, which meant a new `it()` anywhere above made the file report one
   * more case and this assertion still pass — the guard failed on exactly the
   * change it exists to catch.
   */
  const DECLARED_CASES = 19;

  /**
   * The arrays this file is allowed to parameterise over, by the identifier the
   * `it.each` call site names. An `it.each` over anything not listed here fails
   * the count LOUDLY rather than being silently miscounted as one case.
   */
  const EACH_SOURCES: Readonly<Record<string, readonly unknown[]>> = { OUTBOX_TABLES, routeFiles };

  /**
   * This file's case count, read off this file.
   *
   * Comments are stripped first, for the reason every other scan in this file
   * strips them: a commented-out `it(` is not a case, and prose that mentions
   * one is not a case either.
   */
  function ownCaseCount(): number {
    const own = readFileSync(fileURLToPath(import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/^[ \t]*\/\/.*$/gm, " ");
    // Every `it` call site that opens a line, however it is written…
    const sites = [...own.matchAll(/^\s*it\s*[.(]/gm)].length;
    // …split into the two forms this file uses.
    const plain = [...own.matchAll(/^\s*it\(/gm)].length;
    const each = [...own.matchAll(/^\s*it\.each\(([A-Za-z_$][\w$]*)\)\(/gm)];
    // FAIL CLOSED. If a third form appears — `it.each` over an inline array, an
    // `it.skip`, a call site this parse does not recognise — the two counts
    // disagree and this throws, rather than quietly under-counting and leaving
    // DECLARED_CASES looking correct.
    if (plain + each.length !== sites) {
      throw new Error(
        `${sites - plain - each.length} \`it\` call site(s) in this file are written in a form ` +
          `the case count cannot read. Add the form to ownCaseCount() — a count that skips a ` +
          `case it does not understand is the drift this guard exists to catch (E02-D14).`
      );
    }
    let total = plain;
    for (const [, name] of each) {
      const rows = EACH_SOURCES[name!];
      if (rows === undefined) {
        throw new Error(
          `it.each(${name}) parameterises over an array ownCaseCount() does not know. Add it to ` +
            `EACH_SOURCES so its rows are counted (E02-D14).`
        );
      }
      total += rows.length;
    }
    return total;
  }

  it("counts its own cases from its own source, so ANY drift fails the literal", () => {
    // A green suite whose case count moves between runs is not evidence: it says
    // some case ran somewhere, not that THIS case ran. So the count is asserted
    // rather than observed — and asserted against something derived, so that a
    // new `it()`, a new route file, and a re-broken enumeration all land here.
    expect(
      ownCaseCount(),
      "This file's case count no longer matches DECLARED_CASES. If you deliberately added a " +
        "case — a new test, or a new file under src/routes — bump the literal. If you did NOT, " +
        "the enumeration has gone unstable again: `routeFiles` must come from git's index, " +
        "never from a live readdir of a tree another suite writes fixtures into (E02-D14)."
    ).toBe(DECLARED_CASES);
  });
});
