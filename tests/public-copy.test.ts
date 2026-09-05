// Regression guard for 000-docs/022 P6 ("no probability language / bare
// numbers on screens; band words only") and 000-docs/019 §2 ("percentages
// without N and date are forbidden as claims of fact"). The violation this
// covers shipped at public/app.js:103/:113 (see bead longbox-e5b.5.11 /
// E05-D01) and is the CI grep P6's enforcement line names: "the `%`-in-copy
// CI grep from `longbox-e5b.5.11` onward".
//
// The 022 P6 guards below are a static text scan, and deliberately so: they must
// cover every render path, including the ones no test drives.
//
// E03-D03 (bead longbox-e5b.3.13) added a jsdom half at the bottom of this file,
// because 046 §11 I14 asks for something a text scan cannot give — evidence that
// a hostile string actually RENDERS as text. The sentence that used to sit here
// ("public/ has no browser test harness in this repo yet") stopped being true in
// that commit and is struck rather than deleted, so a reader can see which claim
// changed and why.
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

// ---------------------------------------------------------------------------
// E03-D03 (bead longbox-e5b.3.13) — 046 §11 I14
//
// **Every server- or model-derived string reaches the operator as TEXT.**
//
// 046 §4 B1 credits the client with an accidental control: "the client renders
// the strings as `textContent` (E17)". It was accidental — a property of how the
// file happened to be written, holding in the candidate list and NOT holding in
// `renderCandidates`, which assembled `<span class="band ${data.band}">…` from a
// server field. E03-D03 makes it a rule, in two halves that fail differently:
//
//   * a STATIC assertion, because it covers every render path including the ones
//     no test drives, and it fails on a line an author is about to write;
//   * a jsdom RENDER of a hostile candidate, because a static rule about
//     `innerHTML` proves nothing about `textContent` actually being used — a
//     screen could pass the grep and still build a node from a string some other
//     way. The static half is the guard; this half is the evidence.
// ---------------------------------------------------------------------------

describe("public/ renders server- and model-derived strings as text only (046 §11 I14)", () => {
  /**
   * Load index.html + app.js into a jsdom window, with `fetch` under test control.
   *
   * `app.js` calls `loadShops()` at load, so a window whose `fetch` rejects
   * produces an unhandled rejection that has nothing to do with what is being
   * asserted. The default here answers that one call with an empty shop list —
   * the state of a fresh install — and records everything else.
   */
  async function mountApp(fetchImpl?: (url: string, init?: { body?: string }) => Promise<unknown>) {
    const { JSDOM } = await import("jsdom");
    const dom = new JSDOM(indexHtml, { runScripts: "dangerously", url: "http://localhost/" });
    const { window } = dom;
    const posted: Array<{ url: string; body: unknown }> = [];
    window.fetch = ((url: string, init?: { body?: string }) => {
      posted.push({ url, body: init?.body ? JSON.parse(init.body) : undefined });
      if (fetchImpl) return fetchImpl(url, init);
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ shops: [] }) });
    }) as unknown as typeof window.fetch;
    window.crypto.randomUUID = () => "22222222-2222-2222-2222-222222222222";
    const script = window.document.createElement("script");
    script.textContent = appJs;
    window.document.body.appendChild(script);
    // Let `loadShops()`'s promise settle before a test drives the page.
    await new Promise((resolve) => setTimeout(resolve, 0));
    return { dom, window, posted };
  }

  /**
   * Assignments to an HTML sink, with the assigned expression.
   *
   * `\s*\+?=\s*` catches `+=` as well as `=` (invariant review of `610501e`).
   * The first version matched only `=`, so `list.innerHTML += userTitle` — the
   * append form, which is how markup is most naturally accumulated in a loop —
   * would have passed the gate unread. A scan that only sees the form the last
   * author happened to use is a scan calibrated to the past.
   */
  function htmlSinkAssignments(src: string): string[] {
    return (src.match(/\.(?:inner|outer)HTML\s*\+?=\s*[^;\n]+/g) ?? []).map((m) => m.trim());
  }

  /** The permitted statement, in full: a clear, by plain assignment, of "". */
  const PERMITTED_CLEAR = /\.innerHTML\s=\s""/;

  it("the ONLY permitted innerHTML assignment is the empty-string clear", () => {
    // Clearing a container is not rendering: no markup is parsed and no value
    // crosses into the DOM. Everything else must go through createElement +
    // textContent, which is what `el()` in app.js does.
    for (const assignment of htmlSinkAssignments(appJs)) {
      expect(assignment).toMatch(PERMITTED_CLEAR);
    }
  });

  it("PROVE THE GATE CAN FAIL: it catches the deleted line AND the append form (029 §5 move 8)", () => {
    // (a) The exact statement that stood at `renderCandidates` before E03-D03 —
    // a server field interpolated into a class attribute inside `innerHTML`.
    const violating = '$("band-line").innerHTML = `<span class="band ${data.band}">${copy.heading}</span>`;';
    const found = htmlSinkAssignments(violating);
    expect(found).toHaveLength(1);
    expect(found[0]).not.toMatch(PERMITTED_CLEAR);

    // (b) The APPEND form, which the first version of this scan did not see at
    // all. Both the flagged-as-found and the not-permitted halves are asserted,
    // because a regex that missed it would have produced an empty list and an
    // empty list passes the assertion above vacuously.
    const appending = htmlSinkAssignments("list.innerHTML += `<p>${c.title}</p>`;");
    expect(appending).toHaveLength(1);
    expect(appending[0]).not.toMatch(PERMITTED_CLEAR);
    // …not even when what is appended is the empty string: `+= ""` is a no-op
    // written by someone who meant to clear, and it must not read as a clear.
    expect(htmlSinkAssignments('list.innerHTML += "";')[0]).not.toMatch(PERMITTED_CLEAR);

    // (c) …and the clear that IS permitted is not flagged as a violation.
    expect(htmlSinkAssignments('list.innerHTML = "";')[0]).toMatch(PERMITTED_CLEAR);
  });

  it("no other HTML-parsing sink appears anywhere in public/", () => {
    // Every documented way to turn a string into nodes, not only the two the
    // file happens to have avoided. `setHTMLUnsafe` is the modern spelling,
    // `createContextualFragment` the old one that survives in copied snippets,
    // and `DOMParser` the one that looks innocent because it is "just parsing".
    const bannedSinks = [
      /insertAdjacentHTML/,
      /outerHTML/,
      /document\.write/,
      /setHTMLUnsafe/,
      /createContextualFragment/,
      /new\s+DOMParser|DOMParser\s*\(/,
    ];
    for (const src of [appJs, indexHtml]) {
      for (const sink of bannedSinks) expect(src).not.toMatch(sink);
    }
    // The list itself is proved live: a fixture containing each one is caught.
    for (const sink of bannedSinks) {
      expect(
        "el.insertAdjacentHTML(); x.outerHTML; document.write(); el.setHTMLUnsafe(); r.createContextualFragment(); new DOMParser()"
      ).toMatch(sink);
    }
  });

  it("index.html loads app.js as a plain script and defines no inline renderer", () => {
    // A second renderer in the page would be a second place for this rule to be
    // broken, and the static scan above only reads app.js.
    const inlineScripts = indexHtml.match(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/g) ?? [];
    expect(inlineScripts).toEqual([]);
  });

  // An explicit timeout for the same reason the PIN case above has one: the
  // jsdom render is slow under v8 coverage instrumentation and intermittently
  // blew vitest's 5s default in a required check. Nothing about the assertion
  // changed. (E03-D02's suite; touched here only because the flake is in a
  // check E03-D07's PR must turn green, and the fix is one argument.)
  it("A HOSTILE CANDIDATE RENDERS AS TEXT: the markup is visible, not executed", async () => {
    const { dom, window } = await mountApp();

    // A cover carrying markup, returned by the model as a candidate (046 §5 A8),
    // in the shape the identify DTO delivers it.
    const hostile = {
      title: '<img src=x onerror="window.__PWNED__ = true">Amazing Spider-Man',
      issue: "300",
      variant: "<script>window.__PWNED__ = true</script>",
      publisher: "Marvel",
      year: "1988",
    };
    (window as unknown as { renderCandidates: (d: unknown) => void }).renderCandidates({
      band: "high",
      contradiction: false,
      candidates: [hostile],
    });

    const list = window.document.getElementById("candidate-list")!;
    // Nothing was parsed as markup: no injected element, no fired handler.
    expect(list.querySelector("img")).toBeNull();
    expect(list.querySelector("script")).toBeNull();
    expect((window as unknown as { __PWNED__?: boolean }).__PWNED__).toBeUndefined();
    // …and the operator sees the characters, which is the honest rendering: the
    // string on the cover is what it is, and hiding it would be its own defect.
    expect(list.textContent).toContain("<img src=x");
    expect(list.textContent).toContain("<script>");
    expect(list.innerHTML).not.toContain("<img");
    dom.window.close();
  }, 30000);

  it("A HOSTILE BAND VALUE cannot escape the class attribute it used to be interpolated into", async () => {
    const { dom, window } = await mountApp();

    (window as unknown as { renderCandidates: (d: unknown) => void }).renderCandidates({
      band: '"><img src=x onerror="window.__PWNED__ = true">',
      contradiction: false,
      candidates: [],
    });

    const bandLine = window.document.getElementById("band-line")!;
    expect(bandLine.querySelector("img")).toBeNull();
    expect((window as unknown as { __PWNED__?: boolean }).__PWNED__).toBeUndefined();
    // An unrecognised band renders as the cautious one, with the low-band copy.
    expect(bandLine.querySelector("span")!.className).toBe("band low");
    expect(bandLine.textContent).toContain("Not sure enough to guess");
    dom.window.close();
  });

  it("ONE-TAP POSTS THE BOUNDED SHAPE the v1 contract declares (E03-D02's client half)", async () => {
    const { dom, window, posted } = await mountApp((url) =>
      Promise.resolve({
        ok: true,
        status: url.endsWith("/confirm") ? 201 : 200,
        json: () =>
          Promise.resolve(
            url.endsWith("/confirm")
              ? { confirmation: { id: "11111111-1111-1111-1111-111111111111" } }
              : { shops: [] }
          ),
      })
    );

    // The candidate carries fields the contract does not declare — a model's
    // extra keys, and a numeric year. `.strict()` would 422 on the first and
    // reject the second, so the client sends the six declared fields as strings.
    (window as unknown as { confirmIssue: (c: unknown, s: string) => Promise<void> }).confirmIssue(
      {
        title: "Amazing Spider-Man",
        issue: "300",
        variant: "Direct",
        publisher: "Marvel",
        year: 1988,
        upc: "071486021728",
        evidence: { model: "said so" },
        confidence: 0.97,
      },
      "one_tap"
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    const confirm = posted.find((p) => p.url.endsWith("/confirm"));
    expect(confirm).toBeDefined();
    expect((confirm!.body as { issue: unknown }).issue).toEqual({
      title: "Amazing Spider-Man",
      issue: "300",
      variant: "Direct",
      publisher: "Marvel",
      year: "1988",
      upc: "071486021728",
    });
    dom.window.close();
  });
});
