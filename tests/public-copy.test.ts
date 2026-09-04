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

  it("app.js status line uses the registered band headings verbatim (021 C1-C3)", () => {
    expect(appJs).toContain("Best match");
    expect(appJs).toContain("Close matches");
    expect(appJs).toContain("Not sure enough to guess");
  });
});
