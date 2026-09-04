// Regression guard for 000-docs/022 P6 ("no probability language / bare
// numbers on screens; band words only") and 000-docs/019 §2 ("percentages
// without N and date are forbidden as claims of fact"). The violation this
// covers shipped at public/app.js:103/:113 (see bead longbox-e5b.5.11 /
// E05-D01) and is the CI grep P6's enforcement line names: "the `%`-in-copy
// CI grep from `longbox-e5b.5.11` onward".
//
// This is a static text scan, not a DOM test — public/ has no browser test
// harness in this repo yet, so the guard operates directly on the source
// files that render operator-facing copy.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, "..", "public");

const appJs = readFileSync(path.join(publicDir, "app.js"), "utf8");
const indexHtml = readFileSync(path.join(publicDir, "index.html"), "utf8");

// Every backtick template literal in the file, as raw text (including the
// ${...} interpolations) — this is where a computed "(NN%)" or "[NN%]"
// would appear if confidence were re-rendered as a percentage.
function templateLiterals(src: string): string[] {
  const matches = src.match(/`(?:[^`\\]|\\.)*`/g) || [];
  return matches;
}

describe("public/ operator copy never shows a percentage or confidence figure (022 P6, 019 §2)", () => {
  it("app.js has no `%` character inside a template literal", () => {
    const offenders = templateLiterals(appJs).filter((lit) => lit.includes("%"));
    expect(offenders).toEqual([]);
  });

  it("index.html renders no `%` inside visible body text (CSS width:100% etc. is fine)", () => {
    const bodyOnly = indexHtml.slice(indexHtml.indexOf("<body"));
    // Strip the <style> block (percent is legitimate CSS there) before scanning.
    const withoutStyle = bodyOnly.replace(/<style>[\s\S]*?<\/style>/g, "");
    expect(withoutStyle).not.toMatch(/%/);
  });

  it("app.js never calls .toFixed(...) on a confidence value (no re-derived percentage)", () => {
    // Matches either order: `confidence...toFixed` or `toFixed...confidence`
    // on the same statement, e.g. `(c.confidence * 100).toFixed(0)`.
    const confidenceToFixed = /confidence[^;\n]{0,80}\.toFixed\(|\.toFixed\([^;\n]{0,80}confidence/i;
    expect(appJs).not.toMatch(confidenceToFixed);
  });

  it("app.js never renders the cost figure on the operator screen (022 P8 — cost stays in cost_log)", () => {
    // costUsd (or any *Usd cost field) must not be interpolated into UI copy.
    expect(appJs).not.toMatch(/\$\{[^}]*costUsd[^}]*\}/);
  });

  it("app.js, with comments stripped, never mentions confidence, a percent sign, or the cost field anywhere", () => {
    // Whole-file guard (not just template literals): catches Math.round(c.confidence*100),
    // string concatenation with "%", and textContent = data.costUsd alike.
    const stripped = appJs
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    expect(stripped).not.toMatch(/confidence/i);
    expect(stripped).not.toMatch(/%/);
    expect(stripped).not.toMatch(/cost_?usd/i);
  });

  it("the high-band override posts a source value the confirm route accepts (022 P2)", () => {
    // src/routes/scanSessions.ts validates source ∈ {one_tap, grid_pick, manual_search, owner_review}.
    const posted = appJs.match(/renderCandidateGrid\(data, "([a-z_]+)"\)/g) || [];
    expect(posted.length).toBeGreaterThan(0);
    for (const call of posted) {
      const src = call.match(/"([a-z_]+)"/)![1];
      expect(["one_tap", "grid_pick", "manual_search", "owner_review"]).toContain(src);
    }
  });

  // E02-D08 (042 §4.3, A4). The client moved onto the v1 contract in the SAME PR
  // as the server, and the property that must not regress is that nothing the
  // server writes reaches a screen: the words are selected here, from `code`.
  it("app.js renders no server-authored string on any failure path (042 §4.3)", () => {
    // The three shapes that used to reach an operator verbatim: a validation
    // blob (`JSON.stringify(data)`), the raw body (`res.text()`), and the
    // envelope's developer `message`.
    expect(appJs).not.toMatch(/JSON\.stringify\(data\)/);
    expect(appJs).not.toMatch(/res\.text\(\)/);
    expect(appJs).not.toMatch(/\.error\.message/);
    expect(appJs).not.toMatch(/data\.message/);
  });

  it("app.js selects its copy from error.code, with a fallback for an unknown one", () => {
    // 042 §2.3: a new error code is ADDITIVE within v1, so a client that met an
    // unknown code with nothing to say would break on a change the contract
    // explicitly permits.
    expect(appJs).toContain("const ERROR_COPY = {");
    expect(appJs).toContain("ERROR_COPY[code] || FALLBACK_COPY");
  });

  it("app.js mints an Idempotency-Key per ACT and sends `against` with every write", () => {
    // 042 §5.6: the key is minted when the operator acts and replayed unchanged;
    // a key minted at replay would make two replays of one act two different
    // requests, which is the duplication 019 T23 signs at zero. And §6.1: the
    // write says what world it was made against.
    expect(appJs).toContain('"idempotency-key"');
    expect(appJs).toMatch(/function newKey\(\)/);
    expect(appJs).toMatch(/\.\.\.body, against/);
  });

  it("app.js treats a stale world view as a NEW act, not as a retry (042 A9)", () => {
    // Re-submitting the OLD key with a refreshed `against` changes the body, so
    // the hash moves and the operator — who did exactly the right thing — would
    // be told they made a client bug. The client refreshes and mints a new key.
    expect(appJs).toContain("STALE_WORLD_VIEW");
    expect(appJs).toMatch(/refreshWorldView\(\)/);
  });

  it("app.js reads the identify DTO's new id and none of its removed fields (042 §6.3)", () => {
    expect(appJs).toContain("llm_rerank_id");
    const code = appJs
      .split("\n")
      .filter((line) => !line.trim().startsWith("*") && !line.trim().startsWith("//"))
      .join("\n");
    for (const field of ["costUsd", "provider", "model"]) {
      expect(code).not.toMatch(new RegExp(`data\\.${field}`));
    }
  });

  it("app.js status line uses the registered band headings verbatim (021 C1-C3)", () => {
    expect(appJs).toContain("Best match");
    // Bodies and the contradiction sentence, byte-for-byte from 021 C1–C3.
    expect(appJs).toContain("Check the cover in your hand.");
    expect(appJs).toContain("More than one book fits. Pick the one in your hand.");
    expect(appJs).toContain("Search for it — type what's on the cover.");
    expect(appJs).toContain(
      "The barcode and the cover don't agree. Check the issue number before you confirm."
    );
    expect(appJs).toContain("Not this one — show other matches");
    expect(appJs).toContain("Close matches");
    expect(appJs).toContain("Not sure enough to guess");
  });
});
