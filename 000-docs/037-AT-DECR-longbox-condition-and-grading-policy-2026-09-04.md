# Decision Record — What Longbox May Say About a Book's Condition: Three Statements and One Shape, the Vocabulary, the Disclaimers, Owner Review and Disputes

**Version:** 1.1.1 — **patch (gate audit, 2026-09-04): citation hygiene only.** `longbox-gate-auditor` returned **PASS on design, decisions, proposed rows, disclosure class and the 006 / 016 / 000-INDEX rows**, and **NOT-READY on six citation-hygiene items** — the 035 v1.0.1 class. All six repaired: **(1)** Midtown's sentence quoted verbatim; **(2)** CGC's labels page carries fourteen entries, of which five are the principal types; **(3)** eBay's sentence quoted verbatim; **(4)** the FTC .com Disclosures blockquote was a composite and is now the page's own sentences; **(5)** the two edcollins band definitions were misattributed to decimal ranges that the page does not use — re-fetched by raw HTTP and rebuilt; **(6)** MyComicShop now renders blank and moves to the dead-end table as SOURCED-then-unverifiable. Also: three `file:line` ranges corrected, the cannon-lens provenance stated, and the `[counsel]` routing reconciled against 038 §6. **§12 stays signed; no decision, string, row, trigger or invariant changed.** Details in §13.

**v1.1.0 — the cannon round.** `product-critic` **ACCEPT-WITH-CHANGES** (two required: **B1** the C12 wording read as the trade's own FN/VF half-step, **B2** an adjacency-and-naming blocklist row) and `legal-advisor` **ACCEPT-WITH-CHANGES** (two BLOCKs: the "pressed" silence rule as drafted, and the absence of a seller-of-record statement). All amendments absorbed, **none declined** — see §13 for the change log and the per-amendment disposition. **No decision from v1.0.0 was reversed**; three were sharpened (§1's framing, §2.4's pressed rule, §4.1's floor), four listing strings were rewritten, and three registry rows were added.
**Status:** **RATIFIED 2026-09-04** by the acting head of board under Jeremy Longshore's 2026-09-03 in-session delegation, after the two-lens cannon above. Signed at §12.
**Outside counsel:** the listing sentences in §3 and the dispute language in §5 are **commercial representations, and they go to outside counsel as part of the single batched E01-B05 engagement** — **the one 038 §6 now enumerates** (six instruments: the acceptable-use covenant, the blame clause, the timekeeping/FLSA disclaimer, the monitoring notice, the walk-in seller notice, and the P9 misuse clause), before E01-B05 executes. **This record's `[counsel]` items join that envelope; they do not open a second engagement, and they are not among 038 §6's six.** 038 §6's table therefore owes four additional rows — the §3 listing strings as a set, the §2.4 pressing rule, C18, and the four seller-of-record statements at §5.0 — **and this record does not make that edit**, on the 030/034 precedent: an amendment to another ratified record is filed by that record's owner, not reached into from here. **This record does not obtain, replace, or anticipate counsel review, and nothing in it is legal advice.** A `legal-advisor` cannon lens is an internal adversarial read, not counsel.
**Bead:** E08-B01 `longbox-e5b.8.1` (epic E08 `longbox-e5b.8`, gate G3) — see 000-docs/014 §8 row E08-B01
**Filed:** 2026-09-04 · **Owner:** Jeremy Longshore (decision owner) · **Author:** parent session (product/policy) · **Audit:** two-lens cannon, then `longbox-gate-auditor` on the ratified text (014 §22; bead metadata `lbox.agent.build: longbox-valuation-commerce-builder`, `lbox.agent.audit: longbox-gate-auditor`)
**Sensitivity:** **Restricted internal when written**, public since 2026-09-15 (014 §10). §1, §2, §4, §5 and §7 describe *how condition works*, which is **021 B5** — never said outside Restricted internal beyond the single approved sentence 021 A2. §3's proposed strings are the one part of this record **intended** to become shop- and buyer-facing, and they reach that class only by being adopted as 021 §3.1 C-rows on ratification and then passing the T26 pre-send step. **Do not extract §1, §2, §4 or §5 in any class.**
**Governed by:** CLAUDE.md **locked decision 5** (condition is never numeric) · 018 (evidence ladder, source precedence, supersession, change control) · 019 **T7** (numeric grades emitted = 0, non-waivable), **T8** (inter-rater agreement, internal-only), **T9** (missed-defect rate), **T26/K7** (pre-send step) · 021 §1 **B5**/**B14**, §2 (retirement list), §3 **A2**, §3.1 (registered copy) · 022 **P1** (humans hold authority; the blame clause), **P2** (override and undo), **P4** (no deskilling), **P6** (retail language), **P8** (honesty about what the machine did), **P9** (misuse path) · 035 §2.4, §2.5, §2.6, **I6** · 033 §5.8, §7.
**Inputs:** 002 R10 · 003 §Data model · 004 §Journey 1 step 5, §Journey 2 step 2, §Journey 3 · 005 · 029 (the `condition` module) · 030 (`collectible_definition → edition → physical_item`, `attributes jsonb`) · 031 §3 (the trade's anti-"AI" reflex) · 032 §1.3 (a live seller's nine-label word ladder) · 033 §5.8 and §7 · 034 · 035 §2.4/§2.5/§2.6 · the shipped code at `7359140` (cited by `file:line` throughout) · the external sources in §2.0.
**Supersedes:** nothing. It is the first condition-policy record. It **binds** E08-B02 (capture recipe), E08-B03 (vocabulary implementation), E08-B04, E05-B02 (design-system copy), **E05-B09** (the single-ladder condition control and undo), E10-B04 (listing template), E11-B02 (the review queue), E11-B03/B04 (correction and dispute records) and E16-B03 (training). It **proposes, and does not own,** C18's price-source line (E09-B06 / E10-B04) and the C5 v2 seller-of-record clause (a 006 row, because C5 is ratified in 022 Q7).

---

## 0. Reading rules for this record

- **Every "today" claim carries a `file:line` at `7359140`** and is REPRODUCED per 018 A1/A3. Everything in §1–§7 that describes a *future* shape is **ASSERTED** and nothing here is TESTED. Ratifying this record moves nothing up the evidence ladder.
- **No numeric grade appears in this record as a Longbox statement** (019 T7, non-waivable). Numbers do appear in two places and only two: quoted from a third-party grader's own label, always with the grader named and inside a citation (the 035 **I6** exemption), and quoted from a published external grading scale in §2.0, attributed to its publisher. Neither is Longbox emitting a grade.
- **A threshold decided here is a decision, not a measurement** (018 A3). §4.1's owner-review floor is a per-shop setting whose **default** is signed at $100; the default moves only by a 006 row.
- **The C-row numbers in §3.4 are provisional.** 021 is not edited by this record; the parent session assigns final numbers and applies the rows (C12–C18, C5 v2, N1–N8) on ratification, after reconciling against any rows another in-flight record proposes the same week. **C5 v2 moves by a 006 decision-log row, not by a 021 edit**, because C5 is ratified in 022 Q7.
- **The `legal-advisor` cannon lens is not counsel.** Every **[counsel]** marker in this record means the item is on the E01-B05 batched engagement's checklist and has not been reviewed by a lawyer.
- **Soft, owner-to-owner language is a constraint on §3, not a style preference.** Every string in §3 has to survive being read aloud by a shop owner to a customer at the counter, and none of them may contain the word "AI" (031 §3; 021 §2).

---

## 1. Three statements and one shape

**Amended at v1.1.0 (product-critic C1).** v1.0.0 called these "the four things that can be said about a book's condition," which put a *format* and three *speakers* in one list and invited exactly the confusion the record exists to remove. **A range is a shape, not a statement.** There are **three condition statements** — the shop's opinion, an estimate, and a certified grade — and they are told apart by **who authored them**. The range is the shape two of the three are written in.

The acceptance criterion for this bead asks the policy to "distinguish estimate / range / shop opinion / certified grade." It does, and the distinction it draws is that one of those four is not the same kind of thing as the other three.

### 1.1 The definitions

**(0) A range — the *shape*, and not a statement at all.** A range is an interval on the word ladder in §2.1: one band word, or two adjacent band words. It is a **format, not a speaker** — nobody authors a range, the way nobody authors "a sentence." Any condition statement Longbox stores, renders or transmits is a range plus named defects; there is no other permitted shape. A range never contains a number and never contains a modifier that stands in for one (§2.1).

**(1) The shop's opinion — the only condition that reaches a listing.** The human's call in the human's words: a range, the defects they named, and an optional free-text note. It is authored by the person holding the book, it is the truth of record for that scan, and **it is the only condition statement that may appear on a listing, in a draft, in a report to the owner, or on any buyer-facing surface.** This is 022 P1 restated at the level of a single field: "The system proposes; a person confirms every identity … calls every condition, and publishes every listing."

**(2) An estimate — internal only, and this is where a machine's condition opinion lives.** An estimate is **any condition value not authored by a person in front of the book**: a model's guess, a defaults table, a value carried forward from a similar copy, a calibration fixture, a value inferred from a photograph. Estimates exist for exactly two purposes — the T8 inter-rater exercise and eval/calibration work (019 T8; 035 §2.5) — and are **never rendered on a screen, never written into a draft, never exported, and never shown to an owner, an employee or a buyer.** An estimate that reaches any of those surfaces is a defect, not a feature.

**(3) A certified grade — somebody else's opinion, printed on somebody else's label.** A numeric grade and label type assigned by a third-party grading service (CGC, CBCS, PGX) and printed on a sealed holder. Longbox records it as an **attribute of the physical object**, with the grader named and the number quoted **as theirs**. It is never restated as ours, never converted onto our ladder, never averaged, never used to compute a price band, a condition proposal, an accuracy figure or anything else. A slab is a thing the shop has; it is not a thing we did.

**The label type is part of the record, not decoration.** CGC publishes fourteen entries on its labels page, of which five are the principal types (§2.0.2), and two of those change what a reseller owes a buyer: **Restored** means the book carries *"evidence of repair"*, and **Qualified** means the grade is conditional on *"a significant defect that needs specific description."* A slab attribute storing only the number would silently discard the half a buyer most needs, so `label_type` is required wherever `label_grade_text` is present. And per §2.0.3 we assert nothing about what a certified grade *means* or guarantees — we quote the label and name the grader, and stop.

### 1.2 The table

| | *(shape)* Range | **(1)** Shop's opinion | **(2)** Estimate | **(3)** Certified grade |
|---|---|---|---|---|
| **What it is** | The permitted *shape* of any condition statement: band word, or two adjacent band words, plus named defects | The human's condition call for one physical copy | Any condition value not authored by a person in front of the book | A third-party grader's numeric grade and label type, printed on a sealed holder |
| **Who authors it** | **Nobody — it is a format, which is the whole point of separating this column from the other three** | The employee (or the owner, on review) | The system, a fixture, or a default | CGC / CBCS / PGX |
| **Where it is stored** | n/a — it constrains the columns to its right | `condition_assessment` — `grade_range_low` / `grade_range_high` under a seven-value CHECK, `defects text[]`, `notes` (`migrations/001_init.sql:122-131`); corrections append via `supersedes_id` with a once-only unique index and the `condition_assessment_current` view (`migrations/003_reserve_principle_slots.sql:84-104`, `:108-112`) | **No table exists today.** Proposed: a separate `condition_estimate` record FK'd to `scan_session`, never joined into the draft path (E08-B03 / E07-B01) | **No storage exists today.** Proposed: a `physical_item` attribute set under 030's `attributes jsonb` — `grader`, `cert_number`, `label_grade_text` (verbatim as printed), `label_type`, `observed_at` (E08-B03 / E02-B07) |
| **Where it may be rendered** | Everywhere a condition appears | Phone condition screen (C15), owner review (033 §7 item 2), listing body (C12) | **Nowhere.** Eval reports and the T8 exercise only, all Restricted internal | Listing slab line (C14) and owner review, always attributed |
| **Disclaimer it carries** | n/a | The not-a-certified-grade line (C13) whenever it reaches a buyer | n/a — it never reaches a buyer | Named grader + quoted number; never "graded by Longbox", never a Longbox range beside it (§2.5) |
| **Evidence rung it can ever reach** | n/a | REPRODUCED (it is a recorded human act) | Internal measurement only; never a claim (021 B5, 019 T8) | SOURCED — it is a third party's assertion, quoted, not endorsed (018 A1) |

### 1.3 The contradiction this record had to resolve, and how

The E08-B01 brief describes (a) as *"the system's proposal … always shown as a proposal until a person confirms."* **Two ratified records say the opposite.** 022 P1: "Condition is a grade range plus named defects, in the employee's plain words." 035 §2.5, rule 1, verbatim: *"The system never proposes a condition. Condition is the human's call in the human's words (022 P1). This axis measures whether the capture gave the human what they needed to make it — not whether a model guessed it."*

Under 018 §3 source precedence a ratified decision record outranks a brief, so **the ratified rule stands and this record does not create a machine condition proposal.** What it does instead is give the machine-authored case a name and a hard boundary: it is an **estimate** (c), it is internal-only, and it may not be rendered. That is a stronger position than the brief's, because it converts 035 §2.5's sentence from an aspiration into something a test can fail (§7 I3).

**Q1, answered at v1.1.0 (product-critic C2): the no-proposal rule stands, and the cost it was supposed to buy is bought by the interface instead.** The argument for a labelled proposal was never really about accuracy; it was about the two taps an operator spends on every book. That is a UI problem and it has a UI answer: **one seven-word ladder, tapped once for a single band and twice for the range between the two taps.** No default, no pre-selection, no machine value — and *fewer* taps than the two dropdowns shipping today, not more. It is routed to **E05-B09** with the undo work, and it is why §7 **I3** now forbids not only a rendered estimate but every suggestion-shaped substitute for one.

The generalisation matters more than the widget: **a proposal does not have to come from a model to be a proposal.** A sticky last range, options ordered by how often the shop picks them, a shop-level default — each is a machine-authored anchor wearing an interface costume, and each would satisfy 035 §2.5's sentence while defeating it. I3 names them.

### 1.4 What ships today, and the five defects this record opens

All REPRODUCED at `7359140`:

| # | What the code does today | Why it violates this record | Owner |
|---|---|---|---|
| **D1** | `public/app.js:233-234` sets `$("grade-low").value = "VG"` and `$("grade-high").value = "FN"` — **the condition screen arrives pre-filled with a machine-authored range** the operator can accept by doing nothing | A default *is* a proposal, and an unlabelled one. It is exactly the case 035 §2.5 forbids and §1.1(c) classifies as an estimate that must never render | E08-B03 (remove the default; no pre-selection) |
| **D2** | `public/app.js:3` `GRADES = ["PR","FR","GD","VG","FN","VF","NM"]`, rendered raw as the option text at `:229` (`o.textContent = g`) — **the screen shows storage codes, not retail words** | 022 P6 fixes the copy as "retail language ('looks Fine to Very Fine, spine ticks, corner wear')"; 004 §Journey 1 step 5 says the same. "VG" is a code, not a word a customer would hear | E05-B02 / E08-B03 (§2.2) |
| **D3** | `src/routes/scanSessions.ts:334-335` composes the condition string — `Condition: ${low}-${high}` with `. Noted: …` appended from the defect array — and `:357` passes it into `descriptionHtml` | The **buyer** is shown storage codes, with **no not-a-certified-grade line and no slab line**. §3's whole point | E10-B04 |
| **D4** | `grep -rn "confirmed by a person\|software assistance" src/ public/ tests/` → **no match**. The 021 C5 provenance sentence is in no draft payload | 022 P8 / Q7 require C5 default-on in the `productSet` template, asserted by a contract test. It does not exist | E10-B04 |
| **D5** | `public/app.js:258` `status("Condition saved.")` — no undo affordance | 021 C9 registers "\<Thing\> saved. Undo", persisting until the next capture starts (022 P2, ≥15 s) | E05-B09 |

None of these is a surprise finding against a stated design; each is a place where a ratified principle has no code behind it yet. They are listed here so the policy does not read as though it describes the shipped product. **This record asserts no condition behaviour as built.**

---

## 2. Terminology

### 2.0 Grounding — the published scales, the label types, and what a certified grade actually is

Every quote below is verbatim with its URL and its access date. Where a source is secondary, or a fetch failed, it says so — per 018 A1 a SOURCED claim is attributed, never endorsed, and per 035's own lesson, *"a research pass that returns a quotation is not the same as a page that contains one."* All access dates **2026-09-04**. The failures are enumerated at §2.0.6 and are part of the record.

#### 2.0.1 The Overstreet ladder — the words are real, and every word maps to a number

**Rewritten at v1.1.1 on a gate-audit finding, and the repair changed more than the citations.** v1.1.0 presented the scale as words mapped to *ranges* (`8.0–8.5 Very Fine`, `7.0–7.5 Fine/Very Fine`) and hung two band definitions off those ranges. **Both were reconstructions.** The published scale maps each word to a **single decimal point**, not a range, and the two quoted definitions sat under different headers than the ones they were given. Re-fetched 2026-09-04 by direct HTTP (raw HTML, not a summarising fetch — which is how the defect was produced in the first place).

**The scale is point-to-word, verbatim** ([edcollins.com](https://www.edcollins.com/comic_book_grading_examples.htm), secondary, reproducing Overstreet; accessed 2026-09-04):

> 10.0 Gem Mint (GM) · 9.9 Mint (M) · 9.8 Near Mint/Mint (NM/MT) · 9.6 Near Mint+ (NM+) · 9.4 Near Mint (NM) · 9.2 Near Mint- (NM-) · 9.0 Very Fine/Near Mint (VF/NM) · 8.5 Very Fine+ (VF+) · 8.0 Very Fine (VF) · 7.5 Very Fine- (VF-) · 7.0 Fine/Very Fine (FN/VF) · 6.5 Fine+ (FN+) · 6.0 Fine (FN) · 5.5 Fine- (FN-) · 5.0 Very Good/Fine (VG/FN) · 4.5 Very Good+ (VG+) · 4.0 Very Good (VG) · 3.5 Very Good- (VG-) · 3.0 Good/Very Good (GD/VG) · 2.5 Good+ (GD+) · 2.0 Good (GD) · 1.8 Good- (GD-) · 1.5 Fair/Good (FR) · 1.0 Fair (FR) · 0.5 Poor (PR) · 0.0 No Grade (NG)

**Overstreet's own access portal carries one prose paragraph per decimal point**, each labelled with its number and word — `8.0 VERY FINE (VF)`, `8.5 VERY FINE+ (VF+)`, `7.0 FINE/VERY FINE (FN/VF)`, `6.0 FINE (FN)`, and so on down to 0.1 ([overstreetaccess.com/grading-definitions](https://www.overstreetaccess.com/grading-definitions/), no publication date shown, accessed 2026-09-04). Verbatim, from that page:

- `8.0 VERY FINE (VF)` — *"An excellent copy with outstanding eye appeal. Sharp, bright and clean with supple pages. A comic book in this grade has the appearance of having been carefully handled…"*
- `8.5 VERY FINE+ (VF+)` — *"Fits the criteria for Very Fine but with an additional virtue or small accumulation of virtues that improves the book's appearance by a perceptible amount."*
- `7.0 FINE/VERY FINE (FN/VF)` — *"An above-average copy that shows minor wear but is still relatively flat and clean with outstanding eye appeal."*
- `6.0 FINE (FN)` — *"An above-average copy that shows minor wear but is still relatively flat and clean with no significant creasing or other serious defects."*

**The edcollins page organises its prose differently, and that is what produced the v1.1.0 error.** Its seven prose sections are headed by **legacy Overstreet *percentage* scores**, not decimal grades — `NEAR MINT (NM, Overstreet 97-90)`, `VERY FINE (VF, Overstreet 89-75)`, `FINE (FN, Overstreet 74-55)`, `VERY GOOD (VG, Overstreet 54-35)`, `GOOD (GD, Overstreet 34-15)`, `FAIR (FR, Overstreet 14-5)`, `POOR (PR, Overstreet 4-1)`. Verbatim opening sentences, under their **actual** headers:

- **VERY FINE (VF, Overstreet 89-75)** — *"An exceptional copy with outstanding eye appeal. Sharp, bright and clean with supple pages. Pages and covers can be yellowish/tannish (at the most), but not brown, and will often be off white to white. Light spine wear is acceptable."*
- **FINE (FN, Overstreet 74-55)** — *"An exceptional, above average copy that show minor wear but still is relatively flat, clean and glossy with no subscription crease or brown margins."*
- **VERY GOOD (VG, Overstreet 54-35)** — *"Generally, this condition represents the average used comic book, one that has not been taken care of."*
- **GOOD (GD, Overstreet 34-15)** — *"Comics in this condition have all pages and covers, although there may be small rips or tears."*
- **FAIR (FR, Overstreet 14-5)** — *"Comics in this condition are very heavily read and soiled, but still complete."*
- **POOR (PR, Overstreet 4-1)** — *"Comics in this condition have an aggregate of defects so extensive as to render them all but uncollectible in most cases."*
- **NEAR MINT (NM, Overstreet 97-90)** — *"A nearly perfect copy with only minor imperfection allowed."*

**What v1.1.0 got wrong, itemised, because the corrections cut in our favour and that is exactly when a record is most likely to skip them.** *"Sharp, bright and clean with supple pages"* is the **Very Fine** section, not "9.0–9.6". *"Relatively flat, clean and glossy"* is the **Fine** section, it is a truncation — the sentence continues *"with no subscription crease or brown margins"* — and it is not "7.0–7.5". The *"average used comic book"* line is **Very Good**, not "5.0–5.5 Very Good/Fine". The *"small rips or tears"* line is **Good**, not "3.0–3.5". And the two pages **do not agree at the word level** even where they cover the same grade: Overstreet's portal opens 8.0 with *"An excellent copy"*, edcollins' VF section with *"An exceptional copy."* The disagreement is recorded, not resolved.

**Reliability caveat, unchanged and now better founded:** Overstreet's own primary domains (overstreet.com, gemstonepub.com) were **never successfully fetched**. The point-to-word scale rests on the edcollins reproduction; the per-decimal prose rests on Overstreet's access portal. Treat both as SOURCED with the secondary caveat, and treat the *percentage* headers as edcollins' own editorial framing rather than as anything this record asserts.

**Two things this establishes, and they pull in opposite directions.** The words are real, public, and defined — so a word ladder is not something Longbox invented and a customer cannot look up. **And the published scale is even more damning for modifiers than v1.1.0 claimed.** The reconstruction had `8.0–8.5 Very Fine`, which merely suggested a modifier lived somewhere inside a range. The real mapping is `8.0 Very Fine (VF)` and, one line below it, **`8.5 Very Fine+ (VF+)`** — the plus is not *like* a numeric step, **it is a numbered grade point with a plus sign as its name** (§2.1 argument 3). Likewise `7.0 Fine/Very Fine (FN/VF)` is a single point, which is why §2.2 renders a Longbox range as **"between Fine and Very Fine"** — not as "FN/VF", whose punctuation names that point, and (after the v1.1.0 amendment) not as "Fine to Very Fine" either, which a trade reader hears as the same thing.

#### 2.0.2 CGC's label types, in CGC's own words

CGC's labels page publishes a **longer list than the five that matter here** — fourteen entries in all, including CGC×JSA Authentic Autograph, Pedigree, Custom, No Grade, Individual Page and Cover labels, and three Signature Series combinations. **The five below are the principal types and the only ones this record acts on**; the count is stated so a later reader does not take five for the whole taxonomy. Descriptions are CGC's own ([cgccomics.com/grading/labels](https://www.cgccomics.com/grading/labels/), no publication date shown, accessed 2026-09-04 — **primary**):

| Label | CGC's description (verbatim fragments) |
|---|---|
| **Universal** (blue) | given to collectibles that are *"simply the grade as marked, with any special information…noted"* |
| **Signature Series** (yellow) | applied where signatures are *"witnessed under direct observation of a CGC or JSA authorized representative"* |
| **Qualified** (green) | used for items with *"a significant defect that needs specific description"* |
| **Restored** (purple) | applied to comics showing *"evidence of repair so that it will appear as it did when it was in its original condition"* |
| **Conserved** | repairs done *"to improve the structural integrity and long-term preservation"* |

CGC's own scale runs on the same 0.5–10.0 axis: *"10.0 (Gem Mint): The highest grade assigned. The collectible must have no evidence of any manufacturing or handling defects"* … *"0.5 (Poor): A heavily defaced collectible with a number [of] major defects. Some pieces will also be missing"* ([cgccomics.com/grading/grading-scale](https://www.cgccomics.com/grading/grading-scale/), accessed 2026-09-04, primary). Corroboration of these five and their colours at [gocollect.com](https://gocollect.com/blog/cgc-101-what-is-cgc-what-do-cgc-labels-mean/) (secondary, accessed 2026-09-04) — which also lists five, and is therefore corroboration of the principal set, **not** evidence that the published taxonomy stops there.

**Why the label taxonomy is in this record and not just in a schema comment.** `label_type` is not decoration — and the fourteen-entry list is the reason the field is **free text as printed** rather than an enum of five: **Restored** and **Signature Series** are the two labels that carry a disclosure consequence for a reseller (§2.4), and **Qualified** means the grade is conditional on a described defect. A slab attribute that stored only a number would silently discard the part a buyer most needs.

#### 2.0.3 What a certified grade actually is — and the finding that neither certifier warrants it

This was the single most important thing to source, and the honest answer is a **negative finding, stated as such**:

**Neither CGC nor CBCS publishes a clean, verbatim "grading is an opinion, not a warranty" clause on its live public terms pages.** CGC's terms were fetched and searched in full on two independent passes and contain **no** grading-opinion language at all. What exists is a general warranty disclaimer, in Section 23:

> *"EXCEPT FOR ANY EXPRESS WARRANTIES SET FORTH IN THESE TERMS AND CONDITIONS, EACH COMPANY DISCLAIMS ANY AND ALL WARRANTIES, EXPRESS OR IMPLIED, REGARDING SUCH COMPANY AND / OR THE SERVICES, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE."*

([cgccomics.com/legal/terms-and-conditions](https://www.cgccomics.com/legal/terms-and-conditions/), accessed 2026-09-04, primary; CBCS carries a parallel general disclaimer at [cbcscomics.com/terms](https://www.cbcscomics.com/terms), accessed 2026-09-04, **primary but incompletely rendered on fetch**).

The nearest thing to a statement about the *nature* of a grade is in CGC's FAQ — **not** a legal or contractual instrument:

> *"CGC realizes that comic book grading is an art that develops from years of experience, and while our consistently applied standard of grading eliminates much of the subjectivity and risk, grading itself is not an exact science. That's why it is reasonable to expect that slight variances may exist between CGC grading standards and the standards of some dealers and collectors, as well as comics that have been previously graded by CGC since its inception."*

([cgccomics.com FAQ — about CGC grades](https://www.cgccomics.com/about/help-center-faqs/cgc-grading/about-cgc-grades/), accessed 2026-09-04, primary FAQ, **not a disclaimer**).

**What we take from this, and what we do not.** We take that *"grading itself is not an exact science"* is the certifier's own published position, and that a certified grade is a **service output backed by a brand, a process and an encapsulation — not a warranty of the book's state.** We do **not** take, and this record does not assert, any characterisation of what a certified grade is *legally*: no primary contractual language establishing "opinion, not warranty" was obtained, a secondary lead about CBCS submission-form language could not be extracted from the PDFs and is **not** relied on, and characterising a third party's legal instrument is exactly the kind of statement that goes to counsel, not to a builder. **§3's C14 slab line is written to survive this uncertainty**: it quotes the label, names the grader, and asserts nothing about what the grade means.

#### 2.0.4 The regulatory frame for a description of used goods

Three primary FTC documents bound what §3 may say. All fetched directly.

**The deception standard**, verbatim, from the FTC Policy Statement on Deception, 1983-10-14 (appended to *Cliffdale Associates, Inc.*, 103 F.T.C. 110, 174 (1984)):

> *"Certain elements undergird all deception cases. First, there must be a representation, omission or practice that is likely to mislead the consumer… Second, we examine the practice from the perspective of a consumer acting reasonably in the circumstances… Third, the representation, omission, or practice must be a 'material' one. The basic question is whether the act or practice is likely to affect the consumer's conduct or decision with regard to a product or service."*

([ftc.gov, 831014deceptionstmt.pdf](https://www.ftc.gov/system/files/documents/public_statements/410531/831014deceptionstmt.pdf), published 1983-10-14, accessed 2026-09-04, primary).

**Substantiation** — the "reasonable basis" requirement, from the FTC Policy Statement Regarding Advertising Substantiation, 1984-11-23 (appended to *Thompson Medical Co.*, 104 F.T.C. 648, 839 (1984)): advertisers must have *"a reasonable basis for advertising claims before they are disseminated"* ([ftc.gov legal library](https://www.ftc.gov/legal-library/browse/ftc-policy-statement-regarding-advertising-substantiation), accessed 2026-09-04, primary document; this fragment came back through a summarising fetch rather than a page-by-page read, so treat it as marginally lower-confidence than the deception quote above).

**Disclosure placement**, from *.com Disclosures: How to Make Effective Disclosures in Digital Advertising*, March 2013:

The guidance requires that disclosures *"must be presented 'clearly and conspicuously'"*, lists among the factors *"the placement of the disclosure in the advertisement and its proximity to the claim it is qualifying"*, and states plainly:

> *"A disclosure is more effective if it is placed near the claim it qualifies."*

([ftc.gov, bus41 .com Disclosures PDF](https://www.ftc.gov/system/files/documents/plain-language/bus41-dot-com-disclosures-information-about-online-advertising.pdf), published March 2013, accessed 2026-09-04, primary). **Citation-hygiene note (v1.1.1):** v1.1.0 rendered these three as a single blockquote that appears nowhere on the page as one passage. The sentences above are the page's own; the stitching was ours, and it is exactly the defect 035 v1.0.1 recorded — *"a research pass that returns a quotation is not the same as a page that contains one."*

**How these three shape §3, concretely.** The substantiation standard is why **A1 (numeric grades with a disclaimer) is not available to us**: we have no reasonable basis for a numeric grade taken from a phone photograph, so the disclaimer is not curing a marginal claim — it is retracting an unsubstantiated one. The proximity rule is why **C13 sits directly under C12 rather than in a shop's footer or a policy page**, and why C14 *replaces* C13 on a slabbed book instead of stacking beneath it. The materiality limb is why the disclosure-tier defects (§2.4) force owner review at any price: a restoration disclosure is material by construction, since it is *"likely to affect the consumer's conduct or decision."*

**This is a reading of published guidance by a non-lawyer for the purpose of drafting product copy. It is not legal advice and it is not a compliance conclusion.** §3 goes to outside counsel with the E01-B05 batch.

#### 2.0.5 What working retailers actually say — and one that says exactly what we say

The most useful finding in the whole pass: **a major retailer already publishes Longbox's position.**

- **Midtown Comics** states it outright: *"Midtown Comics does not grade or consider any type of numbered grading scale when determining a comic books condition."* (verbatim, including the page's own missing apostrophe). Its band copy is plain retail English — Near Mint: *"Covers as pristine as possible, with allowances for paper stock, printing errors, binding, and the handling process."* Very Fine: *"Covers are shiny and smooth beyond a very modest number of dings 'n' dents."* Good: *"Cover is intact, but may be folded, feature tears, creases, wrinkles, and peripheral pen/pencil marks."* ([midtowncomics.com/grading-policy](https://www.midtowncomics.com/grading-policy), no date shown, accessed 2026-09-04, primary).
- **MyComicShop — SOURCED-then-unverifiable, and read with that label on.** The first pass returned two strings: that its standards are grounded in Overstreet *"with additional experience gained from their 40+ years in the comic industry"*, and the quiet part said in public — *"Grading is an inherently subjective process and there will always be small differences in opinion, with even professional grading services like CGC and CBCS acknowledging that the same book may not always receive the same grade if submitted for grading more than once."* **The page has since returned blank on three separate fetches** ([mycomicshop.com/help/grading](https://www.mycomicshop.com/help/grading), no date shown, first returned 2026-09-04, **not reproducible on re-fetch 2026-09-04**), so it also sits in the §2.0.6 dead-end table. It is not withdrawn — a page that rendered once and then stopped is a fetch failure, not a fabrication — but **it may not be quoted onward from this record without a fresh, successful fetch**, and anything resting on it is marked below.
- **Mile High Comics** defines its bands by allowance — Near Mint permits *"Only a very minor (1/8th inch or less) tear"*; Very Good books *"are firm, tight comic books. They are not significantly damaged"*; Good books *"are primarily for reading"* and are not *"considered 'investment-grade.'"* And on the top of the ladder: *"'Mint' is a standard that is too difficult to define. All comics have some flaws."* ([milehighcomics.com/information/grade.html](https://www.milehighcomics.com/information/grade.html), no date shown, accessed 2026-09-04, primary).
- **The raw-listing convention** on the open market is grade-plus-defect-callout in the title itself — e.g. *"Simpsons Comics #1 1993 VF- with some spine stress: see pics\* Poster Inside!\*"* ([ebay.com/itm/315595540923](https://www.ebay.com/itm/315595540923) — **the listing body 403'd; the title was captured from a search snippet only** and is reported as an illustration of convention, not as a verified page).
- **eBay does not force the question.** *"Item condition will NOT be mandatory in Comics"* ([pages.ebay.com item-condition lookup](https://pages.ebay.com/sellerinformation/sellingresources/itemconditionlookup.html), accessed 2026-09-04, primary). eBay's nearest authored condition-language standard is its **Trading Cards** guide, not a comics one — *"the most significant flaw will anchor the condition of the card"* ([pages.ebay.com/cardconditions](https://pages.ebay.com/cardconditions/), accessed 2026-09-04, primary but **not comics-specific**). eBay's item-description policy page itself returned a security-verification screen and **was not retrieved**; nothing in this record relies on it.

**Three conclusions, and they are the spine of §2 and §3.**

1. **Not assigning a numerical grade is established retail practice, not an eccentricity.** Midtown says so on its own grading page, in its own words — and note how much stronger the actual sentence is than the paraphrase v1.1.0 carried: not merely that it *does not assign* numbers, but that it does not *consider any type of numbered grading scale* at all. Locked decision 5 puts Longbox in company, not in the wilderness. This corroborates 032 §1.3's finding — a live back-issue catalogue running condition as a word ladder with *"never a number"* — from a second, independent direction.
2. **Retailers already say grading is subjective, in their own voice, on their own site — and this conclusion rests on the unverifiable source.** MyComicShop says it about CGC and CBCS by name, which is why C13 and C17 read as the register the trade already writes in rather than as an unusual admission. **Conclusion 2 and the register argument behind C13 and C17 therefore lean on a page that is SOURCED-then-unverifiable**, and that is stated rather than buried. Two things keep the conclusion standing anyway: Midtown's page (still reachable) is an independent retailer publishing an even stronger position, and CGC's own FAQ — primary, reachable, quoted at §2.0.3 — says *"grading itself is not an exact science."* **If MyComicShop never comes back, the conclusion survives on those two; the specific claim that a *retailer* names CGC and CBCS in public does not, and must not be repeated onward.**
3. **"Mint" is a word the trade itself declines to define.** Mile High says so outright, which is the sourced basis for **N5**.

#### 2.0.6 What could not be reached, and one number that does not exist

Recorded because 018 requires it and because a later reader will otherwise repeat the work.

| Source | Symptom |
|---|---|
| Overstreet's own domains (overstreet.com, gemstonepub.com) | never successfully fetched; §2.0.1 rests on the access portal plus a secondary reproduction |
| `mycomicshop.com/help/grading` | **rendered once, then blank on three subsequent fetches.** Its two quotes are **SOURCED-then-unverifiable** (§2.0.5); §2.0.5 conclusion 2 and the register argument for C13/C17 lean on them and say so |
| `en.wikipedia.org/wiki/Comic_book_grading` | 404 |
| `comicconnect.com/article/grading_criteria` | 403 |
| `comics.ha.com/tutorial/comics-grading.s` (Heritage grading guide) | 403 — the same 403 035 §2.5 already recorded against this page |
| `covrprice.com/grading-comics-101/` | 403, on two separate passes |
| CBCS submission-form PDFs (three) | binary/compressed; text could not be extracted. A secondary lead that they contain "subjective opinion" language is **not relied on anywhere in this record** |
| `cbcscomics.com/terms` | rendered incompletely |
| `cgccomics.com/grading/cgc-grader-notes-disclaimer/` | rendered, but contains only page-completeness warranty language — no grading-opinion clause |
| eBay item-description policy (`id=4372`) | automated security-verification screen; not retrieved |
| eBay raw listing `315595540923` | 403 on the full listing; title from a search snippet only |
| `ecfr.gov` title 16 part 23; the GovInfo PDF | 302 to an access-control interstitial; 404 respectively. **16 CFR Part 23 was never reached**, so no view was formed on whether the jewellery guides contain an analogous grading-opinion rule |
| several stale ftc.gov paths | 404; the working URLs are the three cited in §2.0.4 |

**One methodological note from the v1.1.1 repair, because it caused two of the six findings.** The pages that produced bad quotes were read through a **summarising fetch**, which returns a model's rendering of a page rather than the page. Re-fetching `edcollins.com` and `overstreetaccess.com/grading-definitions` by **direct HTTP over raw HTML** on 2026-09-04 succeeded immediately and produced the verbatim text in §2.0.1 — including the fact that the two pages disagree at the word level. **Where a quotation is load-bearing, fetch the bytes.** Overstreet's own domains remain unreachable and that row above stands.

**And the number that does not exist.** Roughly twenty distinct searches across the CGC and CBCS boards, eBay's seller and community resources, Heritage, ICv2 and GoCollect returned **zero published dispute or return statistics comparing graded and raw comics** — no rate, no count, no aggregate. Only opinion, e.g. GoCollect's *"Once graded there is no dispute, but an ungraded comic gives a seller the advantage of wishful thinking"* (accessed 2026-09-04, **anecdotal, not data**).

**Therefore: no Longbox artifact may state, imply or estimate a dispute-rate difference between graded and raw books, internally or externally.** Not as a benchmark for T9, not as a pilot expectation, not as a sentence to a shop. 031 §3's already-recorded collector-forum framing — *"a slab does not make a comic more valuable; it makes it more sellable by removing condition disputes"* — is the strongest available statement and it is **REPORTED sentiment**, not a measurement. This is proposed as an extension of the 021 §2 retirement list: **the graded-versus-raw dispute comparison is retired as a quantitative claim, and may return only with a published source carrying N, denominator and date.**

### 2.1 The ladder, and the plus/minus question — decided

**The Longbox ladder is the seven band words, and only those seven:**

| Code (storage only) | Band word (the only form that renders) |
|---|---|
| `PR` | Poor |
| `FR` | Fair |
| `GD` | Good |
| `VG` | Very Good |
| `FN` | Fine |
| `VF` | Very Fine |
| `NM` | Near Mint |

This is what `src/services/condition.ts:3` and the CHECK constraint at `migrations/001_init.sql:126-127` already enforce, and it is the trade's own published ladder (§2.0).

**Decision: `+` and `−` modifiers are NOT part of the Longbox ladder in v0.** Four reasons, in order of weight:

1. **A range already carries the granularity a modifier carries, and carries it honestly.** "between Fine and Very Fine" and "Fine+" cover the same ground; the range says out loud that it *is* an interval, and the modifier disguises the same doubt as precision. Locked decision 5 exists to stop condition from pretending to a precision it does not have, and a modifier is the smallest possible way to break it.
2. **Modifiers triple the enum and make the range rule ambiguous.** Seven labels become twenty-one, the "adjacent" relation the T8 threshold is defined against (019 T8: "≥80% same range, ≥95% adjacent") stops meaning one thing, and `validGradeRange`'s ordering (`src/services/condition.ts:28-35`) has to encode a total order that no published source states unambiguously.
3. **A modifier is not a number *wearing a costume*; on the published scale it simply is a number.** §2.0.1's point-to-word mapping lists `8.0 Very Fine (VF)` and, one line below, **`8.5 Very Fine+ (VF+)`** — the plus is the *name of grade point 8.5*. Likewise `9.6 Near Mint+`, `6.5 Fine+`, `4.5 Very Good+`, and the minus grades. Storing "VF+" is storing 8.5 with the digits filed off, and T7 is non-waivable. *(Sharpened at v1.1.1: v1.1.0 argued this from a reconstructed range and the real mapping makes the point outright.)*
4. **It costs the operator time on every book** to make a distinction 022 P4 says we should not be asking them for.

**What the shop loses, stated plainly, because 032 §1.3 shows a live seller using nine labels *with* modifiers.** A shop whose existing catalogue words are "Very Fine +" cannot reproduce that string from a Longbox range alone.

**Q2, answered at v1.1.0: E10-B04's per-shop vocabulary mapping closes it, and nothing enters our schema.** The listing template already has to render a shop's own catalogue words; a shop that transacts in "Very Fine +" maps **out of** the range at render time, in its own template, without a single modifier reaching `condition_assessment`, `validGradeRange`, T8's adjacency relation or the eval labels. The mapping is lossy in the shop's favour and that is correct: the shop is choosing to state something narrower than the operator observed, in its own voice, on its own listing. What we refuse is to *store* the narrower thing as though we knew it. The free-text `notes` field remains available for the operator's own words in either case.

### 2.2 The display rule — words on every surface, codes only in storage

**Invariant (§7 I1): the seven two-letter codes are storage identifiers and appear on no human-visible surface** — not the condition screen, not the owner review, not the listing body, not an export, not a report. Every rendering is the full band word, and a two-band range renders as **"between X and Y"** — never "X-Y", never "X/Y", and, **amended at v1.1.0, never "X to Y"**.

- On a screen: *"between Very Good and Fine"*.
- On a listing: the C12 pattern in §3.1.
- `src/services/condition.ts:38-40` `gradeRangeLabel()` currently returns `"VG-FN"`. It is the storage-side helper and keeps that job; a second, display-side function returning band words is E08-B03's, and D2/D3 are its acceptance cases.

**Why "between X and Y", and why v1.0.0's "X to Y" was wrong (product-critic B1).** v1.0.0 argued that the slash was taken — the trade writes "VF/NM" and means a specific published grade, **point 9.0** (§2.0.1) — and then chose *"Fine to Very Fine"*. **The critic's finding is that this fails on its own argument.** To a reader who knows the trade, "Fine to Very Fine" is not heard as an interval at all; it is heard as **FN/VF**, which the published scale names as the single point **7.0**, because that is precisely how the ladder's compound names are spoken. We would have declined the modifier in §2.1 and then reintroduced it in the copy, to exactly the audience most likely to price on it.

**"between Fine and Very Fine" cannot be read that way.** "Between" is a word about an interval and about nothing else; there is no rung on any published scale called "between Fine and Very Fine." It is two syllables more expensive and it is unambiguous, and this is the one place in the record where the buyer's reading matters more than the sentence's economy.

**One acknowledged divergence, recorded rather than smoothed.** 022 P6, which is ratified, illustrates retail language with the phrase *"looks Fine to Very Fine, spine ticks, corner wear"*, and 004 §Journey 1 step 5 uses *"looks Fine to Very Fine"*. Those are **illustrations of register, not registered strings** — the registered copy is 021 §3.1's C-rows, and no C-row carries that phrasing. C12 therefore diverges from an example in a ratified record without amending it. If a later reader treats 022 P6's example as binding copy, this paragraph is the answer: it was an example, the reasoning above is why the example is not the string, and 022's own §2 leaves the exact strings to 021 "revisable by a 006 row without reopening this record."

### 2.3 The defect vocabulary — the reconciled list, proposed as the E08-B03 backlog

Two lists exist and disagree. `DEFECT_OPTIONS` at `src/services/condition.ts:6-19` carries **twelve** values. 035 §2.5's cohort table names **eleven** defect rows drawn from the trade's published glossaries, and 035 says so itself: *"`tape` and the cut/missing coupon are not among them, and this record's subscription-crease row maps onto `cover_crease` only loosely. That is a gap this record surfaces and does not close: the defect vocabulary is **E08-B01's decision**."*

This is that decision. **The reconciled list is nineteen options in three tiers.**

| # | Option | Status vs today | Maps to 035 §2.5 row | Tier |
|---|---|---|---|---|
| 1 | `spine_ticks` | exists | spine ticks / stress marks | common |
| 2 | `spine_roll` | exists | spine roll | common |
| 3 | `corner_wear` | exists | — (not a 035 row; kept: it is the second thing 004 §Journey 1 names) | common |
| 4 | `cover_crease` | exists — **narrowed** | (see 5) | common |
| 5 | `crease_color_breaking` | **new** | colour-breaking crease | common |
| 6 | `subscription_crease` | **new** | subscription crease / fold | common |
| 7 | `tears` | exists | — | common |
| 8 | `water_damage` | exists | water damage / staining | common |
| 9 | `foxing` | exists | foxing / tanning / brittleness | rare |
| 10 | `tanning` | exists | foxing / tanning / brittleness | rare |
| 11 | `writing` | exists | writing / arrival-date stamp / price in pen | common |
| 12 | `tape` | **new** | tape (cover or interior) | rare |
| 13 | `cut_or_missing_coupon` | **new** | cut or missing coupon | rare |
| 14 | `detached_cover` | exists | detached or split cover | rare |
| 15 | `missing_pages` | exists | — | rare |
| 16 | `restoration_suspected` | exists as `restoration` — **renamed** | restoration or trimming suspected | **disclosure** |
| 17 | `trimming_suspected` | **new** — split out of 16 | restoration or trimming suspected | **disclosure** |
| 18 | `married_copy_suspected` | **new** | — (§2.4) | **disclosure** |
| 19 | `signature_unwitnessed` | **new** | — (§2.4) | **disclosure** |

**Three structural decisions inside that table.**

1. **`cover_crease` is narrowed, not deleted.** 035 quotes the trade's line that a colour-breaking crease *"breaks color, usually leaving a visible white line"* and calls it *"the line between two grade ranges for most books"* — so the distinction is the single most consequential one on the list and cannot ride inside one option. `cover_crease` keeps the non-breaking case; `crease_color_breaking` takes the breaking case. **Existing rows are not rewritten** (the table is append-only, `migrations/001_init.sql:175-181`); a pre-change row saying `cover_crease` means what it meant when it was written, and E08-B03 records the vocabulary version on the row rather than migrating history.
2. **`restoration` splits into `restoration_suspected` and `trimming_suspected`, and both gain the word "suspected."** A shop employee at a long box can see evidence of restoration; they cannot certify its absence, and they are not being asked to. The suspicion is the disclosable fact (§2.4), and the word "suspected" is what keeps the callout from becoming a claim the shop cannot substantiate.
**One option is not damage, and the capture flow must not treat it as such (product-critic C6).** `signature_unwitnessed` is a **feature** of the copy — a signature is why some buyers want the book — and it sits in the `disclosure` tier only because it carries a disclosure obligation about what we *cannot* say (§2.4: we never authenticate). It is therefore captured as a fact about the copy and **not** inside the "anything that needs saying?" damage prompt; C15 at v1.1.0 drops it from that sentence. E08-B02 decides where it lands instead.

3. **Three tiers on the screen, not nineteen checkboxes.** Nineteen boxes on a phone is a grading exam, which 022 P4 forbids in as many words. The proposed capture shape is: the eight `common` options as taps, a "something else" expander holding `rare`, and the four `disclosure` options **always visible and always last**, because they are the ones whose omission costs somebody money. The exact layout is **E08-B02's**, not this record's; what this record fixes is the vocabulary and the tiering rationale.

**Two options in today's code survive with no 035 row behind them** — `corner_wear` and `tears` — and they stay, because 004 §Journey 1 step 5 names corner wear as one of the two examples an employee would say out loud, and a tear is not a crease. **`missing_pages` also stays** even though nothing in a cover photograph can find it: like the coupon row, it is a defect the operator discovers by handling the book, which is the whole reason a person is holding it.

### 2.4 Restored, married, trimmed, pressed, signed — what each means and how each is disclosed

**Sourcing, honestly, before the table.** Two of these five have published definitions from a primary source, and three do not.

- **Restored** is defined by CGC itself, as the basis of a label: a comic showing *"evidence of repair so that it will appear as it did when it was in its original condition"* (§2.0.2, primary). The trade's glossary form, carried through 035 §2.5, is broader — *"Any attempt to improve or repair a comic's appearance"*, including colour touch, glue and trimming (Comic Crusaders via 035, fetched 2026-09-03). CGC additionally distinguishes **Conserved** work done *"to improve the structural integrity and long-term preservation"* (§2.0.2).
- **Signed** is bounded by CGC's Signature Series definition: the label attests a signature *"witnessed under direct observation of a CGC or JSA authorized representative"* (§2.0.2, primary). That is the whole of what "witnessed" means, and it is a service we are not performing.
- **Trimmed**, **married** and **pressed** have **no verbatim published definition captured in this pass.** The trade uses all three in a stable way and 035's restoration row folds trimming into restoration by the glossary's own wording, but the Heritage grading guide that would have defined them 403'd (§2.0.6) — the same 403 035 already recorded. **The descriptions below are the author's statement of ordinary trade usage, ASSERTED, not SOURCED**, and E08-B03 should re-source them before the words reach a screen.

| Term | What it means | How Longbox discloses it | Why the rule is that way |
|---|---|---|---|
| **Restored** | Work done to improve appearance — colour touch, glue, tear seals, piece replacement | `restoration_suspected` defect + the C16 restoration line on the listing + **mandatory owner review before publish** (§4.1 trigger 2) | The single largest value swing a raw book can carry, and the disclosure a buyer is most likely to litigate. It is disclosed as *suspicion*, in the shop's voice, never as a finding |
| **Trimmed** | Edges cut down to remove wear — a form of restoration that is often not disclosed by the seller who did it | `trimming_suspected`, same treatment as restored | Trimming is the case where the book *looks* better than its true state, so the failure mode is a buyer paying a high-band price for a low-band book. Same trigger, same line |
| **Married** | A copy assembled from more than one physical book — a cover from one, interior from another | `married_copy_suspected`, same treatment | Same disclosure logic; different physical evidence. Named separately because an operator who can see it can say it, and folding it into "restoration" loses the fact |
| **Pressed** | Pressure applied to reduce non-colour-breaking defects. Commonly **not** treated by the trade as restoration — **ASSERTED, unsourced in this pass** | **Not a capture-vocabulary option (N7b). If the shop *knows* pressure was applied, it goes in the condition notes.** Silence means the shop does not know — it never means the shop chose not to say | See the rule below the table: v1.0.0's "the honest policy is silence" was wrong as written, and the cannon was right to block it |
| **Signed** | A signature on the book. The trade distinguishes a **witnessed** signature (a grader's representative present, which is what a Signature Series label attests) from an unwitnessed one | `signature_unwitnessed` + the shop's own words in `notes`. **Longbox never authenticates a signature** and no Longbox copy calls one authentic, genuine or verified | Authentication is a service with a chain of custody behind it. We have a photograph. Saying anything stronger than "there is a signature on this book" would be a claim with no evidence under it (018 A3) |

**The rule that covers all five:** Longbox records what the person in front of the book *observed and said*, in the shape of a suspicion, and never converts an observation into a determination. A determination is what a grading service sells (§2.0), and 021 A2 is the whole of what we say about the difference.

**The pressing rule, rewritten at v1.1.0 (legal-advisor BLOCK).** v1.0.0 said the honest policy for pressing was "silence." **That was wrong, and it was wrong in a way that mattered**: a rule phrased as silence does not distinguish *not knowing* from *not saying*, and a shop that presses its own books, or buys from someone who told it they were pressed, would have read v1.0.0 as permission to leave a known material fact off the listing. That is not a disclosure policy; it is a policy of omission with a disclosure policy's vocabulary. Under the FTC standard at §2.0.4, an **omission** likely to mislead a reasonable consumer on a material point is deception in exactly the same way a false statement is — the word "omission" is in the quoted text.

**The rule, in four sentences:**

1. **If the shop knows pressure was applied, it goes in the condition notes.** Known is known — from the shop's own bench, from the seller who told them, from paperwork that came with the book. There is no threshold and no price floor on this.
2. **Silence means the shop does not know.** It never means the shop knew and chose not to say.
3. **An operator who merely suspects pressing, with no evidence beyond a book that looks better than its age, does not call it.** A suspicion with nothing behind it is not a disclosure, it is a slur on the book, and unlike restoration or trimming there is nothing on the object for the operator to point at.
4. **A later buyer discovery does not fault a shop that did not know.** It is a dispute handled under §5 like any other, and it is a system finding only if Longbox suppressed something the shop *did* know.

**Why pressing is still not a defect option (N7b).** Putting `pressed` on the capture screen would produce exactly the false calls rule 3 forbids: the tap is cheap, the evidence is invisible, and an option that exists gets used. Notes are the right home because a note requires the operator to write a sentence, and a person who cannot write the sentence does not have the fact. **[counsel]** — this is a disclosure rule about a material characteristic of goods and it goes to the E01-B05 batched pass with the rest of §3.

### 2.5 The words we never use

Additive to the 021 §1 blocklist and §2 retirement list; every row here is proposed as an extension, not a restatement.

| # | Never said, in any class | Why |
|---|---|---|
| N1 | Any number as a Longbox grade — a digit, a decimal, a percentage, a "9.8-equivalent", a "high grade" that resolves to a number in a tooltip | 019 T7, non-waivable. The **only** numbers permitted near a condition are quoted from a named grader's own label (§1.1(d), 035 I6) |
| N2 | "Graded by Longbox", "Longbox grade", "our grade", "we graded it" | We do not grade. 021 §2 retires "AI grades" / "automated grading"; this closes the same door with the vendor's name instead of the technology's |
| N3 | "AI" in any shop-facing or buyer-facing sentence about condition | 031 §3: no retailer statement welcoming AI listing or image recognition was findable, and SDCC banned AI-created material from its art show in January 2026. 021 B14 already forbids "AI graded" on a listing; this extends it to the whole condition surface |
| N4 | "Certified", "certification", "authenticated", "verified", "guaranteed" applied to anything that is not a third-party slab | A certification is a specific commercial instrument with a named issuer, a label taxonomy and an encapsulation behind it (§2.0.2). Borrowing the word without the issuer is a representation *"likely to mislead the consumer acting reasonably in the circumstances"* on a fact *"likely to affect the consumer's conduct or decision"* — the FTC deception standard's first and third limbs, quoted at §2.0.4. 021 §2 already retires "verified"/"validated"/"proven" generally; this row closes the condition-specific case |
| N5 | "Mint" as a Longbox band | Not on our seven-word ladder (§2.1), and the trade itself declines to define it: *"'Mint' is a standard that is too difficult to define. All comics have some flaws"* (Mile High Comics, §2.0.5). Offering a word its own publishers cannot pin down invites its misuse |
| N6 | A Longbox range printed **beside** a slab's number, on the same line or the same block | It reads as a comparison, an endorsement or a second opinion, and it is none of those. A slabbed book gets the slab line (C14) and no Longbox range at all (§4.1 trigger 3) |
| N7 | "Investment", "will appreciate", "key issue" as a value claim in condition copy | Condition copy describes the object. A forward-looking value statement is a different claim on a different evidence base and it is not ours to make on a listing |
| **N7b** | **"Pressed" as a capture-vocabulary defect option** — on the condition screen, in `DEFECT_OPTIONS`, in a prompt or as a tap of any kind | §2.4: the tap is cheap and the evidence is invisible, so an option that exists gets used falsely. Pressing reaches a listing **only** through the condition notes and **only** when the shop knows (§2.4 rule 1). This row forbids the *option*, never the disclosure. **[counsel]** |
| **N8** | **Adjacency and naming.** (i) No artifact — deck, demo, screen recording, screenshot, app-store or marketplace copy, help page, onboarding flow — may place a condition value **adjacent to a model output**, in the same card, row, panel, sentence or animation, so that a reader could take the machine to have produced the condition. (ii) No field, column, metafield, API key, event name, log key or UI label anywhere on the condition path may be named with **`ai`, `auto`, `predicted`, `suggested`, `estimated`, `recommended`** or an obvious cognate. (iii) **No demonstration of the condition flow is recorded or shown until D1 is removed** | product-critic B2. The 021 §2 retirement list governs *sentences*; a layout, a field name and a screen recording are none of them, and each can make the claim the sentences forbid. A demo of today's build shows a condition screen **arriving pre-filled** (D1) and a viewer reasonably concludes the software proposed it — which would be the first "AI grading" claim we ever made, made by a video with no words in it. The naming half is the same failure in a schema: a column called `suggested_grade` is a claim that survives every copy review, ships in an API response and is read by a partner's engineer, not a copywriter |

---

## 3. Disclaimer language — the exact strings, proposed as 021 rows

Every string below is written to three constraints at once: **soft, owner-to-owner** (Jeremy's standing instruction); **no "AI"** (031 §3, N3); and **no claim above its rung** (018 A3). None of them is usable until 021 carries it and it passes the T26 pre-send step.

### 3.1 The listing block

A listing's condition block is **three lines in fixed order**: the condition line, then exactly one of the two disclaimer lines, then the restoration line if it applies. **A raw book always carries 2a and a slabbed book always carries 2b — never both, never neither** (invariant I4). The FTC proximity rule (§2.0.4) is why the disclaimer sits directly under the condition line rather than in a footer or on a policy page.

**Line 1 — the condition line (C12).** Pattern, **amended at v1.1.0** (product-critic B1 for the wording, legal-advisor for the removability clause):

> **Condition: between {band word} and {band word}.** *(single band: **Condition: {band word}.**)* **{"We noted: " + defects, in plain words, comma-separated + "." if any}{" " + the shop's note, verbatim, if any} Photos are of the actual book.**

Rendered: *"Condition: between Fine and Very Fine. We noted: spine ticks, corner wear. Photos are of the actual book."*
Rendered with one band and no defects: *"Condition: Near Mint. Photos are of the actual book."*

**"Photos are of the actual book" is appended always** (product-critic C7). It is one short true sentence, it costs nothing, and it is the single most useful thing a raw-book listing can say: the whole reason a word range is an honest description rather than an evasion is that the buyer can look at the copy they are being sold. It also does real work under §2.0.4's materiality limb — a buyer deciding on photographs needs to know the photographs are *this* copy and not stock art. **It is never rendered unless it is true**; a listing whose images are not of the item does not get the sentence, and E10-B04 owns that condition.

**C12 is mandatory in the draft template, removable per listing, and the removal is recorded and counted** — the 021 C5 treatment exactly (022 Q7), and the legal lens asked for it explicitly. Longbox composes it by default into every draft it creates; a shop may take it off one listing; the removal writes a row and is counted. What a shop may **not** do is have Longbox generate listings with no condition statement as a standing configuration. Same for 2a/2b: they are part of the same block and travel with it.

**Line 2a — the not-a-certified-grade line (C13), for a raw book.** Verbatim, always present on a raw book, never edited (**reworded at v1.1.0**, product-critic C5 — v1.0.0's two sentences said the same thing twice and the second read like a legal notice):

> **"This is our own description, not a certified grade — one of our staff looked at this copy and wrote down what they saw."**

**Line 2b — the slab line (C14), for a book in a third-party holder.** It **replaces** 2a; the two never appear together (**rewritten at v1.1.0**, product-critic C3 and legal-advisor (a)):

> **"This copy is sealed in a {grader} holder. The label reads {label_grade_text}{, on a {label_type} label}, certification number {cert_number}. That grade is {grader}'s — we haven't opened the case. Label type is as printed; see {grader}'s current definitions for what it means."**

Three changes from v1.0.0 and each is load-bearing. **The label now speaks first** — a buyer scanning a slabbed listing wants the grade, and burying it behind our disclaimer read as defensive. **"We haven't opened the case" replaced "we have not re-graded the book"**, because the physical fact is both simpler and stronger; it says why we cannot have an opinion rather than asserting that we do not. And **the last sentence is the legal lens's**: label taxonomies are the grader's own product and they change (§2.0.2), so we point at the grader's *current* definitions rather than paraphrasing a definition that may be stale by the time the listing is read. The `{label_type}` clause renders only when the type is not Universal.

**Line 3 — the restoration line (C16).** Present only when a `restoration_suspected`, `trimming_suspected` or `married_copy_suspected` defect was called (**rewritten at v1.1.0**, product-critic C4 and legal-advisor (f)):

> **"Please look closely before you buy: this copy may have been {restored / trimmed / put together from more than one book}. That's what we saw — we haven't had it checked by a grading service. We decided to tell you."**

**Why it opens with an instruction and closes with authorship.** "Please look closely before you buy" is the sentence a shop owner actually says across a counter, and it converts a disclosure from a liability notice into advice — which is both softer and more useful. The closing sentence is the legal lens's amendment (f): the disclosure has to be **seated with the shop**, because the shop is the seller and this is the shop's judgement about the shop's goods, not a vendor's boilerplate. The coordinator's form was *"Your shop decided whether this note goes on the listing"* — correct in substance, wrong in voice, because the listing **is** the shop's and "your shop" makes the shop a third party on its own page. ***"We decided to tell you"*** carries the same authorship in the first person and reads as a shop being straight with a customer, which is the register Jeremy's standing instruction asks for.

Then, and separately, the **021 C5** provenance sentence — for which this record proposes a **v2** at §3.4 on the legal lens's seller-of-record BLOCK.

### 3.2 The phone-UI condition screen (C15)

Replaces the current heading and the two `Low` / `High` selects (`public/index.html:164-176`), removes the pre-filled default (D1), and replaces the two dropdowns with the single ladder from §1.3:

> **Heading:** "What does it look like?"
> **Ladder:** one row of the seven band words, nothing pre-selected — **tap one for a single band, tap a second for the range between them** (§1.3; E05-B09)
> **Range hint:** "One tap if you're sure. Two if it's between."
> **Defect prompt:** "Tap anything you can see."
> **Disclosure prompt:** "Anything that needs saying? Restored, trimmed, put together from more than one book."
> **Save confirmation:** "Condition saved. Undo" (021 C9)
> **Helper, always visible, one line:** "You're describing the book, not grading it."

**Two amendments at v1.1.0.** The helper was *"This is your call, in your words. Nothing here is a grade."* — a sentence that spends its second half denying something (product-critic C5/C6). ***"You're describing the book, not grading it"*** says the same thing by naming what the person *is* doing, which is what 022 P4 asks for: the tool tells the employee they are being asked for what they know, not examined on what they do not. And **`signed` is out of the disclosure prompt** (product-critic C6) — a signature is not damage, it is often why the book is wanted, and listing it beside "restored, trimmed, put together from more than one book" taught the operator the wrong category (§2.3).

### 3.3 The buyer-facing one-liner (C17)

For a FAQ, a shop's shipping-and-returns page, or an answer to "how do you grade?" — one sentence, and it is the shop's sentence, not ours:

> **"We describe every back issue in our own words — a range and what we noticed — because that is an honest description of a book nobody has certified."**

**This is a shop's sentence about the shop's practice.** Longbox's own external sentence about condition remains, unchanged and alone, **021 A2**: *"Condition stays with the human; we never pretend otherwise."* (§6).

### 3.4 The proposed 021 rows

**021 is not edited by this record.** The parent session applies these on ratification and assigns final numbers; C12–C18 below are provisional, and must be reconciled against any C-rows another in-flight record proposes the same week (§0).

| # (provisional) | Registered wording (verbatim) | Where it appears | Source | Proposed state |
|---|---|---|---|---|
| C12 | Condition line: `Condition: between {band word} and {band word}.` — or `Condition: {band word}.` for a single band — then `We noted: {defects}.` if any, then the shop's note if any, then always **"Photos are of the actual book."** Band words only: never a code, never a number, never a slash, never "X to Y" | listing body (`productSet` `descriptionHtml`); owner review | 037 §3.1; 022 P6; 019 T7 | PROPOSED — **default-on in the Longbox draft template, removable per listing with the removal recorded and counted** (the 022 Q7 / C5 treatment); the closing sentence renders only when the images are of the item |
| C13 | "This is our own description, not a certified grade — one of our staff looked at this copy and wrote down what they saw." | listing body, every raw book, immediately under C12 | 037 §3.1; 022 P8; FTC proximity rule (037 §2.0.4) | PROPOSED — travels with C12; **replaced by C14 on a slabbed book, never both, never neither** |
| C14 | "This copy is sealed in a {grader} holder. The label reads {label_grade_text}{, on a {label_type} label}, certification number {cert_number}. That grade is {grader}'s — we haven't opened the case. Label type is as printed; see {grader}'s current definitions for what it means." | listing body, slabbed books only; **replaces C13** | 037 §3.1, §1.1(3); 035 I6; §2.0.2 | PROPOSED — the `{label_type}` clause renders only when the type is not Universal |
| C15 | Condition screen: heading "What does it look like?" · a single seven-word ladder with nothing pre-selected (one tap = a band, two taps = the range between) · "One tap if you're sure. Two if it's between." · "Tap anything you can see." · "Anything that needs saying? Restored, trimmed, put together from more than one book." · "Condition saved. Undo" · helper "You're describing the book, not grading it." | phone condition screen | 037 §3.2, §1.3; 022 P2/P4/P6; 021 C9 | PROPOSED |
| C16 | "Please look closely before you buy: this copy may have been {restored / trimmed / put together from more than one book}. That's what we saw — we haven't had it checked by a grading service. We decided to tell you." | listing body, disclosure-tier defects only | 037 §3.1, §2.4 | PROPOSED |
| C17 | "We describe every back issue in our own words — a range and what we noticed — because that is an honest description of a book nobody has certified." | shop FAQ / policy page; buyer-facing answer to "how do you grade?" | 037 §3.3 | PROPOSED |
| **C18** | "Prices are set by {shop name} using recent sales of the same book; ask us if you'd like to know more." | listing body or shop FAQ — **E09/E10 decide which**; it is not part of the condition block | legal-advisor; 021 A8 (*"the shop decides the asking price"*) | PROPOSED — **[counsel]**, and **routed to E09-B06 / E10-B04, not owned by this record.** It exists here only because the seller-of-record analysis made the gap visible: a listing that discloses how condition was described and says nothing about how the price was set leaves the more consequential half unexplained. **It must not ship before the pricing path can actually support it** — 016 C12 records the PriceCharting client as a stub with unverified field mapping, and a sentence claiming "recent sales" over a stub would be a claim above its rung (018 A3) |
| **C5 v2** | "Issue, variant and condition confirmed by a person at {shop name}; identified with software assistance. **Sold by {shop name}.**" | the same place C5 sits today: default-on in the Longbox `productSet` draft template | legal-advisor BLOCK (seller of record); supersedes the C5 text ratified in 022 Q7 | PROPOSED — **C5 is ratified in 022, so it moves only by a 006 decision-log row at ratification, never by editing 021 or 022** (018 §4 C3). See §5 |

**Three proposed extensions to the rest of 021**, applied by the parent session on the same ratification:

- **To 021 §1 (blocklist):** the rows **N1–N7**, **N7b** (pressed is not a capture-vocabulary option) and **N8** (adjacency, field naming, and no recorded demo before D1 is fixed) in §2.5.
- **To 021 §2 (retirement list):** *"any dispute-rate or return-rate comparison between graded and raw books"* — retired because **no published statistic exists** (§2.0.6, and see §5's second sourcing note); may return only with a source carrying N, denominator and date.
- **To 021 §3 (approved claims):** nothing. This record proposes **no new external Longbox claim.** 021 A2 remains the only condition sentence Longbox may say about itself, and every string above is a **shop's** sentence about the shop's own goods.

## 4. Owner-review triggers — when a condition call cannot reach a published listing unreviewed

Nothing publishes without a person in any case (locked decision 3; 022 P1). These triggers are stronger: they say the **owner**, not the scanning employee, must see the item, and that a draft carrying one is flagged in the review queue rather than sitting in the undifferentiated pile.

### 4.1 The five triggers

| # | Trigger | Grounding | Proposed rule |
|---|---|---|---|
| **1** | **Value floor.** The shop's own confirmed price for the item is at or above a floor | 035 §2.6 puts a deliberate, non-zero **over-$500** stratum in the cohort precisely because *"One high-band false confirm on a book at this level is the failure that ends a pilot"*, and 019 **K2** fires on *"any single high-band false-confirm that reached a published listing"* — a kill rule with no denominator, which is exactly why a per-item gate is the right instrument | **The floor is a per-shop setting on `shop_pricing_policy`, defaulting to $100** (amended at v1.1.0, product-critic C8 — see below). The default sits at the bottom of 035's `$100–$500` band, not at $500, because that band is where 019 T9's expanded inspection already applies and because a gate that only catches the five-item stratum catches almost nothing. **The default is a signed decision, not a measurement (018 A3): it moves only by a 006 row naming old value, new value, motivating batch and evidence rung.** A shop may set its own floor **lower** than the default freely; raising it above the default is a shop configuration change that is recorded, because a shop that raises the floor is turning off a gate |
| **2** | **A disclosure-tier defect was called** — `restoration_suspected`, `trimming_suspected`, `married_copy_suspected`, `signature_unwitnessed` | §2.4; these are the four callouts that carry the C16 line and the largest value consequence | Mandatory owner review, at any price, with no floor. The owner is the person who decides whether the shop is willing to make that statement in public |
| **3** | **A slab whose label the operator could not read** | 035 §2.4 records that whether a slab's QR code and certification number are legible *"through the case at a phone's working distance"* is **unsettled by any source** — so an unreadable label is a designed-for state, not an error | The item goes to the owner with the range **absent**, not guessed. **A slabbed book never receives a Longbox range** (N6): either the label is read and C14 renders, or the owner enters the label values by hand |
| **4** | **A contradiction between the range and the defects** (§4.2) | The identity path already has a contradiction gate that removes the one-tap path (locked decision 7; 022 P1). Condition has none today | Draft is held for owner review with the contradiction named in one line, in the C3 register: plain, no blame, says what to check |
| **5** | **A buyer dispute on a published item** | 033 §5.8 | The item goes on retention hold, the condition is re-called, and the new call **supersedes** rather than overwrites (§4.4). Covered in §5 |

**Why the floor is a policy row and not a constant (product-critic C8).** v1.0.0 hard-coded $100 into the record. That was wrong on two counts. **A $100 book is a different animal in different shops** — a shop whose trade is keys and slabs would send half its inventory to the owner at that floor and stop reading the queue by Wednesday. And **the mechanism already exists**: `shop_pricing_policy` is one of the three config tables locked decision 4 already splits out (`migrations/001_init.sql`), which is exactly where a per-shop threshold belongs. The record therefore fixes the **default** and the **rule**, and leaves the number to the shop.

**And a value-triggered review is not satisfied by tapping publish (product-critic C8, second half).** This is the sharpest thing the cannon found in §4. A gate whose only affordance is the button the owner was already going to press is not a gate — it is a delay, and 019 K2 fires on the single event a delay does not catch. So: **on a value-triggered review the owner must confirm or edit the condition field itself before the draft can publish.** Confirming is one action and it writes a superseding `condition_assessment` row attributed to the owner (§4.4); it is not a checkbox and it is not free. The other four triggers hold the draft for review in the normal way; only trigger 1 — the one whose whole justification is a kill rule with no denominator — demands the owner touch the field. **E10-B04 and E11-B02 own the mechanism.**

### 4.2 The range-versus-defect contradiction table

A contradiction is a defect callout that the trade's own published definitions place outside the stated range. The rule is **advisory to the operator and blocking to the publish path** — it never refuses the operator's call, it routes it (022 P2: overrides are always available, never punished).

| Defect called | Incompatible with a range whose **low** bound is at or above | Why |
|---|---|---|
| `detached_cover` | Good | Two independent sources put it below Good: Midtown's Good band requires that the *"Cover is intact"* (§2.0.5), and the trade glossary 035 §2.5 quotes says *"In Fair grade comics, the cover may be detached"* |
| `missing_pages` | Good | Incompleteness is a floor on the scale, not a deduction from it — the Good band requires that comics *"have all pages and covers"* (edcollins GD section), the Poor band is defects *"so extensive as to render them all but uncollectible in most cases"*, and CGC's 0.5 reads *"Some pieces will also be missing"* (§2.0.1, §2.0.2) |
| `water_damage` | Very Fine | The published Very Fine copy is *"Sharp, bright and clean with supple pages"* with pages *"not brown"* (edcollins VF section) and *"shiny and smooth"* at Midtown's Very Fine (§2.0.1, §2.0.5); the trade defines water damage as *"Staining, swelling, stiffness, or paper damage caused by moisture"* (035 §2.5). The two are not simultaneously describable |
| `crease_color_breaking` | Near Mint | A colour-breaking crease *"breaks color, usually leaving a visible white line"* and is 035's *"line between two grade ranges for most books"*; Near Mint is *"sharp, bright and clean"* (§2.0.1). They do not co-occur |
| `restoration_suspected` / `trimming_suspected` / `married_copy_suspected` | *(any)* | Not a contradiction — a disclosure. Routed by trigger 2, not this table |
| *any defect at all* | `PR`–`PR` with **no** defect named | The inverse case: a Poor call with nothing named is an under-described book, and the owner should see it |

The exact bound for each row is **E08-B03's to encode against §2.0's published definitions**; the table above is the policy shape and the reasoning, not the final constant set. **Cannon question Q4** asks whether row 3 and row 4 are too aggressive for a shop that prices in minutes.

### 4.3 What the owner sees

Unchanged from 033 §7, which this record does not modify. Per draft: identity in the shop's own catalogue words; **condition in words — a range plus the named defects, never a number**; price and its source; the C4 decision strip; the C5 provenance sentence. The three actions are **publish**, **edit**, **send back**.

This record adds **one** thing to that surface: a draft that fired a §4.1 trigger carries a one-line reason at the top of the card, in the same plain register as C3 — *"Held for you: the condition says Near Mint but a colour-breaking crease was noted."* / *"Held for you: this copy may have been restored."* / *"Held for you: we could not read the label on this slab."* It is a **reason, never a judgement**, and it never names the operator (022 P3; 019 T35).

### 4.4 What is written

Per 003 §Data model — *"Records are values: appended, never edited in place"* — and the supersession machinery already reserved at `migrations/003_reserve_principle_slots.sql:84-104`:

- The owner's corrected condition is a **new `condition_assessment` row** with `supersedes_id` pointing at the one it replaces. The unique index at `:99-100` allows a record to be superseded **at most once**, so a chain is linear and auditable.
- The original row is never edited and never deleted (the append-only trigger, `migrations/001_init.sql:175-181`).
- The current condition is read through `condition_assessment_current` (`003:108-112`).
- **The correction is the learning signal, not evidence against a person** (022 P2, P3). It enters the weekly review and the eval signal as a batch fact; it never becomes a per-operator number (019 T35, non-waivable).

---

## 5. Escalation and disputes — a buyer says the condition was wrong

### 5.0 The shop is the seller of record; Longbox is a tool vendor (legal-advisor BLOCK)

**Stated first because everything else in this section depends on it.** In every transaction Longbox touches, **the shop is the seller of record.** The shop owns the goods, sets the price (021 A8), authors the condition statement (§1.1(1)), publishes the listing (locked decision 3), holds the customer relationship, and carries whatever obligations a seller carries. **Longbox is a tool vendor.** It supplies software the shop's own staff use; it is not a marketplace, not a consignee, not an agent, not a grader, and it never takes a position in the sale.

v1.0.0 never said this, and the legal lens was right that the omission was a BLOCK rather than a gap. The whole record is about **who says what about a book** — and it distinguished three authors of a condition statement without once naming who is *selling* the thing. Every disclaimer in §3 is a shop's sentence about the shop's goods; that only coheres if the seller is identified, and a listing that carries our provenance sentence and never names the seller invites precisely the inference we spend §6 refusing.

**The concrete change is one clause on an already-ratified string.** 021 C5 reads *"Issue, variant and condition confirmed by a person at this shop; identified with software assistance."* The proposed **C5 v2** (§3.4) names the shop and adds **"Sold by {shop name}."** Naming the shop also repairs a smaller defect: "this shop" is a deictic that means nothing on a syndicated listing, in a marketplace feed, or in a screenshot.

**C5 is ratified in 022 Q7, so it cannot be edited here or in 021.** It moves by a **006 decision-log row at ratification**, per 018 §4 C3 — a ratified line moves only by the recorded mechanism, never by a doc edit. The parent session files that row; this record proposes the text and the reason.

**What goes to counsel, and does not get answered here.** The seller-of-record position implies a set of statements this record deliberately does **not** draft: allocation of liability between shop and vendor for a mis-described listing; any indemnity in either direction; whether the pilot agreement says anything about condition disputes; and how the shop's own refund and return policy is represented. **All four are routed to the E01-B05 batched counsel checklist** (022 §6) as a named block, alongside the §3 strings, the §2.4 pressing rule and C18. Writing them here would be exactly the "signed as drafted" failure 022's GC constraint forbids.

### 5.1 The path

The path is 033 §5.8, restated here with the condition-specific parts filled in.

| Step | What happens |
|---|---|
| **1. Arrival** | The buyer tells the shop the book was not what the listing said. The shop tells Longbox, or handles it alone — either is fine; the record is the same |
| **2. Hold first** | The item goes on a **retention hold** immediately (`retention_hold`, `migrations/003_reserve_principle_slots.sql:18-21`, `:205-232`), so nothing about it — originals, derivatives, the session — is swept while it is in question (022 P7 Q6). This happens **before** anyone forms a view about who was right |
| **3. Read the record** | The session shows what was proposed for identity, what band it was in, whether there was a contradiction, what the person confirmed, and the condition they called — with the whole supersession chain |
| **4. The finding** | **A dispute traced to a good-faith confirmation of a system proposal is recorded as a system defect** (022 P1; 033 §5.8) |
| **5. The blame rule** | **Never an employee fault, and never grounds for discipline.** This is a clause in the pilot agreement, not a courtesy (022 P1 enforcement line: *"contract (the blame clause, E01-B05 [counsel])"*) |
| **6. Longbox's limit** | Longbox provides the record. **It does not investigate, adjudicate or opine on any employment decision** (022 P9), and it does not decide the buyer's claim either — the refund, the return and the customer relationship are the shop's, on the shop's own published terms |
| **7. The write** | A superseding `condition_assessment` if the condition is re-called (§4.4), plus a dispute record against the item (E11-B04, not built) |
| **8. Feedback** | The defect enters the weekly review and the eval signal. A high-band false confirm that reached a published listing trips a review on its own (019 K2) — **and step 8 now has an input, because the dispute record carries an outcome field (§5.2)** |

### 5.2 The dispute pack, and the outcome field (product-critic C9)

**Two gaps the cannon found in the v1.0.0 path, both real.**

**The first is that step 3 is a research project under time pressure.** When a buyer opens a case, the shop has a small number of days and a counter to run, and "read the record" means opening a session, finding the right `condition_assessment` in a supersession chain, and reconstructing what the listing actually said at the moment it sold. So: **a one-tap dispute pack.** From the item, one action assembles the capture photographs, **the condition line exactly as published** — the rendered C12/C13/C14/C16 block, not a re-render from current data, because a re-render after a correction shows the wrong thing — and the timestamps. It is a read-only export the shop can hand to a marketplace or a bank as-is. **E11-B04 owns it**, with the frozen-copy requirement as an acceptance criterion.

**The second is that step 8 had no input.** v1.0.0 said the defect "enters the weekly review and the eval signal" without anything recording how the dispute *ended*. A dispute the shop won and a dispute that cost a refund are different facts about the same call, and 019 **T9** (missed-defect rate, high-value tier) and **K2** both need the distinction. So the E11-B04 dispute record carries an **outcome field** — at minimum: resolved in the shop's favour / refunded or returned / chargeback lost / withdrawn — with its date. It is a fact about **an item**, never about an operator (019 T35).

**The external clocks this has to fit inside — sourced, and one coordinator-supplied figure corrected.**

- **eBay.** The figure carried into this amendment round was "~72 hours." **The sourced number is three business days, and it is a different thing than "decided in 72 h":** eBay's own help page says *"The seller has 3 business days to get back to you."* and *"If the seller doesn't respond or you're unable to resolve the issue with them, you can ask us to step in and help"* ([ebay.com/help — returning an item that doesn't match the listing](https://www.ebay.com/help/buying/returns-refunds/returning-item-doesnt-match-listing?id=4041), no publication date shown, accessed 2026-09-04, primary). That is a **seller-response window**, not an adjudication deadline, and three business days across a weekend is five calendar days, not 72 hours. The record states the sourced form.
- **The photographs really are the evidence.** eBay's flow requires them: *"If the item arrived damaged, broken, or faulty, you must add at least 1 image (with a maximum of 10) relevant to the reason you're returning the item for, and showing any scratches or defects"* (same page). This is the strongest single argument for the dispute pack and for C12's *"Photos are of the actual book"*: **the case is decided on images, so a listing whose images are of the actual copy is the shop's own defence**, and a pack that produces them in one tap is the difference between meeting the window and missing it.
- **Shopify is not eBay, and the difference matters.** A Shopify-side dispute is a **card chargeback**: *"When a cardholder has an issue with a charge on their credit card, they can contact their bank to dispute the charge. The bank then makes a chargeback or inquiry"*; *"Often, the company that issued the cardholder's credit card reviews any evidence, and then resolves the chargeback in either your favor or the cardholder's favor"*; and, explicitly, *"Shopify isn't involved in the decision making of chargeback outcomes"* ([help.shopify.com — chargebacks and inquiries](https://help.shopify.com/en/manual/payments/chargebacks), no publication date shown, accessed 2026-09-04, primary). So on the shop's own store the counterparty is a **bank**, the adjudicator is the **card issuer**, and the shop is submitting evidence into a process neither we nor Shopify control.
- **Two things could not be sourced, and are not asserted.** No Shopify page stating a **number of days** to respond to a chargeback was retrieved, so **this record states none** — the commonly-repeated figures are unverified. And eBay's formal Money Back Guarantee policy page returned an error page on one attempt and a bot-verification interstitial on another, so the three-business-day figure rests on the buyer-return help page alone and was not cross-confirmed. Both are recorded here rather than smoothed over, per §2.0.6's discipline.
- **The statistic still does not exist.** No published INAD or return-rate figure for comics or collectibles was found in this pass either, consistent with §2.0.6. The 021 §2 retirement proposed at §3.4 stands.

### 5.3 Refund and return facts, and what is said to a buyer

**Refund and return facts.** Longbox holds none. The shop's return policy, the marketplace's, and any statutory right are the shop's own and are not restated, summarised or defaulted anywhere in Longbox copy — **because a vendor restating a shop's return terms creates a representation the shop never made**, and because §5.0 puts the shop, not us, in the seller's chair. C13 and C17 describe *what a description is*; they promise nothing about remedies. Whether the pilot agreement says anything about condition disputes is one of the four **E01-B05 counsel items** listed at §5.0, not this record's.

**What we say to the buyer, and what we never say.**

| Say | Never say |
|---|---|
| "That's a fair point — here's what our staff wrote and why." | "The system said it was Very Fine." |
| "This one's on us, not on the person who listed it." | Anything naming or implying the employee |
| "We describe books in our own words; we don't certify them." (C13/C17 in the shop's voice) | "It was graded as…" — we did not grade it (N2) |
| "We'll make it right" — on the shop's own terms | Any promise about a remedy Longbox does not control |
| Nothing at all, if the shop prefers to handle it | Anything about a grade number, ours or a grader's, that is not quoted from a label |

**T8 is not part of this conversation, ever.** 019 T8 (inter-rater agreement on grade range, ≥80% same range / ≥95% adjacent) is **internal-only**, measured across operators to *fix the training, never to fail the person* (022 P4), and 021 **B5** blocks it from every external artifact. It is not evidence in a dispute, it is not a consistency claim to a buyer, and *"a red T8 blocks any external consistency claim"* (019 T8). A support reply that cites a consistency figure is a K7 event.

---

## 6. The marketing rule — "never market automated grading without separate validation"

The bead's note reads *"Never market automated grading without separate validation."* **This record satisfies it by removing its antecedent: we do not market grading at all, automated or otherwise.**

1. **There is no product claim about grading to validate.** The system does not grade (§1.1), does not propose a condition (§1.3), and stores every machine-side condition value as a non-renderable estimate (§1.1(c)).
2. **The only external condition sentence is 021 A2** — *"Condition stays with the human; we never pretend otherwise."* — which 021 marks as *"the only condition sentence permitted (B5)"*. Everything past that sentence is Restricted internal.
3. **021 §2 has already retired the vocabulary** — "AI grades", "AI grading", "automated grading" — with a "may return when" of **never**, on the ground that they are *"never true by design (locked decision 5)"*. This record adds N2 ("graded by Longbox") so the door is shut with our name on it as well as the technology's.
4. **T7 is the detector, and it is non-waivable** (019 §Non-waivable lines): *"Numeric grades emitted = 0; any numeric grade anywhere; any → BLOCK."* 035 **I6** gives it its one exemption — a quoted third-party grader designation appearing **with its grader's name and inside a citation** — and states the boundary that matters: *"T7 forbids us emitting a grade; it does not forbid us recording what is printed on a slab in a shop's inventory."* §1.1(d)'s `label_grade_text` is designed to sit inside that exemption and nowhere else.
5. **Every artifact still passes the T26 pre-send step** before leaving Restricted internal (021 §0; 019 T26 / K7), run by `longbox-gate-auditor` against the registry. A condition claim that is not a C-row in 021 does not go out.
6. **And a claim does not have to be a sentence** (N8, added at v1.1.0). The retirement list governs words; a **layout** that puts a condition value beside a model output, a **column named `suggested_grade`**, or a **screen recording of today's build showing the condition screen arriving pre-filled** each make the claim without using any of the retired words. The pre-send step reads prose; N8 and **I9** cover the three surfaces it cannot. The demo clause is the sharpest of them: **the first "AI grading" claim Longbox could ever make would be a silent one, made by a video** — which is why no recorded demonstration of the condition flow exists until D1 is fixed.

**What "separate validation" would even mean, and why it is out of scope for v0.** For a grading claim to be marketable it would need, at minimum: a defined scale with published definitions; a measured agreement rate against a competent independent grader on a pre-registered sample with N, cohort and denominators (018 A1 PILOT-MEASURED); a stated error distribution, not a headline accuracy; and a standing re-measurement as the model, the corpus and the capture recipe change. **We have none of those and are not building them.** 019 T8 is the nearest instrument in the whole contract and it measures *humans against each other*, is internal-only, and is explicitly not a claim about anyone's competence (022 P4). Building the validation apparatus would be a different product with a different liability surface, and the strategic point of locked decision 5 is that we decided not to be in that business. **Out of scope for v0 and for the pilot; revisited only by a founder decision, never by a builder.**

---

## 7. Invariants — testable statements

Each is a statement a test could fail. **None is a test that passes today**; every one names its owning bead. Per 018, ratification does not move any of them up the ladder.

| # | Invariant | How it is enforced | Owner | State |
|---|---|---|---|---|
| **I1** | No band **code** (`PR`/`FR`/`GD`/`VG`/`FN`/`VF`/`NM`) appears on any human-visible surface — screen copy, listing body, owner review, export, report | Extend the existing `%`-in-copy CI grep with a code-in-copy pattern over `public/`, listing-template output and report renderers | E08-B03 / E05-B02 | OPEN (D2, D3 are live violations) |
| **I2** | No numeric grade is emitted anywhere, with the single 035 I6 exemption for a quoted grader designation carrying its grader's name inside a citation or a `label_grade_text` field | 019 T7, non-waivable; the same grep pass as I1 | valuation-commerce builder | OPEN as a **gate-test**; 022 P1's enforcement line records that T7 is *not* on T34's heartbeat list, so "no numeric grade" stays a commitment, not a claimable achievement |
| **I3** | No machine-authored condition value, **and no suggestion-shaped substitute for one**, reaches a rendered surface. Extended at v1.1.0 (product-critic C2) to name the substitutes explicitly: **no pre-selected or defaulted range; no sticky "last range you used"; no ordering of the band words by frequency, recency or popularity; no shop-level or category-level default range; no "same as the last book" affordance.** The ladder renders in **scale order, every time, for every operator.** And no `condition_estimate` row is ever joined into the draft path | Unit test on the screen's initial state (D1); a test asserting the rendered ladder order equals `GRADE_LABELS` order regardless of session history; an architecture rule that the `commerce` module may not import `condition_estimate` (029's dependency-cruiser gate) | E08-B03 / E05-B09 / E02-B10 | OPEN — `condition_estimate` does not exist, and D1 is a live violation |
| **I4** | Every listing body carrying a condition line also carries C13, or C14 if the item is slabbed — never neither, never both. **And C12 is present in every draft Longbox composes unless a per-listing removal was recorded** (the 022 Q7 / C5 treatment): absent-and-unrecorded is a failure, absent-and-recorded is not | Contract test on the `productSet` payload, alongside the C5 test 022 Q7 already requires; a second assertion that a missing block has a matching removal row | E10-B04 | OPEN (D3, D4) |
| **I5** | A `disclosure`-tier defect on an item forces owner review before the draft can be published, at any price | Integration test over the publish path | E10-B04 / E11-B02 | OPEN |
| **I6** | A slabbed item never carries a Longbox grade range in the same listing body as a grader's label value | Contract test on the payload | E10-B04 | OPEN |
| **I7** | A condition correction appends with `supersedes_id` and never updates in place; the chain is linear (at most one successor per row) | Already enforced in the database — the append-only trigger (`001_init.sql:175-181`) and the once-only unique index (`003:99-100`). The **test** asserting the API uses them is the open part | E02-B07 / E11-B03 | Partially enforced by the schema; the test is OPEN |
| **I8** | No condition surface, export or report carries an operator column | 019 T35, non-waivable; the accessor rule and route-walk at E03-B03 | E03-B03 | OPEN (T35(a)/(b) render OPEN per 022 §10) |
| **I9** | **No identifier on the condition path is named with `ai`, `auto`, `predicted`, `suggested`, `estimated` or `recommended`** — not a column, metafield, API key, event name, log key, test fixture or UI label (N8 ii). Added at v1.1.0 | A CI grep over `migrations/`, `src/`, `public/` and the listing-template output, on the 035 I6 pattern — matching the token set against identifiers on condition-path files, and failing closed | E08-B03 / E02-B10 | OPEN — no such identifier exists today, so this invariant is **cheap to hold and expensive to recover**, which is why it is written before the fields are built |
| **I10** | **A value-triggered owner review is not satisfiable by publishing.** The owner confirms or edits the condition field, which writes a superseding `condition_assessment` attributed to the owner, before the draft can move to published (§4.1 trigger 1). Added at v1.1.0 | Integration test over the publish path: a draft above the shop's floor with no owner-authored condition row cannot publish | E10-B04 / E11-B02 | OPEN |

---

## 8. Alternatives considered

| # | Alternative | Why it loses |
|---|---|---|
| **A1** | **Numeric grades with a disclaimer** — emit a 0.5–10.0 value and print "not a certified grade" underneath | Loses on three independent grounds, any one of which is sufficient. **On the published guidance (§2.0.4):** the FTC substantiation standard asks for *"a reasonable basis for advertising claims before they are disseminated"*, and a number derived from one phone photograph has none — so the disclaimer is not qualifying a marginal claim, it is retracting an unsubstantiated one, and the number remains the representation a reasonable consumer takes away. **Contractually:** 019 T7 is non-waivable, and moving it requires Jeremy in writing, prospectively, in a 006 row (019 §Non-waivable lines) — it is not a design option a builder or an acting head can take. **Commercially:** a number invites direct comparison to a grader's number on the grader's own axis, the one comparison we can never win and never have to make. And the trade agrees: Midtown Comics publishes that it *"does not grade or consider any type of numbered grading scale when determining a comic books condition"* (§2.0.5), and 032 §1.3's live back-issue catalogue runs on words with *"never a number"* |
| **A2** | **Mirror CGC's scale** — adopt the 10-point scale, its label taxonomy and its terminology wholesale, without asserting certification | Trades our one honest position for a borrowed one. Adopting the scale means adopting its numbers (A1's problem, arriving by the side door). Adopting the *taxonomy* is worse: Universal, Signature Series, Qualified, Restored and Conserved are **CGC's own product names for its own label types** (§2.0.2), and using them without the service behind them is precisely the borrowed-certification misrepresentation N4 forbids. It would also make every Longbox statement implicitly comparable to a grader's, on an axis a photograph through a bag cannot support |
| **A3** | **No condition policy at all** — let each shop word its own listings and let the schema's CHECK constraint be the whole rule | The status quo, and it is what produced D1–D5: a machine-authored default nobody decided on, storage codes on a buyer-facing listing, and no disclaimer of any kind. A CHECK constraint stops a numeric grade reaching a column; it does nothing about the sentence a buyer reads. It also leaves 022 P1's blame clause with nothing to point at when a dispute arrives |
| **A4** | **Plus/minus modifiers on the ladder** (the 032 §1.3 observed practice) | §2.1: a range already carries the granularity, the enum triples, T8's "adjacent" relation stops meaning one thing, and a modifier is a numeric step with the digits filed off. Preserved as **Q2** because a real seller really does use them |
| **A5** | **A single grade word rather than a range** — one band, no interval | Cheaper to capture and worse in every other way. A single word is a point estimate the operator cannot honestly make from a phone photograph and a few seconds; the interval is the mechanism by which the product declines to overclaim. It would also make a contradiction gate (§4.2) nearly meaningless |
| **A6** | **Longbox re-grades slabbed books onto our ladder** so every item in the catalogue is described consistently | Directly contradicts §1.1(d) and N6. We cannot see the book — it is sealed — so any range we produced would be an inference from a photograph through reflective plastic (035 §2.4 records the glare problem in the source's own words). Consistency bought by inventing data is not consistency |

---

## 9. Consequences

- **The condition screen loses its default and gains a ladder, and should end up faster.** Removing the pre-fill (D1) would have cost two taps a book against a real 019 T10 budget; the single seven-word ladder from §1.3 gives them back and then some — one tap for a single band, two for a range, against today's two dropdown interactions. **That is a design claim and not a measurement**: it is untested, it is E05-B09's to prove on the T10 device matrix, and if it does not hold, the honest response is to make the ladder better rather than to reintroduce an anchor (I3).
- **Nineteen defect options is more vocabulary than the shipped twelve**, and §2.3's tiering is the only thing standing between that and a grading exam. If E08-B02 cannot make the three tiers feel like one screen, the vocabulary is too big and this record should be amended by a 006 row rather than worked around in the UI.
- **Three of the four disclosure-tier options are new and none of them can be validated.** "Suspected" is doing a great deal of work, and a shop that over-calls restoration will look evasive while a shop that under-calls it will look deceptive. §2.4's rule — record the observation, never the determination — is the best available answer and it is not a comfortable one.
- **The owner-review floor will hold up drafts, and the review is no longer free.** At 035 §2.6's TARGET shares the `$100–$500` and `over $500` bands are together 7% of a batch, so at the default roughly one book in fourteen goes to the owner on value alone — plus every disclosure call and every unreadable slab. For a shop where the owner is the person doing everything (031 §1: ComicsPRO's 88% owner-full-time figure) that queue is a real cost, and **I10 makes each of those items cost an actual decision rather than a tap.** That is the point — a gate discharged by the button the owner was already pressing is not a gate — but it is a cost, and it is the reason the floor is a per-shop setting a shop can lower rather than a constant we impose.
- **We have written a policy the product does not yet obey, and said so on the signature.** Ten invariants, zero tests, five live defects. The risk is not that anyone is deceived by it internally; it is that a ratified policy reads like a description to someone who joins later. §12's closing paragraph and D1–D5 exist to make that misreading impossible.
- **We are declining a marketing position that a competitor will take.** Somebody will ship "AI grading" and it will demo well. §6 is the decision not to answer it in kind, and 031 §3's finding — that the trade's public reflex against the word is hostile and recent — is the evidence that declining is also the commercially better bet. That evidence is REPORTED sentiment, not a measurement, and it could be wrong.
- **Five shipped defects are now named and owned** (D1–D5), which means the next artifact that describes the condition flow has to describe it as it is.

---

## 10. What this record does not decide

- **The capture recipe** — how many photographs, from what angles, with what prompts, and how the three defect tiers lay out on one phone screen. **E08-B02.** §2.3 fixes the vocabulary and the tiering rationale; it does not fix the layout.
- **The vocabulary implementation** — the migration adding the seven new `DEFECT_OPTIONS` values, the vocabulary-version column, the display-side rendering function, and the removal of D1's default. **E08-B03.**
- **The listing template itself** — where in the `descriptionHtml` the block sits, how a shop's own catalogue vocabulary is mapped from a range (§2.1), and how C5 lands in the payload. **E10-B04.**
- **The slab storage shape** — the exact `attributes jsonb` keys and their JSON Schema in the comic vertical pack. **E02-B07 / 030's pack machinery.**
- **The dispute record** — its columns, its states, and how it links to the hold. **E11-B04.**
- **Whether the pilot agreement says anything about condition disputes.** **E01-B05, with counsel.**
- **Anything about pricing** — except that it **notices one gap and hands it on**. A book's condition informs its price through the shop's own policy (021 A8) and this record touches none of that machinery. **C18's price-source line is proposed, not owned:** E09-B06 and E10-B04 decide whether it ships, where it sits, and whether the pricing path can honestly support the words "recent sales" (016 C12 records the PriceCharting client as a stub with unverified field mapping). It is **[counsel]** like the rest of §3.
- **The seller-of-record consequences.** §5.0 fixes the *position* — the shop sells, Longbox supplies a tool. It deliberately drafts none of what follows: liability allocation for a mis-described listing, indemnity in either direction, whether the pilot agreement addresses condition disputes, and how the shop's refund and return policy is represented. **All four are named on the E01-B05 counsel checklist and answered there.**
- **Where a signature is captured, now that it is out of the damage prompt** (§2.3). E08-B02.

---

## 11. The five questions, and how the cannon answered them

v1.0.0 posed five. All five came back answered, and the answers are applied in the body rather than left here.

| # | Question | Answer, and where it lives |
|---|---|---|
| **Q1** | Should a *labelled* machine condition proposal ever be permitted? | **No — and the cost it was meant to buy is bought by the interface instead.** The no-proposal rule stands; the two taps come back through a **single seven-word ladder** (one tap = a band, two taps = the range between), routed to E05-B09. The generalisation is the valuable part: a proposal need not come from a model, so **I3 now forbids the suggestion-shaped substitutes** — sticky last range, frequency-ordered options, shop-level defaults. **§1.3, §3.2, §7 I3** |
| **Q2** | Are we wrong to decline plus/minus, when a live seller transacts in them? | **No, and nothing is lost.** E10-B04's **per-shop vocabulary mapping** renders a shop's own catalogue words out of the range at listing time; no modifier enters `condition_assessment`, `validGradeRange`, T8's adjacency relation or the eval labels. **§2.1** |
| **Q3** | Is $100 the right floor, or a queue nobody will work? | **Wrong shape of question — the floor should not be a constant at all.** It becomes a **per-shop setting on `shop_pricing_policy`, defaulting to $100**, freely lowerable, recorded when raised. And the rubber-stamp risk is answered structurally: a value-triggered review **requires the owner to confirm or edit the condition field**, writing a superseding row — tapping publish does not discharge it (**I10**). **§4.1** |
| **Q4** | Is the contradiction gate advisory-and-routing, or should it block the operator? | **Advisory-and-routing, as drafted — no change.** Neither lens moved it. 022 P2's "overrides are always available and never punished" governs the operator's side, and the publish path is where the stop belongs. The bound constants remain E08-B03's to encode. **§4.2** |
| **Q5** | Does C13 do the work? | **The substance held; the wording did not.** Both lenses read v1.0.0's two sentences as saying the same thing twice, the second in a legal register. Reworded to one sentence. The deeper answer came from the legal lens as a **BLOCK on a different question entirely** — the record never said **who is selling the book** — which produced §5.0 and the C5 v2 proposal. **§3.1, §3.4, §5.0** |

**What was raised that v1.0.0 had not asked.** Four things, all absorbed: the C12 wording reading as the trade's own FN/VF half-step (B1); the adjacency-and-naming gap, where a layout, a field name or a screen recording makes the claim the sentences forbid (B2 → **N8**); the "pressed is silence" rule collapsing *not knowing* into *not saying* (BLOCK → **§2.4, N7b**); and the seller-of-record omission (BLOCK → **§5.0, C5 v2**). Plus the dispute pack and outcome field (C9 → **§5.2**), and C18's price-source line, which is real but belongs to E09/E10.

**What the cannon did not settle, and nobody should read as settled.** Every **[counsel]** item — the §3 strings as a set, the §2.4 pressing rule, C18, and the four seller-of-record statements at §5.0 — remains for outside counsel in the E01-B05 batch. A `legal-advisor` lens is an internal adversarial read. It is not counsel, and this record does not treat it as such.

---

## 12. Ratification

| Field | Value |
|---|---|
| Decision | **Adopt §1–§7 with the v1.1.0 cannon amendments** as the Longbox condition and grading policy — binding on E08-B02, E08-B03, E08-B04, E05-B02, E05-B09, E10-B04, E11-B02/B03/B04 and E16-B03. The proposed registry rows (C12–C18, C5 v2, N1–N7, N7b, N8, and the 021 §2 retirement) are applied by the parent session on this signature, with C5 v2 filed as a **006 decision-log row** because C5 is ratified in 022 Q7 and moves only by that mechanism (018 §4 C3) |
| Status | **RATIFIED** |
| Acting head of board | **Claude**, under Jeremy Longshore's 2026-09-03 in-session delegation ("anything that needs clear direction please approach the thinker cannon and exec council to decide — this is an autonomous build without human") |
| Date | **2026-09-04** |
| Cannon provenance | **Stated because the two lenses are not the same kind of thing.** `legal-advisor` is a **registered agent**. **No registered `product-critic` agent exists**, so that lens was a **general-purpose agent instructed to act as the product-critic lens** — a prompt, not a definition, with none of the tool restrictions or review posture a registered auditor carries. Its findings were adopted on their merits (and B1 and B2 were the sharpest findings of the round), but a reader weighing this signature should know that half the cannon was improvised. If E08's build/audit assignments (014 §22) are ever revised, a registered product-critic is the gap this record names |
| Cannon | **Two lenses, both run: `product-critic` — ACCEPT-WITH-CHANGES** (B1 the C12 wording, B2 the adjacency-and-naming row, plus C1–C9); **`legal-advisor` — ACCEPT-WITH-CHANGES** (two BLOCKs: the "pressed is silence" rule, and the missing seller-of-record statement; plus amendments (a) and (f) and the C18 proposal). **All amendments absorbed, none declined.** §13 carries the per-amendment disposition |
| Council | **None convened, and none required.** No 019 threshold moved, no locked decision was relitigated — locked decision 5 is *applied* here, not reopened — no partner was named, and the only external commitments proposed are **a shop's sentences about the shop's own goods**, entering the world through 021 and the T26 pre-send step. The ISEDC pattern is reserved for founder decisions on scope, price, partner posture or an immutable external commitment |
| Outside counsel | **Not sought by this record, not a precondition of this signature, and not replaced by the `legal-advisor` lens** — which is an internal adversarial read, not counsel. The **[counsel]** items — the §3 strings as a set, the §2.4 pressing rule, C18, and the four seller-of-record statements at §5.0 — join the **single batched E01-B05 engagement** (022 §6). A counsel-driven change to a registered string afterwards is a 021 revision by a 006 row, not a reopening of this record. **Nothing in this record is legal advice** |
| Gate audit | `longbox-gate-auditor`, 2026-09-04, on the ratified v1.1.0 text: **PASS** on design, decisions, proposed rows, disclosure class and the 006 / 016 / 000-INDEX rows; **NOT-READY on six citation-hygiene items**, all repaired at **v1.1.1**. **No decision, string, registry row, trigger or invariant changed between v1.1.0 and v1.1.1**, which is why this signature stands rather than being re-taken. §13 itemises the six |
| Dissent | **None recorded.** Both lenses returned ACCEPT-WITH-CHANGES and every change was absorbed; no amendment was declined, so there is no minority position to preserve |
| Jeremy's revision right | **Standing.** Any 006 decision-log row overrides any line here |
| Recorded in | 006 decision log (the 2026-09-04 row flipped in place PROPOSED → RATIFIED, per the 030 precedent, plus the separate C5 v2 row); 016 §1 row 037; 000-INDEX row 037; bead `longbox-e5b.8.1` close reason quotes this block |

**What this signature does, and what it does not.** It fixes the vocabulary, the three statements and the one shape, the disclaimer strings, the review triggers and the dispute path, and it gives E08-B02, E08-B03, E05-B09 and E10-B04 something to build against instead of re-deriving.

It moves **nothing** up the evidence ladder. **All ten invariants in §7 are OPEN and not one test exists.** D1–D5 are live in the tree at `7359140` — the condition screen still arrives pre-filled, still shows storage codes, and still composes a buyer-facing listing line with no disclaimer of any kind. The `$100` default is a signed decision, not a measurement. `condition_estimate` and the slab attributes do not exist. **Ratifying a policy is not evidence that the product obeys it**, and the honest reading of this record on the day it was signed is that the policy is ahead of the code by five named defects and ten open invariants.

---

## 13. Change log

**v1.1.1 (2026-09-04) — gate audit, citation hygiene only.** `longbox-gate-auditor`: **PASS** on design, decisions, proposed rows, disclosure class and the registry rows; **NOT-READY** on six citation items. **No decision, string, registry row, trigger or invariant changed**, so §12's signature stands.

| # | Finding | Repair |
|---|---|---|
| **1** | Midtown was paraphrased inside quotation marks as *"but does not assign numerical grades"* | Replaced with the page's own sentence — *"Midtown Comics does not grade or consider any type of numbered grading scale when determining a comic books condition."* (its missing apostrophe preserved). **The real sentence is stronger than the paraphrase**: not merely that it does not assign numbers, but that it does not *consider any numbered scale*. §2.0.5, §2.0.5 conclusion 1, §8 A1 |
| **2** | "CGC publishes five label types" — the labels page lists **fourteen** | Reworded to "five principal types among a longer published list", with the other nine named (CGC×JSA Authentic Autograph, Pedigree, Custom, No Grade, Individual Page, Cover, three Signature Series combinations). The five verbatim descriptions are unchanged, and the count is now the reason `label_type` is **free text as printed rather than an enum of five**. §2.0.2, §1.1(3) |
| **3** | eBay's response-window sentence was rendered as *"When you request a return, the seller should get back to you within 3 business days"* | Replaced with the page's own — *"The seller has 3 business days to get back to you."* §5.2 |
| **4** | The FTC .com Disclosures blockquote was a **composite** — three ideas stitched into one passage that appears nowhere on the page | Replaced with the page's actual sentences: *"must be presented 'clearly and conspicuously'"*, the bulleted factor *"the placement of the disclosure in the advertisement and its proximity to the claim it is qualifying"*, and *"A disclosure is more effective if it is placed near the claim it qualifies."* §2.0.4 |
| **5** | Two edcollins band definitions were attributed to decimal ranges (*"9.0–9.6"*, *"7.0–7.5"*) that the page does not use, and one was truncated | **§2.0.1 rewritten from a raw-HTML re-fetch.** The published scale is **point-to-word, not range-to-word** (`8.0 Very Fine`, `8.5 Very Fine+`, `7.0 Fine/Very Fine`); edcollins' prose sections are headed by **legacy Overstreet percentage scores**, so *"supple pages"* is the **Very Fine** section and *"relatively flat, clean and glossy"* is the **Fine** section, continuing *"with no subscription crease or brown margins."* Overstreet's portal carries one paragraph per decimal point and is quoted separately; **the two pages disagree at the word level** (*"An excellent copy"* vs *"An exceptional copy"*) and the disagreement is recorded. **The correction strengthens §2.1 argument 3**: `8.5 Very Fine+ (VF+)` means the plus is not *like* a number, it **is** the name of grade point 8.5. Dependent repairs in §2.1, §2.2 and two §4.2 rows |
| **6** | MyComicShop now renders blank on three fetches | Moved into the §2.0.6 dead-end table and marked **SOURCED-then-unverifiable**. It is not withdrawn — it rendered once — but it may not be quoted onward without a fresh fetch, and **§2.0.5 conclusion 2 and the register argument behind C13/C17 lean on it and now say so**, with Midtown and CGC's own FAQ named as what the conclusion survives on if it never returns |
| **+** | `file:line` precision | **D3** now cites `scanSessions.ts:334-335` (where the `Condition: VG-FN` string is composed) alongside `:357` (where it enters `descriptionHtml`); `001_init.sql:122-133` → **`:122-131`**; `003:108-111` → **`:108-112`** |
| **+** | Cannon-lens provenance | §12 now states that **no registered `product-critic` agent exists** — that lens was a general-purpose agent instructed to act as it, while `legal-advisor` is a registered agent. Findings adopted on merit; the asymmetry is on the record |
| **+** | `[counsel]` routing | Reconciled against **038 §6** (now on main), which enumerates the batched engagement as **six instruments**. 037's items **join that envelope and do not open a second engagement**; 038 §6 owes four additional rows, and **this record does not make that edit** — on the 030/034 precedent that an amendment to another ratified record is filed by its owner |

**v1.1.0 (2026-09-04) — the cannon round.** `product-critic` ACCEPT-WITH-CHANGES; `legal-advisor` ACCEPT-WITH-CHANGES. **Every amendment absorbed, none declined. No v1.0.0 decision reversed.**

| Amendment | Lens | Disposition | Where |
|---|---|---|---|
| **B1** — C12 must not read as the trade's FN/VF half-step | product-critic | **Absorbed.** "X to Y" becomes **"between X and Y"** in C12, in the §2.2 display rule and in the invariant. v1.0.0 had made the right argument about the slash and then failed it in its own copy. Divergence from 022 P6's *illustrative* "looks Fine to Very Fine" recorded openly rather than smoothed | §2.2, §3.1, §3.4 |
| **C7** — append "Photos are of the actual book." | product-critic | **Absorbed**, always-on, with the condition that it renders only when true (E10-B04 owns that) | §3.1, §3.4 |
| **legal clarification** — C12 mandatory-but-removable | legal-advisor | **Absorbed.** C12 gets the 022 Q7 / C5 treatment: default-on, removable per listing, removal recorded and counted; no standing "no condition statement" configuration | §3.1, §3.4, §7 I4 |
| **B2** — adjacency and naming | product-critic | **Absorbed as N8**, in three parts (no condition value adjacent to a model output in any artifact; no `ai`/`auto`/`predicted`/`suggested`/`estimated`/`recommended` identifier on the condition path; no recorded demo until D1 is fixed), plus **I9** as its detector | §2.5, §7 I9 |
| **C1** — retitle §1 | product-critic | **Absorbed.** "Four things" becomes **three statements and one shape**; a range is a format, not an author | §1 |
| **C2** — Q1 answered by UI, not taps | product-critic | **Absorbed.** No-proposal rule kept; single seven-word ladder (one tap = band, two = range) routed to **E05-B09**; **I3 extended** to forbid suggestion-shaped substitutes | §1.3, §3.2, §7 I3 |
| **C3 + legal (a)** — C14 rewritten | both | **Absorbed.** Label speaks first; "we haven't opened the case" replaces "we have not re-graded"; a pointer to the grader's *current* definitions rather than our paraphrase | §3.1, §3.4 |
| **C4 + legal (f)** — C16 rewritten | both | **Absorbed**, with one wording change made under the coordinator's own instruction: *"Your shop decided…"* makes the shop a third party on its own listing, so the authorship is seated in the first person — ***"We decided to tell you."*** | §3.1, §3.4 |
| **C5** — C13 reworded | product-critic | **Absorbed.** Two sentences saying the same thing twice become one | §3.1, §3.4 |
| **C6** — C15 helper, and `signed` out of the disclosure prompt | product-critic | **Absorbed.** *"You're describing the book, not grading it."* replaces a helper whose second half denied something; `signature_unwitnessed` leaves the damage prompt because a signature is not damage | §2.3, §3.2, §3.4 |
| **BLOCK — "pressed is silence"** | legal-advisor | **Absorbed, and v1.0.0 was wrong.** Silence conflated *not knowing* with *not saying*, which under the FTC standard's own "omission" limb is a policy of omission wearing a disclosure policy's vocabulary. Replaced by a four-sentence rule; **N7b** keeps pressing out of the capture vocabulary without keeping it off the listing. **[counsel]** | §2.4, §2.5 |
| **BLOCK — seller of record** | legal-advisor | **Absorbed as §5.0**: the shop is the seller of record, Longbox is a tool vendor. **C5 v2** proposed (names the shop, adds "Sold by {shop name}."), filed as a **006 row** because C5 is ratified in 022. Liability, indemnity, dispute terms and refund-policy representation routed to the **E01-B05 counsel checklist** | §5.0, §3.4, §10 |
| **C18** — a price-source line | legal-advisor | **Absorbed as a proposal and explicitly not owned here** — routed to E09-B06 / E10-B04, **[counsel]**, and gated on the pricing path being able to support the words (016 C12: the client is a stub) | §3.4, §10 |
| **C8** — the floor is a policy row, and review means touching the field | product-critic | **Absorbed.** The floor moves to `shop_pricing_policy` (default $100, 006 row governs the default; lowering is free, raising is recorded), and a value-triggered review requires the owner to **confirm or edit the condition field**, writing a superseding row — **I10** | §4.1, §7 I10 |
| **C9** — dispute pack and outcome field | product-critic | **Absorbed.** One-tap pack (photos + **the condition line exactly as published**, not a re-render + timestamps) and an outcome field on E11-B04's record, so §5.1 step 8 and 019 K2/T9 have an input | §5.2 |
| **Note** — Q2 answered by E10-B04's mapping | product-critic | **Absorbed** | §2.1 |

**One correction the amendment round produced that nobody asked for.** The instruction to note that "eBay INAD cases are decided on photographs in ~72 h" was checked against eBay's own help pages before it was written down. **The sourced figure is three business days, and it is a seller-response window rather than an adjudication deadline** — across a weekend that is five calendar days, not 72 hours. The *photographs* half is sourced and stronger than stated: eBay's flow **requires** at least one image. Shopify's side is a bank chargeback that **Shopify does not adjudicate**, and **no response-window figure could be sourced at all**, so this record states none. All of it is at §5.2 with URLs and access dates, in the same register as §2.0.6 — because a record whose §2.0.6 enumerates a dozen dead ends does not get to wave a number through because it arrived in an instruction.

**v1.0.0 (2026-09-04) — first draft, PROPOSED.** The four-statement framing, the seven-word ladder with plus/minus declined, the nineteen-option defect vocabulary, six proposed C-rows and seven blocklist rows, five owner-review triggers with a $100 constant, the dispute path, the marketing rule, eight invariants, six alternatives, five questions for the cannon, and the §2.0 sourced grounding with its dead ends.
