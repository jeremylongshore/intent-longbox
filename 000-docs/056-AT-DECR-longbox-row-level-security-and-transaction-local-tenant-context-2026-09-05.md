# Decision Record — Row-Level Security: the Transaction-Local Tenant Context, the Service Scopes, and What the Boundary Does Not Defend

**Version:** 1.2.2
**Status:** **RATIFIED, amended by row at v1.2.0** (2026-09-05, E03-D19 `longbox-e5b.3.29` — `migrations/034` discharges §11 R7's anchor half and a narrower **R11** takes its place; the signature below stands, no decision in this record moved, and every original sentence is kept verbatim with the amendment written beside it). Signed at **v1.1.2** (2026-09-05, by the acting head under the 2026-09-03 delegation at close of E03-B04 — PR #90 squash-merged to `main` as `a451de8`, the bead closed against that SHA, after the invariant re-verification PASS-WITH-NOTES and the gate re-audit whose six fact repairs landed at v1.1.1). The text that follows is the PROPOSED-era status, kept verbatim as history: **PROPOSED at v1.1.1.** The two-lens cannon **WAS DISPATCHED by the parent session** against PR #90 at `564f6eb`: `security-auditor` **ACCEPT-WITH-CHANGES** (F1–F10) and `martin-kleppmann-reviewer` **ACCEPT-WITH-CHANGES** (K6 blocking, K3–K5, K8–K9). §2 now carries **both lenses' verbatim position statements** and the builder's in-band drafts are SUPERSEDED rather than kept beside them (054 §0's precedent). The code half additionally carries a `longbox-invariant-reviewer` verdict of **BLOCK** on `564f6eb` — one finding, overlapping F2 — and a `longbox-gate-auditor` verdict of **NEEDS-OWNER-DECISION**, whose one ruling (the T24 audit query is built in THIS bead) is applied in §12 and §11 R4. **All of it is folded here**, and the gate audit's RE-AUDIT of v1.1.0 (**NOT-READY on six FACT repairs, no decision wrong; §2's verbatim reproduction PASS; B1–B5 and N1–N7, N9 CLOSED**) is folded at v1.1.1 as patches. The acting head signs at CLOSE; a record that pre-announced its own ratification would be the artifact deciding its own review.
**Bead:** E03-B04 `longbox-e5b.3.4` (epic LBOX-E03 `longbox-e5b.3`, gate **G2**, evidence class TEST, owner-role security, risk critical, phase P1-foundation) — 014 §8 row E03-B04
**Drafted:** 2026-09-05 by `longbox-security-tenancy-builder` · **Audit:** `longbox-invariant-reviewer` (code) and `longbox-gate-auditor` (this record) before close · **Decision owner:** Jeremy Longshore (acting head of board under the 2026-09-03 delegation)
**Sensitivity:** Restricted internal (014 §10). It names no shop, no person and no credential; it does name every table that carries a tenant, which is a map of the schema and not of anybody's data.
**Supersedes:** nothing. It **discharges 034 §3.2's third layer**, **046 §6's G-3** and **048 §12.4 row 7**, and it closes the finding 034 §1 E10 recorded on 2026-09-03 and 046 E8 re-reproduced **one day later**: *"There is no row-level security. `shop_id` is therefore a convention enforced by every hand-written `WHERE`, not a boundary."* (The elision in that quote is marked: 034 E10's sentence runs *"There is no row-level security. […] `shop_id` is therefore a convention…"*, with a grep transcript between the two halves.)
**Inputs:** 014 §8 row E03-B04 · 015 alias map · **034 v1.3.0 §3.1–§3.4 (the three layers, the K1 walk-through), §5 I10, §7** · **046 §4 B2, §6 G-3 and K-5, §9 A5** · **042 v1.4.3 §5.3(a)/(b) (one connection, one lock order), I5, I21, I22, §8.1** · **041 §4.1, §4.2, §9.2 item 2 (the two roles)** · **048 v1.5.2 §3.2, §3.6, §6.1–§6.5, §7.2–§7.4, §9.1, §9.3** · **054 v1.1.2 §3.3, §4.3–§4.5** · **053 v1.0.6 §5.5, §7.2–§7.3** · **050 §4** · **019 v1.4.0 T24, T34, T35 (non-waivable)** · **022 P3** · 030 §7 · 044 §2, §3, §6, §7 · 023 §3, §5 · `migrations/029_row_level_security.sql`, `src/db/{tenantContext,rowLevelSecurity}.ts`, `src/db.ts`, `src/services/roleSeparation.ts`, `scripts/{migrate,grant-app-role,architectureRules}.ts` · CLAUDE.md locked decisions 2 and 4.

## Change log

**Version convention** (006 `:6`): a **minor** bump means the content of a decision changed; a **patch** means a statement of fact was repaired with no decision changing.

| Version | Date | What changed | Authority |
|---|---|---|---|
| **1.2.2** | **2026-09-06** | **A PATCH, and a ROW ONLY — no sentence of this record is edited.** (Written as v1.1.3 on its branch and re-cut to **v1.2.2** at the rebase: E03-D19 took v1.2.0 and its own v1.2.1 count repair while this branch was in flight. The two amendments are independent — neither reads the other's sections — so the number records a merge order and not a dependency, on 059 §0's precedent.) §9 and §14 each ended by naming a rule that did not exist yet: *"The rule that generalises it belongs in 000-docs/044 beside the expand/contract lint rather than here, and it is **E03-D20**"* (§9, the consistency lens's K8), and *"generalising it into 044 is the second half of **E03-D20**"* (§14, the deploy-order and rollback coupling). **Both are now true.** 044 takes a MINOR to **v1.1.0**: `ENABLE`/`FORCE ROW LEVEL SECURITY` and `CREATE POLICY` become its FIFTH contracting shape under a `-- contract: deploy unit …; 006 row: …` header (044 §2 A1); §14's asymmetric rollback order — code first, policies second, *both or neither* — is generalised in 044 §4 A1 with the two failure modes named (silent total read outage vs. loud boot refusal); and the `CONCURRENTLY` rule is 044 §9, warning while `G3_LIVE_SHOP_ROWS` is false and refusing after, with **`migrations/029` grandfathered by name and reason** in 044 §10 rather than rewritten. **A PATCH and not a minor: no ruling in this record is reversed, no invariant is re-scoped, no residual is closed and no threshold moves** — §9's ruling still declines to change the eighteen builds, and both sections named the closing bead themselves, so its arrival is a statement of fact becoming true. E03-D20 `longbox-e5b.3.30`. | E03-D20 → acting head |
| **1.2.1** | **2026-09-05** | **PATCH — R11's list was SIX and is SEVEN. A count repaired; no decision moved, and the amendment rows of v1.2.0 stand verbatim beside it.** The E03-D19 re-verification at `a4d5563` reproduced a seventh single-column edge into a session-scoped parent — **`outbox_attempt.outbox_id → outbox`**, the same shape as `shopify_draft.outbox_id` and `cost_log.outbox_id` and with no composite companion. As `longbox_app` under shop B's context an `outbox_attempt` naming shop A's `outbox` row answers **`INSERT 0 1`**, and `pnpm audit:cross-tenant` catches it: *"CROSS-TENANT: 1 row(s) — outbox_attempt → outbox (outbox_attempt_outbox_id_fkey)"*, over **59** tenant edges. **Why the first list was wrong is the part worth keeping**: it was assembled by READING the schema instead of querying the catalog, which is exactly the failure `034`'s own loop refuses one layer down — that loop CHECKS its ten children against `pg_constraint` before it will run. R11's seven are now derived by query, and the query's shape is stated in R11 itself. Two further facts are added rather than corrected: the three `*_supersedes_*` self-edges are **correctly absent**, because `008` gave each a composite companion over `(supersedes_id, shop_id, scan_session_id)`; and the **wider set is 42** single-column foreign keys between two shop-scoped tables at this head, inside the audit's **59** edges, which is DETECTION-covered and deliberately outside E03-D27's scope — R11 scopes itself to session-scoped parents because that is the population `034` closed and 016 C46 reproduced. Also: §11's evidence line said the lane file gained *"six"* new cases; it gained **five, plus one rewritten in place**. E03-D27's title is being restated from six edges to seven by the acting head, so this record names the bead rather than quoting a title mid-edit. | E03-D19 re-verification → `longbox-security-tenancy-builder` |
| **1.2.0** | **2026-09-05** | **MINOR — §11 R7's ANCHOR half is DISCHARGED, and a narrower residual replaces it. Amend-by-row: every original sentence stays verbatim and the amendment is written beside it.** `migrations/034` (E03-D19 `longbox-e5b.3.29`) adds `UNIQUE (id, shop_id)` on `scan_session` and re-points all **ten** child foreign keys at `(scan_session_id, shop_id) REFERENCES scan_session (id, shop_id)`, dropping the ten single-column edges the composite ones subsume. **016 C46 probe 1 no longer succeeds** — as `longbox_app` under shop B's context, a `scan_photo` naming shop A's session is refused `23503` on `scan_photo_session_same_shop` — and **probe 1 and probe 2 are now the same error, field for field**: same SQLSTATE, same message, same `DETAIL` (*"Key is not present in table \\"scan_session\\"."*, with no key values, because `029`'s policy means the app role cannot read the referenced table), same schema, table and constraint name. So the existence oracle is closed as well as the attachment. **Probe 3 is unchanged and asserted so** — a row whose own `shop_id` is another tenant's is still refused `42501` by the policy, because the constraint is never reached. **What replaces R7 is R11**: the anchor edge is closed and the SIBLING edges are not — `llm_rerank.candidate_set_id`, `media_deletion.scan_photo_id`, `shopify_draft.outbox_id`, `cost_log.outbox_id`, **`outbox_attempt.outbox_id`**, `listing_status_observation.shopify_draft_id` and `identity_resolution.human_confirmation_id` — **seven**, not the six this row first said — are still single-column foreign keys and R7's mechanism applies to every one of them unchanged, covered by DETECTION only and owned by **E03-D27** `longbox-e5b.3.37`. The pinned lane case moved with it: `tests/integration/cross-tenant-audit.test.ts` now plants an `llm_rerank` on the sibling edge to prove the audit still fires, and the case that used to plant a `scan_photo` asserts the refusal instead. **§6.3's `shop_shopify_domain_is_one_store` is NOT discharged by this** and is not this bead's — it is a unique index rather than a foreign key, it is still latent for the reason §6.3 gives (no route writes the column), and the change that fixes it is R10's, owned by **E03-D22** `longbox-e5b.3.32`. No decision in this record changed; §13's alternative 10 stands verbatim as the record of the ruling that deferred the work. | E03-D19 `longbox-e5b.3.29` → `longbox-security-tenancy-builder` |
| **1.1.2** | **2026-09-05** | **A PATCH — the signature.** Status → RATIFIED; §15 records the signing, the two re-verification verdicts it waited on, and the merge SHA `a451de8` the bead is closed against; §1's `4a3871c` pins gain "(landed as `a451de8`)"; R10's bead is filed as E03-D22 `longbox-e5b.3.32` (015 row 279). No ruling, invariant, residual or dissent changed. | Acting head, at close of E03-B04 |
| **1.1.1** | **2026-09-05** | **PATCH — six facts repaired, no decision moved.** The gate audit's re-audit of v1.1.0 returned NOT-READY on facts alone and CLOSED every decision item. **(1)** §0's per-file counts: `rls-plan.test.ts` is **21** cases, not 18, and this bead's unit total is **37**, not 34 (12 + 21 + 4). **(2)** E03-D19, E03-D20 and E03-D21 are **REAL BEADS**, filed by the session — `longbox-e5b.3.29`, `longbox-e5b.3.30` and `longbox-e5b.3.31`, all OPEN and blocked on E03-B04, at 015 rows 276–278 — so every "proposed, not yet created" is replaced by the id. **(3)** §12's *"the bead's own note is corrected accordingly"* was FALSE when written and is now true by a different route: the session wrote the `bd-sync` note on `longbox-e5b.13.4.1` on 2026-09-05, and §12 now says who wrote it, when, and that the bead's ACCEPTANCE text does not yet carry the schedule clause. **(4)** R9 has an owner, **E03-D21**, and a §12 row. **(5)** 006's citation of 034 is split: the three-layers quote is at **034:449**, the K1 trigger at **034:445–447**. **(6)** 016 C45's status no longer out-ranks its evidence (split VERIFIED / REPORTED), and C46 and §11 R7 now say that the hand probes used `candidate_set` while the PINNED lane case is `cross-tenant-audit.test.ts:99–136` over `scan_photo → scan_session`. Also: §10 I12's fixture list named an "altered service policy" fixture that does not exist, and §14 now carries the consistency lens's K8 sentence **verbatim** beside the ruling that declined it. **The invariant re-verification at the same head (PASS-WITH-NOTES, every cannon item CLOSED) adds three more, all facts:** §6.3's claim that *"there is nothing to repair"* was **false by one** — `shop_shopify_domain_is_one_store` is a `UNIQUE` over a client-choosable value on the now-policied `shop`, reproduced as a one-bit oracle and latent only because no route writes the column; **R10** names the time-of-check-to-time-of-use window in the F8 domain-claim check, with both available fixes argued and declined; and two comment counts in `src/db/rowLevelSecurity.ts` (fourteen → fifteen, seventeen → eighteen) that had survived the fold. | Gate audit re-audit + invariant re-verification at `ff55d6a` → `longbox-security-tenancy-builder` |
| **1.1.0** | **2026-09-05** | **MINOR — three findings change WHAT THE BOUNDARY IS, and one of them reverses a ruling this record made at v1.0.0.** **(F1, minor)** the second policy was `FOR ALL` over a scope-agnostic boolean, so ANY scope was a cross-tenant read **and write** grant on every service-scoped table — the lens inserted an owner membership at another shop from inside `my-shops`. It is now a `FOR SELECT` policy keyed on the scopes each table declares, plus a separate `FOR INSERT` policy on three tables whose check names the row. **This reverses v1.0.0's §13 item 6**, which rejected a scope-keyed predicate as "a second authorization system living in SQL"; §13 now records what was shipped, what the cannon found, and what this version does. **(F2 + the invariant review's BLOCK, minor)** the boot assertion is rebuilt as a SET comparison — every policy that exists against every policy this design emits, by name, command and predicate — because the per-table version was blind to a permissive policy ADDED beside the declared one, to `tenant_isolation` RESHAPED to `FOR INSERT WITH CHECK (true)`, and to the second policy entirely. **(F3, minor)** the enumeration covers `relkind IN ('r','p')` and REFUSES `'m'`/`'f'` loudly, because the grant plan already hands the app role `SELECT` on a materialized view and RLS never applies to one. **(WARN 3, minor)** `shop` moves out of the exemption list and is policied on its own `id` — the invariant review found v1.0.0's first reason for exempting it had been falsified by this bead's own `my-shops` scope — which makes creating a shop a schema-owner act enforced by the database. **(F4/K6, minor)** `migrations/029`'s hardcoded table list is DELETED: it had already drifted from the module's, and a hand-applied migration left `membership_revocation` unscoped and §6.1's fail-open `my-shops` alive. **(the gate audit's ruling, minor)** 019 T24's daily cross-tenant audit QUERY is built here rather than deferred; only its schedule and heartbeat stay with E13-B04.1. **Riding along as PATCHES** (facts repaired, no decision moved): the evidence base re-pinned from a wip commit to `main` (B1), 56 joins → 42 (B2), §5's box gains `WITH CHECK` (B3), R4's overclaim reworded against R1 (B5), the 034 quote's elision marked (N3), "three weeks later" → one day (N4), the skipped case named (N5), plus F5–F9's residuals and the two `pnpm arch` widenings. | Two-lens cannon + invariant review + gate audit → `longbox-security-tenancy-builder` |
| 1.0.0 | 2026-09-05 | Initial record. Status PROPOSED; §2's lens positions were builder-drafted and labelled; §15 unsigned. | `longbox-security-tenancy-builder` (E03-B04) |

---

## 0. Evidence posture

Per 018 A1/A3, and with 029 v1.0.0's gate-audit blocker B1 as the governing lesson (a "today" claim asserted at REPRODUCED on the strength of having read a file, later found false):

- **§1's claims are REPRODUCED against `4a3871c` (landed as `a451de8`)**, the `main` this branch is rebased onto — **not** against a branch commit. v1.0.0 pinned them to `3e25ff2`, a wip commit on no branch, which the gate audit rightly called (B1): a branch SHA is not an address a reader who never saw the branch can resolve, and 053 v1.0.4 B8 already established the durable form. **The merge SHA replaces it at close.** Where a claim is about the DATABASE rather than the tree it is reproduced by execution against `postgres:16` and the transcript is quoted.
- **§3–§9 are TESTED**, not asserted: every decision below has an assertion in `tests/integration/rls-tenant-isolation.test.ts` (36 cases), `tests/integration/cross-tenant-audit.test.ts` (7), `tests/tenant-context.test.ts` (12), `tests/rls-plan.test.ts` (21), `tests/contract/service-scope-declaration.test.ts` (4) — **37 unit cases for this bead** or `tests/contract/architecture-gate.test.ts`, and the whole integration lane (51 files, 707 cases, **one skipped — `shopify-customid-consistency`, which 043 A11 signs OPEN**) runs with the boundary in force.
- **Ratification will not move anything up the ladder.** Signing §15 will record that a design was argued and adopted. It will not close a residual: §11's list is what remains true after this bead, and the largest item — that the application role can set the context to any value it likes — is a property of the mechanism and not a gap in the implementation.
- **What this record DISCHARGES**, now that the ruling puts the detector here: 034 §3.2's third layer and §3.4's K1 walk-through; 046 §6 **G-3** and §9 **A5**; **048 §12.4 row 7** ("RLS policies, with the tenant taken from the session inside `withTransaction`"); and **019 T24's preventive half AND its query half** — its SCHEDULE and T34 heartbeat remain E13-B04.1's, and §11 R4 says so in those words.
- **No timing figure, percentage or rate about Longbox appears here** (019 §3.3, 021 §2). §9 quotes two query PLANS, which are structures rather than measurements.

---

## 1. What exists today (REPRODUCED against `4a3871c` (landed as `a451de8`))

| # | Claim | Evidence |
|---|---|---|
| E1 | **The boundary is now in the database.** 45 tables are policied — the 44 that carry a `shop_id`, plus `shop` itself on its own `id` — each with row-level security enabled and a `tenant_isolation` policy on both `USING` and `WITH CHECK`. | `pnpm migrate` prints `rls 45 policied (18 also service-scoped), 22 declared exempt (no tenant column), 4 view(s) security_invoker`; asserted in both directions by `tests/integration/rls-tenant-isolation.test.ts`. **The two lenses counted differently and both are recorded as they stated them**: the consistency lens counted **fourteen** service-scoped tables in the module at `564f6eb`, the security lens counted **seventeen** from the live migrate output. Both were right about what they looked at — the module's list and the runner's derivation had drifted, which is K6 — and the single list now settles it at **eighteen** |
| E2 | **The context is transaction-local and travels with `BEGIN`.** One statement: `BEGIN; SELECT set_config('longbox.shop_id', '<uuid>', true), set_config('longbox.service', '', true)`. | `src/db/tenantContext.ts:168` (`beginWithContext`), used at `src/db.ts:174` |
| E3 | **Every mutating request in the system sets it, at one site.** `runIdempotent` passes `{ tenant: { shopId: req.shopId } }`, and `req.shopId` is `ctx.shopId`, which the authentication hook took from the SESSION (048 §6.1). | `src/services/idempotency.ts:304` |
| E4 | **A read outside a transaction gets its own.** `scopedDb` runs each statement in a one-statement transaction; `tenantDb` and `serviceDb` are its two shapes. | `src/db.ts:241`, `:252`, `:264` |
| E5 | **The plan is re-derived and re-applied after every migration run**, like the grants and for the same reason: `CREATE TABLE` produces a table with RLS disabled and no policy. | `src/db/rowLevelSecurity.ts:343` (`applyRowLevelSecurity`), called from `scripts/migrate.ts` and `scripts/grant-app-role.ts` |
| E6 | **A table with no `shop_id` and no declared exemption stops the run**, loudly. | `src/db/rowLevelSecurity.ts:226` (`UndeclaredTenancyError`), `tests/rls-plan.test.ts` |
| E7 | **The server refuses to bind a port unless the boundary is in force for its own connection** — role attributes, ownership, every table's policy AND its predicate, every view's `security_invoker`. | `src/services/roleSeparation.ts:303` / `:373`, wired at `src/server.ts:39` |
| E8 | **The application role is subject to it.** `longbox_app` has neither `SUPERUSER` nor `BYPASSRLS`, owns nothing, and reads zero rows with no context. | `docker/postgres-init/00-roles.sql`; reproduced as the app role: `SELECT id FROM scan_session` → `(0 rows)` with no context, 1 row with the right one, 0 with another shop's |
| E9 | **The schema owner bypasses, deliberately** — `ENABLE`, not `FORCE` — which is why `pnpm register-shop`, the migration data statements and this lane's fixtures still work. | §4 below; `tests/integration/rls-tenant-isolation.test.ts` ("the SCHEMA OWNER bypasses the policies") |
| E10 | **`pnpm arch` holds three new rules**: every `withTransaction` under `src/` declares a tenant; the GUC is written in one file; each cross-tenant scope is named an exact number of times **and the number of call sites that ENTER a scope equals the sum of those counts** (F7 — a literal count is blind to a scope passed as a variable). | `scripts/architectureRules.ts`; negative fixtures in `tests/contract/architecture-gate.test.ts` |
| E11 | **019 T24's daily cross-tenant audit QUERY exists and fires.** It derives its edges from the catalog (58 FK edges between shop-scoped tables today), counts rows whose `shop_id` disagrees with their parent's, adds the one grant predicate that is definable (an operator session standing on no membership at its own shop), reports COUNTS and never rows, and exits non-zero on any hit. | `scripts/crossTenantAudit.ts`, `pnpm audit:cross-tenant`; `tests/integration/cross-tenant-audit.test.ts` plants one row as the OWNER and one as the APPLICATION ROLE under its own tenant context, proves the query fires on each, and proves zero on a clean seed |
| E12 | **Verified CLEAN by the security lens and recorded as TESTED rather than assumed**: no `SECURITY DEFINER` function exists anywhere; `current_shop_id()` is `STABLE` and the leaky-qual reordering attack is closed by the application role holding no `CREATE` on `public`; `pg_stats` returns zero rows for policied tables, so cross-tenant distribution does not leak through the statistics views; all forty tenant declarations in the tree trace to a session, credential, code or state row and none to a URL, body, header or cookie payload; the assertion runs before a port is bound; a forged inbound message cannot pick a tenant; and the migrate role is never the request-time role. | `security-auditor`, against a live cluster at `564f6eb` |

**What §1 adds up to.** 034 §3.2's three layers are all in place. The contract (every shop-scoped table carries `shop_id`, no handler derives tenancy from a body) is E02-B03's and shipped; the runtime assertion (membership-first tenant resolution, the permission decision) is E03-B02/B03's and shipped; **this bead is the third, and it is the one that survives a handler bug** — 034 §3.4: *"the contract fails to a code review, the runtime assertion fails to a bug, and RLS fails to a database misconfiguration."*

---

## 2. The two-lens cannon — **DISPATCHED**

The parent session convened both lenses against PR #90 at `564f6eb`, and both
reproduced their findings against a live `postgres:16` rather than reading the
diff. Their statements are reproduced **verbatim and unedited**; v1.0.0's
builder-drafted positions are superseded rather than kept beside them, on 054
§0's precedent — a draft of what a reviewer might say is not a review, and
leaving both in the record would invite a later reader to average them.

### 2.1 The security lens (`security-auditor`) — ACCEPT-WITH-CHANGES

> The security lens ACCEPTS row-level security as the third tenancy layer WITH CHANGES. The mechanism is correct where it is load-bearing: the context is transaction-local and travels with `BEGIN`, no code path anywhere takes a tenant from a URL, a body, a header or a cookie payload — every one of the forty declarations traces to a session, credential, code or state row — an absent context is a loud zero rather than a quiet everything, `ENABLE`-not-`FORCE` is argued rather than assumed, `security_invoker` on the views closes a hole that would have voided the rest, and R1 states the residual that matters instead of leaving it to be discovered. Three gaps must close before this is the layer the record says it is, and all three are inside the adopted design rather than against it. First, `service_context` is `FOR ALL` over a scope-agnostic boolean, so any one of the six scopes is a cross-tenant read **and write** grant on all seventeen tables: inside `my-shops` the application role inserted an owner membership at another shop, which a tenant context refuses — the exception is countable, as §5.2 argues, but its blast radius is unbounded, which §5.2 does not argue. Second, the boot assertion detects a policy relaxed to `true` and not a permissive policy **added** beside it, and never inspects `service_context` at all: with `CREATE POLICY oops ON scan_session USING (true)` in place the check reported `ok=true` while the application role read another shop's rows. Third, the catalog enumeration that is the design's central virtue classifies only ordinary tables and ordinary views, while the grant plan already hands `SELECT` to materialized views — so the first materialized view in any future migration is granted and unprotected with the boot check green, and a partitioned shop-scoped table is neither policied nor refused. Below those, four residuals belong in §11 rather than in a fix: a foreign-key check bypasses row-level security, so a forgotten predicate can still bind a row to another tenant's anchor and the success-versus-`23503` difference is an existence oracle on the write path that I3's "byte-identical" claim does not cover; `pnpm migrate` grants before it policies, and the policy step is designed to throw; the exact call-site count is a count of string literals and not of call sites; and `shop_domain` is an unclaimed namespace across tenants. Verified clean and worth recording as tested rather than assumed: no `SECURITY DEFINER` function exists, `current_shop_id()` is correctly `STABLE` and the leaky-qual reordering attack is closed by the application role holding no `CREATE` on `public`, `pg_stats` returns nothing for policied tables so cross-tenant distribution does not leak through the statistics views, the context does not survive an error path or a pooled connection, and the assertion runs before a port is bound. Nothing here should be read as protection against a compromised application process, and no artifact, C-row or partner-facing sentence may say otherwise.

### 2.2 The consistency lens (`martin-kleppmann-reviewer`) — ACCEPT-WITH-CHANGES

> The transaction-local tenant context is real — I sent a probe directly to an app-role Postgres connection and watched `longbox.shop_id` appear inside the transaction and vanish at COMMIT, exactly as claimed, in one round trip — and the invariants in §10 are tested against a live cluster rather than merely asserted, which is the standard I hold every consistency claim to. But `migrations/029`'s hardcoded ten-table `service_context` array has already drifted from the fourteen-table list in `src/db/rowLevelSecurity.ts` that actually governs every real deployment, and the only thing preventing that drift from being a production outage today is that `pnpm migrate` always runs both halves together — which is exactly the kind of assumption a disaster-recovery script, a future migration-runner refactor, or a hand-run of the SQL file 044 §7 explicitly wants to remain re-runnable will not honor. Collapse the two lists into one before this record leaves PROPOSED.

### 2.3 A counted difference, recorded rather than reconciled away

The consistency lens counted **fourteen** service-scoped tables in
`src/db/rowLevelSecurity.ts`; the security lens counted **seventeen** policied
service-scoped tables from the live `pnpm migrate` output. **Both counts are
correct about what each looked at, and the gap between them IS K6** — the
migration's array, the module's list and the runner's derivation had come apart.
Both numbers stand here as the lenses stated them, and the single list §5 now
describes settles the number at **eighteen** (the fourteen, plus the four
connector tables the module gained while the cannon was in flight, minus none).

### 2.4 The consistency lens's note on another seat's territory

Lamport-style formal treatment of `SKIP LOCKED` + the re-check in `claimBatch` (`outbox.ts:590-624`) is the one spot where a proof would add real value if the outbox ever becomes multi-poller (E13-B03); the prose argument with a named counter-scenario is accepted as adequate at this system's stakes.

### 2.5 Where the two lenses met

F4 and K6 are one finding reached from two directions: the security lens saw a
migration header saying "eight" over an array of ten beside a runner applying
seventeen; the consistency lens saw the same drift and named the failure mode —
that only `pnpm migrate` running both halves together kept it from being an
outage. Both asked for the same fix and it is the one taken: the migration
carries no list at all.

### 2.6 The acting head's rulings, and what was NOT taken

* **F1's second commit (the scope-keyed predicate) is taken in full**, not as a
  follow-up. A `FOR ALL` boolean was a cross-tenant write grant, and shipping the
  narrower read policy while leaving the write one for later would have left the
  reproduced defect live behind a smaller name.
* **F5 (the FK existence oracle) is NOT fixed here.** It needs `UNIQUE (id,
  shop_id)` on `scan_session` and ten child FKs re-pointed at
  `(scan_session_id, shop_id)` — a schema change with its own migration, its own
  rollback and its own lock profile, which does not belong in a bead that is
  already changing what every policy says. It is §11 R7 and **E03-D19**
  (`longbox-e5b.3.29`), filed OPEN and blocked on this bead.
* **F8 is taken as a REFUSAL rather than as an index.** A partial unique index
  cannot express "at most one SHOP" while a rotation legitimately leaves two live
  versions for one shop (050 §2 Q2), so the check sits where the authority is
  created.
* **K8 (non-`CONCURRENTLY` index builds) is NOT changed here** and is §9's
  closing paragraph plus **E03-D20** (`longbox-e5b.3.30`): no live shop rows exist before
  G3 (034 §3.4's go-live posture), so the lock is free today and expensive later,
  which makes it a deploy-discipline decision rather than a code change.

## 3. Decision A — the tenant is a TRANSACTION-LOCAL setting, set from the session, in the same round trip as `BEGIN`

> **Every transaction declares what it is about. `SET LOCAL longbox.shop_id = <the session's shop>` — written as `set_config(…, is_local => true)` so the name can be a constant — is issued in the same statement as `BEGIN`, before any other statement and before any lock. Every policy reads it through `current_shop_id()`, a `STABLE` function that returns NULL when it is unset. A transaction that declares nothing sees nothing.**

**Why transaction-local and not sticky.** 034 §3.2 fixed this before there was any code: *"`SET LOCAL`, never sticky connection state, because the pool is shared and a leaked `SET` outlives the request"*, and 046 §6 K-5 named the failure concretely — *"`SET LOCAL` on a pooled connection outside a transaction leaks into the next request that borrows it"*. `is_local` reverts at COMMIT **and** at ROLLBACK, so the connection handed back to the pool carries nothing. Two integration cases pin it on a pool of ONE, which is the only way to guarantee the next statement lands on the same physical connection.

**Why it travels with `BEGIN`.** Three reasons, and only the first is about speed:

1. **One round trip.** The context costs no extra exchange with the server on any path.
2. **It cannot be expressed late.** 042 §5.3(b) fixes ONE lock order — the `request_idempotency` INSERT, then the session lock, then the `scan_session` anchor — and a context set after `BEGIN` would be one more thing an author could put in the wrong place. Travelling with `BEGIN` makes "before everything" structural rather than remembered.
3. **It takes no lock, so it adds no position to that order.** `set_config` reads nothing, writes no row and blocks on nothing. This record does **not** add a fifth position to 042 §5.3(b); it adds a statement that precedes all four by construction.

**Both settings are written on every context**, including the one being cleared — a tenant context blanks `longbox.service` and a service context blanks `longbox.shop_id`. `is_local` already makes inheritance impossible; writing both makes it impossible as a property of the STATEMENT rather than as a property of a code path that ran.

**The uuid is checked, not escaped.** The value is interpolated (a bound parameter would force a second round trip on every transaction in the system), so `assertShopId` accepts the canonical 8-4-4-4-12 form and nothing else, and throws BEFORE a connection is checked out. A `shopId` reaching there came from a session row and is a `uuid` column value; anything else is a caller's bug. `tests/tenant-context.test.ts` drives seven hostile shapes through it.

### 3.1 The two alternatives, and why they lose

**(a) `SET ROLE` per request — a Postgres role per shop.** The strongest form of isolation Postgres offers, and it is what a single-tenant-per-role deployment would do. Rejected on three counts. It makes **onboarding a DDL operation**: `pnpm register-shop` would have to create a role and grant it, which puts a privileged, schema-changing act on the path of a routine one — the opposite of E02-D06's ruling that the application role owns nothing. It **does not survive the pool**: `SET ROLE` is sticky exactly like `SET`, so it needs a `RESET ROLE` in a `finally` that must never be missed, which is the leak this design removes rather than manages. And it **cannot express the pre-tenant reads at all** (§5): a session cookie is resolved before anyone knows which shop the caller is at, so there is no role to have set.

**(b) Application-side filtering only — every query carries `AND shop_id = $1`.** This is what the system had, and it is what 034 §1 E10 and 046 E8 record as the defect: *"a convention enforced by every hand-written `WHERE`, not a boundary"*. It fails to exactly the thing this layer exists to survive — a handler that forgets, a report that joins one table too many, a generated query. It is not deleted by this record: every query still carries its predicate, and the policy is the second wall behind it.

**(c) The chosen shape's own cost** is §9's, and it is stated there rather than argued away.

---

## 4. Decision B — `ENABLE`, not `FORCE`: the schema owner bypasses, and that is the point of having two roles

> **Row-level security is ENABLED on every policied table and `FORCE ROW LEVEL SECURITY` is deliberately NOT set. The table owner — `longbox_migrate`, which runs the migrations — is therefore exempt from these policies. The role the boundary is about is `longbox_app`, which owns nothing, is not a superuser, has no `BYPASSRLS`, and is subject to every one.**

PostgreSQL exempts a table's owner from its own policies unless `FORCE` is set. Under `FORCE`, every migration data statement, every operator CLI (`pnpm register-shop`, `pnpm issue-invitation`, `pnpm connector-install`, the three MFA CLIs), the schema-fixture generator and most of the integration lane — all of which connect as the owner with no session and therefore no tenant — would be filtered to nothing or refused by a `WITH CHECK`. `FORCE` would not make the boundary one row stronger for the application; it would make the owner's tooling unusable and then buy the difference back with a `BYPASSRLS` role attribute that only a superuser can grant, on every cluster, forever.

**What makes the owner-bypass safe is not a promise; it is E02-D06 plus a boot assertion.** `src/services/roleSeparation.ts` already refused to serve on a connection that owns an append-only table or is a superuser. This bead adds `assertTenantIsolationOrThrow`, which additionally refuses a connection that:

1. has `BYPASSRLS` or `SUPERUSER` — either attribute makes every policy advisory;
2. owns (or can `SET ROLE` into owning) any **policied** table — the owner exemption, closed for the serving connection specifically;
3. faces any policied table with RLS off or no `tenant_isolation` policy at all;
4. faces **any policy, on any policied table, that this design does not emit** — compared as a SET, by `(table, policy name, command, USING, WITH CHECK)`, against the declaration itself;
5. faces any view that is not `security_invoker` (§8);
6. faces any relation of a kind that cannot carry a policy at all — a materialized view, a foreign table (F3).

**Item 4 replaces a per-table question, and the replacement is the security lens's F2 plus the invariant review's BLOCK.** The first version asked, table by table, *"does `tenant_isolation` exist and does its predicate match?"*, and three ways of being wrong walked past it:

* a PERMISSIVE policy **added** beside the declared one — `CREATE POLICY oops ON scan_session USING (true)` — is OR-ed with it by Postgres, so the boundary is gone while every declared policy is intact. Reported `ok=true`; the application role read another shop's rows;
* `tenant_isolation` **reshaped** to `FOR INSERT WITH CHECK (true)` has a NULL `qual`, which the query's `using_expr <> ''` guard read as "nothing to compare". Reported `ok=true`; a cross-tenant INSERT was accepted;
* the **second policy was never inspected at all** — the one that spans tenants by design.

An inventory of what SHOULD be there is blind to all three. An inventory of what IS there, compared against the declaration, sees all three. It runs before a port is bound, it fails closed, and **six integration cases prove it can fail** — a dropped policy, a predicate relaxed to `true`, an added permissive policy, a reshaped `tenant_isolation`, a service policy planted on an undeclared table, and a materialized view — because a check that has never failed and a check that cannot fail look identical from outside (029 §5 move 8).

**And `shop` is policied on its own `id`** (the invariant review's WARN 3). v1.0.0 exempted the tenant table on two grounds: that a policy would break the one read whose answer spans shops, and that `membership` bounds it anyway. The first had been falsified by this bead's own work — a `my-shops` SCOPE serves that read exactly — and the second is an argument about a route rather than about a table. The consequence is a property worth having: **an INSERT into `shop` can never satisfy `id = current_shop_id()`, because the tenant IS the row being created, so creating a shop is a schema-owner act enforced by the database** rather than by the convention `pnpm register-shop` already followed.

---

## 5. Decision C — the cross-tenant statements are a CLOSED union of named scopes, and the count of their call sites is exact

> **A handful of statements are cross-tenant by construction. Each is covered by a member of a closed union in `src/db/tenantContext.ts`, and each member carries the sentence that justifies it. The tables they reach carry a SECOND policy — `service_context`, `FOR SELECT`, `USING (longbox_service_scope() = ANY (ARRAY[…the scopes THAT table declares…]))` — and three of them carry a THIRD, `service_write`, `FOR INSERT`, `WITH CHECK (…those scopes… AND a condition about the row)`. `pnpm arch` holds the number of call sites naming each scope at an exact number, and the number of call sites ENTERING any scope at the sum of them — never a ceiling.**

⚠ **THE SHAPE ABOVE IS v1.1.0'S, AND IT REPLACES A WEAKER ONE THAT THE SECURITY LENS BROKE.** v1.0.0 emitted ONE policy per table — `FOR ALL USING (longbox_service()) WITH CHECK (longbox_service())` — over a scope-agnostic boolean. The lens reproduced what that means: **inside `my-shops`, a scope whose entire purpose is to answer one READ, the application role inserted an owner membership at another shop.** Every scope was a cross-tenant read *and write* grant on every service-scoped table. §5.2's claim that the exception was countable was true; the claim it did not make — that its blast radius was bounded — was the one that mattered.

The seven members, and why each cannot name a shop:

| Scope | Why it has no tenant to name |
|---|---|
| `session-resolution` | A `__Host-` cookie is resolved to a session row by digest. **The row it finds IS the tenant** (048 §6.1), so the lookup cannot carry the shop it is about to establish. Covers `app_session`, its revocation, and the `auth_attempt` row a refusal writes with a NULL `shop_id`. |
| `device-session-open` | A phone presents its device secret; the credential names the shop (048 §3.2, §7.4). Same shape one layer down. |
| `code-redemption` | An enrollment code or an invitation is presented by a caller with no session (048 §7.2, §7.3). The code identifies the shop; the SELECT that finds it runs before a tenant exists. |
| `my-shops` | `GET /api/v1/shops` answers WHICH tenants this session may act on (048 §6.4). It is the one read whose correct answer spans shops, because a person may hold memberships at more than one (034 §2.6). |
| `second-factor` | TOTP and recovery codes are acts of a PERSON (048 §4, §8): `app_user` and `user_authenticator` carry no `shop_id` at all, and the attempt row a failure appends carries a NULL one. |
| `outbox-sweep` | The poller has no session (043 §7.3) and drains ONE SHOP AT A TIME, so the only thing it cannot do under a tenant context is ask WHICH shops exist — and `shop` is policied now, so that read needs a scope. It reads `shop` and nothing else. |
| `connector-inbound` | The OAuth callback resolves its shop by `state_digest` and the webhook by `shop_domain` (053 §7). A webhook matching no install writes a receipt with a NULL `shop_id` (053 §5.5), which matches no tenant policy at all. |

### 5.0 What each scope may DO, not merely reach

Three of the eighteen service-scoped tables are WRITTEN inside a scope; the other fifteen are only read. The write
policy's check is never the scope list alone — that would be the `FOR ALL`
boolean wearing a narrower name — but the scope list **AND** a condition about
the row:

| Table | Written by | The condition on the row |
|---|---|---|
| `auth_attempt` | `session-resolution`, `device-session-open`, `code-redemption`, `second-factor` | `shop_id IS NULL OR longbox_service_scope() = 'code-redemption'`. The session scopes and the second factor append a refusal for a shop nobody has identified — a NULL `shop_id`, which no tenant policy can ever match. `code-redemption` is the one scope that knows a shop (the device's, 048 R15) and keys the per-shop delay on it, so it is named rather than covered by widening the NULL case for everyone. |
| `connector_token_retirement` | `connector-inbound` | `webhook_receipt_id IS NOT NULL`. An uninstall ends every token granted for a store, whichever shop holds it (053 §7.3), so the write cannot name one tenant — but it can be required to cite the signed message that caused it, which is what bounds it. A deliberate `--reason rotation` retirement runs as the owner, elsewhere. |
| `connector_webhook_receipt` | `connector-inbound` | `topic IS NOT NULL`. This is the one row in the system whose `shop_id` may legitimately be NULL after the write (053 §5.5), so it has nowhere else to happen. |

Everything else a scope touches is `FOR SELECT`. A membership, a session, a
device, an invitation, a use row, a token version: each is WRITTEN under the shop
it belongs to, in an ordinary tenant transaction.

### 5.1 Why a second policy and not an exemption

The alternative was to leave those tables outside row-level security altogether. **Rejected**: it would remove the boundary for the many ORDINARY readers of `membership`, `app_session` and `device` in order to serve the seven extraordinary ones, and a table with no policy is a table where a future handler bug is invisible. Keeping the policy on the table and naming the exception in the CALLER means the exception is countable — and `pnpm arch` counts it.

### 5.2 What keeps the exception narrow

Four things, and none of them is a review:

1. the union is **closed** (a TypeScript union of string literals), the scope is **checked at runtime** as well as in the type before it reaches a statement (the invariant review's NOTE 4 — a compile-time promise is worth nothing at the moment an `as` cast or a JSON boundary breaks it), and each policy names the scopes ITS table serves, so a scope is not a skeleton key;
2. every member carries its **reason in the constant**, asserted to be longer than a label (`tests/tenant-context.test.ts`);
3. `pnpm arch`'s `service-scope-inventory` holds the exact call-site count per scope across `src/` and `scripts/`, **and a second, independent count of the call sites that ENTER any scope** (`serviceDb(` and `service:`) which must equal the sum of them. The security lens's F7 is why the second exists: the per-scope counts match string literals, so a scope passed as a VARIABLE contributes zero to all of them and the inventory would report green with a seventh site live. A new site fails the gate; a removed one fails it too, until somebody lowers the number. That is 044 §6's rule for every other inventory in this repository;
4. **the declaration lives in ONE place.** `migrations/029` used to carry a hardcoded copy and the two had already drifted (F4 / K6) — the migration named ten tables, the module fourteen, the runner applied seventeen. The migration now carries no list at all, and `tests/contract/service-scope-declaration.test.ts` fails any migration that creates either service policy, names a scope in a statement, or lists the tables in a policy array.

### 5.3 The outbox drains ONE SHOP AT A TIME — the alternative is recorded rather than taken

The background poller has no session (043 §7.3). Two shapes were available:

- **(taken) a per-shop loop.** `drainAllShops` reads the shop list under the `outbox-sweep` scope — one `SELECT id FROM shop`, and nothing else, because `shop` is policied on its own `id` (§4) — and then calls `drainOnce` once per shop with that shop's tenant context. The claim, the dispatch and every attempt row run under the tenant they are about. **`outbox` gets NO service policy**, which is the property worth having: the busiest shop-scoped table in the system is reachable from exactly one tenant at a time.
- **(rejected) a cross-tenant claim inside a service scope.** One query per tick whatever the estate looks like — but it would put a permissive policy on `outbox`, the busiest shop-scoped table in the system, to save a query on a v0 with a handful of shops.

**The cost of the choice is stated and is not hidden**: one claim query per shop per tick, and `batchSize` becomes per shop rather than per cycle. The number to watch is shops × ticks. When it stops being negligible, the fix is a service-scoped read of *which shops have work* — one query, and a far smaller widening than a cross-tenant claim — and it is **E13-B03's** to make, beside the `LISTEN`/`NOTIFY` question 043 §10 A4 already parked there.

---

## 6. The two findings this bead produced, and the rule the cannon added beside them

**The first two are consequences of the one property that makes row-level security pleasant to work with: a missing or wrong context is an EMPTY RESULT, never an error.** That is exactly right for a read — it is what makes a cross-tenant read indistinguishable from an absent row (019 T24, 048 §9.3) — and it is a trap everywhere a query's meaning depends on rows being ABSENT.

### 6.1 A `NOT EXISTS` guard beside a service-scoped table fails OPEN

`GET /api/v1/shops` asks for memberships that no revocation names. With `membership` carrying the service policy and `membership_revocation` NOT carrying it, the `NOT EXISTS` subquery saw no revocations at all — so **a revoked grant kept answering with the shop it no longer reached**. A filter expressed as an absence, over a table the context cannot see, is a filter that passes.

> **THE RULE, for every future scope: a table read as a `NOT EXISTS` (or `LEFT JOIN … IS NULL`) guard alongside a service-scoped table must be service-scoped too.** Six tables in the current set are there for precisely this reason: `app_session_revocation`, `device_credential_revocation`, `device_enrollment_code_use`, `invitation_use`, `membership_revocation`, and `device` (which is JOINed, not tested for absence, but fails the same way).

**The rule earned its keep once more during the fold.** Adding `second-factor` to
the scope set surfaced `liveRolesOf`, which asks which roles a person holds
ANYWHERE and excludes revoked grants with a `NOT EXISTS` — so `membership` in the
scope without `membership_revocation` would have read a REVOKED owner as
privileged and enrolled them a second factor. Both are in the scope. The rule
caught it, not luck.

Caught by `tests/integration/session-tenant-isolation.test.ts`, which asserts that a revoked membership empties my-shops on the next request.

### 6.2 An `UPDATE` that matches no row SUCCEEDS

A role-separation case asserted that the app role's `UPDATE outbox …` is refused **by the append-only trigger**. With no tenant context the statement matched zero rows, changed nothing, raised nothing, and **the assertion passed for the wrong reason** — the trigger never fired. The same shape put a lock where no lock was taken: `SELECT … FOR UPDATE` locks the rows a statement can SEE, so a held-lock fixture with no context held nothing.

> **THE RULE: a statement that asserts a DATABASE refusal — or takes a LOCK — must run in a context where the row is visible, or it is asserting the boundary above the one it names.** Five tests now set the context explicitly for exactly this reason, each with the sentence above beside it, and two of them (`FOR UPDATE` fixtures) were holding no lock at all.

### 6.3 A UNIQUE over a client-choosable value must be prefixed by the tenant

The security lens's F9, recorded as a rule before there is anything to fix. **A
unique violation is not filtered by a policy**: the index is checked against every
row in the table, including rows the caller cannot see. So a `UNIQUE` on a
policied table over a value a caller CHOOSES would answer "taken" for another
tenant's value — an existence oracle over that column, wearing a constraint's
name. **v1.1.0 said there was nothing to repair. That was false by one, and the
invariant re-verification found it.** Almost every unique index on a policied
table is over a system-generated value (a uuid, a digest) or is already prefixed
by `shop_id` (`request_idempotency`'s `(shop_id, idempotency_key)` is the worked
example). **The exception is `shop_shopify_domain_is_one_store`** —
`UNIQUE (shopify_domain) WHERE shopify_domain IS NOT NULL`, added by
`migrations/026` when `shop` was not policied, and inherited by this bead the
moment §4 policied it. Reproduced on `postgres:16`, 2026-09-05, as
`longbox_app` under shop B's context:

```
UPDATE shop SET shopify_domain='a.myshopify.com'   -- a domain shop A holds
  -> ERROR: duplicate key value violates unique constraint "shop_shopify_domain_is_one_store"
UPDATE shop SET shopify_domain='unused.myshopify.com'
  -> UPDATE 1
```

Two distinguishable answers over a row the caller cannot read: **a one-bit
oracle on which Shopify stores are Longbox customers**, which is commercial
information about third parties rather than about the caller.

**It is LATENT, and the reason is worth stating rather than assuming.** The app
role holds `UPDATE` on `shop` because 034 §4.2 declares the table configuration
edited in place rather than a witness, so the grant is deliberate — but **no
route writes `shopify_domain`**. The two writers are `pnpm register-shop` and
`pnpm connector-install`, and both run as the schema owner, for whom the index
is not an oracle because the owner can read the rows anyway. So there is nothing
to repair *today* and something to repair *before a route ever sets a domain*.

**It belongs to E03-D19's class, not to a rule of its own**, and §11 R7 says so:
both are the same defect — the tenant is not part of a constraint that is
checked with row-level security off. A `UNIQUE (shopify_domain)` that a caller
could reach needs to become a constraint the tenant participates in, exactly as
`scan_session`'s children need `(id, shop_id)`.

> **AMENDMENT (v1.2.0, 2026-09-05, E03-D19 `longbox-e5b.3.29`). The half of this
> section that names `scan_session`'s children is DONE; the half that names
> `shop_shopify_domain_is_one_store` is NOT, and it did not move to this bead.**
> `migrations/034` keys all ten children on `(id, shop_id)` (§11 R7's amendment).
> The unique index is a different repair with a different shape — a foreign key
> gains a column, a unique index over a client-choosable value needs the value to
> stop being client-choosable at that scope — and the change that makes it is
> R10's: the install CLAIMS the store's domain on `shop`, which serialises two
> concurrent installs and removes the oracle in the same statement. **E03-D22**
> (`longbox-e5b.3.32`) owns it. Until it lands this section's own reason stands
> unchanged: it is latent because no route writes the column, and it stops being
> latent the day one does.

---

## 7. Tables with no tenant are DECLARED, with a reason each

`src/db/rowLevelSecurity.ts` carries a row per shop-less table, and the live schema is asserted against that list **in both directions**. The classes, rather than the 22 rows:

- **the catalog** — a corpus is the same facts for every shop (030 §7 gives catalog tables no `shop_id` by design);
- **the party above a shop** — `organization`, which is what a `shop` points AT. **`shop` itself is NO LONGER HERE**: v1.0.0 exempted it and the invariant review found the reason had been falsified by this bead's own `my-shops` scope, so it is policied on its own `id` (§4);
- **the person** — `app_user`, `user_authenticator` and its retirement, `recovery_code` and its use. **The reason v1.0.0 gave was wrong and is replaced.** It said an `EXISTS (SELECT 1 FROM membership …)` policy would encode *a person belongs to one shop*; the invariant review rejected that, correctly — the bullet below uses exactly that parent-EXISTS shape for `retention_hold_release`, and a policy can perfectly well say "visible at any shop where this person holds a grant". The real ground is narrower and harder: **the grant and the read happen in the SAME transaction.** `grantInvitation` writes the membership and then reads the person; a newcomer being invited holds no grant anywhere yet. A membership-EXISTS policy would refuse the person during the act of admitting them, and a policy that has to be worked around at the one moment it applies is not a boundary. What bounds these meanwhile is the module graph, 034 §3.3's audited accessor for the attribution columns, and every read being by the authenticated person's own id or by a digest. **The residual is §11 R9** rather than a sentence that makes it sound closed;
- **a child of a policied parent** — `retention_hold_release`, which carries its hold's id and a timestamp. A parent-EXISTS policy is available if a reader outside the retention sweep ever appears; there is none today;
- **the runner's own ledger** — `schema_migrations`, which is `appGrant: "none"` for the same reason (044 §4).

A live table in neither class stops `pnpm migrate` with `UndeclaredTenancyError`, which names the table and both ways out. Defaulting an unknown table to "exempt" would put a new shop-scoped table whose author forgot the column outside the boundary silently — which is the defect this bead closes.

---

## 8. Every view is `security_invoker`, and without it the rest would have been void

By default a view's underlying tables are read as the **view's owner**, and the policies that apply are the view owner's. Every view here is owned by `longbox_migrate` — the role §4 exempts — so `SELECT * FROM condition_assessment_current` from the application role would have returned **every shop's rows** while the base table beneath it returned one shop's. The four views are the three `*_current` read models and `outbox_dead_letter`: exactly the shapes a report reaches for.

`security_invoker = true` (PostgreSQL 15+) makes the underlying access run as the CALLER. It is set on every view in the schema by the same catalog enumeration the policies use, re-applied by the runner on every migrate run (a `CREATE OR REPLACE VIEW` in a later migration is a shape that could drop it), asserted by the integration lane, and checked at boot.

---

## 9. What it costs, stated rather than argued away

**On the mutating path: nothing measurable.** The context is one extra string on the `BEGIN` the request already sends, inside the one transaction `runIdempotent` already opens (042 §5.3(a), I21).

**On the read path: two extra round trips per scoped read.** A read through `tenantDb` is `BEGIN`+`set_config` (one round trip), the statement, and `COMMIT`. Those are reads that were already separate pooled calls, made outside any transaction because 041 §4.1 forbids holding a connection across a provider call. The alternative — one long transaction per request — is the thing 041 §4.1 exists to prevent.

**In the planner: one comparison per QUERY, not per row.** `current_shop_id()` is `STABLE`, so the policy is lifted into a one-time filter. Reproduced on `postgres:16`, as the app role, on a `scan_photo` holding 200 rows for the reading shop and 5,000 for another:

```
Result
  One-Time Filter: ((NULLIF(current_setting('longbox.shop_id'::text, true), ''::text))::uuid = 'aaaa…'::uuid)
  ->  Index Scan using scan_photo_shop_idx on scan_photo
        Index Cond: (shop_id = 'aaaa…'::uuid)
```

The same query on a table where ONE shop holds every row plans a `Seq Scan` under the same one-time filter — which is the right plan for that shape, and the reason the index assertion in the lane seeds a second tenant before asking. `migrations/029` adds the missing `shop_id` index to the eighteen tables that had none with `shop_id` in the leading position; the integration lane asserts that **every** policied table has one, so a table added later cannot quietly become a sequential scan across every tenant. (`shop`'s is its primary key, which is the same index by another name.)

**None of those eighteen indexes is built `CONCURRENTLY`, and that is a decision
rather than an oversight** (the consistency lens's K8). A plain `CREATE INDEX`
takes `ACCESS EXCLUSIVE` on a populated table, which on a live database is a
write outage for the duration. **There is no live shop data yet**: 034 §3.4's
go-live posture puts the first real item behind G3 and this bead behind G2, so
every table these indexes touch is empty or synthetic and the lock costs nothing.
It stops being free the moment a shop has rows, which is exactly the moment
`CONCURRENTLY` — and its own failure mode, an INVALID index that has to be
dropped and rebuilt — becomes worth the complexity. The rule that generalises it
belongs in 000-docs/044 beside the expand/contract lint rather than here, and it
is **E03-D20** (`longbox-e5b.3.30`), filed OPEN and blocked on this bead.

---

## 10. Invariants

| # | Invariant | Where it is asserted |
|---|---|---|
| **I1** | Every table carrying a `shop_id` has RLS enabled and a `tenant_isolation` policy whose predicate is `shop_id = current_shop_id()` on both halves — **and `shop` itself is policied on `id = current_shop_id()`**, so an application-role INSERT into the tenant table can never satisfy its own check. | `rls-tenant-isolation.test.ts` (three cases, catalog-derived) |
| **I2** | Every table carrying no `shop_id` is a declared exemption with a reason; a live table in neither class stops the migrate run. | same file; `rls-plan.test.ts` |
| **I3** | With no context the app role reads zero rows and every INSERT is refused; with another shop's context a row read BY ITS PRIMARY KEY returns nothing, byte-identically to an id that never existed. | same file (019 T24, 048 §9.3) |
| **I4** | A cross-tenant INSERT and a cross-tenant UPDATE are refused by `WITH CHECK`, in every property table. | same file (property, 9 tables) |
| **I5** | No generated (reader, subject, table) triple returns another shop's row, and no generated two-table JOIN does either. | same file (108 generated reads + 42 joins) |
| **I6** | The context does not survive COMMIT or ROLLBACK on a pooled connection. | same file (three cases, pool of one) |
| **I7** | Every view is `security_invoker`. | same file; boot assertion |
| **I8** | Every policied table has an index whose leading column is `shop_id`, and the policy folds into a one-time filter. | same file (two cases, one an EXPLAIN) |
| **I9** | The serving connection has no `BYPASSRLS`, no `SUPERUSER`, owns no policied table, and the process refuses to bind a port otherwise. | `roleSeparation.ts`; **six** negative fixtures in the lane |
| **I10** | Every `withTransaction` under `src/` declares a tenant; the GUC is written in exactly one file; each service scope is named an exact number of times, **and the number of call sites ENTERING any scope equals the sum of those counts**. | `pnpm arch`, with negative fixtures |
| **I11** | A database restored from a pre-RLS snapshot has the boundary in force after `pnpm migrate`. | `prior-snapshot-upgrade.test.ts`, per snapshot |
| **I12** | **The set of policies that EXISTS equals the set this design emits** — compared by table, policy name, command, `USING` and `WITH CHECK` — so a permissive policy added beside the declared one, or `tenant_isolation` reshaped to another command, stops the boot. | same file; four of I9's six fixtures — a predicate relaxed to `true`, `tenant_isolation` reshaped to INSERT-only, a permissive policy ADDED beside the declared one, and a service policy planted on a table nothing declares. (There is no "altered service policy" fixture; v1.1.0's parenthetical named one and was wrong.) |
| **I13** | A service scope may READ only the tables that NAME it, and may WRITE only `auth_attempt`, `connector_token_retirement` and `connector_webhook_receipt`, each under a check that constrains the ROW and not merely the scope. | same file, three cases: the policy SHAPE from the catalog; the F1 regression (a cross-tenant `membership` INSERT from inside `my-shops` is refused); and the write policies' BEHAVIOUR — a NULL-`shop_id` `auth_attempt` accepted under `session-resolution` and a shop-named one refused, the reverse under `code-redemption`, and a `connector_webhook_receipt` accepted under `connector-inbound` with and without a shop and refused under any other scope |
| **I14** | No migration creates either service policy, names a scope in a statement, or lists the policied tables: the declaration has exactly one home. | `tests/contract/service-scope-declaration.test.ts` |
| **I15** | A relation of a kind that cannot carry a policy — a materialized view, a foreign table — reachable by the application role stops the boot rather than being skipped. | same file (one fixture, a materialized view the app role can `SELECT`) |
| **I16** | The T24 cross-tenant audit reports zero over a clean seed, reports non-zero with one planted mismatched-parent row, and prints per-table COUNTS and never row contents. | `tests/integration/cross-tenant-audit.test.ts` (7 cases) |

---

## 11. Residual risk — what this boundary does NOT defend

**R1. The application role can set the context to any value it likes.** Nothing in Postgres stops a compromised process from declaring itself another shop; `SET LOCAL` is an unprivileged statement. **This layer defends against a FORGOTTEN PREDICATE** — a handler missing its `WHERE`, a report joining one table too many, a generated query — which is precisely the failure 034 §3.4 assigns it. The layer that defends the VALUE is the session (048 §6.1) and the layer that defends the process is not in this system. No artifact, 021 C-row or partner-facing sentence may describe row-level security here as protection against a compromised application.

**R2. The operator CLIs bypass entirely.** `register-shop`, `issue-invitation`, `issue-enrollment-code`, the three MFA CLIs, `connector-install` and `connector-retire-token` run as the schema owner (§4). They are the intended path for privileged acts today and every one records a fact; the gate that limits WHO may run them is 034 §3.3's audited accessor module — **E03-D17** — and the privileged session that will replace them with routes is **E03-D11**.

**R3. The break-glass reconciliation query has no tenant and no home.** `unreconciledBreakGlassSessions` asks a cross-tenant question by construction ("which sessions anywhere are covered by no grant"). It has no in-application caller: 019 T35(c)'s cadence and its T34 heartbeat are **E13-B04.1's**. It runs on the owner connection today; when it gets a scheduled home it will declare a service scope like every other tenant-less reader.

**R4. The audit query exists; what it can SEE is narrower than "no data crossed tenants".** The acting head ruled that T24's second half is built here rather than deferred, and it is (§1 E11, I16): `pnpm audit:cross-tenant` derives its edges from the catalog and counts rows whose `shop_id` disagrees with the parent they point at, plus the one grant predicate that is definable. **What it detects is a row whose tenancy is INTERNALLY INCONSISTENT.** It cannot detect a compromised process that sets a context to another shop and then writes rows that agree with themselves — that is R1, and no query can see it, because those rows are indistinguishable from correct ones. It also cannot see a read: nothing in the schema records that a `SELECT` happened. Saying "the daily audit proves no tenant crossing occurred" would be false in both directions, and no artifact or 021 C-row may say it. **What remains E13-B04.1's** is the SCHEDULE that runs this query daily and the T34 heartbeat that pages when it stops running — a query nobody runs is a query that reports nothing.

**R5. Seven service scopes are seven places a statement sees more than one shop.** Narrower than at v1.0.0 — a scope now reaches only the tables that name it, and writes only under a predicate about the row (§5.0) — but not gone: inside `session-resolution`, a `SELECT` from `app_session` still spans tenants by construction, which is the entire point of the scope. Bounded by §5.2's four mechanisms, and every one of them is a code change that shows up in a diff. An eighth belongs in this record with its reason before it belongs in the union.

**R6. `FORCE` is not set, so a future SECURITY DEFINER function owned by the migrate role would bypass the policies.** There are none today (`grep` for `SECURITY DEFINER` returns nothing, and the security lens re-verified it against a live cluster). If one is ever added, it must either be owned by a non-owning role or the table set must move to `FORCE` with `BYPASSRLS` on the migrate role — a decision, not an edit.

**R7. A foreign key is checked with RLS OFF, so a policy on the CHILD says nothing about which tenant the PARENT belongs to.** The security lens raised this as F5, an existence oracle; re-probing it against a live cluster while writing this section found it **larger than the lens stated**, and the larger version is what this record carries. Three probes as `longbox_app` under shop B's context, by hand against **`candidate_set`** (016 C46, all `postgres:16`, 2026-09-05):

1. `INSERT INTO candidate_set (scan_session_id, shop_id, …) VALUES (<shop A's session>, <shop B>, …)` → **`INSERT 0 1`**. The row's own `shop_id` is B, so `WITH CHECK` is satisfied; the foreign key resolves A's session because the FK check does not see the policy. **The application role can attach a row in its own tenant to another tenant's parent.**
2. The same with a `scan_session_id` that exists nowhere → `ERROR: … violates foreign key constraint`.
3. The same with `shop_id` set to A → `ERROR: new row violates row-level security policy` — the pair the lens reported.

Probe 1 against probe 2 is an **existence oracle** over a value the caller must already possess (a v7 uuid nobody can guess), which is the small half. Probe 1 on its own is the real one: **the boundary prevents READING across tenants and does not prevent WRITING across them by reference.** Nothing in the pilot flow does this — a `scan_session_id` arrives from a URL the same session created — so it is a gap in the mechanism rather than a live defect, and **it is precisely what `pnpm audit:cross-tenant` detects** (§1 E11, I16): a child whose `shop_id` disagrees with its parent's is the exact shape probe 1 produces. **The PINNED lane case is `tests/integration/cross-tenant-audit.test.ts:99–136`, and it plants a `scan_photo`, not a `candidate_set`** — `scan_photo → scan_session` is a single-column foreign key, so the shape is identical and the edge is one the audit already enumerates; the hand probes above are named for the table they were actually run against, and the test for the table it actually plants. Detection is not prevention, and this record does not pretend otherwise. Closing it is a schema change: `UNIQUE (id, shop_id)` on `scan_session` and ten child foreign keys re-pointed at `(scan_session_id, shop_id)`, which makes the tenant part of referential integrity rather than a column beside it. That belongs in its own migration with its own rollback, not in a bead already changing every policy — **E03-D19** (`longbox-e5b.3.29`), filed OPEN and blocked on this bead, and it is the highest-value item on that list.

**§6.3's `shop_shopify_domain_is_one_store` is the same defect wearing a
constraint's name and belongs to the same bead.** A unique index is checked with
row-level security off against every row in the table, so a `UNIQUE` over a
value a caller could choose answers *"taken"* for a tenant the caller cannot
read. It is latent because no route writes `shopify_domain` — both writers are
schema-owner CLIs — and it stops being latent the day one does.

> **AMENDMENT (v1.2.0, 2026-09-05, E03-D19 `longbox-e5b.3.29`). R7's ANCHOR half
> is DISCHARGED. Everything above is kept verbatim as the record of what was true
> until `migrations/034` landed.**
>
> `034` adds `UNIQUE (id, shop_id)` on `scan_session` and re-points all ten child
> foreign keys at `(scan_session_id, shop_id) REFERENCES scan_session (id,
> shop_id)`, dropping the single-column edges the composite ones subsume. The
> tenant is now part of referential integrity rather than a column beside it,
> which is the change this residual asked for in its own last sentence.
>
> **Both halves of the defect are closed, and the second is worth stating
> separately because it was the smaller and is the subtler.**
>
> - **The ATTACHMENT.** Probe 1 is now refused: as `longbox_app` under shop B's
>   context, `INSERT INTO scan_photo (scan_session_id, shop_id, …) VALUES (<shop
>   A's session>, <shop B>, …)` raises `23503` on `scan_photo_session_same_shop`.
>   The row's own `shop_id` is still B, so the policy still passes — **it is the
>   CONSTRAINT that refuses, not the policy** — and the distinction is asserted
>   rather than assumed, because a change that collapsed probe 3 into `23503`
>   would mean the `WITH CHECK` had stopped running.
> - **The EXISTENCE ORACLE.** Probe 1 and probe 2 are now **the same error, field
>   for field** — same SQLSTATE, same message, same `DETAIL`, same schema, table
>   and constraint name. The composite key is what makes both OUTCOMES a refusal:
>   a foreign session id paired with the caller's own `shop_id` is absent from
>   `scan_session` for exactly the reason a uuid that exists nowhere is. `029`'s
>   policy on `scan_session` is a second, independent layer — the app role cannot
>   read the referenced table, so PostgreSQL emits the generic *"Key is not
>   present in table"* detail instead of echoing the key — and it is belt and
>   braces rather than load-bearing, since the echoing form would only have
>   repeated values the caller itself supplied.
> - **Probe 3 is UNCHANGED**: a row whose own `shop_id` names another tenant is
>   still refused `42501` by the policy, before the constraint is reached.
>
> Evidence: `tests/integration/cross-tenant-audit.test.ts` (twelve cases — seven
> at E03-B04, five new and one rewritten in place) and `tests/integration/prior-snapshot-upgrade.test.ts`, which proves
> the ten constraints VALIDATE against a fixture that already holds rows rather
> than only against an empty database. **What is NOT discharged is R11**, below;
> and §6.3's `shop_shopify_domain_is_one_store` is not discharged either — it is
> a unique index rather than a foreign key, it stays latent for the reason §6.3
> gives, and the change that fixes it is R10's, owned by **E03-D22**
> (`longbox-e5b.3.32`).

**R11. The anchor edge is closed; the SIBLING edges are not, and they are the same
mechanism.** _(Added at v1.2.0 by E03-D19, as the remainder of R7 rather than as a
new finding.)_ `034` covers every foreign key from a session-scoped table **into
`scan_session`**. It covers no other edge, and **seven** single-column foreign
keys into a session-scoped parent remain: `llm_rerank.candidate_set_id`,
`media_deletion.scan_photo_id`, `shopify_draft.outbox_id`, `cost_log.outbox_id`,
`outbox_attempt.outbox_id`, `listing_status_observation.shopify_draft_id` and
`identity_resolution.human_confirmation_id`.

> **CORRECTION (2026-09-05, the E03-D19 re-verification at `a4d5563`). This list
> said SIX and the seventh is `outbox_attempt.outbox_id`.** The reviewer
> reproduced it: as `longbox_app` under shop B's context, an `outbox_attempt`
> naming shop A's `outbox` row answers **`INSERT 0 1`**, and
> `pnpm audit:cross-tenant` catches it — *"CROSS-TENANT: 1 row(s) —
> outbox_attempt → outbox (outbox_attempt_outbox_id_fkey)"*, over **59** tenant
> edges. It is the same shape as `shopify_draft.outbox_id` and
> `cost_log.outbox_id`, with no composite companion.
>
> **The three `*_supersedes_*` self-edges are correctly ABSENT** and the reason
> is worth stating rather than assumed: `condition_assessment`,
> `human_confirmation` and `pricing_snapshot` each carry a single-column
> `supersedes_fk` AND a composite `supersedes_same_scope` over
> `(supersedes_id, shop_id, scan_session_id)` from `008`, so the tenant already
> participates in referential integrity on that edge.
>
> **Why the first list was wrong is the useful part**: it was assembled by
> reading the schema rather than by querying the catalog — which is precisely
> the failure `034`'s own loop refuses one layer down, where the ten children it
> names are CHECKED against `pg_constraint` before it will run. The seven above
> are derived by query, and the query is in this record's own §11 rather than in
> somebody's head.

**The wider set is larger still, and it is DETECTION-covered rather than
in scope.** At this head there are **42** single-column foreign keys between two
shop-scoped tables, and `pnpm audit:cross-tenant` enumerates **59** tenant edges
in total. R11 and E03-D27 scope themselves to the seven above — the edges into a
SESSION-scoped parent, where a cross-tenant attachment corrupts the record of one
scan — because that is the population `034` was closing and the one 016 C46
reproduced. The remaining single-column edges (identity and connector tables,
which have their own records) are covered by the audit exactly as these are, and
narrowing that gap is neither this record's claim nor E03-D27's promise. On each
of the seven R7's sentence is
still exactly true — a foreign-key check runs with row-level security off — so the
application role can write a row that is legitimate on its anchor and crosses
tenants on its sibling. **It is narrower than R7 was, in the way that matters**:
the value the caller must already possess is no longer a session id a URL handed
it but the id of a row it never saw, and the anchor it must also name has to be
its own. **It is covered by DETECTION and not by prevention** —
`pnpm audit:cross-tenant` derives these edges from the catalog like any other and
counts a disagreement, and the lane case that used to plant a `scan_photo` on the
anchor now plants an `llm_rerank` on the sibling for exactly this reason. Closing
it is the same change one parent at a time (each needs its own
`UNIQUE (id, shop_id)`), and **it has an owner: E03-D27
(`longbox-e5b.3.37`)**, filed by the session on 2026-09-05, OPEN and blocked on
E03-D19, at 015 row 283. **Its title and description are being restated from six
edges to seven by the acting head**, so this record names the bead and not a
quotation of a title that is mid-edit; 015 row 283 follows the bead. E03-D19 declined to widen its own bead to cover them, and that is
a scope judgement rather than a deferral of the finding.

**R10. Two concurrent installs of ONE store have a window in which both pass the
one-shop check.** `receiveCallback` refuses a domain another shop already holds
(F8) with a `SELECT` in the `connector-inbound` scope, and then introduces the
token version in a SEPARATE transaction under the shop's own tenant context. The
gap between them is small — no network call falls inside it — but it is a real
time-of-check-to-time-of-use window, and the failure it admits is the one F8
exists to prevent: two shops holding live tokens for one store, so that an
`app/uninstalled` ends the wrong shop's authority (053 §7.3).

**Two fixes were available and BOTH are worse than the window, which is why it
is a residual and not a patch.** (a) *Move the check inside the transaction* —
it cannot go there and stay correct: that transaction runs under a TENANT
context, under which `connector_token_version` rows belonging to other shops are
invisible, so the check would return zero rows every time and **fail open**,
which is §6.1's exact trap one layer over. (b) *Run the whole install in the
`connector-inbound` scope instead* — that needs a `service_write` policy on
`connector_token_version`, and widening a write policy to close a race is the
move the security lens's F1 punished. The durable fix is a **serialization point
the database already owns**: `shop.shopify_domain` carries a unique index (§6.3)
and the install does not write it, so nothing serialises two installs. Making
the install claim the domain ON `shop` turns two concurrent callbacks into one
winner and one `23505` — and it is the same change §6.3 needs for the same
reason. **Recorded here, owned by E03-D19's class; it wants its own bead under
E03 and this record asks for one rather than filing it.**

**R8. A shop with no row is a shop whose outbox never drains.** The consistency lens's K5: `shopIdsToDrain` reads `shop` under a service scope and then drains each shop under its own tenant context, so rows belonging to a `shop_id` with no surviving `shop` row are invisible to the poller forever. **Nothing deletes a shop today** — there is no delete path, and 041's append-only posture argues against one arriving casually — so this is a property of the design rather than a live defect. It becomes real the day offboarding lands (E15), and the offboarding record must say what happens to undrained rows before it deletes anything.

**R9. The person tables are not policied, and the reason is a transaction rather than a principle.** `app_user`, `user_authenticator` and its retirement, `recovery_code` and its use carry no `shop_id` and no policy (§7). A membership-EXISTS policy is expressible — §7 uses that exact shape elsewhere — but `grantInvitation` writes a membership and reads the person in ONE transaction, so a newcomer would be refused during the act of admitting them. What bounds them meanwhile is the module graph and every read being by the authenticated person's own id or by a digest. **E03-D21** (`longbox-e5b.3.31`) owns it — *"Put the person-scoped tables behind a database policy (EXISTS-membership OR service scope)"*, filed OPEN and blocked on this bead, because a residual with no owner is a residual nobody reads twice. Until it lands the honest statement is that this class is bounded by code, not by the database.

---

## 12. What this record hands to other beads

| Bead | What it inherits |
|---|---|
| **E13-B04.1** `longbox-e5b.13.4.1` | **The SCHEDULE and the T34 heartbeat only.** The QUERY is built here by the acting head's ruling (`pnpm audit:cross-tenant`, §1 E11, I16); what E13-B04.1 inherits is running it daily and paging when it stops running. **v1.1.0 said the bead's own note *"is corrected accordingly"*, which was not true when it was written.** It is true now, by a different route: the session wrote a `bd-sync` note on `longbox-e5b.13.4.1` on **2026-09-05**, at close-prep, recording that the bead owes the DAILY SCHEDULE and the T34 heartbeat rather than the query. **Its ACCEPTANCE text does not yet carry the schedule clause** — *"`audit:cross-tenant` runs daily under the schema-owner URL, emits a heartbeat, and a simulated hit pages as K1"* — which is to be added when the bead is claimed. |
| **E13-B03** | The outbox's per-shop drain and the smaller widening that replaces it if shops × ticks stops being negligible (§5.3). |
| **E13-B07** | Backup and restore: a restored dump gets the boundary from `pnpm migrate`, and the boot assertion is what proves it did (I11). |
| **E03-D11** `longbox-e5b.3.21` | The privileged session. The three MFA CLIs already declare the `second-factor` scope, so the routes inherit a correct context rather than needing one added. |
| **E03-D17** | The audited accessor module that gates who may run the owner-role CLIs (R2). |
| **E03-B10** | The independent security review closing G2. This record and its 43 lane cases in the two RLS files are its evidence for the third tenancy layer; **R1 and R4 are the two sentences it must not let anybody soften** — the boundary is not a defence against a compromised process, and the audit query is not proof that no tenant crossing occurred. |
| **E03-D19** `longbox-e5b.3.29` — **DISCHARGED 2026-09-05** | R7's schema change: `UNIQUE (id, shop_id)` on `scan_session` and the ten child foreign keys re-pointed at `(scan_session_id, shop_id)` — closing not merely the existence oracle the lens named, but the cross-tenant ATTACHMENT re-probing found (016 C46 probe 1). **Shipped as `migrations/034`**, with the ten constraints `ADD … NOT VALID` then `VALIDATE`d, the ten single-column edges they subsume dropped, and both halves asserted in `tests/integration/cross-tenant-audit.test.ts` — including that probe 1 and probe 2 now answer identically, field for field. §11 R7 carries the amendment; **R11 is the remainder it does not close** (the sibling edges), owned by **E03-D27** `longbox-e5b.3.37`. |
| **E03-D20** `longbox-e5b.3.30` | An amend-by-row to 000-docs/044 making `ENABLE ROW LEVEL SECURITY` a contracting shape the migration lint recognises, and recording the non-`CONCURRENTLY` index rule §9 states (K8/N2). |
| **E03-D21** `longbox-e5b.3.31` | R9: the person-scoped tables — `app_user`, `user_authenticator` and its retirement, `recovery_code` and its use — behind a database policy, either an EXISTS-membership predicate or a service scope, with the same-transaction admission problem §7 describes as the thing it has to solve rather than work around. |
| **E03-D22** `longbox-e5b.3.32` | **R10, and with it §6.3's `shop_shopify_domain_is_one_store` oracle.** *(Row added at v1.2.0. The line below asked for this bead; it exists, and this row names it so that a reader of §6.3 or §11 R10 lands on an id rather than on a request.)* The install claims the store's domain on `shop` inside the transaction that introduces the token version, which turns two concurrent callbacks into one winner and one `23505` and removes the one-bit oracle in the same statement. **It is NOT discharged by E03-D19**: a unique index over a client-choosable value is a different repair from a foreign key gaining a column. |
| **A bead this record ASKS FOR and does not file** *(v1.2.0: the R10 half is now **E03-D22** above; the sentence stays verbatim as the record of the ask)* | **R10**: the time-of-check-to-time-of-use window in the F8 domain-claim check, closed by making the install claim the store's domain on `shop` — the same change §6.3's unique index needs, and the same class as E03-D19. It is connector authority (053) rather than tenancy, so it belongs under E03 beside E03-D13 rather than inside this record's own follow-ups. |
| **E03-D27** `longbox-e5b.3.37` *(row added at v1.2.0 by E03-D19; the bead was filed by the session the same day, so this row names an id rather than a request — as E03-D22's row does for R10)* | **R11**: the **seven** SIBLING foreign keys into a session-scoped parent that are still single-column — `llm_rerank.candidate_set_id`, `media_deletion.scan_photo_id`, `shopify_draft.outbox_id`, `cost_log.outbox_id`, **`outbox_attempt.outbox_id`**, `listing_status_observation.shopify_draft_id`, `identity_resolution.human_confirmation_id`. (Six at v1.2.0; the seventh was reproduced by the re-verification at `a4d5563` and the list is now derived by query rather than by reading.) Each parent needs its own `UNIQUE (id, shop_id)` and each child its own composite edge; the work is `034` repeated per parent, and whether it is one migration or six is the scope judgement E03-D19 declined to make inside its own bead. Detection covers them meanwhile (`pnpm audit:cross-tenant` enumerates every one of them from the catalog), and the lane case that plants an `llm_rerank` is the pinned reproduction. The bead's own acceptance names the same shape `034` used: `UNIQUE (id, shop_id)` on each parent, `ADD NOT VALID` → `VALIDATE` → drop the old edge by shape, the planted probes flipped to refusing, and **R11 restated to discharged**. |
| **E15** (offboarding) | R8: what happens to a deleted shop's undrained outbox rows, decided before anything deletes a shop. |
| **E14-B03** `longbox-e5b.14.3` | The DB migration, RLS, concurrency and rollback test suites — the lane cases here are its starting point, not its completion. |

---

## 13. Alternatives considered

1. **Per-shop Postgres roles with `SET ROLE`** — §3.1(a). Rejected: onboarding becomes DDL, `SET ROLE` is sticky, and the pre-tenant reads are unexpressible.
2. **Application-side filtering only** — §3.1(b). Rejected: it is the defect, not the fix.
3. **`FORCE ROW LEVEL SECURITY` plus `BYPASSRLS` on the migrate role** — §4. Rejected: it needs a superuser on every cluster to grant an attribute that buys back exactly what `FORCE` took away, and it breaks every operator CLI on any cluster where somebody forgets.
4. **Exempting the pre-tenant identity tables from RLS instead of giving them a second policy** — §5.1. Rejected: it removes the boundary for the ordinary readers to serve the extraordinary ones.
5. **A cross-tenant outbox claim in a service scope** — §5.3. Rejected for v0, with the number that would reverse it named.
6. **A scope-keyed policy predicate instead of a scope-agnostic boolean** — **REJECTED at v1.0.0 AND TAKEN AT v1.1.0.** The original text rejected it as "a second authorization system living in SQL": if a scope may already read the table, keying the policy on WHICH scope only duplicates in the database a rule the module graph already enforces. The security lens falsified the premise rather than the reasoning — the boolean was `FOR ALL`, so it granted WRITES as well as reads, and the lens inserted an owner membership at another shop from inside a read-only scope. The rule the module graph enforces is about which FILE may name a scope; it says nothing about what a statement may do once inside one. The predicate is now keyed on the scopes each table declares, and the write half is a separate `FOR INSERT` policy on three tables (§5.0). Recorded as a reversal rather than rewritten, because a record that quietly deletes its own rejected option teaches nothing.
7. **A `longbox.service = on` boolean bypass with no named scopes** — rejected: an unnamed hatch cannot be counted, and §5.2's whole argument is that the exception is countable.
8. **A partial unique index enforcing one shop per Shopify store domain** — rejected in favour of a REFUSAL at install time (F8). A rotation legitimately leaves two live token versions for one shop (050 §2 Q2), so no unique index can say "at most one SHOP per domain" without also saying "at most one VERSION", and a constraint that has to be worked around is not a constraint. The check sits where the authority is created.
9. **Building the eighteen `shop_id` indexes `CONCURRENTLY`** — rejected for now, with the number that reverses it named: the first live shop row (§9, K8). A plain `CREATE INDEX` costs an `ACCESS EXCLUSIVE` lock that is free on an empty table and an outage on a populated one.
10. **Closing the FK cross-tenant attachment in this bead** — rejected as scope (R7, F5, 016 C46). It is a schema change over eleven tables with its own migration, its own rollback and its own lock profile, filed as **E03-D19** (`longbox-e5b.3.29`, OPEN, blocked on this bead) rather than folded into a bead already rewriting every policy. The interim position is honest and stated: the audit query DETECTS the shape, and detection is not prevention.
11. **Keeping `migrations/029`'s table list in sync with the module's** — rejected outright (F4/K6). The two had already drifted before anyone reviewed them, and the drift was invisible because only `pnpm migrate` ran both halves together. The migration now carries no list, and a contract test fails any migration that grows one.
12. **Making `tenant` a REQUIRED field on `TransactionOptions`** — rejected as a TYPE and adopted as a LINT (`pnpm arch`). The migrate-role callers own the schema and have no tenant to name; forcing them to invent one would teach authors that the field is ceremony. The lint asks the question only where the answer exists.

---

## 14. Consequences

**What gets better.** A handler bug can no longer return another shop's row. A report that joins one table too many returns nothing rather than everything. A restored dump that predates the boundary gets it on the next migrate run. The daily audit query T24 wants now has something to be a second opinion ABOUT.

**What gets worse, stated plainly.** Every test that writes a fixture as the application role must name the shop it is writing for — 32 integration suites changed to do so, and each one now reads like the running system. Two extra round trips per scoped read. A missing context fails as an empty result, which §6 shows is a genuinely new class of confusing bug: the two rules there exist because both of its shapes bit during this bead.

**What does not change.** Every query still carries its `shop_id` predicate; the policy is a second wall, not a replacement (§3.1(b)). The lock order is untouched (§3). The append-only triggers are untouched, and §6.2 records that a test which appeared to prove one was proving nothing until it was scoped.

**Deploy order and rollback, stated because this bead couples them.** `pnpm migrate` applies the migrations, then the row-level-security step, then re-applies the app-role grants — **the RLS step moved BEFORE the grants during the fold** (F6), because a `GRANT` handed out in the window before a policy exists is a window in which the application role reads every tenant. Any operator sequence that runs `pnpm grant-app-role` against a database whose policies have not been applied re-opens exactly that window; the boot assertion is what catches it, and it catches it by refusing to serve. **Rolling this bead BACK is not `DROP POLICY`**: the application code from this commit forward assumes a context is set, so a database with the policies removed and this code deployed is a system where every statement still carries its `SET LOCAL` and nothing enforces it — silent, not loud. The compatible rollback is to redeploy the previous application build first and drop the policies second, in that order. 044 §4's compatible-rollback rule covers the schema; this paragraph is the part it cannot express, and generalising it into 044 is the second half of **E03-D20** (`longbox-e5b.3.30`).

**The index builds belong in the same paragraph, and the consistency lens's own sentence is quoted rather than paraphrased** (K8):

> none use CONCURRENTLY, so on a populated production table this migration takes ACCESS EXCLUSIVE for the duration of the index build — fine for a pre-launch pilot, worth a line in 044 or the deploy runbook before the estate has real row counts.

The ruling in §9 declines to change the builds and agrees with every clause of that sentence: it is fine now because 034 §3.4's go-live posture puts the first real item behind G3, and *"worth a line in 044 or the deploy runbook"* is precisely what E03-D20 is for. What the lens called *"before the estate has real row counts"* is the trigger, and it is the same trigger §9 names.

---

## 15. Ratification

**RATIFIED at v1.1.2, 2026-09-05.** Signed by the acting head at close of E03-B04 with the merge SHA `a451de8aadb90a8304eea8304f61ac5c2e3fef73` (PR #90, 8/8 required checks; 1600 unit / 706+1 integration), after the `longbox-invariant-reviewer` re-verification at `ff55d6a` (PASS-WITH-NOTES, every cannon item CLOSED) and the `longbox-gate-auditor` re-audit whose six fact repairs are v1.1.1. The signature authenticates §3–§8 as decided, §2 as the lenses' own words, and §11/§14 as the honest residue; it does not shrink R1 and it does not settle E03-D19/D20/D21 or the R10 bead now filed as **E03-D22 `longbox-e5b.3.32`**. The paragraph below is the PROPOSED-era text, kept as history.

**UNSIGNED (as written at v1.1.1).** Both lenses are in and folded (§2); the `longbox-invariant-reviewer` verdict on the
code at `564f6eb` was **BLOCK** on one finding, which is fixed here (§4 item 4) and awaits its
re-audit; the `longbox-gate-auditor` verdict on this record was **NEEDS-OWNER-DECISION**, and the
one decision it asked for — whether T24's audit query belongs in this bead — was ruled by the
acting head and is built (§1 E11, R4, I16). **The acting head signs at close of E03-B04 with the
merge SHA**, after the re-audit. This record does not sign itself.

| Role | Name | Verdict | Date |
|---|---|---|---|
| Builder | `longbox-security-tenancy-builder` | drafted v1.0.0; folded v1.1.0 | 2026-09-05 |
| Security lens | `security-auditor` | **ACCEPT-WITH-CHANGES** (F1–F10; all folded or filed) | 2026-09-05 |
| Consistency lens | `martin-kleppmann-reviewer` | **ACCEPT-WITH-CHANGES** (K6 blocking, folded; K3–K5, K8, K9) | 2026-09-05 |
| Code audit | `longbox-invariant-reviewer` | **BLOCK** at `564f6eb`; fixed, re-audit pending | 2026-09-05 |
| Record audit | `longbox-gate-auditor` | **NEEDS-OWNER-DECISION** at `564f6eb`; ruled, re-audit pending | 2026-09-05 |
| Decision owner | Jeremy Longshore (acting head) | **SIGNED — RATIFIED at v1.1.2** against `a451de8` | — |
