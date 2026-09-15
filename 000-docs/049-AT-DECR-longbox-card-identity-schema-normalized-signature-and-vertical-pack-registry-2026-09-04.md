# Decision Record — The Versioned Card Identity Schema, its Normalized Signature, and the Vertical-Pack Registry

**Version:** 1.0.1
**Status:** **RATIFIED 2026-09-04** by the acting head of board under Jeremy Longshore's 2026-09-03 delegation, after a two-lens cannon (`rich-hickey-reviewer` + `martin-fowler-reviewer`, **both ACCEPT-WITH-CHANGES**) run at v1.0.1 — **§11 is the cannon record**: eleven amendments absorbed, none declined, three dissents preserved verbatim in §11.1, and no decision in §2 changed, which is why v1.0.1 is a patch. ⚠ v1.0.0's status line claimed a two-lens review that had NOT been run; §4's lens paragraphs were the drafting builder steelmanning both sides in one voice, and they are labelled as such now. Unlike its sibling records, **most of this one is TESTED, not ASSERTED**: the schema, the signature, the registry and the prohibition are shipped code with unit, contract and integration tests, and §7 lists which claims are which.
**Bead:** E04-B03 `longbox-e5b.4.3` (epic LBOX-E04 `longbox-e5b.4`, gate **G2**, evidence class **DEC**, owner-role data, risk high, phase P1-foundation, layer catalog) — see 000-docs/014 §8 row E04-B03 (`014:414`)
**Drafted:** 2026-09-04 by `longbox-domain-builder` · **Audit:** `longbox-gate-auditor` + `longbox-invariant-reviewer` before close · **Decision owner:** Jeremy Longshore (acting head of board under the 2026-09-03 delegation)
**Sensitivity:** Internal when written, public since 2026-09-15. It names no shop, no person and no credential.
**Supersedes:** nothing. It **discharges** 047 §12.3's deferral — *"The card identity schema. E04-B03 (`014:414`), gated by E19-B06. **A6 acceptance line:** cert namespaces are excluded from `edition` and from `edition_signature`"* — and **the first half of** 030 §5.4's *"E04-B03 acceptance line: cert namespaces are excluded from `edition` and from `edition_signature`, and a pack manifest declaring either as an edition field fails pack certification."* **The second half is NOT discharged here.** Pack certification does not exist: E04-B04 owns it, no manifest exists to certify, and C10 in §7 is the one invariant in this record that is ASSERTED rather than tested. What is discharged is the exclusion itself, in the shipped schema and its tests.
**Inputs:** 014 §3.4 (`014:164-178`) and §8 row E04-B03 · 015 alias map · **030 v1.2.1 §3.3, §4, §5.1–§5.4, §6, §8 (I1, I4)** · **047 v1.1.2 §2.3, §8.4, §9.3, §12.3, A6, A8** · 041 §2.1 · 042 §2.5 · 044 §6, §8 · 029 §2.3, §3.1, §3.3, §9 · 036 §2 · 037 §1.1 · 019 T1, T3, T7 · 018 §2 A1/A3 · 021 · 022 P1 · 023 §3, §5 · `src/catalog/*`, `src/services/identityResolution.ts`, `scripts/architectureRules.ts`, `migrations/016_catalog_core.sql` · CLAUDE.md locked decisions 4, 5, 6.

## Change log

**Version convention** (006 `:6`): a **minor** bump means the content of a decision changed; a **patch** means a statement of fact was repaired with no decision changing.

| Version | Date | What changed | Authority |
|---|---|---|---|
| 1.0.0 | 2026-09-04 | Initial record, drafted and ratified in band. Six decisions: **two card verticals sharing one pack module** (§4); **the signature is `set + number + variant + parallel + language`**, which amends 030 §5.4's sketch by a row to add `parallel` (§5.2); **`printRun` is an edition attribute and `serialNumber` is a copy fact**, extending 047 A6's list by the same argument (§5.5); **no default language, ever** (§5.3); **the pack registry leaves the pack** into `src/catalog/packRegistry.ts`, because a second vertical registered in the old layout is an import cycle (§6.1); and **`claimIsUsable` becomes a sixth pack function**, closing a comic branch that was wearing field names in `src/services/identityResolution.ts` (§6.3). One new architecture-gate rule (§6.4). | `longbox-domain-builder` → acting head |
| **1.0.1** | **2026-09-04** | **Patch — statements of fact repaired; NO decision changed.** From the `longbox-gate-auditor` report on `ba8d086` (B1–B9): §0 no longer splices E04-B03's acceptance line (`014:414`, which ends at *"resolve"*) with E04-B04's (`014:415`, *"without core-code branching"*), and now walks the line field by field, including the one that reads oddly until it is said out loud — for `grader`/`cert`, *resolving* means **resolving to a refusal**; test counts are replaced by the commands that produce them (**27** `it(`, **53** `expect(`, not v1.0.0's "33 assertions"; **9** added architecture-gate cases, not "two"; **376 passed + 1 skipped** in the integration lane); §Supersedes splits 030 §5.4's acceptance line, discharging the exclusion half and leaving pack certification with E04-B04 (§7 C10); §4 replaces *"047 I1 makes impossible"* — I1 (`047:437`) says an LCID is never reused and never removed, which is not a re-mint prohibition — with the honest cost, retire-and-re-mint under `lcid_retirement` and every prior external reference resolving RETIRED forever, on `047:94` and Q1/A12 (`047:524`); §5.2 cites 030 §11's standing revision right as the authority for the amend-by-a-row; §6.4 states the gate's real shape (whole-line comment stripping only, so a trailing comment WOULD fire — a false positive, never a false negative) and names the bare-constant fixture. **From the two-lens cannon (§11), eleven amendments:** §3.1 stops calling the required-`subject` rule a comic precedent when it is a divergence (H2); §5.5 marks `physical_item` a forward reference to a table that does not exist (H4); §6.2 stops implying `fields.series` became a type error — `noPropertyAccessFromIndexSignature` is not set, so the advertisement was removed and not the error, and the six-member contract is the real defence (invariant review WARN 1); §6.4 concedes that contract stops a PACK omitting a function and does **not** stop a CALLER re-deriving one inline, a residual gap with no gate (F4, the one REQUIRED finding); §8 gains two acceptance lines — `identityKey`'s vertical-blindness handed to E19-B06 (H1) and the `variant`/`parallel` conflation measurement handed to E04-B11 (H3); §10 hands E04-B04 the one-manifest-with-a-discriminator question (F3) and the does-`packRegistry`-collapse question (F2), and records that 047 §12.3 is **not** amended because history stays true. **From the `longbox-invariant-reviewer` report (PASS-WITH-NOTES):** §6.1's "imported by none" is restated as *no pack imports the registry* (`index.ts` re-exports the packs for the public surface), and a card case through `lookupClaim` joins `tests/identity-resolution.test.ts`. | `longbox-gate-auditor` + two-lens cannon → acting head |

## 0. Evidence posture

Per 018 §2 A1/A3:

- **Every claim about what the repository does today is REPRODUCED** at the branch head of `feat/e04-b03-card-identity-schema`, cut from `origin/main` `ffaa225`, and carries a `file:line` or the command that produced it. Every command was run with `/usr/bin/grep`, never the `rg` alias (046 E26).
- **The branch was rebased onto `9fe1045` at v1.0.1, and NO §1 cite moved.** Checked rather than assumed: `git diff --stat ffaa225 9fe1045 -- src scripts migrations tests` returns **empty** — the four commits main took in between touched only `000-docs/`, `.beads/` and `015`, so every `file:line` in §1 still resolves at the new base. This is the check 048 v1.1.0 learned to run the hard way, when a merge landed under a record between its draft and its ratification and stranded three cites.
- **Most of §5 and §6 is TESTED, which is unusual for a DEC-class record and is the point.** **E04-B03's acceptance line, quoted whole and quoted alone, is** *"Sport/game/set/year/card/player/parallel/edition/language/grader/cert examples resolve"* (`014:414`). It ends at *"resolve"*. The phrase *"without core-code branching"* belongs to the NEXT ROW — E04-B04's, *"A sample comic and card pack register without core-code branching"* (`014:415`) — and v1.0.0 of this record spliced the two into one quotation. **§6.4's gate rule ANTICIPATES E04-B04's acceptance; it does not discharge E04-B03's, and E04-B03's is not a statement about branching at all.**
- **What E04-B03's line asks, field by field, and where each is answered.** Sport/game §3.1 · set §3.1 · year §3.1 · card number §3.2 and §5.3 · player §3.1 · parallel §3.2 and §5.2 · edition (print run) §3.2 and §5.5 · language §3.2 and §5.3 · **grader and cert §5.5, and "resolve" for those two means RESOLVE TO A REFUSAL** — a payload naming either is rejected by name, in every vertical, before it reaches the database, which is exactly what 047 A6 and 030 §5.4 require the card pack to do with them. A schema that silently accepted a `grader` key would also have "resolved" it, and that is the outcome the acceptance line exists to forbid.
- **Test counts, stated as the command that produces them** (018 §2: a count is a measurement with no name). `/usr/bin/grep -c "^\s*it(" tests/card-identity.test.ts` → **27**; `/usr/bin/grep -c "expect(" tests/card-identity.test.ts` → **53**. v1.0.0 said "33 assertions", which is neither number. `tests/integration/catalog-card-edition.test.ts` → **7** cases. `git diff origin/main...HEAD -- tests/contract/architecture-gate.test.ts | /usr/bin/grep -c "^+\s*it("` → **9** added cases across two describes (v1.0.0 said "two"). §7 maps each decision to its test.
- **What is ASSERTED and not tested:** every statement about what a card pack would need at PACK-CERTIFICATION time (§8), because E04-B04 has not run and there is no manifest to certify.
- **Registering a vertical is not launching one, and nothing here authorises a card shop.** E19-B06 gates any second vertical on reuse, rights, accuracy, economics and demand evidence; 030 §5.4: *"architectural possibility is not market permission"*. No `vertical_pack` row for a card exists outside a temporary test database, no card corpus is imported, no card provider is contracted, and no 021 registered claim gains a word.
- **No number in this record is a measurement**, and no percentage appears that is not a quoted threshold. There is no card accuracy figure here because no card has ever been identified by this system.

## 1. What exists today (REPRODUCED at `ffaa225`)

| # | Claim | Evidence |
|---|---|---|
| E1 | **One vertical was registered before this bead.** The signature registry held a single entry, `comic`, and every other per-pack map beside it held one. | `src/catalog/editionSignature.ts:129-131` at `ffaa225`; `src/catalog/comicIdentity.ts:193-235` |
| E2 | **The write path was already vertical-generic.** `insertDefinition`/`insertEdition` take `vertical` as a parameter and resolve all four per-pack functions through maps; neither names `comic`. | `src/catalog/editionWrite.ts:150`, `:202`, `:214-226` |
| E3 | **`vertical` is a data value, not a DDL enum.** `vertical_pack.vertical text PRIMARY KEY` with `vertical_code text NOT NULL UNIQUE CHECK (vertical_code ~ '^[a-z]{3}$')`, and every catalog table's `vertical` column is `REFERENCES vertical_pack(vertical)`. **No `CHECK (vertical IN ('comic'))` exists anywhere.** | `migrations/016_catalog_core.sql:82-91`, `:250`, `:272`, `:325`, `:395` |
| E4 | **A core service was asking a COMIC question of every vertical.** `resolveBySignature` tested `if (!fields.series && !fields.issue) return { status: "skipped", reason: "unusable_claim" }` before computing a signature. | `src/services/identityResolution.ts:198` at `ffaa225` |
| E5 | **`SignatureFields` named the comic's four fields beside its index signature**, so `fields.series` type-checked on any vertical's claim and returned `undefined` for a card. | `src/catalog/comicIdentity.ts:301-314` at `ffaa225` |
| E6 | **The copy-fact denylist lived inside the comic pack.** `COPY_FACT_KEYS`, both error classes and `assertNoForbiddenKeys` were members of `comicIdentity.ts`. | `src/catalog/comicIdentity.ts:88-133`, `:262-268` at `ffaa225` |
| E7 | **`no-circular` is an ERROR in the cruiser config**, with the comment *"029 §3.1: the module graph is a DAG. A cycle means a boundary was drawn wrong."* | `.dependency-cruiser.cjs:94-99` |
| E8 | **Two ratified records disagreed with themselves about the card signature.** 030 §5.4 listed the card edition as `{ number, variant, parallel, language }` and its signature as `set\|number\|variant\|language` — `parallel` in the attribute list and absent from the key. §3.3's bullet list said the same four. | `030:365`, `030:198` (both at `ffaa225`, before this record's amendment) |

**What §1 adds up to.** The core was *already* built to take a second vertical (E2, E3) and *already* had three places where a second vertical would have been silently mis-handled (E4, E5, E6) plus one place where it could not be added at all without a cycle (E1, E7). E04-B03 is therefore not "write a card schema"; it is "write a card schema **and find out which of the core's claims about not being comic-shaped were true**". Three were not.

## 2. What this record decides

1. **Two card verticals, `sports-card` and `tcg-card`, sharing one pack module.** §4.
2. **The card identity schema**, versioned, with a normalisation rule per field. §5.
3. **The card edition signature is `set + number + variant + parallel + language`** — an amend-by-a-row on 030 §5.4, which sketched four. §5.2.
4. **`grader`, `cert_number` and `serialNumber` are refused by name, in every vertical**, and the denylist moves above every pack. §5.5.
5. **The pack registry is a module of its own**, and a pack contract has six members, not five. §6.
6. **No core code branches on a vertical**, enforced by a new architecture-gate rule rather than by review. §6.4.

## 3. The schema (versioned)

`CARD_IDENTITY_SCHEMA_VERSION = 1`, distinct from `NORMALIZATION_VERSION` (which versions the signature rule) and from `vertical_pack_version.pack_version` (which versions the whole manifest single-rate, 030 A5). One number covers both card verticals because they are one shape with two field names substituted; if the shapes diverge, the constant splits before the shape does.

### 3.1 The WORK — `collectible_definition.attributes`

| Field | `sports-card` | `tcg-card` | Required | In the definition signature | Normalisation |
|---|---|---|---|---|---|
| discriminator | `sport` | `game` | yes | **no** | trim · collapse internal whitespace · casefold |
| subject | `player` | `cardName` | **yes** | **yes** | same |
| set | `set` | `set` | **yes** | **yes** | same |
| year | `year` | `year` | no | no | same; **text, not a number** — "1986", "1986-87" and "unknown" are all statements a corpus makes |
| manufacturer | `manufacturer` | `manufacturer` | no | no | same |

### 3.2 The PRINTING — `edition.attributes` (identical in both card verticals)

| Field | Required | In the edition signature | Normalisation |
|---|---|---|---|
| `number` | **yes** | **yes** | `normalizeCardNumber` — §5.3 |
| `variant` | no | **yes** | trim · collapse · casefold |
| `parallel` | no | **yes** | same |
| `language` | no | **yes** | `normalizeLanguage` — §5.3 |
| `printRun` | no | **no** | trim · collapse · casefold — §5.5 |

**Unknown is not absent, and both survive into jsonb.** A key that is ABSENT means no statement was made; a key set to `null` means a statement was made whose content is "not known" or "does not apply" — a corpus row with an empty `parallel` cell is asserting the card is a base card, and that is a fact. The card schema inherits this rule from the comic one verbatim (`stated = z.string().nullable().optional()`, never `.default()`), because 030 A1 already recorded what one NULL carrying two meanings costs when the row can never be updated.

**Why the discriminator, the year and the manufacturer are not in the key.** They are excluded on the comic pack's precedent and for its stated reason: `comicDefinitionSignature` drops publisher and year because *"a work-level key including the publisher would fail to dedupe a series two corpora attribute differently, and that disagreement is a human-queue item rather than a second work"*. A set name is already sport-specific and year-bearing in practice ("1986 Topps"), so including either would split one work on a corpus's formatting habit.

**Why `subject` is REQUIRED — and this is a DIVERGENCE from the comic pack, not an inheritance from it (Hickey H2).** Comic's definition signature is `series + volume`, and `volume` is `stated`, i.e. optional: two comics with no stated volume and the same series name **do** collide, and comic accepts that as its human-queue cost. Card refuses the analogous risk at the schema layer instead, because **the collision is not an edge case for cards, it is the common case**: subject cardinality inside one set runs to hundreds, where volume cardinality inside one series runs to a handful. A card definition with no subject would collide with every other card in its set, turning one release into several hundred mutual dedupe candidates. **So "required if it is in the definition signature" is a choice this pack made, not a house rule inherited from comics** — the next pack author must make the same judgement about their own field's cardinality rather than copying either answer.

## 4. Decision A — Two card verticals, one module (the TCG-vs-sports question)

**The question.** 014 §8's E04-B03 row asks for `sport/game` in one field list. That admits two readings: **one** `card` pack whose schema carries a `sport`-or-`game` either/or, or **two** packs with separate discriminators.

**Decision: two registered verticals — `sports-card` and `tcg-card` — implemented in ONE module, `src/catalog/cardIdentity.ts`.**

**The two lenses, as the DRAFTER steelmanned them before the cannon ran.** The paragraphs below are the builder arguing both sides — they are not seat positions, and v1.0.0 blurred that by calling them a "two-lens review" in its status line. **The actual cannon is §11**, run at v1.0.1 by `rich-hickey-reviewer` and `martin-fowler-reviewer` as separate read-only agents, with verdicts, an amendment list and Fowler's dissent on this very decision preserved verbatim. Read §11.1 before treating the ruling below as unopposed.

*Hickey lens (drafter's steelman).* A vertical is the discriminator that SELECTS a pack (030 §3), and a pack version is **single-rate** (030 A5): schema, signature function, capture recipe, condition schema, crosswalk, valuation and prohibited claims all move together under one number. One `card` pack would therefore complect two things that will move at different times and for different reasons — a TCG condition vocabulary ("played", "lightly played") has nothing to do with a sports one, and a `tcgplayer` crosswalk namespace has no meaning in a sports pack. A schema saying "exactly one of `sport` or `game` must be present" is a discriminator pretending not to be one: the union type is already there, and hiding it inside the value means every reader must re-derive which half it is holding.

*Fowler lens, arguing for one pack (drafter's steelman; the real seat argued it harder — §11.1 F3).* Two registrations duplicate a registry entry and a definition schema for the sake of one field name. The honest cost is real and it is small: **eleven lines in `packRegistry.ts` and one extra Zod object.** Everything else — every normalisation rule, the whole edition schema, the signature function, the claim mapper, the usability predicate — is written once and shared, because they are ONE MODULE. The duplication the lens warns about would be real if the two packs were two files; they are not.

**Ruling (acting head).** Two verticals, one module. The Fowler objection is answered by the module boundary rather than by the vertical boundary, which is the cheapest place to answer it.

**The rejected alternative is recorded rather than dismissed, and its cost is stated honestly rather than as an impossibility.** One `card` pack with a discriminated field ships less code today and has to be split the first time a TCG condition schema moves. **Splitting a vertical after rows exist is possible; it is just expensive, and the expense is permanent.** 047 §4.1's grammar puts the three-character `vertical_code` in the LCID string itself, and 047 §2 (`047:94`) rules that *"the prefix may encode a fact if and only if that fact can never be corrected"* — with Q1/A12 (`047:524`) answering that `kind` and `vertical` qualify because they are **immutable values**, not correctable attributes. So a card LCID minted under a `card` code cannot be re-pointed at a `tcg-card` code: the string is the name. The migration is therefore **retire and re-mint** — every affected LCID gets an `lcid_retirement` fact, a new LCID is minted under the new code, and **every external reference issued before the split resolves RETIRED from then on**, for the life of the catalog. Nothing is destroyed and nothing is impossible; what is lost is the citability of every identifier already handed out, which is the property 047 §3 chose a typed prefix to obtain in the first place.

v1.0.0 of this record wrote *"which 047 I1 makes impossible"*. That was a misreading: I1 (`047:437`) says an LCID is **never reused and never removed**, which is a statement about the registry refusing UPDATE, DELETE and a second INSERT — it is not a prohibition on minting a different name for the same thing, and the honest argument does not need one.

**The alternative is cheap now and expensive forever afterwards, which is exactly when a decision should be taken early.**

**Consequence recorded honestly:** `sports-card` and `tcg-card` are also the two vertical CODES that E04-B04 must assign (`spc`, `tcg` are what the integration fixture uses; the assignment is E04-B04's to make in the `vertical_pack` row, not this record's).

## 5. Decision B — The normalized signature

### 5.1 The composition

```
edition signature      set │ number │ variant │ parallel │ language
                       ▲     ▲        ▲         ▲          ▲
                       │     └────────┴─────────┴──────────┘
                  DEFINITION                 EDITION
definition signature   set │ subject
```

`set` comes from the **definition**, exactly as `series` does for a comic, and for the comic pack's reason: copying it onto every edition row would leave a corrected set name stranded on rows that append-only rules forbid repairing, with no way to tell a stale copy from a deliberate alias. The join costs one read at write time — a read `insertEdition` performs anyway to assert 030 I7 — and the copy costs a permanent ambiguity.

Fields are joined with `U+001F`, the ASCII unit separator, which no normalised field can contain, so `("ab","")` and `("a","b")` cannot collide.

### 5.2 `parallel` enters the key — an amend-by-a-row on 030 §5.4 (v1.3.0)

030 §5.4 sketched the card edition as `{ number, variant, parallel, language }` and the signature as `set|number|variant|language` (E8). **Under that signature a Silver Prizm #12 and a base #12 produce the same string** and dedupe as candidates for each other.

That is wrong in the most common case the card pack would ever see. A parallel is a **different printing of the same card** — which is precisely what an `edition` is (030 §2.1: an edition is "a specific printing"). Two parallels are two editions that trade at different prices, and a key that cannot tell them apart is a key that files an unbounded human queue on the ordinary case.

**Decision: the card signature is `set + number + variant + parallel + language`, and 030 takes an amend-by-a-row to v1.3.0.** **The authority is 030 §11's standing revision right** (`030:491`: *"Jeremy may revise any line in this record by a 006 decision-log row naming date, old text, new text and reason (018 §5)"*), exercised by the acting head under the 2026-09-03 delegation — a builder does not amend a ratified record on its own signature, and the 006 row of 2026-09-04 is where the revision is recorded with its old text, its new text and its reason. The precedent is 030's own v1.2.0 row, taken at 047's ratification for exactly this reason — *"E19-B06 still gates any second vertical, so the sketch is amended while it is still a sketch"*. No rule in 030 §2, §3, §4, §6 or §7 moves; no ratified invariant changes; **no comic behaviour changes at all**.

**Why `variant` and `parallel` are both in the key rather than folded together.** They are two axes a corpus records separately: a *parallel* is a print treatment of a card ("Silver Prizm", "Refractor", "Holo"), a *variant* is a difference in the card itself ("photo variation", "error card", "short print"). Folding them would make `variant: "photo variation"` and `parallel: "photo variation"` the same edition, which they are not; the test that asserts they differ is the one that would fail if a later author folded them.

### 5.3 Per-field normalisation rules, and the two that are decisions

Trim, collapse internal whitespace and casefold are **`normalizeField` in `src/catalog/editionSignature.ts`**, called by both packs — the shared rule has a name, and it is the one `tests/edition-signature.test.ts:82` pins for comics. 047 §9.3 says in terms that the normalisation *"should be reused"* and the FIELD LIST must not, so the function is reused and the list is this pack's own literal. Two rules are card-specific and each is a decision:

**`normalizeCardNumber` — strip a leading `#`, then close whitespace around a hyphen. THE HYPHEN ITSELF IS KEPT.** `#12A` → `12a`; `RC - 12` → `rc-12`. Stripping the hyphen would fold `RC-12` into `RC12`, and nothing in the domain says those are the same card — a set that numbers both `12` and `RC-12` is ordinary. **A normalisation that MIGHT merge two real cards is worse than one that leaves two spellings of one card as a dedupe candidate**, because a candidate is a human-queue item (030 §3.3) and a bad merge is a silent wrong answer that 047 A1 makes expensive to undo.

**`normalizeLanguage` — trim, casefold, fold `_` to `-`. NO DEFAULT, EVER, AND NO SYNONYM TABLE.** Defaulting an absent language to `"en"` would give a Japanese printing and an English one the same signature the moment one corpus omitted the field — merging two editions that trade at different prices, in the one direction the catalog cannot recover from. And mapping `"English"` onto `"en"` is an INGEST decision about a particular corpus (E04-B11), not an identity rule: two spellings produce a dedupe CANDIDATE, which is the correct outcome for a disagreement the catalog cannot adjudicate.

### 5.4 What the signature deliberately collapses

Missing, `null`, empty and whitespace-only are ONE claim and all normalise to the empty string — the same division of labour the comic pack states: the distinction between "no statement" and "stated as unknown" is preserved where a reader can act on it (`attributes`) and dropped where acting on it would be wrong (the dedupe key).

**And "base" is not collapsed.** A corpus that writes `parallel: "Base"` for base cards produces a different signature from one that omits the field. That is deliberate: the system cannot know whether a stated `"Base"` means "no parallel" or names a parallel line called Base. The disagreement surfaces as a dedupe candidate — a human-queue item — rather than as a rule that guesses.

### 5.5 The cert acceptance line, and `serialNumber` joining it

**047 A6's acceptance line is discharged: cert namespaces are excluded from `edition` and from `edition_signature`.** `grader` and `cert_number` are not card edition fields, are not in the card signature, and are refused **by name** with an error that says why, rather than by `.strict()`'s "unrecognized key". 047 §8.4 also excludes cert namespaces from `edition_external_id` entirely; nothing here adds one.

**And this record extends the list by one, on 047 A6's own argument: `serialNumber` is a copy fact.** The card domain has a shape comics do not — a serial-numbered parallel — and it splits cleanly across the same line:

| Fact | Kind | Where it lives |
|---|---|---|
| the RUN a parallel was printed to (`/99`) | **edition** — every copy shares it | `edition.attributes.printRun` |
| the NUMBER stamped on one card (`07/99`) | **copy** — no two copies share it | 036 `physical_item` |
| the grader, the cert number, the label | **copy** | 036 `physical_item` + 037's condition record |

**⚠ `physical_item` is a FORWARD REFERENCE, not a present-tense fact (Hickey H4).** `/usr/bin/grep -rn "physical_item" migrations` returns one line, a comment at `migrations/017_lcid_lifecycle_and_resolution.sql:45`; **the table does not exist**, and E02-B05 builds it. That costs nothing today — a fail-closed refusal is right whether or not the destination exists — but the table above says where these facts *will* live, not where they *do*.

Putting `07/99` in an edition attribute would make one shop's card a property of the shared catalog, which is the identical failure 047 §8.4 describes for a cert-number crosswalk edge. **`printRun` is outside the signature** for 030 §3.3's reason restated: the ratified positions are the five in §5.2, and the run is almost always implied by the parallel name that is already in the key.

**The denylist moved above every pack** (`src/catalog/copyFacts.ts`). 047 A6's Q6 ruling is that this *"is not a pack decision at all: it is the same rule restated"*, and a card pack that had to import the comic pack to learn that grader is forbidden would have made a universal invariant look like a comic convention other packs borrow. A pack now cannot opt in, cannot opt out, and does not import a sibling to obtain it. The provider-key regex moved with it and gained the card graders (`psa`, `bgs`, `cgc`, `sgc`) and `tcgplayer`, per 030 §4 rule 2 and I1's deny-list seed.

## 6. Decision C — What the core had to change, and what it did not

### 6.1 The registry leaves the pack

**Nothing in the write path, the schema, or any migration changed to admit a card.** What did have to change is where the per-pack maps live.

They lived inside `comicIdentity.ts` and `editionSignature.ts` — inside a PACK — which was survivable while that pack was the only one. Registering a second pack in them creates a cycle in two directions at once: `editionSignature.ts` would import `cardIdentity.ts` for its signature function while `cardIdentity.ts` imports `editionSignature.ts` for the normalisation. `no-circular` is an ERROR (E7), and it is right to be.

The boundary drawn wrong is small and worth naming exactly: **a registry of packs is not a member of any pack.** `src/catalog/packRegistry.ts` now holds every map, imports every pack, and **is imported by no pack** — `src/catalog/index.ts` imports it, and also re-exports the pack modules directly, because the module's public surface is `index.ts` and a caller may legitimately want `cardEditionSignature` by name. The property that matters for the cycle is the one stated precisely: **the arrows run registry → pack, never pack → registry.**

```
packRegistry ──▶ comicIdentity ──┐
            ├──▶ cardIdentity  ──┼──▶ editionSignature (normalisation only)
            └──▶ editionSignature┘
```

**The consequence is the acceptance line as an import graph:** adding a third vertical is an edit to `packRegistry.ts` plus a new pack module, with **no edit to any existing pack**. Every public name is unchanged and re-exported through `src/catalog/index.ts`, so the move is a change of home, not of contract (029 §2 / §3.3: the module's only public surface is its `index.ts`).

### 6.2 `SignatureFields` stops ADVERTISING comic's fields — which is not the same as making them a type error

E5: the shared input type declared `series`, `issue`, `variant` and `printing` beside its index signature. Harmless with one pack; with two it is a comic field list inside a shared type. The type now declares the index signature and nothing else.

**⚠ AND THAT REMOVES THE ADVERTISEMENT, NOT THE ERROR.** `tsconfig.json` does not set `noPropertyAccessFromIndexSignature`, so `fields.series` on a card claim **still compiles** — it resolves through the index signature to `string | null | undefined` and evaluates to `undefined`, exactly as before. The change is real but it is a change of what the type SUGGESTS to the next author, not a compiler guarantee, and v1.0.0's wording invited the stronger reading. **The real defence is §6.3's six-member pack contract**: there is nowhere left in core code to ask a per-vertical question, so the field access has no site to be written at. Flipping the tsconfig flag is a repo-wide decision with a blast radius far beyond this bead and is deliberately NOT taken here; it is filed as its own discovered bead.

### 6.3 `claimIsUsable` becomes a sixth pack function — the branch that was hiding in field names

E4 is the sharpest finding of this bead. `src/services/identityResolution.ts` asked `!fields.series && !fields.issue` before computing a signature. For a card claim — which carries neither key — **every** lookup would have been skipped as an `unusable_claim`, and nothing would have failed: no exception, no type error, no test. A card pipeline would simply have never resolved anything, and the reason would have been four words in a workflow service.

**That is the `if comic` 014 §3.4 forbids, wearing field names instead of a vertical literal.** The fix is not a second condition; it is a sixth member of the pack contract. `VerticalPack` now carries `claimIsUsable`, comics answer "a series or an issue", cards answer "a set or a number", and the service asks the pack.

**Why the pack contract is an interface with six members rather than six loose maps.** E04-B02's invariant review found the shape this prevents: `editionSignature()` failed closed on an unregistered vertical while the composer beside it silently applied the comic field list — and because the composer runs FIRST, a plausible-looking composed input could have been comic-signed with nothing refusing. A pack supplying five of six functions is not writable when the six are one object.

### 6.4 The prohibition becomes a gate (architecture-gate rule 8)

030 §6 rule 1 — *"No `if (vertical === 'comic')` in core code"* — was prose. It is now `checkNoVerticalBranching` in `scripts/architectureRules.ts`, run by `pnpm arch` on every push and PR under the **Architecture gate** required check (044 §6).

**What counts as a branch, deliberately narrowly:** an equality comparison against a registered vertical literal (`x === "comic"`, `"comic" === x`, and the loose forms), or a `case` label of one. **What does not count:** a map key, a registry lookup, or a bare constant — each is a pack being SELECTED, which §6 rule 1 expressly permits, and a rule that fired on them would fire on `packRegistry.ts` doing exactly the right thing. Fixtures: `tests/contract/architecture-gate.test.ts`, the case *"does NOT fire on a MAP KEY, which is a pack being selected"*, whose two assertions are `const P = { "comic": comicPack };` and `const v = "comic";` — the second is the bare-constant shape. The two pack modules are exempt **by path**, declared in `VERTICAL_PACK_FILES`, because a pack owns its own vertical by definition.

**⚠ The comment exemption is WHOLE-LINE ONLY, and the record says so rather than overstating the rule.** `scripts/architectureRules.ts:755-761` drops lines whose first non-space characters are `//`, `*` or `/*`; it does not strip a trailing comment from a code line, and it does not exclude string literals. So `const p = packFor(v); // not: if (v === "comic")` **WOULD** fire, and so would an error message that spelled the comparison out inside a template literal. That is a **false positive, never a false negative** — the rule fails toward refusing, and the escape hatch is to write the prose on its own line, which every explanatory comment in this tree already does. It is recorded here because a reader who trusts v1.0.0's flat *"a mention in a comment does not count"* would be surprised by a red gate and would reach for an exemption row instead of a newline.

**The rule's limits, stated rather than glossed.** It cannot see the E4 shape — a branch on FIELD NAMES has no vertical literal to match. A regex will never catch that; what caught it was writing a second pack. The rule closes the half that can be closed mechanically, and §6.3 is the other half's partial defence: the six-member pack contract means there is no longer a per-vertical question a core file is *invited* to answer inline.

**⚠ AND THAT DEFENCE IS NARROWER THAN v1.0.0 CLAIMED (Fowler F4, REQUIRED).** v1.0.0 said the pack contract *"makes the field-name branch unwritable"*. It does not. **What the interface makes unwritable is a PACK omitting one of the six functions** — five-of-six is not a value of the type. **It does nothing to stop a CALLER re-deriving one inline**: nothing mechanical would catch a future author writing `!attrs.player && !attrs.set` in, say, `src/services/pricingService.ts`, a file that never goes near `VerticalPack`. **The residual gap is open for every core file, not only for the one instance this bead found**, and it has no gate — mechanical or otherwise. Rule 8 catches literal-comparison branching; structural-shape branching is caught by review, by writing a second pack, and by nothing else. Recording that plainly is worth more than the rule, because a gate believed to be closed is how the E4 defect survived E04-B02's own invariant review.

`CATALOG_IDENTITY_FILES` (047 A8's subject set) gains `cardIdentity.ts` for the same reason it gained `comicIdentity.ts`: `cardSignatureClaim` maps a payload onto a field list, so a diff editing it beside `identityKey` is the paired edit A8 forbids.

### 6.5 What did NOT change, which is the acceptance line

- **No migration.** `vertical` is data (E3); registering a card vertical is an INSERT into `vertical_pack`, and the integration test proves the whole path against a real database without one line of DDL.
- **No column, on any table.** Asserted against `information_schema` in the integration suite, not believed.
- **No change to `editionWrite.ts` beyond its import line**, and none at all to `dedupe.ts`, `resolve.ts`, `mint.ts`, `lifecycle.ts`, `projection.ts`, the routes, or the wire contract.
- **No comic behaviour changed.** Every pre-existing comic test passes unmodified, except two fixtures that used `"sports-card"` as a stand-in for an UNREGISTERED vertical and now use `"coin"` — the rule under test is "an unregistered vertical is refused", not "cards are refused".

## 7. Invariants, and where each is decided

Unusually for a DEC-class record, most of these are TESTED today. The ones that are not say so.

| # | Invariant | Status | Where |
|---|---|---|---|
| **C1** | A card definition and edition are written by the same `insertDefinition`/`insertEdition` a comic uses, into the same tables, and the LCID resolves through the same `resolve(lcid, asOf)`. | **TESTED** | `tests/integration/catalog-card-edition.test.ts` |
| **C2** | No card-specific column exists on any table. | **TESTED** (`information_schema`) | same file |
| **C3** | Two parallels of one card are two editions and produce no dedupe candidate. | **TESTED** | same file + `tests/card-identity.test.ts` |
| **C4** | `grader`, `cert_number`, `serialNumber` and provider-named keys are refused on a card and on a comic, before the database. | **TESTED** | `tests/card-identity.test.ts`, integration file |
| **C5** | An unregistered vertical is refused at every one of the six entry points, never defaulted to `comic`. | **TESTED** | `tests/card-identity.test.ts` |
| **C6** | An absent language never becomes `en`, and a Japanese printing never signature-collides with an English one. | **TESTED** | `tests/card-identity.test.ts` |
| **C7** | No file under `src/` outside a pack module branches on a registered vertical literal. | **TESTED** (gate rule 8, real tree + fixtures) | `tests/contract/architecture-gate.test.ts` |
| **C8** | The gate's watched literals equal the registered verticals, so a new pack cannot arrive unwatched. | **TESTED** | same file |
| **C9** | A card edition attaching to a comic definition is refused (030 I7). | **TESTED** | integration file |
| **C10** | A pack manifest declaring `grader` or `cert_number` as an edition field fails **pack certification**. | **ASSERTED** — E04-B04 owns certification and no manifest exists | 030 §5.4, 047 A6 |
| **C11** | Registering a card pack row requires no code change in any module other than `packRegistry.ts`. | **ASSERTED** for a THIRD vertical; demonstrated for the second | §6.1 |

## 8. What this record does NOT decide

- **It does not authorise a card vertical.** E19-B06 gates that on reuse, rights, accuracy, economics and demand evidence. No `vertical_pack` row, no corpus, no provider, no shop, no 021 claim.
- **It does not assign vertical CODES.** `spc` and `tcg` appear in a test fixture; the authoritative assignment is a `vertical_pack` row, and E04-B04 makes it (047 §3.3: assigned in the pack row, never invented per LCID).
- **It does not decide a card CONDITION vocabulary.** 030 §5.4 sketches one with a `graderLabelMap` translating a PSA or BGS label into a Longbox **range**, never carrying the number through (022 P1, 019 T7, locked decision 5). That is E08's and a pack manifest's; **nothing numeric enters this system from a grader's label, in any vertical**.
- **It does not decide the card CAPTURE recipe** (front + back, slab label conditional on the copy) — E05's, through the manifest.
- **It does not decide card crosswalk namespaces or any provider contract.** E04-B05 and E04-B07.
- **It does not touch 019 T1 or T3.** `identityKey` is unchanged; A8's guard grew a subject file and the rule it enforces did not move.

  **⚠ AND "UNCHANGED" IS NOT "SAFE" — the Hickey cannon's most-costly finding (§11.1 H1).** `identityKey` (`src/services/confirmationOutcome.ts`) computes `[title, issue, variant]` **unconditionally**: no vertical parameter, no pack lookup. It is the SAME defect class this bead just fixed in `identityResolution.ts` — a comic question wearing field names — and rule 8 is structurally blind to it. If a card claim ever reaches `recordConfirmation`, all three fields are `undefined`, the key degenerates, and every card confirmation is measured against T1/T3 as a false correction or collapsed into one bucket, silently, from day one. **This record does not fix it, and the reason is that fixing it IS a 019 measurement change**: `019:57` makes T1's field exclusion non-editable without a 006 row, and 047 A8's paired-edit gate exists precisely so that a builder cannot edit `identityKey` beside a catalog field list without one. So the honest disposition is a stated gate, not a silent omission:

  > **ACCEPTANCE LINE HANDED TO E19-B06 (and to whichever bead first routes a non-comic session): no card session may reach `recordConfirmation` until `identityKey` is vertical-aware — resolving its field list through `packRegistry`, the shape §6.3 used — or until a 006 row rules that it must not be and names what T1/T3 measure for a card instead.**

  Filed as a discovered bead by the closing session (no `bd` write is made from inside this record).

- **It does not settle whether `variant` and `parallel` are two axes in the DATA (§11.1 H3).** The tests prove the CODE keeps them apart; no card corpus has ever been imported, and corpora are not disciplined about the distinction — a source that files a parallel under its `variant` column is the median case for scraped card data, and two conceptually distinct axes that every real corpus conflates produce a flood of dedupe candidates that reads as a bug. **E04-B11 acceptance line: on the first real card corpus, measure what fraction of rows populate both `variant` and `parallel` versus only one, before assuming the two-axis design survives contact.**

## 9. Open questions, ruled

1. **One `card` pack or two?** **Two verticals, one module** — §4. The alternative is recorded and was rejected on the cost of splitting a vertical after LCIDs exist, not on line count.
2. **Does `parallel` belong in the key?** **Yes**, and 030 §5.4 is amended by a row — §5.2.
3. **Is a print run identity?** **The run is; the serial number on a copy is not** — §5.5.
4. **Should an absent language default to English?** **No, and this is not a close call** — §5.3.
5. **Is `"Base"` the same as no parallel?** **Unruled by design**: a dedupe candidate, which is a human-queue item, not a normalisation guess — §5.4.
6. **Where does the registry live?** **Above every pack** — §6.1, forced by `no-circular` and correct independently of it.
7. **How many functions is a pack?** **Six** — §6.3.

## 10. Traceability

- **Bead:** `longbox-e5b.4.3` (E04-B03), epic LBOX-E04, gate G2. Closed by `bd-sync close` with this record, the PR and the test evidence, after `longbox-gate-auditor` and `longbox-invariant-reviewer`.
- **Amend-by-a-row raised:** 030 → **v1.3.0** (§5.4 card signature gains `parallel`), with a 006 row of the same date.
- **Deferrals discharged:** 047 §12.3's card-schema row, and 030 §5.4's E04-B03 acceptance line **in its exclusion half only** — the pack-certification half stays with E04-B04 (§7 C10).
- **047 §12.3 is NOT amended, and that is deliberate.** It says the card schema is E04-B03's and gated by E19-B06; that sentence was true when it was written and is true now — a deferral discharged is a deferral kept, not a deferral to edit. History stays true (018 §4 C2, and the same append-only reasoning 023 §2 applies to bead notes).
- **Obligations handed on:** **E04-B04** — vertical codes, the manifest, pack certification, `signature_fn_ref` resolution replacing the interim registry, plus two questions the cannon added: whether a `card` shape may carry ONE manifest with a discriminator rather than one manifest per registered vertical (§11.1 F3), and whether `packRegistry.ts` collapses into the manifest loader or into `editionSignature.ts` when the maps become data (§11.1 F2). **E04-B11** — the `variant`/`parallel` conflation measurement (§8). **E05** capture recipe · **E08** condition vocabulary and `graderLabelMap` · **E02-B05** `physical_item`, which §5.5's copy facts are refused *toward* and which does not exist yet · **E19-B06** whether any of this is ever built for a shop, carrying the `identityKey` acceptance line in §8.
- **Discovered beads for the closing session to file** (no `bd` write is made from inside a record): the `identityKey` vertical-blindness gate (§8, high — a data-corruption class bug waiting on a switch flip); and `noPropertyAccessFromIndexSignature`, a repo-wide tsconfig decision §6.2 deliberately does not take.
- **006 decision-log row** dated 2026-09-04. **000-INDEX** row 049. **016** source-register row 049. **015** row unchanged until close. **tests/RTM.md** rows for rule 8 and the E04-B03 acceptance line.

## 11. The two-lens cannon (run at v1.0.1)

v1.0.0's status line claimed a "two-lens review" that had not been run: §4's lens paragraphs were the drafting builder steelmanning both sides in one voice, which is not review — it is the author pre-loading the dissent so nobody else has to raise it, and the `longbox-gate-auditor` was right to call it (B9). The cannon was convened for real before this patch: **`rich-hickey-reviewer`** and **`martin-fowler-reviewer`**, read-only agents on the record and on the shipped code at `ba8d086`, each asked to return a verdict, numbered findings by severity, and any dissent to be preserved even if overruled.

| Seat | Verdict | Findings | Most-costly-to-recover-from |
|---|---|---|---|
| `rich-hickey-reviewer` (values, identity, complecting) | **ACCEPT-WITH-CHANGES** — no REQUIRED findings; 2 RECOMMENDED, 3 OBSERVATION | H1–H5 | **H1**, `identityKey`'s vertical-blindness |
| `martin-fowler-reviewer` (evolutionary design, one-way doors, YAGNI) | **ACCEPT-WITH-CHANGES** — 1 REQUIRED (documentation), 2 RECOMMENDED, 3 OBSERVATION | F1–F6 | **F3**, the two-vertical bet |

**Amendments absorbed, all of them, none declined.** Every one is a correction to what the record CLAIMS; **no decision in §2 changed**, which is why v1.0.1 is a patch and not a minor bump.

| # | Seat, severity | What it found | Where it landed |
|---|---|---|---|
| **H1** | Hickey, OBSERVATION (its own most-costly) | `identityKey` computes `[title, issue, variant]` unconditionally — the same field-name defect this bead fixed one hop upstream, left open and filed only as "unchanged" | §8, as an **explicit acceptance line handed to E19-B06** plus a discovered bead, rather than as silence |
| **H2** | Hickey, RECOMMENDED | The required-`subject` rule was cited as the comic pack's precedent when it is a **divergence** from it — comic's `volume` is optional and tolerates the collision | §3.1 rewritten: it is a choice this pack made on cardinality grounds, not a house rule |
| **H3** | Hickey, RECOMMENDED | The two-axis `variant`/`parallel` split is proven in the CODE and untestable in the DATA until a corpus exists; real corpora conflate them | §8, as an **E04-B11 measurement acceptance line** |
| **H4** | Hickey, OBSERVATION | §5.5 named `physical_item` in the present tense; the table does not exist | §5.5, marked a forward reference with the grep that shows it |
| **H5** | Hickey, OBSERVATION | Decision A is right and pricing it on re-mint cost rather than file count is the correct move | recorded; no change |
| **F1** | Fowler, OBSERVATION | Mostly not speculative generality — the registry lift, the type narrowing and `claimIsUsable` fix defects in already-shipped code; the two-vertical split and the `printRun` line are the genuine bets | recorded; no change |
| **F2** | Fowler, RECOMMENDED | The cheaper option was never considered: the maps could have moved into `editionSignature.ts`, which already sits above `comicIdentity.ts` — zero new files instead of one | §10, as a question handed to **E04-B04** |
| **F3** | Fowler, RECOMMENDED (its own most-costly) | Decision A weighed only one direction of the one-way door | §10 → E04-B04; **dissent preserved in §11.1** |
| **F4** | Fowler, **REQUIRED** (documentation) | §6.4 claimed the six-member contract "makes the field-name branch unwritable". It does not — it stops a PACK omitting a function, not a CALLER re-deriving one inline, and that gap has no gate at all | §6.4 rewritten |
| **F5** | Fowler, OBSERVATION | The amend-by-a-row on 030 has thinner provenance than the v1.2.0 precedent it models: same builder drafted the schema and amended the record governing it, in one sitting | §5.2 now cites 030 §11's revision right and the acting head's exercise of it; the process note stands in §11.1 |
| **F6** | Fowler, OBSERVATION | §5.5's copy-fact table is written in the same declarative register as the tested claims two paragraphs above, though it is entirely ASSERTED | §5.5's forward-reference note (H4) does double duty; §7 C10 already labelled it |

### 11.1 Dissent, preserved verbatim

Both seats' most-costly findings are preserved as written, because the ruling went against one of them and only partly with the other.

> **`martin-fowler-reviewer`, F3 (the ruling stands; the dissent is recorded):** *"Two verticals is the more expensive default, and the 'one pack' case is under-argued. … every one of the six pack functions is the same function call for both. That is not incidental — it is proof that today, the two verticals are one shape with one field substituted. … The record's own rejected-alternative paragraph states the cost of merging-then-splitting but never states the cost of the reverse mistake — splitting now and discovering the two verticals never diverge, leaving E04-B04 forever assigning parallel manifests for one shape. Given 047 I1 makes an LCID un-repointable after rows exist, both mistakes are one-way doors; the record only weighed one direction."*

> **`martin-fowler-reviewer`, on this record's method (F5, and the cross-cutting note):** *"a record that argues both sides itself and then congratulates itself for having considered the alternative is exactly the pattern that produces expensive surprises three months later, because nobody outside the session pressure-tested the premise."*

> **`rich-hickey-reviewer`, H1 (adopted, and preserved because the fix is deferred rather than made):** *"A record whose whole announced virtue is 'we go looking for the comic question hiding in field names' should not leave a second, known instance of exactly that question sitting one call away from E19-B06's switch, filed as 'unchanged' rather than 'unchanged and dangerous.'"*

**Ruling on F3 (acting head).** The decision stands, and the dissent is right that only one direction was priced. Both directions are now on the record: **splitting now and never diverging** costs E04-B04 two near-identical manifest rows and two vertical codes — recoverable, because merging two verticals whose rows are identical in shape is a manifest edit, and no LCID has to move (the codes simply both remain valid names for one pack). **Merging now and diverging later** costs a retire-and-re-mint of every card LCID, and every identifier already handed out resolves RETIRED forever (§4). The asymmetry is the reason, and it is the reason whether or not the two packs ever diverge — **an unequal pair of one-way doors is chosen by its worse side, not by its likelier one.** F3's real force is that this was asserted rather than argued in v1.0.0; it is argued now.

**Ruling on F5 (acting head).** Adopted as a process note: for future amend-by-a-row events on higher-stakes ratified records, the counter-argument comes from a separate reviewing agent BEFORE ratification, not from the drafting builder performing both sides. It is applied retroactively here — this section exists because the gate audit refused v1.0.0's claim.

**Ruling on H1 (acting head).** Adopted, and deliberately NOT fixed in this bead. Making `identityKey` vertical-aware is a 019 measurement change: `019:57` makes T1's field exclusion non-editable without a 006 row, and 047 A8's paired-edit gate exists so that a builder cannot edit it beside a catalog field list on its own signature. The right disposition for a hazard that is real, dormant, and outside this bead's authority is a **named gate on the bead that would arm it**, which is what §8 now carries.
