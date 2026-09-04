// L2 contract: 042 §4.3 / I9(a) — THE SERVER EMITS NO OPERATOR PROSE.
//
// WHY THIS SCANS A MAP AND NOT THE CALL SITES. The first version matched
// `new LongboxError("CODE", "<double-quoted literal>")` — which sees a literal
// and misses a template literal, a concatenation, a variable and every
// `envelope()` call site, and it did miss two live emitters (the write-conflict
// message and a 404 that interpolated the request's own URL). A guard whose
// coverage depends on how an author happened to spell a string is not a guard.
//
// So the mechanism changed: `MESSAGES` in `src/contracts/v1/errors.ts` is the
// COMPLETE set of strings the server can put in an error body, `LongboxError`
// takes no message argument at all, and this file scans the map plus a lint that
// no caller can reintroduce the old shape. The rules enforced are not this
// file's: 021 B19 (no "AI" in a shop-facing sentence), 021 B17 (no number as a
// grade), 022 P6 (no probability language, never a bare number pretending to be
// a grade), 022 P8 (cost stays in `cost_log`), 019 §2 (no percentage).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { collectSources } from "../../scripts/architectureRules.js";
import { ERROR_CODES, ERROR_CODE_NAMES, MESSAGES } from "../../src/contracts/v1/errors.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const sources = collectSources(join(repoRoot, "src"));
const messages = Object.entries(MESSAGES);

/**
 * Comments are prose ABOUT the rules and routinely quote the shapes the rules
 * forbid — this very file's neighbours explain why a reflected URL was removed.
 * A scanner that fired on them would teach authors to stop explaining
 * themselves, so every source scan below reads code only.
 */
function codeOnly(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

describe("the message set is CLOSED, so the scan below is total", () => {
  it("declares exactly one message per registry code, and no orphans", () => {
    expect(Object.keys(MESSAGES).sort()).toEqual([...ERROR_CODE_NAMES].sort());
    for (const [code, message] of messages) {
      expect(message.length, `${code} has an empty message`).toBeGreaterThan(10);
    }
  });

  it("lets no handler pass a message of its own", () => {
    // The lint that keeps the map total: `new LongboxError(code, details?)` takes
    // no string, so a bespoke message cannot be constructed at a throw site —
    // and this fails if the signature is ever widened back.
    const offenders: string[] = [];
    for (const file of sources) {
      for (const m of codeOnly(file.text).matchAll(/new LongboxError\(\s*"[A-Z_]+"\s*,\s*(.)/g)) {
        // A second argument is `details`. What must never appear is a STRING —
        // a literal, a template literal or a concatenation — because that is the
        // message channel this design closed. An object or an expression (a Zod
        // `flatten()`, say) is the structured half and is fine.
        if (m[1] === '"' || m[1] === "'" || m[1] === "`") offenders.push(`${file.path}: ${m[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("composes every envelope from the map, never from a caller's string", () => {
    const errorsFile = sources.find((f) => f.path === "src/contracts/v1/errors.ts")!;
    expect(errorsFile.text).toContain("message: MESSAGES[code]");
    // `envelope(code, correlationId, details)` — three parameters, no message.
    expect(errorsFile.text).not.toMatch(/export function envelope\([^)]*message/s);
  });

  it("interpolates nothing from a request into a message", () => {
    // A 404 that echoed `${req.method} ${req.url}` put an attacker-controlled
    // string into a wire message and into every log carrying one; a write
    // conflict interpolated its SQLSTATE. Both are structured `details` now.
    for (const [code, message] of messages) {
      expect(message, `${code} interpolates`).not.toMatch(/\$\{|\+ ?[a-z]/i);
    }
    const http = sources.find((f) => f.path === "src/http/errors.ts")!;
    expect(codeOnly(http.text)).not.toMatch(/req\.url/);
  });
});

describe("every message the server can emit (021 B19, 022 P6, 022 P8, 019 §2)", () => {
  it("says 'AI' nowhere, in any spelling (021 B19)", () => {
    for (const [code, message] of messages) {
      expect(message, code).not.toMatch(/\bA\.?I\.?\b/i);
      expect(message, code).not.toMatch(/artificial intelligence|machine learning|neural/i);
    }
  });

  it("names no model and no provider (022 P6; 042 E10's forwarded adapter message)", () => {
    for (const [code, message] of messages) {
      expect(message, code).not.toMatch(/claude|gpt-|sonnet|haiku|anthropic|openai|pricecharting|ebay/i);
    }
  });

  it("carries no percentage and no probability language (019 §2, 022 P6)", () => {
    for (const [code, message] of messages) {
      expect(message, code).not.toMatch(/%/);
      expect(message, code).not.toMatch(/\b(confidence|probability|likelihood|percent|certainty)\b/i);
    }
  });

  it("quotes no cost figure (022 P8 — cost stays in cost_log)", () => {
    for (const [code, message] of messages) {
      expect(message, code).not.toMatch(/\$\d|\busd\b|\bcost\b|\bprice of\b/i);
    }
  });

  it("carries no numeric grade (021 B17, 019 T7 non-waivable)", () => {
    for (const [code, message] of messages) {
      expect(message, code).not.toMatch(/\bgrade\s*\d|\b\d+(\.\d+)?\s*grade\b|\bCGC\b/i);
    }
  });

  it("blames nobody: no message names an operator, a person or a device (022 P6, 019 T35)", () => {
    // 022 P6: "Errors say what to do next; a screen never blames the person."
    // The structural half is §4.3 — a `message` is never rendered — and this is
    // the half that survives someone rendering one anyway.
    for (const [code, message] of messages) {
      expect(message, code).not.toMatch(/\byou\b|\byour\b|employee|operator|device/i);
    }
  });

  // -------------------------------------------------------------------------
  // E03-B05 (050 §9 I8, first half): NO WIRE SURFACE DECLARES A CREDENTIAL OR A
  // SPEND FACT.
  //
  // The `MESSAGES` half is here because a message is the one string a client
  // could render by accident; the DTO/parameter half is in
  // `tests/contract/route-table-scoping.test.ts`, over the GENERATED OpenAPI
  // document. Both are needed: a message could name a `key_ref` without any
  // schema declaring one, and a schema could declare `spend_owner` without any
  // message mentioning it.
  // -------------------------------------------------------------------------
  it("I8: no message names a credential, a key_ref, a version or a spend owner", () => {
    for (const [code, message] of messages) {
      expect(message, code).not.toMatch(/key_ref|LONGBOX_[A-Z0-9]|spend_owner|credential_version/i);
      // "credential" as a WORD is permitted — an operator may need to be told a
      // credential is misconfigured — but never with a name, a value or an owner
      // attached, which is what the patterns above forbid.
    }
  });

  it("keeps registry copy pointers as POINTERS, never as the copy itself", () => {
    for (const code of ERROR_CODE_NAMES) {
      const row = ERROR_CODES[code].copyRow;
      if (row === null) continue;
      // 042 §4.3: operator strings live in 021 and are selected by the CLIENT
      // from `code`. A registry that carried the sentence would be a second place
      // operator copy lives, which is how two copies start to disagree.
      expect(row).toMatch(/^021/);
    }
  });
});

describe("the client, not the server, owns the words (042 §4.3)", () => {
  const client = readFileSync(join(repoRoot, "public", "app.js"), "utf8");

  it("never renders the server's `message`", () => {
    expect(client).not.toMatch(/error\.message/);
    expect(client).not.toMatch(/data\.message/);
  });

  it("selects its copy from `error.code`", () => {
    expect(client).toMatch(/data\.error\.code/);
    expect(client).toMatch(/ERROR_COPY\[/);
  });

  it("has a string for every code the server marks operator-renderable", () => {
    // 042 §4.2's fourth declaration is only meaningful if the client honours it:
    // a code marked renderable with nothing to render falls through to a generic
    // sentence at the moment a person needed a specific one.
    for (const code of ERROR_CODE_NAMES) {
      if (!ERROR_CODES[code].operatorRenderable) continue;
      expect(client, `${code} is operator-renderable and the client has no copy`).toContain(`${code}:`);
    }
  });
});
