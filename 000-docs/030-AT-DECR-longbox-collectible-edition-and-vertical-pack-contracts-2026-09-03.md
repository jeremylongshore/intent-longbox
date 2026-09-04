# Decision Record — Collectible Definition, Edition and the Vertical-Pack Extension Contract

**Version:** 1.2.0
**Status:** **RATIFIED 2026-09-03** by the acting head of board under Jeremy Longshore's 2026-09-03 delegation, after a two-lens cannon (`rich-hickey-reviewer`, `martin-fowler-reviewer`, both ACCEPT-WITH-CHANGES). Binding per §11. Amendments A1–A8 absorbed in full, none declined; Fowler's dissent preserved in §11.
**Bead:** E02-B04 `longbox-e5b.2.4` (epic LBOX-E02 `longbox-e5b.2`, gate G2) — see 000-docs/014 §8
**Drafted:** 2026-09-03 by `longbox-domain-builder` · **Cannon:** `rich-hickey-reviewer` + `martin-fowler-reviewer`, 2026-09-03 · **Decision owner:** Jeremy Longshore (acting head of board under the 2026-09-03 delegation)
**Sensitivity:** Restricted internal (014 §10)
**Supersedes:** nothing — first catalog-core record. **Inputs:** 014 §3.4 (vertical packs), 014 §4.1 (resolution ladder), 014 §4.2 (provider capability contract), 014 §4.3 (canonical crosswalk / LCID rule), 014 §8 rows E02-B04, E02-B05, E02-B07, E02-B10, E04-B01, E04-B02, E04-B04, E04-B05, E04-B06, E19-B06; 003 (architecture, corpus section); 005 (v0 schema sketch and adapter shapes); 029 v1.1.1 §2.3 (catalog module ownership) and §2.2 (workflow owns the physical chain); 018 (evidence rules); 019 v1.2.0 T25 (rights-traceable data, non-waivable); 022 P1 (condition never numeric); `migrations/001_init.sql`, `migrations/003_reserve_principle_slots.sql`; `.beads/formulas/longbox-vertical-pack.formula.toml`; CLAUDE.md locked decisions 4, 5, 6.

## Change log

**Version convention** (006's, adopted here): a **minor** bump means the content of a decision changed; a **patch** bump means a statement of fact was repaired with no decision changing. 029 is the worked example — 1.0.0 → 1.1.0 absorbed cannon amendments, 1.1.0 → 1.1.1 repaired false `file:line` claims.

| Version | Date | What changed | Authority |
|---|---|---|---|
| 1.0.0 | 2026-09-03 | Initial draft, Status PROPOSED, §11 unsigned, five open questions in §13. | `longbox-domain-builder` |
| **1.2.0** | **2026-09-04** | **Amend-by-a-row at 047's ratification (047 A6, the Q6 ruling). §5.4 card signature: `grader`/`cert_number` move out of the edition into the copy-level record, symmetric with 047 §8.4.** The sketched card signature `set\|number\|variant\|language\|grader` becomes `set\|number\|variant\|language`, and `grader`/`cert_number` leave the edition attribute list for the copy (036 `physical_item`) and its condition record (037). A **minor** bump because the content of a decision changed — the card sketch's field placement — even though no rule in §2, §3, §4, §6 or §7 moved and no ratified invariant changed. **Why here rather than in 047:** 047 §2.3 ruled that a grader is never part of edition identity in *any* vertical, and the cannon ruled that this is not a pack decision but the same rule restated; leaving a ratified sketch that contradicts it would have made the contradiction a thing a future pack author inherits. E19-B06 still gates any second vertical, so the sketch is amended while it is still a sketch. **E04-B03 carries the acceptance line:** cert namespaces are excluded from `edition` and from `edition_signature`, and a pack manifest declaring either as an edition field fails certification. 006 row dated 2026-09-04. | 047 A6 → acting head |
| **1.1.1** | **2026-09-03** | Patch (gate audit): §5.1 comment no longer claims a comic pack exists today or that every interface member is populated; "seven contract fields" qualified; 006 row's stale FK-loss clause repaired. No decision changed. |
| **1.1.0** | **2026-09-03** | **RATIFIED.** Eight cannon amendments absorbed, none declined — decisions changed, hence a minor bump. **A1** (Hickey F2 + Fowler F3, converged) the reserved nullable `confirmed_edition_lcid` column is **dropped** and replaced by the append-only `identity_resolution` fact table (§7.1), removing the two-meanings-of-NULL hazard; §13 Q4 re-answered as decided. **A2** (Fowler F4) `lcid_registry(lcid)` is a **real FK target**; §2.5's "cannot be a foreign key" was a conflation of FK-to-`edition.id` (impossible) with FK-to-registry (straightforward), and I3 becomes a constraint-existence test. **A3** (Fowler F1) `VerticalPackManifest` trimmed to the seven contract fields (the A5 single-rate set) the comic pack populates; `listingTemplate` and `evalSlices` demoted to reserved names, with the add-when-a-pack-needs-it rule placed on E04-B04. **A4** (Hickey Q2 over Fowler F2) `edition_signature` stays a **table**, decided on recoverability rather than frequency; Fowler's dissent preserved in §11. **A5** (Hickey F3) `packVersion` is **single-rate** — schema, signature function, recipe, condition schema, crosswalk, valuation and prohibited claims version together. **A6** (Hickey F4 + Fowler F5) I1's deny-list adds `upc\|ean\|isbn` and is **derived** from registered packs' `providerCrosswalk` plus `SELECT DISTINCT provider FROM edition_external_id`. **A7** (Hickey F5) an E04-B11 acceptance criterion makes the (a)-over-(c) trade falsifiable on the import-validation axis, with the bound **measured, not guessed**. **A8** (Hickey F1) §13 Q3 reworded: the corpus-advance rule refuses to manufacture a fake present-tense answer for a fact that is a function of `(lcid, corpus_version)`. **A9:** §2.6's `physical_item` disposition stands unchanged. No §1 today-claim was disturbed; §0's evidence posture is unchanged. | Two-lens cannon → acting head, §11 |

## 0. Evidence posture

Every claim in this record about **what the repository does today** is REPRODUCED (018 §2 A1) at `0c630a0` — branch head `feat/e02-b04-collectible-edition-vertical-pack-contracts` cut from `origin/main` `0c630a0` — and carries `file:line` derived by grep, not by memory. §1 is the complete list of today-claims; every later section that says "today" points back at a §1 row. Everything else in this record — the tables, the manifest, the invariants — is **ASSERTED**: it is a design, no line of it exists, and this record creates no schema. The migration in §7 is a *sketch for E02-B07 and E02-B10 to execute*, not a migration.

029 v1.1.1's first gate audit failed on exactly this distinction (029 change log, blocker B1: a claim about which file wrote which table was CONTRADICTED at `fb3f706`). §1 exists so that this record fails the same way or not at all.

**Ratification does not move anything up the ladder.** v1.1.0 is RATIFIED, and every §1 row is still REPRODUCED, every design statement still ASSERTED, and nothing here is TESTED. A ratified decision is a decision, not evidence that it is implemented — the same rule 018 §2 A3 applies to signed thresholds. No §1 today-claim was disturbed by the A1–A8 amendments; each was re-checked against `0c630a0` and none needed a new cite.

## 1. What exists today (REPRODUCED at `0c630a0`)

| # | Claim | Evidence |
|---|---|---|
| E1 | **There is no collectible, edition, LCID, physical-item or vertical-pack concept anywhere in the tree.** `grep -rn "lcid\|LCID\|collectible_definition\|edition\|physical_item\|vertical_pack" --include=*.ts --include=*.sql src migrations scripts` returns **0 lines**. | grep, exit 1, zero matches |
| E2 | **Identity today is a jsonb blob on one immutable row.** `human_confirmation.confirmed_issue jsonb NOT NULL` — the column comment already anticipates this record: *"issue ref (candidate payload or manual entry); corpus FK when corpus lands"*. | `migrations/001_init.sql:115` |
| E3 | That blob is written once, from the route, and read back untyped. | write `src/routes/scanSessions.ts:175`; read-model type `:285` (`Array<{ confirmed_issue: Record<string, unknown> }>`), consumed `:296` |
| E4 | **`human_confirmation` is UPDATE- and DELETE-proof in the database.** It is in the append-only trigger array; the trigger runs `forbid_mutation()` `BEFORE UPDATE OR DELETE`. This is why §7's backfill question has only one honest answer. | `migrations/001_init.sql:175`, `:179` |
| E5 | `human_confirmation` already carries a `supersedes_id` self-FK and a partial unique index making a row superseded **at most once**, plus a `human_confirmation_current` view. The correction path this record's identity chain must respect already exists. | `migrations/003_reserve_principle_slots.sql:86`, `:94-96`, `:103-104`, `:120-124` |
| E6 | **`candidate_set` is the other identity surface**: `corpus_version_id uuid REFERENCES corpus_version(id)`, `method text ... CHECK (method IN ('barcode','llm_vision','ximilar','index'))`, `candidates jsonb NOT NULL DEFAULT '[]'::jsonb`. Candidates are a jsonb array, corpus-pinned but not catalog-linked. | `migrations/001_init.sql:86`, `:87`, `:88` |
| E7 | The two writers of `candidate_set` are the barcode rung and the vision rung, in `resolution` (029 §2.4). Barcode rows store the parse verbatim; vision rows store `result.ranked` verbatim. Neither resolves to a catalog row, because there is no catalog. | `src/services/identify.ts:56` (`method='barcode'`), `:107` (`method='llm_vision'`) |
| E8 | **The comic-specific candidate shape is five fields, three of them optional**: `CandidateMeta { title: string; issue: string; publisher?: string; year?: number; variant?: string }`, extended by `RankedCandidate { confidence: number; variantHints?: string[] }`. This is the whole of the identity vocabulary the system has today. | `src/providers/types.ts:11-17`, `:19-22` |
| E9 | The same five field names are hard-coded into the provider prompt's required JSON shape. | `src/providers/types.ts:74` |
| E10 | **The barcode rung already decodes printing and cover variant and throws them away.** `parseComicBarcode` returns `supplement: { raw, issue, cover, printing }` — digits 1–3 issue, digit 4 cover variant, digit 5 printing — and the result is JSON-stringified into `candidate_set.candidates` with nothing to resolve it against. | `src/services/barcode.ts:12`, `:13`, `:14`; consumed at `src/services/identify.ts:56` |
| E11 | **`corpus_version` exists in the schema and has zero references in application code.** The only `.ts` occurrences in the repo are two entries in an integration test's expected-table list. 029 §2.3's "Files today: **None**" for catalog reproduces. | `migrations/001_init.sql:54-59`; `grep -rn corpus_version --include=*.ts src scripts tests` → `tests/integration/migrations.test.ts:40`, `:92` only |
| E12 | **Condition is already non-numeric at the DDL level**, and the label set is a closed comic vocabulary in both the DB and the code. | `migrations/001_init.sql:126-127` (`CHECK (grade_range_low IN ('PR','FR','GD','VG','FN','VF','NM'))`); `src/services/condition.ts:3` (`GRADE_LABELS = ["PR","FR","GD","VG","FN","VF","NM"]`) |
| E13 | **`upc` already leaks into the pricing path as a free-text query field**, not as an identifier resolved against anything: `PricingQuery.upc?: string`, accepted from the request body and forwarded. | `src/services/pricing.ts:23`; `src/routes/scanSessions.ts:228`, `:246` |

**What §1 adds up to.** The system has a *comic-shaped identity vocabulary* (E8, E9, E12), a *deterministic decoder that already produces variant and printing* (E10), an *immutable place to put a confirmed identity* (E2, E4, E5), and **nothing for any of it to point at** (E1, E11). E02-B04 is the missing referent. It is not a refactor: no table changes shape, no existing row is touched, and every design below is additive.

## 2. Decision A — The core chain

Three concepts, three different kinds of thing. Conflating any two of them is the mistake this record exists to prevent.

```
collectible_definition   the abstract work        "Amazing Spider-Man #300"
        │  1:N
        ▼
edition                  a specific printing      "ASM #300, direct market, first printing, McFarlane cover"
        │  1:N
        ▼
physical_item            one copy in one shop     "the copy in the shop owner's long box, VG–FN, bin 12"
```

### 2.1 What each one is, in Hickey terms

| | `collectible_definition` | `edition` | `physical_item` |
|---|---|---|---|
| **Kind** | a **value**, versioned | a **value**, versioned | an **identity** |
| **Identity key** | `definition_lcid` — Longbox-issued, stable forever | `edition_lcid` — Longbox-issued, stable forever | `physical_item_id` — Longbox-issued, shop-scoped |
| **Rows per key** | many: one per `corpus_version` in which it appears, plus in-corpus corrections | many, same rule | one |
| **Mutable?** | no row is ever updated | no row is ever updated | the row is never updated; its condition, custody and listing history are appended records elsewhere |
| **Shop-scoped?** | **no** — a catalog fact is not a tenant's property | **no** | **yes**, `shop_id` FK (locked decision 4) |
| **Owner module** | `catalog` (029 §2.3) | `catalog` | **`workflow`** (029 §2.2) — see §2.6 |
| **Designed by** | this record | this record | **E02-B05** — this record fixes only the reference contract |

The asymmetry is the point. A definition and an edition are *what the world says a thing is*: they change when the corpus changes or when someone corrects the catalog, and every past statement about them must stay readable. A physical item is *a thing that exists in a shop*: it has custody, it can be sold, it is a tenant's data. 029 §2.3's rule that "catalog must be readable by a batch importer with no pipeline present" is only true if the first two carry no `shop_id` — the moment a definition is shop-scoped, importing the GCD dump becomes a per-tenant operation.

### 2.2 `collectible_definition` — the abstract work

**Identity.** `definition_lcid`. Longbox-issued, opaque, provider-neutral. It is **never** derived from a provider ID, a GCD number, a Metron ID, a UPC, or any hash of provider data (§4, and 014 §4.3). Its namespace, lifecycle, and merge/split semantics are **E04-B01**; this record commits only that it exists, that it is the key, and that nothing else may be.

**Immutable fields** — fixed for the life of one row: `definition_lcid`, `vertical`, `corpus_version_id`, `attributes`, `signature`, `created_at`, `supersedes_id`.

**Mutable fields:** none. There is no `updated_at` and no UPDATE path; the append-only trigger from `001_init.sql:179` attaches to this table exactly as it does to the nine tables already in that array (`:174-177`).

**Required fields, common to every vertical** — the seven that must exist whatever the pack:

| Field | Why every vertical needs it |
|---|---|
| `definition_lcid` | the platform key (§4) |
| `vertical` | the discriminator that selects the pack (§3) |
| `corpus_version_id` | which immutable snapshot this row belongs to (003 "a candidate set always names the corpus version it was computed against") |
| `attributes jsonb` | the pack-validated payload (§3.2) |
| `signature text` | the normalized dedupe key (§3.3) |
| `created_at` | Hickey timestamping |
| `supersedes_id` | in-corpus correction, self-FK, at-most-once — the `003:94-104` pattern |

**Supersession rule.** Two distinct mechanisms, deliberately not collapsed:

- **Corpus advance.** A new `corpus_version` produces a *new row for the same `definition_lcid`*. The old row is **not** superseded — it remains the truth *as of its corpus version*, which is what makes a two-year-old `candidate_set` still interpretable (003, corpus section). Reading "the definition" therefore always means "the definition **at** a corpus version".
- **In-corpus correction.** A mistake inside one corpus version is corrected by a new row with `supersedes_id` pointing at the wrong one, in the same `corpus_version_id`. `supersedes_id` is UNIQUE-where-not-null: a superseded row is superseded **once**, so correction history is a chain, never a fork. This is `003_reserve_principle_slots.sql:98-104`'s pattern, adopted verbatim rather than reinvented.

**Current-row read model.** `collectible_definition_current(corpus_version_id)` = the newest non-superseded row per `definition_lcid` within that corpus version — the `DISTINCT ON` view shape already in the tree at `003:108-112`. A view is a read model over immutable history and holds no state.

### 2.3 `edition` — the thing a barcode or a cover identifies

An `edition` is the referent of an act of identification. When the barcode rung reads a UPC plus its five-digit supplement (E10), the thing it has identified is not "Amazing Spider-Man #300" — it is "ASM #300, cover variant 1, first printing". When the vision rung proposes a cover, the thing it has seen is a specific cover. **The edition, not the definition, is what a human confirms.**

Same identity, immutability, versioning and supersession rules as §2.2, plus:

| Field | Note |
|---|---|
| `edition_lcid` | Longbox-issued; the key a `physical_item` and a `human_confirmation` reference |
| `definition_lcid` | which work this is an edition of. **References the LCID, not a version row** — see §2.5 |
| `vertical` | must equal the parent definition's `vertical`; enforced by invariant I7 (§8) |
| `is_canonical_edition` | boolean, one per definition per corpus version — the "if you only know the issue, this is the default printing" row, so that a definition-level match can still produce a listing |

The `edition` is also where the barcode supplement's *cover* and *printing* digits (E10) finally land — inside `attributes`, per the comic pack's schema (§5.1), and inside `signature`.

### 2.4 `physical_item` — one copy, in one shop

**This record does not design it. E02-B05 does** (014 §8: "Define stable physical-item/copy, SKU, quantity, location, custody and duplicate invariants"). Four contract points, and nothing more:

1. **`physical_item.edition_lcid` is the reference**, and it is the *LCID*, not a version row's primary key (§2.5).
2. **`physical_item` carries `shop_id`** (locked decision 4). Definitions and editions do not.
3. **`physical_item` is owned by `workflow`, not `catalog`** (029 §2.2, §2.3). Catalog owns `collectible_definition`, `edition` and `corpus_version` and must never import `workflow`; the arrow points from the copy to the catalog, one way. A catalog that knows about copies is a catalog that cannot be batch-imported.
4. **A `physical_item` may reference an edition that no longer exists in the current corpus version.** That is not an error; it is the normal consequence of a corpus advance (§2.5), and E02-B05's invariants must accommodate it.

An edition-level reference is *sufficient* for a listing: everything a Shopify draft needs — title, cover, printing, category, listing template — hangs off the edition. Nothing in commerce needs to reach the definition except to render "other issues in this series".

### 2.5 The load-bearing reference rule: point at the LCID, never at the row

Every reference **out of** the catalog — `physical_item.edition_lcid`, `identity_resolution.edition_lcid` (§7), a crosswalk edge, a pricing query — names the **LCID**, and where the *as-of* matters it names **`(lcid, corpus_version_id)`** as a pair. No outside table ever holds a foreign key to `edition.id` or `collectible_definition.id`.

Two things fall out, and both are the reason for the rule:

- **A corpus advance cannot orphan a shop's inventory.** The GCD dump refreshes every fourteen days (003). If a copy pointed at a row, every refresh would either strand thousands of copies or force a rewrite of immutable rows — the second being impossible under the append-only trigger (E4).
- **A catalog correction cannot rewrite history.** Superseding a wrong edition row leaves every past confirmation pointing at the same LCID, and the resolution *through* that LCID now lands on the corrected row. The confirmation itself — an immutable human act — is untouched. This is the same shape as `human_confirmation`'s own supersession chain (E5): the correction is a new fact, not an edit.

**And the database still checks it. `lcid_registry` is a real foreign-key target** (A2, Fowler F4):

```
lcid_registry( lcid PK, kind text CHECK (kind IN ('definition','edition')),
               vertical text, issued_at timestamptz )   -- one row per issued LCID, insert-only
```

Every `*_lcid` column in the system — `collectible_definition.definition_lcid`, `edition.edition_lcid`, `edition.definition_lcid`, `edition_signature.edition_lcid`, `edition_external_id.edition_lcid`, `physical_item.edition_lcid`, `identity_resolution.edition_lcid` — carries `REFERENCES lcid_registry(lcid)`. An LCID is issued once, by inserting one registry row; every later use is an ordinary FK the database enforces.

**v1.0.0 got this wrong and the correction matters.** It said flatly that "`edition_lcid` cannot be a database foreign key" and demoted referential integrity to a test (the old I3). That conflated two different targets: an FK to **`edition.id`** is indeed impossible, because `edition_lcid` is not unique in `edition` — many corpus-version rows share one LCID, which is the whole design. But an FK to **`lcid_registry(lcid)`** is straightforward, because *that* table has exactly one row per LCID by construction. The rule "point at the LCID, never at the row id" never required giving up referential integrity; it only required a table whose primary key **is** the LCID. So there is no concession here to state: the database checks every LCID reference, and I3 (§8) becomes a constraint-existence test rather than a data-integrity sweep.

### 2.6 Module ownership, checked against 029

029 v1.1.1 §2.3 gives `catalog` "the generic `collectible_definition → edition` core (E02-B04)" and "`corpus_version` — and, on delivery of E04, the LCID, edition, signature and crosswalk tables". §2.2 gives `workflow` the `scan_session` chain. **Checked and consistent:** every table this record proposes is a catalog table except `physical_item`, which this record does not design and assigns to `workflow` per §2.2's inventory-and-operations scope. One consequence worth naming: 029 §2.2's tables-owned list for `workflow` is `scan_session`, `scan_photo`, `human_confirmation` — it does not yet name `physical_item`, because E02-B05 had not run. **E02-B05 must add it there, and 029 must take an amend-by-a-row under its §9 clause when it does.** This record does not amend 029.

The same applies to `identity_resolution` (§7.1, added at v1.1.0): it is **workflow-owned and shop-scoped**, because it is a statement about one shop's `human_confirmation`, not a catalog fact — `catalog` must stay readable by a batch importer with no pipeline present (029 §2.3), and a table FK'd to `human_confirmation` is not. It belongs in the same E02-B05 amend-by-a-row that adds `physical_item` to 029 §2.2's owned-tables list. Naming its owner here is a consistency requirement of 029's "every table owned by exactly one module" rule; it is not an amendment to 029, which this record still does not make.

## 3. Decision B — How a vertical extends the core

### 3.1 The three options, and which query patterns decide it

| | Mechanism | Add a vertical means |
|---|---|---|
| **(a)** | `vertical text` discriminator + `attributes jsonb`, validated against a per-pack JSON Schema registered in `vertical_pack` | insert a pack row |
| **(b)** | per-vertical 1:1 extension tables — `comic_edition`, `card_edition` | write a migration, deploy DDL |
| **(c)** | both — jsonb for open attributes, extension table for indexed ones | write a migration for the indexed subset |

The choice is decided by **which lookups are hot and high-cardinality**, because that is the only thing jsonb is genuinely worse at. There are four, and only four:

| # | Query | What it actually keys on | Needs a typed column? |
|---|---|---|---|
| Q1 | **Barcode lookup** — UPC + 5-digit supplement → edition (E10) | an *external identifier string* in a namespace | **No.** It is a lookup on `edition_external_id(provider, external_id)` — a core table with a core index (§4). The UPC is not a comic attribute; it is an identifier issued by someone else. |
| Q2 | **Cover-candidate lookup** — a provider's `{title, issue, publisher, year, variant}` (E8) → edition | the **normalized signature** the pack computes from those fields | **No.** It is an equality lookup on `edition_signature(vertical, signature)` — one `text` column, one index, every vertical (§3.3). |
| Q3 | **Dedupe** — is this edition already in the catalog? | the same normalized signature | **No.** Same index as Q2. That is what makes the signature worth defining once. |
| Q4 | **Listing-template rendering** — turn an edition into a Shopify draft | the whole attribute payload, by key, one row at a time | **No.** A whole-row read is jsonb's best case. |

**No hot query keys on a vertical-specific column.** Every high-cardinality access path in the system resolves through one of two *core* tables — external IDs and signatures — precisely because those are the two things every vertical has and every provider speaks. That is not a coincidence; it is the resolution ladder (014 §4.1: content hash → barcode/UPC → exact canonical/provider alias → similarity) written as an index plan.

The queries that *would* want a typed column are analytics — "every Marvel edition published in 1988", "all PSA-slabbed cards in this shop". They are low-frequency, owner-facing, and belong to `reporting` (029 §2.8), which is downstream by construction and may build whatever projection it needs from the same immutable rows without the catalog knowing.

### 3.2 Recommendation: **option (a)**, with a named escape hatch to (c)

**Adopt (a).** `vertical text` + `attributes jsonb`, validated at write time against the JSON Schema in the pack's registered version. Plus the two core lookup tables, which are (a)'s load-bearing half and are easy to mistake for a concession to (b): they are not per-vertical, they are per-*platform*.

Four reasons:

1. **"Add a vertical" must not mean "change the database."** 014 §3.4's whole claim is plug-and-play; E04-B04's acceptance is "a sample comic and card pack register **without core-code branching**"; the formula's final step is "Register the {{vertical}} pack manifest; core fork count stays zero" (`.beads/formulas/longbox-vertical-pack.formula.toml:38-41`). Under (b), registering a pack is a migration, a deploy and a rollback plan — E02-B10's whole apparatus — for every vertical forever. Under (a) it is an insert.
2. **The schema becomes a value.** Under (b) the shape of a card lives in DDL, which has no version, no history and no way to say "the card schema as of last March". Under (a) it is a row in `vertical_pack_version`: versioned, immutable, superseded by a new row, and therefore *citable* — a `collectible_definition` row can name the exact schema version its `attributes` validated against. This is the same move as `corpus_version`: make the thing that varies a first-class immutable value instead of a deployment.
3. **The core stays honest about what it knows.** A core that has a `comic_edition` table knows what a comic is. `catalog` is the module that "must survive a partner leaving" (029 §2.3); it should also survive the *comic* leaving — that is what makes E19's other verticals a product decision rather than an architecture project.
4. **(c) is (a) plus speculation.** (c)'s indexed extension table is justified only by a measured slow query, and there is no query (Q1–Q4), no data and no pilot. Building it now is the speculative generality Fowler's dissent already flagged in 029 §9 against a 1,930-line codebase.

**The escape hatch, so (a) is not a trap.** If a pack later proves a hot query that a jsonb path cannot serve, the remedy is, in order: (i) a **partial expression index** on the jsonb path, scoped by `vertical` (`CREATE INDEX … ON edition ((attributes->>'series_id')) WHERE vertical = 'comic'`) — no new table, no code change, and Postgres supports this natively; (ii) only if (i) is measured insufficient, a **pack-owned derived projection table**, written by the pack's own importer, treated as a cache rebuildable from `edition`, and never a source of truth. Neither is a core change; neither is authorized here. The trigger is a **measured** query — 018's rule that a threshold is not evidence that it is met applies to this one too.

### 3.3 The normalized signature

The signature is the pack's dedupe key: a pure, deterministic function from `attributes` to a `text` value, stable across corpus versions, and **case-, whitespace- and punctuation-normalized by the pack, not by the core**.

- **Comics:** `series` + `issue` + `variant` + `printing`.
- **Cards:** `set` + `number` + `variant` + `language` + `grader` (per the E02-B04 brief and 014 §3.4's "identity schema and exact keys").

It lives in `edition_signature(vertical, signature, edition_lcid, corpus_version_id)` — **a table, not a column on `edition`** — because **an edition may have more than one valid signature**: a series renamed mid-run, a card set with a regional alternate name. The signature *function* is versioned with the pack (§5.2, single-rate); a function change produces new rows in a new corpus version and never rewrites old ones.

**Why the table survived the cannon (A4).** Fowler argued for starting as a column and promoting to a table on a demonstrated alias — the ordinary YAGNI move, and normally the right one. It was **overruled on recoverability, not on frequency**, and the distinction is worth writing down because it generalizes:

> Table-versus-column here is not decided by how often aliases occur. It is decided by **which failure mode is recoverable under append-only rules.**

- **A column that turns out to need two values is unrecoverable.** The write path must choose one signature and discard the other, and the discarded one is gone — the row cannot be updated (E4) and the alias was never recorded anywhere. The damage is silent: an edition that should have deduped does not, a second edition is created, and by the time anyone notices there are physical items and confirmations hanging off both. Promoting to a table later recovers the *shape* but not the *lost aliases*, which have to be recomputed from a corpus that may no longer contain the old name.
- **A table that turns out to hold one row per edition is a rounding error.** The join key is an indexed `text` column, the join is an equality lookup on a covering index, and the cost of the "wasted" generality is a table with a 1:1 cardinality nobody ever notices.

One side of the bet loses data permanently; the other loses a few bytes and a join. Under a data model whose central premise is that facts are never destroyed (locked decision 4), that asymmetry decides it. Fowler's position is preserved as dissent in §11 — it is the better default in a mutable schema, and this schema is not mutable.

**A signature is not an identity.** Two rows with the same signature are a *dedupe candidate* — a human-queue item under 014 §4.3's "high-impact or conflicting crosswalks enter a human queue" — never an automatic merge. Merges and splits are E04-B01.

## 4. Decision C — Crosswalk and rights

**External identifiers are attributes of an edition version, under a rights row. They are never a key.**

```
edition_external_id(
  edition_lcid, provider, external_id, vertical,
  provider_schema_version, corpus_version_id,
  match_method, confidence, contradiction,
  data_source_id,            -- the rights row (T25)
  source_record_hash, target_record_hash,
  effective_from, supersedes_id, reviewer, created_at )
```

The columns are 014 §4.3's crosswalk-edge list, unchanged, with `data_source_id` added as the T25 hook. Namespaces in `provider` include the ones nobody owns — `upc`, `ean`, `isbn` — alongside `gcd`, `metron`, `pricecharting`, `ebay_epid`, `covrprice`. A UPC is an identifier issued by GS1 to a publisher; treating it as "just another namespace" is what lets Q1 (§3.1) be a core lookup instead of a comic special case, and it is where E13's free-text `upc` pricing field finally gets a referent.

Four rules:

1. **`(provider, external_id)` is not unique and is not a primary key.** Providers reuse, recycle and mis-issue IDs; two providers may agree on a string by accident. The pair is an *edge*, and edges may conflict — 014 §4.3: "Exact identifiers win. Similarity/LLM may propose a mapping but cannot silently certify it."
2. **No core table has a column named after a provider.** No `gcd_id`, no `metron_id` — including in `attributes`, where a `"gcd_id"` key would smuggle the same coupling past the DDL and past a grep for column names. **This retires the 005 §Corpus sketch's `comic_issue(gcd_id NULL, metron_id NULL, upc NULL)`** (005:37-38), which was written before the LCID rule and is superseded by this record; 005 is not edited here (018 C2 — its correction is queued for its next edit).
3. **A provider disappearing removes no core identity.** Deleting every `edition_external_id` row for a provider leaves every `definition_lcid`, `edition_lcid`, signature, attribute payload and physical item intact. This is testable (invariant I2, §8) and it is the entire point of the LCID rule.
4. **Rights travel with the data, inbound and outbound.** 019 T25 is **non-waivable, 100%, BLOCK**: every imported and outbound-rendered/exported field and image must carry a source-registry row with a permitted-use flag. So: **every** row in `edition_external_id`, and every `attributes` payload imported from a provider rather than authored by a shop, carries `data_source_id → data_source(provider, license, permitted_use, attribution_required, redistribution_permitted, effective_from)`. A row with no `data_source_id` is **not importable** — NOT NULL on import paths, and invariant I8 (§8). The registry's content and the licence analysis are **E04-B05**; this record fixes only the column and the rule that nothing lands without it.

This also front-loads locked decision 6's live risk. If the pilot ever forces the build-vs-buy retrieval gate toward a self-built cover index (003, top risk #1), the rights question is "which `data_source` rows permit derivative image processing" — a query, not an archaeology project.

## 5. Decision D — The vertical-pack contract

### 5.1 The manifest, as TypeScript

**Trimmed at v1.1.0 to what the comic pack actually populates (A3, Fowler F1).** v1.0.0's interface carried nine slots, two of which — `listingTemplate` and `evalSlices` — §5.3 itself marked as having *no shipped referent*: draft creation is inline in the route today (`src/routes/scanSessions.ts:329`, per 029 §2.7) and the CI static eval set is still a Phase-2 exit item. Specifying the shape of a field nothing fills is exactly the speculative generality Fowler's dissent flagged in 029 §9, and it is worse here than usual: a wrong guess at a manifest field's shape gets baked into a registered, immutable `vertical_pack_version` row.

**Rule adopted: a manifest field is added when a pack needs it, not before.** `listingTemplate` and `evalSlices` are **reserved names** — noted below so a future pack does not invent a competing spelling — and they are **not fields**. E04-B04's row in §12 carries the obligation.

```ts
/** A vertical pack: everything the core needs to handle a class of collectible
 *  without knowing what one is. Registered as data (§5.2), never as code.
 *  Every contract field below has a shipped referent in today's code (§5.3);
 *  `packVersion` and `displayName` are pack metadata. */
export interface VerticalPackManifest {
  vertical: string;                    // "comic" | "sports-card" | "tcg" | ...
  /** Single-rate (A5). Any change to identitySchema, the signature function,
   *  captureRecipe, conditionSchema, providerCrosswalk, valuationNormalization
   *  or prohibitedClaims bumps THIS version. The parts do not version apart. */
  packVersion: string;                 // semver; immutable once registered
  displayName: string;

  /** 014 §3.4 "identity schema and exact keys". JSON Schema (draft 2020-12)
   *  that `collectible_definition.attributes` and `edition.attributes` are
   *  validated against at write time. Two schemas: a work is not a printing. */
  identitySchema: {
    definition: JsonSchema;
    edition: JsonSchema;
  };

  /** §3.3. Pure, deterministic, normalization inside. May return more than one
   *  signature (aliases); the first is primary. Never reads the DB. */
  normalizedSignature(attributes: Readonly<Record<string, unknown>>): string[];

  /** 014 §3.4 "photo/capture recipe". Drives E05's capture UI; the core never
   *  hard-codes "photograph the cover". */
  captureRecipe: {
    required: CaptureShot[];           // e.g. front cover, barcode
    conditional: Array<{ when: string; shot: CaptureShot }>;  // e.g. high value -> back + interior
  };

  /** 022 P1 / locked decision 5 / 019 T7. A grade RANGE plus named defects.
   *  There is no numeric field in this type and there must never be one. */
  conditionSchema: {
    gradeLabels: readonly string[];    // ordered worst -> best; comics PR..NM (E12)
    defectVocabulary: readonly string[];
    /** How a third-party grader's label maps IN. Never a number, never out. */
    graderLabelMap: Record<string, { low: string; high: string }>;
  };

  /** §4. Which identifier namespaces this vertical speaks, and how to normalize
   *  one before it becomes an edge. Declares namespaces; issues no IDs. */
  providerCrosswalk: Array<{
    provider: string;                  // "gcd" | "upc" | "pricecharting" | ...
    idKind: string;
    normalize(raw: string): string | null;
    capabilities: string[];            // 014 §4.2 capability vocabulary
  }>;

  /** How this vertical's price signals become one comparable snapshot:
   *  which grade basis a source quotes, currency, and how a graded quote maps
   *  onto a grade RANGE. Feeds valuation (029 §2.6); no policy lives here. */
  valuationNormalization: {
    gradeBasis: "range" | "grader_label";
    currency: string;
    sourceAdapters: Array<{ source: string; quoteKind: "live_asks" | "historical_fmv" }>;
  };

  /** 021 blocklist entries scoped to this vertical. Populated today: the comic
   *  pack's prohibited claims are the "AI grades" / certification shapes. */
  prohibitedClaims: string[];
}
```

**Reserved names, not fields** (added when a pack needs them, per the rule above):

| Reserved name | What it will hold | Blocked on |
|---|---|---|
| `listingTemplate` | 014 §3.4's "listing template, category, attributes, tax/shipping rules" | the draft-creation block moving out of the route (029 §2.7, §5 move 2) — until then there is no template to describe |
| `evalSlices` | 014 §3.4's "evaluation slices"; E07-B02 certification minimums | the CI static eval regression set, still a Phase-2 exit item |

Both are named here **only** so a second pack cannot invent a rival spelling. Neither has a specified shape, and specifying one now would be a guess frozen into an immutable row.

`normalizedSignature` is a function and the rest is data. That asymmetry is deliberate and is the one place a pack is code: normalization has to strip punctuation, fold case, canonicalize "vol. 2" and "Volume 2", and no declarative form of that is worth the indirection. It is the **only** executable surface, it is pure, it takes no database handle, and it is the natural unit test (§8, I5).

### 5.2 The manifest, as rows

```
vertical_pack          vertical PK, display_name, created_at
                       -- registration, not content. Insert-only.

vertical_pack_version  id PK, vertical FK, pack_version, manifest jsonb,
                       identity_schema_definition jsonb,
                       identity_schema_edition jsonb,
                       signature_fn_ref text,   -- module path, resolved at boot
                       created_at, supersedes_id
                       -- immutable; a pack change is a new row.
                       -- UNIQUE (vertical, pack_version)
```

A `collectible_definition` / `edition` row records the `vertical_pack_version_id` its `attributes` validated against. That is what makes an old row readable after a pack evolves: the schema that governed it is still on disk, addressable, unchanged.

`signature_fn_ref` is the seam's honest edge: **a function cannot live in a jsonb column**. The row names a module path; the pack registry resolves it at boot and **fails closed** if it is missing — a registered pack whose signature function has been deleted must stop the process, not silently mis-dedupe. Registering a pack therefore ships two things: a row (data) and a small pure module (code). "Zero core forks", not "zero code".

**`pack_version` is single-rate (A5, Hickey F3).** One version number governs the whole manifest. A change to the identity schema, **or** the signature function, **or** the capture recipe, **or** the condition schema, **or** the provider crosswalk, **or** the valuation normalization, **or** the prohibited-claims list bumps `pack_version` and produces a **new `vertical_pack_version` row**. The parts do **not** version independently, and there is deliberately no `signature_fn_version` or `schema_version` beside them.

The reason is that the row is what makes an old `collectible_definition` readable: it records the *one* `vertical_pack_version_id` its `attributes` validated against, and reading it back means resolving the schema **and** the function **and** the recipe that were in force together. Three independent version numbers would make "the pack as of that row" a tuple that has to be reassembled, and a signature function silently re-versioned under a stable schema version would change what dedupes against what while every row still claimed the same pack. One number, one immutable row, one answer. The cost is churn — a typo fix in the prohibited-claims list is a version bump — and that is the right trade for a table whose entire job is to make past rows interpretable.

### 5.3 The comic pack, mapped onto what exists today

| Manifest slot | The shipped comic reality | Evidence |
|---|---|---|
| `vertical` | `"comic"` | — (new) |
| `identitySchema.definition` | `{ series, publisher, volume, year }` — the definition-level subset of `CandidateMeta` | `src/providers/types.ts:11-17` |
| `identitySchema.edition` | `{ issue, variant, printing, cover }` — the printing-level subset, plus the two barcode digits nothing consumes today | `src/providers/types.ts:13`, `:16`; `src/services/barcode.ts:13` (cover), `:14` (printing) |
| `normalizedSignature` | `series|issue|variant|printing`, from those same fields | derived from E8 + E10 |
| `captureRecipe.required` | cover + barcode — the two photo kinds `identify` actually forwards to the provider | `src/services/identify.ts:67` (`.filter((p) => p.kind === "cover" \|\| p.kind === "barcode")`); DDL enum `migrations/001_init.sql:77` (`cover\|barcode\|defect`) |
| `conditionSchema.gradeLabels` | `PR FR GD VG FN VF NM`, ordered, no numbers | `src/services/condition.ts:3`; DDL `migrations/001_init.sql:126-127` |
| `providerCrosswalk` | `upc` (12-digit UPC-A, check digit verified) and the 5-digit supplement, plus `pricecharting` and `ebay` as valuation namespaces | `src/services/barcode.ts:9`, `:25-35`; `src/services/pricing.ts:23` |
| `valuationNormalization` | the two shipped sources and their kinds | 005 §Pricing providers; `src/services/pricing.ts`, `src/services/ebay.ts` |
| `prohibitedClaims` | the certification-adjacent shapes the comic vertical must never say | 021 blocklist; 019 T7; 022 P1 |
| *(reserved)* `listingTemplate` | **not a field.** Draft creation is inline in the route today, so there is no template to describe; the name is reserved for when 029 §5 move 2 relocates that block | `src/routes/scanSessions.ts:329` (per 029 §2.7) |
| *(reserved)* `evalSlices` | **not a field.** None exist; the CI static eval set is still a Phase-2 exit item | CLAUDE.md §Governance; 005 §Eval and cost hooks |

**Two things this mapping proves.** First, **the comic pack is a description of code that already runs**, not a new design — every field in §5.1 has a shipped referent, which is why the two that did not are now reserved names rather than fields (A3). Second, the pack's shape was **derived from** those referents rather than imagined: `printing` and `cover` are manifest fields because `parseComicBarcode` already returns them (E10), and `gradeLabels` is an ordered list because `condition.ts:29` already does an `indexOf` on order.

### 5.4 The card pack, sketched (E04-B04's second acceptance case)

`vertical: "sports-card"`; definition `{ sport, player, set, year, manufacturer }`; edition `{ number, variant, parallel, language }`; signature `set|number|variant|language`; capture `front + back` required, `slab label` conditional on the **copy** carrying a certification; condition `gradeLabels: ["POOR","GOOD","VG","EX","NM","MINT","GEM"]` with `graderLabelMap` translating a PSA or BGS label into a Longbox **range** — never carrying the number through (022 P1, 019 T7); crosswalk namespaces `upc`, `pricecharting`, `ebay_epid`.

**`grader` and `cert_number` are COPY facts, not edition fields, and this sketch was amended to say so (v1.2.0, at 047's ratification under its A6).** v1.1.1 put both in the card edition and `grader` in the card signature. 047 §2.3 ruled that a grader is never part of edition identity — a slabbed card is the **same edition** as a raw one, held by a different copy in a different condition at a different price — and its cannon ruled that this is **not a pack decision but the same rule restated in a second vertical**. So the two fields move to the copy (036's `physical_item` and its appended state facts) and its condition record (037), and `psa_cert` leaves the card pack's crosswalk namespaces: 047 §8.4 excludes cert namespaces from `edition_external_id` entirely, because a cert-number edge would make one shop's slab a property of the shared catalog. **A pack may choose which *edition* attributes enter its signature; it may not promote a copy attribute into one.** **E04-B03 acceptance line: cert namespaces are excluded from `edition` and from `edition_signature`**, and a pack manifest declaring either as an edition field fails pack certification.

**What this sketch demonstrates, and what it does not.** It demonstrates that the *core* absorbs a vertical whose identity fields barely overlap comics' — different keys, an extra capture shot, a different grade vocabulary, a namespace comics never use — **without one new column, one new table, or one `if (vertical === 'comic')`**. It does **not** authorize building it: E19-B06 gates any second vertical on reuse, rights, accuracy, economics and demand evidence, and the formula's first step says so plainly (`.beads/formulas/longbox-vertical-pack.formula.toml:11-15`: *"Architectural possibility is not market permission."*). Architecture readiness is not a roadmap.

## 6. Decision E — What the core must never do

Three prohibitions, restated as prohibitions because §8 has to test them:

1. **No `if (vertical === 'comic')` in core code.** Vertical-conditional behaviour lives in a pack. `platform`, `catalog`, `workflow`, `condition`, `valuation`, `commerce` and `reporting` may read `vertical` **only** to select a pack.
2. **No nullable column added to a core table to serve one vertical.** A field one vertical needs goes in `attributes`. The 001 schema's own `comic_issue` sketch in 005 is the anti-pattern being closed (§4 rule 2).
3. **No unregistered `vertical` value is accepted anywhere.** A write carrying a `vertical` with no `vertical_pack` row is rejected at the boundary, not defaulted to `"comic"`. Fail closed.

## 7. Migration sketch (for E02-B07 and E02-B10 — NOT written here)

**Expand-only, following `003_reserve_principle_slots.sql` exactly**: nothing in `001`, `002` or `003` is edited; every statement is re-runnable by hand (`IF NOT EXISTS`, or DROP-then-ADD for constraints and triggers); the migration adds columns and tables and **never adds an UPDATE path** (`003:12-21`).

**New tables.** Catalog-owned, none carrying `shop_id`: `lcid_registry`, `collectible_definition`, `edition`, `edition_signature`, `edition_external_id`, `data_source`, `vertical_pack`, `vertical_pack_version`. Workflow-owned and shop-scoped: `identity_resolution` (below). All of them get the `_current` views where §2.2 calls for one and append-only triggers, attached with the same `forbid_mutation()` loop as `001:171-182` and `003:237-248`. `vertical_pack` is insert-only rather than append-only-immutable in the strict sense: a pack is registered once and evolves by a new `vertical_pack_version` row.

**No column is added to any existing table.** This migration is purely additive in tables. That is a change from v1.0.0 — see below.

**How the existing jsonb rows relate.** `candidate_set.candidates` (E6) and `human_confirmation.confirmed_issue` (E2) **stay exactly as they are**. They are immutable rows recording what a provider proposed and what a human confirmed at a moment when no catalog existed. That is a true record and it remains true.

### 7.1 Linking a confirmation to an edition — `identity_resolution` (A1)

v1.0.0 reserved a nullable `confirmed_edition_lcid` column on `human_confirmation` and forbade ever backfilling it. **The cannon converged against that from both directions** — Hickey F2 (a nullable column on an immutable row is a hole with two meanings) and Fowler F3 (§13 Q4 had already named the better answer and declined it on scope) — and the acting head adopted the alternative. The column is **dropped from this design entirely**. One mechanism, not two:

```
identity_resolution(
  id                   uuid PK,
  shop_id              uuid NOT NULL REFERENCES shop(id),
  human_confirmation_id uuid NOT NULL REFERENCES human_confirmation(id),
  edition_lcid         REFERENCES lcid_registry(lcid),
  corpus_version_id    uuid NOT NULL REFERENCES corpus_version(id),
  method               text NOT NULL,     -- 'live' | 'barcode' | 'signature' | 'human' | ...
  confidence           text,              -- NULL for deterministic rungs; NEVER numeric-graded (022 P1)
  resolved_by          text NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now()
)
UNIQUE (human_confirmation_id, corpus_version_id)
```

Append-only trigger, same loop. `shop_id` because a resolution is a statement about one shop's scan (locked decision 4). The `UNIQUE` pair says a confirmation is resolved **at most once per corpus version**, which is exactly right: a later corpus may resolve the same confirmation differently, and both statements are true *as of their corpus*.

**Why a fact table beats a reserved column.** The column had two indistinguishable NULLs: "confirmed before the catalog existed" and "confirmed after, but resolution failed or was skipped". Nothing in the schema could tell them apart, and no later work could fix it, because the row cannot be updated (E4). **A row's absence from `identity_resolution` carries no meaning at all** — the question "was this confirmation ever resolved, and how" is answered by a join returning zero rows or one, with a `method` and a `resolved_by` when it returns one. That removes the two-meanings-of-NULL hazard rather than documenting it.

**Who writes it, and when.**

- **At launch: nothing.** The table ships empty. No migration populates it, and the E02-B07/E02-B10 work that creates it writes no rows.
- **Post-catalog confirmations: E06 resolution writes one** as part of the ladder (014 §4.1), naming the rung in `method` and the actor in `resolved_by`.
- **Pre-catalog confirmations: a designed path *may* write one, later.** Matching an old `confirmed_issue` blob against the catalog is now a **new fact** — "on this date, by this method, at this confidence, we judged that this confirmation referred to this edition" — appended alongside the original, which stays untouched. That is Hickey-legal and 018 §4 C5-legal in a way a backfill never was, because it does not claim the human said it. The pilot's early confirmations therefore become usable as eval data instead of permanently un-linkable. Whether to run that path, and at what confidence bar, is **E06's** decision and not authorized here.

The append-only reasoning that justified reserving a column early (`003:4-7`, "append-only rows are never backfillable… the slots must exist before the first live item") does not apply to a table: a table added later loses no history, because the facts it holds are dated when they are *made*, not when the confirmation was.

**Ordering and rollback** are E02-B10's ("prior-snapshot upgrade and compatible rollback pass"). Two constraints from here: `lcid_registry` lands before anything with an `*_lcid` FK, and `identity_resolution` lands after both `lcid_registry` and `corpus_version` (the latter exists already, `001:54-59`).

## 8. Invariants as testable statements

Each is a statement that is true or false about a build, with the test that will decide it. **None of these tests exists** (018: nothing here is TESTED). Files follow the tree's conventions — unit tests flat in `tests/`, DB tests in `tests/integration/`.

| # | Invariant | Test file |
|---|---|---|
| **I1** | **No core table has a column named after a provider or an identifier namespace.** Introspect `information_schema.columns` for every catalog table, and every top-level key of every registered pack's `identitySchema`; fail on a match against a deny-list that is **derived, not static** (A6): the seed names `gcd\|metron\|pricecharting\|ebay\|covrprice\|ximilar\|psa\|cgc` **plus `upc\|ean\|isbn`** (Hickey F4 — a namespace nobody owns is still not an identity, and `upc` was the one most likely to be waved through), **union** every `provider` declared in any registered pack's `providerCrosswalk`, **union** `SELECT DISTINCT provider FROM edition_external_id`. Deriving the last two is the point: a provider onboarded next year cannot sail past a list written today. | `tests/integration/catalog-no-provider-columns.test.ts` |
| **I2** | **A provider disappearing removes no core identity.** Seed definitions, editions and external-ID edges for two providers; delete every edge for one; assert LCIDs, signatures, attributes and physical-item references are byte-identical. | `tests/integration/crosswalk-provider-loss.test.ts` |
| **I3** | **Every `*_lcid` column carries a real foreign key to `lcid_registry(lcid)`** (A2). A **constraint-existence** test, not a data sweep: introspect `information_schema.table_constraints` / `key_column_usage`, enumerate every column matching `%_lcid` across every table, and assert each one has an `FOREIGN KEY` constraint whose referenced table is `lcid_registry`. A new `*_lcid` column added without the FK fails the build. (v1.0.0 made this a data-integrity sweep because it wrongly believed the FK was impossible — see §2.5.) | `tests/integration/lcid-registry-integrity.test.ts` |
| **I4** | **A card pack registers without touching core code.** Register the §5.4 manifest; write a card definition and edition; run identify→confirm→condition→price→draft against it; assert `git diff --stat` over `src/` outside `src/packs/` is empty for the change that added the pack. | `tests/integration/vertical-pack-registration.test.ts` |
| **I5** | **`normalizedSignature` is pure and deterministic.** Same input → same output across 1,000 calls; casing, whitespace and punctuation variants collapse; no DB handle in scope. Property test per registered pack. | `tests/vertical-pack-signature.test.ts` |
| **I6** | **A `vertical` outside the registered packs is rejected** at every write boundary (API, importer, direct service call) — rejected, never defaulted. | `tests/integration/unregistered-vertical-rejected.test.ts` |
| **I7** | **An `edition`'s `vertical` equals its definition's `vertical`.** DB constraint or trigger; the test proves the mismatch is refused. | `tests/integration/catalog-append-only.test.ts` |
| **I8** | **No imported row lands without a rights row** (019 T25, non-waivable): every `edition_external_id`, and every provider-sourced `attributes` payload, has a resolvable `data_source_id` whose `permitted_use` is set. | `tests/integration/rights-traceability.test.ts` |
| **I9** | **Catalog rows are append-only in the database.** `UPDATE` and `DELETE` raise on every new table — the `tests/integration/append-only.test.ts` pattern extended to the eight of them. | `tests/integration/append-only.test.ts` |
| **I10** | **A superseded row is superseded at most once.** A second `supersedes_id` pointing at the same row violates the partial unique index. | `tests/integration/catalog-append-only.test.ts` |
| **I11** | **A corpus advance orphans no physical item.** Publish corpus N+1 without an edition present in N; assert every `physical_item` still resolves through its LCID and reads the newest row that has one. | `tests/integration/corpus-advance-no-orphan.test.ts` |
| **I12** | **No numeric grade exists in the catalog path** (022 P1, locked decision 5, 019 T7): no manifest `conditionSchema` field is numeric; `graderLabelMap` values are label pairs; a manifest with a numeric grade field fails registration. | `tests/vertical-pack-condition-schema.test.ts` |
| **I13** | **No core module branches on a vertical.** Static scan: `vertical ===`, `vertical ==`, `switch (vertical)` outside `src/packs/`. Extends the 029 §3.3 dependency-cruiser rule set. | `tests/contract/no-vertical-branching.test.ts` |

I1, I2, I8 and I12 are the four that map to non-waivable or locked lines; the rest are structural.

## 9. Alternatives considered

**A1 — Nullable-column sprawl on one wide `edition` table.** Add `issue`, `printing`, `card_number`, `parallel`, `language`, `grader`, `cert_number`… all nullable, populated by whichever vertical needs them. *Rejected.* It is the anti-pattern 014 §3.4 names ("not scattered `if comic` statements") and the domain-builder standard forbids by name. Every column is nullable, so the schema documents nothing and the database checks nothing; every read is a null-check; every new vertical is a migration on the hottest table in the catalog. The failure is not aesthetic — it is that "which fields are required" moves out of the schema and into scattered application code, which is exactly where it cannot be versioned or cited.

**A2 — Comic-only core; cards as a fork.** Build `comic_definition` / `comic_edition` and, if a second vertical ever matters, fork the service. *Rejected.* It is cheapest today and it is the decision that cannot be undone later: by the time a card pack is worth building, the comic core has a pilot's worth of immutable rows, and unifying two divergent cores means migrating immutable history — which the append-only triggers make impossible (E4). It also contradicts the blueprint's own framing (014 §3.4's generic chain) and would make E19 an architecture project rather than a product decision. The genuine cost of the recommendation over this one is measured in §10; it is small, and it is paid once.

**A3 — EAV** (`edition_attribute(edition_lcid, key, value)`). *Rejected.* It is jsonb with worse ergonomics and worse performance: N rows per edition, a join per attribute, no schema at all (not even a citable one), and no way to validate a payload as a unit. The one thing EAV buys — indexing an arbitrary attribute — Postgres gives us on jsonb via expression and GIN indexes without the row explosion (§3.2 escape hatch (i)).

**A4 — Option (c), jsonb plus per-vertical indexed extension tables, now.** *Rejected as premature, not as wrong.* No query in §3.1 needs it; there is no data and no pilot; and building it now means writing and rolling back per-vertical DDL for a performance problem nobody has measured. §3.2's escape hatch keeps it one migration away, and it is the right answer the day a query proves it. Named here because a cannon reviewer would otherwise be right to ask why the "safe both-ways" option was not taken: the answer is that it is only safe if the extra machinery is free, and DDL per vertical is precisely the cost this record is trying to avoid.

**A5 — Reuse `corpus_version` as the pack version.** Let the corpus snapshot carry the schema. *Rejected.* They vary for different reasons and at different rates: a corpus advances every ~14 days when GCD refreshes (003), a pack schema changes when we learn something about a vertical, perhaps twice a year. Coupling them means every fortnightly import is a schema event.

## 10. Consequences

**What gets better.**
- Adding a vertical is an insert plus one pure function, not a migration (§3.2 reason 1).
- The catalog survives a provider leaving, by test rather than by intention (I2).
- Rights are a column, not an archaeology project — which is what makes 019 T25 enforceable at all, and what makes locked decision 6's build-vs-buy gate answerable as a query.
- A confirmation made today stays interpretable after a corpus refresh and after a catalog correction (§2.5).
- `printing` and `cover` — decoded by the barcode rung since v0 and discarded ever since (E10) — finally have somewhere to land.
- **Referential integrity is kept, not traded away** (A2): every `*_lcid` is a real FK to `lcid_registry`, and I3 is a constraint-existence test rather than a sweep. v1.0.0 listed the loss of this as the record's largest concession; it was a false concession and it is withdrawn.
- **The pilot's early confirmations stay usable** (A1): `identity_resolution` lets a pre-catalog confirmation be linked later as a *new dated fact*, so the eval set does not start at the catalog's birthday.

**What gets worse, stated plainly.**
- **Attribute typing moves to runtime.** A JSON Schema validated at write time is real enforcement, but it is not a column type: a bug in the pack registry is a bug in every write. I6's fail-closed rule is what keeps that from degrading quietly. **With A2 applied, this is now the largest genuine concession in the record.**
- **Two places to look.** A reader answering "what is a comic in this system" reads a schema in a row, not a `CREATE TABLE`. That is a genuine ergonomic loss, mitigated only by the pack manifest being one file and one row rather than scattered.
- **Every catalog write costs a validation.** Bulk-importing a GCD dump means validating hundreds of thousands of payloads against a JSON Schema. This is the one axis on which option (c) — per-vertical typed columns — would genuinely be faster, and it is the one axis on which (c) was rejected **without data** (§9 A4). So the trade is made falsifiable rather than asserted, by binding an acceptance criterion onto the bead that will first feel it:

> **E04-B11 acceptance criterion (added at v1.1.0, A7 / Hickey F5).** The full GCD dump import validates **every** row against its pack schema within a **measured** wall-clock bound on named reference hardware. **The bound is set from the first measured run, not guessed** — and the first run is therefore a measurement, not a pass/fail. Once set, a regression past the bound is a build failure, and a bound that cannot be met after batching and compiled-schema caching is the evidence that reopens §3.2's escape hatch, or this record's choice of (a) over (c) itself, under a new decision record.

  A threshold is not evidence that it is met (018 §2 A3), which is exactly why the bound is left unnumbered here.
- **Churn on the pack version.** Single-rate versioning (A5) means a one-word fix to a prohibited-claims list is a new `vertical_pack_version` row. Accepted as the cost of one immutable answer to "what governed this row".

**What is now blocked on this record.** E02-B05 (physical item, plus the 029 amend-by-a-row that also names `identity_resolution`), E02-B07 (append-only/correction/purge over these tables, and the `identity_resolution` write path), E02-B10 (migrations and the architecture gate), E04-B01 (LCID namespace and lifecycle), E04-B02/B03 (per-vertical identity schemas and signatures), E04-B04 (the pack manifest as shipped code, under the A3 add-when-needed rule), E04-B05 (rights registry), E04-B06 (crosswalk), E04-B11 (corpus ingest, carrying the A7 criterion), E06 (which writes `identity_resolution` and decides the pre-catalog path).

## 11. Ratification

| Field | Value |
|---|---|
| Decision | Adopt §1–§12 as the collectible, edition and vertical-pack contracts for Longbox, with amendments **A1–A8** absorbed in full (none declined). Binding on E02-B05, E02-B07, E02-B10, E04-B01 to E04-B06, E04-B11 and E06. |
| Ratified by | **Claude, acting head of board**, under Jeremy Longshore's 2026-09-03 delegation |
| Date | 2026-09-03 |
| Cannon | `rich-hickey-reviewer` and `martin-fowler-reviewer`, both **ACCEPT-WITH-CHANGES** |
| Amendments at ratification | **A1** `identity_resolution` fact table replaces the reserved `confirmed_edition_lcid` column (Hickey F2 + Fowler F3, converged) · **A2** real FK to `lcid_registry`; I3 becomes a constraint-existence test (Fowler F4) · **A3** manifest trimmed to fields the comic pack populates; `listingTemplate` / `evalSlices` become reserved names (Fowler F1) · **A4** `edition_signature` stays a table, on recoverability (Hickey Q2 over Fowler F2) · **A5** `packVersion` is single-rate (Hickey F3) · **A6** I1's deny-list adds `upc\|ean\|isbn` and derives provider names from registered packs and from `edition_external_id` (Hickey F4 + Fowler F5) · **A7** E04-B11 acceptance criterion makes the (a)-over-(c) trade falsifiable on the import-validation axis (Hickey F5) · **A8** §13 Q3 reworded (Hickey F1). **A9:** §2.6's `physical_item` disposition stands unchanged. |
| Dissent preserved | **Fowler, on `edition_signature`:** it should start as a column on `edition` and be promoted to a table only on a demonstrated alias — the ordinary YAGNI default. **Overruled** on recoverability, not on frequency: under append-only rules a lossy single signature is unrecoverable and silently creates duplicate editions, while an occasionally-1:1 table costs an indexed-text join (§3.3). **Fowler, on the pack machinery as a whole:** a manifest, a registry, two lookup tables and a version discipline are speculative for a system with exactly one vertical. **Accepted as a real timing risk**, not refuted — mitigated by A3 (no field exists until a pack fills it) and bounded by A7 (the trade is measured, not asserted). Both positions are the better default in a mutable schema; this schema is not mutable. |
| Recorded in | 006 decision log, row dated 2026-09-03; 016 §1 row 030; 000-INDEX row 030 |
| Jeremy's revision right | Standing. Jeremy may revise any line in this record by a 006 decision-log row naming date, old text, new text and reason (018 §5). Locked decisions 4, 5 and 6 continue to outrank it. |

**What ratification does and does not do.** It binds the *decisions*. It installs nothing: no table, no column, no constraint, no test and no line of code exists as a result of this record, and every §8 invariant remains an unwritten test. The evidence posture of §0 is unchanged by ratification — §1 stays REPRODUCED, everything else stays ASSERTED, and none of it becomes TESTED until the beads in §12 close with artifacts.

## 12. What this record does not decide

- **It does not decide the LCID's format, namespace, lifecycle, or merge/split semantics.** That is **E04-B01**. This record commits only that an LCID exists, that it is Longbox-issued, and that nothing derived from a provider may take its place.
- **It does not design `physical_item`.** That is **E02-B05**: SKU, quantity, location, custody and duplicate invariants, including "two copies remain distinct" and "one copy cannot gain two active listings". §2.4 fixes four contract points and stops.
- **It does not write a migration.** §7 is a sketch. **E02-B07** builds the observation/correction/supersession machinery and **E02-B10** owns ordering, indexes, locking, compatibility and rollback. No DDL exists.
- **It does not build the pack registry.** **E04-B04** ships the manifest as code, the loader, the certification contract and the migration contract for pack changes. §5.1's interface is a sketch of what that bead must satisfy — **and it carries the A3 obligation: a manifest field not exercised by the comic pack is not added until a second pack needs it.** `listingTemplate` and `evalSlices` are reserved names, not fields; adding either is a change to this record's §5.1, recorded as an amend-by-a-row.
- **It does not decide whether pre-catalog confirmations get resolved, or at what bar.** §7.1 creates the mechanism (`identity_resolution`) and states that the table ships empty. Running a resolution pass over pre-catalog `confirmed_issue` blobs, and the confidence bar for doing so, is **E06's** decision.
- **It does not set the import-validation bound.** §10's A7 criterion requires E04-B11 to *measure* it on named reference hardware and set it from the first run. Guessing a number here would be the exact error 018 §2 A3 forbids.
- **It does not populate the rights registry or analyse any licence.** **E04-B05**. §4 rule 4 fixes only the column and the no-import-without-it rule.
- **It does not authorize a second vertical.** **E19-B06** gates that on evidence; §5.4 is an architecture demonstration, and the formula's own first step says architectural possibility is not market permission.
- **It does not amend 029.** §2.6 notes that `physical_item` and `identity_resolution` are missing from 029 §2.2's owned-tables list; adding both is E02-B05's obligation under 029 §9's amend-by-a-row clause.
- **It does not decide the API or event contracts** over any of this (E02-B08), nor the ingest worker that will import a corpus (E04-B11, 029 §2.3).
- **It does not reverse or amend a locked decision.** Locked decisions 4, 5 and 6 constrain this record; where anything here conflicts with one, the locked decision wins.

## 13. The five questions, as answered by the cannon

v1.0.0 put five questions to the cannon. All five came back answered; the answers are recorded here and the ones that changed the design are amendments A1–A8 (§11).

1. **Is `signature_fn_ref` (§5.2) an acceptable seam, or a lie about "packs are data"?** — **Acceptable, kept as drafted.** Neither lens accepted the premise that "packs are data" was ever the claim: §5.2 already said a pack ships a row *and* a small pure module, and a declarative normalization DSL would be a worse, less expressive thing to version. A5 tightens the seam instead of removing it — the function versions with the manifest, at the same rate, in the same row.
2. **Should `edition_signature` be a table or a column?** — **Table (A4).** Split lenses, resolved by the acting head on recoverability rather than frequency: a lossy single signature is unrecoverable under append-only rules and fails silently by minting a duplicate edition; an occasionally-1:1 table costs an indexed-text join. Fowler's dissent (start as a column, promote on a demonstrated alias) is preserved in §11.
3. **Is the corpus-advance rule (§2.2) right that a new corpus version does *not* supersede the old row?** — **Yes, and v1.0.0 mis-stated the cost (A8).** The question said the alternative "gives one current answer per LCID", framing the rule as a loss. It is not. A definition is **a function of `(lcid, corpus_version)`** — an inherently versioned fact — and the rule **correctly refuses to manufacture a fake present-tense answer** for it. Superseding on advance would not *find* a current answer; it would *invent* one by privileging the newest corpus, and would take with it the ability to read a two-year-old `candidate_set` against the catalog it was actually computed against. Requiring the caller to supply an as-of is the fact being honest about its own shape, not an ergonomic tax.
4. **Should pre-catalog confirmations be linked through an append-only `identity_resolution` table instead of a reserved nullable column?** — **Yes. Adopted (A1); the column is dropped.** Both lenses converged on it, and the scope argument that had made it a question rather than a recommendation did not survive: the fact table is *simpler* than the column, not larger, because it replaces two mechanisms with one and removes the two-meanings-of-NULL hazard that no later work could have repaired. §7.1 is the design; the table ships empty and E06 owns whether the pre-catalog pass ever runs.
5. **Does (a) over (c) survive the importer?** — **Yes, provisionally, and now falsifiably (A7).** Neither lens found a reason to reverse on speculation, and both objected to the trade being asserted on the one axis where (c) was rejected without data. So the answer is bound to a measurement: E04-B11 must validate the full GCD dump within a wall-clock bound **set from the first measured run on named reference hardware**, and a bound that cannot be met after batching and compiled-schema caching is the evidence that reopens §3.2's escape hatch — or this record's choice of (a) itself, under a new decision record.
