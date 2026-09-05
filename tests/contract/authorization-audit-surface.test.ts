// L2 contract: **the actor audit is a decision record and never becomes a
// per-operator surface** (022 P3, 019 T35, non-waivable).
//
// Bead: longbox-e5b.3.3 (alias E03-B03). Docs: 054 §4; 022 P3; 019 T35(a);
// 034 §3.3; 041 §9.2.
//
// 022 P3's CFO constraint is the sentence this file enforces: *"the cheapest way
// to satisfy T35 is never to build a per-operator surface, and no such surface
// may be built and then restricted."* A table that records who was allowed to do
// what is one column and one route away from being exactly that surface — so the
// column list is CLOSED here, in a test, and the absence of a route is asserted
// rather than assumed.
//
// Every assertion below is a specific way the table could turn into surveillance,
// written down so that the day somebody needs one of them, they have to argue
// with a named line instead of adding a field.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { APPEND_ONLY_TABLES, APPEND_ONLY_EXEMPTIONS } from "../../src/db/appendOnlyTables.js";
import { ROUTES } from "../../src/contracts/v1/routes.js";

const repoRoot = join(import.meta.dirname, "..", "..");
const migration = readFileSync(join(repoRoot, "migrations", "028_authorization_decision.sql"), "utf8");

/** The `CREATE TABLE authorization_decision ( … );` body, comments removed. */
function tableBody(): string {
  const start = migration.indexOf("CREATE TABLE IF NOT EXISTS authorization_decision");
  expect(start, "the table is gone or renamed").toBeGreaterThan(-1);
  const end = migration.indexOf("\n);", start);
  return migration.slice(start, end).replace(/--[^\n]*/g, "");
}

describe("the column list is CLOSED (054 §4.2)", () => {
  it("declares exactly these columns and no others", () => {
    const body = tableBody();
    // Anchored on the TYPE, not on whitespace: column alignment is cosmetic and
    // the longest name has one space after it, which a whitespace-counting
    // matcher silently skipped — a checker with a blind spot, on the test whose
    // whole job is a closed list.
    const declared = [...body.matchAll(/^\s{2}([a-z_]+)\s+(?:uuid|text|timestamptz)\b/gm)].map((m) => m[1]!);
    expect(declared.sort()).toEqual(
      [
        "decided_at",
        "decision",
        "id",
        // K2: the semver names a code CONSTANT; the commit names bytes. Two
        // deployments can both say `1.0.0` while one carries an edit nobody
        // bumped.
        "matrix_commit",
        "matrix_version",
        "membership_id",
        "permission",
        "refusal_reason",
        "role",
        "route_method",
        "route_path",
        "session_chain_id",
        "shop_id",
      ].sort()
    );
    // F10: `authored_by` is ABSENT and the absence is a decision. 041 §2.3's
    // envelope records WHICH KIND of actor produced a witness row; every row
    // here is written by one rule in one function, so the column could only hold
    // `'system'` — and a column with one possible value teaches a reader nothing
    // while inviting a second writer to set it to something else.
    expect(declared).not.toContain("authored_by");
  });

  it("carries NO column that would make a row joinable to a person or to an item", () => {
    // Each name here is a real proposal somebody will make, and the reason it is
    // refused is in 054 §4.2:
    //   app_user_id / display_name — the person is one join away THROUGH the
    //     membership, and that join is what 034 §3.3's accessor gates;
    //   scan_session_id — joins the decision to the book, which turns "who was
    //     allowed" into "what they did to this item";
    //   correlation_id — joins it to the request, and thereby to everything else
    //     the request touched;
    //   ip_address / user_agent — a request log, and 042 §8.1 already refuses the
    //     IP as a rate key for the same reason it is useless here;
    //   duration_ms / count — measurement of a person, which is P3's whole subject.
    const body = tableBody();
    for (const forbidden of [
      "app_user_id",
      "display_name",
      "operator_id",
      "created_by",
      "confirmed_by",
      "scan_session_id",
      "correlation_id",
      "ip_address",
      "user_agent",
      "duration_ms",
      "count",
    ]) {
      expect(body, `authorization_decision must not carry ${forbidden} (022 P3, 054 §4.2)`).not.toContain(
        forbidden
      );
    }
  });

  it("carries NO dedup key, so a replay can never be collapsed into the first decision (059 §4)", () => {
    // E03-D15's ruling, as four refused names. A replayed `Idempotency-Key` is a
    // SECOND AUTHORIZATION — the hook re-read the grants and answered again — so
    // there is nothing to deduplicate, and the column that would deduplicate it
    // is refused twice over:
    //
    //   idempotency_key — a JOIN KEY. `request_idempotency` is keyed
    //     `(shop_id, idempotency_key)` and holds the route, the request hash and
    //     the stored RESPONSE BODY, whose payload for `POST …/scan-sessions` is
    //     the session id — the book. That is the join 054 §4.2 refuses
    //     `correlation_id` by name for, under a different name and chosen by the
    //     client rather than by the server. A digest of it is no better: the
    //     plaintext sits in the other table, so the digest is computable;
    //   request_id / effect_id — the same object under names a future author
    //     would not think to check against 054 §4.2's list;
    //   attempt_no — needs a read of `request_idempotency` at `onRequest` (a
    //     round trip on the hot path), is WRONG exactly under concurrency (the
    //     first attempt's row is invisible until commit, so two concurrent
    //     attempts both record 1), and is a COUNT on a table that refuses
    //     `count` and `duration_ms` by name.
    const body = tableBody();
    for (const forbidden of ["idempotency_key", "request_id", "attempt_no", "effect_id"]) {
      expect(body, `authorization_decision must not carry ${forbidden} (059 §4)`).not.toContain(forbidden);
    }
  });

  it("indexes the ONE access path it has, and neither of the two per-person ones", () => {
    // F1 / S6, and the finding is worth the length. The first version of this
    // migration carried `authorization_decision_chain_idx` and justified it as
    // serving 019 T35(c) — which was FALSE: the reconciliation runs
    // `app_session` → `membership` and touches this table not at all. What the
    // index actually bought was a fast "everything this person did on this phone
    // that day", which is the covert timeclock 022 P3 forbids, sitting inside a
    // table whose own record argued it was not a per-operator surface.
    //
    // Both per-person indexes are now refused BY NAME: the chain and the grant.
    // Every such join still works — a sequential scan is the right cost for a
    // scheduled job and the wrong cost for a casual question.
    expect(migration).toContain("authorization_decision_shop_time_idx");
    expect(migration).not.toMatch(/CREATE INDEX[^;]*authorization_decision \(session_chain_id/);
    expect(migration).not.toMatch(/CREATE INDEX[^;]*authorization_decision \(membership_id/);
    // And exactly one index is created, so a third cannot arrive unnoticed.
    const created = [...migration.matchAll(/CREATE INDEX[^;]*ON authorization_decision/g)];
    expect(created).toHaveLength(1);
  });
});

describe("a replay is a SECOND authorization, and nothing collapses it (059, E03-D15)", () => {
  // 054 §4.5 accepted the N:1 decisions-to-effects ratio as a documented property
  // and handed the trade to this bead. 059 rules that there is nothing to
  // remove: the hook re-reads the grants on a replayed `Idempotency-Key` and
  // answers again, so the second authorization HAPPENED (041 §2.1), and it can
  // differ from the first — a grant revoked, a role changed mid-handover, a
  // break-glass window closed between two attempts. A `UNIQUE` with
  // `ON CONFLICT DO NOTHING` would discard exactly that row, and after a
  // rolled-back first attempt (042 §5.3 step 4) it would keep the decision of the
  // request that did NOTHING and drop the decision of the one that did the work.
  //
  // The ruling is therefore three absences, and they are checked here rather than
  // argued in prose, because an absence defended only by a record drifts.

  it("has no UNIQUE constraint and no unique index, in ANY migration — the 1:1 shape cannot arrive quietly", () => {
    // Comments stripped first: 028's prose says `session_chain_id` is
    // "deliberately not unique", and a matcher that read that would be asserting
    // against an explanation rather than against DDL.
    const ddl = migration.replace(/--[^\n]*/g, "");
    expect(ddl).not.toMatch(/\bUNIQUE\b/i);
    expect(ddl).not.toMatch(/CREATE\s+UNIQUE\s+INDEX/i);

    // ⚠ **AND THE SCAN IS REPO-WIDE, because the claim was.** The first version
    // of this case read `migrations/028` alone while the invariant beside it said
    // the 1:1 shape "cannot arrive without an amendment here" — which a LATER
    // migration could have done in one line (gate audit, B4). A constraint added
    // by `033_…` is exactly as much of an amendment as one added by 028.
    for (const file of readdirSync(join(repoRoot, "migrations")).filter((f) => f.endsWith(".sql"))) {
      const sql = readFileSync(join(repoRoot, "migrations", file), "utf8").replace(/--[^\n]*/g, "");
      expect(sql, `${file} creates a unique index on the audit table (059 §5)`).not.toMatch(
        /CREATE\s+UNIQUE\s+INDEX[^;]*\bON\s+authorization_decision\b/i
      );
      for (const statement of sql.split(";")) {
        if (!/ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?authorization_decision\b/i.test(statement)) continue;
        // An ALTER is not forbidden — E03-B09's retention work may need one. What
        // is forbidden is an ALTER that adds the constraint this record refuses.
        expect(statement, `${file} adds a UNIQUE to the audit table (059 §5)`).not.toMatch(/\bUNIQUE\b/i);
      }
    }
  });

  it("has a writer with no ON CONFLICT clause", () => {
    // The cheapest form of the rejected option needs no schema move at all —
    // `ON CONFLICT DO NOTHING` on the pooled write — which is why the absence is
    // asserted on the WRITER and not only on the table (059 §5, §6.1c).
    const writer = readFileSync(join(repoRoot, "src", "services", "auth", "authorizationAudit.ts"), "utf8");
    // Comments FIRST, because this module now DISCUSSES `ON CONFLICT` at length —
    // and a checker that counted prose would teach the next author to stop
    // explaining themselves, which is the lesson the `authorize(` scan already
    // learned one describe block down.
    const code = stripComments(writer);
    expect(code).toContain("INSERT INTO authorization_decision");
    expect(code).not.toMatch(/ON\s+CONFLICT/i);

    // ⚠ **AND THE SAME QUESTION ASKED WITHOUT `stripComments`, because that
    // helper is a NAIVE regex** (invariant review, delta b). It deletes from `//`
    // to end-of-line anywhere it appears, INCLUDING inside a SQL template — so a
    // URL or a `--`-style comment carrying a `//` would truncate the very line an
    // `ON CONFLICT` might sit on, and this assertion would pass by having deleted
    // its own evidence. So the second mechanism reads the RAW source and looks
    // only at TEMPLATE LITERALS that mention the table: the SQL as written,
    // comment-stripping never applied. Two checks with different blind spots,
    // which is the same posture §5's type-plus-regex takes one file over.
    const sqlTemplates = [...writer.matchAll(/`[^`]*`/g)]
      .map((m) => m[0])
      .filter((t) => t.includes("authorization_decision"));
    expect(sqlTemplates.length, "no SQL template names the table — the scan is vacuous").toBeGreaterThan(0);
    for (const template of sqlTemplates) {
      expect(template, "a SQL template on the audit table carries ON CONFLICT (059 §5)").not.toMatch(
        /ON\s+CONFLICT/i
      );
    }
  });

  it("is not read through a view, in any migration, ordinary or materialized", () => {
    // Option B was a view that collapses replays. It would need either the
    // forbidden key column or a fuzzy grouping over grant, route and time — and
    // 042 §5.4 refuses fuzzy comparison by name for the neighbouring mechanism.
    // A read model that GUESSES which rows are the same act is worse than a
    // documented ratio, because the guess arrives wearing a view's name.
    for (const file of readdirSync(join(repoRoot, "migrations")).filter((f) => f.endsWith(".sql"))) {
      const sql = readFileSync(join(repoRoot, "migrations", file), "utf8").replace(/--[^\n]*/g, "");
      for (const statement of sql.split(";")) {
        if (!/\bCREATE\b/i.test(statement) || !/\bVIEW\b/i.test(statement)) continue;
        expect(statement, `${file} defines a view over the audit table (059 §5)`).not.toContain(
          "authorization_decision"
        );
      }
    }
  });

  it("gives its one counting reader a field named for what it counts", () => {
    // 059 §7: the K4 companion's header used to say the result was "enough to say
    // 'this session was allowed two privileged acts'" — the exact noun 054 §4.5
    // withdrew, since two rows may be one act replayed. A count of rows is a
    // count of AUTHORIZATIONS. The field name is where a caller reads that, so
    // the field name is where it is pinned.
    // ⚠ **THE WALK SPANS `src/` AND `scripts/`, and it did not have to wait for a
    // consumer to exist** (invariant review, delta a). E03-D14's branch lands
    // `scripts/breakGlassAudit.ts` and `scripts/audit-break-glass.ts` — the first
    // reader that prints this number TO A HUMAN, which is precisely where the
    // wrong noun does its damage. A pin scoped to `src/` would have gone on
    // passing while a CLI said "acts" on somebody's terminal.
    const trees = ["src", "scripts"];
    const readers = trees
      .flatMap((tree) => walk(join(repoRoot, tree)))
      .filter((p) => p.endsWith(".ts"))
      .filter((p) => /FROM\s+authorization_decision/i.test(readFileSync(p, "utf8")));

    // The EQUALITY is scoped to `src/` on purpose and the two halves are
    // different claims. "The identity module is the only reader inside the
    // application" is a property this record relies on (054 §4.4's writer rule,
    // one direction over). "No reader anywhere says acts" is the vocabulary rule,
    // and it must hold for a tree that is about to grow readers — so an equality
    // over both trees would be a merge landmine dressed as an invariant.
    expect(
      readers.filter((p) => p.startsWith(join(repoRoot, "src"))).map((p) => p.slice(repoRoot.length + 1))
    ).toEqual(["src/services/auth/authorizationAudit.ts"]);
    expect(readers.length, "no file reads the audit table — the vocabulary scan is vacuous").toBeGreaterThan(
      0
    );

    for (const path of readers) {
      const source = readFileSync(path, "utf8");
      // No projection, alias or returned field may call these rows acts, effects
      // or requests — the three nouns a report author reaches for. `pnpm arch`
      // rule 3d refuses the TYPE; this is the belt over the source text, and the
      // two have different blind spots (059 §5).
      expect(stripComments(source), `${path} names a count acts/effects/requests`).not.toMatch(
        /\b(acts|effects|requests)\s*[:=]/
      );
      expect(stripComments(source), `${path} aliases a count acts/effects/requests`).not.toMatch(
        /\bAS\s+(acts|effects|requests)\b/i
      );
    }

    // And the one reader that COUNTS names its projection for what it counts.
    const counter = readFileSync(join(repoRoot, "src", "services", "auth", "authorizationAudit.ts"), "utf8");
    expect(counter).toMatch(/count\(\*\)::int AS decisions/);
    expect(counter).toMatch(/interface AuthorizationDecisionCount/);
  });
});

describe("it is append-only and the app role can only append to it", () => {
  it("is a DECLARED append-only table, so the grant step gives it SELECT, INSERT", () => {
    const row = APPEND_ONLY_TABLES.find((t) => t.table === "authorization_decision");
    expect(row, "authorization_decision is not declared in appendOnlyTables.ts").toBeDefined();
    expect(row!.trigger).toBe("authorization_decision_append_only");
    expect(row!.since).toBe("028_authorization_decision.sql");
    // Not lockable, not observed externally, not session-scoped — three
    // properties a reader would otherwise have to infer.
    expect(row!.ordersByObservedAt).toBe(false);
    expect(row!.sessionSeq).toBe(false);
    expect(
      APPEND_ONLY_EXEMPTIONS.some((e) => e.table === "authorization_decision"),
      "it must not be BOTH declared and exempt"
    ).toBe(false);
  });

  it("creates the trigger and sets it to ENABLE ALWAYS in the same statement block", () => {
    // 041 §9.2 item 1: `CREATE TRIGGER` lands at the bypassable 'O' default, so
    // the pairing is the control. The integration lane asserts it against
    // `pg_trigger`; this asserts the migration cannot land without it.
    expect(migration).toContain("forbid_mutation()");
    expect(migration).toContain("ENABLE ALWAYS TRIGGER");
  });
});

describe("it has ONE writer and NO reader on the wire (054 §4.4)", () => {
  const sources = walk(join(repoRoot, "src")).filter((p) => p.endsWith(".ts"));

  it("is inserted into by exactly one module", () => {
    const writers = sources
      .filter((p) => /INSERT\s+INTO\s+authorization_decision/i.test(readFileSync(p, "utf8")))
      .map((p) => p.slice(repoRoot.length + 1));
    expect(writers).toEqual(["src/services/auth/authorizationAudit.ts"]);
  });

  it("is named by no route, no response DTO and no generated document", () => {
    // The negative that matters most: 019 T35 is about RENDERING. A table nobody
    // can reach over HTTP cannot render a per-operator anything, whatever a
    // future report would like to do with it.
    // Comments are stripped first, for the reason the `authorize(` scan in
    // `permission-enforcement.test.ts` learned: the contract layer DISCUSSES this
    // table in prose (the role enum is its `CHECK`, and the rank decides which
    // grant a row names), and a checker that counted prose would teach the next
    // author to stop explaining themselves — the opposite of what these files want.
    for (const path of sources.filter((p) => p.includes("/src/routes/") || p.includes("/src/contracts/"))) {
      expect(stripComments(readFileSync(path, "utf8")), `${path} names the audit table`).not.toContain(
        "authorization_decision"
      );
    }
    const openapi = readFileSync(join(repoRoot, "contracts", "openapi.v1.json"), "utf8");
    expect(openapi).not.toContain("authorization_decision");
    expect(openapi).not.toContain("matrix_version");
    // And no route accepts a permission, a role or a membership as a parameter —
    // 019 T35(a)'s "no filter, sort or grouping parameter", applied to the
    // dimensions this table introduces.
    for (const route of ROUTES) {
      expect(route.path).not.toMatch(/:membershipId|:role|:permission/);
    }
  });
});

/** `//` and block comments removed, so a mention in prose is not a reference. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, "");
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}
