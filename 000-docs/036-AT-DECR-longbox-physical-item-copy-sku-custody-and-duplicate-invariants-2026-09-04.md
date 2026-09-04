# Decision Record — The Physical Item: Copy Identity, the SKU Seam, Custody, and the Duplicate Invariants

**Version:** 1.1.1 — patch (gate audit): change-log A2 says three columns, not two keys; §5 title names T18 only (T17 is draft success rate in 019); E5 counts seven grep matches; the sale family gets its DDL (§7.2.1). No decision changed.
**Status:** **RATIFIED 2026-09-04** by the acting head of board under Jeremy Longshore's 2026-09-03 delegation, after a two-lens cannon (`rich-hickey-reviewer`, `martin-fowler-reviewer`, both ACCEPT-WITH-CHANGES). Binding per §11. Amendments A1–A6 absorbed in full, none declined; two Fowler dissents preserved in §11.
**Bead:** E02-B05 `longbox-e5b.2.5` (epic LBOX-E02 `longbox-e5b.2`, gate G2, evidence class DEC, owner-role product, risk critical) — see 000-docs/014 §8 row E02-B05
**Drafted:** 2026-09-04 by `longbox-domain-builder` · **Audit:** `longbox-gate-auditor` before close · **Decision owner:** Jeremy Longshore
**Sensitivity:** Restricted internal (014 §10)
**Supersedes:** nothing — first physical-item record.
**Inputs:** 014 §8 rows E02-B05, E02-B07, E02-B10, E05-B04, E06-B04, E10-B03, E10-B06, E10-B07, E10-B08, E10-B09, E10-B12, E11-B05 · 014 §17 (duplicate-inventory risk row) · 015 alias map · 029 v1.1.1 §2.2, §2.7, §2.10, §3.1, §9 (amend-by-a-row), §12 (the request transaction) · 030 v1.1.1 §2.1, §2.4, §2.5, §7, §7.1, §8, §12 · 033 v1.0.1 §2 B5/B7, §5.6, §5.7, §5.8, §7 · 032 v1.0.1 §2 (today's eight-step process; the JAF Comics double-sell) · 034 v1.1.1 §2.4, §2.10, §2.11, §2.12, §2.13, §4, §5, §7 · 019 v1.2.0 T17, T18, T19, T23, T32, T33, K1 · 022 P1, P7 (Q6 holds) · 018 (evidence rules) · `migrations/001_init.sql`, `migrations/002_ebay_credential_kind.sql`, `migrations/003_reserve_principle_slots.sql`, `src/services/shopify.ts`, `src/services/scanSession.ts`, `src/routes/scanSessions.ts` · CLAUDE.md locked decisions 3, 4, 5, 7.

## Change log

**Version convention** (006's, as used by 029/030/034): a **minor** bump means the content of a decision changed; a **patch** means a statement of fact was repaired with no decision changing.

**This is a minor bump, and three of the six amendments change what the schema is.** A reader who acted on v1.0.0's `physical_item.copy_code` **column**, on its assignment of `sale_event` / `return_event` / `refund_event` / `sale_resolution` to **`commerce`**, or on §4.3's ordering of the re-identification mechanisms must re-read §2.2, §2.4, §4.3, §5.1, §7.1, §7.2, §7.5 and §8. No §1 today-claim was disturbed; every one was re-checked against `7359140` and none needed a new cite.

| Version | Date | What changed | Authority |
|---|---|---|---|
| 1.0.0 | 2026-09-04 | Initial draft. Status PROPOSED, §11 unsigned, five questions open in §10. | `longbox-domain-builder` |
| **1.1.0** | **2026-09-04** | **RATIFIED. Six cannon amendments absorbed, none declined.** **A1** (Hickey CHANGE) `physical_item.copy_code` is **no longer a column on the immutable row** — a code is an *assignment*, and assignments are re-made when a sticker is replaced; it becomes the append-only `physical_item_code_assignment` with a self-FK supersession chain, a partial unique index over live codes only, and a `physical_item_current_code` view, exactly the shape `physical_item_identity_correction` already had. §2.2, §4.3, §7.1, §7.2, §7.3 and I7 updated; new invariant **I17**. **A2** (Hickey NOTE, made binding) the arbiter is **kept** and renamed for what it is — a **materialized index over the log**, not a state table — because no honest single-table construction exists and every close-time column flip is a mutation; a **CI schema-diff gate-test (I18)** now fails the build if it ever gains a column beyond its three columns (`physical_item_id`, `shop_id`, `listing_link_id`), guarding *shape* where I9 guards *contents*. Fowler's dissent (measure a `SERIALIZABLE` / `SELECT … FOR UPDATE` binding path at pilot volume **before** building the arbiter) is preserved in §11 and carried as an **E02-B07 build obligation** in §13 — not a ratification block. **A3** (Fowler F3, adopted as a CHANGE) **`sale_event`, `return_event`, `refund_event` and `sale_resolution` move to `workflow`**: a sale originates at a counter as a human act, or arrives through a connector that `workflow` consumes; `commerce` keeps `listing_link` and **derives** the deactivation by consuming the sale fact through the permitted `workflow → commerce` call. This removes the §10 Q5 tension rather than answering it — the in-store sale is no longer a workflow fact wearing a commerce label. §2.4, §5.1 D4, §5.4, §7.2 and §7.5's entry list updated. **A4** (Fowler F2) §4.3 is **re-ordered**: the forced human pick is the **baseline** mechanism and the sticker copy code is **preferred only if the shop stickers** — O1 is OPEN and 032 §2 is SOURCED, never observed — with a sequencing rule written into §13 forbidding any sticker-scanning capture UI before a real shop's stickering is observed. **A5** (Fowler F4) §3.3 records two grep-backed limits: today's `productSet` selection set returns `product { id status }` only, so `external_variant_id` and `external_inventory_item_id` **cannot be filled** without widening it or a follow-up query (E10-B03); and a daily-only reconciliation lets a double sell **sit live for up to 24 hours**, which is a T18 *response-time* gap that only `orders/create` / `orders/paid` webhooks close (E10-B05/B08). New **§10 Q6** names webhooks-vs-poll as open and load-bearing. **A6** the event-set decision (`custody_event` with a `kind` CHECK; separate sale / return / refund / write-off tables) and the whole quantity=1 argument **stand as written** — Hickey found the split correct in both directions. | Two-lens cannon → acting head, §11 |

## 0. Evidence posture

Per 018 A1/A3, and with 029 v1.0.0's gate-audit blocker B1 as the governing lesson (a "today" claim asserted at REPRODUCED on the strength of having read a file, later found false):

- **Every "today" claim in §1 is REPRODUCED at `7359140`** — branch `feat/e02-b05-physical-item-and-copy-invariants`, rebased onto `origin/main` `7359140` (doc 035, PR #44). The branch was first cut at `9f84e3b`; **every cite below was re-run against `7359140` after the rebase rather than carried across**, which is what 029's blocker B1 costs a record that does not. `git diff --stat 9f84e3b 7359140 -- src migrations scripts tests` is **empty** — 035 is docs-only — so every line number re-derives unchanged, and this is a statement of that fact rather than an assumption from it. Each row carries either a `file:line` or the verbatim grep that produced it, **with its exit status**. §1 prints the commands so a reader re-runs them rather than trusting the reading. **A rung is earned by the citation, not by the reading.**
- **Everything in §2–§8 is ASSERTED.** No table, column, index, trigger, view or line of code exists as a result of this record. Every invariant in §8 names a test file that does not exist. This record creates no schema; §7 is a sketch for E02-B07 and E02-B10 to execute.
- **Ratification will not move anything up the ladder.** When §11 is signed it will record that a design was argued and adopted — not that any of it works (018 §2 A3).
- **No numeric threshold is set here.** The one number this record leans on — T18's duplicate physical-listing rate `<0.5%`, with any duplicate reaching a live listing a non-waivable K1 — is quoted from 019 v1.2.0 (`000-docs/019:100`, `:126`, `:130`) and is **never re-derived**. A signed threshold is a decision, not evidence that it is met.
- **No claim is made about the pilot shop's physical process.** 032 §2's eight-step flow is SOURCED from published retailer and vendor writing, not observed at Gotham City Limit. §4's dedupe mechanism therefore names what is OPEN on the shop owner rather than assuming his counter.

## 1. What exists today (REPRODUCED at `7359140`)

| # | Claim | Evidence |
|---|---|---|
| **E1** | **There is no physical copy, custody, SKU, quantity, listing-link, inventory-item or consignment concept anywhere in the tree.** `grep -rniE 'physical_item\|custody\|listing_link\|\bsku\b\|quantity\|consignment\|inventory_item' --include=*.ts --include=*.sql --include=*.js src migrations scripts public tests` returns **zero lines, exit 1**. | grep, exit 1, zero matches |
| **E2** | **There is no sale, return, refund, webhook or reconciliation concept either.** `grep -rniE 'webhook\|reconcil\|sale_event\|return_event\|sold' --include=*.ts --include=*.sql src migrations scripts` returns **zero lines, exit 1**. The system can create a listing and has no way to learn that anything happened to it afterwards. | grep, exit 1, zero matches |
| **E3** | **The only thing standing where inventory identity belongs is `scan_session`, and it is a mutable status row.** `scan_session(id, shop_id, created_by, status CHECK IN ('in_progress','confirmed','drafted','abandoned'), created_at)`; it is deliberately **absent** from the append-only trigger array, and `setSessionStatus` issues a live `UPDATE` against it. | `migrations/001_init.sql:64-70`; trigger array `:174-176` (no `scan_session`); `src/services/scanSession.ts:41` |
| **E4** | **The listing is keyed to the session, not to a copy.** `shopify_draft(id, scan_session_id, shop_id, product_gid, status, error, created_at)` — `scan_session_id` is the only link between a Shopify product and anything physical. | `migrations/001_init.sql:147-155` |
| **E5** | **Nothing stops one session from acquiring many drafts.** There is **no unique index, partial or otherwise, on `shopify_draft`** anywhere in the three migrations — `grep -n shopify_draft migrations/*.sql` returns only the `CREATE TABLE` (`001:147`), the trigger-array membership (`001:176`), the status-CHECK widening (`003:164-166`), one comment (`003:190`) and the `retention_hold.target_table` enum (`003:215`). | grep, seven matches (incl. `003:157`), none an index |
| **E6** | **The draft endpoint has no idempotency guard and no existing-draft check.** `POST /api/shops/:shopId/scan-sessions/:id/draft` validates params, loads the session, requires a confirmation and a pricing snapshot, then calls `client.createDraft(...)` and INSERTs unconditionally. Calling it twice creates **two** `shopify_draft` rows and **two** Shopify products for one book. `grep -rniE 'idempoten' --include=*.ts --include=*.sql src migrations scripts` returns one match, and it is a comment about `media_deletion`. | `src/routes/scanSessions.ts:310-372` (insert at `:362-372`); grep → `migrations/003_reserve_principle_slots.sql:130` only |
| **E7** | **The draft carries no SKU.** `buildProductSetInput` emits `title`, `descriptionHtml`, `status: "DRAFT"`, `productType`, one variant with `price` and `optionValues`, `productOptions` and `files`. There is no `sku` field, no `inventoryItem`, no `inventoryQuantities`, and no external-id mapping written back anywhere. | `src/services/shopify.ts:23-40`; the only stored external id is `shopify_draft.product_gid` (`001:151`), set from `result.productGid` at `src/routes/scanSessions.ts:368` |
| **E8** | **`shopify_draft.status` was widened for the listing lifecycle but knows nothing about a sale.** The enum is `draft \| published \| failed \| delisted \| archived`. A book that sells has no state to move to and no row to record it. | `migrations/003_reserve_principle_slots.sql:164-166` |
| **E9** | **`retention_hold` cannot name a copy.** `target_table` is a closed CHECK over `scan_session \| scan_photo \| shopify_draft \| labor_shift`. 033 §5.8's "first act — the item goes on retention hold" has nothing to point at, and the comment at `003:208-213` already records that nothing in the database verifies tenancy on the polymorphic target. | `migrations/003_reserve_principle_slots.sql:214-215`, comment `:208-213` |
| **E10** | **The session read model hardcodes seven tables and is the only way to assemble "what happened to this book".** `getSessionEvents` iterates a literal list and interpolates each name into `SELECT * FROM ${t} WHERE scan_session_id = $1 AND shop_id = $2`. Anything not hanging off a `scan_session_id` is invisible to it. | `src/services/scanSession.ts:73-81` (list), `:85` (interpolation) — the same read-model coupling 029 §1 fact 1 records |
| **E11** | **There is still no transaction in the request path.** 029 §12's NOTHING-EXISTS-YET block reproduces unchanged at this SHA: the only `BEGIN`/`COMMIT`/`ROLLBACK` in the repository are in the onboarding script. | `scripts/register-shop.ts:46`, `:75`, `:84`; `src/db.ts` exports `getPool`/`closePool` only |
| **E12** | **The correction idioms this record reuses already ship.** `supersedes_id` self-FK plus a partial unique index making a row superseded at most once, on three tables, with `_current` `DISTINCT ON` views over them; and the grant/release pair (`retention_hold` has no `released_at`; a release is a separate row, unique per hold). | `migrations/003_reserve_principle_slots.sql:84-104` (supersession), `:108-124` (views), `:18-21` and `:205-232` (grant/release) |

**What §1 adds up to.** The system can photograph a book, propose an identity, take a human's confirmation, assess condition, price it and create exactly one Shopify DRAFT — and then it **forgets that a physical object was ever involved**. There is no row that means "this copy". The nearest thing is a `scan_session`, which is a *mutable* record of an identification episode (E3) and is the key the listing hangs off (E4). Nothing prevents a second draft on the same session (E5, E6), nothing writes a SKU (E7), nothing records a sale (E2, E8), and nothing can hold a copy (E9).

That is the whole of the duplicate-listing exposure 014 §17 names as a **financial incident** and 019 T18 makes **non-waivable**: *"for a back issue, the physical copy is unique, so a single-copy listing plus an in-store sale is a guaranteed double sell unless something reconciles"* (032 §2, quoting the JAF Comics case study — *"When something was bought in the store, John and his team had to remove it online manually"*, SOURCED, vendor-adjacent). E02-B05 is the missing noun. Like 030 and 034, it is **additive**: no existing table changes meaning, no existing row is touched, and every mechanism it adds is a new table or a new index.

## 2. Decision A — `physical_item` is the inventory identity

### 2.1 The three things, and why the copy is the identity

030 §2.1 already fixed the kinds:

| | `collectible_definition` | `edition` | **`physical_item`** |
|---|---|---|---|
| Kind | a **value**, versioned | a **value**, versioned | **an identity** |
| Rows per key | many (one per corpus version, plus corrections) | many, same rule | **exactly one** |
| Shop-scoped | no | no | **yes**, `shop_id` FK |
| Owner module | `catalog` | `catalog` | **`workflow`** (029 §2.2) |

A `physical_item` is **one row per physical copy, for the life of that copy**. It is the only entity in Longbox that corresponds to an object you can drop. Everything that happens to it — where it is, what channel it is listed on, that it sold, that it came back, that it was lost — is an **immutable timestamped record appended to it**, never a column that gets updated. That is locked decision 4 applied to inventory rather than to the scan chain, and it is the same shape `scan_session` has for identification (030 §2.1's "the row is never updated; its condition, custody and listing history are appended records elsewhere").

### 2.2 The row

```
physical_item(
  id                        uuid PK DEFAULT gen_random_uuid(),
  shop_id                   uuid NOT NULL REFERENCES shop(id),          -- locked decision 4
  edition_lcid              text NOT NULL REFERENCES lcid_registry(lcid), -- 030 §2.5, never a provider id
  vertical                  text NOT NULL,                              -- 030 §3.1; selects the pack
  origin                    text NOT NULL
      CHECK (origin IN ('scan','bulk_intake','manual')),
  created_from_confirmation_id uuid REFERENCES human_confirmation(id),  -- NULL unless origin='scan'
  intake_batch_id           uuid REFERENCES batch(id),                  -- 034 §2.11; NULL for pre-batch and manual
  ownership                 text NOT NULL DEFAULT 'owned'
      CHECK (ownership IN ('owned','consignment')),                     -- §6
  created_by                uuid REFERENCES app_user(id),
  created_at                timestamptz NOT NULL DEFAULT now(),

  CHECK ((origin = 'scan') = (created_from_confirmation_id IS NOT NULL))
)
```

**Immutable.** Append-only trigger (`forbid_mutation()`, the `001:171-182` loop). No `updated_at`, no `status`, no `location_id`, no `bin_id`, no `sku`, no `quantity`, no `sold_at`, **and no `copy_code`** (A1). Every one of those is either a fact appended elsewhere (§2.4) or a thing this record refuses to model (§2.3, §3).

**Why `copy_code` is not a column (A1, Hickey).** v1.0.0 carried `copy_code text` on this row with a partial unique index. The cannon struck it, and the reasoning generalises past this record: **a code is an *assignment*, not a property.** Stickers fall off, get soaked, get covered by a second sticker, and get re-printed when a shop changes its label stock — so a copy's code is re-assigned over its life, and re-assignment on an immutable row is impossible by construction (the trigger refuses the UPDATE; the row cannot be edited; `001:171-182`). A column would have forced exactly one of three bad outcomes: an illegal UPDATE, a permanently wrong code, or a second copy created because nobody could re-label the first. The last is the failure this whole record exists to prevent.

So a code assignment is its own append-only fact, in the same shape §2.2's identity correction already uses:

```
physical_item_code_assignment(
  id               uuid PK DEFAULT gen_random_uuid(),
  shop_id          uuid NOT NULL REFERENCES shop(id),
  physical_item_id uuid NOT NULL REFERENCES physical_item(id),
  copy_code        text NOT NULL,
  supersedes_id    uuid REFERENCES physical_item_code_assignment(id),
  assigned_by      uuid REFERENCES app_user(id),
  created_at       timestamptz NOT NULL DEFAULT now() )
```

Append-only, workflow-owned, with the two indexes that make it a mechanism rather than a log:

```sql
-- A row is superseded at most once: a re-label chain, never a fork (003:98-104).
CREATE UNIQUE INDEX physical_item_code_supersedes_once_idx
  ON physical_item_code_assignment (supersedes_id) WHERE supersedes_id IS NOT NULL;

-- A LIVE code is unique per shop. Retired codes are deliberately NOT in the index:
-- a re-printed sticker must be allowed to reuse a string a dead assignment holds,
-- and a superseded row is exactly "the sticker that is no longer on the book".
CREATE UNIQUE INDEX physical_item_code_live_once_idx
  ON physical_item_code_assignment (shop_id, copy_code)
  WHERE supersedes_id IS NULL;
```

**This is a genuine partial unique index, and it works where §5.2's could not** — the difference is worth naming, because the two look alike and behave differently. Here "live" is `supersedes_id IS NULL`, a column of *this* table, so the predicate is legal. In §5.2, "active" means *no row exists in a second table*, which no partial index predicate can reach. The distinction is which table holds the terminator, and it is the reason one rule gets an index and the other needs an arbiter.

`physical_item_current_code` (§7.3) is the read model: the newest non-superseded assignment per copy, the `003:108-124` `DISTINCT ON` shape. **A copy with no assignment row has no code**, which is the truthful state for every unstickered book and every copy created before a shop adopted codes — an absence, not a NULL with two meanings (030 A1's rule).

**Where it comes from.** Two creation paths and one escape hatch:

1. **From a confirmed scan** (`origin='scan'`). The copy is created in the same transaction as the `human_confirmation` that identified it (029 §12), carrying that confirmation's id. A copy therefore cannot exist without a human having said what the book is — which is locked decision 7's boundary drawn one level further out: the machine proposes an edition, a person confirms it, *and only then does an inventory identity exist*.
2. **From bulk intake** (`origin='bulk_intake'`). A shop that already knows what is in a box — a dealer manifest, a spreadsheet, a prior system's export — creates copies without a scan. There is no confirmation to point at and the FK is NULL, which the CHECK makes an honest statement rather than a hole: `origin` says which era the row is from, and 030 A1's lesson applies (when the schema cannot distinguish "never captured" from "captured and empty", make the distinction explicit rather than documenting a NULL).
3. **`origin='manual'`** covers an owner creating a copy by hand in the review surface. Named so it does not arrive later as a fourth meaning of one of the other two.

**The edition reference is to the LCID, never to a row** (030 §2.5). A corpus advance therefore orphans no copy (030 I11), and a catalog correction re-resolves every copy that points through the corrected LCID without touching a single inventory row.

**A copy's edition can be corrected without mutating the copy.** The identification was human and humans are wrong — 033 §5.6's owner edits identity, 033 §5.8's buyer says the book is not what the listing said. Since `physical_item` is immutable, a re-identification is a new fact:

```
physical_item_identity_correction(
  id uuid PK, shop_id uuid NOT NULL REFERENCES shop(id),
  physical_item_id uuid NOT NULL REFERENCES physical_item(id),
  edition_lcid text NOT NULL REFERENCES lcid_registry(lcid),
  reason text NOT NULL, corrected_by uuid REFERENCES app_user(id),
  supersedes_id uuid REFERENCES physical_item_identity_correction(id),
  created_at timestamptz NOT NULL DEFAULT now() )
```

Append-only, `supersedes_id` unique-where-not-null (the `003:98-104` pattern, E12), so the correction history is a chain and never a fork. `physical_item_current` (§7) reads the newest non-superseded correction and falls back to the row's own `edition_lcid`. **This is deliberately not `identity_resolution`** (030 §7.1): that table is a statement about a *`human_confirmation`* — how a scan's confirmation resolved to an edition, per corpus version. This one is a statement about a *copy*. They answer different questions and a copy can outlive every session that ever touched it.

### 2.3 Quantity: why the column does not exist

**A `physical_item` is one copy. There is no `quantity` column, and the comics core has nothing that needs one.**

A quantity is only meaningful over **fungible** goods, and a good is fungible when three things are true at once:

1. **Its condition is not assessed per unit.** Two units are graded the same because they *are* the same.
2. **Its price is a function of the definition alone**, not of the unit.
3. **A buyer cannot prefer one unit over another**, so which one ships is arbitrary.

A back issue fails all three, and fails them in the schema, not just in spirit. `condition_assessment` is per-`scan_session` — per copy — and carries a grade *range* plus a `defects text[]` (`001:122-131`), which is a per-unit statement by construction; locked decision 5 makes it a human's per-copy judgement that can never collapse to a number. `pricing_snapshot.suggested_cents` is computed against that condition (`src/routes/scanSessions.ts:275-302`). And a collector choosing between a VG copy with a spine tick and an FN copy is exercising exactly the preference fungibility denies. **Two copies of Amazing Spider-Man #300 are two rows, forever, and merging them into `quantity: 2` destroys both grades, both defect lists and both prices.**

So the rule, stated so a future vertical does not reach for the column by reflex:

> **Quantity is a property of non-unique goods. It never appears on `physical_item`.** A vertical whose goods are genuinely fungible — bagging supplies, a new-issue subscription pull, a sealed case of boosters — models them as a **pack-owned stock lot**, a different entity with its own table, not as an integer on the copy. Adding `quantity` to `physical_item` is a superseding decision record, never a migration.

The escape hatch is named so option (b) is not a trap, in the same shape as 030 §3.2's: if a vertical proves fungible goods matter, it registers a `stock_lot` concept in its pack (030 §5.1), and the core stays one-row-per-copy. Nothing in the comic vertical needs it, and E19-B06 gates any second vertical on evidence anyway.

**One consequence worth stating.** This makes Longbox structurally unlike generic retail inventory, and that is the product. A Shopify variant with `inventoryQuantity: 12` is a claim about interchangeable units; a long box holds twelve *different* books that happen to share a title. §3 is where that difference becomes a SKU rule.

### 2.4 The state facts, appended

Append-only tables hang off a copy. Each is a *thing that happened*, in the 034 §4.2 sense — never a statement about the present.

| Table | What one row means | Owning module |
|---|---|---|
| `physical_item_identity_correction` | the copy is a different edition than first recorded | `workflow` |
| `physical_item_code_assignment` | a code was written on this copy's bag (A1, §2.2) | `workflow` |
| `custody_event` | the copy moved, or its physical disposition changed | `workflow` |
| `write_off_event` | the copy left inventory without a sale | `workflow` |
| **`sale_event`** | the copy was sold, on a named channel | **`workflow`** (A3 — moved from commerce) |
| **`return_event`** | a sold copy came back | **`workflow`** (A3) |
| **`refund_event`** | money went back for a named sale | **`workflow`** (A3) |
| **`sale_resolution`** | which of two competing sales is fulfilled (§5.4) | **`workflow`** (A3) |
| `listing_link` | the copy was bound to a channel listing | **`commerce`** (§3) |
| `listing_link_deactivation` | that binding ended, and why | **`commerce`** |
| `physical_item_active_listing` | *(not an event — the D1 materialized index over the log, §5.2)* | **`commerce`** |

Current state is **always a derived view** over these (§7): `physical_item_current`, `physical_item_current_code`, `listing_link_active`, `physical_item_custody_current`, `physical_item_disposition`. No view holds state; each is a `DISTINCT ON` or a `NOT EXISTS` read model in the shape already shipping at `003:108-124`.

`custody_event` and `write_off_event` are specified in §6; the sale family and the listing pair in §5 and §3.

**Where the module line falls, and why the sale sits on the workflow side (A3, Fowler F3).** 029 §3.1 forbids an L2→L2 import edge and gives `workflow` (L3) the right to call every L2 module. A copy's *existence, whereabouts and fate* is workflow's — it is the unit of work the scan flow and the batch produce. A copy's *binding to an outward channel* is commerce's, because 029 §2.7 already owns "the LCID↔SKU↔external-ID mapping (E10-B03), duplicate prevention across retries, the transactional outbox and idempotency (E10-B09), webhook/poll reconciliation, and the observed listing lifecycle".

v1.0.0 put `sale_event` on the commerce side, and §10 Q5 put its own unease about that to the cannon. **Fowler's answer was that the draft had the direction backwards, and it is adopted as a change rather than an answer:**

> A sale is not a channel's event that a copy happens to be attached to. **It is the copy's event**, and the most important one — the moment the object stops being inventory. The clearest case is the one that matters most: an **in-store sale** originates at a counter as a human act, with no connector, no webhook and no external id anywhere in it (032 §2's double sell begins exactly there). Assigning that to `commerce` would have made the purest workflow fact in the system reachable only through the module that talks to Shopify, and would have forced the in-store path to pretend to be a channel event to get itself recorded.

So `sale_event`, `return_event`, `refund_event` and `sale_resolution` are **workflow-owned**. A channel-originated sale is a connector observation that `commerce` receives and hands **up** to `workflow` — which is the direction 029 §3.1 already permits — and `workflow` writes the fact. `commerce` then **derives** the consequence: on the same transaction handle, `workflow` calls commerce's public `deactivateForSale(tx, physical_item_id, sale_event_id)`, which writes the `listing_link_deactivation` and frees the arbiter. The dependency edge is `workflow → commerce`, which the layer stack allows; **no new edge is created and no L2→L2 edge appears**.

The property this buys is the one D4 (§5.1) needs: **there is exactly one writer of a sale, and both the counter and the connector reach it.** Under v1.0.0's assignment there would have been a strong pull toward two paths, because one caller was inside the owning module and the other was not.

## 3. Decision B — the SKU is a commerce-owned mapping, not a column on the copy

### 3.1 The seam, named

This is the seam 030's gate audit flagged and the bead note asks to name before any migration:

> **`physical_item` does not carry a SKU. It never has one.** The SKU is one field of a **commerce-owned mapping row** that binds a copy to a *particular listing on a particular channel*. The mapping is `commerce`'s (029 §2.7, E10-B03); the copy is `workflow`'s (029 §2.2). The arrow points from the mapping to the copy, one way.

Three reasons the column is wrong, in increasing order of cost:

1. **A copy can be listed on more than one channel over its life** — Shopify now, Whatnot later after it fails to sell (locked decision 3's roadmap). Those are two different external identifier spaces with two different string formats. One column would have to hold both, or the second channel would need a second column, and the day it needs a third the copy's row is a channel registry.
2. **A SKU is a channel's name for a thing; an LCID is ours.** 030 §2.5's rule and 014 §18 decision 3 say a provider identifier is never a key and never an FK target. A `sku` column on the inventory identity is that rule broken one level down: the shop's Shopify SKU convention would become a property of the copy itself, and changing the convention would mean rewriting immutable rows.
3. **`physical_item` is append-only.** A SKU on the row could never be corrected — and shops correct SKU conventions. The mapping row can be superseded; the copy cannot.

**What Longbox issues, and what it never does.** Longbox **issues** the SKU (it is the shop's identifier for the copy, and the shop needs one that is stable and greppable) and **records** the channel's own ids as returned. It never uses a channel id as an identity: `external_product_id` is data on the mapping row, not a key of anything.

### 3.2 The mapping

```
listing_link(
  id                          uuid PK DEFAULT gen_random_uuid(),
  shop_id                     uuid NOT NULL REFERENCES shop(id),
  physical_item_id            uuid NOT NULL REFERENCES physical_item(id),
  channel                     text NOT NULL
      CHECK (channel IN ('shopify','whatnot','ebay')),          -- 'shopify' is the only v0 writer
  sku                         text NOT NULL,                    -- Longbox-issued; §3.3
  external_product_id         text,                             -- Shopify product GID; NULL until the channel answers
  external_variant_id         text,
  external_inventory_item_id  text,
  shopify_draft_id            uuid REFERENCES shopify_draft(id),-- the existing row this binding was created from
  idempotency_key             text NOT NULL,                    -- E10-B09; §5.2
  created_by                  uuid REFERENCES app_user(id),
  created_at                  timestamptz NOT NULL DEFAULT now()
)

listing_link_deactivation(
  id               uuid PK DEFAULT gen_random_uuid(),
  shop_id          uuid NOT NULL REFERENCES shop(id),
  listing_link_id  uuid NOT NULL REFERENCES listing_link(id),
  reason           text NOT NULL
      CHECK (reason IN ('sold','delisted','archived','withdrawn','error','superseded')),
  sale_event_id    uuid REFERENCES sale_event(id),              -- NOT NULL in effect when reason='sold' (CHECK)
  ended_by         uuid REFERENCES app_user(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK ((reason = 'sold') = (sale_event_id IS NOT NULL))
)
UNIQUE (listing_link_id)      -- a binding ends at most once
```

Both append-only. **The grant/release idiom, not `supersedes_id`** — and for exactly the reason 034 §2.7 gives for `membership`: a deactivation says *"that binding ended"*, not *"that binding was wrong"*. The earlier row was never incorrect; there is no replacement. `retention_hold` / `retention_hold_release` (`003:18-21`, `:205-232`) is the shipped precedent and it was written for the same distinction. **A binding that was genuinely wrong** — the wrong copy attached to a listing — ends with `reason='error'` and a note; the corrective binding is a new row, and that pair reads as what happened.

### 3.3 How the three channels map

| | **Shopify (v0, locked decision 3)** | **Whatnot (roadmap, Phase 4)** | **eBay (valuation only today)** |
|---|---|---|---|
| What we create | one `productSet` product per copy, `status: DRAFT` (`src/services/shopify.ts:28`) | one row in a bulk CSV export | — |
| `sku` | written into the variant's `sku` field, which `buildProductSetInput` does **not** emit today (E7) — adding it is E10-B03's | the CSV's SKU column | — |
| `external_product_id` | `gid://shopify/Product/…`, already returned and stored on `shopify_draft.product_gid` (`001:151`, written at `routes/scanSessions.ts:368`) | none until the Seller API is open — a CSV export gets no id back, so the row's external ids stay NULL and the binding is **provisional** | — |
| `external_variant_id` | `gid://shopify/ProductVariant/…` — **not requested by the current mutation**; `PRODUCT_SET_MUTATION` selects only `product { id status }` (`shopify.ts:12-17`) | — | — |
| `external_inventory_item_id` | `gid://shopify/InventoryItem/…` — Shopify's own per-variant stock handle. Longbox **records** it and never writes a quantity against it; §2.3 is why | — | — |
| Reconciliation handle | the product GID, for the webhook/poll path (E10-B08) | none — a CSV export cannot be reconciled, which is precisely why Whatnot is a **roadmap** channel and not a v0 one | eBay is a **pricing** provider (`src/services/ebay.ts`), not a commerce channel; the enum value is reserved so a future connector does not invent a rival spelling |

**A consequence to state rather than discover.** Whatnot's bulk-CSV shape means a copy listed there has an active `listing_link` with no external id, so the T18 detector (§5.3) can see the *binding* but nothing can confirm the *listing's* state. That is a real gap, it is inherent to a CSV channel, and it is the argument for applying to the Seller API early (locked decision 3) rather than treating CSV as the end state. Until then, a Whatnot binding is **withdrawn by a human act**, never by a webhook.

#### 3.3.1 Two limits this record must not gloss (A5, Fowler F4)

Both are REPRODUCED at `7359140`, and both are obligations on other beads rather than defects in this design. Naming them here is the point: a schema that has columns for facts nothing can currently supply is a schema that will quietly carry NULLs forever unless someone is on the hook.

**Limit 1 — two of the three external-id columns cannot be filled by today's code.** `PRODUCT_SET_MUTATION` selects `product { id status }` and `userErrors { field message }` and **nothing else** (`src/services/shopify.ts:12-17`), so the variant GID and the inventory-item GID are never returned; and `buildProductSetInput` emits a variant carrying `price` and `optionValues` only (`shopify.ts:30-36`), so no `sku` is sent either. `external_variant_id` and `external_inventory_item_id` are therefore **reserved columns with no writer today**, and closing that needs one of two things from **E10-B03**: widen the selection set to request `variants(first: 1) { nodes { id inventoryItem { id } } }`, or issue a follow-up query against the returned product GID. **This record does not choose between them** — that is a Shopify-API shape question E10-B03 owns — but it does forbid the third option of leaving them unwritten and calling the mapping complete, which is what §8 I3's NULL-tolerance would otherwise permit indefinitely.

**Limit 2 — a daily detector lets a double sell sit live for up to 24 hours, and that is a T18 *response-time* gap, not a coverage gap.** §5.3's query finds every breach; it finds it **on the next run**. 019 T18 makes any duplicate reaching a live listing a non-waivable K1, and the harm accrues continuously while the second listing is purchasable — the whole exposure 032 §2 describes is a buyer paying for a book that is already gone. **Detection latency is therefore part of the threshold's meaning**, and a daily-only reconciliation is the weakest posture that can still be called compliant. What closes it is push, not poll: Shopify's `orders/create` and `orders/paid` webhooks (E10-B05 for the signed receiver, E10-B08 for reconciliation), which reduce the window from a day to seconds for the channel-originated half. **There is no webhook receiver of any kind today** — `grep -rniE 'orders/create|orders/paid|orders_create|/webhooks|hmac|x-shopify-hmac' --include=*.ts --include=*.sql --include=*.js src migrations scripts public` returns **zero lines, exit 1**. The in-store half is not closed by any webhook and stays bounded by how fast a human tells the system (D4). §10 Q6 puts the webhooks-vs-poll trade to the cannon as load-bearing for response time rather than for correctness.

**SKU format is not decided here.** The SKU is Longbox-issued, stable for the life of the binding, and unique per shop and channel (§8 I6). What characters it uses, whether it embeds the copy code (§4), and how it collides with a shop's existing convention is **E10-B03's**, informed by the shop's own catalogue at onboarding (033 §7: *"written the way the shop's own catalogue writes it"*).

## 4. Decision C — a scan session is not a copy, and how a re-scan finds one

### 4.1 The distinction

> **A `scan_session` is an identification episode. A `physical_item` is an object.** A session is a thing that *happened* — someone photographed a book at a moment and a chain of records hangs off it. A copy is a thing that *exists*, and it exists before, between and after every session that touches it.

Concretely: a confirmed session produces **at most one** copy. Zero if it was abandoned, if the human abstained, or if the session was a re-scan of a copy that already exists. Never two.

This is the acceptance criterion "the current scan session is not inventory identity", and E3/E4 say why it is not merely a modelling nicety: `scan_session` is **mutable** (`setSessionStatus` UPDATEs it at `scanSession.ts:41`, legal because the table is absent from the trigger array at `001:174-176`) and the listing hangs off it (E4). An inventory identity that can be UPDATEd, and whose only key to a listing is a mutable row, is not an identity at all.

### 4.2 The re-scan problem, stated honestly

A book comes back to the counter. Maybe it never sold and is being re-listed; maybe a buyer returned it; maybe someone is scanning the same box twice. **Nothing in a photograph can tell one copy from another.** 014 §8 row E06-B04 already says this in its non-goal — *"Never equate a cover duplicate with the same physical copy"* — and it is the load-bearing constraint here: content hash, perceptual hash and every similarity method identify an **edition**, and two copies of the same book photographed on the same counter under the same light produce near-identical images. Any mechanism that infers copy identity from an image is wrong by construction, and locked decision 6 forbids building the index that would tempt us to try.

So copy identity has to come from **the physical object carrying a mark**, or **from a human**.

### 4.3 The mechanism: a human baseline, with a code path that must earn its place

**Re-ordered at ratification (A4, Fowler F2).** v1.0.0 called the sticker code the *primary* mechanism and the human pick a *fallback*. That ordering asserted more than the evidence carries: the sticker step it rides on is **032 §2's, which is SOURCED from published retailer writing and has never been observed at the pilot shop** (§4.4 O1). Building the primary path on an unobserved shop habit is the same error 018 §2 caps at ASSERTED, and it would have shaped the capture UI around a step that may not exist. So the two swap places, and the code path acquires a precondition.

**Baseline — a forced human pick, never an automatic merge.** This is the mechanism that always works, needs nothing on the object, and ships first. On confirmation, if this shop already holds an **unsold** copy of the same `edition_lcid`, the employee is shown them and must answer: *this is one of these books* → `method='human_pick'`, or *this is another copy* → a new copy. Same shape as locked decision 7's contradiction gate: ambiguity forces a human, and no guess is substituted (033 §1 A6's rule for identity, applied to copies).

**The prompt is scoped, so it stays cheap.** It fires only when a candidate exists — and 032 §1.3's slice says two thirds of a back-issue catalogue's rows are sold out and still listed, so most editions have no unsold copy to collide with. Whether the candidate set is scoped to the bin (034 §2.10), the location, or the shop is **OPEN** (§10 Q3): bin-scoping matches how a shop actually works and keeps the list to one screen, but it silently misses a copy that was moved.

**Preferred, *if and only if* the shop stickers — the copy code.** 032 §2's step 4 is *"bag, board, price-sticker"*. **If** a shop's counter really does apply a sticker as routine work, then the cheapest deterministic re-identification is to put a short, human-typeable, check-digited **copy code** on that same sticker at that same moment — no new step, no new equipment, and a re-scan becomes an exact lookup instead of a judgement. That is a genuinely better mechanism than the human pick **where the precondition holds**, which is why it is preferred rather than merely permitted.

The code is recorded as an **assignment**, not as a property of the copy (A1, §2.2): `physical_item_code_assignment`, append-only, superseded when a sticker is replaced, unique per shop across live assignments only.

**The sequencing rule that keeps the preference honest.** The schema for code assignments lands with this record's migration, because a table costs nothing and an append-only slot cannot be added retroactively (`003:4-7`). **No capture-flow UI for sticker scanning or code entry is built before a real shop's stickering has been observed** — that is a rule on E05-B04, written out in §13. The order is: observe (E01-B02) → then build the affordance, or don't. A shop that does not sticker loses nothing but an unused table.

A re-scan reads the code (typed, or photographed as a fourth `scan_photo.kind`), and the session **resolves** to the existing copy rather than creating a new one. That resolution is itself a record:

```
scan_session_item_resolution(
  id uuid PK, shop_id uuid NOT NULL REFERENCES shop(id),
  scan_session_id uuid NOT NULL REFERENCES scan_session(id),
  physical_item_id uuid NOT NULL REFERENCES physical_item(id),
  method text NOT NULL CHECK (method IN ('created','copy_code','human_pick')),
  resolved_by uuid REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now() )
UNIQUE (scan_session_id)   -- a session resolves to at most one copy
```

Append-only, workflow-owned. `method='created'` is the first scan; the other two are re-scans. **The `UNIQUE (scan_session_id)` is the acceptance criterion as a constraint**: one session, at most one copy, enforced by Postgres rather than by care. Recording *which* method actually ran is what turns O1 from an assumption into a measurement — after Pilot A the ratio of `copy_code` to `human_pick` says whether the preference was right, and neither this record nor E05-B04 has to guess.

**What is explicitly forbidden**, so it does not arrive as a convenience later:

- **Never** infer copy identity from image similarity, a content hash, a perceptual hash or an LLM (E06-B04's non-goal; locked decision 6).
- **Never** auto-merge two copies because their edition, grade range and bin match. That is three coincidences, not an identity, and merging is unrecoverable under append-only rules.
- **Never** treat "the shop has exactly one unsold copy of this edition" as proof. It is a *default* the human confirms, not an answer.

### 4.4 What is OPEN

| # | Open question | Closes at |
|---|---|---|
| O1 | **Will the pilot shop apply a code sticker at all?** 032 §2 is SOURCED from published retailer writing, not observed at Gotham City Limit. **This is the precondition on the whole preferred path (A4):** if the shop owner's counter does not sticker, the code mechanism has no carrier, the human pick is the only path, and no sticker UI is built. | E01-B02 observation / the discovery call (028) |
| O2 | **The code's format, length and check digit**, and whether it is printed, written or a small label-printer job. Gated behind O1 — there is no point specifying a code nobody will write. | E05-B04 (the capture flow) + E10-B03 (the SKU, if the two share a body) |
| O3 | **The candidate scope for the human pick** — bin, location or shop (§4.3). Now on the **baseline** path rather than the fallback, so it matters more than v1.0.0 implied. | E05-B04, informed by Pilot A |
| O4 | **Whether a returned copy re-enters through the same resolution path** or through the return surface. §5.4 assumes the latter. | E10-B08, E11-B05 |

None of these is decided here, and none blocks the schema. **A copy with no code assignment simply has no code** — an absence, not a NULL with two meanings (A1) — and `scan_session_item_resolution.method` records which path actually ran, so the pilot **measures** which mechanism shops use instead of the record guessing.

## 5. Decision D — the duplicate invariants and reconciliation (T18)

### 5.1 The rules

**D1 — At most one active `listing_link` per `physical_item`, across all channels.** Not per channel. A copy on Shopify and Whatnot simultaneously is a guaranteed double sell the moment either sells, and 032 §2 records that a real multi-channel retailer's coping mechanism was *"to avoid listing the same item on two channels at all"*. If a shop ever needs a genuine multi-channel reservation model, that is 014 §8 E10-B06's named exception (*"unless an authorized multi-channel reservation model applies"*) and it is a **new decision record**, not a relaxed index.

**D2 — At most one `physical_item` per (shop, channel, external product id).** The mirror rule. D1 stops one copy from getting two listings; D2 stops two copies from being bound to one listing, which is how a double sell arrives from the other direction (the shop lists one copy, sells it, and a second copy is quietly attached to the same product to "restock" it).

**D3 — A sale on any channel deactivates the binding and records the sale, in one transaction.** Not "eventually"; not "when the sweep runs". 029 §12's request transaction is the mechanism: `workflow` opens the transaction, writes the `sale_event` (A3 — it owns that table), and on the same handle calls commerce's `deactivateForSale(tx, …)`, which writes the `listing_link_deactivation` and frees the arbiter. A partial failure rolls both back. A `sale_event` with a still-active binding is a half-written chain and is indistinguishable after the fact from a copy that is still for sale (029 §12 point 4).

**D4 — The in-store path and the online path write the same facts, through one function (A3).** An in-store sale is `sale_event(channel='in_store')`; a Shopify sale is `sale_event(channel='shopify')`; both append the same rows and free the same arbiter (§5.2). **There is no POS-specific write path and there must never be one**, because a second path is a second place for the invariant to be forgotten — and forgetting it is precisely the JAF Comics failure (032 §2: *"John and his team had to remove it online manually"*).

**A3 is what makes D4 structural rather than a discipline.** With `sale_event` owned by `workflow`, the counter sale and the connector sale reach the *same writer in the same module*: the human act calls it directly, and a channel observation arrives through `commerce` and is handed up. Under v1.0.0's assignment of `sale_event` to `commerce`, the in-store sale — a fact with no connector, no webhook and no external id anywhere in it — would have had to travel *into* the channel module to be recorded, and the pull toward a second, simpler in-store path would have been constant. One owner, two callers.

Today Longbox has **no POS integration and no webhook receiver** (E2; and the A5 grep in §3.3.1 returns zero lines), so the in-store sale reaches the system as a **human act in the owner/exception surface** (033 §2 B7, E11-B05) until a connector exists. That is a gap this record states rather than papers over: **the duplicate invariant is enforceable the moment the fact arrives, and today the fact arrives by hand** — which is also why §3.3.1's limit 2 treats detection latency as part of T18's meaning.

**D5 — Nothing is ever deleted.** A double sell is repaired by appending (§5.4).

### 5.2 Enforcing D1: what a partial unique index can and cannot do

The obvious construction — `CREATE UNIQUE INDEX ON listing_link(physical_item_id) WHERE active` — **does not work, and the reason is worth writing down** so it is not re-attempted under time pressure at E02-B07:

> "Active" means *no `listing_link_deactivation` row exists for this binding*. A partial unique index's predicate may only reference **columns of its own table**. PostgreSQL has no cross-table constraint, and no `WHERE NOT EXISTS (...)` index predicate. Putting a `deactivated_at` column on `listing_link` would make it indexable — and would require an `UPDATE` on an append-only table, which the trigger forbids and locked decision 4 forbids for better reasons.

So the guarantee is bought with one extra table, whose entire job is to be unique:

```
physical_item_active_listing(
  physical_item_id uuid PRIMARY KEY REFERENCES physical_item(id),
  shop_id          uuid NOT NULL REFERENCES shop(id),
  listing_link_id  uuid NOT NULL UNIQUE REFERENCES listing_link(id) )
```

**It is a materialized index over the log, and calling it that is the decision (A2, Hickey).** The cannon accepted the table and rejected the word "arbiter" as doing too little work: an arbiter sounds like a small authority, and an authority is a thing that can acquire opinions. What this actually is, precisely, is **a materialized index** — the same category as a B-tree — over a predicate on the immutable log `listing_link ⋈ listing_link_deactivation`. It holds no fact that is not fully derivable from that log; it carries no timestamp anyone reads, no reason and no actor. Binding a copy INSERTs a row; deactivating DELETEs it. It gets **no append-only trigger**, and that is not a Hickey violation because *there is nothing here to preserve* — deleting a row from it destroys no history, exactly as dropping an index destroys no data.

Hickey's accompanying note is why the table survives rather than being engineered away: **no honest single-table construction exists.** Every alternative reduces to storing "is this binding still open" *on the binding*, and since a binding's openness is decided later, storing it means flipping a column at close time — **a mutation on an append-only row**, which is the thing locked decision 4 exists to forbid. The choice is not between a clean design and a compromised one; it is between a derived index that is honestly labelled and a mutation that is dishonestly hidden.

The `PRIMARY KEY (physical_item_id)` is what makes D1 a **database guarantee under concurrency**: two simultaneous bind attempts do not both read "no active link" and proceed; the second blocks on the key and then fails. That race is the exact failure E10-B06 is written to prevent (*"Concurrency/property tests yield at most one active listing per copy"*), and a check-then-insert trigger would not close it.

**Two guards, because a derived table can fail in two different ways.**

| Failure | Guard | Where it runs |
|---|---|---|
| **Contents drift** — the table disagrees with the log it derives from | **I9**: rebuild it from `listing_link ⋈ listing_link_deactivation` and assert byte-identity | CI **and** daily, as arm 4 of §5.3 |
| **Shape drift** — the table acquires a column and quietly becomes a state table | **I18 (new, A2)**: a CI schema-diff gate-test that **fails the build** if `physical_item_active_listing` ever holds any column other than `physical_item_id`, `shop_id` and `listing_link_id` | CI, required check |

I18 is the amendment that makes the "materialized index" claim enforceable rather than aspirational. The failure mode it catches is entirely realistic and would be gradual: someone adds `bound_at timestamptz` for debugging, then `bound_by`, then a `reason` — and at some point the table holds facts that exist nowhere else, the rebuild in I9 can no longer reproduce it, and the log has quietly stopped being the source of truth. **A column on this table is a design change, not a convenience**, and the gate makes a reviewer say so out loud.

Fowler dissented on building the table at all before measuring the alternative; that dissent is preserved in §11 and carried as an E02-B07 obligation in §13.

D2 needs no such index table and is a genuine partial unique index on `listing_link` itself:

```
CREATE UNIQUE INDEX listing_link_external_once_idx
  ON listing_link (shop_id, channel, external_product_id)
  WHERE external_product_id IS NOT NULL;
```

Partial because a Whatnot CSV binding and a not-yet-answered Shopify call both have NULL there (§3.3), and NULLs must not collide with each other.

**And the missing idempotency guard is closed here too.** E6 shows `POST …/draft` creating a second Shopify product on a second call with nothing to stop it. `listing_link.idempotency_key` plus `UNIQUE (shop_id, channel, idempotency_key)` makes the retry a no-op at the database rather than at the caller's discretion — E10-B09's outbox and retry budget then have something to be idempotent *against*.

### 5.3 The T18 detector, as SQL

Runs daily, per shop, and emits a T34 heartbeat whether or not it finds anything (019 T34: a stale detector is itself a K1 trigger). It has four arms; **each returns zero rows in a healthy system.**

```sql
-- ============ T18 daily reconciliation — 019 v1.2.0 T18, non-waivable ==========
-- Arm 1: a copy with more than one active listing (D1 breached).
--        Computed from the EVENT TABLES, not from the materialized index — an
--        index that agrees with itself proves nothing (029 §1's lesson: a rung is
--        earned by the citation, not by the reading).
WITH active AS (
  SELECT ll.id, ll.shop_id, ll.physical_item_id, ll.channel,
         ll.external_product_id, ll.created_at
  FROM   listing_link ll
  WHERE  NOT EXISTS (SELECT 1 FROM listing_link_deactivation d
                     WHERE d.listing_link_id = ll.id)
)
SELECT 'arm1_copy_with_multiple_active_listings' AS finding,
       a.shop_id, a.physical_item_id,
       count(*) AS active_links, array_agg(a.id) AS listing_link_ids,
       bool_or(sd.status = 'published') AS reached_live   -- K1 discriminator
FROM   active a
LEFT   JOIN listing_link ll  ON ll.id = a.id
LEFT   JOIN shopify_draft sd ON sd.id = ll.shopify_draft_id
GROUP  BY a.shop_id, a.physical_item_id
HAVING count(*) > 1

UNION ALL
-- Arm 2: one channel listing bound to more than one copy (D2 breached).
SELECT 'arm2_listing_bound_to_multiple_copies',
       a.shop_id, NULL::uuid,
       count(DISTINCT a.physical_item_id), array_agg(a.id),
       NULL::boolean
FROM   active a
WHERE  a.external_product_id IS NOT NULL
GROUP  BY a.shop_id, a.channel, a.external_product_id
HAVING count(DISTINCT a.physical_item_id) > 1

UNION ALL
-- Arm 3: a sold copy still carrying an active listing (D3 breached — the
--        double-sell precursor, and the one JAF Comics hit by hand).
SELECT 'arm3_sold_copy_still_listed',
       a.shop_id, a.physical_item_id, 1, array_agg(a.id), NULL::boolean
FROM   active a
WHERE  EXISTS (SELECT 1 FROM sale_event se
               WHERE se.physical_item_id = a.physical_item_id
                 AND NOT EXISTS (SELECT 1 FROM return_event re
                                 WHERE re.sale_event_id = se.id))
GROUP  BY a.shop_id, a.physical_item_id

UNION ALL
-- Arm 4: index CONTENTS drift — the materialized index disagrees with the log it
--        derives from (§5.2's stated cost, made detectable rather than trusted).
--        SHAPE drift is caught separately and earlier, in CI, by invariant I18.
SELECT 'arm4_materialized_index_drift',
       COALESCE(p.shop_id, a.shop_id), COALESCE(p.physical_item_id, a.physical_item_id),
       1, ARRAY[COALESCE(p.listing_link_id, a.id)], NULL::boolean
FROM       physical_item_active_listing p
FULL OUTER JOIN active a
       ON a.physical_item_id = p.physical_item_id AND a.id = p.listing_link_id
WHERE  p.physical_item_id IS NULL OR a.id IS NULL;
```

**Two copies of the same book are not a finding.** Nothing above groups by `edition_lcid`, deliberately — a shop holding six copies of ASM #300, each with its own grade and its own listing, is a healthy shop, and a detector that flagged it would train everyone to ignore the detector. The acceptance criterion "two copies remain distinct" is what this query is careful *not* to violate.

### 5.4 What a K1 looks like, and how a double sell is repaired

**Not every duplicate is a K1.** 019 T18's red line is precise: *"any duplicate reaching a live listing → K1; non-waivable"*. So:

| Situation | Classification | Action |
|---|---|---|
| Arm 1 fires, every binding's draft is `status='draft'` | a **T18 defect**, counted against the `<0.5%` rate | fix, file a bead, continue |
| Arm 1 fires and any binding reached `status='published'` (the `reached_live` column) | **K1** | **pause live batches** until the P0 bead closes with an invariant-review PASS; 006 row by the invariant reviewer (019:130) |
| Arm 3 fires — a sold copy still listed | **K1** in practice: the listing is live by definition, and the next buyer completes the double sell | as above, plus §5.4's repair |
| Arm 4 fires — materialized-index contents drift | **P0 defect, not automatically K1.** The invariant may still hold in the history; what has failed is the enforcement mechanism. Repair the index from the log, then re-run arms 1–3 to find out whether anything got through | 006 row; K1 only if arms 1–3 then fire |
| Arm 2 fires | K1 if the shared listing is published | as above |

**Repairing a double sell — append, never delete.** Two buyers bought the same object; both facts are true and neither is erasable. The sequence, in order:

1. **Hold first.** A `retention_hold` naming the `physical_item`, with a reason and a review date (033 §5.8: *"the item goes on retention hold so nothing about it is swept while it is in question"*). This requires widening `retention_hold.target_table` (E9, §7).
2. **Both sales stand.** Two `sale_event` rows, one per channel. Deleting the second would destroy the record of the money that changed hands, and the append-only trigger would refuse anyway.
3. **A `sale_resolution` row** names which sale is fulfilled and which is not, with a reason and an actor. It supersedes nothing — it is a new statement *about* two existing facts.
4. **A `refund_event`** for the unfulfilled sale, referencing its `sale_event_id`. The money moving back is its own fact.
5. **`listing_link_deactivation`** for every remaining active binding, `reason='sold'` on the fulfilled one.
6. **A `task`** of kind `dispute` (034 §2.12) so the owner sees it and it enters the weekly review (033 §5.8's feedback loop).
7. **A 006 row** if it was a K1, naming the batch, the copy and the closing bead.

The record afterwards reads: *the book was listed twice, sold twice, one sale was refunded, here is who decided which*. That is the truthful chain, and it is exactly what a `DELETE` would have destroyed.

## 6. Decision E — custody, holds, disputes, write-offs and consignment

### 6.1 Custody is events, not a column

```
custody_event(
  id uuid PK, shop_id uuid NOT NULL REFERENCES shop(id),
  physical_item_id uuid NOT NULL REFERENCES physical_item(id),
  kind text NOT NULL CHECK (kind IN
      ('intake','filed_to_bin','bin_move','location_move','pulled_for_listing',
       'set_aside','returned_to_bin','shipped','returned_from_buyer')),
  location_id uuid REFERENCES location(id),         -- 034 §2.4
  bin_id      uuid REFERENCES bin(id),              -- 034 §2.10
  actor_id    uuid REFERENCES app_user(id),
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now() )
```

Append-only, workflow-owned. **Where a copy is now is `DISTINCT ON (physical_item_id) … ORDER BY created_at DESC`** — a view (§7), never a `bin_id` column on the copy. The reason is the same one 034 §2.11 gives for `batch_source_bin`: a shop's floor is re-organised, boxes are re-labelled, and *"which batches came out of box LB-014?"* is the question a shop actually asks when a book turns up twice. A current-location column answers only the present and destroys the trail that answers the past.

`set_aside` is a first-class kind because 033 §6 and §5.3 both produce it — the employee's batch note is *"what was odd, what was set aside"*, and the manual dead end sets a book aside for the owner. A copy that is set aside is not lost and is not listed; it needs a state and it should not be inferred from an absence.

### 6.2 Holds and disputes attach to the copy

**Holds.** 022 P7 Q6's per-item hold is exempt from every sweep and *"is itself an immutable row naming reason and review date"* — and E9 shows `retention_hold.target_table` cannot name a copy today. The migration widens that CHECK to include `physical_item`, and the widening is a `DROP CONSTRAINT IF EXISTS` / `ADD CONSTRAINT` pair, exactly as `003:164-166` widened `shopify_draft.status` — a constraint change on a table whose **rows** stay append-only. The sweep's obligation is unchanged and is already recorded at `003:208-213`: it **must** read the target row and confirm its `shop_id` matches the hold's, because the target is polymorphic and no FK can express it (T24, non-waivable).

**Disputes.** 034 §2.12 gives `task` three nullable subject FKs under `CHECK (num_nonnulls(scan_session_id, batch_id, shopify_draft_id) = 1)`, and states that adding a fourth subject kind is *"one column, one CHECK edit and one migration, which is a deliberate cost for a deliberate change"*. A dispute about a **copy** — 033 §5.8's buyer complaint, §5.4's double sell — is exactly that fourth kind. So: **`task` gains `physical_item_id uuid REFERENCES physical_item(id)` and the CHECK becomes `num_nonnulls(scan_session_id, batch_id, shopify_draft_id, physical_item_id) = 1`.** 034 I11's constraint-existence test extends by one row. This is deliberately not a polymorphic subject and not a fifth kind of link table; it is the cost 034 already priced.

### 6.3 Write-offs

```
write_off_event(
  id uuid PK, shop_id, physical_item_id uuid NOT NULL REFERENCES physical_item(id),
  kind text NOT NULL CHECK (kind IN
      ('lost','damaged_beyond_sale','stolen','donated','returned_to_seller','other')),
  reason text NOT NULL, actor_id uuid REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now() )
```

Append-only. A written-off copy is **not deleted and its row is not marked** — the copy still exists as a historical identity, and `physical_item_disposition` (§7) reports it as written off. A write-off **must** deactivate any active binding in the same transaction (`reason='withdrawn'`), and §8 I5 asserts it: a lost book left listed is a double sell waiting for a buyer.

`returned_to_seller` is separated from `donated` because consignment makes it a different event with different money attached (§6.4).

### 6.4 Consignment versus owned stock

`physical_item.ownership` is a two-value CHECK, `'owned' | 'consignment'`, defaulting to `'owned'`. It is on the copy rather than in a side table because it is **immutable for the life of the copy and true from the moment of intake** — a book is bought or it is taken on consignment, and it does not switch. (A shop that later buys out a consignor's copy is buying it: that is a new fact, recorded as a `consignment_settlement` with kind `purchased`, and the copy's `ownership` still truthfully records how it arrived.)

```
consignment_intake(
  id uuid PK, shop_id uuid NOT NULL REFERENCES shop(id),
  physical_item_id uuid NOT NULL UNIQUE REFERENCES physical_item(id),
  buy_slip_ref text NOT NULL,          -- the covering slip, per 019 T33
  consent_ref  text NOT NULL,          -- the separate consignment signature (T33)
  split_terms  text NOT NULL,          -- as written on the slip; not money maths
  intake_by uuid REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now() )
```

Append-only, workflow-owned, one row per consigned copy.

**Provenance and consent, and the line this record will not cross.** 019 T33 is **non-waivable and a G1 blocker**: every photographed item needs a consent path — a counter placard plus a pre-printed line with an initial box on the shop's existing buy slip, *"a separate signature only for consignment intake"* — and **capture does not start until the slip exists**. So `consent_ref` and `buy_slip_ref` are `NOT NULL`: a consigned copy that cannot name its consent is not representable. And when a walk-in seller revokes (033 §5.7, 022 P7), the 5-business-day clock runs against that reference: the stored originals are tombstoned by a `media_deletion` row, the event rows survive, and if the copy is under a hold **the hold wins and the deletion waits**.

**No seller PII lands in Longbox.** `buy_slip_ref` and `consent_ref` are pointers to the shop's own paper, not names, addresses or phone numbers. The shop holds the identity of its seller; Longbox holds the fact that a covering slip exists and which one. That keeps 022 P7's boundary where it is and keeps a deletion request answerable without Longbox ever having been the custodian of a person's details.

## 7. Expand-only migration sketch — for E02-B07 and E02-B10

**Nothing in this section is written.** It is a specification for a new migration file (`005_physical_item_and_listing.sql` if 034's `004` has landed first; E02-B10 owns the ordering). Per the agent contract, 029 and 034: a shipped migration is never edited, every statement is `IF NOT EXISTS` / `DROP-then-ADD`, the file is re-runnable by hand, and **no statement adds an UPDATE path**.

### 7.1 Order

1. **Depends on 030's catalog migration** (`lcid_registry` must exist before any `*_lcid` FK) **and on 034's `004`** (`location`, `bin`, `batch`, `app_user`, `task` must exist before their FKs). If either has not landed, this migration does not run — E02-B10 owns that ordering and its rollback.
2. `physical_item` — **no `copy_code` column** (A1)
3. `physical_item_identity_correction` + `UNIQUE (supersedes_id) WHERE supersedes_id IS NOT NULL`
4. **`physical_item_code_assignment` (A1)** + `physical_item_code_supersedes_once_idx` (`UNIQUE (supersedes_id) WHERE supersedes_id IS NOT NULL`) + `physical_item_code_live_once_idx` (`UNIQUE (shop_id, copy_code) WHERE supersedes_id IS NULL`)
5. `custody_event`; index `(physical_item_id, created_at DESC)`
6. `scan_session_item_resolution` + `UNIQUE (scan_session_id)`
7. `sale_event`, `return_event`, `refund_event`, `sale_resolution`, `write_off_event` — **workflow-owned (A3)**
8. `listing_link`; then `UNIQUE (shop_id, channel, idempotency_key)`; then the D2 partial unique index `listing_link_external_once_idx ON (shop_id, channel, external_product_id) WHERE external_product_id IS NOT NULL`
9. `listing_link_deactivation` + `UNIQUE (listing_link_id)` (created after `sale_event` — it FKs to it)
10. `physical_item_active_listing` — **the D1 materialized index (A2)**, `PRIMARY KEY (physical_item_id)`, `UNIQUE (listing_link_id)`, and **exactly three columns**, which I18 gates thereafter
11. `consignment_intake` + `UNIQUE (physical_item_id)`
12. `ALTER TABLE task ADD COLUMN IF NOT EXISTS physical_item_id uuid REFERENCES physical_item(id)`, then `DROP`/`ADD` the subject CHECK over four columns (§6.2)
13. `ALTER TABLE retention_hold DROP CONSTRAINT IF EXISTS retention_hold_target_table_check` / `ADD` it back with `physical_item` in the enum (§6.2)
14. Append-only triggers over every new **immutable** table, via the `001:171-182` `FOREACH … EXECUTE format` loop, in the `003:237-248` `DROP TRIGGER IF EXISTS` idempotent form
15. The views (§7.3)
16. **No data statement. No seed. No backfill.** (§7.4)

### 7.2 Which tables get the trigger

| Immutable (append-only trigger) | No trigger |
|---|---|
| `physical_item`, `physical_item_identity_correction`, **`physical_item_code_assignment`** (A1), `custody_event`, `scan_session_item_resolution`, **`sale_event`**, **`return_event`**, **`refund_event`**, **`sale_resolution`** (all four workflow-owned per A3), `write_off_event`, `listing_link`, `listing_link_deactivation`, `consignment_intake` | **`physical_item_active_listing` only** — the D1 materialized index (§5.2, A2). It is an index over the log, not a record; it holds nothing that is not derivable, **I9** proves its contents continuously and **I18** gates its shape in CI |

**Thirteen immutable tables, one materialized index, zero mutable config tables.** That asymmetry is the point: unlike 034, this record adds nothing that is a statement about the present. A copy's present is always a view. **And the one exception is bounded in both directions** — I9 on contents, I18 on shape — which is what A2 added over v1.0.0's single guard.

#### 7.2.1 The sale family — DDL (added at v1.1.1; workflow-owned per A3)

```sql
CREATE TABLE sale_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shop(id),
  physical_item_id uuid NOT NULL REFERENCES physical_item(id),
  channel text NOT NULL,            -- 'counter' | 'shopify' | 'whatnot' | …; open-world, documented
  channel_order_ref text NULL,      -- the channel's order id when one exists
  sold_at timestamptz NOT NULL,
  recorded_by text NULL,            -- operator_id via the identity accessor once E03-B03 lands
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE return_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shop(id),
  sale_event_id uuid NOT NULL REFERENCES sale_event(id),
  reason text NULL,
  returned_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE refund_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shop(id),
  sale_event_id uuid NOT NULL REFERENCES sale_event(id),
  amount_cents integer NOT NULL,
  channel_ref text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sale_resolution (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shop(id),
  sale_event_id uuid NOT NULL REFERENCES sale_event(id),
  kind text NOT NULL,               -- 'double_sell_corrected' | 'sale_voided' | …; open-world
  supersedes_sale_event_id uuid NULL REFERENCES sale_event(id),
  note text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- all four join the append-only trigger loop (§7.2)
```

### 7.3 The views

| View | Shape |
|---|---|
| `physical_item_current` | the copy joined to its newest non-superseded `physical_item_identity_correction`, falling back to `physical_item.edition_lcid` — so "what book is this copy" has one answer and the correction chain is honoured |
| **`physical_item_current_code`** (A1) | `DISTINCT ON (physical_item_id)` over `physical_item_code_assignment` where nothing supersedes the row — the code currently on the bag. A copy with no assignment simply does not appear, which is the truthful answer for an unstickered book |
| `physical_item_custody_current` | `DISTINCT ON (physical_item_id) … ORDER BY created_at DESC` over `custody_event` — where the copy is |
| `listing_link_active` | `listing_link` where `NOT EXISTS` a deactivation — the definition arms 1–4 of §5.3 compute against |
| `physical_item_disposition` | one row per copy: `in_stock \| listed \| sold \| returned \| written_off`, derived from the event tables in that precedence. **A derived label, never a stored status** |

Every one is a read model over immutable history and holds no state — the `003:108-124` shape, extended.

### 7.4 No backfill — stated explicitly, in the 034 §4.4 form

1. **No `physical_item` row is created for any existing `scan_session`.** Pre-migration sessions were identification episodes and nothing recorded whether the book was kept, sold at the counter, or put back. Manufacturing a copy for each would invent an inventory that never existed as data. Existing sessions have **no copy, forever**, and are excluded from every per-copy denominator rather than imputed into one (019 §3.0's OPEN rule).
2. **No `listing_link` is created for any existing `shopify_draft`.** Every draft in the tree today was created against a session, not a copy (E4). Binding one retroactively would assert a copy identity nobody ever established.
3. **No `physical_item_code_assignment` row is created for anything** (A1). A code assignment records that someone wrote a code on a bag; no one has. A copy with no assignment has no code, and `physical_item_current_code` returns nothing for it — an absence rather than an invented string.
4. **The D1 materialized index starts empty**, consistent with 1 and 2 — and I9's rebuild trivially agrees, since an empty log derives an empty index.

The precedent is 030 A1 and 034 §4.4: when the schema cannot distinguish "never captured" from "captured and empty", the answer is a new dated fact, not a guessed value — and a fabricated value in an append-only table is unfixable by construction, because the row cannot be updated (`001:171-182`).

### 7.5 The four 029 amend-by-a-row entries this bead owns

**Three at v1.0.0, four at v1.1.0** — A3's move of the sale family from `commerce` to `workflow` splits what was one entry into two, because the two modules' owned-table lists now change in opposite directions.

029 §9 permits amending statements of fact about ownership **by a row**, without a superseding record — `ENFORCED_MODULES` and the table-ownership list are explicitly designed to grow. 030 §12 and 034 §7/§10 both defer their entries to E02-B05. **This record does not edit 029.** These are the exact rows for the parent to apply.

> **Entry 1 — 029 §2.2 (`workflow`), "Tables owned".** Replace `scan_session`, `scan_photo`, `human_confirmation` with:
> `scan_session`, `scan_photo`, `human_confirmation`, **`physical_item`**, **`physical_item_identity_correction`**, **`physical_item_code_assignment`**, **`custody_event`**, **`write_off_event`**, **`scan_session_item_resolution`**, **`consignment_intake`**.
> *Rationale for the row:* 030 §2.4 point 3 assigns the copy to `workflow`, not `catalog` — "a catalog that knows about copies is a catalog that cannot be batch-imported". The companions are the copy's physical facts and travel with it. `physical_item_code_assignment` is on this list rather than being a column because a code is an assignment that gets re-made when a sticker is replaced (A1, §2.2).

> **Entry 2 — 029 §2.2 (`workflow`), "Tables owned", continued.** Add **`identity_resolution`**.
> *Rationale for the row:* 030 §7.1 and §2.6 — `identity_resolution` is shop-scoped and FK'd to `human_confirmation`, so it cannot be a `catalog` table without breaking 029 §2.3's rule that catalog must be readable by a batch importer with no pipeline present. 030 flagged this and explicitly left the amendment to E02-B05.

> **Entry 3 (new at v1.1.0, A3) — 029 §2.2 (`workflow`), "Tables owned", the sale family.** Add **`sale_event`**, **`return_event`**, **`refund_event`**, **`sale_resolution`**.
> *Rationale for the row:* a sale is the copy's most consequential event, not the channel's. The decisive case is the **in-store sale**, which originates at a counter as a human act with no connector, no webhook and no external identifier anywhere in it (032 §2) — assigning it to `commerce` would route the purest workflow fact in the system through the module that talks to Shopify. A channel-originated sale arrives as a connector observation that `commerce` hands **up** to `workflow` along the edge 029 §3.1 already permits; `workflow` writes the fact and then calls commerce's public deactivation on the same transaction handle (029 §12). **No new dependency edge is created and no L2→L2 edge appears.** Add a sentence to 029 §2.2: *"A sale, return, refund and sale resolution are the copy's facts and are written here; commerce derives the listing consequence from them."*

> **Entry 4 — 029 §2.7 (`commerce`), "Tables owned".** Replace `shopify_draft` with:
> `shopify_draft`, **`listing_link`**, **`listing_link_deactivation`**, **`physical_item_active_listing`**.
> *Rationale for the row:* 029 §2.7 already claims "the LCID↔SKU↔external-ID mapping (E10-B03), duplicate prevention across retries … webhook/poll reconciliation, and the observed listing lifecycle". **This entry names the seam:** the copy is `workflow`'s and the *binding to a channel* is `commerce`'s; `listing_link` FKs to `physical_item` and `commerce` never imports `workflow` (029 §3.1 permits `commerce → platform, identity, catalog` only). Add a sentence to 029 §2.7: *"`physical_item` is `workflow`'s; commerce receives a `physical_item_id` and binds it. A SKU is a field on `listing_link`, never a column on the copy. The sale itself is workflow's (036 §2.4); commerce consumes it and deactivates the binding."* Also add `physical_item_active_listing` to 029 §2.10's table, noting that it is **the one non-append-only table in the domain** — a materialized index over the log, guarded on contents by I9 and on shape by I18 (§5.2, A2).

**Also still pending, and not conflated with the four above.** 034 §7 defers its own three entries — 029 §2.1 gains `organization`, `location`, `app_user`, `membership`, `membership_revocation`, `device`, `device_credential`, `device_credential_revocation`; 029 §2.2 gains `bin`, `batch`, `batch_close`, `batch_source_bin`, `task`, `task_event`; 029 §2.8 gains `labor_shift`, `labor_shift_confirmation`. 034 §10 names E02-B05 as a carrier for them. They are listed here **verbatim so the parent can apply all seven rows in one edit**, but they belong to 034's tables and this record asserts nothing about them beyond quoting the source.

## 8. Invariants as numbered testable statements

Each is falsifiable and names the test that will decide it. **None of these tests exists** (018: nothing here is TESTED). Unit tests flat in `tests/`, DB tests in `tests/integration/`, per the tree's convention.

| # | Invariant | Test file |
|---|---|---|
| **I1** | **Two copies remain distinct.** Create two `physical_item` rows for one `edition_lcid` in one shop; assess different grade ranges; list and sell one. Assert the other is untouched: its identity, its custody chain, its binding and its disposition are byte-identical before and after. Assert also that the §5.3 detector returns **zero rows** — a shop legitimately holding N copies of one book is not a finding. *(This is the acceptance criterion.)* | `tests/integration/physical-item-distinct-copies.test.ts` |
| **I2** | **One copy cannot gain two active listings (D1).** Bind a copy; attempt a second binding; assert the `physical_item_active_listing` primary key raises. Then the concurrency case: two simultaneous bind transactions, one commits, one fails — never both. *(The acceptance criterion, and E10-B06's.)* | `tests/integration/listing-link-one-active.test.ts` |
| **I3** | **One channel listing cannot be bound to two copies (D2).** Insert two `listing_link` rows sharing `(shop_id, channel, external_product_id)`; assert the partial unique index raises. Assert two NULL `external_product_id` rows **do not** collide. | `tests/integration/listing-link-external-once.test.ts` |
| **I4** | **A sale deactivates the binding atomically (D3).** Record a sale; assert the `listing_link_deactivation` exists with `reason='sold'` and a non-null `sale_event_id`, and the row in the materialized index is gone. Then force a failure between the two inserts and assert **neither** committed (029 §12 point 4). | `tests/integration/sale-deactivates-listing.test.ts` |
| **I5** | **A written-off or lost copy carries no active listing.** Write off a listed copy; assert the binding is deactivated in the same transaction. Assert §5.3 arm 1 stays empty. | `tests/integration/write-off-deactivates-listing.test.ts` |
| **I6** | **The SKU is never a column on the copy, and is unique per shop and channel.** Introspect `information_schema.columns`: no column named `sku`, `quantity`, `inventory_quantity`, `bin_id`, `location_id`, `status` **or `copy_code`** (A1) exists on `physical_item`. Assert `listing_link`'s SKU uniqueness constraint exists. **A regression guard**: these are the seven columns most likely to be reintroduced under time pressure, and `copy_code` is on the list precisely because v1.0.0 had it. | `tests/integration/physical-item-no-denormalized-state.test.ts` |
| **I7** | **A scan session resolves to at most one copy, and a code lookup finds the right one.** Attempt two `scan_session_item_resolution` rows for one session; assert the unique constraint raises. Then the code path (A1): assign a code, re-scan by it, and assert the resolution records `method='copy_code'`, points at the **existing** copy, and creates **no new** `physical_item`. Then the human path: with no code, assert `method='human_pick'` resolves to a chosen existing copy and `method='created'` makes a new one. | `tests/integration/scan-session-item-resolution.test.ts` |
| **I8** | **Copy identity is never inferred from an image.** Static scan: no file under `src/modules/workflow/` or `src/modules/resolution/` reaches `physical_item` from a content hash, perceptual hash, embedding or vision result. Extends 030 I13's shape and 029's dependency-cruiser rule set. *(E06-B04's non-goal, made mechanical.)* | `tests/contract/no-image-derived-copy-identity.test.ts` |
| **I9** | **The materialized index never drifts in *contents* from the log it derives from (§5.2's stated cost).** Rebuild `physical_item_active_listing` from `listing_link ⋈ listing_link_deactivation` over a seeded fixture and assert it is byte-identical to what is stored. Runs in CI **and** as arm 4 of the daily reconciliation — a derived table trusted only in CI is trusted in the wrong place. | `tests/integration/active-listing-arbiter-rebuild.test.ts` |
| **I10** | **Every table added by this record is append-only in the database, except the one materialized index — and the exemption list cannot grow silently.** `UPDATE` and `DELETE` raise on all thirteen; `physical_item_active_listing` is asserted **by name** as the single exemption, so adding a fourteenth mutable table fails the build. Extends `tests/integration/append-only.test.ts`. | `tests/integration/append-only.test.ts` (extended) |
| **I11** | **Every shop-scoped table added here carries a `shop_id` FK to `shop(id)`** (locked decision 4). A constraint-existence test in 030 I3 / 034 I10's shape: enumerate the new tables from `information_schema` and assert each has the column and the FK. No exemptions — unlike 034, this record adds no party table. | `tests/integration/tenancy-shop-id-integrity.test.ts` (extended) |
| **I12** | **Every `*_lcid` column added here carries a real FK to `lcid_registry(lcid)`** (030 I3, extended by two: `physical_item.edition_lcid` and `physical_item_identity_correction.edition_lcid`). Constraint-existence, not a data sweep. | `tests/integration/lcid-registry-integrity.test.ts` (extended) |
| **I13** | **A corpus advance orphans no copy** (030 §2.4 point 4, 030 I11). Publish corpus N+1 without an edition present in N; assert every `physical_item` still resolves through its LCID and reads the newest row that has one. | `tests/integration/corpus-advance-no-orphan.test.ts` (extended) |
| **I14** | **A copy can be held, and a hold names a target the sweep can verify.** Assert `retention_hold.target_table` accepts `'physical_item'`; assert the sweep refuses a hold whose target row's `shop_id` differs from the hold's (`003:208-213`, T24 non-waivable). | `tests/integration/retention-hold-physical-item.test.ts` |
| **I15** | **A consigned copy cannot exist without a consent reference** (019 T33, non-waivable). Assert `consignment_intake.consent_ref` and `buy_slip_ref` are `NOT NULL` by constraint existence, and that inserting a consignment copy with either absent raises. | `tests/integration/consignment-consent-required.test.ts` |
| **I16** | **The retry is a no-op.** Call the binding path twice with one `idempotency_key`; assert one `listing_link`, one channel call, one row in the materialized index — closing E6's gap. | `tests/integration/listing-link-idempotency.test.ts` |
| **I17** *(new, A1)* | **A live copy code is unique per shop, and a re-label is a supersession, not an edit.** Three assertions: (a) two live assignments sharing `(shop_id, copy_code)` violate `physical_item_code_live_once_idx`; (b) a **superseded** assignment's code **may** be reused by a new live one — the retired sticker no longer holds the string, and a partial index that failed this would make relabelling impossible; (c) a second row superseding the same assignment violates the supersedes-once index, so the re-label history is a chain and never a fork. Plus: `physical_item_current_code` returns exactly one row for a coded copy and **no row** for an uncoded one. | `tests/integration/physical-item-code-assignment.test.ts` |
| **I18** *(new, A2)* | **The materialized index never drifts in *shape*.** A CI schema-diff gate-test: introspect `information_schema.columns` for `physical_item_active_listing` and assert the column set is **exactly** `{physical_item_id, shop_id, listing_link_id}`. Any addition — a `bound_at`, a `bound_by`, a `reason` — **fails the build**, because a column here holds a fact that exists nowhere else, which would make I9's rebuild impossible and quietly promote a derived index into a state table. This is the guard that makes §5.2's "materialized index over the log" claim enforceable rather than a label. | `tests/integration/active-listing-index-shape.test.ts` |

**I2, I3, I4, I5, I9, I15 and I18 are the seven that map to a non-waivable line** (T18 for all but I15, which is T33); the rest are structural. I18 earns that status because a shape drift silently disables I9, and I9 is the only thing standing between the D1 guarantee and a table nobody checks.

## 9. Alternatives considered

**A1 — `scan_session` *is* the inventory identity: add a `sold_at`, a `bin_id` and a status, and be done.** The cheapest thing, and it is roughly what the tree does today by accident (E3, E4). *Rejected on three counts.* (a) **`scan_session` is mutable** (`scanSession.ts:41` UPDATEs it, legally, because it is absent from the trigger array at `001:174-176`), so inventory identity would be the one identity in the system that can be edited in place — the precise inversion of locked decision 4. (b) **A copy outlives its sessions.** A book that is scanned, listed, unsold, re-graded and re-listed a year later has two sessions and one object; under A1 it becomes two inventory items and the duplicate invariant cannot even be *stated*, let alone enforced. (c) **A session that never produced a copy** — abandoned, abstained, or a re-scan — would still be an inventory row, so the shop's stock count would be a count of *scanning attempts*. The cost of A1 is not aesthetic; it is that T18 becomes unexpressible, and T18 is non-waivable.

**A2 — Quantity-based inventory, like generic retail: one row per edition per condition class, with a count.** The shape every e-commerce system reaches for, and the shape Shopify's own `inventoryQuantity` assumes. *Rejected.* §2.3 argues it in full; the short form is that condition is per-copy by construction — `condition_assessment` carries a grade **range** plus a `defects text[]` per session (`001:122-131`), and locked decision 5 forbids collapsing that to a number that could sort copies into classes. Collapsing two copies into `quantity: 2` destroys both grades, both defect lists and both prices, and it is **unrecoverable**: under append-only rules the discarded assessment cannot be re-derived. This is 030 §3.3's recoverability argument applied to inventory — one side of the bet loses data permanently, the other costs a row per book. It also makes the duplicate invariant meaningless, because "which of the two did I sell" has no answer.

**A3 — Per-channel listing tables: `shopify_listing`, `whatnot_listing`, one per connector.** Superficially tidier, because each channel's external ids differ and a per-channel table can type them. *Rejected, and this is the strongest alternative.* It gets one thing right — Shopify's `(product, variant, inventory_item)` triple genuinely does not resemble a Whatnot CSV row. It loses on the invariant: **D1 is a rule across channels**, and enforcing "at most one active listing per copy" over N tables requires either N² pairwise checks or a union view that no index can constrain. The whole exposure in 014 §17 and 032 §2 is a copy live on two channels at once; a schema that makes that state *harder to detect* is the wrong schema whatever its typing. 029 §2.7 already made the same call at the module level — *"a second connector (Whatnot, eBay) is another adapter behind the same capability contract, not a second module"* — and one table with a `channel` discriminator is that decision in the schema. The typing loss is real and is paid in three nullable external-id columns.

**A4 — A `deactivated_at` column on `listing_link`, so D1 is one partial unique index and no extra table.** *Rejected as impossible, not merely undesirable.* It requires an `UPDATE` on an append-only table: the trigger raises, and locked decision 4 forbids it for better reasons than the trigger does. Named here because it is the construction a reader will reach for first, and §5.2 explains why the arbiter exists instead.

**A5 — Enforce D1 with a `BEFORE INSERT` trigger that checks for an existing active link.** No extra table, and it reads more naturally. *Rejected on concurrency.* Two simultaneous bind transactions both read "no active link" and both proceed; the second's check passed before the first committed. Closing that needs `SELECT … FOR UPDATE` on the `physical_item` row or `SERIALIZABLE` isolation on every commerce write — real cost, on the hot path, to reach a guarantee a primary key gives for free. And E10-B06's acceptance is explicitly *"concurrency/property tests yield at most one active listing per copy"*, so the race is the thing being tested, not an edge case.

**A6 — Model the sale as a `shopify_draft.status = 'sold'`.** One enum value, no new table; `003:164-166` already widened that CHECK once. *Rejected.* A sale is not a listing state — it is a fact about the **copy**, and it happens on channels that have no `shopify_draft` (an in-store sale, D4). Putting it on the draft would make an in-store sale unrecordable unless the shop had first created a Shopify listing for the book, which inverts the actual failure: 032 §2's double sell *starts* in the store.

## 10. The questions, as answered by the cannon

v1.0.0 put five questions to a two-lens cannon; both lenses returned **ACCEPT-WITH-CHANGES**. Three came back as changes to the design (A1/A2 from Q1, A4 from Q2, A3 from Q5), one was answered by carrying it forward as measured, and one is added here by the cannon itself. The reasoning is kept rather than deleted, because the reasoning is the record.

1. ~~**Is the `physical_item_active_listing` arbiter the right trade?**~~ — **ANSWERED: keep it, rename it for what it is, and gate its shape (A2).** Hickey did not accept the framing that this was a compromise to be minimised: **no honest single-table construction exists**, because a binding's openness is decided *after* the binding is written, so storing it on the binding means flipping a column at close time — a mutation on an append-only row. The choice was never between a clean design and a compromised one; it was between a derived index that is honestly labelled and a mutation that is hidden. So the table stays and is called what it is: a **materialized index over the log**, the same category as a B-tree. The draft's worry — "someone adds `bound_at` for debugging" — was correct and is now **mechanically prevented** by I18's CI schema-diff gate rather than left to review. Fowler's counter (measure `SERIALIZABLE` / `SELECT … FOR UPDATE` at pilot volume first) is preserved as dissent in §11 and carried as an E02-B07 obligation in §13.

2. ~~**Is the copy code a process assumption dressed as a schema?**~~ — **ANSWERED: partly yes; the ordering is inverted (A4).** Fowler held that the draft had earned the *table* but not the *primacy*: the sticker step is SOURCED, not observed (O1), and calling it "primary" would have shaped the capture UI around a habit nobody has confirmed. So the **human pick becomes the baseline** and the code is **preferred only where the shop stickers**, with a sequencing rule (§13) forbidding any sticker-scanning UI before E01-B02 observes a real counter. The schema still lands now — an append-only slot cannot be added retroactively (`003:4-7`) — but it costs one unused table if the answer is no, and `scan_session_item_resolution.method` turns O1 into a measurement.

3. **Should the human pick be scoped to the bin, the location or the shop (O3)?** — **Carried forward, not closed.** Neither lens would decide it without data, and both noted the asymmetry that matters: bin-scoping's failure mode **creates a second copy** (the exact harm), while shop-scoping's failure mode is a list nobody reads. Re-examined with Pilot A's data; the scope is a parameter, not a schema change. **Now more load-bearing than v1.0.0 implied**, because A4 made this the baseline path rather than the fallback.

4. **Is `ownership` a two-value CHECK, or should consignment be a relationship?** — **Carried forward as a named timing risk.** The cannon accepted the two-value enum as the right cheap start *and* accepted that 034's `organization` argument transfers: the table is cheap to add later, the rows already written against the wrong shape are not. The mitigation is that `consignment_intake` already isolates the relationship's data in one place, so promoting it to a `consignor` entity is an expand migration plus an FK, not a rewrite of `physical_item`. Revisited the first time a shop takes a large consignment lot.

5. ~~**Does the record draw the workflow/commerce line in the right place?**~~ — **ANSWERED, AND THE DRAFT HAD IT BACKWARDS (A3, Fowler F3).** The question named its own answer and then declined it out of deference to 029 §2.7's reconciliation scope. Fowler's return was that this conflates *who observes a sale* with *whose fact it is*: a sale is the copy's most consequential event, and the in-store case — a human act at a counter, no connector, no webhook, no external id — is the one that matters most (032 §2). `sale_event`, `return_event`, `refund_event` and `sale_resolution` move to **`workflow`**; `commerce` keeps the binding and **derives** the deactivation from the sale fact through the permitted `workflow → commerce` call on the same transaction handle. **029 §3.1 survives untouched** — the edge already existed and points the right way. §7.5 gains a fourth amend-by-a-row entry.

6. **(New, raised by the cannon — A5, Fowler F4.) Is a daily reconciliation an acceptable posture for a non-waivable threshold, and are two of the three external-id columns writable at all?** Two grep-backed limits sit under §3.3.1. First, today's `productSet` selection set returns `product { id status }` only (`shopify.ts:12-17`), so `external_variant_id` and `external_inventory_item_id` have **no writer** until E10-B03 widens the selection or issues a follow-up query — and a reserved column with no writer is a NULL that becomes permanent by default. Second, and heavier: **a daily-only detector lets a double sell sit live for up to 24 hours.** 019 T18 makes any duplicate reaching a live listing a non-waivable K1, and the harm accrues continuously while the second listing is purchasable, so **detection latency is part of the threshold's meaning, not an implementation detail**. `orders/create` / `orders/paid` webhooks (E10-B05/B08) cut the channel-originated window from a day to seconds; there is no webhook receiver of any kind today (§3.3.1's grep, exit 1). **Open and load-bearing for response time**, not for correctness — §5.3 finds every breach either way. Named for E10-B05/B08 to answer with a measured window, not for this record to guess.

## 11. Ratification

| Field | Value |
|---|---|
| Decision | **Adopt §1–§9** — the physical copy as inventory identity (§2), the SKU seam (§3), copy re-identification (§4), the duplicate invariants and reconciliation (§5), custody, holds, write-offs and consignment (§6), the expand-only migration sketch (§7), the invariants (§8) and the rejected alternatives (§9) — as the physical-item, copy-identity, SKU-seam, custody and duplicate-invariant model for Longbox, **with amendments A1–A6 absorbed, none declined**. Apply §7.5's **four** amend-by-a-row entries to 029 under its §9 clause. Binding on E02-B07, E02-B10, E05-B04, E10-B03, E10-B05, E10-B06, E10-B07, E10-B08, E10-B09, E10-B12 and E11-B05. |
| Ratified by | **Claude, acting head of board**, under Jeremy Longshore's 2026-09-03 delegation recorded in 006 |
| Date | **2026-09-04** |
| Cannon | `rich-hickey-reviewer` and `martin-fowler-reviewer`, 2026-09-04 — **both ACCEPT-WITH-CHANGES** |
| Amendments at ratification | **A1** (Hickey CHANGE) `copy_code` ceases to be a column on the immutable copy and becomes the append-only `physical_item_code_assignment` with a supersession chain, a live-only partial unique index and a `physical_item_current_code` view — a code is an *assignment* that is re-made when a sticker is replaced, and re-assignment on an immutable row is impossible by construction; new invariant **I17** · **A2** (Hickey NOTE, made binding) the D1 table is **kept** and named a **materialized index over the log** rather than an "arbiter", because no honest single-table construction exists and every close-time column flip is a mutation; new invariant **I18**, a CI schema-diff gate failing the build if it ever gains a column beyond its three · **A3** (Fowler F3, adopted as a CHANGE) `sale_event`, `return_event`, `refund_event` and `sale_resolution` move from `commerce` to **`workflow`** — the in-store sale is a human act at a counter with no connector in it, and `commerce` derives the deactivation by consuming the sale fact along the already-permitted `workflow → commerce` edge; §7.5 gains a fourth entry · **A4** (Fowler F2) the forced human pick becomes the **baseline** and the sticker code is **preferred only if the shop stickers** (O1 OPEN; 032 §2 is SOURCED, never observed), with a sequencing rule in §13 forbidding a sticker-scanning capture UI before a real shop's stickering is observed · **A5** (Fowler F4) §3.3.1 records two grep-backed limits — two external-id columns have no writer under today's `productSet` selection set, and a daily-only detector lets a double sell sit live up to 24 h, which makes detection latency part of T18's meaning; new **§10 Q6** names webhooks-vs-poll as open and load-bearing · **A6** the event-set split and the quantity=1 argument stand as drafted (Hickey: correct in both directions). **None declined.** |
| **Dissent preserved** | **`martin-fowler-reviewer`, on the D1 materialized index (A2): do not build it until the cheaper alternative has been measured.** A `SERIALIZABLE` transaction or a `SELECT … FOR UPDATE` on the `physical_item` row closes the same race with no extra table, no derived state and no drift surface; the record rejects it on "real cost, on the hot path" (§9 A5) **without a measurement**, which is the same unmeasured-cost reasoning 018 caps at ASSERTED everywhere else. **Not overruled — deferred and made falsifiable:** the index is authorized, and **E02-B07 must measure the serializable path at pilot volume and record the result in a 006 row before building it** (§13). If the measurement shows the lock path is adequate, the index is not built and this record is amended by a row. The dissent stands and would be vindicated by that measurement. · **`martin-fowler-reviewer`, on §8: eighteen invariants for a migration nobody has written is premature precision** — some will not survive contact with the schema, and a test list that is edited on first implementation was never a specification. **Accepted as a real timing risk**, not refuted: the invariants are the acceptance criteria E02-B07 and E10-B06 are measured against, and an invariant that turns out unwritable is itself a finding about the design. Mitigated by every one naming a file that does not exist, so none can be mistaken for coverage. |
| Gate audit | *(pending)* — `longbox-gate-auditor` before the bead closes |
| Jeremy's revision right | **Standing.** Jeremy may revise any line by a 006 decision-log row naming date, old text, new text and reason (018 §5). Locked decisions 3, 4, 5 and 7 outrank this record. |
| Recorded in | 006 decision log row dated 2026-09-04 (flipped **in place** from the PROPOSED row filed earlier the same day, per 018 §4 C2 — the PROPOSED text lives in git history); 016 §1 row 036; 000-INDEX row 036; the change log above; bead `longbox-e5b.2.5`'s close reason quotes this block |

Binding from 2026-09-04. Changing any **decision** above — an ownership assignment, an invariant, the SKU seam, the D1 mechanism — requires a new decision record naming this one as superseded (018 §4 rule S4), never an in-place edit. Two things are explicitly **not** decisions and may be amended in place by a patch bump plus a change-log row, following 029 §9's precedent: **statements of fact about the existing tree** (a `file:line` that turns out wrong is a defect in the description, not the decision), and **the §4.4 OPEN table**, which is designed to close as the pilot observes rather than by amendment.

**Ratification is not evidence** (018 §2 A3). This block records that a design was argued by two lenses and adopted. It does not make any claim in §2–§8 true of any running system: **nothing here is built, nothing is TESTED**, every invariant in §8 names a test file that does not exist, and §1 stays REPRODUCED while everything else stays ASSERTED. What changes on ratification is only that E02-B07 and E02-B10 are now authorized to write the migration against this shape — and that authorization carries the two E02-B07 obligations in §13.

## 12. Consequences

**Now that it is ratified.**

- **The system gains a noun for the object it is about.** Every rule in 019 that counts copies — T17, T18, T23 — becomes expressible; today T18's denominator ("copies listed") does not exist as data (E1).
- **E5 and E6 are closed by construction.** A second draft on one copy fails at a primary key rather than succeeding silently, and the retry gets an idempotency key to be idempotent against.
- **The in-store double sell becomes detectable rather than hypothetical.** §5.3 arm 3 is the query that would have caught the JAF Comics failure (032 §2) — but only once the in-store sale reaches the system, and today that is a human act (D4). **The invariant lands ahead of the connector, which is the right order and is also a gap.** §3.3.1's limit 2 bounds how long that gap can hide a live duplicate: a day, until webhooks land.
- **029 §2.2 and §2.7 grow by fourteen tables** across the four §7.5 rows — **and the sale family lands on the workflow side, not commerce (A3)**, so the in-store sale has a home that does not route through the Shopify module. `catalog` stays free of copies, which is what keeps 029 §2.3's batch-importer property true.
- **`retention_hold` can finally name an item**, so 022 P7 Q6's per-item hold and 033 §5.8's "first act" stop pointing at nothing (E9).
- **A code can be re-assigned when a sticker is replaced (A1)** — which the v1.0.0 column could never have permitted, since the copy row cannot be updated. The failure that would have caused is concrete: an unreadable sticker with no way to issue a new code, and an employee creating a second copy to get one.
- **The cost is thirteen new immutable tables and one materialized index**, on a codebase that is still 1,930 lines with no module directories. Every one is empty until E02-B07 writes the migration and E10 writes the callers, and an empty table is a maintenance cost paid at every later migration. **That is a real bet and it is the same bet 034 made** — cheap tables now against an inventory migration under a live pilot later.

**What gets worse, stated plainly.**

- **A non-append-only table enters the domain** (§5.2). A2 makes it honest rather than harmless: it is named a materialized index, I9 guards its contents and I18 guards its shape as a required check. The precedent still exists, and **Fowler's dissent that it should not be built before the serializable path is measured is preserved in §11 and binding on E02-B07** (§13).
- **Re-identification's better path depends on a shop process nobody has observed** (§4.4 O1). A4 reduces the exposure by making the human pick the baseline, so an unstickered shop loses an unused table rather than the mechanism — but it does not eliminate it, and the per-book cost of a human pick at volume is still unmeasured.
- **Two external-id columns ship with no writer** (§3.3.1 limit 1). They are reserved against E10-B03 widening the `productSet` selection set; until then they are NULL by necessity, and a reserved column with no owner is how a NULL becomes permanent.
- **T18's response time is a day until webhooks land** (§3.3.1 limit 2, §10 Q6). The detector's *coverage* is complete; its *latency* is the weakest posture that can still be called compliant with a non-waivable line.
- **The SKU seam adds a hop.** Answering "what is this copy listed as" is a join, not a column read, and that is a genuine ergonomic loss paid on the owner's review surface (E11-B05).

**The counterfactual, kept for the record.** Deferring this to E10 would mean the commerce epic inventing a copy identity while building the connector — under schedule pressure, against a live pilot, with `scan_session` sitting right there looking like it would do (A1). 014 §17 rates duplicate inventory a **direct financial and customer harm** with "physical copy ID" as the first named mitigation, and 019 makes any duplicate reaching a live listing a non-waivable K1. A copy identity designed inside a connector would be a copy identity shaped by that connector — which is exactly what §3's SKU seam exists to prevent.

## 13. Obligations this record creates, and what it does not decide

### 13.1 Three binding obligations on downstream beads

These are not deferrals — they are conditions the cannon attached to its acceptance, and a bead that skips one is not done.

> **O-A — E02-B07 must measure the serializable alternative before building the D1 materialized index** (Fowler's preserved dissent, §11; A2). Before `physical_item_active_listing` is created, E02-B07 benchmarks the cheaper construction — a `SERIALIZABLE` transaction, or `SELECT … FOR UPDATE` on the `physical_item` row, around the bind path — at **pilot-realistic concurrency**, and records the result in a **006 row** naming the method, the load, the observed contention and the date. If the lock path holds, **the index is not built** and this record is amended by a row. §9 A5 rejected it on "real cost, on the hot path" **without a measurement**, which is exactly the unmeasured-cost reasoning 018 caps at ASSERTED everywhere else; this obligation makes the rejection falsifiable instead of asserted. The index is authorized either way — what is forbidden is building it *without having looked*.

> **O-B — E02-B07 must land I18 as a required check in the same PR that creates the index** (A2). A shape gate added later is a gate added after the shape has already drifted. The check is cheap (one `information_schema` query) and its absence is what would let the "materialized index over the log" claim decay into a label.

> **O-C — E05-B04 must not build a sticker-scanning or code-entry capture UI before a real shop's stickering is observed** (A4). The sequencing is: **E01-B02 observes the counter → then the affordance is built, or it is not.** The `physical_item_code_assignment` table lands with the migration regardless, because an append-only slot cannot be added retroactively (`003:4-7`) and an unused table costs nothing; **the UI is the part that must wait**, because a capture flow built around an unobserved habit is a per-book tax on every operator if the habit turns out not to exist. The baseline human pick (§4.3) is what E05-B04 builds first, and `scan_session_item_resolution.method` is how the pilot tells us whether the code path was worth adding.

### 13.2 What this record does not decide

- **It does not write a migration.** §7 is a sketch. **E02-B07** builds the append-only, correction and purge machinery and 029 §12's request transaction — carrying O-A and O-B; **E02-B10** owns ordering, indexes, locking, compatibility and rollback, and must prove the migration idempotent on a fresh DB and on the prior snapshot.
- **It does not decide the SKU's format**, its character set, or whether it embeds the copy code — **E10-B03**. §3.3 fixes only that a SKU is Longbox-issued, lives on `listing_link`, and is never a column on the copy. **E10-B03 also owns §3.3.1's limit 1**: widen the `productSet` selection set or issue a follow-up query, so `external_variant_id` and `external_inventory_item_id` acquire a writer instead of staying NULL by default.
- **It does not decide the copy code's format, check digit or carrier** — §4.4 O1/O2, closing at E01-B02 and E05-B04, and gated behind O-C.
- **It does not decide the reconciliation cadence, and the cadence is load-bearing** (§3.3.1 limit 2, §10 Q6). §5.3's four arms are the detector's *logic*; whether T18 runs daily, on `orders/create` / `orders/paid` webhooks, or both is **E10-B05** (the signed receiver) and **E10-B08** (reconciliation), which must state the achieved detection window as a measured figure rather than inherit "daily" by default.
- **It does not build reconciliation.** §5.3 is the detector's SQL; the webhook and poll transport, out-of-order and missed-event convergence, and the mismatch queue are **E10-B08**; the signed webhook receiver is **E10-B05**. The outbox, retry budget, circuit breaker, DLQ and replay are **E10-B09**.
- **It does not build the duplicate-prevention tests.** §8 names them; **E10-B06** writes the concurrency and property suites, and **E10-B12** closes the commerce gate with the E2E trace.
- **It does not decide the owner's inventory and reconciliation workspace** — **E11-B05**. This record gives it rows to render and renders nothing.
- **It does not authorize a multi-channel reservation model.** D1 is absolute; 014 §8 E10-B06's exception clause requires a **new decision record**, not a relaxed index.
- **It does not design the POS or in-store sale connector.** D4 fixes that both paths write the same facts through one function; which systems feed it is E10 and beyond, and today the fact arrives by hand.
- **It does not decide the consignment settlement or any money movement** — split calculation, payout and accounting are E10/E12. §6.4 fixes only the provenance and consent record.
- **It does not amend 029, 030 or 034.** §7.5 writes the rows; applying them is the parent's act under 029 §9.
- **It does not reverse or amend a locked decision.** Locked decisions 3, 4, 5 and 7 constrain this record; where anything here conflicts with one, the locked decision wins.
