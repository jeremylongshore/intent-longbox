# Decision Record — The Workflow State Machine, Its Two Machines, and the Authorized Transitions

**Version:** 1.2.0
**Status:** **RATIFIED 2026-09-04** by the acting head of board under Jeremy Longshore's 2026-09-03 delegation, after a two-lens cannon (`rich-hickey-reviewer`, `martin-fowler-reviewer`, both ACCEPT-WITH-CHANGES). Binding per §14. Amendments A1–A9 absorbed in full, none declined; two dissents preserved in §14.
**Bead:** E02-B06 `longbox-e5b.2.6` (epic LBOX-E02 `longbox-e5b.2`, gate G2, evidence class DEC, owner-role product, risk critical) — see 000-docs/014 §8 row E02-B06
**Drafted:** 2026-09-04 by `longbox-domain-builder` · **Cannon:** `rich-hickey-reviewer` + `martin-fowler-reviewer`, 2026-09-04 · **Audit:** `longbox-gate-auditor` before close · **Decision owner:** Jeremy Longshore
**Sensitivity:** Restricted internal (014 §10)
**Supersedes:** nothing — first state-machine record.
**Inputs:** 014 §8 rows E02-B06, E02-B07, E02-B08, E02-B09, E02-B10, E05-B04, E05-B08, E05-B09, E10-B04, E10-B05, E10-B08, E11-B02, E11-B03, E13-B01 · 015 alias map · 029 v1.2.0 §2.2, §2.7, §2.8, §2.9, §3.1, §9 (amend-by-a-row), §11, §12 (the request transaction) · 030 v1.1.1 §2.1 (identity vs value) · 033 v1.0.1 §1 A5/A11/A12/A13, §2 B3/B4/B5/B7, §5.1, §5.2, §5.3, §5.4, §5.5, §5.6, §5.8, §7 · 034 v1.1.1 §2.6 (roles), §2.8 (device), §2.11 (batch), §2.12 (task), §2.13, §3.3 (the T35 accessor), §4.2, §4.4 · 036 v1.1.1 §2.4, §4.1, §4.3, §5.1 D3/D4, §7.2.1, §7.3 · **037 v1.1.1 §1.1, §1.2, §1.4 D1/D3, §4.1, §4.2, §4.4, §7 I3 (condition is a human act; the five owner-review triggers)** · 022 v1.1.1 P1, P2, P3, P7 (Q6), P8 · 019 v1.2.0 §3.0, T7, T17, T19, T23, T24, T33, T34, T35, K1, K2, K4 · 018 (evidence rules) · 005 §API surface · `migrations/001_init.sql`, `migrations/003_reserve_principle_slots.sql`, `src/db.ts`, `src/services/scanSession.ts`, `src/routes/scanSessions.ts`, `scripts/register-shop.ts`, `public/app.js` · CLAUDE.md locked decisions 3, 4, 5, 7.

## Change log

**Version convention** (006's, as used by 029/030/034/036/037): a **minor** bump means the content of a decision changed; a **patch** means a statement of fact was repaired with no decision changing.

**This is a minor bump, and four of the nine amendments change what the schema is.** A reader who acted on v1.0.0's six-value `to_state` enum, on `failed` or `abandoned` as **fact rows**, or on §3.4's timestamp comparison must re-read §2.2, §3.3, §3.4, §4.2, §4.5, §4.6, §7, §8.1 and §9. No §1 today-claim was disturbed; every one was re-checked against `aa448bb` and none needed a new cite.

| Version | Date | What changed | Authority |
|---|---|---|---|
| 1.0.0 | 2026-09-04 | Initial draft. Status PROPOSED, §14 unsigned, five questions open in §13. | `longbox-domain-builder` |
| **1.1.0** | **2026-09-04** | **RATIFIED. Nine cannon amendments absorbed, none declined.** **A1** (Hickey, the most costly) every transition row carries **`against_table`/`against_id`** — the highest-witness record it was issued against — and §3.4 clause 2 compares **against that reference**, not against a timestamp: a transition wins only if its reference is the current witness or later, with `created_at` as a **logged** fallback for legacy rows only. *Time is a proxy for causality; record the causality.* **A2** (Fowler Q4 over Hickey b) **one** transition table is kept, with `kind ∈ {parked, resumed, voided, reopened}` and `reopened_to_rung` nullable under a CHECK tying it to `kind='reopened'`; §4.5 gains **per-kind guard rows** so the schema states which kinds are terminal. Hickey's dissent (split into `session_pause` and `session_disposition`) preserved in §14. **A3** (Hickey c over Fowler Q3) **`abandoned` becomes a DERIVED predicate** in `scan_session_current_state` — non-terminal, no witness progress and no resume beyond an elapsed threshold that is a **signed OPEN parameter stored in the view's definition version** — and is **never a fact row**; 033 §5.2's "never auto-completed" now holds literally. Fowler's dissent (a named system sweep is not silent completion) preserved in §14. **A4** (Fowler Q5) **`failed` is removed from the transition kinds**: every failure is already witnessed by a record, and the session reads its prior rung. §4.6 states where each failure is witnessed and names the one gap (identify's 502 records nothing). **A5** (Fowler BLOCK 1) 029 §12's request transaction **does not exist at `aa448bb`**, so every guard that needs atomicity — S1, S7, D1/D2 — and **I14** are **UNTESTABLE until E02-B07 ships it**; written as a blocking precondition in §0, §5.3 and §14, and ratification is stated **not** to retire the half-written-chain risk today. **A6** (Hickey e + Fowler d) the plain view ships for the pilot **only with a checked-in benchmark fixture and a CI plan-shape assertion** (index-only scans, no seq scan across the eight tables) — an **O-A-style obligation on E02-B07** mirroring 036; materialization is decided from the measurement. **A7** (Fowler 2) **I4 gains a negative architecture test**: a route importing commerce's publish surface fails the dependency gate **at merge** (E02-B10), not at runtime. **A8** (Fowler a) `GET …/:id` leaks `status` via `SELECT *` today (E5); that becomes an **explicit E02-B08 acceptance line**. **A9** (Fowler 4) the second device's stale read is an **E05 acceptance criterion**, and `request_idempotency` retention is **explicitly deferred to E13-B01**. Plus **037 v1.1.1 citations** folded into F4, S5, the new guard **G-f** and I9, now that the condition record exists on main. | Two-lens cannon → acting head, §14 |
| 1.1.1 | 2026-09-04 | Patch after the gate audit (statements of fact only, no decision changed): §4.1 cite `001:114` → `001:116` (the source CHECK; `:114` is `shop_id`); §13 Q1 names the FK columns `:124`/`:135` beside the table lines; §3.4 states the transition-vs-transition ordering limitation (audit N4) and hands E02-B07 the tie-break; the two beads this record discovered (E02-D02 `longbox-e5b.2.12`, E02-D03 `longbox-e5b.2.13`) are now rows in 015. | acting head, from the `longbox-gate-auditor` report on PR #49 |
| 1.1.2 | 2026-09-04 | Patch from the E02-D02 invariant review (PR #52): §4.4's derivation key for `listing_link_current_status` is the channel-asserted `observed_at` (then `id`), not arrival-time `created_at` — the code in `src/services/listingStatus.ts` already does this and the record now says the same; §4.4/§8.1 record that migration 005 landed the table early, FK'd to `shopify_draft`, with the `observed_at`/`source` spellings. No decision on the machine changed. | acting head, from the `longbox-invariant-reviewer` report on PR #52 |
| **1.2.0** | **2026-09-04** | **Amended by a row under 029 §9, at the request of 041 §3.5 (E02-B07), ratified the same day.** §5.1's proposed `observed_current_id` column is **collapsed into A1's `against_table`/`against_id`** and is not built. **This changes a decision — the migration sketch's column set — hence a minor bump rather than a patch.** It changes no *rule*: §5.1's own text already called the two "one idea" (*"a write says what world it was made against, and the reader checks"*), and the check, the 409, the E05 acceptance criterion (A9) and I13 are untouched in substance — a confirmation issued against confirmation X now carries `('human_confirmation', X)` instead of `observed_current_id = X`. The yield is one concept, one column pair, one CHECK and one index instead of two mechanisms for one idea, and one fallback counter (I18) instead of two. §5.1 and §8.1 item 4 are edited in place; §9's I13 reads unchanged. | 041 §3.5 / §14 A9, acting head |

## 0. Evidence posture

Per 018 A1/A3, and with 029 v1.0.0's gate-audit blocker B1 as the governing lesson — a "today" claim asserted at REPRODUCED on the strength of having read a file, later found false:

- **Every "today" claim in §1 is REPRODUCED at `aa448bb`** — `main`, the 029 amend-by-a-row PR #48 — each carrying a `file:line` **or** the verbatim grep that produced it **with its exit status**. §1 prints the commands so a reader re-runs them rather than trusting the reading. **A rung is earned by the citation, not by the reading.** *(v1.0.0 cited `6771f84`. Every claim was **re-run** at `aa448bb` after the rebase rather than carried across: `git diff --stat 6771f84..aa448bb -- src migrations scripts tests public` is **empty** — docs 037 and the 029 amendments are docs-only — so every line number re-derives unchanged, and this is a statement of that fact rather than an assumption from it.)*
- **Everything in §2–§9 is ASSERTED.** No table, column, view, trigger, endpoint or line of code exists as a result of this record. Every invariant in §9 names a test file that does not exist. This record writes no migration; §8 is a sketch for E02-B07 and E02-B10 to execute.
- **Ratification does not move anything up the ladder, and it does not retire a risk (A5).** §14 records that a design was argued by two lenses and adopted. It does **not** make any claim in §2–§9 true of any running system, and in particular **it does not retire the half-written-chain risk 029 §12 names.** That risk is live at `aa448bb` and stays live until E02-B07 ships the request transaction — see the blocking precondition below.
- **⚠ BLOCKING PRECONDITION — 029 §12's request transaction does not exist (A5, Fowler BLOCK 1).** REPRODUCED at `aa448bb`: `src/db.ts` exports `getPool` (`:5`) and `closePool` (`:12`) and **no transaction helper**; `grep -rniE "BEGIN|COMMIT|ROLLBACK|connect\(\)" --include=*.ts src` returns **one** line and it is a prose comment (`src/config.ts:38`); the only `BEGIN` / `COMMIT` / `ROLLBACK` in the repository are in `scripts/register-shop.ts:46`, `:75`, `:84` — a one-shot onboarding script, not the pipeline. **Consequently every guard in this record that needs atomicity is UNTESTABLE today**: S1 (consent before `captured`), S7 (a hold blocks `drafted`), 036's D1/D2, the sale-deactivation pair, and **invariant I14** in full. They are specified here and **cannot be asserted, measured or claimed until E02-B07 lands**. The dependency order is therefore **E02-B07 (transaction) → E02-B07 (this migration's expand half) → E02-B08 (routes) → E02-B10 (contract step)**, and no step may be attempted out of order. A reader who takes this record as evidence that the guards hold has misread it.
- **No numeric threshold is set here.** The lines this record leans on — T19 auto-publish incidents = 0 (non-waivable), T17 draft success ≥99%, T23 lost/duplicated offline items = 0, T33 consent coverage, T35 per-operator rendering = 0 — are quoted from 019 v1.2.0 and **never re-derived**. A signed threshold is a decision, not evidence it is met.
- **One claim in the bead's own note is CONTRADICTED here** and is recorded rather than smoothed over. The note reads *"Current status update has insufficient transition enforcement (route accepts status strings)."* The **conclusion is right and the mechanism named is wrong**: no route accepts a status string from a caller (§1 E7). The enforcement gap is worse than a validation gap — it is that the column has **two writers, zero readers and no ordering rule of any kind** (E4, E5, E6). §1 states what actually reproduces.

## 1. What exists today (REPRODUCED at `aa448bb`)

| # | Claim | Evidence |
|---|---|---|
| **E1** | **`scan_session.status` is a mutable text column with a four-value CHECK**, and `scan_session` is deliberately **absent** from the append-only trigger array, which is what makes the UPDATE legal. | `migrations/001_init.sql:64-70` (column at `:68`); trigger array `migrations/001_init.sql:174-176` lists `corpus_version, scan_photo, candidate_set, llm_rerank, human_confirmation, condition_assessment, pricing_snapshot, shopify_draft, cost_log` — **no `scan_session`** |
| **E2** | **The one UPDATE in the codebase is on that column**, and the file says so in a header comment. | `src/services/scanSession.ts:41` (`UPDATE scan_session SET status = $3 …`); comment `:1-3` |
| **E3** | **There is no transaction in the request path.** `grep -rniE "BEGIN\|COMMIT\|ROLLBACK\|connect\(\)" --include=*.ts src` returns **one** line and it is a prose comment (`src/config.ts:38`); `src/db.ts` exports `getPool` (`:5`) and `closePool` (`:12`) and no transaction helper; the only `BEGIN` / `COMMIT` / `ROLLBACK` in the repository are in `scripts/register-shop.ts:46`, `:75`, `:84`. 029 §12's NOTHING-EXISTS-YET block and 034 E16 both reproduce at this SHA. **This is the §0 blocking precondition (A5).** | grep, one non-transaction match; `src/db.ts:5`, `:12`; `scripts/register-shop.ts:46`, `:75`, `:84` |
| **E4** | **The column has exactly two writers.** `setSessionStatus` is called from `POST …/confirm` and from `POST …/draft` — and the draft call is guarded by `result.ok`, so a failed draft leaves the session reading `confirmed`. | `src/routes/scanSessions.ts:213` (`"confirmed"`), `:373` (`if (result.ok) … "drafted"`). `grep -rn setSessionStatus --include=*.ts src` returns exactly these two call sites plus the export and the import |
| **E5** | **The column has zero readers.** `grep -rn "\.status" --include=*.ts src public`, discounting `statusCode` and the pricing/HTTP `status` fields, returns **one line, and it is the header comment** at `scanSession.ts:2`. Nothing branches on it. It is returned inside `GET …/:id`'s `session` object because that handler does `SELECT *`, and the phone UI never reads it — `public/app.js`'s `status` is an unrelated DOM helper (`public/app.js:24-26`). | grep; `src/routes/scanSessions.ts:104-111`; `public/app.js:24` |
| **E6** | **Three of the pipeline's five steps set no state at all.** `POST …/photos` (`:114`), `POST …/identify` (`:162`) and `POST …/condition` (`:217`) and `POST …/price` (`:249`) never call `setSessionStatus`. **`captured`, `proposed`, `conditioned` and `priced` have no representation in the system today** — not a wrong value, no value. | `src/routes/scanSessions.ts:114`, `:162`, `:217`, `:249` versus E4's two call sites |
| **E7** | **No route accepts a status from a caller.** `setSessionStatus`'s fourth parameter is a TypeScript literal union (`"in_progress" \| "confirmed" \| "drafted" \| "abandoned"`) and both call sites pass a hard-coded string. The bead note's "route accepts status strings" does not reproduce. | `src/services/scanSession.ts:39`; `src/routes/scanSessions.ts:213`, `:373` |
| **E8** | **`abandoned` is unreachable.** `grep -rn "abandoned"` over `src migrations tests scripts public` returns the CHECK (`001:68`) and the TypeScript union (`scanSession.ts:39`) and nothing else. No code path ever writes it. 033 §5.2's abandoned session — the honest terminal state — cannot be recorded. | grep, two matches, neither a write |
| **E9** | **There is no ordering rule anywhere.** The CHECK constrains the *value set*, never the *sequence*. `POST …/confirm` writes `confirmed` unconditionally — on a second confirmation, and on a session already reading `drafted` — with no record that the state moved backwards. | `migrations/001_init.sql:68`; `src/routes/scanSessions.ts:208-214` |
| **E10** | **A session can reach `drafted` having never been conditioned.** `POST …/draft` 409s without a `human_confirmation` (`:321`) and without a `pricing_snapshot` (`:325`), but the condition assessment is read as optional and the draft is composed with an empty grade string when it is absent. | `src/routes/scanSessions.ts:326-328` (`assessments?.[…]`), `:334-336` (`assessment ? … : ""`) |
| **E11** | **`shopify_draft` is append-only, so the three lifecycle values migration 003 added to its CHECK can never be written.** `003:164-166` widened the enum to `draft \| published \| failed \| delisted \| archived`; `shopify_draft` is in the `001:174-176` trigger array, and `forbid_mutation()` fires `BEFORE UPDATE OR DELETE`. **`published`, `delisted` and `archived` are reachable only by inserting a second `shopify_draft` row for the same session** — which is indistinguishable from the retry 036 E5/E6 records as unprevented. | `migrations/003_reserve_principle_slots.sql:164-166`; `migrations/001_init.sql:174-182` |
| **E12** | **There is no `published_by` column and no status watcher.** `grep -rn "published_by" --include=*.ts --include=*.sql src migrations scripts tests` returns **zero lines, exit 1**. 019 T19's detector — non-waivable, `any → K1` — has nothing to read and nothing to write. | grep, exit 1 |
| **E13** | **There is no `outcome` column on `human_confirmation`.** 019 §3.0 names `human_confirmation.supersedes_id` **and** `outcome ∈ {confirm, correct}` as a G2 prerequisite for T3 and T20; `003:86` added the first and not the second. `grep -rniE "\boutcome\b" migrations` returns nothing. | `migrations/003_reserve_principle_slots.sql:84-104`; grep over `migrations`, zero matches |
| **E14** | **The correction idioms this record reuses already ship**: `supersedes_id` self-FKs with a partial unique index making a row superseded at most once, on three tables, plus `*_current` `DISTINCT ON` views over them; and the idempotent `DROP TRIGGER IF EXISTS` / `CREATE TRIGGER` loop. | `003:84-104` (supersession), `:108-124` (views), `:237-248` (trigger loop) |
| **E15** | **The `*_current` views resolve an unlinked conflict silently.** Each is `DISTINCT ON (scan_session_id) … WHERE NOT EXISTS (a superseding row) ORDER BY created_at DESC, id DESC`. Two independent confirmations that do **not** name each other via `supersedes_id` are both non-superseded peers; the newer one wins by timestamp and nothing records that there was a disagreement. | `migrations/003_reserve_principle_slots.sql:120-124` |
| **E16** | **`grep -rniE "idempoten" src migrations` returns one line and it is a comment about `media_deletion`.** No request carries an idempotency key; a retried POST appends a second record. | grep, one comment match at `003:130` |
| **E17** | **The session read model hardcodes seven tables** and interpolates each name into `SELECT * FROM ${t}`. Any state derivation written today would have to extend that list. | `src/services/scanSession.ts:73-81` (list), `:85` (interpolation) — the same coupling 029 §1 fact 1 records |

**What §1 adds up to.** The system has a *word* for its state and no *machine*. The column is written by two handlers out of six, read by nothing, constrained by value and not by order, and carries one value (`abandoned`) that no code can produce and four states (`captured`, `proposed`, `conditioned`, `priced`) that no code can express. Meanwhile the eight immutable records that **actually** say what happened — `scan_photo`, `candidate_set`, `llm_rerank`, `human_confirmation`, `condition_assessment`, `pricing_snapshot`, `shopify_draft` and, once 036's migration lands, the copy's facts — are appended faithfully on every step. **The truth is already in the log; the column is a lossy, mutable, unread summary of it, and it is the one thing in the pipeline that can be wrong.** E02-B06 is the decision to stop keeping a second copy of a fact.

## 2. Decision A — Two machines, not one

### 2.1 The argument

The bead's acceptance criterion lists twelve names — *intake, captured, proposed, confirmed, conditioned, priced, drafted, published, sold, returned, voided, failed* — and it is tempting to read that as one enum on one row. **It is two machines, and fusing them is the error 036 §4.1 spent a whole section preventing.**

> **A `scan_session` is an identification episode. A `physical_item` is an object.** A session is a thing that *happened*; a copy is a thing that *exists*, and it exists before, between and after every session that touches it (036 §4.1).

Read the twelve names against that distinction and they split cleanly on **who the subject is**:

| Name | Subject | Machine |
|---|---|---|
| intake, captured, proposed, confirmed, conditioned, priced | the **episode** — what the person and the machine did at the counter | (a) session |
| drafted | **both** — the last act of the episode and the first act of the listing | the hinge (§2.3) |
| published, sold, returned | the **copy and its listing** — things that happen days or months later, to an object, often with no session in sight | (b) copy / listing |
| failed | the **episode** — but **not a state** after A4: every failure is already witnessed by a record and the session reads its prior rung (§4.6) | (a) session, **derived from the failing record** |
| voided | **both, in two different senses** — a repudiated episode, and a voided sale (§4.6) | both, disambiguated |

Two of the twelve names therefore survive as something other than a stored state, and the cannon is why. **`abandoned` is a derived predicate, never a fact row (A3)**, so 033 §5.2's *"the session stays incomplete forever … it is never auto-completed"* holds **literally** rather than by convention. **`failed` is not a state at all (A4)**, because every failure it would have named is already a record — and a state whose only content duplicates a record is the thing this whole document exists to remove. Both are argued in §4.6.

Four independent reasons the split is right, in increasing order of cost if ignored:

1. **The lifetimes do not match.** A session is minutes; a copy is the life of the object. A book scanned, drafted, unsold, re-graded and re-listed a year later is **two sessions and one copy** (036 §9 A1(b)). One enum on `scan_session` makes it two inventory items and T18 becomes unexpressible — which is exactly the alternative 036 rejected as making a non-waivable line unstateable.
2. **The owners do not match.** `scan_session` is `workflow`'s (029 §2.2); `listing_link` and `listing_link_deactivation` are `commerce`'s (036 §7.5 entry 4); `sale_event` / `return_event` / `refund_event` / `sale_resolution` are `workflow`'s but hang off `physical_item`, not off a session (036 §2.4, A3). A single machine would force one module to own a state whose facts three modules write.
3. **`published` is not ours to drive.** Locked decision 3 and 019 T19 (non-waivable, `any → K1`): nothing publishes without a human acting **in the Shopify admin**. `published` is therefore never a transition Longbox *makes*; it is an observation Longbox *receives* (033 B3, §7). A state Longbox cannot cause has no business sitting in the same enum as states Longbox's own handlers drive — it invites exactly the write path T19 exists to make impossible.
4. **The session must be able to end without the copy ending, and the copy must be able to carry on without a session.** 033 §5.2's abandoned session ends with no copy at all. A bulk-intake copy (`origin='bulk_intake'`, 036 §2.2) exists with no session at all. Neither is representable in one machine without a null-heavy enum that means different things depending on which half you are looking at.

### 2.2 The two machines

**(a) The scan-session machine — an identification episode.**

```
                      ┌──────── park ◄──► resume ────────┐
                      │        (fact rows: kind=parked/resumed)
  intake → captured → proposed → confirmed → conditioned → priced → drafted
     │         │          │          │            │           │        │
     │         └──────────┴──────────┴────────────┴───────────┴────────┘
     │                              │                    ▲
     │                              │      reopened(rung)│  (fact row, owner/manager)
     │                              └────────────────────┘
     │
     ├──→ voided     FACT ROW (kind=voided) · terminal · owner/manager only
     └──→ abandoned  DERIVED PREDICATE (A3) · non-terminal · no fact row exists
```

Six forward rungs plus the hinge, two non-linear fact kinds (`parked` / `resumed`), one backwards fact kind (`reopened`), **one** terminal fact kind (`voided`), and **one derived predicate** (`abandoned`). **The session ends at `drafted`.** There is no `published` on this machine and there never will be, and after A4 there is no `failed` either.

**Four kinds, one table (A2, Fowler Q4 over Hickey b).** The cannon's alternative was to split the table in two — a `session_pause` for the reversible pair and a `session_disposition` for the terminal one — on the ground that a pause and a disposition are different kinds of fact and that a single `kind` column lets a caller write a terminal row where it meant a reversible one. **One table is kept**, for three reasons that outweighed it: the four kinds share every column (actor, role, device, batch, reason, and A1's causal reference), so a split duplicates a nine-column shape to gain one discriminator; §3.4's derivation reads *the newest transition row* and a split forces that single read to become a two-table `UNION` on the hot path; and the property the split was buying — *the schema states which kinds are terminal* — is bought more cheaply and more visibly by **§4.5's per-kind guard table**, which states terminality as a rule with a test rather than as a table name a reader has to infer it from. **Hickey's dissent is preserved in §14 and is not refuted**: if a caller ever does write `voided` where it meant `parked`, that is an unrecoverable append and the split would have made it unrepresentable. The mitigation is that `voided` is restricted to `owner`/`manager` (S14) while `parked` is available to everyone, so the two are not reachable from the same authorization in the first place.

**(b) The copy / listing lifecycle — an object and its bindings.**

```
  physical_item created ──► (bound) drafted ──► published ──► sold ──► returned ──► (re-listable)
        │                        │                  │           │
        │                        └─► withdrawn ◄────┘           └─► refunded / sale voided
        └─► written_off (lost, damaged, stolen, donated, returned_to_seller)
```

This machine is **already modelled by 036** and this record adds only one table to it (§4.4). Its states are the derived labels 036 §7.3 already specifies — `physical_item_disposition` reads `in_stock | listed | sold | returned | written_off` from the event tables in a fixed precedence, and `listing_link_active` is `listing_link` where no deactivation exists. What 036 left open is the *observed* half — the transition from a created draft to a live listing, which is the T19 surface — and §4.4 closes it.

### 2.3 Where the two machines hand over — exactly

The handover is one row and one call, and it is already specified in 036; this record only names it as the machine boundary.

> **The session machine ends when `commerce` creates the `listing_link` that binds a `physical_item` to a channel listing (036 §3.2). The copy machine begins at that same row.** The session's last state is `drafted`; the copy's first listing state is `drafted` as well, and they are the *same event seen from two subjects* — not two events.

The sequence, on one transaction handle (029 §12), in the order 036 §4.3 and §5.1 D3 fix:

1. `workflow` has a current `human_confirmation` (036 §4.3's resolution requires it) and a current `condition_assessment` and `pricing_snapshot`.
2. `workflow` writes **`scan_session_item_resolution`** — `method ∈ {created, copy_code, human_pick}`, `UNIQUE (scan_session_id)` (036 §4.3). This is the **copy resolution**: either a new `physical_item` row is created, or the session resolves onto a copy that already exists. **This row is the boundary.** Before it there is an episode and no object; after it, an object the episode is attached to.
3. `workflow` calls `commerce`'s public bind function on the same handle. `commerce` writes `shopify_draft` (the creation outcome) and `listing_link` (the binding, with its `idempotency_key`), and INSERTs the `physical_item_active_listing` row whose primary key is what makes D1 a database guarantee (036 §5.2).
4. **No transition row is written at all** — `drafted` is implied by the `shopify_draft` + `listing_link` pair itself and needs no fact of its own (§3.3's rule). *(v1.0.0 wrote one on a failed draft; A4 struck it: a failed draft is the `shopify_draft` row with `status='failed'`, and the session correctly reads `priced`.)*

The edge is `workflow → commerce`, which 029 §3.1 already permits; **no new dependency edge is created and no L2→L2 edge appears.** After step 3 the session is inert: every later event — publication, sale, return, write-off — names the `physical_item`, and no query needs to find a session to answer "what happened to this book".

**What crosses the boundary and what does not.** The copy carries forward the *decided* facts by reference (`created_from_confirmation_id`, and the listing's price and condition copy, composed once at draft time). It does **not** carry the session's state: a copy has no idea whether the session that produced it was later voided, and it should not — an episode being repudiated does not un-sell a book. That asymmetry is deliberate and is invariant I11.

## 3. Decision B — State is derived from the log, and `scan_session.status` is retired

### 3.1 The rule

> **Every state in both machines is a DERIVED read model over immutable records that already exist. No table in Longbox stores a current state. `scan_session.status` is deprecated, then dropped.**

This is locked decision 4 applied to the one place it was not applied. 034 E15 already names the anomaly in passing — *"`scan_session` is mutable too … which is what makes §4's added columns an ordinary expand rather than a Hickey violation"* — and 036 §9 A1(a) names the cost — *"inventory identity would be the one identity in the system that can be edited in place, the precise inversion of locked decision 4"*. This record removes the anomaly rather than continuing to route around it.

The argument that settles it is not aesthetic. **A mutable status column and an immutable log are two sources of truth for one fact, and they can disagree.** They already do: today a session whose draft call fails reads `confirmed` forever while a `shopify_draft` row with `status='failed'` sits underneath it (E4); a session confirmed twice reads `confirmed` with no record that the second confirmation happened at a moment when the first had already produced a draft (E9); and four of the twelve states cannot be written at all (E6, E8). Every one of those is a disagreement between the column and the log, and **the log is right in every case**. A derived view cannot disagree with the log, because it has nothing to disagree with.

### 3.2 The implied ladder — which record witnesses which state

Each session state is witnessed by the existence of a record. This is the **implied rung**, and it needs no new table:

| Rung | State | Witness — the record whose existence implies it | Owning module |
|---|---|---|---|
| 0 | `intake` | the `scan_session` row exists and no other record does | workflow |
| 1 | `captured` | ≥1 `scan_photo` row (`001:73-80`) | workflow |
| 2 | `proposed` | ≥1 `candidate_set` row (`001:82-…`); an `llm_rerank` row refines the band but does not raise the rung — a barcode-only resolution is a proposal too | resolution |
| 3 | `confirmed` | ≥1 non-superseded `human_confirmation` (`human_confirmation_current`, `003:120-124`) | workflow |
| 4 | `conditioned` | ≥1 non-superseded `condition_assessment` (`condition_assessment_current`, `003:108-112`) | condition |
| 5 | `priced` | ≥1 non-superseded `pricing_snapshot` (`pricing_snapshot_current`, `003:114-118`) | valuation |
| 6 | `drafted` | ≥1 `shopify_draft` row with `status='draft'` **and** a `listing_link` binding it (§2.3 step 3) | commerce |

**Why existence and not a timestamp comparison.** The rungs are not a total order over time — a re-price after a draft is an ordinary correction and must not push the session back to `priced`. The ladder therefore reads *highest rung whose witness exists*, and a correction within a rung is handled by that rung's own supersession chain (`003:84-104`), which is already built. **Moving backwards is never inferred; it is always an explicit fact (§3.3).**

### 3.3 The explicit transitions — `scan_session_transition`

**Four** session transitions are **not implied by any other record**, because nothing else in the system is written when they happen: **park, resume, reopen, void.** Each is a decision by a person, and there is no `park_photo` or `void_snapshot` to infer it from. They get **one** append-only fact table (A2):

```
scan_session_transition(
  id                uuid PK DEFAULT gen_random_uuid(),
  shop_id           uuid NOT NULL REFERENCES shop(id),          -- locked decision 4
  scan_session_id   uuid NOT NULL REFERENCES scan_session(id),
  kind              text NOT NULL
      CHECK (kind IN ('parked','resumed','voided','reopened')),   -- A2, A3, A4
  reopened_to_rung  text
      CHECK (reopened_to_rung IN ('captured','proposed','confirmed','conditioned','priced')),

  -- A1 — THE CAUSAL REFERENCE. The highest-witness record this transition was
  -- issued against: what the actor was actually looking at. §3.4 clause 2 compares
  -- against THIS, not against a clock. NULL only for a legacy client that did not
  -- send one, and every such row is counted and logged (I18).
  against_table     text
      CHECK (against_table IN ('scan_photo','candidate_set','llm_rerank','human_confirmation',
                               'condition_assessment','pricing_snapshot','shopify_draft',
                               'scan_session')),
  against_id        uuid,

  observed_state    text NOT NULL,      -- the derived state the actor was shown; a witness to
                                        -- what they believed, never a key and never authoritative
  reason            text NOT NULL,      -- 033 §5.6: "one line: bad photo, wrong book, second look"
  operator_id       uuid REFERENCES app_user(id),   -- 034 §2.5; NULL pre-G2, never backfilled
  actor_verified    boolean NOT NULL DEFAULT false, -- 003:44-73's rule, applied to this table
  actor_role        text NOT NULL
      CHECK (actor_role IN ('operator','owner','manager')),        -- A3/A4: no 'system' writer
  device_id         uuid REFERENCES device(id),     -- 034 §2.8; NULL for desktop
  batch_id          uuid REFERENCES batch(id),      -- 034 §2.11
  created_at        timestamptz NOT NULL DEFAULT now(),

  -- A2: reopened_to_rung is present exactly when the kind is 'reopened', and never otherwise.
  CHECK ((kind = 'reopened') = (reopened_to_rung IS NOT NULL)),
  -- A1: the reference is whole or absent; never half of one.
  CHECK ((against_table IS NULL) = (against_id IS NULL)),
  -- voided and reopened are decisions, not observations: only a shop principal writes them.
  CHECK (kind IN ('parked','resumed') OR actor_role IN ('owner','manager'))
)
```

Append-only, **workflow-owned** (029 §2.2 — workflow owns "the canonical state machine and its authorized transitions (E02-B06)" by name). Indexes: `(scan_session_id, created_at DESC)`, `(shop_id, kind, created_at DESC)` for the resumable-session list (§7), and `(against_table, against_id)` so a record can be asked which transitions were issued against it.

**Note what is NOT in the CHECK, and why.** There is **no `'system'` actor role** — after A3 no machine writes a row here at all, which is the strongest possible form of 033 §5.2's rule. There is **no `'abandoned'` kind** — it is derived (A3). There is **no `'failed'` kind** — every failure is a record (A4). And there is **no `'published'` kind** and there never will be (F1). The enum is four values because four things happen that nothing else records; every other state in this document is read out of the log.

**Why `reopened` is on this list and `confirmed` is not.** The owner's send-back (033 B5, §5.6) moves a session backwards from `drafted` to a named rung so the item is re-scannable. Nothing else in the system records that: the superseding `human_confirmation` the send-back eventually produces is written *later, by the operator*, and between the two acts the session must read as reopened rather than as still-drafted. So a send-back is `kind='reopened'` with `reopened_to_rung='confirmed'` (or lower), plus the `task` row 034 §2.12 already specifies. The forward rungs stay implied because their witnessing records are written anyway — writing a `confirmed` transition beside every `human_confirmation` would be storing the same fact twice, which is the thing this record exists to stop.

#### `against_table` / `against_id` — time is a proxy for causality (A1, Hickey)

This is the costliest amendment and the one worth reading twice. v1.0.0's derivation compared `transition.created_at` against the witnessing record's `created_at` and took the later one. **A timestamp comparison is an inference about causality from a proxy for it**, and the proxy fails in exactly the cases that matter:

- **Clock and commit skew.** Two rows written microseconds apart in different transactions can commit in an order their `created_at` values do not reflect; `now()` in Postgres is transaction-start time, so a long transaction stamps its rows *earlier* than a short one that started later and committed first.
- **The offline queue.** E05-B08's queue replays a park recorded on the counter minutes ago against a session another device has since advanced. Under the timestamp rule the stale park wins if its clock ran fast, and loses meaninglessly if it did not. Neither answer is about what the operator saw.
- **The two-device case (§5.1).** The whole point of that section is that a second actor may be looking at an older world. A timestamp cannot tell "I parked the session I was looking at" from "I parked a session someone else had already advanced" — and those are different acts deserving different outcomes.

So a transition **records what it was issued against**: `against_table` / `against_id` name the highest-witness record the actor was shown. **§3.4 clause 2 then asks a causal question, not a temporal one** — *is the reference still the current witness?* — and falls back to `created_at` only for a legacy row that carries no reference, **logging the fallback each time** so the residue is counted rather than assumed away (I18). The cost is two columns, one CHECK, one index and a required field on every client call; the property bought is that the derivation is a statement about **what happened**, not about **what the clocks said**.

**`actor_verified` is on this table for the same reason 003 put it on four others** (`003:44-73`): a pre-G2 transition is written by an unauthenticated caller (034 E6), is unattributable **by construction, not by policy**, and **is never backfilled to `true`**. `operator_id`, like the other four tables', sits behind identity's audited accessor and the break-glass role (034 §3.3, A5; 019 T35) — a `scan_session_transition` row's actor is per-operator data and is not readable outside break-glass.

### 3.4 `scan_session_current_state` — the derived-state rule, stated once

> Let **`implied`** be the highest rung in §3.2 whose witnessing record exists for the session, and let **`W`** be that witnessing record (its table and id).
> Let **`t`** be the newest `scan_session_transition` row for the session.
> *(Limitation, stated: "newest" orders transition against transition by `created_at`. A1 removed the wall-clock proxy for transition-against-record; two transitions issued against the same witness, such as a replayed `parked` from E05-B08's queue and a live `resumed`, are still separated by a clock. Both rows persist and clause 1 keeps `voided` order-independent, so the hole is bounded. E02-B07 owes a tie-break rule, and I18 counts the fallback either way.)*
>
> 1. **Terminal.** If **`t.kind = 'voided'`** → the state is `voided`. Terminal, whatever else exists: it is the last row a session may ever receive (I5).
> 2. **Causal comparison (A1).** Else if `t` exists and `t` **still speaks to the current world** — that is, `(t.against_table, t.against_id) = W`, **or** `t.against_*` names a record at a rung **at or above** `implied` — then the state is:
>    - `parked` if `t.kind = 'parked'`;
>    - `t.reopened_to_rung` if `t.kind = 'reopened'`;
>    - `implied` if `t.kind = 'resumed'` — a resume asserts no rung of its own; it only ends a park.
>    **If `t.against_*` names a record *below* `implied`, the transition is stale and is ignored**: the session advanced past what its author was looking at, and a park issued against a world that has since moved on is not a statement about the world that exists now. The row is kept forever; it is simply not the current word.
>    **Fallback, logged (A1).** If `t.against_table IS NULL` — a legacy client that predates the field — the comparison degrades to `t.created_at > W.created_at`, **and the view increments a fallback counter that I18 asserts against.** Time is a proxy; a proxy in use is a thing to count, not a thing to forget.
> 3. **`abandoned` — a derived predicate, not a row (A3).** Else, if the state so far is non-terminal, **no witnessing record and no transition has been appended for longer than `abandon_after`**, and the newest transition (if any) is not a `resumed`, then the session **reads** `abandoned`. `abandon_after` is a **signed OPEN parameter stored in the view's own definition version** (§3.5), not a column, not a fact and not a sweep.
> 4. Else → **`implied`**.
>
> A session with no records at all is `intake`.

**Why `abandoned` is a predicate and not a fact (A3, Hickey c over Fowler Q3).** v1.0.0 permitted a named system sweep to write an `abandoned` transition row, mitigated by an `actor_role='system'` marker and a `derivation_version`. **The cannon struck the write**, and the reasoning generalises past this record: *abandonment is the absence of an event, and an absence has no author.* 033 §5.2 says it in one line — *"The session stays incomplete forever. That is the honest state; it is never auto-completed"* — and a sweep row is an auto-completion however carefully it is labelled. Three concrete costs of the row that the predicate does not pay:

1. **It is unfixable if the parameter was wrong.** The row is append-only. Change the staleness rule from four weeks to eight and every previously-written row is now a false statement that cannot be edited, only superseded by a second machine guess. **A view definition is versioned and re-derives; an append-only row does not.**
2. **It races the operator.** A person who walks back to a four-week-old parked session and resumes it does not need the sweep's row retracted — under the predicate the session simply stops reading `abandoned` the moment a record is appended, because the predicate is a statement about *now*.
3. **It manufactures an actor.** `actor_role='system'` on a table whose every other row is a person's decision is a category the schema did not need; removing it is why §3.3's `actor_role` CHECK is three values and not four.

**Fowler's dissent is preserved in §14 and is not refuted**: a named sweep with a stored `derivation_version` is *not* silent completion — it is auditable, and it gives reporting a row to join rather than a predicate to recompute. The counter that carried the decision is that the predicate gives reporting the same number for free (§3.5) while keeping 033 §5.2 literally true, and that a wrong parameter costs a view redefinition instead of a permanent lie in an append-only table.

Four properties this buys, and they are the whole point:

- **It is total.** Every session has exactly one state, computed from rows that already exist, for every session ever written — including the pre-migration ones, which need no backfill because the ladder reads their existing records (§8.4).
- **It is monotone except where a human said otherwise.** The rung only rises by a record being appended, and only falls when someone wrote a `reopened`, `parked` or `voided` row with their name and reason on it. **There is no path by which state moves backwards silently** — which is exactly what E9 permits today.
- **It is causal, not chronological (A1).** A transition wins because it still speaks to the record it was issued against, not because its clock ran later.
- **It cannot be wrong.** There is no second copy of the fact to drift from — and after A3 there is no machine-authored copy either.

### 3.5 `abandon_after` — a signed OPEN parameter, stored in the view's definition version

`scan_session_current_state` carries its own `definition_version` string — the same idiom 034 §2.9 uses for `labor_shift.derivation_version`, moved from a row to the view because the view is the only thing that computes it. The parameter it names:

| Field | Value |
|---|---|
| Parameter | `abandon_after` — the elapsed time with no witness record, no transition and no resume after which a non-terminal session reads `abandoned` |
| Value today | **UNSET.** This record **refuses to invent a second unmeasured number** beside 034 §2.9's 45-minute gap rule |
| Rung | **PROPOSED / OPEN** (018 A3). No Longbox session data exists to derive it from |
| Closing evidence | the distribution of gaps between a session's last record and its next one across Pilot A and B, **segmented as 034 A6 segments the gap rule** — a solo owner-operator's four-hour counter interruption is not a shared-device shop's handoff |
| Owner | product (Jeremy), by a 006 decision-log row naming old value, new value, motivating batch and evidence rung (018 C3) |
| Guard | the value is **in the view's `definition_version`**, so changing it re-derives every session forward and restates no history. A reader can always ask which rule produced a given reading |
| Red line | 018 C3: the parameter is never moved *after seeing a result it would change*, without a 006 row saying so in those words |

**Until it is signed, `abandoned` is reported OPEN and never rendered as a count** (019 §3.0's rule for affected rows). A session with no activity simply reads its rung, which is the honest answer and the one 033 §5.2 already prescribes.

### 3.6 The history view

The companion view **`scan_session_state_history`** is the same ladder unrolled: one row per state entry, `(state, entered_at, witness_table, witness_id, actor_role)`, ordered — a `UNION ALL` over the seven witnessing tables and the transition table. **The decision strip (022 P8, 021 C4, 033 A11) is a projection of this view and is never stored** (§7). Because every transition row now carries `against_table`/`against_id` (A1), the history view also renders **what each actor was looking at when they acted**, which is the audit question 033 C8 asks — *"the owner is told what the record shows: what was proposed, what the person confirmed"* — and which a timestamp alone could not answer.

## 4. Decision C — The transition table: who may drive what, and by which record

### 4.1 The actors

Six drivers, from 034 §2.6's closed role enum plus the two non-human principals this record needs to name:

| Driver | What it is | May it write a `human_confirmation` or `condition_assessment`? |
|---|---|---|
| `operator` | the person at the box (034 §2.6; 033 Blueprint A) | **Yes** — this is the whole job |
| `owner` | the owner at review (034 §2.6; 033 Blueprint B) | **Yes**, as a superseding record with `source='owner_review'` (`001:116`) |
| `manager` | same surfaces, scoped to their locations | Yes, same as owner within scope |
| `support_break_glass` | the **only** technical read path to per-operator data (022 P3; 034 §2.6) | **No.** Break-glass is a *read* role. It may write nothing on the pipeline; a support fix is a request to a human at the shop (033 C6, C8) |
| `system` | a watcher or a worker (029 §2.9's platform runtime) | **Never** (F4). And after A3 a system principal writes **no `scan_session_transition` row at all** — its only write on either machine is a `listing_status_observation` (§4.4), which is an *observation of a channel*, not a decision about a session |
| `provider` | a vision or pricing adapter behind the seam (029 §4) | **Never.** A provider returns a proposal or a comp; it does not write a record — `resolution` and `valuation` do (029 §2.4, §2.6) |

### 4.2 The session machine's transitions

Every row: the pair, the driver, the record that carries it, and the guard that must hold. **"Implied" means the state changes because that record was appended — there is no separate transition row.**

| # | From → To | Who may drive it | By which record | Guard |
|---|---|---|---|---|
| S1 | *(none)* → `intake` | `operator` (post-G2, authenticated) | `scan_session` INSERT (`scanSession.ts:19`) — implied | **T33 consent (§4.5 G-a)**; **batch present post-G2 (G-b)** |
| S2 | `intake` → `captured` | `operator` | `scan_photo` INSERT — implied | photo validated, incl. `file.truncated` (`routes:139`, 016 C2) |
| S3 | `captured` → `proposed` | `operator` triggers; `resolution` writes | `candidate_set` (+ optional `llm_rerank`) — implied | none |
| S4 | `proposed` → `confirmed` | **`operator` or `owner` only** | `human_confirmation` — implied | **F3**: `source='one_tap'` forbidden when the driving `llm_rerank.contradiction` is true |
| S4′ | `captured` → `confirmed` | `operator` | `human_confirmation` with `source='manual_search'` — implied | 033 §5.3's manual dead end: the flow must end in a completable action, so `proposed` is **skippable** and `confirmed` is not |
| S5 | `confirmed` → `conditioned` | **`operator` or `owner` only — never a machine** | `condition_assessment` — implied | **F4**; grade **range** + defects, never numeric (T7, non-waivable; **037 §1.1(1)** — the shop's opinion is "the only condition statement that may appear on a listing") |
| S6 | `conditioned` → `priced` | `operator` triggers; `valuation` writes | one `pricing_snapshot` **per source** (036 §2.3 cite `001:133`; 005 §Pricing) — implied | a stub source is flagged, never reported as live (033 D5) |
| S7 | `priced` → `drafted` | `operator` triggers; `commerce` writes | `shopify_draft` (`status='draft'`) **+ `listing_link`** (§2.3) — implied | **F6** condition present; **G-c** no open hold; **G-d** D1 (036 §5.1); **G-f** 037 §4.1's owner-review triggers |
| S8 | any rung → `parked` | `operator` | `scan_session_transition` `kind='parked'` with its `against_*` reference | none — parking is always allowed (033 §5.2) |
| S9 | `parked` → *(the rung it was parked at)* | `operator` | `scan_session_transition` `kind='resumed'` | the session is not terminal |
| S10 | *(struck at A4 — there is no `failed` transition)* | — | every failure is witnessed by a record; the session reads its prior rung (§4.6) | — |
| S11 | after a failure → *(the rung it failed at)* | `operator` | the retry's own record — implied. **No transition row is written for either the failure or the retry** | 033 C6: a re-run appends; the failed attempt stays |
| S12 | `drafted` → `reopened(captured\|proposed\|confirmed\|conditioned\|priced)` | **`owner` or `manager`** | `scan_session_transition` `kind='reopened'` + a `task` of kind `send_back` (034 §2.12) | reason NOT NULL (033 §5.6) |
| S13 | any non-terminal → `abandoned` | **nobody — it is DERIVED (A3)** | no record. The predicate fires from the **absence** of one, past `abandon_after` (§3.5) | non-terminal, and it un-fires the moment anything is appended |
| S14 | any non-terminal → `voided` | **`owner` or `manager` only** | `scan_session_transition` `kind='voided'`, reason NOT NULL | §4.6; **terminal** (the only terminal kind) |
| S15 | within a rung: a correction | `operator` or `owner` | a superseding record naming its predecessor via `supersedes_id` (`003:84-104`) | **the rung does not change** (§3.2) |

### 4.3 The copy / listing machine's transitions

| # | From → To | Who may drive it | By which record | Guard |
|---|---|---|---|---|
| C1 | *(none)* → copy exists | `operator` (from a confirmed scan) or `owner` (bulk intake / manual) | `physical_item` + `scan_session_item_resolution` (036 §2.2, §4.3) | `origin='scan'` ⇔ a confirmation exists (036 §2.2 CHECK) |
| C2 | copy → `drafted` (listed) | `commerce`, called by `workflow` | `listing_link` + `physical_item_active_listing` (036 §3.2, §5.2) | D1, D2, idempotency key (036 §5.1) |
| C3 | `drafted` → **`published`** | **NOBODY inside Longbox.** A person, in the Shopify admin (033 B3, §7) | **`listing_status_observation`** (§4.4), written by the `system` watcher | **F1** — see below |
| C4 | `published` → `delisted` / `archived` | the shop, in the channel | `listing_status_observation` by the watcher | — |
| C5 | listed/published → `sold` | `operator`/`owner` at the counter, **or** `commerce` handing a connector observation **up** to `workflow` | **`sale_event`** — workflow-owned (036 §2.4, A3), plus `listing_link_deactivation` `reason='sold'` **in the same transaction** (036 D3) | **D4**: one writer, two callers; **no POS-specific write path may exist** |
| C6 | `sold` → `returned` | `owner` | `return_event` (036 §7.2.1) | — |
| C7 | `sold` → *refunded* / *sale voided* | `owner` | `refund_event` / `sale_resolution` (`kind='sale_voided'`) | **`sale_event` is never deleted** (036 §5.4) |
| C8 | any → `written_off` | `owner` or `manager` | `write_off_event` (036 §6.3) | must deactivate any active binding in the same transaction (036 I5) |
| C9 | listed → *withdrawn* | `owner` | `listing_link_deactivation` `reason ∈ {delisted, archived, withdrawn, error, superseded}` | a Whatnot binding is withdrawn **by a human act, never by a webhook** (036 §3.3) |

### 4.4 The one table this record adds to the copy machine — `listing_status_observation`

E11 is the finding that forces it: `shopify_draft` is append-only, so migration 003's widened CHECK created three values (`published`, `delisted`, `archived`) that **no legal write path can produce**. Writing them would require either an UPDATE the trigger refuses, or a second `shopify_draft` row indistinguishable from the retry 036 E6 records as unprevented. Meanwhile 019 T19 — non-waivable, `any → K1` — needs `published_by`, and E12 shows the column does not exist.

```
listing_status_observation(
  id                uuid PK DEFAULT gen_random_uuid(),
  shop_id           uuid NOT NULL REFERENCES shop(id),
  listing_link_id   uuid NOT NULL REFERENCES listing_link(id),   -- 036 §3.2
  observed_status   text NOT NULL
      CHECK (observed_status IN ('draft','published','delisted','archived','deleted')),
  published_by      text,        -- 019 T19: the channel's actor string, VERBATIM as returned.
                                 -- 'app' is the K1 discriminator and must be storable so the
                                 -- detector can find it; it is never a value Longbox writes.
  external_updated_at timestamptz,
  observed_via      text NOT NULL CHECK (observed_via IN ('webhook','poll')),
  raw               jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now()
)
CREATE INDEX ON listing_status_observation (listing_link_id, observed_at DESC, id DESC);
```

Append-only, **`commerce`-owned** (029 §2.7 already claims "webhook/poll reconciliation, and the observed listing lifecycle"). Its derived view `listing_link_current_status` is `DISTINCT ON (listing_link_id) … ORDER BY observed_at DESC, id DESC` — the `003:108-124` shape keyed on the channel-asserted time, not Longbox's arrival time (v1.1.2: a replayed webhook arrives later but asserts an earlier truth; `id` is a tie-break, not a clock). Migration 005 (E02-D02) lands this table FK'd to `shopify_draft` until 036's `listing_link` exists, with `observed_at`/`source` as the column names; E10-B03 adds `listing_link_id` beside it.

**Consequences, stated rather than discovered.** `shopify_draft.status` reverts to what it can honestly mean: **the outcome of the creation call**, `draft` or `failed`, exactly as `routes/scanSessions.ts:369` writes it today. The three lifecycle values added at `003:164-166` become **unreachable by design** and are deprecated in the same contract step that drops `scan_session.status` (§8.3). 022 P7 Q6's derivative retention window — *"life of the listing … computed from an observed lifecycle event (the T19 status watcher extended with `delisted`/`archived`)"* — reads `listing_status_observation`, and `retention_policy.anchor='listing_end'` (`003:190-…`) finally has a row to point at. This record does **not** decide the transport: webhook versus poll, and the achieved detection window, are E10-B05 and E10-B08's, and 036 §10 Q6 already names the latency as load-bearing.

### 4.5 Forbidden transitions and guards

**Forbidden — each one a rule a test can fail on:**

- **F1 — Nothing inside Longbox may cause `published`.** No `kind='published'` exists on `scan_session_transition`; the value is not in its CHECK. On the copy machine, `published` is reachable **only** through a `listing_status_observation` written by the watcher, whose `observed_via` is `webhook` or `poll` — never a Longbox-originated act. A `published_by='app'` row is **K1** (019 T19, non-waivable; 033 B3; locked decision 3). The cheapest enforcement is the one 034 §3.3 used for T35: **make it an architecture-gate failure.** `commerce` may not import `workflow` (029 §3.1), so no pipeline path can reach the publish surface; and the Shopify client emits `status: DRAFT` by construction (`src/services/shopify.ts:28`, 033 A10). **A7 makes the gate bite at merge**: adding any route under `src/routes/` that imports commerce's publish surface fails `depcruise` in CI as a required check (E02-B10), so the rule is caught in review rather than discovered at runtime — see I4.
- **F2 — No state may skip `confirmed`.** `conditioned`, `priced` and `drafted` each require a non-superseded `human_confirmation` to exist. `proposed` **is** skippable (S4′) — 033 §5.3's manual dead end must reach a draft — but the human's ruling never is. This is 022 P1 in the ladder: *the system proposes; a person confirms every identity.*
- **F3 — A contradiction removes the one-tap path.** When the driving `llm_rerank.contradiction` is true, a `human_confirmation` with `source='one_tap'` is refused (locked decision 7; 033 §5.4; 022 P1). The band is downgraded and the session renders as a forced pick. This is a **schema-level** rule, not a UI convention: the API rejects it, so a client that skips the downgrade cannot produce the row.
- **F4 — `conditioned` can never be machine-driven.** A `condition_assessment` may be written only under `actor_role ∈ {operator, owner, manager}`. No `system` or `provider` path exists, and none may be added (locked decision 5; 022 P1; T7 non-waivable). **037 §1.1 is now the governing text and it is sharper than this record's own draft was**: a condition value not authored by a person in front of the book is an **estimate**, estimates exist only for the T8 exercise and eval work, and *"an estimate that reaches any of those surfaces is a defect, not a feature."* 037 §7 I3 further forbids **every suggestion-shaped substitute** — a sticky last range, options ordered by frequency, a shop-level default — because *"a proposal does not have to come from a model to be a proposal"*; 037 §1.4 D1 records that `public/app.js:233-234` ships exactly such a default today. Corollary, from 029 §2.5: `condition` may not import `valuation` — *a condition call that can read the money is a condition call under pressure*.
- **F5 — State never moves backwards by inference.** A superseding record supersedes **within its rung** and does not lower it (§3.2). A genuine step back is a `scan_session_transition` row carrying an actor, a role and a reason — 022 P2's *"undo writes a superseding record; it never edits history"* plus the missing half: **the fact that a step back happened is itself a record.**
- **F6 — `drafted` requires a condition assessment.** This closes E10: today the draft path treats condition as optional and composes an empty grade string. A listing with no condition line is a 022 P8 honesty failure and a T20 owner-acceptance defect waiting to happen.
- **F7 — No transition may be driven by an unverified actor after G2.** Pre-G2 rows carry `actor_verified=false` and are **never backfilled** (`003:44-73`; 034 §4.4). After E03-B02/B03, a transition with `actor_verified=false` is a defect, not a legacy row.
- **F8 — A void is never a delete, and a terminal state is terminal.** `voided` and `abandoned` append; nothing is removed (036 D5). No record of any kind may be appended to a session after its terminal transition (I5).
- **F9 — No route may accept a state as a filter, sort or grouping parameter alongside an operator identifier** (019 T35(a)). The resumable-session list filters on `state`; it may never filter on who parked it.

**Guards — preconditions on a transition, each owned elsewhere:**

| Guard | Rule | Blocks | Source |
|---|---|---|---|
| **G-a** consent | a session may not leave `intake` without a consent reference naming the covering buy slip | S1 → S2 | 019 T33 **non-waivable, G1 blocker**: *"capture does not start until the slip exists"*; 033 B10 |
| **G-b** batch | after G2, a session must carry `batch_id` (and `location_id`, `device_id`) | S1 | 019 §3.0; 034 §2.11, §2.13 |
| **G-c** hold | an open `retention_hold` naming the session or its copy blocks `drafted` and blocks every sweep | S7 | 022 P7 Q6; 036 §6.2 |
| **G-d** D1 | at most one active `listing_link` per copy, across all channels | S7 / C2 | 036 §5.1 D1, enforced by `physical_item_active_listing`'s primary key |
| **G-e** inspection | `expanded_inspection` recorded at capture; T10 measures `false` only | recorded, not blocking | 019 §3.0, T10 |
| **G-f** owner review | a draft firing any of 037 §4.1's **five triggers** is held for the owner and carries a one-line reason; on **trigger 1 (value floor)** the owner must **confirm or edit the condition field itself** before publish, writing a superseding `condition_assessment` attributed to them | S7 → publish | **037 §4.1, §4.2, §4.4**; 019 K2 |

**On G-f, and why it is a guard on the *listing* rather than on `drafted`.** 037 §4 is explicit that its triggers are stronger than "nothing publishes without a person": they say *the owner*, not the scanning employee, must see the item, and that trigger 1's gate *"is not satisfied by tapping publish"* — the owner must touch the condition field, because 019 K2 fires on a single high-band false confirm that reached a published listing and a delay does not catch a single event. That lands **between** `drafted` and `published`, which is precisely the boundary §2.3 draws: the session is already over. So G-f is a guard the **copy machine** carries into C3, and 037 §4.4's superseding `condition_assessment` is written against the session that produced the copy — a correction inside rung 4 (S15), which does not move the session's state and should not. E10-B04 and E11-B02 own the mechanism; this record only records where the trigger sits in the machine.

#### Per-kind guards on the transition table (A2)

The schema states which kinds are terminal and which are reversible, so a reader does not infer it from a table name:

| `kind` | Terminal? | Who may write it | Reversible by | Enforced by |
|---|---|---|---|---|
| `parked` | **No** | `operator`, `owner`, `manager` | a `resumed` row, or any witnessing record | §3.4 clause 2; I3 |
| `resumed` | **No** | `operator`, `owner`, `manager` | n/a — it asserts no rung; it ends a park | §3.4 clause 2 |
| `reopened` | **No** | **`owner` / `manager` only** (CHECK) | a witnessing record at or above the reopened rung | §3.3 CHECK; I3 |
| `voided` | **YES — the only terminal kind** | **`owner` / `manager` only** (CHECK) | **nothing.** No record of any kind may follow it | §3.4 clause 1; **I5** |
| ~~`abandoned`~~ | *(not a kind — derived, A3)* | — | any appended record un-fires the predicate | §3.4 clause 3; I17 |
| ~~`failed`~~ | *(not a kind — witnessed by a record, A4)* | — | the retry's own record | §4.6; I19 |

### 4.6 `failed`, `voided` and `abandoned` — one fact, one predicate, and one thing that is neither

v1.0.0 made all three states and defined them against each other. **The cannon struck two of the three**, and what is left is sharper: only `voided` is a fact.

| | ~~`failed`~~ **(struck, A4)** | `voided` | ~~`abandoned`~~ **(derived, A3)** |
|---|---|---|---|
| **What it is** | **not a state.** Every failure is already a record; the session reads its prior rung | a **person decided** this episode should not count | a **derived predicate** over an absence, past `abandon_after` (§3.5) |
| **How it is stored** | as the failing record itself (below) | `scan_session_transition` `kind='voided'` | **nothing is stored** |
| **Who drives it** | nobody | `owner` / `manager` only (CHECK) | nobody — it fires from the absence of an event |
| **Terminal?** | n/a | **Yes — the only terminal kind** | **No.** Any appended record un-fires it |
| **Counted how** | by the record: T17's denominator, excluding declared-outage windows (019 T17; 033 D6) | excluded from every per-batch denominator, named in the batch note | reporting counts the **predicate**, and reports it **OPEN until `abandon_after` is signed** |

#### Where each failure is witnessed instead (A4, Fowler Q5)

The question the cannon asked was whether `failed` earns its place *given 019 K4* — *the pipeline never blocks on a provider* — and the honest answer is no: **a `failed` state is a place for a degradation bug to hide.** Every failure the state would have named is already recorded somewhere, and the session correctly reads the rung it actually reached:

| Failure | Where it is witnessed today | Session reads |
|---|---|---|
| Shopify draft call errors | `shopify_draft` row with `status='failed'` and the error payload (`src/routes/scanSessions.ts:369-370`; `001:152`) | `priced` — which is true: the draft did not happen |
| A pricing source 429s or times out | not snapshotted; reported in the response. Every configured source runs under `Promise.allSettled`, one dead source never blocks another (033 D2; `src/services/pricingService.ts`) | `priced` off the surviving source, or the policy floor — a first-class state, not an error (033 D4) |
| No credential for a provider | a **stub** result, flagged as a stub and never reported as live (033 D5; every external client degrades this way) | its normal rung |
| The model errors or abstains | the manual-search path — `human_confirmation` with `source='manual_search'` (033 A3, §5.3) | `confirmed`. **Not a failure; a different route to the same rung** |
| Photo upload truncated at the size limit | 413, **no row and no bytes** (`routes:139`, 016 C2) | `intake` — nothing was captured, which is the truth |
| A declared provider outage | a 006 row; the window is excluded from T17 (033 D6) | unchanged |

**The one real gap, named rather than papered over.** `POST …/identify` returns 502 on a provider error (`src/routes/scanSessions.ts:191`) and **records nothing at all** — no `candidate_set`, no `llm_rerank`, no error row. So a session whose identify call failed is indistinguishable from one where nobody pressed the button. That is a **missing record**, and the fix is to write one (a `candidate_set` with an empty candidate list and the error, or an `llm_rerank` error row), **not to invent a session state to stand in for it.** It is E06's to close and this record names it as the condition under which A4 is safe: *a failure without a record is the bug; a state would only have hidden it.*

#### `voided` versus `abandoned`, now that only one is a fact

`voided` is a **decision** — a person, with a name and a reason, saying this episode should not count. It is terminal because a repudiation that could be walked back is not a repudiation, and it is restricted to `owner`/`manager` because deciding what counts is not the scanning employee's call.

`abandoned` is an **absence** — nobody came back. Nobody authored it, so nobody signs it, so no row is written (§3.4 clause 3, and the three costs a row would pay). 033 §5.2 now holds **literally**: the session stays incomplete forever, is never auto-completed, is excluded from draft-gate counts, and simply *reads* as abandoned once enough time has passed — and stops reading that way the instant someone appends anything.

## 5. Decision D — Concurrency and idempotency

### 5.1 Two devices on one session

033 A13 and 034 §2.8 describe a shared counter phone passed between two people, and 034 makes the device an auth principal precisely so this is expressible. The failure to design for is **two clients appending to one session concurrently** — today nothing prevents it and nothing records it.

Under derivation, most of it is harmless: two concurrent `scan_photo` inserts are two photos; two `pricing_snapshot` rows are one per source by design (`005 §Scan events`). **The dangerous case is exactly one: two independent `human_confirmation` rows.** E15 is the finding — neither names the other via `supersedes_id`, so both are non-superseded peers, `human_confirmation_current` picks the newer by timestamp, and **nothing records that two people disagreed about what the book is.** That is a silent resolution of a genuine conflict, on the one record 022 P1 calls the truth of record.

**Decision.** A confirming write carries the id of the confirmation the client believed was current (or `null` for the first). If that no longer matches `human_confirmation_current`, the write is refused with `409` and the client is shown the other person's answer — the same shape as F3's forced pick: **ambiguity forces a human, and no guess is substituted.** If the client resolves it, the new row names the other as `supersedes_id` and the chain is honest. Concretely, on `human_confirmation`:

```sql
-- A confirmation names the state of the world it was made against. Two blind
-- confirmations cannot both be "current": the second must either supersede the
-- first explicitly, or be refused.
-- AMENDED BY 041 §3.5 (2026-09-04, amend-by-a-row under 029 §9). This column is
-- NOT built. The general shape below subsumes it: a confirmation issued against
-- confirmation X carries ('human_confirmation', X). One concept, one column pair,
-- one CHECK, one index — as this section's own last paragraph says, "the two
-- amendments are one idea".
ALTER TABLE human_confirmation
  ADD COLUMN IF NOT EXISTS against_table text,   -- CHECK per §3.3
  ADD COLUMN IF NOT EXISTS against_id    uuid,
  ADD CONSTRAINT human_confirmation_against_whole_or_absent
    CHECK ((against_table IS NULL) = (against_id IS NULL));
```

The check itself is `workflow`'s, inside the request transaction (§5.3), against `human_confirmation_current`. **This is not a lock**: the loser of a race gets a 409 and a person decides, which is cheaper and more honest than a lock and is the same posture 036 §5.2 takes toward the D1 race — *let the database refuse, then let a human resolve*. The same shape covers a transition: `scan_session_transition.against_*` (A1) is the confirmation case generalised, which is why the two amendments are one idea — **a write says what world it was made against, and the reader checks.**

**What the second device sees is a product requirement, not a status code (A9, Fowler 4).** A 409 that surfaces as a raw error string is 022 P6's *"a screen never blames the person"* violated on the one path where two people are already confused. So this is written as an **E05 acceptance criterion** and not left to a route:

> **E05 acceptance (E05-B09, with E05-B04's next-item loop).** When a confirming or transitioning write loses to another device, the operator is shown **the other person's answer and what to do next** — *"Someone else answered this one."* — with the other confirmation rendered beside their own and one action to keep theirs, which writes the supersession explicitly. Never a 409 body, never a stack trace, never the other operator's name (022 P3, 019 T35 — the surface says *someone*, and it is registered copy under 021 §3.1 before it is written). The same treatment covers a stale `parked` or `reopened` row that §3.4 clause 2 has ruled out: the operator is told their view was out of date and shown the current one, rather than silently having their action absorbed.

This is the one place where a schema decision reaches all the way to a screen, and naming it here is what stops it arriving at E05 as an unspecified error path.

### 5.2 A retry of the same POST

E16: no request carries an idempotency key, so a retried POST appends a second record. Over a flaky counter connection (033 §5.1, 019 T23 — *lost/duplicated items = 0*, non-waivable in effect through K1's absence but a signed 0 nonetheless), that is a duplicated record on every step and a duplicated **Shopify product** on the draft step (036 E6).

**Decision.** Every mutating endpoint accepts an `Idempotency-Key` header. `platform` owns one table (029 §2.9 already claims "idempotency keys"):

```
request_idempotency(
  id             uuid PK DEFAULT gen_random_uuid(),
  shop_id        uuid NOT NULL REFERENCES shop(id),
  idempotency_key text NOT NULL,
  route          text NOT NULL,
  request_hash   text NOT NULL,           -- refuses key reuse with a different body
  response_status integer NOT NULL,
  response_body  jsonb NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shop_id, idempotency_key)
)
```

A repeat call with the same key returns the stored response and **appends nothing**. A repeat with the same key and a different `request_hash` is a `422` — a client bug, not a retry. This is the same guarantee `listing_link.idempotency_key` gives the binding (036 §5.2), applied one layer up so the retry is a no-op at **every** step and not only the last one. E10-B09's outbox and retry budget then have something to be idempotent against.

**Retention of this table is explicitly deferred to E13-B01 (A9).** `request_idempotency` is the one table this record adds that stores a **response body**, which may carry shop data, so it is the one with a real retention question — and 022 P7's windows are the frame for answering it. **This record does not answer it**, does not set a window, and does not permit one to be assumed: E13-B01 owns it as a named obligation, and until then the table has no sweep. Recording the deferral is the point; an unowned table that grows forever is how a retention commitment quietly stops being true.

### 5.3 The 029 §12 single-request transaction — a blocking precondition, not a companion (A5)

> **⚠ It does not exist at `aa448bb` (E3), and nothing in §4.5's guards or §9's I14 can be asserted until it does.** `src/db.ts` exports `getPool` (`:5`) and `closePool` (`:12`) and no transaction helper; the only `BEGIN` / `COMMIT` / `ROLLBACK` in the repository are in `scripts/register-shop.ts:46`, `:75`, `:84`. This is the §0 blocking precondition restated where it bites.

029 §12's mechanism is what E02-B07 must build **before** the expand migration in §8.1:

1. `workflow` opens **one pg transaction per request** and commits or rolls back exactly once.
2. The handle travels explicitly as the **first parameter** of every writing public function.
3. **The transition fact and the step record commit together.** A `listing_link` and its `physical_item_active_listing` row; a `sale_event` and its `listing_link_deactivation` (036 D3); a `reopened` transition and its `task` row. Either both, or neither.
4. A partial failure rolls the whole request back, so a `scan_session` never holds a half-written Hickey chain.

**Point 3 is what the derived view depends on.** If a step record could commit without its transition fact, the view would compute a state nobody intended — which is a *different* way of being wrong from a stale column, and no better.

**What is UNTESTABLE until then, listed so nobody claims otherwise (A5, Fowler BLOCK 1):**

| Specified here | Cannot be asserted until E02-B07 ships §12 | Why |
|---|---|---|
| **G-a** — consent before `captured` (T33, non-waivable, G1 blocker) | the consent check and the first `scan_photo` are two statements with nothing binding them | without atomicity a photo can land against a session whose consent write rolled back |
| **G-c** — an open hold blocks `drafted` (022 P7 Q6) | the hold read and the draft write are two statements | a hold placed between the two is not seen |
| **G-d** — 036's D1/D2 and the sale-deactivation pair (D3) | 036 already states this: *"A partial failure rolls both back"* | a `sale_event` with a still-live binding is 036's own worked example of an unrecoverable half-write |
| **I14** — "the transition fact and its step record commit together" | there is no transaction to force a failure inside | the test's whole subject is missing |

**Ratification does not retire this risk.** The half-written Hickey chain 029 §12 describes is live at `aa448bb` — an exception between the `human_confirmation` insert (`routes:209-212`) and the `shopify_draft` insert (`routes:362-372`) leaves a permanently un-fixable partial chain, because the append-only triggers forbid repair. **Adopting this record does not change that by one line.** It changes only what E02-B07 is authorized to build, and the order it must build it in.

### 5.4 How the view stays consistent without a status column

It stays consistent because **there is nothing for it to be inconsistent with.**

A `SELECT` from `scan_session_current_state` runs in one MVCC snapshot over committed immutable rows. It cannot read a half-written chain (§5.3 point 4). It cannot read a row that was later edited, because no row in its inputs can be edited — `scan_photo`, `candidate_set`, `llm_rerank`, `human_confirmation`, `condition_assessment`, `pricing_snapshot` and `shopify_draft` all carry `forbid_mutation()` (`001:171-182`), and `scan_session_transition` joins them (§8.2). Two concurrent readers may see different states, a moment apart, and both are correct — each is a truthful statement about the log as of its snapshot.

**The cost, stated plainly.** A derived state is a **join, not a column read**, on a path that runs once per book. That is the real trade this record makes, and it is not free. Three things bound it: the view reads at most eight indexed `EXISTS` probes on `(scan_session_id)`, which is the index every one of those tables already has by FK; the resumable-session list (§7) is the only query that needs the state for *many* sessions at once, and it is the owner's list, not the capture loop; and if it ever measures badly the remedy is a **materialized** view rebuilt from the log — 036 §5.2's `physical_item_active_listing` is the precedent, and it comes with that record's two guards, I9 on contents and I18 on shape. **What is not an acceptable remedy is putting the column back.**

#### O-A — the plain view ships for the pilot only with a measurement attached (A6, Hickey e + Fowler d)

§13 Q2 asked whether this record was making, in the opposite direction, the error 036's own O-A obligation corrects: **rejecting an alternative on an unmeasured cost**, which is exactly what 018 caps at ASSERTED. The cannon's answer was that it was — v1.0.0 asserted the join is "bounded" without ever running it — and the amendment is binding on E02-B07:

> **O-A — the plain view is authorized for the pilot only if it ships with (a) a checked-in benchmark fixture and (b) a CI plan-shape assertion.** Before `scan_session_current_state` goes on any request path, E02-B07 lands:
>
> 1. **A benchmark fixture in the repo** — a seeded dataset at pilot-realistic scale (019 §5's cumulative ≥425 items across Pilot A/B/C, plus the sessions that produced no copy), with the per-call and per-list timings **recorded in a 006 row** naming the method, the dataset size, the observed figures and the date. Not a target — a measurement, so a later regression is visible against something.
> 2. **A CI plan-shape assertion** — `EXPLAIN` over the view on that fixture, asserting **index-only or index scans across all eight input tables and no sequential scan**. This is the check that actually holds: a timing on a developer's laptop drifts with hardware and dataset, but a plan that degrades from an index scan to a seq scan is a **structural** regression and fails deterministically. It is a gate-test in 019 v1.2.0's vocabulary, not a detector, and this record does not claim otherwise.
>
> **Materialization is decided from that measurement, not from this record's prose.** If the plan-shape gate cannot be held green, or the fixture shows the list query dominating the owner's review surface, the materialized form in §10 A5 is built — and it inherits 036's two guards (a contents rebuild and a CI shape gate), because a derived table without both is the drift surface A5 was deferred to avoid. **What the measurement may never conclude is that the column should come back.**

## 6. Decision E — Where a session's state is *not* the whole story

Two clarifications that will otherwise arrive as bugs.

**A session's state says nothing about the copy's.** After the handover (§2.3), the session is inert. A voided session does not un-list, un-publish or un-sell its copy (I11). If a book was drafted from an episode that is later repudiated, the corrective act is on the **copy** — `listing_link_deactivation` with `reason='error'`, and a corrective binding as a new row (036 §3.2) — not on the session. The session's void records that the *episode* was bad; the listing's deactivation records that the *listing* was.

**A batch's state is a projection, not a state machine.** 034 §2.11's `batch` is open until a `batch_close` row exists — the grant/release idiom, already decided. This record adds nothing to it. "How is batch LB-014 doing" is `GROUP BY` over `scan_session_current_state` for the batch's sessions, is a `reporting` read model (029 §2.8), and — per 019 T35 and 022 P3 — **is grouped by batch and shift, never by operator.**

## 7. API surface changes — the contract E02-B08 must carry

Today's endpoints that *set* status become endpoints that *append a fact*; the state becomes something you **read**, never something you **send**.

| Endpoint | Today | Under this record |
|---|---|---|
| `POST …/confirm` | appends `human_confirmation`, then `setSessionStatus(…, "confirmed")` (`routes:208-214`) | appends `human_confirmation` **only**; accepts `against_table`/`against_id` (§5.1, as amended by 041 §3.5) and `Idempotency-Key`; **rejects `source='one_tap'` on a contradiction (F3)** |
| `POST …/draft` | appends `shopify_draft`, then `setSessionStatus(…, "drafted")` **if `result.ok`** (`routes:362-373`) | appends `shopify_draft` **and** `listing_link` on one handle (§2.3); **409 without a condition assessment (F6)**; **409 on an open hold (G-c)**. **On failure it appends nothing extra (A4)** — the `shopify_draft` row with `status='failed'` is the record, and the session reads `priced` |
| `POST …/photos`, `…/identify`, `…/condition`, `…/price` | set nothing (E6) | unchanged in that respect — their records imply their rungs (§3.2). All four gain `Idempotency-Key`. **`…/identify` additionally gains an error record on a 502 (§4.6's named gap, E06)** — today it records nothing |
| **`POST …/transitions`** *(new)* | — | the **only** endpoint that writes a transition directly. Body `{ kind, reason, against: {table, id}, reopened_to_rung? }`, `kind ∈ {parked, resumed, voided, reopened}` — **four values (A2)**. `against` is **required** (A1); a request without it is accepted only from a legacy client and is counted (I18). `voided` and `reopened` require `owner`/`manager`; `reopened` opens the `task`. **`published`, `failed` and `abandoned` are not in the enum and cannot be** (F1, A4, A3) |
| `GET …/:id` | returns `{ session, events }` where **`session.status` leaks via `SELECT *`** — `getScanSession` selects every column (`scanSession.ts:31`) and the handler returns the row whole (`routes:104-111`) | **E02-B08 acceptance line (A8):** the response carries the **derived state** and the **transition history** — `{ session, state, transitions, events }` — and **the column never leaks**. Before the contract step that means an explicit projection rather than `SELECT *`; after it the column is gone. A `status` key in any response body is a defect, asserted by I20 |
| **`GET …/:id/decision-strip`** *(new, or a field on `GET …/:id`)* | none (033 A11: "none today") | `Book: proposed → you confirmed · Condition: you · Price: policy → you changed` — 021 C4, **computed from `scan_session_state_history`, never stored** (022 P8) |
| **`GET …/scan-sessions?state=parked`** *(new)* | 005 §API specs `GET /api/scan-sessions?status=in_progress`; **no such route exists** (only `GET /api/shops` and `GET …/:id` are registered, `routes:86`, `:104`) | the resumable list 033 §5.2 and E05-B09 need. Filters on the derived state. **Never accepts an operator parameter (F9, 019 T35(a))** |

**Three contract properties this fixes beyond the state machine.** Every mutating call carries actor, tenant, correlation id, idempotency key and schema version (E02-B08's own acceptance; 029 §10). 005 §API's `?status=in_progress` is retired as a name — the parameter is `state`, its vocabulary is §3.2's, and 005 gets a Version bump when E02-B08 lands rather than now. And **the `SELECT *` leak is closed by name (A8)**: E5 records that the dead column is *returned in a response body today* even though nothing branches on it, which means a client could already be reading it — so removing the column without first fixing the projection would be a breaking change discovered by a consumer rather than by us.

## 8. Expand-only migration sketch — for E02-B07 and E02-B10

**Nothing in this section is written.** It specifies a new migration file — `006_workflow_state_and_transitions.sql` if 034's `004` and 036's `005` have landed first; **E02-B10 owns the ordering and the rollback.** Per the agent contract, 029 and 034: a shipped migration is never edited, every statement is `IF NOT EXISTS` / `DROP-then-ADD`, the file is re-runnable by hand, and **no statement adds an UPDATE path**.

> **⚠ Ordered after 029 §12 (A5).** This migration does not land until E02-B07 has shipped the request transaction (§5.3). The order is **§12 transaction → this expand half → E02-B08 routes → E02-B10 contract step**, and it is not a preference: §8.1's views are safe to read only because point 3 of §5.3 holds, and four of §4.5's guards cannot be tested before it.

### 8.1 Expand — the new tables and views

1. **`scan_session_transition`** (§3.3) — `kind` CHECK over **four** values (A2), `reopened_to_rung` under its paired CHECK, **`against_table`/`against_id` with their whole-or-absent CHECK (A1)**, and the `actor_role` CHECK over **three** roles with no `system` (A3). Indexes `(scan_session_id, created_at DESC)`, `(shop_id, kind, created_at DESC)` and `(against_table, against_id)`.
2. **`listing_status_observation`** (§4.4) — **landed ahead of this list as migration 005 (E02-D02, PR #52)**, FK'd to `shopify_draft` because `listing_link` was unwritten; A5's rationale did not bite because no view and no guard landed with it. Index `(shopify_draft_id, observed_at DESC, id DESC)`; E10-B03 adds `listing_link_id`.
3. **`request_idempotency`** (§5.2) with `UNIQUE (shop_id, idempotency_key)` — `platform`-owned.
4. `ALTER TABLE human_confirmation ADD COLUMN IF NOT EXISTS against_table text` + `against_id uuid` with their whole-or-absent CHECK and an index on `(against_table, against_id)` (§5.1, **as amended by 041 §3.5** — the v1.0.0/v1.1.x `observed_current_id` is subsumed by A1's general shape and is not built).
5. `ALTER TABLE human_confirmation ADD COLUMN IF NOT EXISTS outcome text CHECK (outcome IN ('confirm','correct'))` — **E13**: 019 §3.0 names it a G2 prerequisite for T3 and T20 and `003` added only `supersedes_id`. Nullable forever for pre-G2 rows; **never backfilled** (034 §4.4's rule).
6. **Append-only triggers** over `scan_session_transition`, `listing_status_observation` and `request_idempotency`, via the `001:171-182` `FOREACH … EXECUTE format` loop in `003:237-248`'s idempotent `DROP TRIGGER IF EXISTS` form.
7. **The views**: `scan_session_current_state` (§3.4, carrying its `definition_version` string and the `abandon_after` parameter per §3.5), `scan_session_state_history` (§3.6), `listing_link_current_status` (§4.4). Every one a read model over immutable history holding no state — the `003:108-124` shape. **`scan_session_current_state` does not go on a request path until O-A's benchmark fixture and plan-shape gate land (A6, §5.4).**
8. **Deprecation, not removal**: `COMMENT ON COLUMN scan_session.status IS 'DEPRECATED by 000-docs/040 (E02-B06). Read scan_session_current_state. No writer after E02-B08; dropped in the contract step at E02-B10.'` The column is **kept and stops being written**; the CHECK stays until the drop.
9. **No data statement. No seed. No backfill** (§8.4).

### 8.2 The contract step — E02-B10, a separate migration, after the last writer is gone

This half **cannot** ride in the expand migration, because dropping a column that live code still writes breaks the deploy. It lands only after E02-B08 has removed `setSessionStatus` and its two call sites (`routes:213`, `:373`), and after the TypeScript surface (`ScanSessionRow.status`, `scanSession.ts:10`) and the three tests that assert `"in_progress"` (`tests/integration/scan-session-flow.test.ts:36`, `tests/integration/smoke.http.test.ts:67`, `tests/scan-session-service.test.ts:18`) have moved to the view.

1. Assert **zero writers**: a non-graph lint assertion that no file under `src/` contains `UPDATE scan_session` — the same class of check 029 §5 move 8 note N2 already obliges E02-B10 to add for `db.query` in routes, because import-graph analysis cannot see it.
2. `ALTER TABLE scan_session DROP CONSTRAINT IF EXISTS scan_session_status_check;`
3. `ALTER TABLE scan_session DROP COLUMN IF EXISTS status;`
4. **Add `scan_session` to the append-only trigger loop.** With the last mutable column gone, the one non-append-only table in the scan chain becomes append-only, and `001:174-176`'s array is finally complete. *(A `scan_session` row's remaining columns — `shop_id`, `created_by`, `created_at`, plus 034's `batch_id`/`location_id`/`device_id`/`expanded_inspection` — are set at creation and never corrected; a correction is a transition fact or a superseding record.)*
5. **Deprecate `shopify_draft`'s three unreachable status values** (E11): `DROP`/`ADD` the CHECK back as `('draft','failed')`, with a comment naming `listing_status_observation` as where the lifecycle now lives. This is a constraint change on a table whose **rows** stay append-only — exactly the move `003:158-166` documents and makes, in reverse.

**Step 4 is the point of the whole record**, and it is worth saying out loud: after it, **every table in the scan chain is append-only in the database, enforced by a trigger, with no exceptions** — and the sentence 029 §2.2 and 036 §9 A1(a) both have to qualify today stops needing the qualification.

### 8.3 Rollback

The expand half rolls back by dropping three tables, two columns and three views; nothing else read them. The contract half is **not** reversible by re-adding the column, because the column's *values* are gone and cannot be reconstructed for any session written between the two migrations — the derived state can, but the historical column value cannot. E02-B10 must therefore land the contract step **only** after the expand half has soaked with both paths live and the view proven equal to the column on every existing session (I8).

### 8.4 No backfill — and why none is needed

1. **No `scan_session_transition` row is created for any existing session.** No park, resume, abandonment, void or failure was ever recorded (E8), and manufacturing one would invent an actor and a reason. The transition table starts empty.
2. **No `listing_status_observation` row is created for any existing `shopify_draft`.** Nothing has ever observed a listing (E12; 036 E2's webhook grep, exit 1). A listing whose status was never observed **has no observed status** — an absence, not an assumed `draft`.
3. **`human_confirmation.outcome` is never backfilled.** 019 §3.0 pairs it with T3 and T20; deciding after the fact whether a confirmation was a `confirm` or a `correct` is precisely the fabrication 034 §4.4 point 3 forbids for `item_slice`.
4. **And the state itself needs no backfill at all** — which is the property that makes this migration cheap. §3.4's ladder reads records that **already exist**, so every session ever written gets a correct derived state the moment the view is created, with no data statement of any kind. A session that today reads `confirmed` while carrying a failed `shopify_draft` row will read `confirmed` under the view too — and for the first time that will be a *derivation* rather than a coincidence.

The precedent is 030 A1, 034 §4.4 and 036 §7.4: when the schema cannot distinguish "never captured" from "captured and empty", the answer is a new dated fact, not a guessed value — and a fabricated value in an append-only table is unfixable by construction, because the row cannot be updated (`001:171-182`).

### 8.5 The 029 amend-by-a-row entries this bead owes

029 §9 permits amending statements of fact about ownership **by a row**. **This record does not edit 029.** These are the exact rows for the parent to apply, alongside the seven 034 §7 and 036 §7.5 already carry.

> **Entry A — 029 §2.2 (`workflow`), "Tables owned".** Add **`scan_session_transition`**.
> *Rationale:* 029 §2.2 already assigns workflow "the canonical state machine and its authorized transitions (E02-B06)" by name; this is that machine's only table. Add a sentence: *"State is derived, not stored: `scan_session_current_state` is a view over the event tables plus `scan_session_transition`, and `scan_session.status` is retired at E02-B10."*

> **Entry B — 029 §2.7 (`commerce`), "Tables owned".** Add **`listing_status_observation`**.
> *Rationale:* 029 §2.7 already claims "webhook/poll reconciliation, and the observed listing lifecycle". This names the table that lifecycle lands in, and records why one is needed at all: `shopify_draft` is append-only, so the `published`/`delisted`/`archived` values added at `003:164-166` have no legal writer (040 §1 E11).

> **Entry C — 029 §2.9 (`platform`), "Tables owned".** Add **`request_idempotency`**.
> *Rationale:* 029 §2.9 already claims "idempotency keys" among platform's responsibilities; this is the table.

> **Entry D — 029 §2.10, the ownership table.** Add the three rows above, and amend the `scan_session` row's note: it is the one non-append-only table in the scan chain **until E02-B10's contract step**, after which it joins the `001:174-176` trigger array and the exception ceases to exist.

## 9. Invariants, as numbered testable statements

Each is falsifiable and names the test that will decide it. **None of these tests exists** (018: nothing here is TESTED). Unit tests flat in `tests/`, DB tests in `tests/integration/`, per the tree's convention.

**Four are additionally UNWRITABLE until E02-B07 ships 029 §12 (A5)** — they are marked ⛔ and their subject is the transaction itself: **I14** in full, and the atomicity halves of the guard tests behind **G-a**, **G-c** and **G-d**. Listing them as invariants without this mark would be the failure 018 exists to prevent: a test file name is not coverage, and a test that cannot be written is not a pending task but a blocked one.

| # | Invariant | Test file |
|---|---|---|
| **I1** | **Every session has exactly one derived state, and the ladder is total.** Seed one session per rung (0 through 6) plus one of each transition state; assert `scan_session_current_state` returns exactly one row per session with the expected value, and that **no session in the table is missing from the view**. *(This is the acceptance criterion for "the state machine covers …".)* | `tests/integration/session-state-derivation.test.ts` |
| **I2** | **No code writes `scan_session`.** After the contract step: static assertion that no file under `src/` contains `UPDATE scan_session`, and a DB assertion that `scan_session` carries an append-only trigger and that `UPDATE` and `DELETE` on it raise. Extends `tests/integration/append-only.test.ts`. | `tests/integration/append-only.test.ts` (extended) |
| **I3** | **The rung never falls by inference (F5).** Append a superseding `condition_assessment` to a `drafted` session; assert the state stays `drafted`. Append a superseding `human_confirmation`; assert the same. Then append a `reopened` transition and assert the state falls to exactly its `reopened_to_rung`. | `tests/integration/session-state-monotonicity.test.ts` |
| **I4** | **Nothing publishes from Longbox (F1, T19 non-waivable).** Four assertions. (a) `scan_session_transition.kind`'s CHECK does not admit `'published'`. (b) No route registered by Fastify accepts a body or param that produces a `listing_status_observation` — the observation writer is reachable only from the watcher entrypoint. (c) The Shopify mutation payload carries `status: DRAFT` (`src/services/shopify.ts:28`). (d) **NEGATIVE ARCHITECTURE TEST (A7):** a fixture route under `src/routes/` that imports commerce's publish surface makes `depcruise --config .dependency-cruiser.cjs` **exit non-zero**, so the rule fails **at merge as a required check** (E02-B10), not at runtime. This is 029 §5 move 8's "prove the gate can fail" applied to the one line 019 makes non-waivable — *an untested gate is not a gate.* Plus the K1 detector's own test: a `published_by='app'` row is findable by the T19 query. | `tests/contract/no-app-publish-path.test.ts` + the E02-B10 depcruise fixture |
| **I5** | **`voided` is terminal, and it is the only terminal kind (F8, A2/A3).** After a `voided` transition, assert that appending any record to that session — a photo, a confirmation, a second transition — is refused, and that the state is unchanged. Then the negative half: assert a session reading `abandoned` **accepts** an appended record and **stops** reading `abandoned` (A3 — the predicate is non-terminal). | `tests/integration/session-terminal-states.test.ts` |
| **I6** | **No state skips `confirmed` (F2).** Attempt `condition`, `price` and `draft` on a session with no non-superseded `human_confirmation`; assert each is refused. Then assert the `proposed` rung **is** skippable: a `manual_search` confirmation with no `candidate_set` yields `confirmed`. | `tests/integration/session-requires-confirmation.test.ts` |
| **I7** | **A contradiction removes the one-tap path (F3, locked decision 7).** With `llm_rerank.contradiction = true`, assert `POST …/confirm` with `source='one_tap'` is refused and `source='grid_pick'` succeeds. | `tests/integration/contradiction-blocks-one-tap.test.ts` |
| **I8** | **The view agrees with the column on every existing session, before the column is dropped.** Over a seeded fixture spanning every path the current code can produce, assert `scan_session_current_state.state` maps to `scan_session.status` under the documented correspondence — **and enumerate the deliberate disagreements** (a failed draft reading `confirmed` under the column and `priced` under the view, E4) as expected differences with a comment, not as failures. This is the gate on §8.2's ordering. | `tests/integration/session-state-parity.test.ts` |
| **I9** | **Condition is never machine-driven (F4, locked decision 5, T7 non-waivable, 037 §1.1/§7 I3).** Static scan: no file under `src/modules/{platform,reporting,resolution,valuation,commerce}/` or `src/providers/` writes `condition_assessment`; and the `actor_role` CHECK admits no `system` value at all (A3), so a machine-authored transition beside a condition write is unrepresentable rather than merely forbidden. **This invariant does not duplicate 037 I3** — that one forbids a rendered estimate and every suggestion-shaped substitute on the *surface*; this one forbids a non-human *writer* in the state machine. Both are needed and they fail differently. Complements 029's dependency-cruiser rule set. | `tests/contract/condition-is-a-human-act.test.ts` |
| **I10** | **`drafted` requires a condition assessment (F6).** Confirm and price a session, skip the condition step, call `POST …/draft`; assert `409` and assert no `shopify_draft` and no `listing_link` row was written. | `tests/integration/draft-requires-condition.test.ts` |
| **I11** | **A session's state does not reach the copy (§6).** Draft a copy from a session, then void the session; assert the copy's `physical_item_disposition`, its `listing_link_active` row and its `physical_item_active_listing` entry are byte-identical before and after. | `tests/integration/session-void-does-not-touch-copy.test.ts` |
| **I12** | **The retry is a no-op at every step (§5.2, T23).** Call each mutating endpoint twice with one `Idempotency-Key`; assert one record per step, one Shopify call, and the identical response body. Then assert a same-key/different-body call returns `422`. | `tests/integration/request-idempotency.test.ts` |
| **I13** | **Two blind confirmations cannot both be current (§5.1).** Two concurrent confirms with the same (or absent) causal reference (`against_table`/`against_id`, per the v1.2.0 amendment); assert one commits and one gets `409`, and that after an explicit supersession the chain has no fork (the `003:104` supersedes-once index holds). | `tests/integration/concurrent-confirmation-conflict.test.ts` |
| **I14** ⛔ | **The transition fact and its step record commit together (§5.3, 029 §12).** Force a failure between the `shopify_draft` insert and the `listing_link` insert; assert **neither** committed and the session's state is unchanged. **⛔ UNWRITABLE until E02-B07 ships the request transaction (A5)** — there is nothing to force a failure inside at `aa448bb`, so this invariant is **blocked**, not pending. The same mark applies to the atomicity halves of G-a, G-c and G-d. | `tests/integration/transition-transaction-atomicity.test.ts` |
| **I15** | **Every table added here is append-only and shop-scoped.** `UPDATE`/`DELETE` raise on `scan_session_transition`, `listing_status_observation` and `request_idempotency`; each carries a `shop_id` FK to `shop(id)` (locked decision 4). Extends 034 I10 / 036 I11's constraint-existence shape. | `tests/integration/tenancy-shop-id-integrity.test.ts` (extended) |
| **I16** | **No state route leaks per-operator data (F9, T35 non-waivable).** `GET …/scan-sessions?state=…` accepts no operator, `created_by` or `confirmed_by` filter, sort or grouping parameter; and no response body carries an operator identifier alongside more than one `scan_session_id`. Rides on E03-B03's route-walk. | `tests/contract/state-routes-t35.test.ts` |
| **I17** *(rewritten, A3)* | **No machine ever authors an abandonment, and the predicate is honest in both directions.** Three assertions: (a) `scan_session_transition.kind`'s CHECK does not admit `'abandoned'` and `actor_role`'s CHECK does not admit `'system'`, so a machine-written abandonment is **unrepresentable**, not merely forbidden; (b) a session past `abandon_after` with no records reads `abandoned`, and the identical session with one appended photo does **not**; (c) the view's `definition_version` string names the `abandon_after` value that produced the reading, so a changed parameter re-derives forward and restates no history (§3.5). | `tests/integration/abandonment-is-derived.test.ts` |
| **I18** *(new, A1)* | **A transition is decided by its causal reference, and the timestamp fallback is counted.** Four assertions: (a) a `parked` row whose `against_*` names the current witness wins; (b) the same row, after a higher-rung record is appended, **loses** — the session reads the higher rung and the stale park is ignored but still present; (c) `against_table` and `against_id` are whole-or-absent by CHECK; (d) a row with a NULL reference falls back to `created_at` **and increments the view's fallback counter**, which the test asserts is non-zero for legacy rows and **zero across any window in which every row was written by current clients**. (d) is the one that matters: an uncounted fallback is a silent return to the timestamp rule A1 removed. | `tests/integration/transition-causal-reference.test.ts` |
| **I19** *(new, A4)* | **A failure is a record, not a state.** Force a Shopify draft error; assert a `shopify_draft` row with `status='failed'` exists, **no transition row was written**, and the session reads `priced`. Then the named gap: assert `POST …/identify` on a provider error writes an error record (an empty `candidate_set` or an `llm_rerank` error row) — **this assertion fails on the tree at `aa448bb`, deliberately**, and is E06's to make pass (§4.6). | `tests/integration/failure-is-a-record.test.ts` |
| **I20** *(new, A8)* | **The dead column never leaks into a response.** Assert no response body from any route contains a `status` key sourced from `scan_session` — before the contract step by projection, after it by the column's absence. Today `getScanSession` does `SELECT *` (`scanSession.ts:31`) and `GET …/:id` returns the row whole (`routes:104-111`), so **this test fails on the current tree**, which is the point: it is the E02-B08 acceptance line made mechanical. | `tests/contract/no-status-in-response.test.ts` |

**I4, I5, I9, I10 and I16 map to a non-waivable line** (T19 for I4, T7 for I9, T35 for I16; I5 and I10 to locked decisions 4 and 5). **I19 and I20 are written to fail on the tree as it stands** — they are the two amendments that name a defect rather than a design, and a test that passes today would not have caught either. The rest are structural.

## 10. Alternatives considered

**A1 — Keep `scan_session.status` and add a stricter CHECK plus a transition-validating trigger.** The cheapest change, and it is roughly what the bead note's framing implies. *Rejected on three counts.* (a) **A CHECK cannot express a transition.** `CHECK (status IN (…))` constrains the value set; ordering needs a `BEFORE UPDATE` trigger comparing `OLD` to `NEW`, which means keeping the UPDATE path — the one thing locked decision 4 exists to forbid, retained and then policed. (b) **It preserves the two-sources-of-truth problem**, which is what actually broke: every disagreement in §1 (E4, E9, E10) is the column and the log saying different things, and a stricter CHECK repairs none of them. (c) **It cannot express the four missing states cheaply.** `captured`, `proposed`, `conditioned` and `priced` would each need a new `setSessionStatus` call in a handler that today writes only its record — four more writers of a column with zero readers, four more chances to forget. **The derivation gets all four for free**, because their witnessing records are already written. This is the alternative a future reader will reach for first, which is why it is named.

**A2 — A generic workflow engine** (Temporal, a state-chart library, a `workflow_definition` table). *Rejected on fit, not on merit.* A workflow engine's value is durable execution across processes and time — retries, timers, compensations — and Longbox's session is a **synchronous, human-paced, single-request-per-step** flow whose durability requirement is exactly one transaction (029 §12). What the engine would add is a **second** state store, which is A1's problem with more machinery: the engine's execution history and the Hickey log would be two records of one truth, and the engine's would be the mutable one. There is also a hard constraint: 029 §6 makes `platform` the module that owns the runtime and forbids it knowing a domain fact — an engine that knows "confirmed comes before conditioned" is a domain fact in the runtime layer. **The right time to reconsider is E02-B09's outbox and saga work**, and even then the engine would drive *cross-module effects*, never the state itself.

**A3 — Per-record status columns** (`candidate_set.state`, `shopify_draft.status`, …). *Rejected, and the tree already shows why.* `shopify_draft.status` is the worked example: it is a per-record status column on an append-only table, and E11 is the result — three of its five values have no legal writer, eighteen months of retention policy hangs off values nobody can produce, and 022 P7 Q6's derivative window points at nothing. **A status column on an immutable row is a contradiction that surfaces as unreachable enum values**, every time. The general form is A1 repeated once per table.

**A4 — One machine over all twelve states, on `scan_session`.** *Rejected — §2.1 argues it in full.* The short form: the lifetimes do not match, the owners do not match, `published` is not ours to drive, and a copy must be able to outlive every session that touched it. 036 §9 A1 already rejected the same shape from the inventory side and named the cost precisely: **T18 becomes unexpressible, and T18 is non-waivable.**

**A5 — A materialized `scan_session_current_state` from day one**, refreshed on write. *Considered, deferred rather than rejected — and the deferral is now conditional (A6).* It is the honest answer if the join measures badly (§5.4), and 036 §5.2's `physical_item_active_listing` is the precedent for a materialized index over the log that is *labelled as one*. It is not built now for the reason 036 A2 makes binding for its own case: a derived table is a drift surface that needs two guards — a contents rebuild (036 I9) and a CI shape gate (036 I18) — and paying for both before any measurement says the plain view is too slow is buying a mechanism to solve a problem nobody has observed. **The cannon's amendment is that "the plain view is fast enough" was itself unmeasured**, so O-A (§5.4) now requires a checked-in benchmark fixture and a CI plan-shape gate before the view reaches a request path, and **materialization is decided from that measurement** rather than from either record's prose.

**A6 — Two transition tables, `session_pause` and `session_disposition` (Hickey).** *Considered and not adopted; the dissent stands in §14.* §2.2 gives the three reasons — a shared nine-column shape, a `UNION` forced onto the hot path, and §4.5's per-kind guard table stating terminality more visibly than a table name — and grants the point the split was making: a caller that writes `voided` where it meant `parked` has made an unrecoverable append that the split would have made unrepresentable. The mitigation is authorization, not structure: `voided` and `reopened` are restricted to `owner`/`manager` by CHECK, `parked`/`resumed` are not, so the two are not reachable from the same session in the first place.

**A7 — A system-written `abandoned` transition with a `derivation_version` (the v1.0.0 design; Fowler's preferred outcome).** *Rejected at A3, over a preserved dissent.* §3.4 gives the three costs — an unfixable row if the parameter was wrong, a race with the operator who comes back, and a manufactured `system` actor on a table of human decisions — and §14 records Fowler's counter that an audited sweep is not silent completion. The decisive point is 033 §5.2's sentence read literally: *"it is never auto-completed."* A derived predicate is the only construction under which that is true rather than nearly true.

## 11. Consequences

**Now that it is ratified.**

- **The Hickey model becomes complete.** After §8.2 step 4, every table in the scan chain is append-only **in the database**, and `scan_session` — today the one mutable exception, noted as such by 029 §1, 034 E15 and 036 E3 — stops being one. Three ratified records currently carry a qualifying clause that this removes.
- **Four states that cannot be expressed today become expressible**, and they cost nothing: `captured`, `proposed`, `conditioned` and `priced` are derived from records the pipeline already writes (E6).
- **`abandoned` becomes readable without becoming writable** (E8, A3). Today it is a CHECK value no code can produce; after this record it is a **derived predicate** — so 033 §5.2's *"never auto-completed"* holds literally, and the state the blueprint describes is finally observable without anyone having authored it.
- **T19 gets a surface.** `listing_status_observation.published_by` is the column the non-waivable auto-publish detector needs and E12 shows does not exist. It is a **precondition for G3** (019 §5) and it has been missing since 001.
- **T3 and T20 get their prerequisite.** `human_confirmation.outcome` is a named G2 prerequisite in 019 §3.0 that `003` did not land (E13); §8.1 step 5 lands it.
- **The retry stops duplicating** at every step, not only at the binding (E16, 036 E6), which is what 019 T23's signed 0 needs on a counter with bad Wi-Fi (033 §5.1).
- **The owner's send-back acquires a state.** 033 B5 is "none today"; `reopened` plus the `task` row is the record E11-B02/B03 render.
- **The decision strip becomes a projection with a source.** 022 P8 and 021 C4 require the same string in the record and in the owner's audit view; `scan_session_state_history` is that one source, so the two cannot diverge.

**What gets worse, stated plainly.**

- **Reading a state becomes a join, and the cost is still unmeasured.** §5.4 bounds it in argument only; **O-A (A6) makes measuring it a condition of shipping it**, which is the honest posture and also an added obligation on E02-B07 that did not exist in the draft.
- **The derivation rule got harder to hold in your head, not easier (A1, A3).** §3.4 is now four clauses **plus** a causal comparison and a derived predicate. A reader who skims will assume "newest record wins" and be wrong twice over: wrong about the correction case, and wrong about a stale transition that loses to a record appended after it. That is a real comprehension cost, it grew at the cannon rather than shrank, and it is the price of a derivation that is about causality instead of clocks. **The column was simple and wrong; this is complicated and right, and the second is worth more.**
- **Every client must now send a causal reference (A1).** `against_table`/`against_id` are required on the transitions endpoint, which is a new obligation on E05's phone client and on E05-B08's offline queue — and the queue is precisely where it is hardest, because a queued transition must carry the reference it was *created* against, not the one current at replay. The fallback exists for legacy rows only and is counted (I18), never a comfortable default.
- **The contract step is one-way** (§8.3). Once `scan_session.status` is dropped, the historical column values for sessions written between the two migrations cannot be reconstructed. I8 is the gate that must pass first.
- **Three more tables on a 1,930-line codebase with no module directories.** This is the same bet 034 and 036 made — cheap tables now against a migration under a live pilot later — and it is a bet, not a certainty.
- **`request_idempotency` grows unboundedly** unless something prunes it. It is the one table this record adds that has a retention question, and it is deliberately **not answered here (A9)**: it is `platform`'s, it holds response bodies that may carry shop data, and 022 P7's windows are the frame. **Explicitly deferred to E13-B01 as a named obligation**, not left implicit — an unowned table that grows forever is how a retention commitment quietly stops being true.
- **Four invariants are blocked, not pending (A5).** I14 and the atomicity halves of G-a, G-c and G-d cannot be written at all until E02-B07 ships 029 §12. Ratifying this record does not make the guards hold, and **does not retire the half-written-chain risk that is live today**.

**The counterfactual, kept for the record.** Deferring this means E05-B04's rapid next-item loop, E05-B08's offline queue and E05-B09's undo and session list all get built against a column that is written by two of six handlers and read by nobody — and each of them would have to invent its own answer to "what state is this session in", in the capture flow, under pilot pressure. The offline queue is the sharpest case: 019 T23 signs **lost/duplicated items = 0**, and a client that reconciles on reconnect must be able to ask the server what it already knows about a session. Today the honest answer is *the column will tell you one of four things, two of which it never says.*

## 12. What this record does NOT decide

- **It does not write a migration, and it does not close the transaction gap.** §8 is a sketch. **E02-B07** builds the append-only, correction and purge machinery **and 029 §12's request transaction, which everything here depends on and which does not exist** (E3, §5.3) — carrying **O-A** (§5.4's benchmark fixture and plan-shape gate) as a binding obligation. **E02-B10** owns ordering, indexes, locking, compatibility, rollback and the architecture gate — including **A7's negative depcruise fixture** (I4d) — and must prove the migration idempotent on a fresh DB and on the prior snapshot.
- **It does not set `abandon_after`.** §3.5 signs it as an OPEN parameter with its closing evidence, its segmentation and its 018 C3 red line, and **refuses to invent a number** beside 034 §2.9's 45-minute gap rule. Until it is signed, `abandoned` is reported OPEN and never rendered as a count.
- **It does not write an error record for a failed identify.** §4.6 names the gap — `POST …/identify`'s 502 records nothing (`routes:191`) — and **E06** closes it. I19 is written to fail until it does.
- **It does not decide `request_idempotency`'s retention window (A9).** **E13-B01** owns it. This record neither sets one nor permits one to be assumed.
- **It does not write the API.** §7 is the contract; **E02-B08** versions it, and owns the actor / tenant / correlation-id / idempotency-key / schema-version envelope on every mutating call.
- **It does not decide the event contracts.** Every "Publishes"/"Consumes" list in 029 §2 is aspirational (029 H6); **E02-B09** owns the transactional outbox, and which `scan_session_transition` kinds carry a cross-module effect is the open item 034 §2.12 A3 already named.
- **It does not decide the reconciliation transport or cadence.** Webhook versus poll, and the achieved detection window, are **E10-B05** (the signed receiver) and **E10-B08**; 036 §10 Q6 already names the latency as load-bearing for T18.
- **It does not build the T19 watcher.** §4.4 gives it a table to write; **E10-B05** builds it and puts its heartbeat on T34's list.
- **It does not design the capture UI.** Which states are visible, how a park reads on a phone, and the shape of the resumable list are **E05-B04** and **E05-B09**; every string is a 021 registered string first (033 §9).
- **It does not decide authentication or the role check.** `actor_role` is a column here; who fills it and how the check runs is **E03-B02** / **E03-B03**, and pre-G2 rows stay `actor_verified=false` forever (034 §4.4).
- **It does not amend 029.** §8.5 writes the rows; applying them is the parent's act under 029 §9.
- **It does not reverse or amend a locked decision.** Locked decisions 3, 4, 5 and 7 constrain this record; where anything here conflicts with one, the locked decision wins.

## 13. The questions, as answered by the cannon

v1.0.0 put five questions to a two-lens cannon; both lenses returned **ACCEPT-WITH-CHANGES**. **Four came back as changes to the design** (A1/A2 from the table's shape, A3 from Q3, A4 from Q5, A6 from Q2), one was answered as drafted, and two amendments arrived that the draft had not asked for. The reasoning is kept rather than deleted, because the reasoning is the record.

1. **Is the two-machine split right, and is `scan_session_item_resolution` the right boundary?** — **ANSWERED: yes, as drafted; both lenses.** Neither would move the boundary to `confirmed`. The decisive point was the one the draft raised against itself and then under-weighted: `condition_assessment` and `pricing_snapshot` are FK'd to `scan_session` today (tables at `001:122`/`:133`, the FK columns at `:124`/`:135`), so an earlier boundary means either re-pointing two shipped tables or living with a schema that contradicts the stated line — and 036 §4.3 already made `scan_session_item_resolution` the row where an episode acquires an object, with a `UNIQUE (scan_session_id)` that makes "at most one copy per session" a constraint rather than a convention. Putting the machine boundary anywhere else would have meant two different answers to *"when does this session stop being about an episode"* in two ratified records.

2. ~~**Is a plain view the right first construction?**~~ — **ANSWERED: yes, but the deferral was unmeasured and is now conditional (A6, Hickey e + Fowler d).** The question named its own flaw and the cannon agreed: v1.0.0 rejected the materialized form on a drift-surface argument while asserting the plain view was "bounded" **without ever running it** — the symmetric form of the error 036's O-A obligation exists to correct, and what 018 caps at ASSERTED. So the plain view is authorized **only with a checked-in benchmark fixture and a CI plan-shape assertion** (index-only scans, no seq scan across the eight tables), landed by E02-B07 before the view reaches a request path, with the figures in a 006 row. **Materialization is decided from the measurement.** §5.4 carries it as O-A.

3. ~~**Should a system-written abandonment exist at all?**~~ — **ANSWERED: no. It is a derived predicate (A3, Hickey c over Fowler Q3).** The blueprint's sentence was simply right: 033 §5.2's *"it is never auto-completed"* is not a stylistic preference, and a sweep row is an auto-completion however carefully labelled. Three costs carried it — an append-only row is unfixable if the parameter was wrong, it races the operator who comes back, and it manufactures a `system` actor on a table of human decisions. **`abandoned` becomes a predicate in the view, `abandon_after` becomes a signed OPEN parameter in the view's definition version (§3.5), and `actor_role` loses its fourth value.** Fowler's dissent — a named sweep with a stored `derivation_version` is auditable, not silent, and gives reporting a row to join — is **preserved in §14 and not refuted**; the counter is that the predicate gives reporting the same number for free while keeping the blueprint literally true.

4. ~~**Is `reopened` one state or several?**~~ — **ANSWERED, and the question was too narrow (A2, Fowler Q4 over Hickey b).** `reopened_to_rung` stays a nullable dependent column under a CHECK rather than becoming five enum values — but the cannon widened the question to the whole table and Hickey argued for **splitting it in two**, `session_pause` and `session_disposition`, so the schema states terminality structurally. **One table is kept** for the three reasons in §2.2, and the property the split was buying is bought instead by **§4.5's per-kind guard table** plus the authorization CHECK that puts `voided`/`reopened` behind `owner`/`manager`. **Hickey's dissent is preserved in §14.**

5. ~~**Does `failed` earn its place, given K4?**~~ — **ANSWERED: no. It is struck (A4, Fowler Q5).** The question named its answer and then declined it. Every failure `failed` would have recorded is **already a record** — `shopify_draft.status='failed'`, a surviving pricing source, a stub, the manual-search path — and the session correctly reads the rung it reached. A state whose only content duplicates a record is what this whole document exists to remove, and worse, it is **a place for a degradation bug to hide**: if a dead end is by definition a bug in the K4 stub path, a state that names dead ends makes them look handled. §4.6 tabulates where each failure is witnessed **and names the one real gap** — `POST …/identify`'s 502 records nothing (`routes:191`) — as the condition under which striking `failed` is safe. **I19 is written to fail until E06 closes it.**

**Two amendments the draft did not ask for.** **A1 (Hickey, the costliest):** §3.4's derivation compared timestamps, and *time is a proxy for causality* — clock and commit skew, the offline queue, and the two-device case all break it. Every transition now carries `against_table`/`against_id`, the derivation asks a causal question, and the timestamp path survives only as a **counted** fallback for legacy rows. **A5 (Fowler, a BLOCK):** the record specified guards that need atomicity while 029 §12's transaction does not exist at `aa448bb` — so §0, §5.3 and §14 now carry it as a **blocking precondition**, four invariants are marked **⛔ blocked rather than pending**, and ratification is stated **not** to retire the half-written-chain risk. **A7, A8 and A9** are Fowler's smaller findings, folded into I4, the E02-B08 acceptance line, and E05/E13-B01's obligations respectively.

## 14. Ratification

| Field | Value |
|---|---|
| Decision | **Adopt §2–§8** — the two machines and their handover (§2), derived state and the retirement of `scan_session.status` (§3), the transition table with its drivers, forbidden transitions and guards (§4), concurrency and idempotency (§5), the session/copy separation (§6), the API contract (§7) and the expand-only migration sketch (§8) — as the canonical workflow state machine and its authorized transitions for intent-longbox, **with amendments A1–A9 absorbed, none declined**, together with §9's invariants and §10's rejected alternatives. Apply §8.5's **four** amend-by-a-row entries to 029 under its §9 clause. Binding on E02-B07, E02-B08, E02-B09, E02-B10, E05-B04, E05-B08, E05-B09, E06, E10-B04, E10-B05, E10-B08, E11-B02, E11-B03 and E13-B01. |
| Status | **RATIFIED.** |
| Acting head of board | **Claude, acting head of board**, under Jeremy Longshore's 2026-09-03 delegation recorded in 006 |
| Date | **2026-09-04** |
| Cannon | `rich-hickey-reviewer` and `martin-fowler-reviewer`, 2026-09-04 — **both ACCEPT-WITH-CHANGES** |
| Amendments at ratification | **A1** (Hickey — the costliest) every transition carries `against_table`/`against_id`, the highest-witness record it was issued against, and §3.4 clause 2 compares **against that reference** rather than a clock; `created_at` survives only as a **counted, logged** fallback for legacy rows (I18). *Time is a proxy for causality; record the causality.* · **A2** (Fowler Q4 over Hickey b) **one** transition table with `kind ∈ {parked, resumed, voided, reopened}`, `reopened_to_rung` nullable under a paired CHECK, and **per-kind guard rows in §4.5** stating which kinds are terminal · **A3** (Hickey c over Fowler Q3) **`abandoned` is a derived predicate, never a fact row** — non-terminal, fired by an absence past a signed OPEN `abandon_after` stored in the view's definition version; `actor_role` loses `'system'`; 033 §5.2 holds literally · **A4** (Fowler Q5) **`failed` struck from the kinds** — every failure is already a record and the session reads its prior rung; §4.6 tabulates where each is witnessed and names the identify-502 gap · **A5** (Fowler BLOCK) 029 §12's transaction **does not exist at `aa448bb`**, so G-a, G-c, G-d and **I14** are **⛔ UNTESTABLE** until E02-B07 ships it; written as a blocking precondition in §0 and §5.3, and **ratification does not retire the half-written-chain risk** · **A6** (Hickey e + Fowler d) **O-A**: the plain view ships only with a checked-in benchmark fixture and a CI plan-shape assertion; materialization is decided from the measurement · **A7** (Fowler) **I4 gains a negative architecture test** — a route importing commerce's publish surface fails the dependency gate **at merge** (E02-B10), not at runtime · **A8** (Fowler) the `SELECT *` `status` leak (E5) becomes an **explicit E02-B08 acceptance line**, asserted by I20 · **A9** (Fowler) the second device's stale read becomes an **E05 acceptance criterion**, and `request_idempotency` retention is **explicitly deferred to E13-B01**. **None declined.** |
| **Dissent preserved** | **`rich-hickey-reviewer`, on A2: split the transition table into `session_pause` and `session_disposition`.** A pause and a disposition are different kinds of fact, and one `kind` column lets a caller write a terminal row where it meant a reversible one — an append that cannot be taken back. **Not overruled on the merits; outweighed on cost**: the four kinds share every column including A1's reference, a split forces §3.4's single read onto a two-table `UNION` on the hot path, and §4.5's guard table states terminality more visibly than a table name. The mitigation is authorization, not structure — `voided` and `reopened` sit behind `owner`/`manager` by CHECK while `parked`/`resumed` do not. **The dissent would be vindicated by a single mis-written `voided` row**, and that row would be unrecoverable. · **`martin-fowler-reviewer`, on A3: keep a system-written abandon.** A named sweep with a stored `derivation_version` is auditable and is *not* silent completion; it gives `reporting` a row to join rather than a predicate to recompute per query, and "stale sessions read their rung forever" is a worse operator experience than an honest, labelled machine judgement. **Accepted as a real cost, not refuted**: the counter is that a wrong `abandon_after` costs a view redefinition instead of a permanent false statement in an append-only table, and that 033 §5.2's sentence is only literally true under the predicate. If the predicate proves expensive to recompute at reporting scale, the answer is a materialized read model over the same rule — never a fact row. |
| Gate audit | *(pending)* — `longbox-gate-auditor` before the bead closes. |
| Jeremy's revision right | **Standing.** Jeremy may revise any line by a 006 decision-log row naming date, old text, new text and reason (018 §5). Locked decisions 3, 4, 5 and 7 outrank this record. |
| Recorded in | 006 decision log row dated 2026-09-04 (flipped **in place** from the PROPOSED row filed earlier the same day, per 018 §4 C2 — the PROPOSED text lives in git history); 016 §1 row 040; 000-INDEX row 040; the change log above; bead `longbox-e5b.2.6`'s close reason quotes this block. |

Binding from 2026-09-04. Changing any **decision** above — the two-machine split, the derivation rule, a transition kind, a forbidden transition, a guard — requires a new decision record naming this one as superseded (018 §4 rule S4), never an in-place edit. Two things are explicitly **not** decisions and may be amended in place by a patch bump plus a change-log row, following 029 §9's precedent: **statements of fact about the existing tree** (a `file:line` that turns out wrong is a defect in the description, not the decision), and **the `abandon_after` parameter in §3.5**, which is designed to close by measurement rather than by amendment.

**Ratification is not evidence** (018 §2 A3). This block records that a design was argued by two lenses and adopted. It does not make any claim in §2–§9 true of any running system: **nothing here is built, nothing is TESTED**, every invariant in §9 names a test file that does not exist, four of them are **⛔ blocked outright**, two (I19, I20) are written to **fail on the current tree**, and §1 stays REPRODUCED while everything else stays ASSERTED. What changes on ratification is only that E02-B07 and E02-B10 are authorized to build against this shape — in the order §5.3 fixes — and that authorization carries **O-A** (§5.4) as a binding obligation. **In particular, ratification does not retire the half-written-chain risk that is live at `aa448bb`.**
