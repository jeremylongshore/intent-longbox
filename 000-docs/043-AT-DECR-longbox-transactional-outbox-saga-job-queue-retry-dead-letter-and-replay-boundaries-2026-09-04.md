# Decision Record — The Transactional Outbox, the Event Catalogue, the Shopify Saga, the Job Queue, Retry, Dead-Lettering and the Replay Boundaries

**Version:** 1.2.0
**Status:** **RATIFIED 2026-09-04** by the acting head of board under Jeremy Longshore's 2026-09-03 delegation, after a two-lens cannon (`martin-kleppmann-reviewer`, `rich-hickey-reviewer`, both ACCEPT-WITH-CHANGES). Binding per §14. Amendments A1–A12 absorbed in full, none declined; **one draft decision was STRUCK** (`payload_hash`, A6) and **one draft mechanism was REPLACED by an invariant** (the ship-together instruction → A3's fail-closed guard); four dissents preserved in §14.
**Bead:** E02-B09 `longbox-e5b.2.9` (epic LBOX-E02 `longbox-e5b.2`, gate G2, evidence class DEC, owner-role eng, risk critical) — see 000-docs/014 §8 row E02-B09
**Drafted:** 2026-09-04 by `longbox-domain-builder` · **Cannon:** `martin-kleppmann-reviewer` + `rich-hickey-reviewer`, 2026-09-04 on `8579e70` — **both reproduced the code claims they leaned on** (E1, E2, E4, E7, E9, E11); **neither re-fetched Shopify's API reference, which A11 records rather than glosses** · **Audit:** `longbox-gate-auditor` before close · **Decision owner:** Jeremy Longshore
**Sensitivity:** Restricted internal (014 §10)
**Supersedes:** nothing — first record on delivery, jobs, retry, dead-lettering and replay. It **discharges** the half of 029 §11 (`029:704`) that 042 §9.2 Entry B left open — *"delivery semantics"* — and it **supersedes 029 §12** only on the day the outbox it specifies is running, never on the day this record ratifies (§12.3). It **executes 042 §7.4's assignment**: the event catalogue, the verb set and the naming rule are this record's, and §3 writes them.
**Inputs:** 014 §8 rows E02-B09, E02-B10, E02-D04, E05-B08, E10-B03, E10-B04, E10-B05, E10-B08, E10-B09, E12-B07, E13-B01, E13-B03, E13-B04, E13-B06, E14-B04 · 015 alias map · 018 v1.1.0 A3, C3 · 019 v1.2.0 **T7, T17, T19, T22, T23, T24, T34, T35, K1, K2, K4**, §3.0, §5 · 021 v1.3.0 B16, B17, B19 · 022 v1.1.1 P3, P6, P7, P8 · 023 v1.0.1 §3, §5 · 024 v1.0.0 §2 (artifact map), §3 (runtime topology) · 029 v1.2.0 §2.7, §2.8, §2.9, §2.10, §3.1, §5 move 8 note N2, §9, **§11 (`029:704`)**, **§12 in full (`029:712-743`)** · 033 §5.1, §5.3 · 034 v1.1.1 §3.1, §3.3 · 035 §pilot volumes · 036 v1.1.0 §2.4, §5.1, §5.2, §7.3, §13.1 · 037 v1.1.0 §1.1 · **040 v1.2.1 §4.4, §4.5, F1, F6, G-c, I4, §7** · **041 v1.1.2 §2.0, §2.1, §2.4, §2.5, §2.6, §4.1, §4.2, §4.4, §4.5, §5.3, §6.1–§6.4, §8.2, §8.4, §9.2, §10** · **042 v1.1.1 §4.2, §5.1–§5.3, §6.1, §7.1–§7.4, §8.3, §8.4, §9.1, §9.4, A2, A3, A5, A6, A7, A9, I17, I18** · `src/services/shopify.ts`, `src/routes/scanSessions.ts`, `src/services/costLog.ts`, `src/services/listingStatus.ts`, `src/services/appendOnlyDetector.ts`, `src/db/appendOnlyTables.ts`, `migrations/001_init.sql`, `migrations/005_listing_status_observation.sql`, `tests/JOURNEYS.md` · Shopify Admin GraphQL `productSet` reference and its `ProductSetIdentifiers` / `UniqueMetafieldValueInput` input objects (§4.3, fetched 2026-09-04) · CLAUDE.md locked decisions 3, 4, 5, 7.

## Change log

**Version convention** (006 `:6`, as used by 029/030/034/036/037/040/041/042): a **minor** bump means the content of a decision changed; a **patch** means a statement of fact was repaired with no decision changing.

| Version | Date | What changed | Authority |
|---|---|---|---|
| 1.0.0 | 2026-09-04 | Initial draft. **Status PROPOSED, §14 unsigned**, eight questions open in §13. **Drafted against `98e34e6` and re-derived at `17b98ab`:** both preconditions the draft cited as unmerged PRs — E02-D04's request transaction (#56) and E02-D06's role separation (#57) — **merged during drafting**, so E1, E2, E3, E4, E6 and E9 were re-run with their real output pasted, §7.3 and §9.1 record the shipments, and the six ⛔-blocked invariants became writable. **No finding changed; six sentences would have gone stale inside one merge**, which is the failure 042 v1.1.1's gate audit caught in that record. Seven decisions: the outbox as two append-only tables in the same database, written inside the request transaction, with **no mutable status column and no exemption** because the lease is *derived from the attempt log* rather than stored (§2); the draining order, the guarantees a consumer gets, and **the event catalogue 042 A2 struck and assigned here** — nine names derived from the pipeline's own appends, with `event_version` = the referenced row's `definition_version` (§3); the Shopify draft as a job, made replay-safe by `productSet`'s `identifier: { customId }` **upsert** rather than by a lease, with the not-left-`draft` guard that keeps an upsert from un-publishing a human's listing, and orphan reconciliation through the E10-B05 watcher — which is the E02-D04 obligation this bead was given (§4); append-only attempts, exponential backoff with jitter, a **PROVISIONAL** attempt ceiling under 042 A3's floors-are-not-facts rule, and dead-lettering as a terminal attempt kind with a T34 heartbeat filed as an E00-B03 candidate (§5); the replay boundaries — delivery always, the Shopify call only under §4.3's key, a witness row never — and why the outbox is **excluded from 041 §6.4's replay drill** (§6); one poller per process, `FOR UPDATE … SKIP LOCKED`, and two processes safe by construction (§7); and per-job cost logging plus the T22 story, whose honest form is that **today's ≤24 h RPO with no PITR (024 §2) is itself an argument for §4.3's idempotent key** (§8). | `longbox-domain-builder` |
| **1.1.0** | **2026-09-04** | **RATIFIED. Twelve amendments absorbed, none declined; one draft decision struck and one draft mechanism replaced.** **A1** (Kleppmann, REQUIRED) §2.4/§7.2 — the claim `SELECT … FOR UPDATE … SKIP LOCKED` and the `started` INSERT are **one transaction on one connection**, the lock releasing only after the `started` row commits; without it the lease derives from a log that does not yet mention the claim. I13 gains the overlapping-visibility-window property and §7.2 gains a correct/forbidden interleaving diagram — *the one place formality earns its keep.* **A2** (Kleppmann, REQUIRED) §3.2 — consumer idempotency is gated **at the registry**: a parametric contract test across every registered consumer plus a static lint on the `SELECT`-then-write shape, both E02-D07 acceptance lines. A rule proved against one hand-picked consumer is enforced by whoever remembers the example. **A3** (Kleppmann, REQUIRED, **the most costly**) §4.3 — the guard **FAILS CLOSED**. The draft refused a job when an observation said the listing had left `draft` and **passed when there were no observations at all**, which is today's state; the record covered that with an instruction that the guard and watcher not ship apart. *"An instruction is not an invariant."* Now: zero observations plus a prior `shopify_draft` ⇒ **REFUSED**, `reason_code='no_observation_evidence'`. I8 is rewritten with the empty-table case first, and **E02-D07 no longer needs E10-B05 to be safe, only to be useful.** **A4** (Kleppmann) §8.2 — **T22 bounds database recovery, not time-to-external-consistency**; that second figure is owed by E13-B07's drill and E13-B01/E10-B05's cadence, and filed as a T22 scope-note candidate for E00-B03. **A5** (Kleppmann) §5.4 — guard-refusal dead letters are reported **distinctly from the T17 aggregate**, because a guard working is not unreliability; **Q8 affirmed**. **A6** (Kleppmann + Hickey, REQUIRED) **`payload_hash` STRUCK** — the unique constraint already makes its case unconstructible, and *"a column that exists to catch a case the schema already makes impossible … is a place a future engineer will eventually repurpose."* **Q6 answered.** **A7** (Hickey) §2.4 — the timing assumption is named: `attempt_visibility` > worst-case clock skew, server-side `now()`, NTP beyond one host. **A8** (Hickey + Kleppmann, **Q3**) §2.6 — both witness reasons **kept and declared independent**. **A9** (Hickey, **Q2**) §2.2/§10 — the queue-library rejection is a **decision constrained by locked decision 4**, and I5/I13 must be **adversarial** because they stand in for the suite a library would have shipped. **A10** (Hickey, **Q5**) §3.4 — one table, one declared command, **ratified**; I3's failure message points at the argument; the catalogue is **authored, never generated**. **A11** (Kleppmann, unreproduced) §4.3 — **neither lens re-fetched Shopify's reference**, so the `customId` upsert's immediate consistency is an **assumption signed OPEN**, closed by a dev-store test before the saga serves a shop: **answered by measurement, not by citation.** **A12** — **Q1** answered *falsifiable now*, **Q7** accepted as drafted, implementing beads named and **E02-D07 created with its 015 row**. | Two-lens cannon → acting head, §14 |
| 1.1.1 | 2026-09-04 | Patch after the gate audit (statements of fact only, no decision changed): E6 and E10 re-derived at `f469d7d` — the negative greps now return prose comments PR #56 added, the named symbols still return nothing; I1's `routes:407` → `:467`; §11's two summary sentences re-derived to the table (one ⛔ I17; three ⚠ I10/I14/I20; three red-on-tree I1/I7/I19; I8 no longer conditional after A3). | acting head, from the `longbox-gate-auditor` report on main `f469d7d` |
| 1.1.2 | 2026-09-04 | Patch (statement of fact): §5.3's `job_max_attempts` arithmetic — six attempts with base 30 s and ceiling 30 min span ~15.5 min, not ~75; the ceiling never binds at six. The provisional value is unchanged; E02-D07's test asserts what the code does; the real value closes by measurement (O-A / E00-B03). Found by `longbox-domain-builder` while building E02-D07. | acting head |
| **1.2.0** | **2026-09-06** | **MINOR — E03-B08 `longbox-e5b.3.8` (000-docs/064) adds a TENTH event and NARROWS one exclusion rule. Every sentence below this row stays verbatim; the change lands as an amendment block in §3.3.** **(1) `longbox.platform.privacy_request_received` joins the catalogue.** Adding a name is ADDITIVE within v1 (§3.3's closing rule, from 042 §2.3) and would need no row — except that its MODULE segment is `platform`, and §3.3's exclusion paragraph says platform's tables *"publish to nobody who is not already inside it"*. **That sentence was written about the four RETENTION tables and it holds for them**: their consumer is platform's own sweep, which reads them as tables in the process that needs them. `privacy_request` differs on the axis the exclusion turns on — **its consumer is a JOB WHOSE REFUSAL MUST BE VISIBLE OUTSIDE the transaction that acknowledged the provider's message**, because a fail-closed guard inside an acknowledgement can only become a 500 (a retry storm, and eventually an app whose webhooks the provider disables — 053 §5.5's own hazard) or a silence. The rule is therefore narrowed to its actual criterion rather than left contradicted. **(2) §3.4's COUNT OF ONE IS UNCHANGED and is asserted afresh.** The new entry is REFERENCE-shaped: `privacy_request` is a committed witness row that exists before the event does, so 042 §7.1's re-read rule has something to protect. A second command-shaped event would still be a decision-record change and not a catalogue addition. **(3) `GUARD_REASON_CODES` gains a THIRD and a FOURTH member** — `customer_scope_was_granted` and `no_recorded_grant` — and `outbox_dead_letter.guard_refusal` covers both, on A5's ground exactly: a guard working is not unreliability, and counting either refusal in the 019 T17 aggregate would make a control look like a fault. **`REASON_CODES` additionally gains a NON-guard member**, `privacy_topic_not_auto_fulfillable`, and the split is the point: a job enqueued for a topic nothing answers automatically is a PRODUCER defect, so filing it as a guard refusal would put a false sentence in `outbox_dead_letter` (041 §8.2) and count a bug as a control doing its job. **(4) `privacy_request_fulfilment` produces NO event**, with a stated exclusion rule: it carries `operator_id`, and an event about it would carry an operator identifier out of the identity module onto a registry whose consumers are many (019 T35 non-waivable; 022 P3). **Nothing about §2's tables, §5's retry parameters, §6's replay boundaries or §7's claim changes.** | E03-B08 `longbox-e5b.3.8` → `longbox-security-tenancy-builder` |

## 0. Evidence posture

Per 018 A1/A3, and with 029 v1.0.0's gate-audit blocker B1 as the governing lesson — a "today" claim asserted at REPRODUCED on the strength of having read a file, later found false:

- **Every "today" claim in §1 is REPRODUCED at `17b98ab`** — `main`, the E02-D04 merge (PR #56) — each carrying a `file:line` **or** the verbatim command that produced it **with its exit status**. §1 prints the commands so a reader re-runs them rather than trusting the reading. **A rung is earned by the citation, not by the reading.**
- **A negative claim names the symbols that must return nothing, never "zero lines" alone.** This is 042 v1.1.1's lesson applied rather than repeated: two of that record's negative claims (E6, E7) were true when written and false one merge later, because a later commit introduced a name the grep covered. Every negative row below lists **the exact identifiers searched**, so a reader can tell a surviving finding from a stale sentence without re-deriving the argument. Where a grep returns matches that are not the thing being denied, the matches are printed and characterised (E3, E5, E9).
- **Everything in §2–§9 is ASSERTED.** No table, column, poller, job, attempt row, event name or line of code exists as a result of this record. Every invariant in §11 names a test file that does not exist. **This record writes no migration and no TypeScript.**
- **⚠ THE TWO PRECONDITIONS THIS RECORD WAS DRAFTED AGAINST BOTH SHIPPED DURING DRAFTING, and every claim they touch was re-derived rather than left standing.** §1 was first written at `98e34e6` and said, correctly at that moment, that **029 §12's request transaction did not exist** and that **role separation was pending**, each citing an open PR. Between the draft and the commit, **PR #56 merged as `17b98ab`** (E02-D04 `longbox-e5b.2.14` — `withTransaction`, `lockScanSession`, `insertShopifyDraft`, with the confirm and draft paths wrapped) and **PR #57 merged as `418c2de`** (E02-D06 — the `longbox_migrate` / `longbox_app` role split). **Both statements would have become false inside one merge**, which is precisely the failure 042 v1.1.1's gate audit found in that record's E6 and E7. So **E1, E2, E3, E4, E6 and E9 are re-derived at `17b98ab` with their real output pasted**, §7.3 and §9.1 record the two shipments, and **the six invariants the draft marked ⛔ blocked are unblocked**. What did **not** change is the finding: §1 E4's orphaned-draft window is live at `17b98ab`, and the merged code names it and assigns it to this bead in its own comment. **This record therefore has no blocking precondition. Its remaining conditionals are E10-B05's absent watcher and E02-B10's absent architecture gate**, and §11 marks each.
- **A third precondition shipped earlier.** 041 §10 row 0 — `ENABLE ALWAYS` on every append-only trigger plus the `pg_trigger` detector — landed at `3269573` as migration `006` with `src/db/appendOnlyTables.ts` as the declared list (042 §0, v1.1.1). So the two tables §2 adds join a set whose enforcement is real, and §7's five-minute detector has a working precedent to copy rather than a design to invent (`src/services/appendOnlyDetector.ts:169-190`).
- **No percentage appears in this record that is not a quoted 019 threshold.** 021 B16 forbids any 022 `control`, `contract` or `detector` line being spoken as an achievement, and 022 P6 (`022:65`) forbids *"probability language"* and *"a bare number pretending to be a grade"* on a screen. §5's backoff and §8's cost seam are stated as structure, never as a measured rate, and the two records that state the percentage rule at length — 042 §0 and 018 A3 — are cited rather than re-derived.
- **No number set in this record is a measurement.** The lines this record leans on — **T19** auto-publish incidents = 0, **non-waivable**, `any → K1`; **T22** RPO ≤24 h / RTO ≤4 h; **T23** lost/duplicated offline items = 0; **T17** draft success ≥99% excluding declared provider outage; **T34** detector liveness, **non-waivable**; **T35** per-operator rendering = 0, **non-waivable**; **T7** numeric grades = 0, **non-waivable**; **K1**, **K4** — are quoted from 019 v1.2.0 as 040 §0, 041 §0 and 042 §0 quote them, and are **never re-derived**. The three parameters §5 and §7 configure take **PROVISIONAL, explicitly non-evidentiary circuit-breaker defaults** under 042 A3's ruling — *"018 A3 caps claims of fact, not safety floors"* — each with its derivation stated.
- **This record is exposed to the objection that killed 042 §7's catalogue, and it says so rather than hoping nobody notices.** 042 A2 struck a generated event catalogue on the ground that *"a design fixed against zero running code is unfalsifiable"* and handed the catalogue **here**, *"written against a running outbox with at least one real consumer."* **There is still no running outbox** (§1 E1). What has changed is not that code exists — it is that **this record specifies the outbox and its first consumer in the same document**, so every name in §3 is answerable to a concrete producer (§2), a concrete drain (§7) and a concrete consumer (§4's Shopify job), and each can be wrong in a way §11 can catch. That is a weaker position than "written against running code" and a stronger one than 042's draft had. **The cannon was asked directly and ruled it sufficient (§13 Q1, A12): every name maps to a source table and every omission cites the rule that omits it, and I3 counts the set — so the catalogue can be shown wrong, which is the whole test.** The honest alternative — split this record and defer §3 again — is argued and rejected in §10 A2 rather than dismissed.
- **Ratification will not move anything up the ladder.** When §14 is signed it will record that a design was argued and adopted. It will not make any claim in §2–§9 true of any running system, and in particular it will not close the orphaned-draft window §1 E4 establishes, which is live today and stays live until E02-D07 ships.

## 1. What exists today (REPRODUCED at `17b98ab`)

| # | Claim | Evidence |
|---|---|---|
| **E1** | **There is no outbox, no queue, no worker, no dead-letter and no job of any kind — and the tree now names the missing thing in a comment.** `grep -rniE 'outbox\|dead.?letter\|\bdlq\b\|job_queue\|\bworker\b\|SKIP LOCKED\|enqueue\|dequeue' --include=*.ts --include=*.sql --include=*.js src migrations public scripts tests` returns **one line, exit 0**, and it is not an implementation: `src/routes/scanSessions.ts:464`, a comment reading *"the reconciliation is **E02-B09's transactional outbox** (041:788), which owns it"* — PR #56 assigning this bead's deliverable by name. `grep -rniE 'CREATE TABLE[^;]*outbox' migrations` returns **zero lines, exit 1**. **The symbols that must return nothing, and do:** `dead_letter`, `dlq`, `job_queue`, `worker`, `SKIP LOCKED`, `enqueue`, `dequeue` appear nowhere in any casing, and `outbox` appears only in that comment. 029 `:52` still states it in prose: *"There is no event bus, no outbox and no publish call anywhere in this repository today."* *(Written at `98e34e6` as "zero lines, exit 1" — true then, false one merge later. The finding is unchanged and better sourced: the absence is now recorded in the tree rather than merely true.)* | grep, one match, characterised; `src/routes/scanSessions.ts:464`; `CREATE TABLE` grep exit 1; `029:52` |
| **E2** | **029 §12's request transaction EXISTS, for the first time in five records.** 040 §0 recorded its absence at `aa448bb`, 041 §0 at `12470b3`, 042 §0 at `b72033f`, and this record's own draft at `98e34e6`. **At `17b98ab` it is there**: `withTransaction` at `src/db.ts:105` delegating to `withTransactionResult` at `:121`, one `pg.PoolClient` held for the call's lifetime, `BEGIN` / `COMMIT` / `ROLLBACK` at `:145`, `:147`, `:152`, and retry on `40001` / `40P01` only (`:38`, `:136`). **Two paths are wrapped** — `POST …/confirm` at `src/routes/scanSessions.ts:266` and `POST …/draft` at `:482`, each taking `lockScanSession` as the first statement inside `fn` (`:269`, `:485`) — and **four are deliberately not, with the omission written down as a decision** at `:93-104`. **So §2's "inside the request transaction" is now a claim about running code, and the six invariants this record's draft marked ⛔ are unblocked.** | `src/db.ts:38`, `:105`, `:121`, `:136`, `:145`, `:147`, `:152`; `src/routes/scanSessions.ts:93-104`, `:266`, `:269`, `:482`, `:485` |
| **E3** | **029 §2.7's owed relocation is half done: the `shopify_draft` INSERT left the route; the Shopify call did not.** The INSERT is now `insertShopifyDraft` in `src/services/scanSession.ts:200`, called on the transaction handle (`routes:487`), and `grep -n 'db.query' src/routes/scanSessions.ts` returns **four** lines (`:65`, `:73`, `:128`, `:325`), down from eight at `98e34e6`. **But `client.createDraft(draftInput)` is still executed by the route handler**, at `src/routes/scanSessions.ts:467`. 029 §2.7 (`029:152`) asks for both halves — *"The `shopify_draft` insert and the whole draft-creation block are **in the route** … and must genuinely move here"* — and **the provider call is the half still outstanding**, which §4.1 and §9.1 row 4 finally land. | `src/services/scanSession.ts:200`; `routes:467`, `:487`; grep, four matches; `029:152` |
| **E4** | **A Shopify DRAFT can exist with no `shopify_draft` row, at `17b98ab`, and the merged code says so in its own words and assigns it here.** `createDraft` is called at `src/routes/scanSessions.ts:467`, **outside and before** the `withTransaction` that opens at `:482`; inside it, `lockScanSession` returning undefined produces a 404 (`:485-486`, `:499`) with the Shopify product already created, and any throw between does the same. The comment immediately above the call (`:456-466`) states the whole finding without this record having to argue it: *"if this call SUCCEEDS and the transaction below then fails … a real DRAFT product exists in Shopify with NO `shopify_draft` row recording it. A Shopify mutation cannot join a Postgres transaction, so no arrangement of this code closes it … the reconciliation is **E02-B09's transactional outbox** … which owns it. The window is not introduced here — before this change the same gap sat between the INSERT and the status write, and was wider."* **The ordering is required, not chosen** — 041 §4.1: *"`fn` performs no side effect outside the transaction. No provider call, no Shopify mutation, no file write."* **This is the unavoidable consequence of a correct rule, and closing it is this record's job.** | `routes:456-466`, `:467`, `:482`, `:485-486`, `:499`; `041 §4.1`; the bead's own 2026-09-04 note |
| **E5** | **Nothing publishes an event, and the only scheduled work in the tree is a detector.** `grep -rniE 'publishEvent\|emitEvent\|eventBus\|\bpublish\(' --include=*.ts src` returns **zero lines, exit 1**. `grep -rniE 'setInterval\|setTimeout\|cron\|schedule' --include=*.ts src scripts` returns **four lines, exit 0, and none is a job runner**: `src/server.ts:5` and `:26` wire `scheduleAppendOnlyCheck`, and `src/services/appendOnlyDetector.ts:169`, `:174` define it — 041 §9.2 item 3's five-minute trigger detector. **The symbols that must return nothing, and do:** `publishEvent`, `emitEvent`, `eventBus`, `publish(` appear nowhere. **What the four matches give this record is a precedent, not a contradiction**: an unref'd `setInterval` started from `src/server.ts`, with a stop function returned, is exactly §7's poller shape, already in the tree and already tested. | two greps; `src/server.ts:5`, `:26`; `src/services/appendOnlyDetector.ts:169-190` |
| **E6** | **A retry now exists, and it is the wrong kind of retry — deliberately, and by a ratified rule.** `grep -rniE 'retry\|retries\|backoff\|jitter' --include=*.ts src` returns matches, **and every one but a comment is in `src/db.ts`** (the exception is `src/routes/scanSessions.ts:454`, prose PR #56 added — re-derived at `f469d7d`): `RETRYABLE_SQLSTATES = new Set(["40001", "40P01"])` (`:38`), plus the loop and its counting (`:60`, `:136-155`). **041 §4.5 scopes it to those two SQLSTATEs *"and on nothing else"***, so it is a database-conflict retry and is explicitly not a delivery retry. **The symbols that must return nothing, and do:** `backoff`, `jitter`, `dead_letter`, `attempt_no` appear nowhere in `src/`. So a failed `createDraft` still returns `{ok:false}` (`src/services/shopify.ts:73`, `:79`, `:81`, `:83`), `insertShopifyDraft` still records `status='failed'` with the error as jsonb (`routes:487-493`), the route returns 502 — **and nothing ever tries again.** The operator's only recovery is to press the button, which today produces a *second* Shopify product (E7). *(Written at `98e34e6` as "zero lines, exit 1" for both greps; re-derived here. The finding is unchanged and sharper: retry infrastructure now exists and is correctly scoped away from this problem.)* | grep, all matches in `src/db.ts:38`, `:60`, `:136-155`; the `backoff\|jitter` half exit 1; `src/services/shopify.ts:73-84`; `routes:487-493`; 041 §4.5 |
| **E7** | **`productSet` is called with no identifier, so every call creates a new product.** `grep -rniE 'identifier\|customId\|handle' --include=*.ts src/services/shopify.ts` returns **zero lines, exit 1**. `buildProductSetInput` (`shopify.ts:23-40`) emits `{ input: { title, descriptionHtml, status: "DRAFT", productType, variants, productOptions, files } }` and the mutation document (`shopify.ts:12-17`) is `mutation productSet($input: ProductSetInput!)` — **one variable, no `$identifier`**. **The symbols that must return nothing, and do:** `identifier`, `customId`, `handle`. Shopify's `productSet` accepts an `identifier` argument of type `ProductSetIdentifiers` whose fields are `customId`, `handle` and `id` (§4.3, fetched 2026-09-04); **the tree uses none of them**, which is precisely why a retry duplicates. | grep, exit 1; `src/services/shopify.ts:12-17`, `:23-40` |
| **E8** | **`listing_status_observation` exists and has no producer.** Migration `005_listing_status_observation.sql` created it, `src/db/appendOnlyTables.ts:105-107` declares it in the append-only set, and `src/services/listingStatus.ts:105` is the only `INSERT` — but `grep -rn 'recordListingStatus\|listingStatus' --include=*.ts src/routes src/server.ts` finds no caller: **no webhook route, no poller, no watcher entrypoint exists.** 040 §4.4 gives the T19 watcher this table to write and 040 `:694` assigns the watcher itself to **E10-B05**. So §4.5's orphan reconciliation is specified against a table that exists and a writer that does not. | `migrations/005_listing_status_observation.sql`; `src/db/appendOnlyTables.ts:105-107`; `src/services/listingStatus.ts:105`, `:139`; `040:694` |
| **E9** | **No request or job carries a correlation id or an idempotency key, and `request_idempotency` is still declared-and-not-built.** `grep -rniE 'correlation_id\|request_id\|idempotency' --include=*.ts src` returns **eight lines, exit 0, and not one is an implementation**: `src/db/appendOnlyTables.ts:214` (the exemption row for `request_idempotency`, `pending: true`, whose reason says *"Does not exist yet"*) and seven comments PR #56 added to `src/routes/scanSessions.ts` (`:106`, `:110`, `:114`, `:116`, `:261`, `:262`, `:480`) recording where 042's idempotency INSERT will go — one of which says it outright: *"There is no idempotency row to insert yet."* **The symbols that must return nothing, and do:** `correlation_id`, `request_id`, `Idempotency-Key`, `idempotencyKey` appear nowhere in any casing. This is 042 §1 E6/E7 surviving two merges, and it matters here for one specific reason: **§3's envelope carries `correlation_id`, so an event emitted today would carry a field the producing request does not have.** §9.3 states the ordering that follows. | grep, eight matches, all characterised; `src/db/appendOnlyTables.ts:214`; `routes:106`, `:110`, `:114`, `:116`, `:261-262`, `:480` |
| **E10** | **There is no reconciliation and no orphan concept.** `grep -rniE 'reconcil\|orphan' --include=*.ts --include=*.sql src migrations` returns **two lines, both prose** (`src/routes/scanSessions.ts:463`, `src/db.ts:50` — comments PR #56 added; re-derived at `f469d7d`). **The symbols that must return nothing, and do:** `reconcile`, `orphan`. 036 §5.3 specifies a daily T18 reconciliation in SQL and 036 §13.2 (`036:779`) reserves the cadence to E10-B05/B08; nothing is built, and **no query anywhere asks Shopify what it holds.** | grep, exit 1; `036 §5.3` |
| **E11** | **`shopify_draft` has no idempotency key, no attempt count and no job reference**, and `cost_log` has no job dimension. `migrations/001_init.sql:147-155` is `shopify_draft(id, scan_session_id, shop_id, product_gid, status CHECK IN ('draft','published','failed'), error jsonb, created_at)`; `:158-168` is `cost_log(id, shop_id, scan_session_id, provider, model, tokens_in, tokens_out, estimated_usd, created_at)`. **So "which attempt produced this row" and "what did this job cost" are both unanswerable by construction**, and `appendCostLog` (`src/services/costLog.ts:5-23`) takes a `pg.Pool` rather than a transaction handle, so a cost row cannot commit with the fact it describes. | `migrations/001_init.sql:147-155`, `:158-168`; `src/services/costLog.ts:5-23` |
| **E12** | **There is no PITR, and the estate backup is the only thing standing between a crash and lost state.** 024 §2's artifact map says it in the row for every Postgres artifact: backup today is *"estate borg; **no PITR**"*, with *"PITR + nightly logical dump; restore drill"* listed as **planned** and owned by **E13-B07**; 024 §3's DB tier repeats it — *"same, with RLS (E03-B04), PITR (E13-B07)"*. 019 **T22** signs RPO ≤24 h / RTO ≤4 h, measured by a restore drill, at **G3**. **A restore that rewinds the database by up to a day cannot rewind Shopify**, and §8.2 is the consequence. | `024 §2` (three rows), `024 §3`; `019` T22 row |

**What §1 adds up to.** Longbox makes an irreversible external call from inside an HTTP handler and writes the record of it afterwards, with nothing binding the two. Every property that would make that safe is absent: there is **no outbox**, so there is no record that an effect was *intended* before it was *attempted* (E1); there is **no transaction** on `main`, so the record and the state change are two independent writes (E2, E3); there is **no retry**, so a transient Shopify failure is a dead end an operator resolves by creating a duplicate (E6); there is **no identifier on the mutation**, so that duplicate is a genuinely new product rather than an upsert (E7); there is **no watcher**, so nobody ever asks Shopify what it holds (E8, E10); and there is **no PITR**, so a restore reintroduces work whose effects already happened (E12).

**The through-line, and it is not 040's, 041's or 042's.** Those three records are about what the system *records*: 040 stopped it keeping a lossy second copy of a fact, 041 made the log say who wrote each row and against what, 042 made the boundary refuse to leak what the log protects. **All three are about writes Longbox controls. This record is about the one write it does not** — a `productSet` mutation on someone else's server, which cannot be rolled back, cannot be locked, and does not care what Longbox's transaction did afterwards. 041 §4.1's rule that a provider call never runs inside `fn` is correct and it is precisely what creates the gap: **the moment you forbid the external call from joining the transaction, you have two systems that can disagree, and the only remaining question is whether the disagreement is recorded and repaired or silent and permanent.** E02-B09 is the decision that it is recorded and repaired.

## 2. Decision A — The outbox: two append-only tables, in the same database, written inside the request transaction

### 2.1 The rule

> **An effect that leaves Longbox is never performed by the request that decides it. The request appends an `outbox` row inside its own transaction — the same transaction as the fact that justifies the effect — and commits. A poller in the same process claims the row later and performs the effect. Every attempt to perform it appends an `outbox_attempt` row. Both tables are append-only, both join 041 §9.2's declared trigger set, and neither carries a mutable status column.**

The property this buys is the one 029 §12.1 point 4 states for the request transaction and cannot state for an external call: **the database's record of what should happen and the fact that justifies it commit together or not at all.** If the request rolls back, there is no outbox row and no effect. If the request commits, the intent is durable, and the effect is owed — not maybe-sent, not sent-and-unrecorded, but *owed*, with a row saying so.

### 2.2 One table in the same database, not a broker — and when a broker earns its place

Three constructions were available.

**(a) A table in the same Postgres database, written in the same transaction.** Adopted.
**(b) A message broker — Redis Streams, SQS, NATS, RabbitMQ — written after commit.** Rejected for v0.
**(c) A queue library on Postgres — pg-boss, graphile-worker.** Rejected for v0, and it is the closest call.

**(b) fails on the one property the whole design exists for.** A broker is a second store, so writing to it is a second commit, and there is no transaction spanning Postgres and a broker. Whatever you do, one of two things is possible: the row commits and the message is lost, or the message is sent and the row rolls back. **That is exactly the divergence §1 E4 describes, moved one layer down and made harder to see** — the outbox pattern exists precisely because a broker cannot be enrolled in the database's transaction. Adding a broker *and* an outbox is a real architecture; adding a broker *instead of* one is the bug.

**(c) is rejected as a DECISION constrained by a locked decision, not as a preference (A9, Hickey 5; §13 Q2 answered).** The draft called this ground "weaker" and put it to the cannon on the suspicion that it was taste wearing an argument's clothes. **It is not.** Locked decision 4 makes the append-only model non-negotiable and 041 §9.2 makes the declared trigger set its sole enforcement; **a library whose job schema is mutable by design, lives outside `migrations/`, and is versioned by someone else's release cadence cannot be brought inside that set at all.** The rejection follows from a constraint the project has already signed, and calling it a preference would have understated it. `pg-boss` and `graphile-worker` are transactional-outbox implementations on Postgres and would work. What they cost here is the thing this project is unusually strict about: **they own their own schema, on their own migration schedule, outside `migrations/`, outside 041 §9.2's declared trigger set, and outside the append-only model that locked decision 4 makes non-negotiable.** A library's job table is mutable by design — it updates a state column, deletes on completion, and reaps by timestamp — and 041 §9.2's detector would either flag it forever or need a permanent exemption for a schema nobody in this repository controls. The gain is a few hundred lines; the cost is a hole in the one invariant the project will not trade.

**What the rejection costs, and the obligation it creates (A9).** A hardened library ships a concurrency test suite that this record does not get for free, and *"we hand-rolled a queue"* is a sentence that has aged badly in many other projects. **§11 I5 and I13 stand in for that suite, and they are therefore required to be ADVERSARIAL rather than run-twice-assert-once**: crash mid-attempt, two pollers racing one row, a poller that dies after claiming and before its terminal write. A test that merely calls the handler twice and asserts one row would leave this decision unpaid for.

**When a broker becomes worth it — stated now so it is a threshold rather than a taste.** The outbox in a table is right while **all** of the following hold, and the day any one fails, E13-B03 revisits it with a measurement rather than a preference:

1. **One process drains it.** Multi-process fan-out is handled by §7's `SKIP LOCKED` and stays correct, but the moment ordering across processes matters, or the poll interval becomes a latency problem, a broker's push semantics start earning their keep.
2. **The drain rate is bounded by the pilot's item rate.** 035's largest batch is Pilot C's ≥300 items, and 042 §8.4's compressed ceiling is ≈75 items/hour for a whole shop. **A poller that wakes on an interval is over-provisioned for that by orders of magnitude** — a direction, not a measurement (042 A10's discipline).
3. **Every consumer is in-process.** A consumer in another service needs a transport, and at that point the outbox becomes the *source* that feeds one rather than a substitute for it.
4. **Postgres is not the bottleneck.** A queue table's contention is a measured thing, and 041 §7's O-A benchmark is the instrument that would say so.

That list is the honest version of "we'll add Kafka later": it names what would have to be true, so a future reader can check rather than argue.

### 2.3 The two tables

**Nothing here is written and no migration number is claimed** — 041 §10's rule, learned twice: *"A file number is claimed when the file is written, never reserved in prose."*

```
outbox(
  id                uuid PK DEFAULT gen_random_uuid(),
  shop_id           uuid NOT NULL REFERENCES shop(id),          -- locked decision 4
  scan_session_id   uuid REFERENCES scan_session(id),           -- NULL only for a shop-scoped effect with no session
  session_seq       bigint,                                     -- 041 §5.3; NULL where the session lock was not held
  event             text NOT NULL,                              -- §3.3's catalogue
  ref_table         text NOT NULL,                              -- §3.1; the committed row this event references
  ref_id            uuid NOT NULL,
  definition_version text,                                      -- 041 §2.4; the event's ONLY version (042 §7.3)
  correlation_id    uuid,                                       -- 042 §4.7; NULL until E02-B08 ships one (E9)
  occurred_at       timestamptz,                                -- 041 §2.5 observed_at, on the wire as occurred_at
  authored_by       text NOT NULL CHECK (authored_by IN ('human','system','provider')),   -- 041 §2.3
  operator_id       uuid REFERENCES app_user(id),
  actor_verified    boolean NOT NULL DEFAULT false,
  actor_role        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shop_id, event, ref_table, ref_id)                    -- §2.4
)

outbox_attempt(
  id           uuid PK DEFAULT gen_random_uuid(),
  shop_id      uuid NOT NULL REFERENCES shop(id),
  outbox_id    uuid NOT NULL REFERENCES outbox(id),
  attempt_no   integer NOT NULL CHECK (attempt_no >= 1),
  kind         text NOT NULL CHECK (kind IN ('started','delivered','failed','dead_lettered','replay_requested')),
  detail       jsonb,                                           -- §2.5: references and codes, never values
  operator_id  uuid REFERENCES app_user(id),                    -- §6.3: a replay names a person
  reason       text,                                            -- §6.3: a replay states why
  authored_by  text NOT NULL CHECK (authored_by IN ('human','system','provider')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (outbox_id, attempt_no, kind)
)
```

`shop_id` is on both because locked decision 4 requires it on every shop-scoped table even in a single-tenant v0, and because §7's claim query filters on it for the fairness E13-B03 will need. The envelope columns are 041 §2.1's, **spelled out on each table rather than inherited** — 041 §2.2's decision, which this record follows without re-arguing.

### 2.4 There is no status column, and there is no exemption, because the lease is derived

The obvious design gives `outbox` a `status text` and a `claimed_at timestamptz`, updates them as the row moves, and reaps stale claims by timestamp. **That column is not built**, and the argument is 041 §4.2(i)'s preference order plus one observation the draft nearly missed.

**The precedent that was available and is declined.** 042 §5.2 makes `request_idempotency` a **declared mutable exemption** — a row on 041 §9.2's list, `kind: permanent`, with three stated reasons — and it would be entirely consistent to do the same here. That is the alternative, and it is a good one (§10 A3). It is declined because **the exemption is not needed**, and 041 §9.2's own framing is why: an exemption is for a table that is *correct* and would look wrong without a reason. An outbox with a mutable status column is not correct-but-odd; **it is a second, lossy copy of a history that the attempt rows already hold in full** — which is 040's entire argument against `scan_session.status`, one bead later and one table over. A status column that says `failed` cannot say *how many times*, *when*, *why*, or *whether a human asked for the last one*. The attempt log says all four.

**The mechanical objection, and the answer.** A poller needs three things from a row before it claims it: *is it terminal*, *is someone else working it*, and *is it due*. All three are **derivable from `outbox_attempt`**, which means the lease is a computation and not a stored fact:

| Question | Derivation |
|---|---|
| **Terminal?** | an attempt row exists with `kind ∈ {delivered, dead_lettered}` |
| **In flight?** | the newest attempt is `kind='started'` **and** its `created_at` is within `attempt_visibility` (§5.4) |
| **Due?** | `now() >= last_failed.created_at + backoff(attempt_no)` (§5.2) |

> **Decision: eligibility is a predicate over `outbox_attempt`, evaluated inside the claim transaction under `FOR UPDATE … SKIP LOCKED` on the `outbox` row. There is no `status`, no `claimed_at`, no lease column, and no reaper. A crashed worker's row becomes eligible again when its `started` attempt ages past `attempt_visibility` — which is not a reaper repairing state, it is a predicate whose inputs changed.**

**The atomicity boundary, stated because the design is unsound without it (A1, Kleppmann 1, REQUIRED).** The draft described the claim and the `started` write as two steps and never said whether they were one atomic act. They are:

> **The `SELECT … FOR UPDATE … SKIP LOCKED` and the `started` `outbox_attempt` INSERT execute on ONE connection inside ONE transaction. The row lock is released only when that transaction commits — which is to say, only after the `started` row is durable.**

Without that, there is a window between "I hold the lock" and "the log says I hold it" in which the lock has been released and no `started` row exists, and a second claimer sees a row that is not terminal, not in flight and due — and takes it. **The design's whole claim is that the lease is derived from the log; a lock released before the log records it is a lease derived from nothing.** §7.2 draws the interleaving, and §11 I13 asserts the property that follows: **under concurrent claimers, no two `started` rows for one `outbox_id` can have overlapping visibility windows.**

**The timing assumption, named rather than assumed (A7, Hickey 1).** The *in flight* predicate compares a stored `created_at` against `now()`, so it is correct **only while `attempt_visibility` exceeds the worst-case clock skew across every host that runs a worker**. Two rules follow and both are E02-D07 acceptance lines: **every timestamp in this design is server-side — `now()` evaluated inside the claim transaction, never a client or worker wall-clock** — and **beyond a single host, NTP or a monotonic source is a requirement, not an operational nicety.** One host makes the assumption vacuous today; E13-B03's second worker is what makes it load-bearing, and it should not discover this sentence for itself.

**This is Hickey's move and it is worth naming as such**, because it is the same one 040 made and the same one 041 §5.3 made: a stale claim is not corrupt state that something must clean up; **it is a fact about the past that stops satisfying a predicate about the present.** Nothing has to notice. Nothing has to run. There is no window in which a reaper has not yet fired.

**What it costs, stated.** The predicate is more expensive than `WHERE status='pending'` — it is a `NOT EXISTS` and a `DISTINCT ON` over a child table rather than an index scan on a column. At the pilot's volumes that is not a consideration (§2.2 point 2), and the index E02-B10 owns is named in §9.1. **At a volume where it becomes one, the correct response is a materialized index over the log — 041 §6.2's first form, keys only, maintained in the same transaction — not a status column.** 041 §6.3's four conditions govern it, and the measurement is condition 1. Stating the escape hatch here is what stops a future engineer reaching for the column under load.

### 2.5 What an outbox row carries, and what it must never carry

> **A row carries a reference and an envelope. It never carries the referenced row's values.**

This is 042 §7.1 applied to the producer's own storage rather than only to the wire, and the three reasons transfer intact: a copy is a second source of truth (locked decision 4; 041 §6.4); a copy is un-purgeable (041 §8 destroys bytes and appends a tombstone — an outbox row holding a purged photo's metadata is a copy of purged content sitting outside the purge path); and a copy ages while the row it copied is corrected by supersession (041 §3).

**`payload_hash` was in the draft and is STRUCK at ratification (A6, Kleppmann 6 + Hickey 7; §13 Q6 answered).** It was to be a SHA-256 over the reference and the envelope, whose only job was to detect the same event enqueued twice with different envelopes. **`UNIQUE (shop_id, event, ref_table, ref_id)` already makes that case unconstructible**, so the column existed to catch something the schema forbids. Hickey's objection is the one that decides it and it generalises past this column: *"a column that exists to catch a case the schema already makes impossible is not neutral — it is a place a future engineer will eventually repurpose."* **If a backfill-with-`ON CONFLICT` path ever creates a genuine envelope-drift question, that is a new decision record, not a column reserved in advance.**

**`outbox_attempt.detail` is structured and bounded.** It holds an HTTP status, a provider error *code*, a reference id, a duration. **It never holds a response body, a provider's exception message, an operator name or any shop content** — 042 §4.3's rule that the server emits no operator prose, applied to a table instead of a wire, plus 022 P8 (cost stays in `cost_log`) and 019 T35. §11 I6 asserts it.

### 2.6 The outbox is a witness, not a derivation — and this is the sharpest question in the record

041 §6.4 forbids a derived artifact from being the only place a fact lives, and 041 §2.6 defines replayable: *"it can be dropped entirely and recomputed from the witness tables plus its own `definition_version`, with no other input."* **Is an `outbox` row derivable?** The uncomfortable answer is *nearly*. §3.3's catalogue is a function of the witness tables — one `confirmation_recorded` per `human_confirmation` row — so in principle a rebuild could regenerate the whole set.

**It is kept anyway, and in the append-only set rather than the exemption list, for two reasons that are INDEPENDENT (A8, Hickey 2 + Kleppmann; §13 Q3 answered).** The draft called reason 1 the weaker one and asked whether it should be struck. **The ruling is to keep both and to say why they are not redundant**: reason 2 is sufficient *today*, and reason 1 is what remains if the `outbox_attempt` → `outbox` foreign key ever changes shape. A record that keeps only the currently-decisive reason has to re-derive the other one the day the structure moves.

1. **It records intent at a moment.** `definition_version`, `correlation_id` and `occurred_at` are captured **as of the enqueue**. A regenerated row would carry today's answers to yesterday's question — the same defect 041 §5.3 names when it refuses to backfill `session_seq`, because *"a reconstructed sequence would be a fabricated observation about what order things happened in."*
2. **`outbox_attempt` FKs to it, and the attempts are not derivable by anything.** What happened when Longbox tried to reach Shopify exists nowhere else in the universe. A dropped-and-rebuilt `outbox` would orphan every attempt or renumber every id, and **an append-only child cannot be repointed.** So the parent is as durable as the child, by construction.

> **Decision: `outbox` and `outbox_attempt` both join 041 §9.2's declared append-only trigger set, and both are EXCLUDED from 041 §6.4's replay drill as a declared row with this reason.** §11 I2 asserts the exclusion is declared rather than merely observed — 041 §9.2's *"Exemptions are rows on the list with a reason, never absences"*, applied to a second list.

**Q3 is answered above (A8): both reasons stand, independently.** Reason 2 carries the decision now; reason 1 is the load-bearing one under a future schema in which it does not.

## 3. Decision B — Draining order, the guarantee a consumer gets, and the event catalogue

### 3.1 An event is a reference plus 041's envelope

Unchanged from 042 §7.1, which this record does not reopen: the wire shape is `{shop_id, scan_session_id, session_seq, ref: {table, id}, definition_version, occurred_at, recorded_at, correlation_id}` plus the event's name. **§2.3's `outbox` row is that envelope in a table**, one column per field, which is 041 §2.2's specification-not-payload rule holding at the producer.

### 3.2 What a consumer may rely on, and what the drain order confers

> **Within one `scan_session`, events are delivered in `session_seq` order. Across sessions, across shops and across time, nothing orders anything. Delivery is at-least-once. Every consumer is idempotent on `(event, ref.id)`, including under concurrent delivery of two copies of one event.**

That is 042 §7.2 verbatim, and this record's contribution is to state the producer-side facts that make it true and to refuse to state any more.

**The poller drains by `outbox.id`, and that confers nothing (042 A7, discharged).** 042 §9.4 put this on E02-B09 as an obligation so it would not be re-derived here, and here is the discharge:

> **The drain order is an implementation detail of §7's claim query. A consumer that observes it and depends on it has depended on nothing this record promises.** In particular, `SKIP LOCKED` means the drain order is *not even the claim order* under concurrency: worker A skips a row worker B holds and takes a later one, so two rows enqueued in one order can be delivered in the reverse. The only ordering guaranteed is the one above, and it holds because `session_seq` is assigned under the session lock (041 §5.3) and the poller sorts by it within a session — not because rows come out of a table in the order they went in.

**Concurrent duplicate delivery is the case that must be constructed, not reasoned about (042 A7's second half).** At-least-once plus `SKIP LOCKED` plus §5.4's visibility timeout means two workers can process two deliveries of one event **at the same time**, not merely one after the other. A consumer that is idempotent by *checking then writing* is not idempotent under that interleaving; a consumer that is idempotent by *a unique constraint* is. So:

> **A consumer's idempotency is enforced by a database constraint or by a provider-side natural key, never by a read-then-write check.** §4.3 is the provider-side case and §11 I5 constructs the concurrent one.

**And the gate is at the REGISTRY, not at one hand-picked consumer (A2, Kleppmann 2, REQUIRED).** The draft's I5 constructed the concurrent duplicate against *a* consumer, which proves that consumer and says nothing about the next one somebody writes. A rule enforced by one example is a rule enforced by whoever remembers the example. So, as **E02-D07 acceptance lines**:

> **(a) A parametric contract test iterates the consumer registry and constructs the concurrent-duplicate delivery against EVERY registered consumer.** Registering a consumer enrolls it in the test; there is no way to add one and not be tested, which is the property a per-instance test cannot have.
>
> **(b) A static lint flags any consumer handler that `SELECT`s a table and then `INSERT`s or `UPDATE`s that same table without an `ON CONFLICT` clause** — the read-then-write shape, caught at the source rather than inferred from a failing race. It is the same posture 042 I22 takes toward lock order: **a rule whose violation is otherwise an intermittent failure gets a lint, not a review comment.**

This is the same construction 041 §9.2 item 4 uses for the trigger set — one declared list, several readers, equality asserted — applied to consumers instead of tables.

**Exactly-once is not offered and cannot be**, which 042 §7.2 already says and 019 T23's signed zero does not contradict: T23 counts *lost or duplicated items*, and a duplicate *delivery* that a constraint absorbs produces no duplicate *item*.

### 3.3 The catalogue — nine names, derived from what the pipeline actually appends

**This is the section 042 A2 struck from that record and assigned here** (042 §7.4, §9.4). §0 states the exposure honestly; **§13 Q1 records the cannon's ruling that it is falsifiable (A12).**

**The naming rule.** `longbox.<module>.<past-tense verb phrase>`, where `<module>` is 029 §2's owning module for the referenced table. The module segment is not decoration: it is what makes the routing rule in §4.1 checkable, and it is derived from a list 029 §2.10 already maintains rather than invented here.

**Derivation.** Start from the fourteen append-only tables in `src/db/appendOnlyTables.ts` and the pipeline's own steps as `tests/JOURNEYS.md` walks them, and **keep only the appends a consumer outside the writing module could act on.** That filter is the whole of the argument, and it is what stops the catalogue being a mirror of the schema — which is the failure mode 042 A2 caught, where three of 029 §2's thirty-two aspirational names had no table and the draft reported the mismatch as a feature.

| Event | Module (029 §2) | `ref_table` | Why a consumer outside the writer needs it |
|---|---|---|---|
| `longbox.workflow.photo_captured` | workflow | `scan_photo` | **Retention anchors.** 022 P7 Q6 counts originals from draft creation with a ceiling from capture; platform owns the sweep (029 §2.9) and cannot see workflow's write. Also E13-B06's derivative pipeline. |
| `longbox.resolution.candidate_set_written` | resolution | `candidate_set` | **Reporting's funnel and the eval set (R19).** 029 §2.8 makes reporting strictly downstream and forbids it from any write path, so an event is the only way it learns. |
| `longbox.workflow.confirmation_recorded` | workflow | `human_confirmation` | **Commerce consumes it** (029 §2.7 lists it under "Consumes"), and it is a T3 numerator input. |
| `longbox.condition.condition_recorded` | condition | `condition_assessment` | **Commerce's draft gate** (040 F6 refuses a draft with no condition). |
| `longbox.valuation.pricing_recorded` | valuation | `pricing_snapshot` | **Commerce consumes it** (029 §2.7); 029 §2.6 forbids commerce from re-deriving a price, so it must be told one. |
| `longbox.commerce.draft_requested` | commerce | *(the outbox row's own id)* | **§4's job.** This is the one event with a *job* as its consumer rather than a reader, and §3.4 is the special case it forces. |
| `longbox.commerce.draft_recorded` | commerce | `shopify_draft` | **Platform's retention anchor** (029 §2.9 "Consumes `CommerceDraftCreated`"): originals count from draft creation. Also T17's numerator. |
| `longbox.commerce.listing_status_observed` | commerce | `listing_status_observation` | **The T19 detector and the derivative retention anchor** (040 §4.4; 022 P7 Q6's *"life of the listing"*). |
| `longbox.workflow.transition_recorded` | workflow | `scan_session_transition` | **040 §3.3's explicit transitions**; reporting's funnel and E05's resumable list read it. |

**Nine, and the exclusions are the argument.** `cost_log` produces no event — 029 §2.8 makes reporting the *sink* that owns the table, and an event to tell reporting about a row reporting wrote is a loop. `llm_rerank` produces none: it is written in the same transaction as its `candidate_set` (029 §12.1 point 4's worked example) and a consumer that wants it reads it through the reference. `media_deletion`, `retention_policy`, `retention_hold`, `retention_hold_release` and `retention_sweep_run` produce none: they are platform's own tables, and 029 §2.9 makes platform the graph's leaf — **nothing may import it and it publishes to nobody who is not already inside it.** `corpus_version` produces none because nothing writes it (041 §10.1). **Five tables in, nine events out, and every exclusion names the rule that excludes it** — which is the falsifiability §0 claims: a reader who thinks `llm_rerank` needs an event has a specific sentence to attack.

**Additive by 042 §2.3.** A new event name is an additive change within `v1`. **A rename or a removal is a `v2` change**, and a retired name is retired forever — 042 §2.3's rule for error codes, applied to the same class of object for the same reason.

> **AMENDMENT (v1.2.0, 2026-09-06, E03-B08 `longbox-e5b.3.8`, 000-docs/064 §8). A
> TENTH NAME, AND THE PLATFORM EXCLUSION IS NARROWED TO ITS ACTUAL CRITERION.
> Nothing in this section is edited; the nine names, their table, and every other
> exclusion stand verbatim.**
>
> The paragraph above excludes platform's tables with this sentence: *"they are
> platform's own tables, and 029 §2.9 makes platform the graph's leaf — nothing
> may import it and it publishes to nobody who is not already inside it."*
>
> **That is true of the five tables it was written about**, whose consumer is
> platform's own sweep, reading them as tables in the process that needs them. The
> criterion it was reaching for is *does any consumer outside the writing module
> need to be told*, and for those five the answer is no.
>
> **`privacy_request` answers it differently, on one axis:** its consumer is a JOB
> **whose REFUSAL must be visible outside the transaction that acknowledged the
> provider's message.** A fail-closed guard inside that acknowledgement has only
> two endings and both are bad — a 500, which is a retry storm and eventually an
> app whose webhooks the provider disables (053 §5.5 names that hazard as the
> reason `topic` carries no CHECK), or a swallowed exception, which is a silent
> discard. On the outbox the refusal is a DEAD LETTER: visible, attributable, and
> never automatically re-driven (§5.5).
>
> **So the rule reads, as a PREDICATE rather than as a carve-out for one entry
> (the consistency lens's K5):**
>
> > **A table produces an event when a consumer OUTSIDE the writing module needs
> > to act on it — and "outside" INCLUDES a job whose REFUSAL must be visible
> > outside the transaction that produced the row.**
>
> The second clause is the one this bead added, and it is stated in the general
> form on purpose: an eleventh event that satisfies it needs no new argument, and
> one that does not is excluded by the same sentence. The five retention tables
> are unaffected — their consumer is platform's own sweep, reading them as tables
> in the process that needs them, and no refusal of theirs has to survive
> anything.
>
> **§3.4's count of ONE is unchanged.** `longbox.platform.privacy_request_received`
> is REFERENCE-shaped: `privacy_request` is a committed witness row that exists
> before the event does, so 042 §7.1's re-read rule has something to protect. A
> second command-shaped event is still a decision-record change and not a
> catalogue addition, and `tests/contract/event-catalogue.test.ts` still asserts
> it. **`privacy_request_fulfilment` produces NO event**, with its own exclusion
> row: it carries `operator_id`, and an event about it would put an operator
> identifier on a registry whose consumers are many (019 T35; 022 P3).

### 3.4 `draft_requested` is a command wearing an event's clothes, and the record says so

Eight of the nine names reference a committed witness row. **`draft_requested` does not**, because the thing it asks for has not happened — that is the entire point of a saga step. Its `ref_table`/`ref_id` therefore point at **the outbox row itself**, which is honest but ugly, and the ugliness is worth one paragraph rather than a workaround.

Two alternatives were available. **(a) Make it reference the `human_confirmation` that justifies the draft.** Rejected: it would say a confirmation happened, which is `confirmation_recorded`'s job, and two events referencing one row with different meanings is how a catalogue starts lying. **(b) Give it no reference and let the payload carry the session id.** Rejected under §2.5 — a payload with values is the thing this design does not have.

> **Decision: `draft_requested` is a self-referencing row. `ref_table = 'outbox'` and `ref_id = id`. The catalogue declares it as the one command in the set, and §11 I3 asserts there is exactly one.**

**Why one command is acceptable and a second would not be.** 042 §7.1's reference rule exists so a consumer always reads current truth rather than a snapshot. A command has no truth to read — it *is* the request — so the rule has nothing to protect. The hazard is that "commands are fine, actually" becomes a habit, and the guard is a count: **the catalogue admits exactly one command-shaped event, and adding a second requires a decision record.** That is the same posture 041 §5.3 takes toward its sanctioned exceptions — both are permitted *by being named*, and an unnamed one is the bug.

**RATIFIED as drafted (A10, Hickey 3; §13 Q5 answered): one table, one declared command kind.** The alternative — a second table so that events stay pure and jobs live apart — buys clean semantics and costs a second drain, a second index, a second claim query and a second set of invariants, all to separate one row kind from eight. **The smaller lie is one table with the exception written down.** Two obligations follow. **I3's failure message must point a reader at this section's argument, not merely report a count**, because the person who trips it will be adding the second command and needs the reason, not the rule. And:

> **The catalogue is AUTHORED, never generated.** It is a list of nine names a person chose and defended in §3.3's table, and it does not derive itself from the schema. That is deliberate: 042 A2 struck a *generated* catalogue precisely because generation cannot be wrong, and a list that cannot be wrong cannot be reviewed. Someone must sign each name.

## 4. Decision C — The Shopify saga

### 4.1 The shape, and the module seam it respects

> **`POST …/draft` no longer calls Shopify. It runs its gates, appends `draft_requested` inside the request transaction, and returns. A worker claims the row, calls Shopify, and — in its own transaction — appends `shopify_draft` with the returned product id and an `outbox_attempt` of kind `delivered`, or an attempt of kind `failed`.**

**Two transactions, and the external call between them, outside both.** That is not a compromise around 041 §4.1 — it is what 041 §4.1 requires once you accept that the call cannot be rolled back. The rule and the shape are the same rule stated twice.

**Module ownership (029 §2.7, §2.9).** The **outbox runtime** — the tables, the poller, the claim query, the attempt writer — is **platform's**; 029 `:176` already claims *"the durable queue and outbox runtime (E02-B09, E13-B03)"* by name. The **`draft_requested` handler** — the `productSet` call, the `shopify_draft` write, the not-yet-published guard — is **commerce's**; 029 §2.7 owns *"the outward mutation"* and `shopify_draft`. **Platform never knows what a job means; commerce never knows how it was scheduled.** The dispatch between them is a registry keyed on the event name, which is why §3.3's names carry a module segment. This also finally lands 029 §2.7's owed relocation (§1 E3): the draft-creation block leaves `src/routes/` for the module that owns it, and E02-B10's `depcruise` gate is what keeps it there.

### 4.2 What the request still does synchronously, and why the answer is "the gates"

A worker-run draft changes what the operator sees at the moment they tap. **The gates do not move**: 040 F6 (no draft without a condition), 040 G-c (`BLOCKED_BY_RETENTION_HOLD`), 042's `SESSION_HAS_NO_CONFIRMATION` and `SESSION_HAS_NO_PRICING` are all **reads of the session under the anchor lock**, and all of them stay in the request. A caller that is missing a confirmation still gets a 409 immediately, with the code 042 §4.2 registers.

**What the caller stops getting is the 201-with-a-product-id.** `POST …/draft` becomes `202 Accepted` carrying the outbox row's id, and the client learns the outcome from the ordinary read path — `GET …/:id`, whose `state` is derived (040 A8) and whose event trail already exists. **This is an API change and it belongs to 042's contract**, so §9.3 hands it over rather than deciding it here; what this record fixes is only that the effect is asynchronous, which is the fact 042's DTO has to describe.

**022 P4's rapid loop is the reason this is acceptable, not an obstacle to it.** An operator at a long box wants the next book, not a Shopify product id. 019 T10's ≤90 s median is *capture-to-draft*, and a draft that is *owed and recorded* at the moment of the tap is a better answer for the person holding the book than a request that blocks on a third party's latency. **The one thing that must not degrade is honesty of the screen**: the operator is told the listing is being created, in 021 registered copy, never that it exists. §9.3 carries it to E05.

### 4.3 Idempotency at the provider — what Shopify actually offers, verified

**Shopify's Admin GraphQL API provides no idempotency-key mechanism for `productSet`.** Verified against the API reference on 2026-09-04: `productSet` accepts exactly three arguments — `identifier` (`ProductSetIdentifiers`), *"Specifies the identifier that will be used to lookup the resource"*; `input` (`ProductSetInput!`), *"The properties of the newly created or updated product"*; and `synchronous` (`Boolean`, default `true`), *"Whether the mutation should be run synchronously or asynchronously. If `true`, the mutation will return the updated `product`. If `false`, the mutation will return a `productSetOperation`."* **There is no idempotency argument and no idempotency header in the argument list.**

**What it offers instead is an upsert on a caller-chosen key.** `ProductSetIdentifiers` has three fields: `customId` — *"Custom ID of product to upsert"*; `handle` — *"Handle of product to upsert"*; and `id` — *"ID of product to update"*. `customId` is a `UniqueMetafieldValueInput` with `namespace` (optional, *"If omitted, the app-reserved namespace will be used"*), `key` (required) and `value` (required).

> **Decision: every `productSet` call carries `identifier: { customId: { namespace: "longbox", key: "copy", value: <the copy key> } }`. Idempotency at Shopify is an upsert on a key Longbox owns, not a retry token — and that is a stronger guarantee, because it survives a restore (§8.2) as well as a retry.**

**One thing about the upsert is an ASSUMPTION and is signed OPEN (A11).** Neither lens re-fetched the API reference, so the cannon reproduced this record's *reading* of Shopify's docs and not Shopify's *behaviour* — and the behaviour the design leans on is narrower than the documentation states: **that a `customId` written by a `productSet` create is immediately findable by a `productSet` upsert issued moments later.** A metafield-backed lookup that is eventually consistent would make a fast retry create a **second** product, which is the exact failure the key exists to prevent, and no citation can settle it.

| Field | Value |
|---|---|
| Assumption | `productSet(identifier: {customId})` resolves a product created by an immediately preceding `productSet` call, with no visible lag |
| Rung | **OPEN — answered by measurement, not by citation** (018 A3) |
| Closing evidence | an empirical test against an isolated dev store (E10-B02's): create via `productSet` with a fresh `customId`, **immediately** retry with the same `customId`, assert the same product id comes back and that the store holds **one** product. **An E02-D07 acceptance line, run before the saga serves a real shop.** |
| If it fails | the fallback is `handle` (also an upsert identifier, and a first-class product field rather than a metafield) or a pre-flight `productByIdentifier` read — both are cheaper to adopt than to design around later, which is why the test comes before the shop and not after |

**The copy key is the physical copy, and today that is a forward-compatible lie the record names rather than hides.** 036 §2.1 makes `physical_item` the inventory identity and 036 §5.1 D1 forbids two active listings for one copy; **`physical_item` does not exist** (041 §1 E19; 036 §7.1's migration is unwritten). So `value` is the `scan_session_id` today and becomes the `physical_item_id` when that table lands. **That migration is not free and pretending otherwise would be the error**: a key change means an upsert stops matching and creates a second product. So the transition is E10-B03's — it owns the LCID↔SKU↔external-ID mapping — and it is a **backfill of the metafield on existing products, not a key swap**, recorded here so it is planned rather than discovered. §9.3 carries it.

**The guard that keeps an upsert from becoming an un-publish, and it is the sharpest hazard in this record.** `productSet` **updates** an existing product, and `buildProductSetInput` hardcodes `status: "DRAFT"` (`src/services/shopify.ts:28`). So a re-run against a product **a human has since published** would set it back to `DRAFT`. That is not a T19 auto-publish — nothing publishes — but it is the mirror image: **Longbox silently un-publishing a listing a person decided to publish**, which is 022 P1's human-authority principle and 033 B3's *"publish is a normal Shopify action, never the app's"* broken from the other side.

**The guard FAILS CLOSED, and that is the most costly amendment in this record (A3, Kleppmann 3, REQUIRED).** The draft's guard refused a job when an observation said the listing had left `draft` — and **passed when there were no observations at all**, which is the state of the world today (§1 E8: `listing_status_observation` has no producer). So the draft's protection evaluated to *"proceed"* in exactly the condition it existed for, and the record papered over it with an instruction — *"the guard and the watcher must not ship apart."* Kleppmann's objection is the sharpest sentence in the cannon and it is adopted whole: ***"An instruction is not an invariant. It is the thing an invariant exists to replace."***

> **Decision: a `draft_requested` job runs only on positive evidence that the listing is still a draft.**
>
> - **First attempt, no prior `shopify_draft` for the copy** → run. There is nothing to un-publish; this is a create.
> - **A retry or replay, prior `shopify_draft` at `'draft'` or later, AND at least one `listing_status_observation` saying `draft`** → run. The upsert is safe because something observed it.
> - **A retry or replay, prior `shopify_draft` at `'draft'` or later, AND ZERO `listing_status_observation` rows** → **REFUSED.** `outbox_attempt` kind `dead_lettered`, `detail.reason_code = 'no_observation_evidence'`. **Unknown means do not touch.**
> - **Any `listing_status_observation` with a status other than `draft`** → **REFUSED.** `dead_lettered`, `reason_code = 'listing_left_draft'`.
>
> Neither refusal is ever retried automatically; a replay requires §6.3's human record.

**What this buys, stated precisely.** The absence of evidence stops being read as evidence of absence. **E02-D07 no longer needs E10-B05 to be SAFE — only to be USEFUL**: with no watcher, every retry of an already-created draft dead-letters into a queue a human reads, which is slow and correct; with the watcher, the safe ones proceed automatically. **The sequencing instruction in §9.3 is replaced by this mechanism**, because a mechanism holds when nobody remembers the instruction. §11 I8 is rewritten to this polarity and **its first test is the empty-table case**, which is the one the draft would have passed.

### 4.4 Compensation: none, and the reason is a non-waivable line rather than an oversight

A saga step usually needs a compensating action. **This one does not, and the reason is T19.**

The effect is the creation of a **DRAFT** product. Nothing publishes (locked decision 3; 019 T19 = 0, non-waivable, `any → K1`; 040 F1 makes it an architecture-gate failure). **A DRAFT product that Longbox forgot about is invisible to buyers, sells nothing, charges nobody and misprices nothing.** Its cost is clutter in the owner's admin, which is a housekeeping problem, not a safety one.

**So compensation would mean deleting a product from the shop's store, and that is a worse act than the one it repairs.** `productDelete` against a store Longbox does not own, triggered automatically, on the strength of Longbox's own belief that it created something — with no way to distinguish a product it created from one the owner created and edited — is exactly the class of unilateral action 022 P1 exists to forbid. **Longbox creates drafts and never destroys the shop's data.** §10 A5 records the alternative and why it loses.

> **Decision: there is no compensating action. The repair for a divergence is reconciliation and a human, never an automatic delete.**

### 4.5 Reconciliation — the orphan, which is the E02-D04 obligation this bead was given

The bead's note states the failure to own: *"a Shopify DRAFT can exist with no `shopify_draft` row … The outbox/saga must make the Shopify call an at-least-once job whose result is recorded, with reconciliation for drafts Shopify has that Longbox does not."*

**The outbox closes the common case and does not close all of it.** With §4.1's shape, a crash between the `productSet` response and the recording transaction leaves an orphan — and §5.4's visibility timeout means the job is retried, and §4.3's `customId` upsert means the retry **matches the orphan and adopts it** rather than creating a second product. **That is the mechanism, and it is why the key is load-bearing rather than an optimisation.** What it does not cover is an orphan whose outbox row is gone: a database restore that rewinds past the enqueue (§8.2, T22 ≤24 h RPO with no PITR — §1 E12), or a product created by a version of the code that predates the key.

> **Decision: the E10-B05 watcher, which already polls Shopify for `listing_status_observation` (040 §4.4), additionally reports every product carrying the `longbox` `customId` metafield. A product whose key resolves to no `shopify_draft` row appends an `orphan_listing` observation — a fact, in the same append-only shape as every other observation, with a reference and no values.**

**Who sees it, and this is a 019 T35 question rather than a UX one.** An orphan names a copy, a time and a store. It does **not** name an operator, and the surface that shows it does not acquire the ability to: **it is owner-visible only, in the owner's weekly report (029 §2.8's shop-facing report; 019 §5), never on the operator's phone.** 022 P3 and 019 T35 (per-operator rendering = 0, non-waivable) are the reason, and the second reason is that the operator can do nothing about it while the owner can. **The copy is 021 registered** — a shop-facing sentence about a listing, subject to B19 (no "AI") and B16 (no control spoken as an achievement) — and is drafted by E11-B06 under the T26 pre-send step, **not written here**.

**The cadence is not set here.** 036 §13.2 (`036:779`) reserves the reconciliation cadence to E10-B05/B08 and 036 §10 Q6 already names the detection latency as load-bearing. This record adds one fact to that decision and no number: **the cadence must be shorter than the retention anchor it feeds**, because 022 P7 Q6 counts originals from draft creation, and an orphan discovered after the sweep has run is a photo deleted against a listing nobody knew existed.

## 5. Decision D — Retry, backoff and dead-lettering

### 5.1 Attempts are appends, and the attempt number is the state

Every attempt appends. **`kind='started'` before the effect, then exactly one terminal row — `delivered`, `failed` or `dead_lettered` — after it.** `UNIQUE (outbox_id, attempt_no, kind)` makes a duplicate attempt row a loud failure rather than a silent second history, which is 041 §5.3's `UNIQUE (scan_session_id, session_seq)` construction applied to a different counter for the same reason.

**Why `started` is written at all, when it costs a transaction.** Without it, a worker that crashes mid-call leaves no trace, and the row simply becomes due again — the retry happens and nothing records that a previous attempt was made and lost. **The attempt count would then undercount exactly the failures that matter most** (the ones that killed the worker), and §5.3's ceiling would never be reached by the class of failure most likely to be systemic. A `started` row with no terminal partner **is** the record of a crash, and it is readable by a human without a log.

### 5.2 Exponential backoff with jitter, and jitter is not decoration

> **`delay(n) = min(base × 2^(n-1), ceiling) × random(0.5, 1.5)`, computed at claim time from the attempt log, never stored.**

**Exponential** because the failures worth retrying are transient (a 429, a 502, a dropped connection) and the ones that are not (a validation `userErrors` array) should not be retried at all — §5.3 separates them. **Jitter** because without it every job that failed during one Shopify incident retries at the same instant when it ends, which converts one outage into a self-inflicted second one. That is the standard argument and it is stated because the pilot's scale makes it *look* unnecessary: with 035's Pilot C at ≥300 items, a shop that scans a batch during an outage has ≈300 jobs that failed within minutes of each other, and they would retry in a spike. **The number of jobs is small; the correlation between them is total.**

**A permanent failure is not retried, which is 042 §4.4's `retryable` distinction one layer down.** A Shopify `userErrors` entry — an invalid price, a missing required field — will fail identically forever. `src/services/shopify.ts:80-81` already separates that case from a transport failure (`:73`) and an HTTP failure (`:79`), so the classification exists in the tree and only its consequence is missing: **`userErrors` → `dead_lettered` on the first attempt, no backoff, no retry.** E10-B09's acceptance says the same thing in its own words — *"permanent validation failures are not retried."*

### 5.3 The ceiling, as a PROVISIONAL floor with its derivation stated

042 A3 is the governing ruling and it is quoted rather than re-argued: *"018 A3 caps claims of fact, not safety floors … A system with no limit at all is not epistemically humble — it is unprotected."* And 042 §8.4 draws the line this record applies: a number that **protects** the system may be provisional; a number that **describes** it may not.

| Field | Value |
|---|---|
| `job_max_attempts` | **PROVISIONAL 6.** With `base` = 30 s and `ceiling` = 30 min, six attempts span roughly **15 minutes** of wall clock before dead-lettering (the five inter-attempt delays double from 30 s: 30 + 60 + 120 + 240 + 480 s = 15.5 min; the 30-minute ceiling is never reached at six attempts — v1.1.2 corrects the earlier "75 minutes", which did not follow from the formula). The derivation is a ceiling, not an estimate: a shop scans in batches (033 §5.1, 035), and a provider incident that outlives a quarter of an hour is not a blip a retry loop should be papering over — it is a `declared provider outage`, which is the exact phrase **019 T17** uses to exclude such a window from the draft-success denominator. **The ceiling is set where the system should stop pretending and start telling the owner.** |
| `job_backoff_base` / `job_backoff_ceiling` | **PROVISIONAL 30 s / 30 min.** The floor is above any plausible transient and below any operator's patience; the ceiling keeps a long outage from stretching one job across a working day. |
| `attempt_visibility` | **PROVISIONAL 5 min** (§5.4). |
| Rung | **PROVISIONAL — explicitly NON-EVIDENTIARY.** These are **not** measurements, are **never** quoted as reliability, throughput or latency in any artifact at any class (021 B16), and support no claim of fact. They are floors. |
| Closing evidence | the observed attempt-count and time-to-delivery distributions across the 019 §5 pilot batches, **segmented by whether a real Shopify credential was configured** — a stub client never fails, so a mixed sample would report a reliability that belongs to the stub. |
| Guard | **every attempt is counted from day one**, and a dead-letter during normal pilot work is a finding either way: the floor was wrong, or something is. Both are worth a 006 row. |
| Red line | 018 C3: a ceiling may be **raised** freely (it binds less); **lowering one after seeing a result it would change** requires a 006 row saying so in those words. |

### 5.4 Dead-lettering is a terminal attempt kind, not a table

> **There is no DLQ table. A dead letter is an `outbox_attempt` row with `kind='dead_lettered'`, and the dead-letter queue is a view over the attempt log.**

A second table would hold a copy of a row that already exists — locked decision 4's prohibition, and 041 §6.4's *"if dropping it loses information, it is not a read model"*. **A view loses nothing and cannot drift.**

**The heartbeat, and it is filed rather than declared.** A dead letter nobody looks at is a draft that never reached Shopify and a T17 numerator quietly falling. So the drain wants a liveness signal — and **019 T34 enumerates six heartbeats and this record has no standing to add a seventh.** 041 §9.3 hit exactly this and set the precedent this record follows: *"filed as a 019 amend-by-row candidate for E00-B03, not as an edit to 019 by this record … 019 is a ratified contract with signed thresholds."*

> **Filed as an E00-B03 amend-by-row candidate, with its text supplied and not applied: the outbox drain emits a heartbeat, and an `outbox_attempt` of kind `dead_lettered` with no subsequent `replay_requested` after a review window is surfaced in the owner's report.**

**Not every dead letter means the same thing, and rolling them into one number hides the two that matter (A5, Kleppmann 5).** A dead letter from a Shopify 500 is a provider problem and belongs in T17's *"declared provider outage"* arithmetic. **A dead letter carrying `reason_code = 'listing_left_draft'` or `'no_observation_evidence'` is not a failure at all — it is §4.3's guard WORKING**, refusing to touch a listing whose state Longbox cannot vouch for. Counted together, a guard doing its job reads as a reliability problem, and a reliability problem reads as a guard doing its job.

> **Decision: dead letters carrying `'listing_left_draft'` or `'no_observation_evidence'` are surfaced on their OWN line in the owner's report, distinct from the T17 aggregate. They are a queue of listings awaiting a human look, not a count of failures.**

**The E00-B03 amend-by-row candidate is extended to carry that distinction beside the T34 heartbeat** — same filing, same precedent, still not applied by this record.

**And the record declines to call it a K1 — affirmed at ratification (A5; §13 Q8 answered: this is discipline, not a dodge).** The bead's framing invites it — *"a dead letter unseen for N hours is K1"* — and **that is not this record's to sign.** 019's K1 list is closed and non-waivable; a stale *detector* is a K1 (T34), so a **dead drain** would be, but a **dead letter sitting in a live drain is a T17 miss**, which is a different instrument with a different owner. Conflating them would inflate a K1 and 018's whole ladder exists to stop that. **019's K1 list is closed and this record has no standing to open it**; supplying the row and letting E00-B03 apply it is the same discipline 041 §9.3 used, and the cannon affirmed it rather than merely accepting it. **The N in "N hours" is likewise not invented here**; it belongs with the review window E13-B01 owns.

### 5.5 No automatic re-drive, ever

> **Nothing re-enqueues a dead letter automatically. A replay is a human act with a record (§6.3).**

A dead letter means the retry budget was spent against a failure that did not clear. Something re-driving it on a timer is a retry loop with extra steps and no ceiling — and for §4.3's upsert, an automatic re-drive is the mechanism that would eventually un-publish a listing when the guard's data is stale. **E10-B09's acceptance already says a replay records actor and reason; this record makes the absence of an automatic path the reason that is possible.**

## 6. Decision E — Replay boundaries

### 6.1 The three classes

> **Delivery to a consumer may always be replayed. The Shopify call may be replayed only because §4.3's key makes it an upsert and §4.3's guard makes it refuse a listing that has left `draft`. A witness row may never be replayed, in any sense of the word.**

| Class | Replayable? | Why |
|---|---|---|
| **Delivery of an event to an in-process consumer** | **Always** | §3.2 makes consumers idempotent on `(event, ref.id)` by constraint, and the payload is a reference, so a second delivery is a second read of current truth. 042 §7.1's third reason for reference-not-value is exactly this property. |
| **The `productSet` call** | **Conditionally** | idempotent by upsert on the `customId` (§4.3); refused when a `listing_status_observation` says the listing left `draft` (§4.3's guard). Without **both**, it is not replayable and must not be replayed. |
| **A witness row** | **Never** | an append-only row cannot be re-appended, and "replaying" a `human_confirmation` would mean writing a second row asserting a person did something twice. A correction is a **superseding row** (041 §3), authored by whoever authored it, and it is not a replay. |
| **`cost_log`** | **Never** | a meter reading. A replayed job that calls a paid provider a second time appends a *second* cost row, because it spent money a second time (§8.1). Replaying the *row* would be falsifying a ledger. |

### 6.2 A replay writes attempts; it never edits anything

A replay is `outbox_attempt` rows: one `replay_requested` carrying `operator_id` and `reason`, then the ordinary `started` / terminal pair with the next `attempt_no`. **The original attempts stay exactly as they are.** This is 022 P2 — *"undo writes a superseding record; it never edits history"* — and 041 §3.6's *"a correction never edits and never hides"*, applied to an operational table that is nevertheless a witness (§2.6).

### 6.3 A replay names a person and states why

> **`replay_requested` requires a non-null `operator_id` and a non-empty `reason`, enforced by a CHECK, not by a handler.**

E10-B09's acceptance requires it — *"replay records actor and reason"* — and 041 §2.3's argument is why it is a constraint: *"stop forbidding a thing and start making it unrepresentable."* A replay with no author is the one row in this design that could quietly re-run an external effect, and a nullable column is an invitation.

**⚠ `operator_id` FKs `app_user`, which does not exist** (034 §2.13's tenancy migration is unwritten; 041 §10 row 2 is blocked on it). So the CHECK is specified and the column is unpopulatable until then, and the replay path is **not built before it** — stated here rather than discovered as a null.

### 6.4 The replay drill, and why the outbox is outside it

041 §6.4's drill drops every derived view and materialized read model, recreates them, and asserts every invariant still passes and every rebuilt table is byte-identical. **`outbox` and `outbox_attempt` are excluded, as a declared row with §2.6's reason.**

**And the exclusion has to be declared rather than assumed, because the failure mode is specific**: the drill's whole point is that a derivation nobody replays is not a derivation. A table sitting outside it with no row saying why is indistinguishable from a table someone forgot. §11 I2 asserts the row exists and carries a reason.

**What *is* in the drill is the dead-letter view** (§5.4) and any read model over the attempt log, because those are derivations in the ordinary sense and must rebuild byte-identically.

## 7. Decision F — Concurrency

### 7.1 One poller per process, and the shape already exists in the tree

> **The drain is a `setInterval` started from `src/server.ts`, unref'd, returning a stop function — the shape `scheduleAppendOnlyCheck` already uses (`src/services/appendOnlyDetector.ts:169-190`). One poller per process. No second scheduler, no cron, no external runner.**

Choosing the shape already in the tree is not laziness; it is 041 §9.2 item 4's reasoning about the trigger list applied to a runtime pattern — *a second spelling of one thing is how two things start to drift.* The precedent is tested, it is unref'd so it never holds the process open, and its stop function is what makes an integration test deterministic. **`LISTEN`/`NOTIFY` was the alternative and §10 A4 records why it loses at this scale.**

### 7.2 The claim, and why `SKIP LOCKED` makes two processes safe by construction

```sql
SELECT o.id
FROM outbox o
WHERE o.shop_id = $1
  AND NOT EXISTS (SELECT 1 FROM outbox_attempt a
                  WHERE a.outbox_id = o.id AND a.kind IN ('delivered','dead_lettered'))
  AND <not in flight>          -- §2.4: newest attempt is not a 'started' within attempt_visibility
  AND <due>                    -- §2.4: now() >= last failure + backoff(attempt_no)
ORDER BY o.scan_session_id, o.session_seq NULLS LAST, o.created_at
FOR UPDATE OF o SKIP LOCKED
LIMIT $2;
```

**The claim and the `started` write are one transaction, and this is the one place a picture earns its keep (A1).** Kleppmann's own framing: *"I don't think this record needs TLA+ … the exact atomicity boundary of claim + started-write is the one place a half-page of interleaving diagram would earn its keep."* So:

```
CORRECT — claim and `started` commit together; the lock outlives neither

  worker A                                   worker B
  ────────────────────────────────────────   ────────────────────────────────────────
  BEGIN
  SELECT … FOR UPDATE SKIP LOCKED  → row R
                                             BEGIN
                                             SELECT … FOR UPDATE SKIP LOCKED
                                               → R is locked ⇒ SKIPPED, takes R'
  INSERT outbox_attempt(R, 1, 'started')
  COMMIT            ← lock released HERE,
                      and not one instant
                      before the row is durable
                                             (a later claimer now READS the started
                                              row and computes "in flight")

BROKEN — the shape this decision forbids: claim in one transaction, `started` in another

  worker A                                   worker B
  ────────────────────────────────────────   ────────────────────────────────────────
  BEGIN; SELECT … FOR UPDATE …; COMMIT
                    ← lock released, log says NOTHING
                                             BEGIN
                                             SELECT … FOR UPDATE SKIP LOCKED
                                               → R is unlocked, not terminal,
                                                 not in flight, due ⇒ CLAIMED
  INSERT … (R, 1, 'started')                 INSERT … (R, 1, 'started')  ← UNIQUE saves
  ── two workers now perform the effect concurrently ──
```

The `UNIQUE (outbox_id, attempt_no, kind)` constraint makes the broken interleaving fail *loudly* rather than silently, which is worth having as a backstop — **but it fails after both workers have already called Shopify**, so it is not the fix. The fix is the transaction boundary above, and §4.3's provider-side upsert is what makes even the backstop's failure survivable.

**`FOR UPDATE … SKIP LOCKED` is the whole of the multi-process story.** A second process's claim transaction skips rows the first holds and takes different ones. No lease table, no worker registry, no partitioning, no leader election. **E13's horizontal scaling costs nothing here because the mechanism was never single-process-dependent** — it is single-*poller*-per-process by choice, not by constraint.

**The `ORDER BY` delivers §3.2's guarantee and nothing more.** Sorting by `(scan_session_id, session_seq)` is what makes within-session order hold; it confers no cross-session promise, and §3.2 says so explicitly so nobody reads the clause as one.

**Two mechanical rules, both learned from 042 §5.3's amendments.** (a) **One connection for the claim transaction's lifetime** — 042 A5/I21's rule, for the identical reason: a `pool.query` per statement would release the row lock at the first statement boundary and `SKIP LOCKED` would stop skipping anything. (b) **A fixed lock order** — 042 A6/I22 fixes idempotency-row-then-anchor for handlers; a worker takes **the `outbox` row, then anything else**, always. A worker that took a `scan_session` lock first and then an outbox row could deadlock against a request holding them the other way, and `40P01` at a counter is the symptom 042 §5.3(b) describes: *"an intermittent failure … that reproduces on nobody's laptop."*

### 7.3 The worker's database role

041 §9.2 item 2 makes role separation the **primary** control over the append-only model — *"a migration role that owns the schema and an application role that owns nothing"* — and it **SHIPPED at `418c2de` as E02-D06** (PR #57, merged 2026-09-04): `docker/postgres-init/00-roles.sql`, `src/db/appRoleGrants.ts`, `src/services/roleSeparation.ts`, and a server that refuses to boot on a connection whose role owns an append-only table or is a superuser. The worker connects as the same non-owner application role as the server, for the same reason and with the same consequence: **a worker connection cannot `SET session_replication_role`, cannot `ALTER TABLE … DISABLE TRIGGER`, and therefore cannot write a non-append-only row into either of §2.3's tables even by mistake.** Nothing here needs a new role, and inventing one would put a second privileged principal in a system whose whole security argument is that there is one.

## 8. Decision G — Cost per job, and the T22 story

### 8.1 A job that spends money logs it in the recording transaction

`appendCostLog` today takes a `pg.Pool` and writes its own statement (`src/services/costLog.ts:5-23`), so a cost row cannot commit with the fact it describes (§1 E11). **Both halves change, and only the second is this record's decision.**

- **It takes a transaction handle first**, per 029 §12.1 point 3 — *"Any module function that writes takes the handle as its first parameter"*. That is E02-D04's shape, not a new rule.
- **`cost_log` gains `outbox_id uuid REFERENCES outbox(id)`, nullable.** NULL means *"spent by a request, not a job"* — **one meaning, which is the test 030 A1 sets and 041 §9.4 restates**: a nullable column whose NULL carries two meanings is the defect; this one carries exactly one, and the alternative (a `source` enum beside a nullable FK) encodes the same fact twice.

**The Shopify draft job writes no cost row, and that is deliberate.** `productSet` costs no money. Writing a zero-dollar row to prove the seam works would put a fact in the ledger that is not a measurement — 022 P8's decision strip and 019 T13a both read this table. **A job logs a cost when it spends; the seam exists for E10-B04's staged media upload and for any future provider job, and it stays empty until one arrives.**

### 8.2 T22 — the outbox is in the database, and that is exactly why the key matters

> **`outbox` and `outbox_attempt` are ordinary Postgres tables, so they inherit the database's backup and restore posture unchanged: 019 T22's ≤24 h RPO and ≤4 h RTO, measured by a restore drill at G3, owned by E13-B07. This record asks for no separate backup and no separate drill.**

**The interesting half is what a restore does to a system with an external effect**, and 024 §2 is blunt about the current posture — *"estate borg; **no PITR**"*, with PITR planned under E13-B07. So:

> **A restore can rewind Longbox by up to a day. It cannot rewind Shopify. Every replayed outbox row therefore meets a Shopify that already has its product — and `productSet`'s `customId` upsert (§4.3) turns that from a day's worth of duplicate listings into a day's worth of no-ops.**

**That is the strongest argument for §4.3 and it does not come from retries at all**; it comes from the backup posture. Stating it here is what makes the two decisions legible as one design rather than two conveniences. **The converse is the honest cost**: rows appended *after* the restore point are gone, so effects owed in that window are never performed — and the thing that finds them is §4.5's reconciliation, which is the only mechanism in the design that compares Longbox's belief against Shopify's state. **Reconciliation is not a nicety attached to the saga; it is the restore story.**

**And T22 does not measure that story (A4, Kleppmann 4).** The scope of the threshold is worth stating because its name invites the wider reading:

> **019 T22's ≤24 h RPO and ≤4 h RTO describe DATABASE recovery. They bound how much data is lost and how long until Postgres serves again. They do NOT bound time-to-external-consistency — how long Longbox's record and Shopify's state stay divergent after a restore.**

That second figure is real, it is **owed, and this record invents no number for it.** Three obligations instead: **E13-B07** — the restore drill measures the time from restore-complete to the first reconciliation pass covering the affected window, and reports it beside the RTO rather than inside it; **E13-B01 and E10-B05** — the reconciliation cadence is what that figure is mostly made of, and 036 §13.2 already owns the cadence; **E00-B03** — a **scope-note amend-by-row candidate on 019 T22**, text supplied here and *not applied*, saying that T22 is a database-recovery line and that external consistency after a restore is measured separately. 041 §9.3's precedent governs: a record with no standing over 019 supplies the row and lets its owner apply it.

## 9. What this record hands to other beads

**Nothing in this section is written.** No file number is claimed and no migration is numbered — 041 §10's rule, learned twice.

### 9.1 Order

| # | Artifact | Blocked on |
|---|---|---|
| ~~**0**~~ | ~~`withTransaction` + the `FOR UPDATE` anchor~~ | **SHIPPED** at `17b98ab` — E02-D04 `longbox-e5b.2.14`, PR #56, merged 2026-09-04, with `POST …/confirm` and `POST …/draft` wrapped. **Nothing below is blocked on it.** |
| **1** | *migration* — `outbox` + `outbox_attempt` per §2.3, their append-only triggers, the `ENABLE ALWAYS` clause, their rows on `src/db/appendOnlyTables.ts`'s declared list, and the **partial index** supporting §7.2's eligibility predicate. **E02-B10 owns the index shape, the expand/contract order and the rollback** | 0 |
| **2** | *migration* — `cost_log.outbox_id` (§8.1) | 1 |
| **3** | The outbox runtime in `platform`: the appender, the poller, the claim query, the attempt writer, the backoff function, the dead-letter view. **E02-D07** *(a new discovered-work bead, §9.3)* | 1 |
| **4** | The `draft_requested` handler in `commerce`: the `productSet` call with §4.3's `identifier`, **A3's fail-closed guard**, the `shopify_draft` write. **This is where 029 §2.7's owed relocation of the draft block out of `src/routes/` finally happens.** A11's dev-store upsert-consistency test runs **before** this handler serves a real shop | 3 |
| **5** | `POST …/draft` becomes `202` with the outbox row id; the DTO and the error codes are **042's contract, E02-B08's execution** | 3, and 042 §9.1 rows 2–3 |
| **6** | The watcher's orphan report and the `customId` metafield scan — **E10-B05.** After A3 this makes the guard *useful*; it is no longer what makes it *safe* | 4 |
| **7** | The `replay_requested` path and its CHECK — **E10-B09**, and blocked on `app_user` (034 §4.1's unwritten migration) | 3 |

### 9.2 The 029 amend-by-a-row entries this bead owes

029 §9 (`029:680-683`) permits amending a statement of fact by a row. **This record does not edit 029.** These are the exact rows for the parent to apply.

> **Entry A — 029 §2.9 (`platform`), "Tables owned".** Add **`outbox`** and **`outbox_attempt`**.
> *Rationale:* `029:176` already claims *"the durable queue and outbox runtime (E02-B09, E13-B03)"* among platform's responsibilities; these are its tables. Note beside them that **`outbox` is a witness table in the append-only set** (§2.6), not an operational cache — the distinction that separates it from `request_idempotency`, which 042 §9.2 Entry A adds to the same list.

> **Entry B — 029 §11 (`029:704`).** Append: *"E02-B09 discharges the delivery-semantics half of this bullet (000-docs/043), completing the bullet that 042 §9.2 Entry B half-discharged."*
> *Rationale:* the bullet is a non-decision naming the two beads that would decide it. Both have now decided.

> **Entry C — 029 §12 (`029:712`).** Append: *"E02-B09's design (000-docs/043) is the replacement §12.3 names. §12 is superseded on the day the outbox in 043 §2 is RUNNING, not on the day 043 ratifies — see 043 §12.3."*
> *Rationale:* 029 §12.3 says *"When E02-B09 lands, §12 is superseded and this record should be amended to say so."* **"Lands" means running code, and this record is a design.** Recording the condition rather than the event is the honest row.

> **Entry D — 029 §2.7 (`commerce`), "Files today".** Append: *"The draft-creation block leaves `src/routes/scanSessions.ts` as the `draft_requested` job handler (043 §4.1, §9.1 row 4), which is the relocation this section has owed since 029 v1.1.1."*

### 9.3 Note-obligations, and the discovered-work bead

- **E02-D07 — *"Build the outbox runtime: tables, poller, `draft_requested` consumer, fail-closed guard, reconciliation seam"*** *(new, `-D` alias per 014's discovered-work rule; needs a 015 row)*. It is a `-D` bead rather than part of E02-B09 because **E02-B09 is a DEC bead and this is code**, and 023 §5 closes a decision bead on an argued design, not on an implementation. **Six acceptance lines this record adds at ratification**, each naming its amendment:
  - **(A1)** the claim `SELECT … FOR UPDATE … SKIP LOCKED` and the `started` INSERT run on **one connection in one transaction**, and I13 asserts that no two `started` rows for one `outbox_id` have overlapping visibility windows;
  - **(A2)** a **parametric contract test over the consumer registry**, constructing the concurrent duplicate against *every* registered consumer, plus a **static lint** flagging any handler that `SELECT`s and then writes the same table without `ON CONFLICT`;
  - **(A3)** the guard **fails closed** — zero observations plus a prior `shopify_draft` is a refusal, never a proceed;
  - **(A7)** every timestamp is **server-side `now()` inside the claim transaction**, and beyond one host NTP or a monotonic source is required;
  - **(A9)** I5 and I13 are **adversarial** — crash mid-attempt, two pollers on one row, poller death after claim — because they stand in for the concurrency suite a queue library would have shipped;
  - **(A11)** the **dev-store upsert-consistency test** passes before the saga serves a real shop.
- **E10-B05** — report every Shopify product carrying the `longbox` `customId` metafield, not only status (§4.5), and own the reconciliation pass §8.2 leans on. **The draft made this bead a safety dependency and discharged it with an instruction that the guard and the watcher not ship apart; A3 replaced that instruction with a mechanism.** The watcher now makes the guard *useful* — it is what lets a safe retry proceed automatically instead of dead-lettering — and the guard is safe without it.
- **E10-B03** — the `customId` value migrates from `scan_session_id` to `physical_item_id` when 036 §7.1's table lands, **as a metafield backfill on existing products, never a key swap** (§4.3).
- **E10-B09** — implements §5 and §6 for commerce effects; the `replay_requested` CHECK is its acceptance line, and it is blocked on `app_user`.
- **E13-B03** — §2.2's four conditions are the threshold at which a broker is revisited, with a measurement rather than a preference.
- **E13-B04** — the drain's heartbeat and its correlation-id propagation; **a job inherits the enqueueing request's `correlation_id` and never mints a new one**, which is what makes "what happened to this book" one query.
- **E13-B01 / E13-B07 (A4)** — the dead-letter review window's N (§5.4); and the restore drill **measures the time from restore-complete to the first reconciliation pass over the affected window and reports it beside the RTO, not inside it**, because T22 bounds database recovery and not time-to-external-consistency (§8.2).
- **E05 (B04 / B08)** — the operator is told a listing is *being created*, in 021 registered copy, never that it exists (§4.2); and the offline queue's `Idempotency-Key` rule (042 §5.6, A9) is unchanged by this record — a queued write still mints its key at the act.
- **E00-B03** — **three** 019 amend-by-row candidates, all with text supplied and **none applied**: the drain heartbeat as T34's next entry (§5.4); **(A5)** the rule that `'listing_left_draft'` and `'no_observation_evidence'` dead letters are reported on their own line, distinct from the T17 aggregate; and **(A4)** a scope note on **T22** recording that it is a database-recovery line and that external consistency after a restore is measured separately.
- **E02-B08** — `POST …/draft`'s `202` response DTO (§4.2), and the fact that §3.1's envelope carries a `correlation_id` the producing request does not yet have (§1 E9).
- **E14-B04** — contract tests generate from `contracts/openapi.v1.json` **and now also from §3.3's catalogue**, which is a declared list in `src/` on 041 §9.2's model.

### 9.4 One discovered citation nit, filed and not fixed

PR #56's comment at `src/routes/scanSessions.ts:464` cites **`041:788`** for the reconciliation obligation. `041:788` is 041 §12.3's *"It does not amend 019"* bullet and says nothing about the outbox; the sentences the comment is reaching for are 041 §4.1's side-effect rule and §8.2's ordering rule, **both of which the same comment already quotes correctly**. It is a pointer defect in a code comment, not a decision defect, and under 029 §9's rule it is repairable in place by whoever next touches that file. Filed here so it is not rediscovered as a contradiction.

### 9.5 What this record does not hand over, because it is not owed

**No patch to 040, 041 or 042 is filed.** Every citation in this record was checked against the current file; §1 found no mis-cite of the class 042 §1 E23 found in 040, and the two obligations 042 §9.4 placed on this bead (A2's catalogue, A7's drain order) are **discharged in §3.3 and §3.2** rather than amended into 042.

## 10. Alternatives considered

**A1 — Keep the direct call and add a retry loop in the handler.** *Rejected*, §2.1. It is the cheapest change and it fixes the visible symptom (E6) while leaving the actual defect untouched: with no record of intent, a crash between the call and the insert is still an orphan (E4), and a retry inside a handler makes the operator wait on a third party's backoff. **A retry without a durable record of what is being retried is a louder version of the same bug.**

**A2 — Split this record: decide the outbox now, defer the catalogue again.** *Considered seriously, and it is the alternative a reader of 042 A2 will reach for first.* The case for it is real: 042 struck the catalogue for being unfalsifiable against zero running code, and this record still has zero running code. It loses on two grounds. **First, the deferral has nowhere left to go** — 042 assigned the catalogue here explicitly (§7.4, §9.4), and deferring it again means deferring it to the *implementation* bead, where a naming scheme would be chosen by whoever types first and no cannon would ever see it. **Second, the objection's substance is answered rather than dodged**: 042's draft derived names from a table list with no producer, no drain and no consumer; §3.3 derives them from a producer specified in §2, a drain in §7 and a consumer in §4, and every exclusion cites the rule that excludes it. That is falsifiable in the only sense available before code. **The cannon ruled it sufficient (A12; §13 Q1): every name maps to a source table and an exclusion rule, and I3 counts the set — so the catalogue can be shown wrong, which is the whole test.** The split is not taken.

**A3 — A mutable `status` column on `outbox`, as a declared exemption on 041 §9.2's list.** *Rejected*, §2.4, and it is the closest call in the record because the precedent is right there: 042 §5.2 does exactly this for `request_idempotency`, with three stated reasons and a `kind: permanent` row. It loses because the exemption **buys nothing here**: the attempt log already holds everything the column would, in more detail and without a second copy, and §2.4's derived-lease predicate removes the only mechanical argument for it. **An exemption is for a table that is correct and looks wrong. A status column beside a complete attempt log is not correct — it is 040's `scan_session.status` with a different name.**

**A4 — `LISTEN`/`NOTIFY` instead of polling.** *Rejected for v0.* It is genuinely better on latency and it is Postgres-native, so it costs no dependency. Two things sink it at this scale. **A notification is not durable**: a listener that is down when `NOTIFY` fires never learns, so a poller is required anyway as the backstop — and then there are two mechanisms where one would do (§7.1's drift argument). And the latency it buys is invisible here: the operator does not wait on the draft (§4.2), so a poll interval measured in seconds is indistinguishable from instant for the only person involved. **It becomes worth it under §2.2's condition 2, and E13-B03 owns that call.**

**A5 — Compensate an orphan by deleting the Shopify product.** *Rejected*, §4.4. Automatic deletion of the shop's data on the strength of Longbox's own belief, with no way to distinguish a product it created from one the owner has since edited, is a worse act than the clutter it repairs — and a DRAFT harms nobody (T19 = 0). **Longbox creates drafts and never destroys the shop's data.**

**A6 — A separate `dead_letter` table.** *Rejected*, §5.4. It would hold a copy of rows that already exist; a view over the attempt log loses nothing and cannot drift (041 §6.4).

**A7 — Exactly-once via two-phase commit between Postgres and Shopify.** *Rejected, and it is worth one line because someone will ask.* Shopify exposes no prepare/commit protocol and no idempotency token (§4.3), so there is nothing to enrol in a 2PC. **Exactly-once across an HTTP boundary is not available at any price**; at-least-once plus an idempotent key is the strongest thing that exists, and §4.3 buys it.

**A8 — A queue library (pg-boss, graphile-worker).** *Rejected for v0*, §2.2(c) — and **the cannon upgraded the rejection from a "weaker ground" to a DECISION constrained by locked decision 4 (A9, Hickey 5; §13 Q2)**: a library's job schema is mutable by design, lives outside `migrations/`, and cannot be brought inside 041 §9.2's declared trigger set at all, so the rejection follows from a constraint the project has already signed rather than from taste. **What the cannon attached is a bill: §11 I5 and I13 stand in for the concurrency suite a hardened library would have shipped, and they must be ADVERSARIAL — crash mid-attempt, two pollers on one row, poller death after claim — not run-twice-assert-once.**

**A9 — Events carry the referenced row's values.** *Rejected*, §2.5, on 042 §7.1's three grounds unchanged: a copy is a second source of truth, a copy is un-purgeable, and a copy ages while the row it copied is corrected.

## 11. Acceptance criteria and invariants

Each is falsifiable and names the test that will decide it. **None of these tests exists** (018: nothing here is TESTED). Unit tests flat in `tests/`, DB tests in `tests/integration/`, contract tests in `tests/contract/`, per the tree's convention.

**One is ⛔ blocked (I17, on `app_user`, 034 §4.1's unwritten tenancy migration).** The draft marked six ⛔ UNWRITABLE until E02-D04 shipped `withTransaction`; **it shipped at `17b98ab` during drafting** (§0, §1 E2), so **I1, I9, I13, I18 and I19 are writable today**. **Three are ⚠ conditional:** I10 on E10-B05's watcher (which does not exist, §1 E8), I14 on E02-B10's architecture gate (042 §1 E22), I20 on E00-B03's 019 T34 row. I8 is **not** conditional on E10-B05 since A3 made the guard fail closed. **Three are written to FAIL on the tree as it stands (I1, I7, I19)** — that is the point: they name a defect rather than a design.

| # | Invariant | Test file |
|---|---|---|
| **I1** | **An effect is never performed by the transaction that decides it, and the intent commits with the fact.** Assert (a) no file under `src/routes/` calls a provider client — **fails on the current tree**: `routes:467` calls `createDraft`; (b) the `outbox` INSERT and the `human_confirmation`/`pricing_snapshot`/`condition_assessment` read that justifies it run on the same `tx`; (c) a request that throws after the outbox INSERT leaves **no** outbox row and **no** effect. ✅ **unblocked** — E02-D04 shipped at `17b98ab` (§1 E2). | `tests/integration/outbox-enqueue.test.ts` |
| **I2** | **Both outbox tables are append-only, declared, and declared-excluded from the replay drill.** Assert `outbox` and `outbox_attempt` carry `ENABLE ALWAYS` `%_append_only` triggers and appear in `src/db/appendOnlyTables.ts`'s declared list; assert **neither appears on the exemption list**; assert the replay-drill exclusion list contains a row for each with a **non-empty reason naming §2.6's two grounds**. An absence is indistinguishable from an oversight (041 §9.2 item 4). | `tests/integration/append-only-trigger-set.test.ts` (extended) + `tests/contract/replay-drill-exclusions.test.ts` |
| **I3** | **Every event in the catalogue references a committed witness row, except exactly one.** Walk §3.3's declared catalogue; assert every entry's `ref_table` is a table in the append-only set **except** `draft_requested`, whose `ref_table` is `outbox`; assert the count of command-shaped entries is **exactly 1**. A second one is a design change and must fail the build (§3.4). **(A10)** the failure message must **point the reader at §3.4's argument**, not merely report a count — the person who trips this assertion is adding the second command and needs the reason, not the rule. Assert also that the catalogue is a **checked-in authored list**, not derived from the schema at test time (§3.4's closing rule). | `tests/contract/event-catalogue.test.ts` |
| **I4** | **No event carries a version of its own, and none carries a value** (042 §7.3 I17, §7.1 I18 — inherited acceptance lines). Assert no emitted payload declares `event_version`; assert the key set is exactly §3.1's envelope plus `ref`; assert no key holds a column value from the referenced row. Then the purge case: purge a photo (041 §8) and assert no emitted event ever carried its `storage_key`, its bytes or its hash. | `tests/contract/event-contract.test.ts` |
| **I5** *(A2 + A9, an E02-D07 acceptance line)* | **EVERY registered consumer stays correct under CONCURRENT duplicate delivery, and the gate is at the registry.** Three assertions. **(a)** A **parametric** test iterates the consumer registry and, for each entry, delivers one event **twice simultaneously** from two claim transactions, asserting exactly one effect and exactly one row — so registering a consumer enrols it in the test and there is no way to add one untested. **(b)** The losing path raises a **unique violation**, proving the mechanism is a constraint and not a read-then-write check. **(c)** A **static lint** fails any consumer handler that `SELECT`s a table and then `INSERT`s or `UPDATE`s that same table with no `ON CONFLICT`. **A2 is why this is registry-level**: a rule proved against one hand-picked consumer is a rule enforced by whoever remembers the example. **A9 is why it must be adversarial**: it stands in for the concurrency suite the rejected queue library would have shipped, so *deliver-twice-in-sequence-and-assert-one-row* does not discharge it. | `tests/integration/consumer-idempotency.test.ts` + `tests/contract/consumer-write-shape.test.ts` |
| **I6** | **An outbox row and an attempt row carry no values and no operator prose.** Assert `outbox`'s column set is exactly §2.3's; assert `outbox_attempt.detail`'s keys are drawn from a declared allowlist of codes and references; assert no row in either table contains a provider exception message, a response body, a percentage, a model name or a provider name (022 P6, P8; 021 B16/B19; 019 T35). | `tests/contract/outbox-carries-no-values.test.ts` |
| **I7** | **`productSet` always carries the identifier and always carries `status: DRAFT`.** Assert the mutation document declares `$identifier: ProductSetIdentifiers` and the variables carry `customId` with namespace `longbox`; assert `input.status === "DRAFT"` unconditionally (locked decision 3; 019 T19 non-waivable; 033 B3). **Fails on the current tree**: `src/services/shopify.ts:12-17` declares one variable and `:23-40` sends no identifier. | `tests/shopify-idempotency.test.ts` |
| **I8** *(REWRITTEN at ratification to A3's fail-closed polarity)* | **A job touches an existing listing only on POSITIVE evidence that it is still a draft.** Four cases, and **the first is the one the draft would have passed**. **(a) THE EMPTY-TABLE CASE:** a prior `shopify_draft` at `'draft'`, **zero** `listing_status_observation` rows — assert **no `productSet` call**, an `outbox_attempt` of kind `dead_lettered` with `detail.reason_code='no_observation_evidence'`, and no automatic retry. **(b)** an observation saying something other than `draft` → refused, `reason_code='listing_left_draft'`. **(c)** an observation saying `draft` → the job runs. **(d)** no prior `shopify_draft` at all → the job runs; there is nothing to un-publish. **This is the mirror of 040 I4 against the same principle** (022 P1, 033 B3), and after A3 it is **not conditional on E10-B05**: with no watcher every case collapses to (a) or (d), both of which are decided rather than assumed. | `tests/integration/draft-job-listing-guard.test.ts` |
| **I9** | **A crash between the Shopify call and the recording transaction adopts the orphan rather than duplicating it.** Kill the worker after `createDraft` returns and before the recording commit; let the visibility timeout expire; assert the retry produces **one** Shopify product (the upsert matched) and **one** `shopify_draft` row. **This is the bead's own E02-D04 obligation, constructed.** ✅ **unblocked** — E02-D04 shipped at `17b98ab` (§1 E2). | `tests/integration/draft-job-orphan-recovery.test.ts` |
| **I10** | **A Shopify DRAFT with no `shopify_draft` row is reported, and the report names no operator.** Seed a product carrying the `longbox` `customId` with no matching row; run the reconciliation; assert an `orphan_listing` observation is appended, and assert the surface that renders it carries **no operator identifier** (019 T35 non-waivable, 022 P3) and **no unregistered shop-facing string** (021). ⚠ **conditional on E10-B05.** | `tests/integration/orphan-listing-reconciliation.test.ts` |
| **I11** | **There is no mutable state anywhere in the drain.** Static: neither table has an `UPDATE` path in `src/`; no column named `status`, `claimed_at`, `locked_at`, `lease_until` or `next_attempt_at` exists on either table; the eligibility predicate reads only `outbox_attempt`. **This is the invariant that fails first if someone adds the column under load** (§2.4). | `tests/contract/outbox-has-no-status-column.test.ts` |
| **I12** | **A stale claim needs no reaper.** Append a `started` attempt with no terminal partner; assert the row is **not** eligible before `attempt_visibility` and **is** eligible after, with **no sweeper, cron or repair job running in between**. Assert no code path writes a "recovery" row. | `tests/integration/outbox-visibility.test.ts` |
| **I13** *(extended by A1; adversarial per A9; an E02-D07 acceptance line)* | **Two pollers never take one row, and a claim is never visible before the log records it.** Four assertions. **(a)** Two claim transactions run concurrently over a seeded queue: every row is claimed exactly once, the second claimer **skips rather than blocks**, and the union of claims is the full eligible set. **(b) A1's property:** across any interleaving of concurrent claimers, **no two `started` rows for one `outbox_id` have overlapping visibility windows** — which is false the moment the claim and the `started` INSERT are separate transactions, and is the mechanical form of §2.4's atomicity decision. **(c) Adversarial (A9):** kill a poller **after** it claims and **before** its terminal write, and assert the row becomes eligible again only after `attempt_visibility` and that the `started` row records the lost attempt. **(d)** A deliberately **split-transaction fixture claimer makes (b) fail**, proving the assertion can fail — 029 §5 move 8's *"prove the gate can fail"*. ✅ **unblocked** — the claim needs one held connection, which `withTransaction` now gives it (§1 E2). | `tests/integration/outbox-skip-locked.test.ts` |
| **I14** | **A worker takes the outbox row before any other lock** (042 I22's rule, this record's subject). Static lint over every job handler: the `FOR UPDATE … SKIP LOCKED` on `outbox` precedes any `scan_session … FOR UPDATE`, with no exceptions and no opt-out comment; plus a **deliberately reversed-order fixture handler that makes the lint fail** — 029 §5 move 8's *"prove the gate can fail"*. ⚠ **E02-B10 owns the lint's CI wiring.** | `tests/contract/job-lock-order.test.ts` |
| **I15** | **Within a session, delivery follows `session_seq`; across sessions nothing is promised.** Construct 041 I6(e)'s dual-offline replay — two writes queued against the same witness, replayed in each of the two possible orders — and assert the per-session event order is identical under both. Then assert **the contract declares no cross-session guarantee**: a consumer that could rely on one would pass a weaker test. | `tests/contract/event-ordering.test.ts` |
| **I16** | **A permanent failure is never retried and a transient one is, with jitter.** Assert a Shopify `userErrors` response produces `dead_lettered` at `attempt_no = 1` with no backoff; assert a 429/502/transport failure produces `failed` and a due time inside §5.2's window; assert two jobs failing in the same instant get **different** due times. | `tests/outbox-backoff.test.ts` |
| **I17** | **Nothing re-drives a dead letter, and a replay names a person and a reason.** Assert no scheduled path re-enqueues a `dead_lettered` row; assert `replay_requested` is refused by a **CHECK** when `operator_id` is null or `reason` is empty — not by a handler (041 §2.3). ⛔ **blocked on `app_user`** (034 §4.1's unwritten migration). | `tests/integration/outbox-replay.test.ts` |
| **I18** | **A replay appends and never edits.** After a replay, assert every prior `outbox_attempt` row is byte-identical to before, the outbox row is untouched, and the new attempts carry the next `attempt_no` (022 P2; 041 §3.6). ✅ **unblocked** — E02-D04 shipped at `17b98ab` (§1 E2). | `tests/integration/outbox-replay.test.ts` |
| **I19** | **A job's cost row commits with the fact and is never replayed.** Assert `appendCostLog` takes a `Tx` as its first parameter — **fails on the current tree**: `src/services/costLog.ts:5-7` takes a `pg.Pool`; assert a job that spends appends `cost_log` with `outbox_id` set inside the recording transaction; assert a replayed job that spends again appends a **second** row rather than reusing the first (§6.1). ✅ **unblocked** — E02-D04 shipped at `17b98ab` (§1 E2). | `tests/integration/job-cost-log.test.ts` |
| **I20** | **The drain emits a heartbeat and the dead-letter view is derived.** Assert the poller emits a liveness signal on every cycle; assert the dead-letter surface is a **view** and that dropping and recreating it is byte-identical (041 §6.4's drill, applied to the one derivation here). ⚠ **the 019 T34 row itself is E00-B03's** (§5.4) — this asserts the signal exists, not that 019 lists it. | `tests/integration/outbox-drain-heartbeat.test.ts` |

**I2, I6, I7, I8, I10 and I14 map to a non-waivable line** (locked decision 4 for I2; T35 for I6 and I10; T19 for I7 and I8; T19 via 040 I4's gate for I14). **I1, I7 and I19 fail on the tree as it stands.** **I17 is ⛔ blocked on `app_user`** (034 §4.1's unwritten tenancy migration) and nothing else is blocked, E02-D04 having shipped; **I10 is ⚠ conditional on E10-B05** (I8 is not, after A3); **I14's CI wiring is ⚠ E02-B10's and I20's 019 row is ⚠ E00-B03's.** The rest are structural.

## 12. Consequences, and what this record does not decide

### 12.1 What gets better

- **The orphaned Shopify draft stops being a permanent, invisible divergence.** It becomes a job with a record of intent (§2), a retry that *adopts* the orphan instead of duplicating it (§4.3), and a reconciliation that finds the ones no retry covers (§4.5). **That is the E02-D04 obligation this bead was handed, and it is closed by three mechanisms rather than one, because no single one covers a restore.**
- **029 §12's temporary consistency mechanism finally has its replacement designed**, and §9.2 Entry C records the condition — running code — rather than pretending ratification is landing.
- **042 A2's struck catalogue is written, with its exclusions argued.** Nine names, five source tables, and every omission citing the rule that omits it.
- **A retry stops being an operator pressing a button twice.** §1 E6 is that there is no retry at all; §5 gives one with a ceiling, a backoff and a terminal state that a human has to touch.
- **Two pollers, two processes and a restore are all safe by construction rather than by care** — `SKIP LOCKED`, the derived lease and the upsert key each remove a class of coordination rather than managing it.
- **The append-only model gains two tables and loses no ground.** No status column, no exemption, no mutable operational table sitting inside the trigger set with a note attached.

### 12.2 What gets worse, stated plainly

- **The operator no longer learns the draft's outcome at the moment they tap.** §4.2 argues this is right for the person holding the book, and it is still a real loss: a failure now surfaces later, somewhere else, to someone else. **The mitigation is entirely on E05 and E11**, which is a sentence here and a flow, a registered string and a report column there.
- **The system gains a second execution context.** Everything that was request-scoped — the correlation id, the tenant, the lock order, the error envelope — now has to hold in a worker too, and a worker has no request to inherit them from. §9.3 hands three of those to E13-B04 and the record does not pretend they are free.
- **`outbox` and `outbox_attempt` grow forever and their retention is not decided here.** This is the third record to write that sentence about an operational-ish table (040 A9 and 042 §12.2 wrote it about `request_idempotency`), and it is worse here because these tables are **append-only**, so a retention answer cannot be a `DELETE` — it has to be 041 §8's purge path or nothing. **E13-B01 owns it, and "an unowned table that grows forever is how a retention commitment quietly stops being true" applies with more force to a table that cannot be swept.**
- ~~**§4.3's guard is specified and unenforceable today.**~~ **STRUCK by A3, and the strike is the most instructive thing in the cannon.** The draft's guard passed vacuously against an empty `listing_status_observation` table (§1 E8), and the record discharged that with an instruction that the guard and the watcher not ship apart — the weakest thing it did anywhere. Kleppmann: *"An instruction is not an invariant. It is the thing an invariant exists to replace."* **The guard now fails closed**, so the cost moves from *unsafe* to *slow*, which is the trade the draft should have made.
- **The catalogue is still fixed against zero running consumers.** §0 and §10 A2 argue it is nonetheless falsifiable. **A cannon may disagree, and if it does, §3.3 should be struck the way 042 §7 was** — the reversal would be more instructive than the adoption.
- **Four numbers are now configured that nobody has measured** (§5.3). Deliberately generous, explicitly non-evidentiary, and still numbers in a config file that someone will one day quote as a reliability figure. 021 B16 forbids it and §5.3 forbids it; **the guard is a sentence**.
- **A3's fail-closed guard costs throughput before it costs anything else.** Until E10-B05's watcher exists, **every retry of an already-created draft dead-letters** into a queue a human reads. That is slow and it is correct, and it is a real operational cost the draft did not carry because the draft's guard silently passed instead. The mitigation is E10-B05, and the ordering between the two beads is now a question of usefulness rather than of safety.

### 12.3 What this record does NOT decide

- **It does not write the tables, the poller, the job, the migration or any test.** §9.1 is a sequence; **E02-D07** executes rows 3 and 4, **E02-B10** owns row 1's index, expand/contract order and rollback.
- **It does not supersede 029 §12 today.** §12 is superseded when the outbox is **running**, not when this record ratifies — §9.2 Entry C, and §13 Q7 puts the reading to the cannon rather than assuming it.
- **It does not close A11's upsert-consistency assumption.** Whether Shopify's `customId` lookup is immediately consistent after a create is **OPEN and answered by measurement**, on a dev store, before the saga serves a shop (§4.3). No citation settles it and this record does not pretend one does.
- **It does not measure time-to-external-consistency after a restore (A4).** T22 bounds database recovery; the second figure is owed by **E13-B07** and shaped by **E13-B01 / E10-B05**'s cadence (§8.2).
- **It does not decide the reconciliation cadence.** 036 §13.2 (`036:779`) reserves it to E10-B05/B08; §4.5 adds one constraint (shorter than the retention anchor it feeds) and no number.
- **It does not decide the dead-letter review window's N, nor `outbox` retention.** **E13-B01.**
- **It does not build the watcher.** §4.5 gives it two obligations; **E10-B05** builds it and puts its heartbeat on T34's list (040 `:694`).
- **It does not amend 019.** §5.4's heartbeat is an **E00-B03 amend-by-row candidate**, text supplied, not applied — 041 §9.3's precedent. **And it does not create a K1**; the K1 list is closed and non-waivable.
- **It does not decide the API shape of `POST …/draft`'s `202`.** That is **042's contract and E02-B08's execution**; §4.2 fixes only that the effect is asynchronous.
- **It does not decide media handling.** Shopify staged uploads and their retry are **E10-B04**; §8.1's cost seam exists for that job and stays empty until it arrives.
- **It does not decide worker deployment, fairness across shops, or backpressure.** **E13-B03**, which is blocked on this bead; §7.2's `shop_id` filter is the seam it will need and not the policy.
- **It does not reverse or amend a locked decision.** Locked decisions 3, 4, 5 and 7 constrain this record; where anything here conflicts with one, the locked decision wins.

## 13. The questions, as answered by the cannon

v1.0.0 put eight questions to two lenses; both returned **ACCEPT-WITH-CHANGES**. **Three came back as changes to
the design** (A3 from Q1's neighbourhood, A6 from Q6, A9 from Q2), four were answered as drafted, and **eight
amendments arrived that the draft had not asked for** (A1, A2, A4, A5, A7, A8, A10, A11). The reasoning is kept
rather than deleted, because the reasoning is the record.

1. ~~**Is §3.3's catalogue falsifiable, or is it 042 §7 again?**~~ — **ANSWERED: falsifiable, NOW (A12).** The
   difference from 042's struck draft is not that code exists — it does not — but that **every name maps to a
   named source table and every omission cites the rule that omits it**, against a producer (§2), a drain (§7)
   and a first consumer (§4) specified in the same document, with **I3 counting the set**. A catalogue that can
   be shown wrong is a catalogue that can be right. §10 A2's split is **not taken**, and the reason the deferral
   was refused matters: there was nowhere left to defer it to except the implementation bead, where no cannon
   would ever see it.

2. ~~**Is rejecting a queue library a decision or a preference?**~~ — **ANSWERED: a decision, and the draft
   understated it (A9, Hickey).** It is constrained by **locked decision 4**: a library's job schema is mutable
   by design and cannot be brought inside 041 §9.2's declared trigger set at all. §2.2 is rewritten to say so.
   **The cannon attached a bill**: I5 and I13 stand in for the concurrency suite a hardened library would have
   shipped and **must be adversarial** — crash mid-attempt, two pollers, poller death after claim.

3. ~~**Is §2.6's first reason real, or a rationalisation?**~~ — **ANSWERED: keep both, and say they are
   INDEPENDENT (A8, Hickey + Kleppmann).** Reason 2 (append-only children FK to the parent) is sufficient
   *today*; reason 1 (a rebuilt row would answer today's question) is what remains if that foreign key ever
   changes shape. **A record that keeps only the currently-decisive reason has to re-derive the other one the day
   the structure moves.**

4. ~~**Is the derived lease simple or clever?**~~ — **ANSWERED: simple, CONDITIONALLY — and the condition was
   missing (A1, A7).** The construction stands, but it was **unsound as written**, because nothing said the claim
   and the `started` write were one transaction; without that the lock is released before the log records it and
   the lease derives from nothing. **A1 fixes the boundary and draws it**; **A7 names the timing assumption**
   (`attempt_visibility` must exceed worst-case clock skew; timestamps are server-side; NTP beyond one host).
   041 §6.2's materialized index remains the escape hatch under load, and it is not the status column.

5. ~~**Is `draft_requested` an acceptable command, or should jobs live in a second table?**~~ — **ANSWERED: one
   table, one declared command kind, RATIFIED as drafted (A10, Hickey).** Two tables buy clean semantics and cost
   a second drain, index, claim query and invariant set to separate one row kind from eight. **The smaller lie is
   one table with the exception written down** — plus two obligations: I3's failure message points at §3.4's
   argument rather than reporting a count, and the catalogue is **authored, never generated**.

6. ~~**Does `payload_hash` earn its column?**~~ — **ANSWERED: no. STRUCK (A6, Kleppmann 6 + Hickey 7.)** The
   `UNIQUE (shop_id, event, ref_table, ref_id)` constraint already makes double-enqueue-with-a-different-envelope
   unconstructible, so the column existed to catch what the schema forbids. Hickey: *"a column that exists to
   catch a case the schema already makes impossible is not neutral — it is a place a future engineer will
   eventually repurpose."* A genuine envelope-drift question, if one ever arises from a backfill with
   `ON CONFLICT`, is a **new record**.

7. ~~**Does §9.2 Entry C read 029 §12.3 correctly?**~~ — **ANSWERED: yes, the narrow reading, as drafted.** §12
   falls when the outbox is *running*, not when this record ratifies. It is the same ruling 042 §13 Q7 reached on
   the same sentence, and reaching it twice independently is the useful part.

8. ~~**Is §5.4 right to refuse the K1?**~~ — **ANSWERED: yes — discipline, not a dodge (A5), and AFFIRMED rather
   than merely accepted.** 019's K1 list is closed and non-waivable, a stale *detector* is a K1 while a dead
   *letter* in a live drain is a T17 matter, and a record with no standing over 019 supplies the row and lets
   E00-B03 apply it. **A5 adds what the draft missed**: a `'listing_left_draft'` or `'no_observation_evidence'`
   dead letter is **the guard working, not a failure**, and reporting it inside the T17 aggregate would make a
   working guard read as unreliability.

**Eight amendments the draft did not ask for.** **A1 and A7 (Kleppmann 1, Hickey 1)** — the claim/`started`
atomicity boundary and the clock assumption underneath the derived lease, neither stated. **A2 (Kleppmann 2,
REQUIRED)** — consumer idempotency is gated **at the registry**, by a parametric test and a lint, not proved
against one instance. **A3 (Kleppmann 3, REQUIRED, and the most costly)** — the guard **fails closed**; *"an
instruction is not an invariant."* **A4 (Kleppmann 4)** — T22 bounds **database** recovery, not
time-to-external-consistency, and the second figure is owed. **A5 (Kleppmann 5)** — guard-refusal dead letters
are reported distinctly. **A10 (Hickey 3)** — the catalogue is authored, never generated. **A11 (Kleppmann,
unreproduced)** — **neither lens re-fetched Shopify's reference**, so the immediate-consistency of the `customId`
upsert is an **assumption signed OPEN and closed by a dev-store measurement**, not by a citation. That last one
is the most useful thing in the cannon: it found the place where this record's evidence regime — citation —
**cannot reach**, because the question is about behaviour and not documentation.

## 14. Ratification

| Field | Value |
|---|---|
| Decision | **Adopt §2–§9** — the transactional outbox as two append-only tables written inside the request transaction, with no mutable status column and a lease derived from the attempt log (§2); the draining order that confers nothing, the at-least-once guarantee with consumers idempotent by constraint, and the nine-name event catalogue 042 A2 assigned here (§3); the Shopify draft as a job made replay-safe by `productSet`'s `customId` upsert and guarded against un-publishing a human's listing, and **failing closed** when nothing has observed the listing's state, with orphan reconciliation through the E10-B05 watcher (§4); append-only attempts, exponential backoff with jitter, PROVISIONAL circuit-breaker floors, and dead-lettering as a terminal attempt kind with a T34 heartbeat filed as an E00-B03 candidate (§5); the three replay classes and the outbox's declared exclusion from 041 §6.4's drill (§6); one poller per process on `FOR UPDATE … SKIP LOCKED` with a fixed lock order (§7); and per-job cost logging plus the T22 story, in which today's ≤24 h RPO with no PITR is itself the argument for the idempotent key (§8) — as the canonical delivery, job, retry, dead-letter and replay contracts for intent-longbox, together with §11's twenty invariants and §10's nine rejected alternatives. Apply §9.2's four amend-by-a-row entries to 029 under its §9 clause. Binding on E02-B08, E02-B10, E02-D04, E02-D07, E05-B04, E05-B08, E10-B03, E10-B04, E10-B05, E10-B08, E10-B09, E13-B01, E13-B03, E13-B04, E13-B07 and E14-B04. |
| Status | **RATIFIED.** |
| Acting head of board | **Claude, acting head of board**, under Jeremy Longshore's 2026-09-03 delegation recorded in 006 |
| Date | **2026-09-04** |
| Cannon | **`martin-kleppmann-reviewer`** and **`rich-hickey-reviewer`**, 2026-09-04 on `8579e70` — **both ACCEPT-WITH-CHANGES.** **Both reproduced the code claims they leaned on** (E1, E2, E4, E7, E9, E11). **Neither re-fetched Shopify's API reference**, which is recorded rather than glossed: the cannon therefore reproduced this record's *reading* of the documentation and not Shopify's *behaviour* — see **A11**, which turns the one behavioural dependency into an OPEN parameter closed by a dev-store measurement. |
| Amendments at ratification | **A1** (Kleppmann 1, REQUIRED) the claim `SELECT … FOR UPDATE … SKIP LOCKED` and the `started` INSERT are **one transaction on one connection**; the lock releases only after the `started` row commits; I13 extended to *no two `started` rows for one `outbox_id` with overlapping visibility windows*; §7.2 gains the interleaving diagram · **A2** (Kleppmann 2, REQUIRED) consumer idempotency is gated **at the registry** — a parametric contract test over every registered consumer plus a static lint on the read-then-write shape; E02-D07 acceptance lines · **A3** (Kleppmann 3, REQUIRED, the most costly) the not-left-`draft` guard **FAILS CLOSED**: a retry or replay against an existing `shopify_draft` with **zero** observations is REFUSED (`no_observation_evidence`); *unknown ⇒ do not touch*; the *"must not ship apart"* instruction is replaced by the mechanism, I8 is rewritten with the empty-table case first, and **E02-D07 no longer needs E10-B05 to be safe, only to be useful** · **A4** (Kleppmann 4) **T22 bounds DATABASE recovery, not time-to-external-consistency**; the reconciliation lag after a restore is owed by E13-B07, shaped by E13-B01 / E10-B05, and filed as a T22 scope-note candidate for E00-B03; no threshold invented · **A5** (Kleppmann 5) `'listing_left_draft'` and `'no_observation_evidence'` dead letters are reported **distinctly from the T17 aggregate** — a guard working is not unreliability; the E00-B03 candidate carries the distinction beside the T34 heartbeat; **Q8 affirmed** · **A6** (Kleppmann 6 + Hickey 7, REQUIRED) **`payload_hash` is STRUCK** — `UNIQUE (shop_id, event, ref_table, ref_id)` already makes its case unconstructible; **Q6 answered** · **A7** (Hickey 1) the timing assumption is named: `attempt_visibility` must exceed worst-case clock skew, timestamps are **server-side `now()` in the claim transaction**, NTP or a monotonic source beyond one host · **A8** (Hickey 2 + Kleppmann, **Q3**) §2.6's two witness reasons are **KEPT and declared independent** — reason 2 suffices today, reason 1 is what remains if the attempt→outbox FK ever changes · **A9** (Hickey 5, **Q2**) rejecting a queue library is a **DECISION constrained by locked decision 4**, not a preference; I5 and I13 stand in for a hardened library's concurrency suite and **must be adversarial** · **A10** (Hickey 3, **Q5**) one table with one declared command kind **RATIFIED**; I3's failure message must point at §3.4's argument; **the catalogue is AUTHORED, never generated** · **A11** (Kleppmann, unreproduced) the `customId` upsert's immediate consistency is an **ASSUMPTION signed OPEN**, closed by a dev-store test before the saga serves a real shop — **answered by measurement, not by citation** · **A12** **Q1** answered *yes, falsifiable now*; **Q7** accepted as drafted; implementing beads named (E02-D07, E10-B05, E13-B04, E13-B07 / E13-B01). **None declined.** |
| **Dissent preserved** | **`martin-kleppmann-reviewer`, on §4.3's guard:** *"An instruction is not an invariant. It is the thing an invariant exists to replace."* **Resolved by A3** rather than overruled — the guard fails closed and the sequencing instruction is deleted rather than defended. · **`martin-kleppmann-reviewer`, on formality:** *"I don't think this record needs TLA+ … the exact atomicity boundary of claim + started-write is the one place a half-page of interleaving diagram would earn its keep."* **Adopted by A1** — §7.2 draws both the correct and the forbidden interleaving. · **`rich-hickey-reviewer`, on `payload_hash`:** *"a column that exists to catch a case the schema already makes impossible is not neutral — it is a place a future engineer will eventually repurpose."* **Adopted by A6** — struck, not defended. · **`rich-hickey-reviewer` against a Beck-shaped objection on §4.2** (the operator loses the synchronous outcome): **recorded as an affirmation, not a conflict.** The synchronous 201 is the *easy* shape and the asynchronous job is the *simple* one; the system is right to resist the easy shape, and §4.2's cost — a failure surfacing later, elsewhere, to someone else — is carried in §12.2 rather than argued away. |
| Gate audit | *(pending)* — `longbox-gate-auditor` before the bead closes. |
| Declined | **Nothing.** All twelve amendments are absorbed in full. One draft decision is **STRUCK** (`payload_hash`, A6) and one draft mechanism is **REPLACED** (the ship-together instruction → A3's fail-closed guard). |
| Jeremy's revision right | **Standing.** Jeremy may revise any line by a 006 decision-log row naming date, old text, new text and reason (018 §5). Locked decisions 3, 4, 5 and 7 outrank this record, as do 019's signed thresholds and every ratified record it cites. Per `019:202`, a 022/019 conflict halts and escalates to the acting head by a 006 row; **no build agent reconciles the two by interpretation.** |
| Recorded in | 006 decision-log row dated 2026-09-04 (flipped **in place** from the PROPOSED row filed earlier the same day, per 018 §4 C2 — the PROPOSED text is preserved in version control); 016 §1 row 043; 000-INDEX rows 043 and 015; the 015 alias map's **E02-D07** row; the change log above; bead `longbox-e5b.2.9`'s close reason quotes this block. |

Binding from 2026-09-04. Changing any **decision** above — the outbox's location or its transactional coupling, the absence of a status column, **the claim/`started` atomicity boundary (A1)**, the catalogue's names or its one command, the provider-idempotency key or **the guard's fail-closed polarity (A3)**, the retry classification, the dead-letter semantics, the replay boundaries, or the claim mechanism — requires a new decision record naming this one as superseded (018 §4 rule S4), never an in-place edit. Four things are explicitly **not** decisions and may be amended in place by a patch bump plus a change-log row, following 029 §9's precedent: **statements of fact about the existing tree** (a `file:line` that turns out wrong is a defect in the description, not the decision); **the catalogue's membership**, which is *designed* to grow — adding an event name is additive under 042 §2.3 and is the rule working, while a rename or removal is not; **`job_max_attempts`, `job_backoff_base`, `job_backoff_ceiling` and `attempt_visibility` (§5.3)**, which are PROVISIONAL floors that close by measurement and may be **raised** freely; and **`outbox_attempt.detail`'s allowlisted keys**, which grow as codes are added and never as prose.

**Ratification is not evidence** (018 §2 A3). This block records that a design was argued by two lenses and adopted, that one of its columns did not survive the argument, and that one of its guards was inverted. It does **not** make any claim in §2–§9 true of any running system: **nothing here is built, nothing is TESTED**, every invariant in §11 names a test file that does not exist, **one is ⛔ blocked** on `app_user` (034 §4.1's unwritten tenancy migration), two are **⚠ conditional** on an architecture gate that is not installed, **one is ⚠ conditional on a watcher that does not exist** (I10 — I8 stopped being conditional the moment A3 made the guard fail closed), and four are written to **fail on the current tree**. **A11's assumption is OPEN and closes on a measurement nobody has taken.** §1 stays REPRODUCED and everything else stays ASSERTED. **In particular, ratification will not close the orphaned-draft window §1 E4 establishes — it is live at `17b98ab`, the merged code names it and assigns it here, and it stays live until E02-D07 ships.**
