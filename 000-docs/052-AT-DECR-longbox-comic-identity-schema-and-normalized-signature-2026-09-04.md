# Decision Record — The Versioned Comic Identity Schema and its Normalized Signature

**Version:** 1.0.1
**Status:** **DRAFT.** The `longbox-gate-auditor` report on `d217225` returned **NOT-READY with no decision wrong** — two blocking evidence defects and seven smaller repairs, all applied at v1.0.1 (see the change log) and **none reversing a ruling**. The NOT-READY verdict stands until the audit is re-run, so nothing here may be cited as settled yet. It is a **record of decisions already taken and already merged** (E04-B02, PR #69, squash-merged `f6adbc4`), lifted here out of a `000-docs/006` row and a PR body so that they live where a decision lives.
**Bead:** E04-D03 `longbox-e5b.4.15` (epic LBOX-E04 `longbox-e5b.4`, gate **G2**, layer catalog) — the record for **E04-B02** `longbox-e5b.4.2` (*"Define the versioned comic identity schema and normalized signature"*, CLOSED 2026-09-04), 014 §8 row E04-B02 (`014:413`).
**Drafted:** 2026-09-04 by `longbox-domain-builder` · **Audit:** `longbox-gate-auditor` before close · **Decision owner:** Jeremy Longshore (acting head of board under the 2026-09-03 delegation)
**Sensitivity:** Restricted internal (014 §10). It names no shop, no person and no credential, and its sibling record 049 is classified Internal on that ground — this one is filed a class higher because §5 and §6 turn on **why a 019 T1/T3 measurement rule is non-editable**, and the 019 rows that rule cites are themselves Restricted internal.
**Supersedes:** nothing. It **discharges 047 §12.3's first deferral** — *"The comic identity schema and its signature function. E04-B02 (`014:413`). §9.3 gives it the seed and the field-list ruling and stops. **A8 acceptance line:** a static guard asserts that `identityKey` and `edition_signature` share no field-list constant and that a PR touching both without a 006 row fails"* (`047:492`) — **in both halves**: the schema is shipped (§3) and the guard is shipped in both of its own halves (§6).
**Inputs:** 014 §3.4 and §8 row E04-B02 · 015 alias map · **030 v1.2.1 §3.3, §4 rule 2, §5.1–§5.3, §6 rule 3, §7** · **047 v1.1.2 §2.3, §9.1–§9.3, §12.3, A1, A6, A8** · 041 §2.1, §4.1 · 042 §5.3 · 044 §6, §8 · 036 · 037 · **019 T1, T3, T7** (`019:57`, `019:59`) · 022 P1 · 018 §2 A1/A3 · 023 §3, §5 · **049 v1.0.1** (the sibling record that later moved this bead's code) · `src/catalog/*`, `src/services/{identityResolution,confirmationOutcome}.ts`, `scripts/architectureRules.ts`, `.dependency-cruiser.cjs` · CLAUDE.md locked decisions 4, 5, 6 · **PR #69** (`b8fa4d8` → `480cb72`, merged `f6adbc4`) and its `longbox-invariant-reviewer` verdict.

## Change log

**Version convention** (006 `:6`): a **minor** bump means the content of a decision changed; a **patch** means a statement of fact was repaired with no decision changing.

| Version | Date | What changed | Authority |
|---|---|---|---|
| 1.0.0 | 2026-09-04 | Initial record. Five decisions lifted out of the 006 row of the same date and PR #69's body: **the signature is written by a SERVICE, not a trigger** (§5.1); **unknown is distinct from absent in `attributes` and deliberately collapsed in the signature** (§5.2); **the signature spans BOTH schemas, and the edition READS its parent rather than copying `series`** (§5.3); **catalog supersession is an UNMADE decision, not an omission** (§5.4); and **every per-pack function is REGISTERED, never called by name** (§5.5). The A8 guard is §6, **thirteen** invariants are §7 (twelve TESTED plus I13, which is ASSERTED by absence), and §8 records what E04-B03 moved afterwards. | `longbox-domain-builder` (E04-D03) |
| **1.0.1** | **2026-09-04** | **Patch — statements of fact repaired; NO decision changed.** From the `longbox-gate-auditor` report on `d217225` (NOT-READY, no decision wrong). **Two blocking evidence defects.** §1 E11 and §5.4 both rested on `/usr/bin/grep -rn 'supersedes_id' src/catalog/` returning *"no match"*; it returns **three** lines at every tree, and the record now states the real claim — three occurrences, **none of them a write**: two comments and one as-of READ predicate that excludes superseded crosswalk edges — beside the gate rule that carries the actual burden. And §5.2's *"confirmed before the catalog existed / confirmed after, but resolution failed"* was cited to `004:43-48`; it is **`030:411`**, §7.1's *"Why a fact table beats a reserved column"*. **Seven smaller repairs:** §5.5 said *"six per-pack functions"* and then named seven things (**seven registry slots: six functions plus the schema pair**); the change-log said twelve invariants where §7 has thirteen; §0 now attributes PR #69's suite line the way the PR's own table does (*on `5ff6ea2`*); §0's REPRODUCED anchor says *"at `4c1de7f`, re-checked at `bb69522`"* rather than calling `4c1de7f` `origin/main`, which it was not at draft time; **047 I10's data-level burden is re-routed** — E02-B05 `longbox-e5b.2.5` is a CLOSED decision bead that DECIDED `physical_item`, and the BUILD is **E10-B03** `longbox-e5b.10.3`; §11's account of 016 §4 is restated from the register's own line (*merged list stops at #9*, and nothing of #63–#76 appears in it); and §0 records a **foreseeable rebase debt** against PR #73. **Optional finding adopted:** §6 no longer paraphrases `019:57` as making a field list non-editable — the literal clause governs the one-tap-without-truth-label exclusion — and says instead that `identityKey` implements T1's comparison and T3's numerator, so `019:57`/`:59` govern it. | `longbox-gate-auditor` → `longbox-domain-builder` (E04-D03) |

## 0. Evidence posture

Per 018 §2 A1/A3.

- **Every claim about what the repository does today is REPRODUCED at `4c1de7f`, re-checked at `bb69522` and again at `a803867`** — `4c1de7f` was the branch's cut point and not `origin/main` at draft time, and saying so is the difference between an anchor and a claim about somebody else's branch. Each carries a `file:line` or the command that produced it. Every command was run with `/usr/bin/grep`, never the `rg` alias (046 E26).
- **This record is written AFTER its own bead merged, and the distinction matters on every page.** E04-B02 merged as `f6adbc4` (PR #69, head `480cb72`, base `5ff6ea2`). Three commits have since touched the files it created — `2fd9276` (E03-B07, media), `b9db2cb` (E04-B03, cards), `7296e7c` (E03-D09, identity substrate). So a `file:line` in §3–§6 is the code **as it stands now**, and where a later bead moved something, the row says where it went and cites 049 by §. **The decisions in §5 are stated as they were TAKEN at E04-B02**, sourced to the PR body and the 006 row, and never restated as though the current tree had always had this shape.
- **The branch was rebased onto `a803867` before landing, and NO §1 cite moved.** Checked rather than assumed, and checked twice. Against the first rebase base, `git diff --stat 4c1de7f bb69522 -- src scripts tests migrations 000-docs` returns **one line**, `000-docs/015` gaining a single discovered-bead row. Against the second, the same command over `4c1de7f a803867 -- src scripts tests migrations` returns **37 files changed** (E03-B05's code half, PR #74) — so the blunt check is not enough, and the sharp one was run instead: restricted to **every file this record cites** — `src/catalog`, `src/services/{identityResolution,confirmationOutcome}.ts`, `scripts/architectureRules.ts`, `.dependency-cruiser.cjs` and the six test files — it returns **empty**. Not one `file:line` below moved, and every §0 count was taken from a file PR #74 did not touch. This is the check 048 v1.1.0 learned to run the hard way, when a merge landed under a record between its draft and its ratification and stranded three cites; the lesson this rebase adds is that **a repository-wide diff answers the wrong question** — thirty-seven changed files would have read as danger and one changed file as safety, when what matters is only whether any of them is a file the record points at.
- **What is TESTED and what is ASSERTED.** Everything in §3, §4, §5.1–§5.3, §5.5 and §6 is tested; §7 names the test per invariant. **§5.4 is the exception and is ASSERTED by absence** — the claim is that no catalog `INSERT` or `UPDATE` names `supersedes_id`, which is carried by 040 §8.2's writer inventory (architecture-gate rule 6) rather than by a positive test of behaviour that does not exist. ⚠ **It is NOT carried by an empty grep**, and v1.0.0 said it was: the grep returns three lines, all of them reads or comments (§1 E11, §5.4).
- **Test counts, stated as the command that produces them** (018 §2: a count with no name is not a measurement). `/usr/bin/grep -c '^\s*it(' tests/comic-identity.test.ts` → **21**; `… tests/edition-signature.test.ts` → **10**; `… tests/identity-resolution.test.ts` → **15**; `/usr/bin/grep -c 'expect(' tests/comic-identity.test.ts` → **36**. Integration: `/usr/bin/grep -c '^\s*it(' tests/integration/catalog-edition-write.test.ts` → **12**; `… tests/integration/identity-resolution.test.ts` → **8**. The A8 gate fixtures: `/usr/bin/sed -n '493,628p' tests/contract/architecture-gate.test.ts | /usr/bin/grep -c '^\s*it('` → **13**, and `/usr/bin/sed -n '690,720p' … ` → **5**.
- **The gate numbers PR #69 reported are not restated here as current.** *"796 passed, 57 files"* is annotated **(on `5ff6ea2`)** in PR #69's own verification table — the base the count was taken against, not the head — and *"93.10% lines"* was measured on `480cb72`. Four merges have landed since. The suite counts above are per-file `grep` counts of the shipped tests, which do not go stale the same way.
- **No number in this record is a measurement, and no percentage appears that is not a quoted threshold** (021 `:62`). There is no accuracy figure here: a schema does not have one.
- **A foreseeable rebase debt, recorded so the next touch pays it.** E04-B04's PR #73 has not merged. When it does, `scripts/architectureRules.ts` shifts — `:682` → `:690`, `:708` → `:716`, `:715` → `:723` — and A8's catalog subject SET grows `comicManifest.ts` and `cardManifests.ts`, so §6's list and §8's `CATALOG_IDENTITY_FILES` row both gain two members. Nothing here is wrong today; it will be wrong the day #73 lands, and a record that names the shift is cheaper to repair than one whose cites quietly stop resolving.
- **Doc number.** 052 is the next free number **on `main`** — `000-docs/` ends at 050 at `4c1de7f`. **051 is claimed but not yet on main**: `git ls-tree -r --name-only origin/feat/e04-b04-pack-manifest -- 000-docs` shows `051-AT-DECR-longbox-vertical-pack-manifest-certification-and-registration-2026-09-04.md` on E04-B04's branch. Taking 052 rather than 051 is therefore deliberate, and this paragraph is the reason a reader will want when 051 lands after 052.

## 1. What exists today (REPRODUCED at `4c1de7f`)

| # | Claim | Evidence |
|---|---|---|
| E1 | **The comic pack is two Zod schemas on 030 §5.3's split**, `.strict()` at both levels: definition `{series, publisher, volume, year}`, edition `{issue, variant, printing, cover, coverDate, distribution}`. | `src/catalog/comicIdentity.ts:116`, `:127` |
| E2 | **`COMIC_IDENTITY_SCHEMA_VERSION = 1` is a third version number**, distinct from `NORMALIZATION_VERSION` and from `vertical_pack_version.pack_version`. | `src/catalog/comicIdentity.ts:95`; `src/catalog/editionSignature.ts:69` |
| E3 | **Optional fields are `.nullable().optional()` and never `.default()`**, which is the mechanism that keeps an absent key absent through the schema. | `src/catalog/comicIdentity.ts:113` |
| E4 | **A blank string is refused, not signed as an empty field.** `required` refuses a value whose `trim()` is empty with the message *"must not be blank — omit the key, or state null"*. | `src/catalog/comicIdentity.ts:102-104` |
| E5 | **The signature normalisation collapses missing, null, empty and whitespace-only into one claim**, and strips a leading `#` from an issue number. | `src/catalog/editionSignature.ts:83`, `:89` |
| E6 | **The comic edition signature is 030 §3.3's ratified four** — `series + issue + variant + printing` — joined by ASCII unit separator `\u001f`. | `src/catalog/editionSignature.ts:75`, `:124-131` |
| E7 | **The work has its own signature function**, `series + volume`, and it is not the edition function called with different arguments. | `src/catalog/comicIdentity.ts:227-232` |
| E8 | **The signature's input is composed ACROSS the two levels**: `series` is read from the definition's attributes, the other three from the edition's. | `src/catalog/comicIdentity.ts:251-261` |
| E9 | **Copy facts and provider-named keys are refused BY NAME, with their own error classes**, before any pack schema sees the payload. | `src/catalog/copyFacts.ts:38`, `:53`, `:61`, `:76`, `:93` |
| E10 | **The write path is `insertDefinition`/`insertEdition` in a service**, and there is no signature trigger anywhere: the `edition_signature` rows are written by an `INSERT` the service issues. | `src/catalog/editionWrite.ts:151`, `:206`, `:268` |
| E11 | **No catalog file WRITES `supersedes_id`.** `/usr/bin/grep -rn 'supersedes_id' src/catalog/` returns **three** lines, and the claim is about what they are, not that there are none: two are comments (`editionWrite.ts:57`, `dedupe.ts:180`) and one is an as-of **READ** predicate excluding superseded crosswalk edges (`dedupe.ts:195`). **No `INSERT` or `UPDATE` in the module names the column**, which is the property, and 040 §8.2's writer inventory (architecture-gate rule 6) is what enforces it. | `src/catalog/editionWrite.ts:57`; `src/catalog/dedupe.ts:180`, `:195`; the grep above |
| E12 | **030 I7 is asserted at the data level** — an edition whose `vertical` disagrees with its definition's is refused with a named error, and the parent read that proves it is the same read that supplies `series`. | `src/catalog/editionWrite.ts:71`, `:195` |
| E13 | **Every per-pack function is resolved through the registry and fails closed**; `packFor` raises `UnregisteredVerticalError` rather than defaulting to `"comic"`. | `src/catalog/packRegistry.ts:174-178`; `src/catalog/editionSignature.ts:134` |
| E14 | **The resolution ladder is barcode → signature, stops at the first rung that speaks (including "ambiguous"), and stores the LCID as stated.** | `src/services/identityResolution.ts:139`, `:203-216` |
| E15 | **A8's guard exists in three places**: a dependency-cruiser edge rule, a static rule over a file set, and a changed-files rule that demands a 006 row. | `.dependency-cruiser.cjs:316`; `scripts/architectureRules.ts:505`, `:555`, `:715` |
| E16 | **`identityKey` is unchanged and still excludes publisher and year**, with the reason in its own doc comment. | `src/services/confirmationOutcome.ts:44-49`, `:56` |

**What §1 adds up to.** The schema, the signature, the write path, the resolution write and the guard are all shipped and all tested. What was NOT shipped by this bead — and what §11 keeps open — is a corpus with anything in it: the tables `016`/`017` created still ship empty until an importer writes to them.

## 2. What this record decides

Five decisions, all taken at E04-B02 and all merged. Each is §5's own subsection with the alternative that was rejected.

1. **The signature is computed by a SERVICE, never by a database trigger.** §5.1
2. **`attributes` preserves unknown as distinct from absent, and the signature deliberately collapses them.** §5.2
3. **The signature spans both schemas, and the edition READS its parent's `series` rather than copying it.** §5.3
4. **Catalog supersession is an unmade decision, not an omission; this path writes new rows only.** §5.4
5. **Every per-pack function is REGISTERED and fails closed; none is called by name.** §5.5

And one obligation discharged: **047 A8's static guard**, in both halves. §6.

## 3. The schema (versioned)

`COMIC_IDENTITY_SCHEMA_VERSION = 1` (`comicIdentity.ts:95`). Three version numbers exist and each answers a different question: this one answers *"what shape was this `attributes` payload written against"*; `NORMALIZATION_VERSION` (`editionSignature.ts:69`) answers *"which normalisation produced this exact signature text"*; `vertical_pack_version.pack_version` versions the whole manifest single-rate (030 A5). It is a constant and not a column, because under 030 A3 a column nothing reads is speculative generality and the pack version on every `edition` row already dates the payload.

### 3.1 The WORK — `collectible_definition.attributes` (030 §5.3)

| Field | Rule | Why | Test |
|---|---|---|---|
| `series` | **required**, non-blank after trim | It is the only definition-level field in the signature (§4); a blank one would sign an empty position | `tests/comic-identity.test.ts:172` |
| `publisher` | stated (`nullable().optional()`) | Deliberately **outside both signatures** — two corpora attributing a series differently must still dedupe (§4.2) | `tests/comic-identity.test.ts:215` |
| `volume` | stated | In the WORK's signature, not the edition's | `tests/comic-identity.test.ts:209` |
| `year` | stated, **text and not a number** | `"1963"`, `"1963-1998"` and `"unknown printing year"` are all statements a corpus makes; a numeric column would refuse two of the three | `comicIdentity.ts:121` |

### 3.2 The PRINTING — `edition.attributes` (030 §5.3 + 014 §8's E04-B02 row)

| Field | Rule | In the signature? | Test |
|---|---|---|---|
| `issue` | **required**, non-blank | **yes** — normalised by `normalizeIssue`, so a leading `#` is decoration | `tests/comic-identity.test.ts:172`, `tests/edition-signature.test.ts:26` |
| `variant` | stated | **yes** | `tests/edition-signature.test.ts:16` |
| `printing` | stated — the barcode's fifth supplement digit finally has somewhere to land (030 E10, §7) | **yes** | same |
| `cover` | stated — the barcode's fourth supplement digit | no | `tests/comic-identity.test.ts:163` |
| `coverDate` | stated, text | no | `comicIdentity.ts:135` |
| `distribution` | `enum(["direct","newsstand"]).nullable().optional()` | **no, and this is a ruling** | `tests/comic-identity.test.ts:144`, `:159` |

**Why `distribution` and `coverDate` are attributes and not identity.** 014 §8's E04-B02 row names direct-vs-newsstand explicitly, which reads like an instruction to put it in the key. It is not: **030 §3.3's ratified comic signature is `series + issue + variant + printing`, and adding a fifth field to a ratified signature is an amendment to a ratified record, not a builder's convenience.** They are in the schema because a listing renders them and a contradiction rule (E06-B05) will read them.

### 3.3 What an edition may never carry, in any vertical

`assertNoForbiddenKeys` (`copyFacts.ts:93`) runs **before** the pack schema, so the foreseeable mistakes get a sentence that explains them rather than `.strict()`'s *"unrecognized key 'grader'"*.

- **Copy facts** — `grader`, `certnumber`, `cert`, `certification`, `slab`, `grade`, `gradelabel`, `graderlabel`, `condition`, `serialnumber`, `serial` (`copyFacts.ts:38`), compared after lowercasing and stripping `_`/`-`. 047 §2.3/A6: a slabbed book is the **same edition** as a raw one, and a grader's label is *"a number wearing a name"* that locked decision 5 and 019 T7 forbid anywhere near identity.
- **Provider-named keys** — `^(gcd|metron|pricecharting|ebay|covrprice|comicvine|tcgplayer|psa|bgs|cgc|sgc)_?id$` (`copyFacts.ts:53`), per 030 §4 rule 2, *"including in `attributes`, where a `gcd_id` key would smuggle the same coupling past the DDL"*.
- Anything else unknown gets `.strict()`'s ordinary refusal, which is correct: the named list exists for the foreseeable mistakes, not for every possible one.

Tested at `tests/comic-identity.test.ts:178`, `:197`.

## 4. The signature, composed

### 4.1 Two functions, two field lists, one normalisation

| | `comicDefinitionSignature` | `comicEditionSignature` |
|---|---|---|
| Fields | `series + volume` | `series + issue + variant + printing` (030 §3.3) |
| Home | `comicIdentity.ts:227` | `editionSignature.ts:124` |
| Column | `collectible_definition.signature` | one `edition_signature` row per signature |
| Test | `tests/comic-identity.test.ts:209` | `tests/edition-signature.test.ts:16` |

**The work-level function is separate on purpose.** The column is `NOT NULL` and something has to fill it, and the tempting move — reuse the edition function with `volume` where `issue` goes — would write a string whose four positions mean something other than what the function's name and its `normalization_version` say they mean. **The NORMALISATION is reused, which is exactly what 047 §9.3 says to reuse; the FIELD LIST is each level's own, which is what §9.3 says not to share.**

### 4.2 The normalisation rule, per rule and per test

| Rule | Where | Test |
|---|---|---|
| Trim, collapse internal whitespace, casefold | `editionSignature.ts:85` | `tests/edition-signature.test.ts:26` |
| A leading `#` on an issue is decoration, not data | `editionSignature.ts:90` | same, and `tests/comic-identity.test.ts:23`'s table |
| Missing, null, empty and whitespace-only are ONE claim | `editionSignature.ts:84-85` | `tests/edition-signature.test.ts:42` |
| Fields join with `\u001f`, which no normalised field can contain, so `a\|b` and `a` + `\|b` cannot collide | `editionSignature.ts:75` | `tests/edition-signature.test.ts:48` |
| Deterministic — the same fields yield the same string forever | — | `tests/edition-signature.test.ts:56` |
| An unregistered vertical is refused, never defaulted to `comic` | `packRegistry.ts:174` | `tests/edition-signature.test.ts:62`, `tests/comic-identity.test.ts:266`, `:295` |
| The rule is versioned, so a change is a NEW row in a new corpus version and never a rewrite | `editionSignature.ts:69` | `tests/edition-signature.test.ts:76` |
| **Publisher is absent from both signatures** | §3.1 | `tests/comic-identity.test.ts:215` |

**A signature is not an identity** (030 §3.3). Two rows with the same signature are a **dedupe candidate** — a human-queue item — and never an automatic merge, which is why `edition_signature` carries **no UNIQUE constraint** (047 A1/I17) and why the repair for a duplicate is an `lcid_merge` fact somebody decided. `dedupe.ts` is total over `matched | no_match | ambiguous` (`dedupe.ts:127`, `:143`).

## 5. The five decisions

### 5.1 The signature is written by a SERVICE, not a database trigger

**Decision.** `insertEdition` computes the signature in TypeScript and writes the `edition_signature` rows itself (`editionWrite.ts:206`, `:268`). No trigger computes a signature anywhere.

**Alternative considered and rejected: a `BEFORE INSERT` trigger on `edition`.** It is the obvious move in a repository whose Hickey model is already enforced by database triggers, and it fails on three counts.

1. **It needs a second copy of the normalisation, in PL/pgSQL, while `normalization_version` versions exactly ONE rule.** The first divergence between the two copies stamps version-1 rows that version 1 would not produce — and under append-only rules those rows cannot be repaired, only superseded by a new corpus version that also cannot say which of the old rows were wrong.
2. **It cannot resolve a per-pack function registered as data.** 030 §5.2 makes the signature function a manifest slot (`signature_fn_ref`); a trigger would have to hard-code the comic rule or reimplement pack resolution in SQL.
3. **It forecloses 030 A4's multi-signature aliases.** One edition may carry more than one `edition_signature` row; a `BEFORE INSERT` trigger on the parent computes exactly one.

**What the database keeps is what a database is good at:** the append-only trigger, the foreign keys, and the deliberate **absence** of a UNIQUE on the signature.

### 5.2 Unknown is distinct from absent in `attributes`, and deliberately collapsed in the signature

**Decision.** The bead's own note is one line — *"Preserve unknown vs absent"* — and it is the sharpest requirement in the bead.

- **key ABSENT** — no statement was made. The source record had no such field; nobody asked; the importer's row stopped short.
- **key `= null`** — a statement was made and its content is *"not known"* or *"does not apply"*. A corpus row carrying an empty `variant` cell is asserting there is no variant designator, and that is a fact.

Both survive into `attributes` jsonb verbatim, because the fields are `.nullable().optional()` and **never `.default()`** (`comicIdentity.ts:113`) — Zod omits an absent optional key rather than materialising `undefined`. Asserted rather than assumed, including across the JSON round-trip the jsonb column performs: `tests/comic-identity.test.ts:108`, `:114`, `:120`.

**And the signature collapses them** (`editionSignature.ts:84`, tested at `tests/comic-identity.test.ts:134`). That is not a contradiction, it is a division of labour: **a dedupe key must not distinguish two records that describe the same book with different degrees of silence**, or the same edition imported from two sources fails to dedupe. The distinction is preserved where a reader can act on it and dropped where acting on it would be wrong.

**Alternative considered and rejected: one representation for both** — either normalising `null` to absent on the way in, or defaulting absent to `null`. 030 already recorded what happens when one NULL carries two meanings — `030:411`, §7.1's *"Why a fact table beats a reserved column"*: *"The column had two indistinguishable NULLs: 'confirmed before the catalog existed' and 'confirmed after, but resolution failed or was skipped'. Nothing in the schema could tell them apart, and no later work could fix it, because the row cannot be updated"*, and the cost of the second meaning is paid years later by a reader who cannot tell which they are looking at.

### 5.3 The signature spans BOTH schemas, and the edition READS its parent

**Decision.** `comicSignatureInput` composes the four fields across the two levels (`comicIdentity.ts:251`), and `insertEdition` reads the parent definition to obtain `series` (`editionWrite.ts:195`).

**Why it has to be composed at all.** 030 §3.3's ratified signature needs `series`, and §5.3 puts `series` on the **definition**. So an edition's signature is not computable from the edition's own attributes.

**Alternative considered and rejected: copy `series` onto the edition.** One column, no join, no read at write time. It fails on append-only grounds: a definition whose series name is later corrected leaves every edition carrying the old one, **with no way to distinguish a stale copy from a deliberate alias** — and the edition rows cannot be repaired in place. The read costs one query at write time; the copy costs a permanent ambiguity. The read is also required anyway, because it is the same read that asserts 030 I7 across every one of the parent's rows (`editionWrite.ts:38`, `:71`).

### 5.4 Catalog supersession is an UNMADE decision, not an omission

**Decision.** Nothing in `src/catalog/` writes `supersedes_id`. This path writes **new rows only**.

**How the decision was forced.** The first draft of `editionWrite.ts` did write `supersedes_id`, and the architecture gate's **rule 6** (the writer inventory, 040 §8.2) caught the second writer. The available fix was an exemption row, and it would have been the wrong one: `supersede()` scope-checks a **shop** and a **session** and assigns a `session_seq` under the anchor lock, and **a catalog row has none of the three** — no `shop_id` (the catalog is deliberately not shop-scoped), no session, and nothing to order against.

So the honest disposition is that **whether a catalog row ever needs a supersession chain has not been decided**, and it is filed rather than assumed: **E04-B11** `longbox-e5b.4.11` (*"Implement versioned ingest, delta cursor/ETag, dedupe, merge/conflict, drift and coverage reporting"*), noted in `editionWrite.ts:57`.

⚠ **This is the one claim in this record that is ASSERTED by absence** (§0), and the grep that supports it does NOT return nothing. `/usr/bin/grep -rn 'supersedes_id' src/catalog/` returns **three** lines at every tree: `editionWrite.ts:57` and `dedupe.ts:180` are comments, and `dedupe.ts:195` is an as-of **READ** predicate — `AND NOT EXISTS (SELECT 1 FROM edition_external_id later WHERE later.supersedes_id = x.id)` — which excludes a crosswalk edge the catalog has already withdrawn. The property is therefore **no `INSERT` and no `UPDATE` in `src/catalog/` names the column**, and the burden is carried by 040 §8.2's writer inventory (architecture-gate rule 6), not by a grep count. There is no positive test of behaviour that does not exist.

### 5.5 Every per-pack function is REGISTERED, never called by name

**Decision.** **Seven registry slots — six functions plus the schema pair.** `parseAttributes`, `definitionSignature`, `signatureInput`, `signatureClaim`, `editionSignature` and (from E04-B03) `claimIsUsable` are the six; `schemas` is the seventh slot and holds a pair of Zod objects rather than a function, which is why *"six functions"* and *"seven members"* are both true of `VerticalPack` and neither is a safe shorthand on its own. All seven are dispatched through a registry that fails closed on an unregistered vertical (`packRegistry.ts:89`, `:174`).

**This decision was NOT in the first draft, and the way it was found is the reason it is written down.** The `longbox-invariant-reviewer` of `b8fa4d8` returned **PASS-WITH-NOTES**, and its first WARN, quoted from the bead record:

> *"editionWrite hard-codes the comic composers (a second pack would be comic-signed — per-pack map fail-closed); the paired-edit subject set misses comicIdentity.ts."*

The shape it found: the signature **function** was resolved through a map that failed closed, while the comic **definition-signature function** and the comic **field composer** beside it were called directly for every vertical. That is the `if comic` branch 014 §3.4 forbids, hidden inside a helper — **and worse than the plain branch, because the composer runs BEFORE the fail-closed function**, so a second vertical would have had the comic field list applied to it and only then met a refusal, or not met one at all.

**Alternative considered and rejected: register only the signature function and leave the composers as helpers.** It is what the first draft did. It is unsafe for exactly the reason above, and E04-B03 later hardened the consequence into a contract: a pack supplying five of six functions must not be **writable** (049 §6.3).

Tested at `tests/comic-identity.test.ts:266`, `:281`, `:295` — all registry entry points refuse an unregistered vertical, and the comic path is asserted to route to exactly the functions it routed to before.

## 6. 047 A8's static guard, in both halves

A8's acceptance line (`047:492`) has two clauses, and each closes a different way for the two functions to drift into one.

**The MECHANICAL half — no shared field-list constant and no import edge.**

- `.dependency-cruiser.cjs:316` (`identity-key-and-edition-signature-stay-apart`, severity `error`): `src/services/confirmationOutcome.ts` may not import `^src/catalog/`.
- `scripts/architectureRules.ts:505` rule 7 asserts that `IDENTITY_KEY_FILE` (`:537`) and every member of `CATALOG_IDENTITY_FILES` (`:555`) share **no import** in either direction and that **neither exports a field-list-shaped constant** (`/export\s+(?:const|let|var)\s+\w*(?:FIELDS|FIELD_LIST)\b/`, `:682`).
- It **fails loudly when a subject file is missing** rather than passing vacuously (`tests/contract/architecture-gate.test.ts:546`) — the failure mode a rename would otherwise produce.

**The HUMAN half — a PR editing both sides without a 006 row FAILS.** `checkIdentityPairEdit` (`architectureRules.ts:715`) is pure over a changed-file list, so it has negative fixtures like every other rule, and the gate feeds it `git diff --name-only` against the merge base. It **does not ask what the 006 row says** (`:708`): a gate that tried would be reading prose and guessing. What it can prove is that the author was made to write one, in the same PR, where a reviewer sees it beside the diff — which is the property `019:57`'s non-editability rule actually needs.

**Two corrections the invariant review forced, both material.**

1. **The catalog subject is a SET, not one file.** A8 names `edition_signature` as a *function*, and the first rule read that as one file. But the four-field list also lives in `comicIdentity.ts` — in `comicSignatureInput` (`:251`) and `comicSignatureClaim` (`:200`) — so a diff editing `comicSignatureClaim` beside `identityKey` is the **same paired edit**, and a rule watching only `editionSignature.ts` would have passed it. Imports **inside** the set do not count: `comicIdentity.ts` importing `editionSignature.ts` is the pack reusing its own normalisation, which 047 §9.3 says to reuse (`tests/contract/architecture-gate.test.ts:576`).
2. **The paired-edit half runs on PUSH TO `main` as well as on a PR.** The first version's comment claimed a push has no diff to ask the question of; that is false — a push carries `github.event.before` — and **`main` takes direct paperwork commits and an owner bypass (`enforce_admins` off)**, so a PR-only rule would have shipped with a documented way around it. The all-zeros `before` of a first push or a history rewrite is guarded and skips loudly.

**One real false positive was found by the rule itself and closed by narrowing rather than exempting.** The widened rule fired on `COPY_FACT_KEYS` — a **denylist** of attribute names an edition may never carry, the opposite of an identity field list. The pattern was narrowed to `FIELDS`/`FIELD_LIST` instead of adding an exemption row, because an exemption would have switched the whole file off, and nothing is lost: a denylist cannot become a shared field list without being renamed, and the shared-import check still covers it. A fixture pins that it no longer fires (`tests/contract/architecture-gate.test.ts:587`).

**Why any of this guards two functions that both compile fine.** `identityKey` answers *"did this operator ACCEPT or CORRECT what was on the screen"* over two payloads within one session, using `title + issue + variant` and **deliberately excluding publisher and year** — *"including them would score a plain acceptance as a correction and inflate T3"* (`confirmationOutcome.ts:44-49`). `edition_signature` answers *"which edition is this, in the whole corpus"* using `series + issue + variant + printing`. Two questions, two owners, two versioning schemes. **`019:57`'s literal non-editability clause governs T1's one-tap-without-a-truth-label exclusion, not this field list** — the honest statement is that `identityKey` implements T1's issue-and-variant comparison and supplies T3's numerator, so `019:57` and `019:59` govern it. Merging the two functions is therefore not a refactor a builder may perform, in either direction — and 047 §9.3's own warning is that *"two functions with two names drift into one the first time a builder notices they look alike, and the drift is silent because both still compile."*

## 7. Invariants

| # | Invariant | Status | Where |
|---|---|---|---|
| **I1** | An absent key stays absent and an explicit `null` stays a stated null, through the schema and through the jsonb round-trip. | **TESTED** | `tests/comic-identity.test.ts:108`, `:114`, `:120` |
| **I2** | The signature collapses missing, null, empty and whitespace-only into one claim. | **TESTED** | `tests/edition-signature.test.ts:42`; `tests/comic-identity.test.ts:134` |
| **I3** | The comic edition signature is exactly 030 §3.3's four fields, in order, and no fifth field enters it. | **TESTED** | `tests/comic-identity.test.ts:100`; `tests/edition-signature.test.ts:16` |
| **I4** | The work-level signature is its own function over `series + volume` and ignores the publisher. | **TESTED** | `tests/comic-identity.test.ts:209`, `:215` |
| **I5** | A blank `series` or `issue` is refused rather than signed as an empty field. | **TESTED** | `tests/comic-identity.test.ts:172` |
| **I6** | A copy fact or a provider-named key is refused by name, before the database, with its own error class. | **TESTED** | `tests/comic-identity.test.ts:178`, `:197` |
| **I7** | An unregistered vertical is refused at **every** registry entry point and never defaulted to `comic`. | **TESTED** | `tests/comic-identity.test.ts:266`, `:295`; `tests/edition-signature.test.ts:62` |
| **I8** | An edition's `vertical` disagreeing with its definition's is refused (030 I7), checked across **every** definition row. | **TESTED** (integration) | `tests/integration/catalog-edition-write.test.ts` |
| **I9** | Two editions with the same signature both commit and surface as **one dedupe candidate**; nothing merges (030 §3.3, 047 A1). | **TESTED** (integration) | same file |
| **I10** | The resolution ladder stops at the first rung that speaks, including when what it says is *ambiguous*, and writes no row on an ambiguous rung. | **TESTED** | `tests/identity-resolution.test.ts:96`, `:121` |
| **I11** | The LCID is stored **as stated**; nothing on the confirm path resolves forward (047 §9.2, I9), and no confidence is ever written — both rungs are deterministic (019 T7, 022 P1). | **TESTED** | `tests/identity-resolution.test.ts:199`, `:206` |
| **I12** | `identityKey` and the catalog identity files share no import edge and no field-list constant, and a diff editing both sides without a 006 row fails — on a PR **and** on a push to `main`. | **TESTED** (real tree + fixtures, both directions) | `tests/contract/architecture-gate.test.ts:493`ff, `:690`ff |
| **I13** | No `INSERT` and no `UPDATE` under `src/catalog/` names `supersedes_id`. The column appears three times in the module — twice in comments, once in an as-of READ predicate — and never in a write. | **ASSERTED by absence** — carried by 040 §8.2's writer inventory (architecture-gate rule 6), NOT by an empty grep; see §1 E11 and §5.4 | `src/catalog/editionWrite.ts:57`; `src/catalog/dedupe.ts:180`, `:195` |

## 8. What later beads changed, and what they did not

E04-B02's code did not stay where it was put. Two later beads moved parts of it, and both moves are **relocations, not reversals** — every decision in §5 stands where it was taken.

| What moved | Where it went | Why | Record |
|---|---|---|---|
| The six per-pack maps and their dispatchers | `src/catalog/comicIdentity.ts` → `src/catalog/packRegistry.ts` | Registering a second pack in the old layout is a two-module **cycle** (`cardIdentity.ts` reads the normalisation from `editionSignature.ts`), and `no-circular` is an ERROR. **A registry of packs is not a member of any pack.** | **049 §6.1** |
| `COPY_FACT_KEYS`, both error classes, `assertNoForbiddenKeys` | `comicIdentity.ts` → `src/catalog/copyFacts.ts` | 047 A6 rules copy facts universal — *"not a pack decision at all: it is the same rule restated"* — and a card pack importing the comic pack to learn it would make a universal invariant look like a comic convention. | **049 §5.5** |
| `SignatureFields` naming comic's four fields beside its index signature | narrowed to the index signature alone | `fields.series` type-checked on a card claim and returned `undefined`. | **049 §6.2** |
| `!fields.series && !fields.issue` in `identityResolution.ts` | a **sixth pack function**, `claimIsUsable` | A comic question asked of every vertical, wearing field names instead of a vertical literal — the same defect class §5.5 fixed one file over, found one hop downstream. | **049 §6.3** |
| `CATALOG_IDENTITY_FILES` | gained `src/catalog/cardIdentity.ts` | A second pack's field list is a field list; a subject set that grew a member and did not grow this row would have watched the wrong file. | **049**, `architectureRules.ts:558-563` |

**What did NOT change:** `dedupe.ts`, `resolve.ts`, `mint.ts`, the routes, the wire contract, and `editionWrite.ts` beyond its import line (049 §6.5). **No migration was needed by this bead or by E04-B03** — `migrations/016` and `017` already carry every column used.

**E04-B04 (`longbox-e5b.4.4`, doc 051) is the end state and has not merged.** 030 §5.2 makes the signature function **data** — `vertical_pack_version.signature_fn_ref` names a module path resolved at boot, failing closed if it is missing. The registry §5.5 built is the interim shape that contract will take.

## 9. Review posture — and what did NOT happen

**No cannon was run on E04-B02, and this record does not invent one.** Its sibling 049 §11 records a two-lens cannon (`rich-hickey-reviewer` + `martin-fowler-reviewer`); E04-B02 had none. It was a DEC-class bead whose decisions were taken **in the course of building**, by the acting head under Jeremy's 2026-09-03 delegation, and reviewed the way a code bead is reviewed.

**The authority this record actually rests on is therefore three things and not a council:**

1. **The merged PR** — #69, `b8fa4d8` → `480cb72`, squash-merged `f6adbc4`, with all 8 required checks green on `480cb72`.
2. **The `000-docs/006` decision-log row of 2026-09-04**, which is where four of the five decisions were first written down and which the gate in §6 exists to make mandatory for exactly this class of change.
3. **The `longbox-invariant-reviewer` verdict on `b8fa4d8`, PASS-WITH-NOTES**, quoted from the bead record (`bd show longbox-e5b.4.2`):

> *"smuggle probe (12 payloads) all refused; 030 I7 across every definition row; mint + citing row atomic; no series column on edition; dedupe total, same-signature editions coexist, one as-of predicate repo-wide; A8 guard negatives fail; confirmationOutcome.ts byte-identical; identity_resolution scoped by shop_id and appended per corpus. **WARN:** editionWrite hard-codes the comic composers (a second pack would be comic-signed — per-pack map fail-closed); the paired-edit subject set misses comicIdentity.ts. **NOTE:** paired-edit half skipped on push to main (run it on push too); ci fetch-depth hygiene; counts 782 / 006 1.48.0."*

Both WARNs and all three NOTEs were folded into `480cb72` before merge (§5.5, §6).

**The honest cost of a decision taken without a cannon, stated rather than glossed.** 049 §11.1 preserves `martin-fowler-reviewer`'s note on exactly this method: *"a record that argues both sides itself and then congratulates itself for having considered the alternative is exactly the pattern that produces expensive surprises three months later, because nobody outside the session pressure-tested the premise."* That criticism applies to §5 in full. What partially answers it here — and only partially — is that §5.5 and §6's two corrections were **not** the builder's own; they came from a separate read-only reviewer, and each closed a way the property could have stopped holding while the gate stayed green. A reviewer that finds a real hole is evidence that the review was real; it is not evidence that the design premise was tested. **Where the gate audit disagrees with §5, it wins.**

## 10. Not decided here

- **It does not decide catalog supersession.** §5.4 — **E04-B11** `longbox-e5b.4.11`.
- **It does not make `identityKey` vertical-aware, and "unchanged" is not "safe."** `identityKey` computes `[title, issue, variant]` unconditionally (`confirmationOutcome.ts:56`), with no vertical parameter and no pack lookup — the same defect class §5.5 fixed in the write path and 049 §6.3 fixed in the resolution path. Fixing it **is** a 019 measurement change (`019:57`), which is precisely why §6's gate exists. Filed as **E04-D04** `longbox-e5b.4.16`, and carried as an acceptance line on **E19-B06** `longbox-e5b.18.6` in 049 §8.
- **It does not turn on `noPropertyAccessFromIndexSignature`.** A repo-wide tsconfig decision, filed as **E02-D13** `longbox-e5b.2.23`.
- **It does not decide the manifest, vertical codes, or pack certification** — **E04-B04** `longbox-e5b.4.4` (doc 051).
- **It does not decide the crosswalk edge model, `human` as a resolution method, or the review queue that produces one** — **E04-B06** `longbox-e5b.4.6`.
- **It does not decide `canonical_edition` as a resolution method** (a definition-level match reaching an edition through `is_canonical_edition`, 047 §2.2) — E06's candidate generation.
- **It does not create the `resolveCurrent` named call site** 047 A11 requires — still **E06-B02** `longbox-e5b.6.2`, which also owns A2's transactional (never TTL) cache invalidation.
- **It does not discharge 047 I10's data-level burden.** `physical_item` was **DECIDED** by **E02-B05** `longbox-e5b.2.5` — a decision bead, CLOSED, and therefore not where the work waits. The BUILD is **E10-B03** `longbox-e5b.10.3` (*"Map LCID, physical item, SKU, metafields and external IDs with idempotency"*, open). The table does not exist at `a803867`.
- **It does not touch 019 T1 or T3.** The measurement rules are unchanged; §6 installs the guard that keeps them unchanged. 047 A7's ruling that **T1 scores on `asStated`** remains an **E07-B01** `longbox-e5b.7.1` obligation and is not implemented here.
- **It authorises no vertical and no corpus.** The catalog tables ship empty; a `vertical_pack` row is what turns a registered function into a usable vertical, and writing one is E04-B04's and E19-B06's.
- **It states no legal or statutory conclusion of any kind**, and no sentence in it is registered copy — nothing here may be repeated to a shop, a partner or a prospect without a 021 row (T26 pre-send).

## 11. Traceability

- **Bead:** E04-D03 `longbox-e5b.4.15`, recording E04-B02 `longbox-e5b.4.2` (CLOSED 2026-09-04). Epic LBOX-E04, gate G2. Closed by `bd-sync close` with this record's commit SHA after `longbox-gate-auditor` (023 §5); no `bd` write is made from inside a record.
- **Deferral discharged:** 047 §12.3's comic-schema row, in **both halves** — the schema (§3) and A8's guard (§6). **047 §12.3 is not amended**: it was true when written and a deferral discharged is a deferral kept, not a deferral to edit (018 §4 C2).
- **Amend-by-a-row raised:** none. No ratified record's content changes here.
- **Registers:** `000-INDEX.md` row 052 · `000-docs/016` §1 row 052 · `000-docs/006` decision-log row dated 2026-09-04. **015 is untouched** — this record creates no bead and files no discovered work; every item in §10 already has an owning bead.
- **016 §4 is not backfilled by this record.** Its own header pins it *"Inspected: 2026-09-03 … at main `38ff473`"*, and `016:150` reads *"#1, #2 CLOSED …; #4, #5, #7, #8, #9 MERGED; #10–#17 OPEN Dependabot"* — so the **merged list stops at #9**, #10–#17 are the Dependabot batch, and **nothing in the #63–#76 range this record and its siblings cite appears in §4 at all**. 049 and 050 did not backfill it either. Naming that here is cheaper than a row that claims a currency the section does not have.
- **Obligations handed on:** **E04-B11** catalog supersession (§5.4) · **E04-D04** / **E19-B06** the `identityKey` vertical-blindness gate (§10) · **E02-D13** the tsconfig flag · **E04-B04** the manifest that replaces §5.5's interim registry · **E04-B06** the crosswalk and the human rung · **E06-B02** `resolveCurrent` and transactional cache invalidation · **E07-B01** 047 A7's `asStated` scoring · **E10-B03** `physical_item`, which §3.3's copy facts are refused *toward* and which does not exist yet — decided by E02-B05 (closed), built by E10-B03 (open).
