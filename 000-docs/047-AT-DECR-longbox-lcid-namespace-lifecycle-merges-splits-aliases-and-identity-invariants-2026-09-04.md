# Decision Record — The LCID Namespace, Its Lifecycle, Merges, Splits, External Aliases and the Identity Invariants

**Version:** 1.1.1
**Status:** **RATIFIED 2026-09-04** by the acting head of board under Jeremy Longshore's 2026-09-03 delegation, after a two-lens cannon (`rich-hickey-reviewer`, `martin-kleppmann-reviewer`). Binding per §14. Amendments **A1–A12** absorbed in full, none declined; all nine §13 questions answered; dissents preserved verbatim in §14. **Nothing in §2–§10 exists; nothing here is TESTED** — ratification binds the decisions and installs nothing.
**Bead:** E04-B01 `longbox-e5b.4.1` (epic LBOX-E04 `longbox-e5b.4`, gate G2, evidence class DEC, owner-role data, risk critical, phase P1-foundation, layer catalog) — see 000-docs/014 §8 row E04-B01
**Drafted:** 2026-09-04 by `longbox-domain-builder` · **Cannon:** `rich-hickey-reviewer` + `martin-kleppmann-reviewer`, 2026-09-04 · **Audit:** `longbox-gate-auditor` before close · **Decision owner:** Jeremy Longshore (acting head of board under the 2026-09-03 delegation)
**Sensitivity:** Restricted internal (014 §10).
**Supersedes:** nothing — first record on the LCID itself. It **discharges** the non-decision 030 §12 files at `030:496`: *"It does not decide the LCID's format, namespace, lifecycle, or merge/split semantics. That is **E04-B01**."*
**Inputs:** 014 §8 rows E04-B01 through E04-B12, E02-B04, E02-B05, E02-B07, E02-B10, E06-B01, E06-B02, E06-B04, E06-B05, E06-B08, E07-B01, E09-B02, E19-B06 (`014:412-423`, `:452-459`, `:471`, `:510`) · 015 alias map · **030 v1.1.1 in full, and §2.1, §2.2, §2.3, §2.5, §3.3, §4, §5.2, §7, §7.1, §8, §12 line by line** · 036 v1.1.1 §2.1, §4.1, §4.2, §4.3 · 037 v1.1.1 §1.1, §3 · 041 v1.1.2 §2.1, §2.4, §3.1, §3.3, §3.5, §3.6, §8.4, §10 · 042 v1.2.0 §0, §2.3, §3.3, §5, §6 · 043 §3.2 · 019 v1.2.0 T1, T3, T7, T17, T18, T24, T25, §2, §3.0 · 018 §2 A1/A3, §4 C2/C5, §5 · 021 v1.3.0 · 022 v1.1.1 P1, P6 · 023 v1.0.1 §3, §5 · 029 v1.2.0 §2.2, §2.3, §9 · 044 §6, §8 · 011 v1.x §data-source research (`011:140`, `:143`, `:154-158`, `:202`) · `src/services/confirmationOutcome.ts`, `src/services/identify.ts`, `src/services/barcode.ts`, `src/services/rerank.ts`, `src/services/scanSession.ts`, `src/contracts/v1/schemas.ts`, `src/db/appendOnlyTables.ts`, `src/events/catalogue.ts`, `migrations/001_init.sql`, `migrations/004_human_confirmation_outcome.sql`, `tests/append-only-detector.test.ts`, `tests/confirmation-outcome.test.ts`, `tests/RTM.md` · CLAUDE.md locked decisions 4, 5, 6, 7.

## Change log

**Version convention** (006 `:6`, as used by 029/030/034/036/037/040/041/042/043): a **minor** bump means the content of a decision changed; a **patch** means a statement of fact was repaired with no decision changing.

| Version | Date | What changed | Authority |
|---|---|---|---|
| 1.0.0 | 2026-09-04 | Initial draft. **Status PROPOSED, §14 unsigned**, nine questions open in §13. Nine decisions: what an LCID names and the four things it must not name (§2); the namespace — opaque payload behind a prefix that may encode **only what can never be corrected** (§3); minting as an insert-only registry row that is never speculative and never reused (§4); the lifecycle as appended facts with **no status column and no PROPOSED state** (§5); merges as a survivor-pointer forest with two distinct reads, `resolve` and `asStated` (§6); splits defaulting to **ambiguity plus a review obligation** rather than a silent continuation (§7); external identifiers as classified alias namespaces in which a grader cert is a **copy** fact and never an edition alias (§8); resolution as two facts — what the person picked and what the catalog said that was — with `edition_signature` versioned by the pack and **kept separate from `identityKey`** (§9); and the corpus relation, in which a merge is a dated assertion and `resolve` takes an optional as-of (§10). **Corrects one framing inherited from the bead's own directives**: the brief describes `edition_signature` as *"normalized title+issue+variant+publisher+year"* and names `confirmationOutcome.ts`'s `identityKey` as its seed. `identityKey` **deliberately excludes publisher and year**, with the reason written at `src/services/confirmationOutcome.ts:44-49`, and 030 §3.3's ratified comic signature is `series + issue + variant + printing`. §9.3 keeps them two functions and says why merging them would move a 019 T1 measurement rule that `019:57` makes non-editable without a 006 row. | `longbox-domain-builder` |
| **1.1.1** | **2026-09-04** | **Patch after the `longbox-gate-auditor` report on E04-B01 (statements of fact only — no decision changed, no re-cannon, §14 stays signed).** Three repairs. **(1) Every `030:NNN` cite re-anchored** to 030 v1.2.1's line numbers: the ratification of this record inserted a change-log row and a §5.4 amendment paragraph into 030, and this patch's companion edit inserted one more change-log row, so every cite drafted against 030 v1.1.1 was one to four lines high. Twenty-seven `030:` cites moved; each was verified by opening the cited line. The two `030:363` cites — which quoted the card signature as `set\|number\|variant\|language\|grader` — now point at `030:367`, the amendment paragraph that *records* that v1.1.1 read that way, because §3.3 and §5.4 no longer do. **(2) Four non-030 cites repaired**, none of them a line-shift: `041:196` → `041:193` (the R2 table row that carries the quoted words; 196 is blank), `041:197-198` → `041:194-195` (the R3/R4 rows), `041:138` → `041:86-94` (the §2.1 envelope table, not the `candidate_set` aside), `036:277` → `036:277-279` (277 is the block quote; the quoted sentence *"a confirmed session produces at most one copy"* is at 279). **(3) §0's percentage rule re-sourced:** the register that bars unmeasured percentages is 021 (`021:62`, on 018 A3 / 020 Q10), not `019:34`, which is 019's segment list. `001:54` and `003:4-7` were checked and stand — they follow the established migration-file convention (030 `:381`, 041 `:92`, `:188`), not the doc-number one. **§12.4's owner column re-pointed** to the beads the gate audit created: items 1–4 to **E04-D01** `longbox-e5b.4.13`, item 6 to **E04-D02** `longbox-e5b.4.14`; item 5 stays E04-B04. 015 carries both rows. | E04-B01 gate audit (`longbox-gate-auditor`) |
| **1.1.0** | **2026-09-04** | **RATIFIED.** Twelve cannon amendments absorbed, none declined — decisions changed, hence a minor bump. **A1** (Kleppmann 1, REQUIRED) §4.4/§12.1 state that the mint path is **deliberately AP on an `edition_signature` collision**: two concurrent mints of one signature are two valid LCIDs whose merge is a later human-arbitrated fact (§6), and **no UNIQUE is added on signature** (030 §3.3). New invariant **I17** separates the two unique violations — a `lcid_registry(lcid)` violation retries (§3.2); a duplicate-signature mint never raises one. **A2** (Kleppmann 2 + Hickey 4) §6.2/§10 adopt 041 §6.2's materialized projection `lcid_current_survivor`, rebuildable from `lcid_merge` in one pass and maintained **inside the merge's own transaction**, with a checked-in benchmark fixture and a CI plan-shape gate (**I18**, added to carry A2's two checkable obligations); an obligation lands on E06-B02 that any cache of `resolve()` is keyed by corpus version and invalidated **transactionally**, never by TTL. **A3** (Kleppmann 3, REQUIRED) §10.2 makes `resolve` **TOTAL over five outcomes** — current value, MERGED, RETIRED, SPLIT-AMBIGUOUS, NOT_YET_MINTED — and I12 covers all five. **A4** (Kleppmann 4) §8/§12.3 rule that a certification write to `edition_external_id` is a **catalog-authoring act, never a shop-workflow act**, with a role separation T24's tenant-data detector cannot see; E04-B06 must state its own detector. **A5** (Kleppmann 5) §3.2/§4.4 put the mint retry inside the same `withTransaction` helper and lock-order discipline, and state that the registry has **no shop anchor**, so the single INSERT takes no anchor lock — an E04-B04 acceptance line. **A6** (Hickey 2, the Q6 ruling) grader and `cert_number` are **COPY facts in every vertical**; 030 takes an amend-by-a-row to v1.2.0 removing them from §5.4's card signature, and E04-B03 gains an acceptance line. **A7** (Hickey 5, the Q5 ruling) §9.3: **019 T1 scores on `asStated`** — `resolve(lcid, asOf = the eval set's own corpus version)` — so a later merge never moves a frozen eval's score, while production reads resolve current; an E07-B01 obligation. **A8** (Hickey 3) §9.3 gains a **static guard** that `identityKey` and `edition_signature` share no field-list constant and that a PR touching both without a 006 row fails — an E04-B02 acceptance line. **A9** (Hickey 6, the Q8 answer) the three narrow lifecycle tables **stand**, on the 030 A1 / 041 supersession precedent. **A10** (Hickey vs Kleppmann on I8) §6.1/§10.2: the bounded walk **RAISES and refuses at mint/merge WRITE time**; at READ time `resolve` never throws past its caller — it returns an outcome value, symmetric with §7.2's split handling. **A11** (Kleppmann/Lamport, the Q3 answer) §10.2 makes `asOf` **MANDATORY at the catalog module's `resolve()` boundary**, with a thin `resolveCurrent()` at named call sites only. **A12** answers the remaining questions: **Q1 YES** (kind and vertical are immutable values; the prefix stands), **Q9** keeps the check character, and **Q7** rules that a batched import's citing row is **the import-batch fact itself** — one fact per batch, mints atomic with it — stated in §4.4 and I5. **Q2 and Q4 stand as drafted.** No §1 today-claim was disturbed; §0's evidence posture is unchanged. | Two-lens cannon → acting head, §14 |

## 0. Evidence posture

Per 018 §2 A1/A3, and with the lesson 041 v1.1.1 and 042 v1.1.1 both learned the hard way — a negative claim resting on a line count goes stale the moment an unrelated merge introduces a matching substring:

- **Every "today" claim in §1 is REPRODUCED at `2242547`** — `main`, the E02 epic-close commit — each carrying a `file:line` **or** the verbatim command that produced it **with its exit status**.
- **Every negative claim names the symbols that must return nothing, and prints the matches that are not the thing being denied.** This record's central negative — *there is no canonical identity in this system* — is exactly the kind of claim a substring collision would falsify while leaving the finding intact, and the tree already contains one such collision (E2 below: a **fixture string** naming `lcid_registry` in a unit test for a table nothing creates). It is printed and characterised rather than counted around.
- **The symbols that must return nothing at `2242547`, and do.** `CREATE TABLE … lcid_registry`, `CREATE TABLE … collectible_definition`, `CREATE TABLE … edition`, `CREATE TABLE … edition_signature`, `CREATE TABLE … edition_external_id`, `CREATE TABLE … identity_resolution` — `grep -rn 'CREATE TABLE.*\(lcid_registry\|identity_resolution\|edition_signature\|collectible_definition\)' migrations` → **exit 1, zero lines**. `lcid_merge`, `lcid_alias`, `lcid_split`, `merged_into`, `alias_of`, `edition_external_id` — `grep -rniE 'lcid_merge|lcid_alias|lcid_split|merged_into|alias_of|edition_external_id' --include=*.ts --include=*.sql src migrations scripts tests` → **exit 1, zero lines**. There is no `src/catalog/` directory: `ls src` returns `consumers contracts db events http providers routes services app.ts config.ts db.ts server.ts`.
- **Everything in §2–§10 is ASSERTED.** No table, column, constraint, function, migration or line of TypeScript exists as a result of this record. Every invariant in §11 names a test file that does not exist. This record writes no DDL and no code.
- **The preconditions this record depends on are DECIDED and UNBUILT, and the distinction matters.** 030 v1.1.1 is RATIFIED and specifies `lcid_registry`, `collectible_definition`, `edition`, `edition_signature`, `edition_external_id`, `data_source`, `vertical_pack`, `vertical_pack_version` and `identity_resolution` (`030:383`, `030:394-406`). **None of them exists** (E1). This record therefore designs a lifecycle over a schema that is itself a design, and §9 orders it behind E02-B07 and E02-B10 accordingly. **Adopting this record does not change the running system by one line.**
- **The infrastructure this record leans on has SHIPPED, unlike 040's, 041's and 042's.** The request transaction (E02-D04), the two database roles (E02-D06), `ENABLE ALWAYS` on every append-only trigger with a declared list in `src/db/appendOnlyTables.ts` (E02-D05), the supersession integrity triggers (`migrations/008`, `013`) and the architecture gate (`.dependency-cruiser.cjs`, `ls` exit 0; `scripts/architectureGate.ts`, `scripts/architectureRules.ts`) are all on `main` at `2242547`. **So none of §11's invariants is ⛔ blocked on a missing helper, and none is ⚠ conditional on an uninstalled gate** — a first for this record series. What blocks them all is that the tables they assert about do not exist yet.
- **No percentage appears in this record that is not a quoted 019 threshold.** 021's disclosure register bars *"unmeasured percentages of any kind, internally or externally"* except *"with N, denominator, date"* (`021:62`, on 018 A3 and 020 Q10). §9.3 touches T1 and T3 and quotes them; it computes nothing.
- **No numeric threshold is set here, and no number in §3 is a measurement.** The payload width in §3.2 is a **design parameter with its derivation stated**, not a measured collision rate, and §3.2 deliberately refuses to quote a birthday-collision figure: the registry's primary key turns a collision into a failed INSERT, which is an engineering fact, where a probability would be a manufactured one (018 §2 A3, as 042 A3 refined it — a number that protects the system is not a number that describes it).
- §8 treats `covrprice` as an alias namespace and asserts nothing about their API, their data, their coverage or their intentions. 014 §8 row E04-B09's own non-goal is quoted rather than extended: *"No production dependency before written API terms"* (`014:420`).
- **Ratification moved nothing up the ladder.** §14 is signed at v1.1.0; it records that a design was argued and adopted. It does not make any claim in §2–§10 true of any running system, and in particular it does not give this system a canonical identity — that is E02-B07, E02-B10, E04-B02 and E04-B04's, in that order. Every §1 today-claim was re-checked at `2242547` against the A1–A12 amendments and none was disturbed.

## 1. What exists today (REPRODUCED at `2242547`)

| # | Claim | Evidence |
|---|---|---|
| **E1** | **There is no canonical identity anywhere in this system, and 030's catalog is entirely unbuilt.** `grep -rniE 'lcid\|lcid_registry\|edition_lcid\|definition_lcid\|identity_resolution\|edition_signature\|collectible_definition' --include=*.ts --include=*.sql --include=*.js src migrations scripts public tests` returns **three lines, exit 0, and not one of them is an identity**. They are characterised in E2 and E3. The symbols that must return nothing are listed in §0 and all return nothing. **030 §7's eight catalog tables and one workflow table are a ratified design with zero DDL behind them.** | grep, three matches, all characterised; §0's `CREATE TABLE` grep, exit 1 |
| **E2** | **The one occurrence of `lcid_registry` in the tree is a FIXTURE STRING for a table nothing creates.** `tests/append-only-detector.test.ts:119` and `:125` use `"lcid_registry"` as the synthetic name of an *undeclared* append-only trigger, to prove that the E02-D05 detector fails closed on a table that was created without being added to `src/db/appendOnlyTables.ts`. **This is the collision 042 E6 and E7 were repaired for, arriving early**: a future reader grepping for `lcid_registry` will find two hits and must not read them as the table existing. They are a test of the detector, and the name was chosen because it is *known not to exist*. | `tests/append-only-detector.test.ts:119`, `:125` |
| **E3** | **The third occurrence is a comment recording a decision this record inherits.** `migrations/004_human_confirmation_outcome.sql:43` cites 030 A1: *"030 A1 rejected a reserved nullable column (`confirmed_edition_lcid`) precisely because its NULL carried TWO meanings — 'not resolved yet' and 'predates the column' — and the reader could not tell them apart."* The comment is about `outcome`, not identity; it is quoted here because §9.1 is the record that finally has to honour it. | `migrations/004_human_confirmation_outcome.sql:43-48` |
| **E4** | **Identity today is an untyped jsonb blob on one immutable row, and the DDL comment has been waiting for this record since `001`.** `human_confirmation.confirmed_issue jsonb NOT NULL, -- issue ref (candidate payload or manual entry); corpus FK when corpus lands` (`migrations/001_init.sql:115`). It is written from the service at `src/services/scanSession.ts:250` and read back untyped at `:206`, `:222`, `:359`, `:380`. | `migrations/001_init.sql:115`; `src/services/scanSession.ts:206`, `:222`, `:250`, `:359`, `:380-381` |
| **E5** | **The blob reaches the wire as `z.unknown()`.** The ratified v1 contract (042 §2.5) declares the confirmation's identity payload as `confirmed_issue: z.unknown()` (`src/contracts/v1/schemas.ts:205`). So the one field in this API that carries what a book *is* is the one field the contract declines to describe — correctly, because there is nothing yet to describe it as. | `src/contracts/v1/schemas.ts:205` |
| **E6** | **The system's de facto identity function is `identityKey`, it is three fields, and it is scoped to one session's comparison.** `identityKey(payload)` (`src/services/confirmationOutcome.ts:56-68`) normalises `title`, `issue` and `variant` — trim, collapse whitespace, casefold, strip a leading `#` from the issue — and joins them with an ASCII unit separator (`\u001f`), chosen because it cannot occur in any of the three fields (`:65-67`). It has exactly three callers, all inside `decideOutcome` (`:116`, `:118`), and one test file (`tests/confirmation-outcome.test.ts:8-21`). | `src/services/confirmationOutcome.ts:56-68`, `:116`, `:118`; `tests/confirmation-outcome.test.ts:8-21` |
| **E7** | **`identityKey` deliberately excludes publisher and year, and the reason is written down.** `confirmationOutcome.ts:44-49`: *"The identity of a comic, per 019 T1: title + issue + variant. Publisher and year are metadata the operator does not pick between — two candidates that differ only in `year` are the same identity claim with one of them mistyped, and a manual entry routinely omits both — so including them would score a plain acceptance as a correction and inflate T3."* **This is a measurement decision, not an oversight**, and §9.3 is the section that has to respect it. | `src/services/confirmationOutcome.ts:44-49` |
| **E8** | **The barcode rung already decodes cover variant and printing and still has nothing to resolve them against.** `parseComicBarcode` returns `supplement: { raw, issue, cover, printing }` — digits 1–3 issue, digit 4 cover, digit 5 printing (`src/services/barcode.ts:5`, `:10-14`, `:64-68`) — and the parse is JSON-stringified into `candidate_set.candidates` at `src/services/identify.ts:157-158`. 030 E10 recorded this at `0c630a0`; it reproduces unchanged at `2242547`. | `src/services/barcode.ts:5`, `:10-14`, `:64-68`; `src/services/identify.ts:157-158` |
| **E9** | **`candidate_set` is corpus-pinned and catalog-unlinked.** `corpus_version_id uuid REFERENCES corpus_version(id)` (`migrations/001_init.sql:86`), on a table whose `candidates` is jsonb. The two writers are the barcode rung (`identify.ts:157-158`, `method='barcode'`) and the vision rung (`:167-168`, `method='llm_vision'`), and neither resolves to anything. | `migrations/001_init.sql:82`, `:86`; `src/services/identify.ts:157-158`, `:167-168` |
| **E10** | **`corpus_version` exists, is append-only, and nothing writes it — and that is now recorded as a rule, not a gap.** The table is at `migrations/001_init.sql:54`, is in the trigger array at `:175`, is declared in `src/db/appendOnlyTables.ts:148-149`, and `src/events/catalogue.ts:151-152` states its rule verbatim: *"Nothing writes it (041 §10.1)."* **So the corpus this record's whole as-of design hangs from is an empty table with a declared absence of writers.** | `migrations/001_init.sql:54`, `:175`; `src/db/appendOnlyTables.ts:148-149`; `src/events/catalogue.ts:151-152` |
| **E11** | **The evidence gate can already contradict an identity claim, and has nowhere to record what it contradicted.** `checkEvidenceContradiction` (`src/services/rerank.ts:18-66`) cross-validates `issue_number_read`, `price_box_text` and `logo_era_guess` against the top candidate's `issue` and `year`, returning reasons as English strings. It compares a model's reading against **another model's candidate**, because no catalog row exists to compare either against. | `src/services/rerank.ts:18-66` |
| **E12** | **The `upc` still reaches pricing as free text.** `PricingQuery.upc?: string` (`src/services/pricing.ts:23`) is accepted from the request body and forwarded to providers as a query string. 030 E13 recorded it at `0c630a0`; it reproduces unchanged at `2242547`, and no identifier in this system is resolved against a namespace. | `src/services/pricing.ts:23`; 030 E13 |
| **E13** | **The append-only infrastructure this record needs is all shipped.** Migrations `001`–`013` are on `main`; `006` put every `forbid_mutation()` trigger at `ENABLE ALWAYS`; `008` and `013` added supersession integrity and forward ordering; `009` added `request_idempotency`; `010` added `scan_session_transition`; `011`–`012` added the outbox. `.dependency-cruiser.cjs` exists (`ls`, exit 0) and `scripts/architectureGate.ts` + `scripts/architectureRules.ts` are the second half of the gate. **Nothing in §11 is blocked on missing machinery** — only on missing tables. | `ls migrations` (013 files); `ls .dependency-cruiser.cjs`, exit 0; `ls scripts` |

**What §1 adds up to.** The system has been identifying comics for its whole life without a way to say what a comic **is**. It has a comic-shaped vocabulary (E6), a deterministic decoder that already extracts the two digits that separate one printing from another and throws them away (E8), an immutable place to record a human's decision (E4), a wire contract honest enough to type that place as `unknown` (E5), a corpus table with a declared absence of writers (E10), and a contradiction gate reduced to checking one model's reading against another model's guess because there is no third thing to check either against (E11).

**The through-line, and it is not 040's, 041's or 042's.** Those three records were about the log — what it says, who wrote it, and what crosses the boundary. **This record is about the referent.** Every guarantee those records won is a guarantee about a *statement*: that it is append-only, that it names its author, that it says what world it was made against. **None of them says what the statement is about.** `human_confirmation` records, immutably and forever, that a person confirmed a jsonb blob — and two blobs that mean the same book are two different blobs, two blobs that mean different books may be byte-identical if the difference was a printing nobody typed, and no query can ask "how many copies of this edition has this shop listed" because *this edition* is not a thing the database can name. **E04-B01 is the decision that Longbox has a name for the thing it is talking about, that the name is ours, that it never changes meaning, and that every correction the world later forces on us is a new fact rather than an edit to that name.**

## 2. Decision A — What an LCID names, and the four things it must not name

### 2.1 The rule

> **An LCID names a catalog *value* at one of exactly two levels — a `collectible_definition` or an `edition` — and nothing else. A physical copy, a scan session, a condition and a certification are not LCIDs and never acquire one. `lcid_registry.kind ∈ {definition, edition}` is closed, and widening it is a new decision record.**

030 §2.5 already fixed the two kinds in the registry sketch (`030:143-144`). This record makes the closure explicit and says what falls outside it, because the four exclusions are where identity models usually rot.

### 2.2 The level an act of identification lands on is the **edition**

030 §2.3 is quoted rather than re-argued (`030:107`): *"An `edition` is the referent of an act of identification… The edition, not the definition, is what a human confirms."* This record adopts it unchanged and adds the consequence that matters for §9: **`identity_resolution.edition_lcid` is an edition LCID, always**, and there is no definition-level resolution. A definition-level match that cannot reach an edition resolves through `is_canonical_edition` (`030:116`) — the default printing — and the resolution's `method` records that it did, so *"we only knew the issue"* is a readable fact rather than an indistinguishable success.

### 2.3 The four things an LCID must not name

| Not an LCID | What it is instead | Authority |
|---|---|---|
| **A physical copy** | `physical_item_id`, shop-scoped, workflow-owned, exactly one row per copy for the life of the copy | 036 §2.1; 030 §2.1, §2.4 |
| **A scan session** | `scan_session.id` — an identification *episode*, not an object; *"a confirmed session produces at most one copy"* (`036:277-279`) | 036 §4.1 |
| **A condition** | a grade **range** plus named defects on `condition_assessment`; *"never a number"* (`037:461`) | 037 §1.1; locked decision 5; 019 T7 non-waivable |
| **A certification (a slab)** | a fact about a **copy** — the grader, the cert number, the label — recorded on the copy and its condition, never on the edition | §8.4; 036 §2; 037 |

**The slab exclusion is the one that will be argued with, so it is argued here.** A CGC-slabbed *Amazing Spider-Man* #300, direct market, first printing is **the same edition** as a raw one. It is a different *copy*, in a different *condition*, with a different *price*, and none of those three is identity. The pull toward making it a separate edition is real and commercial — a slabbed book trades differently — but yielding to it makes edition identity a function of a copy's attributes, which means:

1. **The same physical book changes edition when it is graded**, and every prior statement about it becomes a statement about a different edition. That is not a correction; it is an identity that moves, which 041 §3.6 forbids by construction.
2. **Two shops holding the same book disagree about the catalog** depending on whether either has sent theirs to a grader — a tenant's operational choice mutating a non-tenant-scoped table, which 030 §2.1 rules out by giving definitions and editions no `shop_id`.
3. **The grade enters identity**, and locked decision 5 plus 019 T7 (non-waivable) forbid a numeric grade anywhere. A grader's label is a number wearing a name.

**Decision: a grader is never part of edition identity — in the comic vertical or in any other (A6, the Q6 ruling).** v1.0.0 confined the rule to comics and put the resulting tension with 030 §5.4's card sketch — whose sketched signature was `set|number|variant|language|grader` (`030:367`) — to the cannon rather than overruling a ratified record from a bead that does not own the card pack. **The cannon ruled that this is not a pack decision at all: it is the same rule restated.** `grader` and `cert_number` are **COPY facts in every vertical**, because the three consequences above do not become acceptable when the object is a card — a slabbed card is the same edition as a raw one, held by a different copy in a different condition at a different price. A pack may choose which *edition* attributes enter its signature; it may not promote a copy attribute into one.

**030 takes an amend-by-a-row for this, and it is applied with this ratification** (030 v1.2.0, change-log row: *"§5.4 card signature: grader/cert_number move out of edition into the copy-level record, symmetric with 047 §8.4"*), with a 006 row of the same date. **E04-B03 acceptance line: cert namespaces are excluded from `edition` and from `edition_signature`** — the card pack's identity fields and its signature carry neither `grader` nor `cert_number`, and a pack manifest that declares either as an edition field fails pack certification. Nothing is broken today: E19-B06 gates any second vertical on evidence (`030:369`), so no card pack exists to disagree with, and the amendment lands while the sketch is still a sketch.

## 3. Decision B — The namespace: an opaque payload behind a prefix that encodes only what can never be corrected

### 3.1 The rule

> **An LCID is `lb.<kind>.<vertical>.<payload><check>` — a fixed literal `lb.`, a one-character kind, the registered three-character vertical code, and a 16-character Crockford base32 payload from a CSPRNG followed by one Crockford check character. The payload carries no meaning, no time and no order. The prefix may encode a fact if and only if that fact can never be corrected. Canonical form is lowercase; equality is byte equality on the canonical form; exactly one function in `catalog` parses or constructs one.**

Example: `lb.e.cmc.7q2k9v4xr3tb0m8h5`.

### 3.2 Opaque versus structured, and the line that is actually defensible

Three constructions were available.

**(a) Fully structured** — `cmc-marvel-asm-0300-direct-1p`, an LCID a human can read. **Rejected.** It is *easy* and it is not *simple*: it braids identity with value, and every attribute it encodes is an attribute the catalog can be wrong about. When GCD corrects the publisher attribution on a 1970s book, the LCID either becomes a lie a reader trusts or forces a re-mint — and a re-mint is precisely the thing §4.3 forbids, because every immutable row citing the old string would then cite a name that names nothing. **The failure is silent**: nobody re-reads an identifier to check whether it still describes its referent, which is exactly why it must not describe anything.

**(b) Fully opaque** — a bare UUID, no prefix. **Rejected, and it is the honest alternative.** Its argument is that any structure is a temptation, and the cleanest identifier tells you nothing. What it costs is real: a UUID in a Shopify metafield, a log line, a CSV a shop exports, a support screenshot or a partner's payload is indistinguishable from every other UUID in the estate — and this system already carries `scan_session.id`, `physical_item_id`, `candidate_set.id`, `llm_rerank.id`, `outbox.id` and `request_idempotency` keys, all UUIDs. *"Which of these is the catalog id"* becomes a question answered by remembering, and 042 §2.2's argument applies verbatim: **this project's entire evidence regime is citation, and a value that cannot be recognised in a grep is a value nobody cites.**

**(c) Opaque payload, typed prefix.** **Adopted**, under a rule that makes (a)'s failure mode unreachable:

> **An LCID may encode only what can never be corrected.**

`kind` and `vertical` qualify, and they are the *only* two facts in the whole catalog that do. A definition never becomes an edition. An edition never changes vertical — 030 I3/I7 already require `edition.vertical` to equal its definition's (`030:115`, `030:434`), and a book does not become a trading card. Publisher, series, issue, year, printing and variant do **not** qualify: every one of them is a thing a corpus advance or a human correction can change, and 030 §2.2's whole supersession design exists because they change.

The redundancy between the string and the row is deliberate and the database enforces it: `lcid_registry` carries a CHECK asserting the prefix agrees with `kind` and `vertical` (§4.2, I3). A redundancy a constraint checks is not duplication; a redundancy nothing checks is drift waiting.

**Why no timestamp and no monotonic component — no ULID, no Snowflake, no v7 UUID.** A sortable identifier leaks minting order into every comparison that touches it, and the first place it would be used is exactly where it must not be: a merge. *"The older LCID survives"* is a rule that looks reasonable, needs no evidence, and is wrong — §6.3 rejects it explicitly, and an identifier whose bytes advertise age makes that wrong rule the path of least resistance for every future engineer. **An identifier should not answer a question the design forbids asking.** The cost is that inserts are random rather than sequential; the mitigation is that `lcid_registry` is small relative to `edition` and is read far more than written.

**The payload width, and why no probability is quoted.** Sixteen Crockford base32 characters is 80 bits from a CSPRNG. The derivation is stated rather than measured: it is wider than the 64-bit space where accidental collision is a design consideration and narrower than a 128-bit UUID whose extra sixteen characters buy nothing an operator or a log line notices. **This record does not quote a collision probability, and the refusal is the point** (018 §2 A3, as 042 A3 sharpened it): the registry's primary key means a collision is a **failed INSERT that retries**, which is an engineering fact this design can rely on, where a probability would be a manufactured one that nobody has measured on this system's actual volumes. The mint helper retries on unique violation and gives up after a bounded number of attempts, and that bound is a **provisional circuit-breaker floor**, explicitly non-evidentiary, in the sense 042 A3 established.

**Where that retry runs, and what it locks (A5).** The retry is **not** a bespoke loop. It runs inside the same `withTransaction` helper and the same retry-classification codes 041 §4.5 established and 042 A6 fixed, under the same lock-order discipline — so a mint inherits the estate's serialization-failure handling rather than inventing a second one, and a retried mint is a retried *transaction*, not a re-INSERT inside a transaction that has already failed. **What it locks is nothing: `lcid_registry` has no `shop_id` and therefore no shop anchor** (030 §2.1 gives definitions and editions no tenancy, and §4.2's row inherits that), so the single INSERT takes **no anchor lock** and adds no edge to the lock graph. A mint that occurs inside a request that *does* hold an anchor lock — the human-authoring path of §4.4 — takes that lock in the order the request already established and never acquires a second; the mint is a participant in the caller's transaction, never the owner of one. **E04-B04 acceptance line:** the mint helper's retry is expressed through `withTransaction` with 042 A6's retry codes, and the helper's own test asserts that it acquires no lock of its own and holds no lock across a retry boundary.

**The check character** is Crockford's mod-37 check symbol. It exists for one reason: §8's world contains hand-typed and OCR'd identifiers, and 036 §4.3's copy code is a check-digited string on a sticker for exactly this reason. Whether an LCID ever reaches a human at all is §13 Q9 — if the answer is never, the check character is a free byte, and if the answer is *in a CSV export or a support conversation*, it is the difference between a wrong lookup and a refused one.

### 3.3 Per-vertical prefixes, and who assigns them

The `<vertical>` segment is the three-character code of a **registered** vertical pack, and it is assigned in the `vertical_pack` row (030 §5.2), not invented per LCID and not hard-coded in the mint helper. `cmc` for comics; a second vertical takes its code at pack registration. 030 §6 rule 3 already forbids accepting an unregistered `vertical` anywhere (`030:377`), and this record adds that **minting is one of the places that must fail closed**: an LCID cannot be minted in a vertical with no `vertical_pack` row, so the namespace cannot acquire a segment the system cannot resolve.

## 4. Decision C — Minting: the registry insert **is** the mint

### 4.1 The rule

> **An LCID comes into existence by inserting one row into `lcid_registry`, inside the transaction that writes the first catalog row citing it. The table is insert-only: no UPDATE, no DELETE, no supersession, no reuse, ever. Only `catalog` mints, through one helper. A mint is never speculative.**

### 4.2 The row

```
lcid_registry(
  lcid                        text PRIMARY KEY,
  kind                        text NOT NULL CHECK (kind IN ('definition','edition')),
  vertical                    text NOT NULL REFERENCES vertical_pack(vertical),
  minted_in_corpus_version_id uuid NOT NULL REFERENCES corpus_version(id),
  minted_by                   text NOT NULL,   -- 'import' | 'human_review' | ...
  issued_at                   timestamptz NOT NULL DEFAULT now(),
  CHECK (lcid = 'lb.' || substr(kind,1,1) || '.' || vertical || '.' || substr(lcid, 10))
)
```

The final CHECK is §3.2's enforced redundancy: the string cannot disagree with the row. `minted_by` is 041 §2.3's `authored_by` idea at the registry — *cause and authorship are different facts* — restricted to the two ways an LCID can legitimately come to exist (§4.4).

**`lcid_registry` is insert-only, not append-only-with-supersession, and the difference is not pedantry.** Every other immutable table in this system supports correction by supersession (041 §3.1) because every other table has **content** that can be wrong. A registry row has no content: it asserts that a name has been issued. There is nothing to correct, so there is no `supersedes_id`, and the lifecycle facts of §5 live in their own tables rather than as versions of this one. 030 §7 already calls the table *"insert-only"* (`030:144`) and distinguishes `vertical_pack`'s insert-only registration from strict append-only immutability (`030:383`); this is the same distinction, stated as a decision.

### 4.3 Never reused, and what that costs

> **An LCID string, once inserted, is never inserted again, never re-pointed, and never freed — not after a merge, not after a split, not after a retirement, not after a lawful purge (041 §8.4 removes bytes and referenced values, never rows).**

The whole value of 030 §2.5's *"point at the LCID, never at the row"* rule is that a reference survives every catalog event. A reused LCID makes every historical reference in the system silently mean something new, and under append-only rules there is **no repair**: the referencing rows cannot be updated (`migrations/001_init.sql:175`, `:179`) and nothing records that the meaning moved. This is the single invariant in the record that has no acceptable exception (I1).

The cost is that the registry only grows, and a mistaken mint is permanent. §5.4's retirement fact is what makes that survivable: a mistaken LCID stays in the table, is marked as naming nothing, and the mistake is readable rather than erased.

### 4.4 A mint is never speculative

> **The registry INSERT and the first catalog row citing it are one transaction (041 §4). There is no free-standing mint, no pre-allocated block, no "reserve an id and fill it in later."**

Two ways to mint, and only two:

- **A corpus import** asserts an edition exists — `minted_by='import'`, in the bulk transaction that writes the `edition` row.
- **A human catalog author** asserts an edition exists that the corpus does not have — `minted_by='human_review'`, in the request transaction that writes the row.

**There is no third way, and in particular a resolution proposal does not mint** (§5.2).

**What the citing row is for a batched import (A12, the Q7 ruling).** v1.0.0 raised the operational objection and left it open: a full GCD dump is hundreds of thousands of rows, and *"one transaction"* per §4.1 must not be read as *one transaction for the whole import*. **The answer is that a batched import's citing row is the import-batch fact itself.** One fact per batch — E04-B11's batch record, naming its `data_source_id`, its corpus version and its cursor position — and the mints are atomic **with that fact**, not with any single edition row. So §4.1's rule reads unchanged and is satisfiable by an importer: the mint and the fact that cites it commit or roll back together, at the batch granularity E04-B11 chooses. A batch that rolls back un-mints its own LCIDs and re-mints on retry, which is correct precisely because nothing outside the batch could have referenced them yet. **I5 is stated in those terms** rather than in terms of a per-edition row, which is the form a batched importer can actually satisfy.

**The mint path is deliberately AP on an `edition_signature` collision, and the record says so rather than leaving it to be inferred (A1, REQUIRED).** Two importers — or an importer and a human author — may concurrently mint for what turns out to be the **same signature**. That is not an error to be prevented; it is **two valid LCIDs**, and reconciling them is a **later, human-arbitrated fact** under §6, exactly as 030 §3.3 already ruled: *"Two rows with the same signature are a dedupe candidate… never an automatic merge"* (`030:211`).

> **Do not add a UNIQUE on `edition_signature` — 030 §3.3.** The mint path chooses availability over a cross-transaction identity check, and the merge is the repair. A UNIQUE constraint on the signature would convert a dedupe candidate into a write failure, push the arbitration into whichever writer lost the race, and reintroduce the split-brain §6.3 spent three rejected alternatives explaining how to avoid.

The two unique violations a mint can meet are therefore **different events with different handling**, and §11's new **I17** separates them: a violation on `lcid_registry(lcid)` is a payload collision and **retries** (§3.2); a duplicate *signature* **never raises one at all**, because no constraint exists to raise it. The test is two concurrent mints of one signature, both of which **commit**.

## 5. Decision D — The lifecycle is appended facts, and there is no PROPOSED state

### 5.1 The rule

> **`lcid_registry` has no status column. The lifecycle of an LCID is a derivation over facts recorded in separate append-only tables — merges, splits and retirements — exactly as 040 replaced `scan_session.status` with a derivation over transitions. A reader asks the question; nothing stores the answer.**

040 A8 retired a status column from the session and 042 I5/§3.3 generalised the leak it caused. Reintroducing one here would repeat the mistake on the one table where it is least recoverable: a status column on an insert-only table is a column that can never be set, and a status column on an append-only-with-supersession table would make an LCID's state a thing two rows can disagree about.

The derived states, and the fact each is a function of:

| Derived state | True when | Fact |
|---|---|---|
| `MINTED` | the registry row exists | `lcid_registry` |
| `IN_USE` | at least one catalog row cites it | `collectible_definition` / `edition` |
| `MERGED_AWAY` | a merge names it as the losing side | `lcid_merge` |
| `SPLIT_SOURCE` | a split names it as the source | `lcid_split` |
| `RETIRED` | a retirement names it | `lcid_retirement` |

`MERGED_AWAY`, `SPLIT_SOURCE` and `RETIRED` are mutually exclusive by construction: each of the three tables carries a UNIQUE on the LCID it disposes of, and a CHECK-backed guard refuses a second disposition of an LCID that already has one (I8).

### 5.2 There is no PROPOSED LCID, and this is the record's sharpest exclusion

The bead's framing invites a `proposed → confirmed` transition. **It is refused, and the refusal is a decision, not an omission.**

> **An LCID is minted only for a catalog row that an import or a human author asserts exists. A resolution proposal — a barcode parse, a vision candidate, a similarity hit, a crosswalk edge under review — never mints one.**

A proposal already has three places to live, all of them shipped or ratified:

1. `candidate_set.candidates` — the jsonb array the barcode and vision rungs write today (E9), corpus-pinned and honest about being a proposal.
2. `edition_external_id` — 030 §4's crosswalk edge, which carries `match_method`, `confidence`, `contradiction`, `reviewer` and `supersedes_id` precisely so a proposed mapping can be recorded, argued about and superseded (`030:218-224`).
3. E04-B06's review queue, whose acceptance criterion is *"exact/rule/similarity/human states and review queue"* (`014:417`).

Minting for a proposal would put a machine's guess into the platform's permanent, never-reused namespace, and would make *"is this a real edition or something a model thought it saw"* a question that requires joining to a lifecycle table rather than a question the namespace answers by construction. It would also collide directly with §4.3: a rejected proposal's LCID could never be freed, so a run of a similarity index over a shop's back stock would permanently enlarge the catalog's namespace with rows naming nothing. **The alternative is answered fully in §10 A3**, because a careful reader will reach for it: the review queue genuinely does want a stable handle for a pending mapping — and that handle is the crosswalk edge's own id, which is shop-neutral, supersedable and disposable, and which an LCID is not.

### 5.3 Every lifecycle fact carries the same five things

Each of `lcid_merge`, `lcid_split` and `lcid_retirement` carries `corpus_version_id` (as of what catalog state), `method` (how it was decided), `evidence` (what was relied on), `decided_by` (who), and `created_at`. This is 041 §2's envelope applied to a catalog fact — `authored_by`, `definition_version`, `recorded_at` — with `decided_by` in `authored_by`'s role and `corpus_version_id` in `definition_version`'s, as 041 §2.4 explicitly permits when a typed FK to a real version table already exists (`041:86-94`: *"`candidate_set.corpus_version_id` is **not renamed**… strictly better than a text version string"*).

All three tables get the `forbid_mutation()` trigger at `ENABLE ALWAYS` and a row in `src/db/appendOnlyTables.ts` — 041 §9.2 item 4's declared list, whose two-way equality test is what E2's fixture string exists to prove.

### 5.4 Retirement

`lcid_retirement(lcid, corpus_version_id, reason, method, evidence, decided_by, created_at)`, `UNIQUE (lcid)`.

A retirement says: **this LCID names nothing.** It is what happens to a phantom edition — a bad import row, a duplicate created by a normalization bug, an entry a later corpus withdraws. It is **not** a merge (there is no survivor) and **not** a deletion (the row stays, the string stays resolvable, and every reference to it stays readable).

The consequence for citing rows is stated rather than hidden: **a retirement does not repair the rows that cite the retired LCID.** They cite a name that names nothing, which is a true statement about a past act, and 041 §3.6's *never edits, never hides* forbids improving it. What the retirement does is (i) refuse any new citation (I5's mint-time and write-time guard), and (ii) put every citing row into the same review obligation a split creates (§7.3). A shop holding a copy against a retired edition is a real operational problem, and it is E11-B08's queue — *"Reviewer can compare evidence, certify/reject/supersede mapping"* (`014:556`) — not a repair this record can perform by writing SQL.

## 6. Decision E — Merges

### 6.1 The rule

> **A merge is one appended fact naming a losing LCID and a surviving LCID. It deletes nothing, rewrites nothing, and repoints no reference. The losing LCID stays in the registry and stays resolvable forever. Resolution follows the chain; the trail does not.**

```
lcid_merge(
  id uuid PK,
  losing_lcid    text NOT NULL REFERENCES lcid_registry(lcid),
  surviving_lcid text NOT NULL REFERENCES lcid_registry(lcid),
  corpus_version_id uuid NOT NULL REFERENCES corpus_version(id),
  method text NOT NULL, evidence jsonb NOT NULL,
  decided_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (losing_lcid),
  CHECK (losing_lcid <> surviving_lcid)
)
```

`UNIQUE (losing_lcid)` is the merge's version of 041 R2 (*a row is superseded at most once*, `041:193`): an LCID is merged away exactly once, so the merge graph is a **forest of pointers to a surviving root**, never a tangle. A later merge that moves the survivor adds a row for the *survivor*, and the chain from the original follows through it. Cycles are prevented the way 041 R3/R4 prevent them (`041:194-195`): the self-merge CHECK above, plus a `BEFORE INSERT` trigger asserting the proposed survivor is not itself reachable from the loser, plus a bounded walk (I8).

**Where the bounded walk raises, and where it must not (A10).** Hickey and Kleppmann disagreed on I8 as drafted, and the resolution is that the two sides were talking about two different call sites:

> **The bounded walk RAISES and REFUSES at mint and merge WRITE time. At READ time, `resolve` never throws past its caller — it returns an outcome value.**

At write time a chain that exceeds the bound, or a survivor reachable from the loser, is a **defect in the fact being proposed**, and refusing the INSERT is the only handling that keeps the forest a forest. At read time the same condition is a **property of data that already committed**, and a resolver that throws turns a catalog anomaly into a 500 on a pricing lookup. So a read that meets an over-long or anomalous chain returns an outcome — AMBIGUOUS, or the error outcome of §10.2's total function — exactly as §7.2's split handling does, and the caller fails closed to the manual path (042 §8.3) rather than crashing. Chain depth is **monitored, not enforced, on the read path**: a depth over N pages an operator; it does not raise.

### 6.2 The two reads, and why one function is not enough

> **`resolve(lcid)` follows merges and returns the surviving LCID. `asStated(lcid)` returns the LCID the row actually cites and follows nothing. A trail read never resolves.**

This is the load-bearing distinction of the whole section, and it is 041 §3.6's *never hides* rule applied to identity. A pricing lookup, a listing render, a duplicate check (019 T18) and an inventory count all want `resolve` — they are asking *what is this book*, and after a merge the answer is the survivor. A session trail, an audit, a supersession chain, an eval replay and a `GET …/:id` events payload all want `asStated` — they are asking *what did this row say*, and answering with the survivor would silently restate what a person confirmed. 042 I5 already forbids a response body carrying an undeclared key; this is the same discipline about an *undeclared substitution*, and I9 asserts it.

**How `resolve` is actually computed, and why it is not a recursive CTE on the hot path (A2).** Hickey's §5.1 objection and Kleppmann's performance objection converge on the same construction, and it is one 041 §6.2 already ratified for aggregates:

> **`resolve` reads a materialized projection, `lcid_current_survivor(lcid, survivor_lcid, definition_version)`, which is rebuildable from `lcid_merge` in one pass and is maintained incrementally INSIDE the merge's own transaction.**

The projection is a **derived read model, not a status column**, and the difference is the whole of Hickey's dissent: a status column is a second place a fact can live and disagree from; a projection that is (i) written only by the transaction that appends the merge fact, and (ii) reproducible from `lcid_merge` alone by a checked-in rebuild, cannot disagree with the log for longer than a transaction, and any disagreement is a **test failure, not a data state**. That is why the maintenance is transactional rather than a trigger-on-commit, a queue, or a nightly job: an eventually-consistent survivor map is exactly the "status column with extra steps and worse audit properties" Hickey named.

Three obligations follow, and they are acceptance lines rather than aspirations:

1. **A checked-in benchmark fixture** — a merge forest of declared shape and depth, committed with the code, against which the rebuild and the hot-path read are measured. The numbers are set from the first measured run on named hardware (030 A7's discipline), never guessed.
2. **A CI plan-shape gate** — the hot-path `resolve` query's plan must be **index-only** on the projection; a plan that degrades to a sequential scan or a recursive CTE fails the build. A performance property nothing checks is a performance property that has already regressed.
3. **On E06-B02** (`014:453`), whose exact-lookup path caches resolutions: **any cache of `resolve()` is keyed by `corpus_version` AND invalidated transactionally by INSERTs into `lcid_merge`, `lcid_split` and `lcid_retirement` — never by TTL.** A TTL cache re-creates the stale-survivor hazard one layer up, where no test in this record can see it, and a TTL is a guess about how long being wrong is acceptable.

Chain depth stays monitored on the read path per §6.1's A10 rule: the projection makes the common read one hop, and a deep chain is an operational signal, not a raise.

### 6.3 Which side survives

Three rules were available.

**(a) The older LCID survives.** *Rejected*, and §3.2 already removed the bytes that would make it easy. It is a rule that needs no evidence and produces no reason: nothing about being minted first makes an identifier the better name, and in the common case — a fortnightly corpus import creating a near-duplicate of a row a human authored last week — it is systematically backwards.

**(b) The LCID with more references survives.** *Rejected, and it is the one that would do real damage.* References are overwhelmingly `physical_item` rows, which are shop-scoped (`030:125`). So the shop with the most copies would decide the catalog's canonical names — one tenant's inventory volume mutating a table that deliberately carries no `shop_id`. That is a tenancy leak in a table with no tenancy, and 019 T24 signs cross-tenant influence at zero and marks it non-waivable.

**(c) The survivor is named in the fact, by whoever decided the merge.** **Adopted.** The merge row records `surviving_lcid`, `method`, `evidence` and `decided_by`, so the choice is a decision somebody made and can be read back, argued with and superseded by a further merge. Where the decision is mechanical — an importer applying a documented rule, e.g. *the LCID whose edition row the current corpus still contains* — `method` names the rule and `decided_by` names the importer, which is 041 §2.3's *cause and authorship are different facts* doing its job.

**Auto-merge is bounded by locked decision 7's shape.** 030 §3.3 already ruled that *"Two rows with the same signature are a dedupe candidate… never an automatic merge"* (`030:211`), and 014 §4.3's *"Similarity/LLM may propose a mapping but cannot silently certify it"* says the same for the crosswalk. **Decision: a merge whose `method` is a deterministic exact-identifier agreement may be automatic; every other method requires a human `decided_by`.** A signature collision proposes; a shared exact identifier under a single registrar namespace (§8.2) may certify; a model never certifies.

### 6.4 What a merge does not do

It does not `UPDATE physical_item.edition_lcid`. It does not rewrite `identity_resolution`. It does not touch `human_confirmation`. It does not delete the losing edition rows. **Every one of those would be an edit to an immutable row, refused by the trigger at `migrations/001_init.sql:179`** — and 030 §2.5 chose the LCID-not-row-id rule specifically so that none of them is necessary (`030:138`: *"the resolution *through* that LCID now lands on the corrected row"*). This is the section where that choice pays for itself, and I6 asserts it by byte-comparing every pre-merge row after a merge.

## 7. Decision F — Splits

### 7.1 The problem is not the mirror image of a merge

A merge asserts that two names were always one thing, so no past reference loses information: whichever name a row cited, it meant the same book. **A split asserts that one name was always two things, and every past reference to it is therefore ambiguous** — not wrong, ambiguous, and ambiguous in a way no later evidence can always resolve. The asymmetry is the whole design.

```
lcid_split( id uuid PK, source_lcid text NOT NULL REFERENCES lcid_registry(lcid),
            corpus_version_id uuid NOT NULL, method, evidence jsonb, decided_by, created_at,
            UNIQUE (source_lcid) )

lcid_split_outcome( split_id uuid NOT NULL REFERENCES lcid_split(id),
                    product_lcid text NOT NULL REFERENCES lcid_registry(lcid),
                    is_continuation boolean NOT NULL DEFAULT false,
                    PRIMARY KEY (split_id, product_lcid) )
```

### 7.2 The decision: ambiguity is the default; continuation must be earned

Two constructions.

**(a) The source LCID continues as one of the products, and one new LCID is minted for the other.** This is the cheap answer and it is what most catalogs do. **Rejected as a default**, because it silently asserts that every pre-split reference meant the continuation. That assertion is usually false and always unrecorded: the copies a shop listed against the conflated LCID were, by hypothesis, *some of each*.

**(b) The source is disposed of by the split; all products are freshly minted; `resolve(source)` returns AMBIGUOUS rather than a value; every citing row acquires a review obligation.** **Adopted as the default.**

`resolve` returning AMBIGUOUS is not an error condition to be swallowed. It is the same shape as locked decision 7's contradiction gate and 033's identity rule: **ambiguity forces a human and no guess is substituted.** A caller that cannot handle AMBIGUOUS fails closed to the manual path (042 §8.3's construction), never to a guess.

**(a) remains available, and must be earned.** A split may mark exactly one outcome `is_continuation = true`, and doing so is a claim with a burden: the `evidence` must support that every existing reference belongs to the continuation. The clean case is real and common — a later corpus discovers a variant that *was never in the shop's stock*, so the second product has, by construction, zero pre-split references. **The rule is therefore checkable, not merely declared**: a split may not mark a continuation while any row citing the source LCID is unresolvable to it, and I10 asserts it.

### 7.3 The review obligation

A split — like a retirement (§5.4) — creates work, and this record refuses to hide it in a nullable column or a silent default. Every row citing the source LCID enters E11-B08's catalog conflict queue (`014:556`). The obligation is derived, not stored: the queue is a query over rows citing an LCID with a split or retirement fact and no subsequent human resolution. **No column is added to any citing table** — that would be a mutable status on an immutable row, which is the shape 030 A1 and `migrations/004:43-48` both rejected.

## 8. Decision G — External identifiers are classified alias namespaces, and never identity

### 8.1 The rule

> **Every external identifier is an `edition_external_id` row (030 §4) — an alias under a rights row, never a key, never a primary key, never a foreign-key target. This record adds no second alias table. What it adds is a classification of namespaces, because they are not equally trustworthy and the crosswalk cannot treat them as if they were.**

030 §4's four rules are adopted verbatim and not re-argued: `(provider, external_id)` is not unique and is not a key; no core table has a column named after a provider; a provider disappearing removes no core identity; nothing imports without a `data_source_id` (019 T25, non-waivable).

### 8.2 The four classes

| Class | Namespaces | What the class means for auto-certification |
|---|---|---|
| **Registrar-issued** | `upc`, `ean`, `isbn` | Issued by a standards body to a publisher; nobody's product. **The only class in which an exact agreement may auto-certify a merge (§6.3).** Still not identity: a UPC is reused across printings, which is exactly why the 5-digit supplement exists (E8), and publishers mis-print. |
| **Community catalog** | `gcd`, `metron`, `comicvine` | High-quality metadata under licences that differ from each other and from commercial use. **Proposes; never certifies.** 011's research is the authority: GCD distributes **metadata only, no cover images**, under **CC BY-SA 4.0** with an account required (`011:140`); Metron serves cover URLs but *"the cover art itself is still publisher copyright"* (`011:140`). |
| **Commercial provider** | `pricecharting`, `ebay_epid`, `gocollect`, `covrprice` | A vendor's internal identifier, offered under terms. **Proposes; never certifies.** An id in this class may vanish, be re-issued or become unusable when terms change — which is precisely what 030 §4 rule 3 and I15 are tested against. |
| **Copy-level certification** | `psa_cert`, `cgc_cert`, `cbcs_cert` | **NOT an edition alias at all.** See §8.4. |

### 8.3 The `covrprice` namespace specifically

`covrprice` is an alias namespace in the **commercial provider** class and nothing more. A commercial provider's identifiers are aliases and never a source of truth for Longbox's identity. **This record asserts nothing about that provider's API, endpoints, data quality, coverage or plans**, and 014 §8 row E04-B09's non-goal binds anything that would: *"No production dependency before written API terms"* (`014:420`). The design consequence is one line: because a `covrprice` id is an alias, deleting every `covrprice` edge leaves every LCID, signature, resolution and copy intact — which is 030 I2, restated at the LCID level as I15.

### 8.4 A grader cert is a copy fact, and putting it in the crosswalk is the error this rule prevents

A PSA or CGC certification number identifies **one slabbed copy**. It does not identify an edition, and it is not an alias of one: two slabs of the same book carry two cert numbers, and one cert number names one physical object.

**Decision: cert namespaces may not appear in `edition_external_id.provider`.** They belong to the copy — 036 §2's `physical_item` and its appended state facts, plus 037's condition record — and E02-B05 and E08-B06 own them (`014:497`: *"mismatch/unsupported cases cannot inherit claimed grade"*). I13 asserts the exclusion as a data rule over the crosswalk, because the failure it prevents is quiet: a cert-number edge would make one shop's slab a property of the shared catalog, and then §2.3's three consequences follow one after another. **Per A6 this is not a comic rule**: `grader` and `cert_number` are copy facts in **every** vertical, and 030 v1.2.0's amend-by-a-row removes them from the card signature §5.4 sketched.

**A certification write is a catalog-authoring act, never a shop-workflow act (A4).** The rule above says *where* a cert may not go. This one says *who* may write anything to `edition_external_id` at all, and it exists because I13 alone can be satisfied by a system that is still leaking tenancy:

> **Every write to `edition_external_id` is an act of catalog authoring. Its `decided_by` / reviewer role must be structurally distinct from any shop-scoped session role — a shop's operator identity is never a valid author of a crosswalk edge, and a request carrying a shop context is never the transaction that writes one.**

The hazard is that the crosswalk is a **non-tenant-scoped table written during work that always has a tenant in scope**. A shop employee resolving a book, or an owner correcting a mapping, sits inside a shop-scoped request; if that request's identity can author an edge, one tenant's operational choice mutates a table that deliberately carries no `shop_id` — §6.3(b)'s rejected merge rule arriving through a different door. **019 T24 signs cross-tenant influence at zero and is non-waivable**, but T24's tenant-data detector cannot see this: no shop's *data* crosses to another shop, so nothing the detector inspects is wrong. What crosses is **authority**. **This is therefore a T24-adjacent invariant that T24's own detector will not catch, and E04-B06 must state and build its own detector** — an acceptance line on that bead: the crosswalk write path names the role that may author an edge, refuses a shop-scoped session role, and ships a failing fixture in which a shop-context request attempts an edge and is refused. §12.3 records the handoff.

## 9. Decision H — Resolution is two facts, and the signature is not `identityKey`

### 9.1 Two facts, never one

> **`human_confirmation` records the edition the person picked. `identity_resolution` records what the catalog said that was, as of a corpus version. They are two rows, written by two acts, and neither is derivable from the other.**

030 §7.1 is adopted unchanged, including its `UNIQUE (human_confirmation_id, corpus_version_id)`, its `shop_id`, its append-only trigger and the rule that the table ships empty (`030:394-416`). What this record adds is the naming of *why* it is two facts and not one, because the temptation to collapse them is permanent:

- The confirmation is a **person's act**, made against what was on a screen at a moment, and it is immutable and complete on its own (E4). It is not improved by a catalog it did not consult.
- The resolution is **the catalog's statement about that act**, made later, by a named method, at a named corpus version, and revisable by a later corpus making a different one.

Collapsing them — a nullable `confirmed_edition_lcid` on `human_confirmation` — is exactly what 030 A1 rejected and `migrations/004_human_confirmation_outcome.sql:43-48` records the reasoning for (E3). The NULL would carry two meanings the reader cannot separate, and the row cannot be updated to repair it. **I11 asserts that no such column exists anywhere**, as a static scan, because the cheapest way to break this design is for a well-meaning future migration to add one.

### 9.2 The resolution stores what it resolved to, and readers resolve forward

An `identity_resolution` row records the `edition_lcid` **as stated at the moment of resolution**. If that LCID is later merged away, the row is not rewritten (§6.4). A reader asking *what edition is this copy* calls `resolve`; a reader asking *what did the catalog say in March* calls `asStated` with the March corpus version (§10.2). One stored fact, two reads.

**Resolution is deterministic given the corpus version.** Same confirmation payload, same corpus version, same pack version → same `edition_lcid` and same `method`, every time. That is what makes an eval replayable (041 §2.6's *replayable*) and what makes a disagreement between two runs a finding rather than noise. I12 asserts it by re-running.

### 9.3 `edition_signature` and `identityKey` are two functions, and merging them would move a measurement rule

The bead's directives describe `edition_signature` as *"normalized title+issue+variant+publisher+year"* and cite `confirmationOutcome.ts` as the seed. **The seed is right; the field list is not, and the correction is load-bearing.**

| | `identityKey` (shipped) | `edition_signature` (designed) |
|---|---|---|
| Fields | `title`, `issue`, `variant` (`confirmationOutcome.ts:56-68`) | `series`, `issue`, `variant`, `printing` (`030:197`) |
| Scope | two payloads **within one session** | the **whole corpus** |
| Job | decide `outcome ∈ {confirm, correct}` for 019 T3 and T20 | catalog dedupe and the Q2/Q3 lookup path (`030:172-173`) |
| Owner | `workflow`; already shipped and tested | `catalog`, per pack, versioned single-rate with the pack (`030:341`) |
| Versioning | none — a change is a change to a 019 measurement | `vertical_pack_version` (030 §5.2) |

**Publisher and year are excluded from `identityKey` on purpose**, with the reason written at `confirmationOutcome.ts:44-49` (E7): including them *"would score a plain acceptance as a correction and inflate T3."* Adding them would change what T3 counts, and `019:57` makes T1's exclusion rule *"non-editable without a 006 row"* — so this is not a refactor a builder may perform, in either direction.

**Decision: they stay two functions with two names, and E04-B02 owns the second** (`014:413`). **A8 makes that separation checkable rather than declared.** Two functions with two names drift into one the first time a builder notices they look alike, and the drift is silent because both still compile:

> **A static guard — a dependency-cruiser rule plus an assertion in `scripts/architectureRules.ts` — asserts that `identityKey` and `edition_signature` share no field-list constant, and that a PR touching both without a 006 decision-log row FAILS.**

The first half forbids the mechanical merge (one exported `FIELDS` array imported by both). The second half catches the human one: a change that edits both functions in one diff is, by construction, a change to a 019 measurement rule, and `019:57` makes that non-editable without a 006 row. **This is an E04-B02 acceptance line**, and it is the reason §9.3's ruling survives the builder who reads both functions six months from now and sees duplication. The seeding relationship is real and is recorded here so E04-B02 does not start from nothing: `identityKey`'s normalisation — trim, collapse internal whitespace, casefold, strip a leading `#` from an issue number, treat missing/empty/null as the same claim, join with a separator that cannot occur in a field (`confirmationOutcome.ts:29-42`, `:61-67`) — is **good normalisation and should be reused**. What must not be reused is its field list, because the two functions are answering different questions.

**How this makes 019 T1 measurable, which is the point of the whole record.** T1 is *"exact issue+variant top-1 accuracy… truth-label == first candidate"* (`019:57`). Today the comparison is between two jsonb blobs, so *"exact"* is a string-equality accident. Once the catalog exists, **a truth label is an `edition_lcid` and a candidate resolves to an `edition_lcid`, and T1's comparison becomes LCID equality** — which is exactly what makes *"issue+variant"* a checkable claim rather than a hopeful one, because the printing and variant digits the barcode has been decoding and discarding since v0 (E8) are inside the edition the LCID names. **019 T1 scores on `asStated` (A7, the Q5 ruling).** v1.0.0 left the choice open. The answer is that **a frozen eval scores on `asStated` — `resolve(lcid, asOf = the eval set's own corpus_version)` — so a later merge never changes a frozen eval's score; production reads resolve current.** A measurement whose value moves because the catalog was corrected afterwards is not a measurement of the model; it is a measurement of the catalog's later opinion, and two runs of the same frozen set would disagree for a reason nobody in the run caused. The cost is real and accepted: a model marked wrong for a distinction the catalog itself later abolished stays marked wrong in that run, and the right repair is a **new eval set at the new corpus version**, not a rescoring of the old one. **This is an E07-B01 obligation, and it must be stated before the eval set is frozen** — freezing after this is stated is the whole point of answering it now.

## 10. Decision I — The corpus relation: minted once, resolvable as-of

### 10.1 An LCID is minted in a corpus version and lives forever

030 §2.2 already fixed the halves of this (`030:100`): a corpus advance produces a **new row for the same LCID**, and the old row is not superseded because it remains the truth as of its corpus version. This record adds the registry's side:

> **`lcid_registry.minted_in_corpus_version_id` records where a name entered the world. A later corpus may add rows, aliases, merges, splits and retirements against that LCID. No corpus can un-mint it, and no corpus advance mints a second LCID for an edition that already has one.**

The second clause is the operational one and it is where a fortnightly GCD refresh would otherwise destroy the catalog: an importer that mints on every import produces a new LCID for every book every fortnight. **The import path must resolve before it mints** — signature lookup, then registrar-issued identifier lookup, then mint — and I5 plus I16 are what keep that path in one place.

### 10.2 A merge is a dated assertion, so `resolve` takes an as-of

Every lifecycle fact carries `corpus_version_id` (§5.3). A merge decided against corpus N is **not visible** from a read as of corpus N−1. This falls straight out of 030 §13 answer 3 (`030:514`): a definition is *"a function of `(lcid, corpus_version)`"*, and the rule *"correctly refuses to manufacture a fake present-tense answer"*.

**Simple versus easy, and the decision.** The *easy* construction is one global merge map: `resolve` takes an LCID, returns a survivor, done. The *simple* construction is that a merge is a dated fact like every other fact in this system, and reading identity as of a past corpus sees the catalog as it then was. The easy one is wrong in exactly one place, and it is the place that matters: **eval replay and audit**, where the whole point is to see what the system knew at the time.

**The as-of is MANDATORY at the module boundary (A11, the Q3 ruling).** v1.0.0 made the parameter optional with a current-corpus default, on ergonomics. The cannon overruled it, and the reason is the one Kleppmann and Lamport both landed on: an optional parameter with a silent default lets a caller be **accidentally correct in dev and silently wrong in an eval-replay context months later**, which is precisely the failure this record spent §6.2 building two named reads to prevent.

> **`resolve(lcid, asOfCorpusVersion)` — one function, and `asOf` is REQUIRED at the `catalog` module's boundary. The current-corpus convenience exists only as a thin `resolveCurrent(lcid)` wrapper, used at named call sites — pricing, listing render, duplicate detection — and nowhere else. There is no second resolver and no second mechanism: `resolveCurrent` reads the current corpus version and calls `resolve`.**

The wrapper is what keeps 042 §2.5's one-declared-shape argument intact: there is still one resolution, one plan-shape gate and one set of outcomes. What changes is that **asking for the present tense is now an explicit act with a name**, so a call site that wanted a replay and got a default is a grep away rather than a silent divergence. The named-call-site rule is enforceable the way I16 is — an architecture-rule assertion listing the files permitted to import `resolveCurrent`.

**`resolve` is TOTAL, over five outcomes (A3, REQUIRED).** A resolver that returns a value on the happy path and *something else* on the rest is a resolver whose callers handle the rest by accident. So the function's return is a closed sum, and every caller matches on it exhaustively:

| Outcome | When |
|---|---|
| **the current value** | the LCID is live as of `asOf` and no disposition applies |
| **MERGED(survivor)** | a merge dated at or before `asOf` names it as the losing side; the survivor is carried in the outcome |
| **RETIRED** | a retirement dated at or before `asOf` names it (§5.4) — it names nothing, and that is an answer |
| **SPLIT-AMBIGUOUS** | a split dated at or before `asOf` names it as the source with no earned continuation (§7.2) |
| **NOT_YET_MINTED** | `asOf` precedes `minted_in_corpus_version_id` — the name did not exist in the world being read |

`NOT_YET_MINTED` is the outcome v1.0.0 had no word for, and it is the one an eval replay meets first: reading a two-year-old candidate set against its own corpus version will encounter LCIDs minted since. Returning "not found" for it would conflate *a name that did not exist yet* with *a name that never existed*, which is the two-meanings-of-NULL hazard 030 A1 rejected, arriving in a return value instead of a column. **I12's determinism test covers all five outcomes**, not just the happy path.

## 11. Acceptance criteria and invariants

The bead's acceptance criterion is *"Canonical IDs survive provider loss and catalog correction; ADR approved with worked merge/split examples"* (`014:412`). **I15 is the provider-loss half, I6/I7/I10 are the catalog-correction half, and §6/§7 are the worked examples.**

**None of these tests exists.** None is blocked on missing machinery (§0, E13); every one is blocked on the tables of 030 §7, which E02-B07 and E02-B10 build.

| # | Invariant | Test file |
|---|---|---|
| **I1** | **An LCID is never reused and never removed.** `lcid_registry` refuses UPDATE and DELETE; a second INSERT of an existing `lcid` violates the primary key; no purge path (041 §8.4) removes a registry row. | `tests/integration/lcid-registry-insert-only.test.ts` |
| **I2** *(030 I3, inherited acceptance line)* | **Every `*_lcid` column carries a real FOREIGN KEY to `lcid_registry(lcid)`.** Constraint-existence test: enumerate every column matching `%_lcid` across every table in `information_schema`, assert each has an FK whose referenced table is `lcid_registry`. A new `*_lcid` column added without the FK fails the build. | `tests/integration/lcid-registry-integrity.test.ts` |
| **I3** | **The string agrees with the row.** The `lcid_registry` CHECK refuses a row whose `lcid` prefix disagrees with its `kind` or `vertical`; the test attempts one of each. | `tests/integration/lcid-format.test.ts` |
| **I4** | **One parser, one constructor, one canonical form.** `parseLcid` / `mintLcidString` are the only functions that read or build an LCID string; a static scan asserts no other file in `src/` contains the `lb.` literal in a template or concatenation. Canonical form is lowercase; the check character is verified on parse; a bad check character is rejected, not repaired. | `tests/lcid-format.test.ts`; `tests/contract/single-lcid-parser.test.ts` |
| **I5** | **A mint is never speculative, and never lands on a disposed name.** Every `lcid_registry` row has at least one citing fact; a mint outside a transaction that writes one fails; a write citing an LCID with a merge, split or retirement fact is refused. **Per A12's Q7 ruling the citing fact for a batched import is the import-batch fact itself** — one fact per batch, mints atomic with it — so the test asserts batch-granular atomicity (a rolled-back batch leaves no registry row) as well as the single-row human-authoring case. | `tests/integration/lcid-mint-not-speculative.test.ts` |
| **I6** | **A merge rewrites nothing.** Seed editions, copies, confirmations and resolutions against two LCIDs; merge; assert every pre-merge row is **byte-identical**, including `physical_item.edition_lcid` and `identity_resolution.edition_lcid`. | `tests/integration/lcid-merge-preserves-references.test.ts` |
| **I7** | **A merged-away LCID stays resolvable forever.** After a merge, and after a further merge moving the survivor, `resolve(loser)` returns the current root and every FK from every citing table still resolves. | `tests/integration/lcid-merge-chain.test.ts` |
| **I8** | **An LCID is disposed of at most once, and the merge graph is acyclic.** `UNIQUE (losing_lcid)`, `UNIQUE (source_lcid)`, `UNIQUE (lcid)` on the three lifecycle tables; a second disposition of any kind is refused; a merge whose survivor is reachable from the loser is refused. **Per A10 the bound RAISES at write time and never at read time**: the test asserts the refusing INSERT *and* asserts that a read against an over-long chain returns an outcome value rather than throwing past its caller. | `tests/integration/lcid-merge-chain.test.ts` |
| **I9** | **The trail never resolves.** `GET …/:id`'s events payload, the supersession chain read and the audit read all return `asStated` values; a static scan asserts no trail read path calls `resolve`. | `tests/contract/trail-read-does-not-resolve.test.ts` |
| **I10** | **A split source resolves to AMBIGUOUS unless a continuation was earned.** After a split with no continuation, `resolve(source)` returns AMBIGUOUS and every caller in `src/` handles it explicitly; a split marking a continuation while a row citing the source cannot be resolved to it is refused. | `tests/integration/lcid-split.test.ts` |
| **I11** | **Identity resolution is a fact, not a column.** `identity_resolution` enforces `UNIQUE (human_confirmation_id, corpus_version_id)` and is append-only; a static scan asserts no column named `confirmed_edition_lcid`, `resolved_edition_lcid` or `edition_lcid` exists on `human_confirmation`, `condition_assessment` or `scan_session`. | `tests/integration/identity-resolution.test.ts` |
| **I12** | **Resolution is deterministic given the corpus version, and `resolve` is TOTAL.** The same confirmation payload against the same `(corpus_version, pack_version)` yields the same `edition_lcid` and `method` across N runs; changing only the corpus version is permitted to change the answer and the test asserts the change is recorded as a second row, not an edit. **Per A3 the determinism test covers all five outcomes** — current value, MERGED, RETIRED, SPLIT-AMBIGUOUS and NOT_YET_MINTED — each constructed and each asserted stable across runs; a sixth shape (a throw, an undefined, a bare null) fails the test. **Per A11 `asOf` is required at the boundary**: a call omitting it does not compile, and a static assertion lists the files permitted to import `resolveCurrent`. | `tests/integration/resolution-deterministic.test.ts`; `tests/contract/resolve-is-total.test.ts` |
| **I13** | **A grader cert is never an edition alias.** No `edition_external_id.provider` value is in the cert namespace set (`psa_cert`, `cgc_cert`, `cbcs_cert`, and any namespace a registered pack declares as copy-level); an insert attempting one is refused. | `tests/integration/crosswalk-no-cert-namespaces.test.ts` |
| **I14** | **No numeric grade touches the identity path** (locked decision 5; 019 T7, non-waivable; 022 P1). No column on `lcid_registry`, the three lifecycle tables, `edition_signature` or `identity_resolution` is numeric-grade-shaped; no LCID payload encodes a grade; `identity_resolution.confidence` is `text` and never a number (`030:401`). | `tests/lcid-no-numeric-grade.test.ts` |
| **I15** *(030 I2, restated at the LCID level — the bead's own acceptance criterion)* | **Canonical identity survives provider loss.** Seed two providers' edges; delete every edge for one; assert every LCID, signature, `identity_resolution` row and `physical_item` reference is byte-identical and every `resolve` returns the same answer. | `tests/integration/crosswalk-provider-loss.test.ts` |
| **I16** | **Only `catalog` mints.** A dependency-cruiser rule plus a non-graph assertion in `scripts/architectureRules.ts` (029 §5 move 8 note N2's shape): no file outside the catalog module contains an INSERT against `lcid_registry`, and no module other than `catalog` imports the mint helper. | `tests/contract/single-lcid-minter.test.ts`; `pnpm depcruise && pnpm arch` |
| **I17** *(A1, REQUIRED)* | **The mint is AP on a signature collision, and the two unique violations are different events.** A unique violation on `lcid_registry(lcid)` is a payload collision and **retries** (§3.2). A duplicate `edition_signature` **never raises one**: the test runs **two concurrent mints of the same signature and asserts BOTH commit**, producing two valid LCIDs whose reconciliation is a later `lcid_merge` fact. A schema assertion asserts **no UNIQUE index exists on `edition_signature`'s signature column** — adding one is the regression this invariant exists to catch (030 §3.3). | `tests/integration/lcid-mint-concurrent-signature.test.ts` |
| **I18** *(A2)* | **The survivor projection cannot disagree with the log, and the hot path stays index-only.** `lcid_current_survivor` rebuilt in one pass from `lcid_merge` equals the maintained projection row-for-row after a randomized sequence of merges; a merge transaction that rolls back leaves the projection unchanged; the checked-in benchmark fixture runs in CI and the hot-path `resolve` plan is asserted **index-only** — a plan degrading to a sequential scan or a recursive CTE fails the build. | `tests/integration/lcid-survivor-projection.test.ts`; `tests/contract/resolve-plan-shape.test.ts` |

## 12. Alternatives considered, consequences, and what this record does not decide

### 12.1 Alternatives

**A1 — Adopt an external identifier as the platform key** (GCD id, Metron id, a UPC). *Rejected*, and it is foreclosed by a ratified record rather than argued fresh: 030 §2.2 (`030:80`) says the LCID is *"never derived from a provider ID, a GCD number, a Metron ID, a UPC, or any hash of provider data"*, and 014 §4.3 is the blueprint rule behind it. §8 makes the failure concrete: a UPC is reused across printings and mis-printed by publishers; a community id carries a licence (011 `:140`); a commercial id is a competitor's asset (§8.3).

**A2 — Derive the LCID from a hash of the signature.** *Rejected*, and it is the subtlest wrong answer, because it looks like it gives dedupe for free. It makes identity a function of value, so the first time a normalisation rule changes — which 030 §5.2's single-rate pack version guarantees will happen — every LCID changes, and every immutable row cites a name that no longer exists. It also makes a catalog correction indistinguishable from a new edition. Hickey's identity/value separation is the whole reason `edition_signature` is a *lookup table* and not a key (`030:200`).

**A3 — Mint on proposal, confirm later** (the `proposed → confirmed` lifecycle the bead's framing invites). *Rejected*; §5.2 is the argument. It permanently enlarges a never-reused namespace with names for things that turned out not to exist, and it puts a machine's guess in the platform's identity space. The genuine need it serves — a stable handle for a pending mapping — is served by the crosswalk edge's own id, which is supersedable and disposable where an LCID is neither.

**A4 — Merge by rewriting references.** *Rejected*; impossible, and the impossibility is the design working. `UPDATE physical_item SET edition_lcid = …` is refused by `forbid_mutation()` (`migrations/001_init.sql:179`) at `ENABLE ALWAYS` since migration `006`. 030 §2.5 chose LCID-not-row-id precisely so this is never needed.

**A5 — One `lcid_lifecycle_fact` table with a `kind` column** instead of three tables. *Rejected as drafted, and the cannon affirmed the rejection (A9, the Q8 answer): the three narrow lifecycle tables stand, on the 030 A1 and 041 supersession precedent.* Merges, splits and retirements have genuinely different shapes — a merge needs a survivor FK, a split needs an outcome child table, a retirement needs neither — so one table means nullable columns whose meaning depends on `kind`, which is 030 A1's rejected shape (`030:446`) and 030 §6 rule 2. Three narrow tables each enforce their own UNIQUE and their own CHECK. The counter-argument is real: three tables mean three declared-list entries, three triggers and a three-way disposition guard.

**A6 — A sortable identifier (ULID / UUIDv7).** *Rejected*; §3.2. It leaks minting order into a design that forbids using minting order, and it makes the wrong merge rule (§6.3(a)) the easiest one to write.

**A7 — A UNIQUE constraint on `edition_signature`, so the database prevents a duplicate-signature mint.** *Rejected, and the rejection is now explicit rather than merely absent (A1).* The draft simply did not add the constraint, and Kleppmann's first finding was that **the record's own silence is the problem**: an engineer moving fast reads a signature table with no uniqueness as an oversight and adds the index, at which point two concurrent importers racing on one signature produce a write failure instead of two facts, the arbitration lands on whichever writer lost the race, and the split-brain §6.3 rejected three alternatives to avoid is back. The mint path is **deliberately AP on signature collision** (§4.4): two mints of one signature are two valid LCIDs, and the merge is the repair — which is 030 §3.3's ratified rule (*"a dedupe candidate… never an automatic merge"*, `030:211`) expressed as an absence of a constraint. **I17 asserts the absence**, so the regression fails a test rather than passing a review.

### 12.2 Consequences

**What gets better.**
- The system acquires a name for the thing it has been talking about since v0, and 019 T1's *"exact issue+variant"* becomes a checkable claim rather than a string-equality accident (§9.3).
- `printing` and `cover`, decoded by `parseComicBarcode` since v0 and discarded ever since (E8), acquire a referent.
- A shop's inventory survives a fortnightly corpus refresh, a catalog correction, a merge, a split and a provider's disappearance without one immutable row being touched (I6, I15).
- 019 T18's duplicate detection becomes expressible: *"does this shop already hold an unsold copy of this edition"* is a query on `resolve(edition_lcid)`, which is what 036 §4.3's forced human pick needs to fire on.
- A merge, a split and a retirement each become **readable decisions with a `decided_by`** rather than silent data repairs.

**What gets worse, stated plainly.**
- **The namespace only grows, and a mistaken mint is permanent** (§4.3). Retirement makes the mistake readable, not absent.
- **Two reads where one would be simpler.** `resolve` and `asStated` are a real cognitive cost on every caller, and a caller that picks the wrong one is wrong *quietly*. I9 tests the trail direction; the reverse — a production read that forgets to resolve — is caught only by the AMBIGUOUS return of a split, which is why §7.2 makes AMBIGUOUS a value callers must handle rather than an empty result.
- **A split creates operational work that this record cannot discharge** (§7.3). Every citing row enters a queue that E11-B08 has to build and a human has to work. That is honest and it is expensive, and the alternative was silently asserting a continuation.
- **The as-of parameter is a permanent tax on the resolver's callers**, even though the default hides it from production reads (§10.2).
- **Nothing here is built.** The whole of §2–§10 sits behind two beads that build 030's tables. Until then this system still stores identity as `z.unknown()` (E5).

### 12.3 What this record does not decide

- **The comic identity schema and its signature function.** E04-B02 (`014:413`). §9.3 gives it the seed and the field-list ruling and stops. **A8 acceptance line:** a static guard asserts that `identityKey` and `edition_signature` share no field-list constant and that a PR touching both without a 006 row fails.
- **The card identity schema.** E04-B03 (`014:414`), gated by E19-B06. **A6 acceptance line:** cert namespaces are excluded from `edition` and from `edition_signature` — the card pack carries neither `grader` nor `cert_number` as an edition field (030 v1.2.0).
- **The pack manifest as shipped code**, including the vertical-code assignment §3.3 leans on. E04-B04 (`014:415`). **A5 acceptance line:** the mint helper's retry runs through `withTransaction` with 042 A6's retry codes, acquires no lock of its own (the registry has no shop anchor), and holds no lock across a retry boundary.
- **The rights registry and any licence analysis**, including whether CC BY-SA 4.0 metadata may seed a commercial catalog and what attribution or share-alike obligations attach to derived rows. **E04-B05** (`014:416`), and the licence question is **routed to the counsel batch with E01-B06**, not answered here. 011 `:140`, `:154-158` and `:202` are the research input; 019 T25 is non-waivable and blocks import without a `data_source` row.
- **The crosswalk edge model, its four states and the review queue.** E04-B06 (`014:417`). §8 classifies namespaces; it does not build edges. **It carries A4's acceptance line**: a certification write to `edition_external_id` is a catalog-authoring act, its author role is structurally distinct from any shop-scoped session role, and **E04-B06 must state and build its own detector** — 019 T24's tenant-data detector cannot see this leak, because what crosses tenants is authority rather than data.
- **The corpus ingest, its delta cursor and its dedupe.** E04-B11 (`014:422`), carrying 030 A7's measured import-validation bound.
- **The exact-lookup path and its version-aware cache.** E06-B02 (`014:453`), whose cache key must include the corpus version and the pack version per §10.2. **A2 obligation:** any cache of `resolve()` is keyed by corpus version **and invalidated transactionally** by INSERTs into `lcid_merge`, `lcid_split` and `lcid_retirement` — never by TTL.
- **The eval set and its scoring.** E07-B01. **A7 obligation:** 019 T1 scores on `asStated` — `resolve(lcid, asOf = the eval set's own corpus version)` — and the obligation must be stated before the set is frozen.
- **`physical_item` and the copy code.** E02-B05 and 036, which own the cert namespaces §8.4 excludes from the crosswalk.
- **Whether pre-catalog confirmations are ever resolved, and at what bar.** 030 §12 assigns it to E06 (`030:500`) and this record does not reopen it.
- **The migrations themselves.** E02-B07 and E02-B10, per §12.4 below.
- **Any locked decision.** 4, 5, 6 and 7 outrank this record; where anything here conflicts, the locked decision wins.

### 12.4 What this record hands to other beads

**Nothing in this subsection is written, and no migration is numbered** — 041 §10's rule: *"A file number is claimed when the file is written, never reserved in prose."* The tree holds `001`–`013`; the writing bead claims the next free integer per 044.

| # | Artifact | Blocked on | Owner |
|---|---|---|---|
| 1 | `lcid_registry` with its `kind`/`vertical` CHECKs, the prefix CHECK, `minted_in_corpus_version_id` FK, insert-only posture and a declared-list row | `vertical_pack` and `corpus_version` (the latter exists, `001:54`) | **E04-D01** `longbox-e5b.4.13`, landing through E02-B07 / E02-B10 |
| 2 | 030 §7's catalog tables — `collectible_definition`, `edition`, `edition_signature`, `edition_external_id`, `data_source`, `vertical_pack`, `vertical_pack_version` — every `*_lcid` column carrying the FK from I2 | 1 | **E04-D01** `longbox-e5b.4.13`, landing through E02-B07 / E02-B10 |
| 3 | `lcid_merge`, `lcid_split`, `lcid_split_outcome`, `lcid_retirement` — append-only, `ENABLE ALWAYS`, declared in `src/db/appendOnlyTables.ts`, with the disposition guard trigger | 1 | **E04-D01** `longbox-e5b.4.13`, landing through E02-B07 / E02-B10 |
| 4 | `identity_resolution` (030 §7.1, unchanged), which 030 §7 orders after `lcid_registry` and `corpus_version` | 1 | **E04-D01** `longbox-e5b.4.13`, landing through E02-B07 / E02-B10 |
| 5 | `src/catalog/` — the mint helper, `parseLcid`, `resolve`, `asStated`, and the I16 architecture rule that confines minting to it | 1–4 | E04-B04 |
| 6 | The 029 §9 amend-by-a-row adding `lcid_registry` and the three lifecycle tables to `catalog`'s owned-tables list, alongside the entry 030 §2.6 already owes for `identity_resolution` | 1–3 | **E04-D02** `longbox-e5b.4.14` |

**What the pilot needs, and what waits.** Pilot A is 25 items of mainstream back stock (035). It needs items 1, 2, 4 and 5, plus a seed corpus, the `upc` namespace and the signature lookup. It does **not** need the split machinery, the crosswalk review queue, a second vertical, or any commercial provider namespace. **But items 3's tables land at G2 empty anyway**, for the reason `003:4-7` gives and 030 §7.1 restates: a table added later loses nothing because its facts are dated when they are made — whereas **the FK from every `*_lcid` column (I2) cannot be added retroactively**, because doing so would require touching immutable rows. So: lifecycle tables may ship empty and late; the registry and its foreign keys may not.

## 13. The nine questions, as answered by the cannon

**Lenses run 2026-09-04: `rich-hickey-reviewer` and `martin-kleppmann-reviewer`.** v1.0.0 put nine questions; all nine came back answered, and the answers that changed the design are amendments A1–A12 (§14). The answers, in order:

1. **Q1 — is *encode only what can never be corrected* the right test?** **YES, and the prefix stands (A12).** `kind` and `vertical` are immutable **values**, not correctable attributes: a definition never becomes an edition, and 030 I3/I7 already require an edition's vertical to equal its definition's. The citability argument for a typed prefix over a bare UUID survives.
2. **Q2 — is the split default correct, or unaffordable at scale?** **Stands as drafted.** No third construction was found that neither lies nor queues; the queue is the honest cost, and §7.2's earned continuation is the affordable path for the common case.
3. **Q3 — should as-of be optional or mandatory?** **Mandatory at the module boundary (A11).** An optional parameter with a silent default lets a caller be accidentally correct in dev and silently wrong in an eval replay months later. `resolveCurrent()` is the named convenience at named call sites.
4. **Q4 — is the refusal to mint for a proposal right?** **Stands as drafted.** The crosswalk edge's own id is the stable handle a pending mapping needs; it is supersedable and disposable where an LCID is neither.
5. **Q5 — does 019 T1 score on `resolve` or `asStated`?** **`asStated` (A7)** — `resolve(lcid, asOf = the eval set's own corpus version)`. A frozen eval's score never moves because the catalog was corrected afterwards; production reads resolve current. An E07-B01 obligation, stated before the freeze.
6. **Q6 — §2.3's comic ruling versus 030 §5.4's card sketch: which gives?** **Neither — it was never a pack decision (A6).** `grader` and `cert_number` are copy facts in every vertical; the same rule restated. 030 takes an amend-by-a-row to v1.2.0 removing them from the card signature, with a 006 row and an E04-B03 acceptance line.
7. **Q7 — does *mint is never speculative* survive a bulk import?** **Yes, once the citing fact is named (A12).** A batched import's citing row is **the import-batch fact itself** — one fact per batch, mints atomic with it — stated in §4.4 and in I5, which is the form a batched importer can satisfy.
8. **Q8 — are the lifecycle tables sprawl?** **No (A9).** The three narrow tables stand, on the 030 A1 and 041 supersession precedent: one table with a `kind` reproduces the nullable-column hazard those records rejected.
9. **Q9 — does an LCID ever reach a human?** **Keep the check character (A12).** It is cheap, and LCIDs do reach humans — in review queues and in support conversations — where the difference between a wrong lookup and a refused one is worth one byte.

**On the third seat.** Fowler was offered as an optional third lens on Q8 only. He was not run: A9 affirms the three-table shape on precedent already ratified in 030 and 041, and re-running the lens whose 030 dissent was a YAGNI-timing objection would have re-litigated a settled record rather than tested this one.

**The original framing of the nine questions is preserved below**, because the answers above are only readable against what was actually asked.

**Recommended lenses: `rich-hickey-reviewer` and `martin-kleppmann-reviewer`.**

Hickey is not optional here — the record's whole spine is identity versus value, place versus name, and simple versus easy, and §3, §5.2 and §9.1 are each an application of his separation. For the second seat, **Kleppmann over Fowler**, and the reason is the shape of the hard parts: at-most-once disposition, cycle prevention in a merge forest, as-of reads over dated facts, the two-reads distinction, and the ordering relationship between an immutable reference and a later correction are all consistency-and-time problems, which is Kleppmann's axis and not Fowler's. 030 already ran Hickey + Fowler over the surrounding schema, and Fowler's dissent there was a YAGNI-timing objection to the pack machinery that this record does not reopen — running him again on the same material would re-litigate a settled record rather than test this one. **Fowler is the right third seat if the acting head wants YAGNI pressure specifically on §5's four lifecycle tables (Q8), which is the one place this record is plausibly over-built.**

1. **Is §3.2's line — *an LCID may encode only what can never be corrected* — the right test, or is any structure in an identifier a mistake?** The record chose a typed prefix over a bare UUID on citability grounds (042 §2.2's argument, reused). Is `kind` + `vertical` genuinely uncorrectable, or is *"an edition never changes vertical"* a claim that will meet a counterexample?
2. **Is §7.2's split default — retire the source, resolve to AMBIGUOUS, put every citing row into review — correct, or unaffordable at nationwide scale?** The alternative silently asserts a continuation. Is there a third construction that neither lies nor floods a queue?
3. **Should `resolve` default to the current corpus with as-of as the audit form (§10.2), or should as-of be mandatory so that no caller ever gets a present-tense answer by accident?** 030 §13 answer 3 argues that requiring an as-of is *"the fact being honest about its own shape"*; this record made it optional for ergonomics.
4. **Is §5.2's refusal to mint for a proposal right?** E04-B06's review queue is the bead that will feel the constraint. Does an unresolved crosswalk edge need a stable platform-issued handle, or is the edge's own id sufficient?
5. **Should 019 T1 score on `resolve` or `asStated` (§9.3)?** Scoring on `resolve` means a later merge can retroactively turn a wrong answer right, which sounds like restating history; scoring on `asStated` means the model is marked wrong for a distinction the catalog itself later abolished. 019's measurement rules are non-editable without a 006 row, so this needs an answer before E07-B01 freezes the eval set.
6. **§2.3 rules that a grader is never part of comic edition identity, while 030 §5.4's ratified card sketch puts `grader` in the card signature (`030:367`). Which gives?** The record declined to overrule a ratified record from a bead that does not own the card pack. Is *"whether a grader participates in the signature is a pack decision, bounded by the rule that identity may not vary with a copy's attributes"* a coherent reconciliation, or is it two rules wearing one sentence?
7. **Does §4.4's *mint is never speculative* survive a bulk corpus import?** The intent is atomicity of mint-with-citing-row at whatever batch granularity E04-B11 picks, not one transaction for a whole GCD dump. Is the invariant (I5) stated in a form that a batched importer can actually satisfy?
8. **Are four lifecycle tables sprawl?** §12.1 A5 argues that one table with a `kind` reproduces 030 A1's nullable-column hazard. Is that the right call, or is it three triggers, three declared-list rows and a three-way guard where one of each would do?
9. **Does an LCID ever reach a human (§3.2's check character)?** 022 P6 governs what a screen may show. If an LCID never appears on an operator screen, in a CSV a shop exports or in a support conversation, the check character and the Crockford alphabet are both dead weight, and the honest identifier is a bare opaque string.

## 14. Ratification

| Field | Value |
|---|---|
| Decision | **Adopt §2–§10** — the two-level LCID with its four exclusions (§2); the opaque payload behind a prefix that encodes only what can never be corrected (§3); the insert-only registry whose INSERT is the mint, never speculative and never reused (§4); the lifecycle as appended facts with no status column and no PROPOSED state (§5); merges as a survivor-pointer forest with `resolve` and `asStated` as two distinct reads and a named survivor rather than an inferred one (§6); splits defaulting to ambiguity plus a review obligation, with continuation earned rather than assumed (§7); external identifiers as four classified alias namespaces in which a grader cert is a copy fact (§8); resolution as two facts with `edition_signature` kept distinct from `identityKey` (§9); and the corpus relation with an as-of resolver (§10). |
| Status | **RATIFIED.** Binding on E02-B07, E02-B10, E04-B02, E04-B03, E04-B04, E04-B05, E04-B06, E04-B11, E06-B02, E07-B01 and E11-B08. |
| Ratified by | **Claude, acting head of board**, under Jeremy Longshore's 2026-09-03 delegation |
| Date | 2026-09-04 |
| Cannon | `rich-hickey-reviewer` and `martin-kleppmann-reviewer`, 2026-09-04. `martin-fowler-reviewer` was offered as an optional third seat on Q8 only and **was not run** — A9 affirms the three-table shape on precedent already ratified in 030 and 041, and the lens whose 030 dissent was a YAGNI-timing objection would have re-litigated a settled record rather than tested this one. |
| Amendments at ratification | **A1–A12 absorbed in full, none declined.** **A1** (Kleppmann 1, REQUIRED) the mint path is deliberately AP on an `edition_signature` collision; **no UNIQUE on signature** (030 §3.3); new **I17** separates the two unique violations · **A2** (Kleppmann 2 + Hickey 4) the materialized `lcid_current_survivor` projection, transactional maintenance, benchmark fixture and index-only CI plan gate (**I18**), with the transactional-invalidation obligation on E06-B02 · **A3** (Kleppmann 3, REQUIRED) `resolve` is TOTAL over five outcomes; I12 covers all five · **A4** (Kleppmann 4) a certification write to the crosswalk is a catalog-authoring act with a role distinct from any shop session role; E04-B06 states its own detector · **A5** (Kleppmann 5) the mint retry runs in `withTransaction` under lock-order discipline and takes no anchor lock; an E04-B04 acceptance line · **A6** (Hickey 2, Q6 ruling) grader and `cert_number` are copy facts in **every** vertical; 030 amended to v1.2.0 by a row; an E04-B03 acceptance line · **A7** (Hickey 5, Q5 ruling) 019 T1 scores on `asStated`; an E07-B01 obligation · **A8** (Hickey 3) a static guard keeps `identityKey` and `edition_signature` apart; an E04-B02 acceptance line · **A9** (Hickey 6, Q8) the three narrow lifecycle tables stand · **A10** (Hickey vs Kleppmann on I8) the bounded walk raises at WRITE time and returns an outcome at READ time · **A11** (Kleppmann/Lamport, Q3) `asOf` is mandatory at the module boundary, `resolveCurrent()` at named call sites · **A12** Q1 YES, Q9 keeps the check character, Q7 names the import-batch fact as the citing row; **Q2 and Q4 stand as drafted.** |
| Dissent preserved | **Kleppmann, on §3 (an affirmation, recorded because it is the sharpest statement of the rule):** *"an identifier that encodes anything correctable is a cache with delusions of permanence."* · **Kleppmann, finding 1, on the drafted silence around signature uniqueness:** *"the record's own silence reads, to an engineer moving fast, as an invitation to add exactly the constraint that would reintroduce the split-brain §6.3 spent three rejected alternatives explaining how to avoid."* **Resolved by A1** — the refusal is now explicit (§4.4, §12.1 A7) and I17 asserts the absence of the constraint. · **Hickey, on §5.1:** *"the moment someone materializes that join into a view or a cached column for performance … you've re-invented the status column with extra steps and worse audit properties."* **Resolved by A2** — the projection is written only inside the merge's own transaction and is rebuildable from `lcid_merge` in one pass, so a disagreement with the log is a test failure rather than a data state; I18 asserts it. · **Kleppmann/Lamport, on Q3:** *"an optional parameter with a silent default is exactly the kind of API shape that lets a caller be accidentally correct in dev and silently wrong in an eval-replay context months later."* **Adopted by A11.** · **Adopted without change:** Hickey's affirmation of §3.1's *encode only what can never be corrected* rule, and his affirmation of §9.3's two-function separation of `identityKey` and `edition_signature` — both stand as drafted, with A8 adding the guard that keeps the second one true. |
| Gate audit | *(pending)* — `longbox-gate-auditor` before the bead closes. |
| Jeremy's revision right | **Standing.** Jeremy may revise any line by a 006 decision-log row naming date, old text, new text and reason (018 §5). Locked decisions 4, 5, 6 and 7 outrank this record, as do 019's signed thresholds and every ratified record it cites — 030 above all, whose §2, §3.3, §4, §5.2 and §7.1 this record extends and never amends. |
| Recorded in | 006 decision-log row dated 2026-09-04, **flipped in place from PROPOSED to RATIFIED** per 018 §4 C2 (the PROPOSED text is preserved in version control), plus a second 006 row of the same date recording 030's A6 amend-by-a-row; 016 §1 rows 047 and 030; 000-INDEX rows 047 and 030; the change log above; bead `longbox-e5b.4.1`'s close reason quotes v1.1.0. |

Binding as signed. Changing any **decision** above once ratified — what an LCID names, the namespace's shape or the encode-only-what-cannot-be-corrected rule, the mint's atomicity or its never-reused property, the absence of a status column or of a PROPOSED state, the merge's survivor rule or the two reads, the split default, a namespace's class, the two-facts rule, or the as-of resolver — requires a new decision record naming this one as superseded (018 §4 rule S4), never an in-place edit. Three things are explicitly **not** decisions and may be amended in place by a patch bump plus a change-log row, following 029 §9 and 042 §14's precedent: **statements of fact about the existing tree** (a `file:line` that turns out wrong is a defect in the description, not the decision); **the membership of §8.2's namespace classes**, which is designed to grow as packs register providers; and **the mint helper's retry bound (§3.2)**, a provisional circuit-breaker floor that may be raised freely.

**Ratification is not evidence** (018 §2 A3). Signing §14 records that a design was argued and adopted. It does **not** make any claim in §2–§10 true of any running system: **nothing here is built, nothing is TESTED**, every invariant in §11 names a test file that does not exist, and every one of them is blocked on tables that 030 ratified and nobody has yet written. §1 stays REPRODUCED and everything else stays ASSERTED — **no §1 today-claim was disturbed by A1–A12, and none needed a new cite.** **In particular, ratification does not give this system an identity: at `2242547` a confirmed comic is still an untyped jsonb blob (E4) declared as `z.unknown()` on the wire (E5), and it will remain so until E02-B07 and E02-B10 land the tables §12.4 lists.**
