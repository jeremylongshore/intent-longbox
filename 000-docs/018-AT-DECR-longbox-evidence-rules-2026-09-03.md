# Decision Record — Evidence Taxonomy, Source Precedence, Contradiction, Supersession and Change Control

**Version:** 1.1.0
**Status:** RATIFIED 2026-09-03 by Jeremy Longshore (in-session, "Ratify all eight as drafted"); binding on all Longbox docs, code, beads, external claims and pilot analysis per §6
**Bead:** E00-B03 `longbox-5s4` (epic E00 `longbox-6om`, gate G0) — see 000-docs/014 §8
**Drafted:** 2026-09-03 by the parent session · **Audited:** `longbox-gate-auditor` (pre-ratification) · **Decision owner:** Jeremy Longshore
**Sensitivity:** Restricted internal (014 §10)
**Supersedes:** nothing — first evidence-rules record. **Inputs:** 014 §13 (evidence ladder), 014 §6.1 rule 10, 016 §0 (register states), 017 (evidence cells), 006 decision log, 008 §Locked decisions, CLAUDE.md §Locked decisions.

## Decision authority

Jeremy Longshore owns this decision. Ratified 2026-09-03 (see §9). Ratification was one edit: set **Status** to `RATIFIED`, fill the Ratification block, bump to v1.1.0, add the 006 decision-log row. After ratification, changing any rule here requires a new decision record that names this one as superseded (§4 rule S4) — never an in-place edit.

## 1. Context — why these rules are needed now

1. **Status prose has drifted from artifacts.** 006 said "beads epic exists; Plane project created" while the tracked bead mirror held one record; 013 scored the system 84/38 with no measurement behind either number; 014 §0 said "223 records" when Dolt held 225 (016 C17, C19, C20, C24, C25).
2. **Design claims have been contradicted by code.** "Photos stay in Shopify" was false — they hit local disk and the LLM provider (016 C22); the 25 MiB upload limit "handles" oversize files by silently truncating and returning 201 (016 C2, bead `longbox-e5b.3.7.1`).
3. **Citations drift even inside one day's work.** The 017 audit caught two wrong sentence numbers and one inverted citation in a register written from the sources that morning.
4. **Every downstream bead consumes these registers**: E00-B04 signs thresholds against 017; E00-B05 gates external claims; E16 reports pilot results; E18 negotiates with a partner who has asked for our mechanisms. A shared rulebook for what counts as evidence is the precondition for all of them.
5. The blueprint already states the principle (014 §13: "marketing and partnership language may never use a stronger rung than the artifact actually reached"). This record turns it into rules with owners, precedence and enforcement.

## 2. Decision A — Evidence taxonomy

Two vocabularies, one ladder. The **ladder** (014 §13) says how strong a claim may be. The **register states** (016 §0, extended by 017 with HYPOTHESIS; folded into 016 §0 at v1.0.3) say what a maintainer actually did. Every claim in any Longbox artifact carries, explicitly or by section, one rung and one state.

### A1. The ladder — what earns each rung

| Rung | Earned by | Permits saying |
|---|---|---|
| ASSERTED | Someone wrote or said it; no artifact | "we intend / we believe / the plan is" |
| SOURCED | A named, dated, retrievable source exists (a 016 row) | "per <source>, …" — attributed, not endorsed |
| REPRODUCED | The maintainer inspected the artifact itself: code at a SHA, a file hash, a query result, a document in hand | "the code does X (file:line @ SHA)" |
| TESTED | An automated test or CI run asserts it and is green on the cited SHA | "X is tested (run URL / test name)" |
| PILOT-MEASURED | Measured at the pilot shop with real items, real operators, a defined cohort and denominators (E01-B02 baseline, E16 batches) | "in the pilot, X per Y over N items" |
| PAID/RETAINED | A shop paid and chose to continue (E16-B10, E17-B09) | "customers pay for X" |
| SCALE-VALIDATED | Holds across the G5 cohorts with comparable metrics (E17-B11) | "at scale, X" |

### A2. The register states — what a maintainer did

`VERIFIED` (inspected; ≥ REPRODUCED) · `REPORTED` (exists per a doc or person; raw artifact off-repo; = SOURCED/ASSERTED) · `SOURCED` (third-party public source, attributed) · `CONTRADICTED` (checked and found false; the evidence cell says how) · `OPEN` (not yet checkable; names the closing bead) · `HYPOTHESIS` (a design assumption or inference, including anything inferred about a partner's intent).

### A3. Mapping rules

- A rung may never exceed what the state supports: REPORTED and SOURCED cap at SOURCED; HYPOTHESIS caps at ASSERTED; only VERIFIED can carry REPRODUCED or above.
- A **green CI run proves only the checks that ran** on that SHA. It is TESTED for those assertions and nothing else.
- **Stub success is never evidence.** A fake client (`stub: true`) proves the wiring, not the integration; live integrations are TESTED only against a sandbox or real token (016 C12, C13).
- **A measurement without denominators is ASSERTED.** "90% accuracy" needs N, cohort, slice and date to be PILOT-MEASURED.
- **Numeric thresholds are PROPOSED** until E00-B04 signs them; a signed threshold is a decision, not evidence that it is met.
- **Partner intent is always HYPOTHESIS.** What a partner said is REPORTED/SOURCED; why they said it is never more than an inference (009 §Top 10 labels this correctly).

## 3. Decision B — Source precedence

When two sources disagree, the higher one wins and the lower one gets a CONTRADICTED row (§4). Order:

| Rank | Source class | Examples |
|---|---|---|
| 1 | Inspected artifact at a SHA / a measurement with denominators | code, migrations, test runs, DB queries, signed contracts on file, E01-B02 baseline data, pilot batch reports |
| 2 | Registered primary source (016 §1–§2) | the docs themselves, emails by location |
| 3 | Third-party published source (016 §3, SOURCED) | vendor docs, forum posts, articles, filings |
| 4 | Author judgment and status prose | 006 narrative, 013 scores, README/CLAUDE.md claims about behavior |
| 5 | Statements about intent (ours or a partner's) | "they are harvesting", "we will ship by …" |
| 6 | Hypotheses and design assumptions | 014 §9 residual-risk column, 017 HYPOTHESIS cells |

Named corollaries, adopted verbatim from the bead note and 014:

- **Inspected code outranks status prose.** If 006 or CLAUDE.md says the system does X and the code at HEAD does not, the code is the truth and the doc gets fixed — never the other way round.
- **Measurements outrank marketing.** A 014 §5 metric with a pilot number beats any adjective in a business case or a partner email.
- **Locked decisions outrank convenience, not evidence.** CLAUDE.md §Locked decisions and 008 govern what we *build*; they do not make a claim about what the code *does* true. A locked decision can be relitigated only by Jeremy (§5).
- **The register outranks the session.** Nothing said in a Claude session or a chat is evidence until it is a 016 row or a bead note that cites an artifact.

## 4. Decision C — Contradiction and supersession

**C1 Contradiction.** When a rank-1 source contradicts a lower one: (a) add a CONTRADICTED row to 016 §5 with file:line or the measurement; (b) fix the lower source at its origin in the same change (doc Version bump + 000-INDEX hook) or, if the fix is real work, file a bead with a discovered-from link (the 016 C2 pattern); (c) never edit the prose to match the claim without the artifact. Contradictions are never deleted from 016 — a resolved one reads "CONTRADICTED then corrected" (016 C24/C25).

**C2 Supersession of documents.** Docs are append-versioned: a substantive change bumps `**Version:**` and the 000-INDEX hook; prior text lives in git history and is never rewritten. A superseding statement names what it supersedes and why (006 decision-log row). Docs without a `Version:` line (today 007, 008) are brought under this rule at their next edit.

**C3 Supersession of decisions.** A decision record is superseded only by a later decision record that names it. Locked decisions (CLAUDE.md, 008) are superseded only by Jeremy, recorded in 006 with date, old text, new text and reason. Signed thresholds (E00-B04) move only by the same mechanism — "do not move thresholds after seeing results without a logged decision" (014 §8 E00-B04 note).

**C4 Supersession of work.** Beads are never deleted or retitled away from their history: use `bd supersede`, `bd reopen`, and notes; closing evidence names the artifact (commit SHA, run URL, doc number, audit verdict). A bead closed without an artifact in its reason is reopenable by the gate auditor.

**C5 Supersession of data.** The Hickey model applies to evidence as to product data: registers, snapshots and eval labels are appended, corrected by a new row, and purged only by a designed path (014 §6.1, E02-B07).

## 5. Decision D — Change control (who may change what)

| Artifact | May change it | Mechanism | Guard |
|---|---|---|---|
| CLAUDE.md §Locked decisions; 008 locked decisions | Jeremy only | 006 decision-log row (date · old · new · reason) + doc Version bump | `longbox-invariant-reviewer` BLOCKs code that violates one; `longbox-gate-auditor` flags NEEDS-OWNER-DECISION |
| This record's rules | Jeremy, via a superseding decision record | new AT-DECR naming this one | never in-place |
| 014 blueprint (scope, gates, thresholds) | Jeremy | Version bump + 006 row; thresholds only through E00-B04 amendment | registers and beads reconcile at the next audit |
| 016 / 017 registers (content) | parent session | append rows; Version bump; audit before the owning bead closes | `longbox-gate-auditor` pre-close |
| `tests/TESTING.md` policy sections, `features/*.feature`, arch-rule configs, coverage/mutation thresholds | engineer (Jeremy) | edit, then `pnpm exec audit-harness init` | hash manifest; CI `verify` + `escape-scan` blocking; builders refuse (agent files) |
| Bead titles, parents, edges | parent session under 014 §6.1 | `bd` with a note; alias metadata never repurposed | 015 alias map reconciles to Dolt |
| External claims (public, partner, pilot) | Jeremy approves wording; E00-B05 registry holds it | claim rung ≤ artifact rung (A3); disclosure class per 014 §10 | `longbox-gate-auditor` before any doc, PR body, email draft or deck leaves Restricted internal |
| Pilot-shop data and the shop owner's name | the shop owner's consent (E01-B06/B07) + Jeremy | consent on file in 016 §2 | gate auditor consent check |

## 6. Where the rules apply, and how they are enforced

| Surface | Rule in force | Enforced by |
|---|---|---|
| **Docs** (`000-docs/`) | every claim carries a rung/state by section; Version + index on change; contradictions to 016 §5 | doc-filing convention (manual — this repo has no doc-filing hook today; the only wired hook is SessionStart `bd prime`; add one under E15 if wanted), prettier/CI, gate auditor on governance beads |
| **Code** | comments and CHANGELOG describe what the code does at that SHA, not what is planned; stubs are labeled `stub: true`; no "verified" without a test | `longbox-invariant-reviewer` pre-close; CI |
| **Beads** | notes cite artifacts; close reasons name SHA/run/doc/audit; PROPOSED thresholds stay labeled in acceptance text | gate/invariant auditors; `bd-sync close` reason |
| **External claims** | rung ≤ artifact; retire "AI grades", "seconds", "pilot live", "verified", "production-ready" unless earned; partner intent never stated as fact; never-answer list (010) binding | E00-B05 registry; gate auditor; MiniMax adversarial lane (advisory) |
| **Pilot analysis** | PILOT-MEASURED only with cohort, N, denominators, date, frozen manifest (E16-B02); averages never conceal slices | E16-B08 weekly review; E14-B07 eval regression |

## 7. Consequences

- Slower prose, faster trust: every "we do X" costs a citation. That is the point — 006's drift cost a day of re-audit.
- The registers grow: 016 gains a row per new source and a CONTRADICTED row per catch; that is the audit trail, not overhead.
- Partner conversations get shorter and safer: only earned rungs are speakable (010 never-answer list remains binding).
- Some existing text is already out of compliance (013 scores, 007/008 missing Version lines, README org badges); E02-B01 and E15-B01 own those repairs — this record does not rewrite history.

## 8. Alternatives considered

1. **One boolean (verified / unverified).** Rejected — it cannot express PILOT-MEASURED vs TESTED, which is the exact distinction a partner or paid decision would turn on.
2. **Per-document trust levels** (e.g., "006 is always advisory"). Rejected — trust belongs to claims, not files; 006 contains both verified decisions and drifted prose.
3. **Rewrite drifted docs silently.** Rejected — hides the drift rate, which is itself a signal (014 §17 "stale references" risk).
4. **Adopt 014 §13 as-is with no precedence or change-control rules.** Rejected — the ladder says how strong a claim is but not who wins a conflict or who may change a rule; the first two audits needed both.

## 9. Ratification

| Field | Value |
|---|---|
| Decision | Adopt Decisions A–D (§2–§5) as binding for all Longbox docs, code, beads, external claims and pilot analysis (§6) |
| Ratified by | Jeremy Longshore |
| Date | 2026-09-03 (in-session, PR #20; the eight rule choices listed by the pre-ratification audit were accepted as drafted) |
| Amendments at ratification | none |
| Recorded in | 006 decision log row dated 2026-09-03; bead `longbox-5s4` close reason quotes this block |

This block was filled on 2026-09-03; the rules are binding from that date. Before it, they were the parent session's working practice (what the 016 and 017 audits already enforced).
