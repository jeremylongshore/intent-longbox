// The media path makes no outbound request (E03-B07; 046 §4 B4).
//
// SSRF is a property of code that FETCHES a caller-influenced address. The
// answer for this pipeline is that there is no such code: a photograph arrives
// as a multipart stream and leaves as a file, and nothing between the two ever
// takes a URL. That is worth an assertion rather than a sentence, because the
// cheap way to add a thumbnail, a remote-conversion service or an "import from
// URL" field is to add a fetch right here — and the reviewer who would have
// caught it is the one reading this file.
//
// SCOPE, STATED SO IT CANNOT DRIFT: the guard, the HTTP edge, and the media half
// of the application service (from `uploadPhoto` to the end of `readPhoto`).
// `sessionApi.ts` as a whole DOES reach the network — the vision provider, the
// pricing sources, Shopify — through the provider seam, which has its own host
// allowlist (E03-D01, `src/config.ts`). This test is about the bytes' own path.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Every way this codebase could open an outbound connection.
 *
 * `import(` is on the list because a STATIC import scan is evaded by a dynamic
 * one (invariant review of `1c25749`, item 3): `await import("node:https")`
 * matches none of the other patterns and reaches the network in one line. It is
 * matched unconditionally rather than only for network specifiers, because a
 * dynamic import in these three files is a smell in its own right — none of them
 * has any reason to defer a module.
 */
const OUTBOUND = [
  /\bfetch\s*\(/,
  /\brequire\s*\(\s*["'](node:)?(http|https|net|dns|dgram)["']/,
  /\bfrom\s+["'](node:)?(http|https|net|dns|dgram)["']/,
  /(^|[^.\w])import\s*\(/m,
  /\b(axios|undici|got|node-fetch|superagent)\b/,
  /\bnew\s+URL\s*\(/,
];

/**
 * Comments are prose and prose is not a call. These files EXPLAIN what they do
 * not do — "Shopify is handed root-relative paths it cannot fetch" — and a scan
 * that cannot tell an explanation from a call would be answered by deleting the
 * explanation, which is the wrong direction.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

function assertNoOutbound(label: string, text: string): void {
  const source = stripComments(text);
  for (const pattern of OUTBOUND) {
    expect(
      { label, pattern: pattern.source, matched: pattern.exec(source)?.[0] ?? null },
      `${label} may not open an outbound connection: the media path takes no URL from anywhere`
    ).toEqual({ label, pattern: pattern.source, matched: null });
  }
}

describe("the media path has no outbound-fetch surface", () => {
  it("the upload guard takes no URL and opens no socket", () => {
    assertNoOutbound("src/services/media.ts", readFileSync("src/services/media.ts", "utf8"));
  });

  it("the HTTP edge takes no URL and opens no socket", () => {
    assertNoOutbound("src/routes/scanSessions.ts", readFileSync("src/routes/scanSessions.ts", "utf8"));
  });

  it("the upload and read functions take no URL and open no socket", () => {
    const source = readFileSync("src/services/sessionApi.ts", "utf8");
    const start = source.indexOf("export async function uploadPhoto");
    const end = source.indexOf("const MANUAL_PATH_PROVIDER");
    // A failed slice must fail the test, not silently assert over nothing.
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    assertNoOutbound("sessionApi.ts (media half)", source.slice(start, end));
  });

  // PROVE THE SCAN CAN FAIL. A pattern list that has never rejected anything is
  // a list nobody has checked, and the two additions this test grew (comment
  // stripping, and `import(`) are both the kind that can be written wrong and
  // stay green forever.
  it.each([
    ["a plain fetch", `async function go() { await fetch("https://example.invalid"); }`],
    ["a dynamic import of node:https", `const https = await import("node:https");`],
    ["a require of node:net", `const net = require("net");`],
    ["a URL built from a request field", `const target = new URL(req.body.source);`],
    ["an http import", `import { get } from "node:http";`],
  ])("would reject %s", (_label, source) => {
    expect(() => assertNoOutbound("fixture", source)).toThrow();
  });

  it("does not mistake a static import or the word 'import' in prose for a dynamic one", () => {
    expect(() => assertNoOutbound("fixture", `import { join } from "node:path";`)).not.toThrow();
    expect(() => assertNoOutbound("fixture", `const x = obj.import(1);`)).not.toThrow();
  });
});
