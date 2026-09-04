// L3 unit: the not-left-draft guard's POLARITY (043 §4.3, amendment A3).
//
// THE EMPTY-TABLE CASE IS FIRST, DELIBERATELY, AND IT IS THE WHOLE POINT.
// 043 v1.0.0's guard refused a job when an observation said the listing had left
// `draft` — and PASSED when there were no observations at all, which is the
// state of the world today: `listing_status_observation` has no producer (043 §1
// E8; the watcher is E10-B05). So the protection evaluated to *proceed* in
// exactly the condition it existed for, and the record covered that with an
// instruction that the guard and the watcher not ship apart. Kleppmann struck
// the instruction and inverted the guard:
//
//   "An instruction is not an invariant. It is the thing an invariant exists to
//    replace."
//
// A test file that ordered its cases the obvious way — happy path, then edges —
// would put the one case that used to be wrong last, where a reader skims. It is
// first here for the same reason 043 §11 I8 was rewritten with it first.
//
// Bead: longbox-e5b.2.17 (E02-D07). Docs: 043 §4.3, §5.5, §11 I8, A3;
// 022 P1; 033 B3; 019 T19.
import { describe, expect, it } from "vitest";
import { composeDraftInput, decideDraftGuard } from "../src/consumers/draftRequested.js";

const PRIOR = { id: "sd-1", status: "draft" };

describe("the fail-closed listing guard (043 §4.3, A3)", () => {
  it("(a) THE EMPTY-TABLE CASE: a prior draft and ZERO observations is REFUSED", () => {
    // Unknown means do not touch. This is the case the pre-A3 draft passed, and
    // it is the case the tree is in TODAY — nothing writes an observation.
    expect(decideDraftGuard({ priorDraft: PRIOR, observations: [] })).toEqual({
      run: false,
      reasonCode: "no_observation_evidence",
    });
  });

  it("(b) an observation saying anything other than `draft` is REFUSED as listing_left_draft", () => {
    // `productSet` UPDATES an existing product and the builder hardcodes
    // status: DRAFT, so running here would set a human's PUBLISHED listing back
    // to draft — 022 P1's human authority and 033 B3 broken from the other side.
    for (const observedStatus of ["published", "delisted", "archived", "deleted"]) {
      expect(decideDraftGuard({ priorDraft: PRIOR, observations: [{ observedStatus }] })).toEqual({
        run: false,
        reasonCode: "listing_left_draft",
      });
    }
  });

  it("(c) positive evidence — an observation saying `draft` — lets the job run", () => {
    expect(decideDraftGuard({ priorDraft: PRIOR, observations: [{ observedStatus: "draft" }] })).toEqual({
      run: true,
      because: "observed_draft",
    });
  });

  it("(d) no prior draft at all lets the job run: there is nothing to un-publish", () => {
    expect(decideDraftGuard({ priorDraft: null, observations: [] })).toEqual({
      run: true,
      because: "no_prior_draft",
    });
  });

  it("refuses when the listing was seen as a draft AND LATER published — newer evidence wins", () => {
    // Order of the array must not decide this. A listing observed as a draft and
    // subsequently published is a listing that left draft, and a guard that
    // waved it through on the older evidence would un-publish it.
    expect(
      decideDraftGuard({
        priorDraft: PRIOR,
        observations: [{ observedStatus: "published" }, { observedStatus: "draft" }],
      })
    ).toEqual({ run: false, reasonCode: "listing_left_draft" });
    expect(
      decideDraftGuard({
        priorDraft: PRIOR,
        observations: [{ observedStatus: "draft" }, { observedStatus: "published" }],
      })
    ).toEqual({ run: false, reasonCode: "listing_left_draft" });
  });

  it("treats a prior draft whose status is `published` as still a prior draft", () => {
    // `shopify_draft.status` was widened by migration 003 and the table is
    // append-only, so those values have no legal writer today (005's header) —
    // but if one ever appears it is emphatically still a listing that exists.
    expect(decideDraftGuard({ priorDraft: { id: "sd-2", status: "published" }, observations: [] })).toEqual({
      run: false,
      reasonCode: "no_observation_evidence",
    });
  });

  it("is a pure decision: it performs no I/O and needs no watcher to be SAFE", () => {
    // 043 A3's payoff, stated as a property rather than a comment: with no
    // watcher every case collapses to (a) or (d), and BOTH are decided rather
    // than assumed. E10-B05 makes this guard USEFUL — it is what lets a safe
    // retry proceed automatically instead of dead-lettering — and it is not what
    // makes it safe.
    expect(decideDraftGuard({ priorDraft: null, observations: [] }).run).toBe(true);
    expect(decideDraftGuard({ priorDraft: PRIOR, observations: [] }).run).toBe(false);
  });
});

describe("composeDraftInput", () => {
  const facts = {
    confirmedIssue: { title: "Uncanny X-Men", issue: "266", publisher: "Marvel", year: 1990 },
    pricing: { suggested_cents: 4750, override_cents: null },
    assessment: { grade_range_low: "FN", grade_range_high: "VF", defects: ["spine_ticks"] },
    coverUrls: ["/uploads/a/cover.jpg"],
  };

  it("carries the copy key through, because a call without one CREATES a product", () => {
    expect(composeDraftInput(facts, "session-1")?.copyKey).toBe("session-1");
  });

  it("renders condition as a grade RANGE and defect callouts — never a number (locked decision 5, T7)", () => {
    const out = composeDraftInput(facts, "s")!;
    expect(out.descriptionHtml).toContain("Condition: FN-VF");
    expect(out.descriptionHtml).toContain("spine ticks");
    expect(out.descriptionHtml).not.toMatch(/\b(?:[0-9]|10)\.[05]\b/); // no 9.4 / 8.0 grades
    expect(out.descriptionHtml).not.toContain("%");
  });

  it("collapses an equal low and high grade to one label rather than 'VF-VF'", () => {
    const out = composeDraftInput(
      { ...facts, assessment: { grade_range_low: "VF", grade_range_high: "VF", defects: [] } },
      "s"
    )!;
    expect(out.descriptionHtml).toContain("Condition: VF");
    expect(out.descriptionHtml).not.toContain("VF-VF");
  });

  it("prefers the operator's override to the suggested price", () => {
    expect(
      composeDraftInput({ ...facts, pricing: { suggested_cents: 4750, override_cents: 6000 } }, "s")!
        .priceCents
    ).toBe(6000);
  });

  it("returns undefined — a TERMINAL outcome — when the session lacks a confirmation or a price", () => {
    // The facts do not appear by waiting, so this is a dead letter and not a
    // retry. The route's 409 gates catch the ordinary case at request time
    // (043 §4.2); this is the case where they changed underneath the job.
    expect(composeDraftInput({ ...facts, confirmedIssue: undefined }, "s")).toBeUndefined();
    expect(composeDraftInput({ ...facts, pricing: undefined }, "s")).toBeUndefined();
  });

  it("drafts a session with no condition assessment rather than crashing on it", () => {
    // 040 F6 refuses a draft with no condition and that gate is E02-B08's to
    // wire at the request; this function must not be the place it is silently
    // enforced, because a job that swallowed it would make the gate look
    // installed when it is not.
    const out = composeDraftInput({ ...facts, assessment: undefined }, "s")!;
    expect(out.title).toBe("Uncanny X-Men #266");
  });
});
