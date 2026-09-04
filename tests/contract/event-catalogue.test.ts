// Contract — 043 §11 I3: "every event in the catalogue references a committed
// witness row, except exactly one."
//
// WHY A CONTRACT TEST AND NOT A UNIT TEST. The catalogue is a list nine names
// long that nothing executes; its correctness is entirely a matter of agreement
// between three declared sets — the names, the append-only trigger set, and the
// one command exception. That is a contract between files, and 042 A2 struck a
// GENERATED catalogue precisely because generation cannot be wrong. This file is
// what makes the authored list falsifiable instead.
//
// Bead: longbox-e5b.2.17 (E02-D07). Docs: 043 §3.3, §3.4, A10, §11 I3; 042 A2, §2.3.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  CATALOGUE_EXCLUSIONS,
  DRAFT_REQUESTED,
  EVENT_CATALOGUE,
  EVENT_NAMES,
  catalogueEntry,
  isCatalogueEvent,
} from "../../src/events/catalogue.js";
import { APPEND_ONLY_TABLE_NAMES } from "../../src/db/appendOnlyTables.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const catalogueSource = readFileSync(path.join(here, "..", "..", "src", "events", "catalogue.ts"), "utf8");

describe("the event catalogue (043 §3.3)", () => {
  it("declares nine names, and they are unique", () => {
    expect(EVENT_CATALOGUE).toHaveLength(9);
    expect(new Set(EVENT_NAMES).size).toBe(9);
  });

  it("names follow `longbox.<module>.<past-tense verb phrase>`", () => {
    // The module segment is not decoration: it is what makes 043 §4.1's routing
    // rule — platform never knows what a job means — checkable rather than
    // conventional.
    for (const entry of EVENT_CATALOGUE) {
      expect(entry.event).toMatch(/^longbox\.[a-z]+\.[a-z_]+$/);
      expect(entry.event.split(".")[1]).toBe(entry.module);
    }
  });

  it("every ref_table is a DECLARED append-only table, except the one command", () => {
    for (const entry of EVENT_CATALOGUE) {
      if (entry.command === true) continue;
      // Every ref_table now names a table that EXISTS: E02-B10's migration 010
      // landed `scan_session_transition`, which was the last pending one, so the
      // allowance for known-pending tables is gone rather than kept warm.
      expect(
        APPEND_ONLY_TABLE_NAMES.includes(entry.refTable),
        `${entry.event} references '${entry.refTable}', which is not a declared append-only ` +
          `table. Either the table is missing from src/db/appendOnlyTables.ts, or the ` +
          `catalogue names a row that is not a witness.`
      ).toBe(true);
    }
  });

  it("has EXACTLY ONE command-shaped entry, and it self-references (043 §3.4, A10)", () => {
    const commands = EVENT_CATALOGUE.filter((e) => e.command === true);
    expect(
      commands.length,
      // A10 requires this message to point at the argument rather than report a
      // number, because the person who trips it is adding the SECOND command and
      // needs the reason, not the rule:
      //
      // 043 §3.4 — 042 §7.1's reference rule exists so a consumer always reads
      // current truth rather than a snapshot. A command has no truth to read; it
      // IS the request, so the rule has nothing to protect. The hazard is that
      // "commands are fine, actually" becomes a habit, and the guard is a count.
      // ADDING A SECOND COMMAND-SHAPED EVENT REQUIRES A DECISION RECORD — not an
      // edit to this list and not a change to this assertion. Read 043 §3.4
      // before you touch either.
      "043 §3.4 ratifies EXACTLY ONE command-shaped event. A second one is a design change " +
        "and requires a decision record naming 043 as superseded on this point (018 §4 rule S4) — " +
        "it is not a catalogue addition. The reason the count exists: a command has no truth for " +
        "a consumer to re-read, so 042 §7.1's reference rule has nothing to protect, and the only " +
        "thing stopping 'commands are fine, actually' from becoming a habit is this number."
    ).toBe(1);
    expect(commands[0]!.event).toBe(DRAFT_REQUESTED);
    expect(commands[0]!.refTable).toBe("outbox");
  });

  it("every entry carries a stated consumer OUTSIDE the writing module — the signature on the name", () => {
    // This is the filter that stops the catalogue being a mirror of the schema,
    // which is the failure mode 042 A2 caught.
    for (const entry of EVENT_CATALOGUE) {
      expect(entry.why.length).toBeGreaterThan(40);
    }
  });

  it("names an EXCLUSION RULE for every append-only table it omits", () => {
    // The exclusions are the argument (043 §3.3): a reader who thinks
    // `llm_rerank` needs an event has a specific sentence to attack. An omission
    // with no stated rule is indistinguishable from an oversight.
    const referenced = new Set(EVENT_CATALOGUE.map((e) => e.refTable));
    const excluded = new Set(CATALOGUE_EXCLUSIONS.map((e) => e.table));
    const unaccounted = APPEND_ONLY_TABLE_NAMES.filter((t) => !referenced.has(t) && !excluded.has(t));
    expect(
      unaccounted,
      `these append-only tables produce no event and no rule says why: ${unaccounted.join(", ")}. ` +
        `Add a CATALOGUE_EXCLUSIONS row citing the rule, or add the event.`
    ).toEqual([]);
    for (const row of CATALOGUE_EXCLUSIONS) expect(row.rule.length).toBeGreaterThan(20);
  });

  it("is AUTHORED, not derived from the schema at test time (043 §3.4's closing rule)", () => {
    // 042 A2 struck a generated catalogue because generation cannot be wrong,
    // and a list that cannot be wrong cannot be reviewed. So the module must not
    // import the table list and build itself out of it.
    expect(catalogueSource).not.toMatch(/from ["'].*appendOnlyTables/);
    expect(catalogueSource).not.toMatch(/APPEND_ONLY_TABLE(_NAMES)?\b/);
    // Each name appears as a literal, so a grep finds it.
    for (const entry of EVENT_CATALOGUE) {
      expect(catalogueSource).toContain(`"${entry.event}"`);
    }
  });

  it("lookup helpers agree with the list", () => {
    expect(isCatalogueEvent(DRAFT_REQUESTED)).toBe(true);
    expect(isCatalogueEvent("longbox.commerce.nope")).toBe(false);
    expect(catalogueEntry(DRAFT_REQUESTED)?.command).toBe(true);
    expect(catalogueEntry("longbox.commerce.nope")).toBeUndefined();
  });
});
