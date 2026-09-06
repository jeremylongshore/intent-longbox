# Decision Record — What a Second Delivery Means, What a Late One Reaches, and What the Three Mandatory Topics Oblige

**Version:** 1.2.1
**Status:** **RATIFIED at v1.2.1** — signed by the acting head on 2026-09-06 at close of E03-B08 against PR #101, squash-merge `f1cdc2d` (`f1cdc2d6dbb7e79291d504889af9b255414f3534`), after the final gate re-audit (NOT-READY on three wording repairs, folded at ac72945) and the final invariant re-verification (PASS-WITH-NOTES at fab9fc2; its three residual notes folded at 9201e05). The text that follows is the PROPOSED-era status, kept verbatim as history: **PROPOSED — UNSIGNED.** **The cannon WAS dispatched and has now RE-CHECKED at `d31416e`.** Verdicts, in order: `security-auditor` **REJECT** at `30c2501` → **ACCEPT-WITH-CHANGES** on re-check (all four mechanisms reproduced closed); `longbox-invariant-reviewer` **BLOCK** → **PASS-WITH-NOTES** (both prior findings re-probed closed, K2 confirmed on two connections); `longbox-gate-auditor` **NOT-READY** twice; `martin-kleppmann-reviewer` **ACCEPT-WITH-CHANGES**. §2 carries every statement VERBATIM with its verdict — **a re-check APPENDS a paragraph under the original and never rewrites it** — and §2.1 is the fold table. **Nothing was declined in either fold.** **B3's register re-cut is LANDED**: released after PR #100 merged, rebased onto `8068a58` at `fab9fc2`, ledger **37** (`036`+`037`+`038`, one gap `027`), registers **006 1.85.0 / 000-INDEX 1.44.0 / 016 1.32.0**. The acting head signs at CLOSE.
**Bead:** E03-B08 `longbox-e5b.3.8` — *Implement signed webhooks, replay and ordering defense and the mandatory privacy workflows* (epic LBOX-E03 `longbox-e5b.3`, gate **G2**, layer security, risk critical) — see 000-docs/014 §8 row E03-B08
**Filed:** 2026-09-06 · **Author:** `longbox-security-tenancy-builder` · **Owner:** parent session (acting head of board under the 2026-09-03 delegation)
**Sensitivity:** Restricted internal (014 §10). It names tables, columns, headers, topics and two provisional numbers. It contains no shop, no store, no person, no customer and no credential value, and it never will.
**Scope of this commit:** the RECORD and its CODE HALF land on one branch. Migration `038`; `src/services/connectors/shopify/{policy,api}.ts`; `src/services/privacy.ts`; `src/consumers/privacyRequestReceived.ts`; `src/events/catalogue.ts`; `src/db/{rowLevelSecurity,appendOnlyTables}.ts`; two CLIs; one route header.
**Amends:** **056** (→ v1.4.0, by change-log row and three appended blocks in §5.0, §5.3 and I13: §5.3 says in so many words that *"`outbox` gets NO service policy"*, and §7.2 puts one on it — that rejection STANDS for the poller's cross-tenant claim, and the question this bead faced is a different one), **053** (→ v1.1.0, by change-log row and an appended block: the receipt gains two columns and a disposition, and the uninstall gains an event-time bound — both are content, so it is a minor) and **043** (→ v1.2.0, by change-log row and an appended block in §3.3: the catalogue gains a tenth name and platform's exclusion rule is NARROWED rather than contradicted). Every original sentence in both stays verbatim.
**Inputs:** 056 v1.3.0 §5.0, §5.3 (the rejection this record amends), §7, §11 R10 · 053 v1.0.8 §5.5, §7.3, §8, §9, §11 I2 · 043 v1.1.2 §2.3, §2.4, §2.5, §3.2, §3.3, §3.4, §4.3, §5.4, §5.5, A3, A5 · 042 v1.6.1 §4.3, §4.4, §5.1 (class two), §7.1 · 041 §2.5, §4.2(i), §5.3, §8.2, §8.4, §8.7(d)/(e), §9.2 · 056 v1.3.0 §5 (the declared scopes), §6.1, §7 · 061 v1.1.3 §4 · 029 §2.7, §2.9, §2.11 · 034 §3.4 (the K1 shape), §4.2 · 022 P3 · 019 T17, T19, T24, T32, T33, T34 · 044 v1.1.0 §2, §9 · 005 (the v0 spec, which names NO inbound topic) · CLAUDE.md locked decisions 3 and 4.

---

## Change log

**Version convention** (006 `:6`): a **minor** bump means the content of a decision changed; a **patch** means a statement of fact was repaired with no decision changing. A record whose ratification section is unsigned is CORRECTED rather than amended, so a pre-ratification narrowing is a patch provided no ruling is reversed.

| Version | Date | What changed | Authority |
|---|---|---|---|
| **1.2.1** | **2026-09-06** | **PATCH — RATIFIED.** Signed by the acting head at close of E03-B08 against squash-merge `f1cdc2d`. §14 is signed and the Status line records the merge SHA. Evidence at close: CI run 34062584191 at 9201e05 (8/8 required; unit 1900/102 files, integration 879+1 skipped, coverage 80.47 over the 80 floor); the final gate re-audit's three wording repairs (B1 self-enforcing struck at four sites, B2 the re-cut restated as landed, B3 the two `agrees`-only sentences qualified with R9's clause) at ac72945; the final invariant re-verification's residual notes (routes.ts "no DESTRUCTIVE effect", §2's one word, the `attempt_no` tie-break) at 9201e05. The two beads §9 proposed exist — E03-D35 `longbox-e5b.3.45` and E03-D36 `longbox-e5b.3.46` — and their 015 rows land with this signature. No decision changed. | acting head |
| **1.2.0** | **2026-09-06** | **MINOR — the SECOND fold. The security lens LIFTS its REJECT to ACCEPT-WITH-CHANGES and the invariant review its BLOCK to PASS-WITH-NOTES, and both re-checks found ONE thing v1.1.0 got half-right rather than wrong.** **F-A is why this is a minor and not a patch: the F1 repair was HALF-APPLIED.** The `agrees` gate covered the RETIREMENT only, so on the three compliance topics an `unknown` verdict still attributed the obligation to the tenant named by the **UNSIGNED HEADER**, with an outbox job behind it — the probe wrote a `privacy_request` under an unrelated shop. The record meanwhile said four times that a wrong guess about A4 costs at worst *a token was not retired*, which was false for exactly that half. **The ruling is the code and not the wording: ONLY an `agrees` verdict attributes a tenant.** An `unknown` records the obligation with `shop_id = NULL` (R2's bucket — on the clock, counted by the audit as unresolved-tenant), takes NO per-shop rate token (§7.5's ceiling bounds that path instead) and enqueues nothing; `mismatch` stays a pre-transaction refusal. The four sentences are KEPT and now cite the code. **R1 is DOWNGRADED from *self-enforcing*:** since F-A a store with no recorded grant has a null tenant and is never enqueued, so `no_recorded_grant` is unreachable from the shipped producer — the branch stays as stated defence-in-depth, and I19's test says out loud that it constructs the job by hand. **R7 moves from ASSERTED to TESTED**: a two-connection case races classify-and-insert (which `consumer-idempotency` does not — that races the CONSUMER), and §4.3 now says what makes the lock key untunable, which is F1: with the store taken from the signed body, no part of `(connector, topic, shop_domain, payload_digest)` is caller-chosen. Paperwork: 056's I13 amendment moved INSIDE its Invariant cell (a fourth cell is dropped by GFM), 016's §7 append restated at the folded state, `tests/RTM.md`'s stale *four tables* → six and I16–I21 rejoined to one table, the INDEX's 056 label re-cut, *three floors* → **four** in CLAUDE.md and §13, A3 given its closing evidence and owner, §2.1 given a preserved-positions line for `TOPIC_DOMAIN_FIELD`'s two-candidate list, and §9 R3's *adopted* corrected to **deferred**. `outstandingPrivacyRequests` takes `DISTINCT ON`, so *adds a column and changes no row* is a property of the STATEMENT rather than of today's code. | second cannon fold → `longbox-security-tenancy-builder` |
| **1.1.0** | **2026-09-06** | **MINOR — the four-review cannon is folded in ONE pass and NOTHING is declined. Two verdicts were refusals (`security-auditor` REJECT, `longbox-invariant-reviewer` BLOCK) and both are about the SAME chain, reproduced independently.** **§2's builder drafts are STRUCK** and both position statements go in verbatim with their verdicts; **§2.1 is the fold table**. **The finding that decides the version: F1 (CRITICAL).** v1.0.0 correctly identified that the HMAC covers the body and no header — and then applied that finding to TWO of the three headers that matter. `X-Shopify-Shop-Domain` **selects which shop's tokens are destroyed and which tenant an obligation is attributed to**, and it was treated as evidence: one captured signed message from any store (the isolated dev store this record names as its own closing evidence will do) retired an unrelated shop's live token and wrote a forged privacy obligation under that shop's tenant — an unauthenticated cross-tenant WRITE, 019 T24's shape — with the domain substitution simultaneously evading the body-digest detector, because the digest key was scoped by the same unsigned value. §4.0 is new: **the store comes from the SIGNED BODY and the header is a value checked against it**, refused before any row. **F2**: `triggered_at` was bounded only in the PAST, so a future value was never stale and pushed the retirement cutoff arbitrarily forward — a future stated time is now treated as ABSENT and the cutoff is CLAMPED at `now`. **F3 + invariant finding 1**: a WINDOW-scoped body key is a clock the attacker only has to outwait, so §5.1's counter-example came back — `TOPIC_POLICY` gains `replayLookback`, and `app/uninstalled` is **absolute** on §5.1's own disambiguator (two byte-identical uninstall payloads are the same uninstall). **F4**: `grantCouldReachACustomer([])` is FALSE, so a store with no recorded grant was answered automatically by a check that examined nothing — R1 becomes **self-enforcing** rather than merely stated. **F5**: a per-domain ceiling on null-tenant compliance obligations, and the record's *"only Shopify or a secret holder"* sentence is corrected — a replayer needs no secret. **F6**: two false sentences in `src/contracts/v1/routes.ts`. **K2**: §4.3 over-claimed — a concurrent replay of one body can produce two independently-clocked OBLIGATIONS, each fulfilled at most once, and the true guarantee is *no double effect per obligation*; an advisory lock serialises the detector. **K6**: the audit says WHY a request is still outstanding. **B1**: 056 → v1.4.0. **B4**: the 25-day window gets a derivation. **B6**: a non-auto-fulfillable topic gets its own NON-guard reason. **Four statements this record made are STRUCK as FALSE** — §12's forged-triggered_at row, §0 A3's framing, §4.2's presentation of `stale` as a defence against the deliberate adversary, and §5's implicit assumption that the store domain was trustworthy. | four-review cannon → `longbox-security-tenancy-builder` |
| 1.0.0 | 2026-09-06 | Initial record, **PROPOSED**. Five decisions: the two adversaries are separated and each gets its own key (§4); the per-topic ordering table, in which `app/uninstalled` is **not commutative** and is bounded by its own event time (§5); the privacy WORKFLOW is an append-only obligation with a stored clock and a fulfilment fact, and outstanding is a PREDICATE (§6); the fulfilment of the two customer topics is an outbox JOB with a fail-closed guard, and `shop/redact` deliberately gets none (§7); and the event catalogue gains a tenth name under `platform`, which required 043 §3.3's exclusion rule to be narrowed rather than ignored (§8). §9 is the honest half: four residuals, three of them named to existing beads. | `longbox-security-tenancy-builder` (E03-B08) |

---

## 0. Evidence posture

Per 018 §2 A1/A3.

**REPRODUCED** — read out of the tree at `550c4f9` (`origin/main` at branch point) and re-read at the folded head: `connector_webhook_receipt`'s columns and its `UNIQUE (connector, webhook_id)` (`migrations/026:256-286`); `receiveWebhook`'s ordering — HMAC, then tenant resolution, then one transaction (`src/services/connectors/shopify/api.ts`); `retireEveryLiveTokenForDomain`'s unbounded `WHERE` (same file, pre-change); `outbox.shop_id NOT NULL` and `UNIQUE (shop_id, event, ref_table, ref_id)` (`migrations/011`); the `outbox_dead_letter` view's hard-coded reason list (same file); the nine-name catalogue and its `command` count of one (`src/events/catalogue.ts`, `tests/contract/event-catalogue.test.ts`); the declared cross-tenant scopes and the four service-write tables (`src/db/{tenantContext,rowLevelSecurity}.ts`); and **000-docs/005, which names no inbound webhook topic at all** — the fact §5.4 turns into a ruling.

**ASSERTED, on the provider's documented behaviour and NOT verified against a store** — FOUR at v1.1.0, and every one is signed open in 043 A11's idiom:

* **A1. The webhook HMAC covers the request BODY and no header.** This is the load-bearing assumption of §4, and it is the one that would most change the design if wrong. ⚠ **v1.0.0 stated it and then applied it to only TWO of the three headers that matter** — the security lens CONFIRMED A1 against `verifyWebhookHmac` and then found `X-Shopify-Shop-Domain`, the header that selects the victim, treated as evidence (F1). The assumption was right; the application of it was not, and §4.0 is the repair. **Its closing evidence:** one signed delivery against the isolated dev store named in `.env.example`, with a header mutated and the signature unchanged — if it still verifies, the assumption holds; if it does not, §4's two-adversary split is over-engineering and the body key can be retired.
* **A2. Shopify retries a failing webhook over roughly 48 hours**, which is where `WEBHOOK_RECEIPT_WINDOW_SECONDS` comes from. A wrong number here is a wrong PROVISIONAL floor, not a wrong mechanism: the same code with a different constant is still correct. **Closing evidence:** the first week of real delivery ages, which E10-B05's watcher is the first thing to produce.
* **A3. `X-Shopify-Triggered-At` is present on the topics this build subscribes to.** A missing header is handled — the message is accepted and the uninstall's bound is unbounded (§5.3) — so a wrong guess degrades to E03-B06's shipped behaviour rather than to a refusal. ⚠ **NARROWED at v1.1.0 (F3):** v1.0.0's framing let this read as though a missing or forged timestamp were harmless because the body key would catch it. **It was not.** The invariant reviewer reproduced §5.1's counter-example by simply OMITTING the header, and the security lens reproduced it by outwaiting the window — so what makes a missing timestamp safe is not this assumption but `app/uninstalled`'s ABSOLUTE `replayLookback` (§5.3) together with §4.0's signed domain. This assumption now claims only what it says: the header is usually there, and its absence costs precision rather than safety. **Closing evidence and owner (the gate re-audit's note): it is DISCHARGED BY A1's delivery** — the same signed message against the isolated dev store shows whether `X-Shopify-Triggered-At` is present, so it needs no probe of its own and it belongs to **E03-B10**.
* **A4. The store a topic's payload names is ONE OF TWO CANDIDATE FIELD NAMES per topic** — `myshopify_domain` then `shop_domain` on `app/uninstalled`, and the reverse on the three compliance topics (`TOPIC_DOMAIN_FIELD`, an ordered list; §2.1's preserved-positions line records why it is a list rather than the single name the ruling asked for). This is new at v1.1.0 and it is F1's repair standing on an unverified field name — 018 makes a third party's interface an assumption rather than a fact, and no call to Shopify's documentation or to a store was made. **Its closing evidence is A1's, in the same delivery** (E03-B10). **A wrong guess fails CLOSED, and since v1.2.0 that is true on BOTH halves.** An unreadable shape yields `unknown`, which RECORDS the message, refuses the DESTRUCTIVE effect **and attributes no tenant** (§4.0) — so the worst outcome is *a token was not retired and an obligation was recorded against nobody*, never *the wrong shop's token was* and never *an obligation was written under a shop the unsigned header chose*. ⚠ **v1.1.0's version of this sentence was FALSE for the compliance half**: the `agrees` gate covered the retirement only, and the probe wrote a `privacy_request` under an unrelated shop with a job behind it. The sentence is kept because the CODE changed to make it true (`api.ts`: `signedDomain === "agrees" && shopIds.length === 1`), not because the wording was softened.

**MEASURED** — nothing. No latency, no delivery-age distribution and no rate figure is claimed anywhere in this record, and the FOUR numbers it does state are PROVISIONAL FLOORS with their derivations written beside them — the receipt window (§4.1), the clock-skew band (§5.2), the fulfilment window (§6.1) and the unresolved-domain ceiling (§7.5). *(v1.0.0 said "two", and 016's append said "three"; both were wrong and the gate audit's B4 caught the disagreement. Four is the count as built.)*

**NOT CLAIMED** — that this closes 019 T32 or T33; that the fulfilment window is anybody's deadline; that `no_data_held` is a legal position; that a privacy request is answered by recording it. §9 says what each of those still waits on.

---

## 1. What exists today, REPRODUCED at `550c4f9`

E03-B06 (000-docs/053) landed the inbound surface and it is good. **This record does not redo any of it**, and the list is here so a reader can tell what is new from what is being extended:

| Already shipped (053) | Where |
|---|---|
| The HMAC is verified over the RAW body before any row is read or written; a forged message costs one HMAC and leaves zero rows in five tables | `policy.ts:verifyWebhookHmac`, `api.ts:receiveWebhook`, asserted by row counts |
| `connector_webhook_receipt` with `UNIQUE (connector, webhook_id)`, read out of `migrations/` by a contract test | `migrations/026`, `tests/contract/csrf-mechanisms.test.ts` |
| `app/uninstalled` retires every live token version for the STORE and cites the signed message that caused it (a CHECK requires it) | `api.ts`, `migrations/026` |
| The three compliance topics are acknowledged and recorded as facts with a digest and NO payload, routed to E03-B09 | `policy.ts:COMPLIANCE_TOPICS`, 053 §9 |
| `provider-callback` as an auth-allowlist kind, with both replaced mechanisms declared per route | `src/contracts/v1/`, 042 §5.1 class two |

**And three things it did not do, which is this bead's whole subject.**

1. **The dedupe key is a HEADER.** `UNIQUE (connector, webhook_id)` keys on `X-Shopify-Webhook-Id`, which the signature does not cover. It answers the provider's at-least-once delivery exactly and answers a deliberate replay not at all.
2. **Nothing bounds how OLD a message may be.** A signed message from two days ago is acted on identically to one from two seconds ago.
3. **A privacy topic produced a receipt and nothing else** — no obligation, no clock, and therefore no way for *nobody answered* to be a finding rather than a silence. 053 §9 says exactly this and routes it here and to E03-B09.

---

## 2. The cannon — DISPATCHED, four reviews, two of them refusals

**v1.0.0's §2 carried BUILDER DRAFTS of two lens positions and labelled them as such. They are STRUCK.** They are not reproduced, because keeping a reconstruction beside the real thing invites a reader to average them — and the real thing is much worse than the reconstruction was. The drafts guessed that a lens would press on A1's verification and on the read-then-write shape. A lens did press on both. It also found that **the design applied its own central finding to two of the three headers that matter**, which no draft anticipated and which made the first verdict a refusal.

**061 v1.1.0 is the standing precedent for why this section exists**: there, a real lens falsified two of that record's own claims. Here it falsified four.

| Lens | Verdict |
|---|---|
| `security-auditor` | **REJECT** — *"a re-submission, not a redesign; ~30 lines api.ts/policy.ts, ~5 consumer, three tests"* |
| `longbox-invariant-reviewer` | **BLOCK** — the same chain, independently reproduced |
| `longbox-gate-auditor` | **NOT-READY**, six blockers |
| `martin-kleppmann-reviewer` | **ACCEPT-WITH-CHANGES** |

### The consistency lens (`martin-kleppmann-reviewer`) — ACCEPT-WITH-CHANGES

> The per-topic ordering table is the right abstraction and `app/uninstalled`'s event-time bound is sound for every interleaving I traced, including the concurrent-commit case the record didn't spell out (transaction visibility handles it, not the guard band — say so); the window-scoped replay detector is correctly *not* the idempotency mechanism and every effect I checked sits behind an independent database constraint, so no delivery interleaving produces a double effect; but the claim that a concurrent replay costs merely "two receipts, not two effects" is narrower than what's true for `customers/data_request` and `customers/redact` — under true concurrency it can produce two independently-clocked, independently-audited `privacy_request` obligations from one replayed body, each still fulfilled at most once, and that distinction belongs in the record's own words before it is signed, not left for a reader to derive by tracing the code as I just did.

### The security lens (`security-auditor`) — REJECT

> The security lens finds that E03-B08 correctly identifies that Shopify's HMAC covers the body and nothing else, and then applies that finding to two of the three headers that matter. `X-Shopify-Webhook-Id` and `X-Shopify-Triggered-At` are treated as adversary-chosen and bounded; `X-Shopify-Shop-Domain` — the header that selects which shop's tokens are destroyed and which tenant an obligation is attributed to — is treated as evidence, and it is not: a single captured signed message from any store, including the isolated dev store this record names as its own closing evidence, retires an unrelated Longbox shop's live connector token and writes a forged privacy obligation under that shop's tenant, with the domain substitution simultaneously evading the body-digest detector because the digest key is scoped by the same unsigned value. Two further defects compound it: `triggered_at` is bounded only in the past, so a future value is never stale and pushes the retirement cutoff arbitrarily forward, disabling Decision B for exactly the adversary it was written against; and the body key's window is a clock the attacker need only outwait, so the same captured bytes replayed after forty-eight hours under a fresh id kill a token introduced by a re-install — the counter-example in §5.1, restored. Separately, the automatic `no_data_held` answer passes on an empty recorded-grant set, which converts residual R1 from a stated limitation into a record that cannot be distinguished from a real check. The design's instincts are right — two adversaries, two keys, refusals recorded rather than dropped, a constant answer on the wire, a job because a guard can refuse — and the fixes are one comparison, one per-topic field, one equality check against the signed bytes, and one fail-closed branch. Until those land, §5's ruling and §12's row asserting that a forged header buys nothing are statements this lens cannot sign.

#### The same lens, RE-CHECKED at `d31416e` — ACCEPT-WITH-CHANGES (REJECT lifted)

**Appended, not substituted.** A re-check adds a verdict to the record; it never rewrites the one that was given. The refusal above is what the design earned at `30c2501` and stays legible as such.

> The security lens re-probed E03-B08 at `d31416e` and lifts its refusal to **ACCEPT-WITH-CHANGES**. All four findings are fixed at the mechanism and each fix was reproduced: a captured message re-addressed at another tenant is refused before any row on both the destructive and the compliance half, with the receipt table unchanged and the same message a caller with unusable headers gets; a future `triggered_at` is treated as absent and `retirementCutoff` is clamped at `now`; the patient replay of §5.1 — outwaiting the window, with `triggered_at=now` and with the header omitted — returns `replayed_body`, retires nothing and leaves the re-installed token live; the per-domain ceiling binds at exactly its floor; and the advisory lock reduces two concurrent deliveries of one body to one obligation without creating a serialization point an attacker can aim, because after F1 no part of the lock key is caller-chosen. What this lens will not sign is a claim the record makes four times — that a wrong guess about A4 costs at worst *a token was not retired*. It does not: the `agrees` gate covers the retirement only, so on the three compliance topics an unreadable payload is still attributed to the tenant named by the **unsigned header**, and a probe wrote a `privacy_request` under an unrelated shop with an outbox job behind it. If the field names in `TOPIC_DOMAIN_FIELD` are wrong, F1's repair is off for the privacy half while reading as on — which is the exact condition those sentences exist to bound. Separately, R1's *"self-enforcing since v1.1.0"* is false: a shop with no recorded grant resolves to a null tenant and is never enqueued, so `no_recorded_grant` is unreachable from the shipped producer and its test reaches it only by hand-writing the outbox row. Both are corrections to the record's own words rather than to its code — narrow the four A4 sentences to `app/uninstalled`, say in R9 that the compliance cross-tenant write survives an `unknown` verdict, downgrade R1 from self-enforcing to stated-with-a-defence-in-depth-branch, and qualify `routes.ts:195-200` the same way. With those four edits this lens signs.

**The acting head ruled the OTHER WAY on the first of those four, and the difference is the whole of F-A.** The lens offered a wording fix — narrow the sentences to `app/uninstalled`. The ruling took the code instead: **only an `agrees` verdict attributes a tenant.** A record that narrowed its own claim would have left the compliance half attributing an obligation from an unsigned header and merely stopped saying otherwise; §4.0's rule is worth more than the sentence that describes it. The other three corrections are taken as offered.

**The lens also cleared four things, and they are recorded because a clearance is evidence too:** the wire oracle is clean (a constant `{acknowledged: true}` for every disposition); §7.2's scope widening is *exactly as declared* — probe P4 confirmed the inbound scope SELECTs every shop's `outbox` and that **no path returns it**, so R3 is latent rather than live; and both CLIs are honest about what they do and do not perform. One minor was noted inside the clearance and is **DEFERRED**, not adopted: the `service_write` check pins the event name but not `ref_table`/`ref_id`. It is left as declared and carried in §9 R3 rather than widened here, because narrowing it further needs the row condition E03-D35 proposes.

### 2.1 The fold — what each finding changed

**Nothing is declined.** Where something is adopted in a shape the lens did not literally ask for, the row says so.

| Finding | Ruling | Where it landed |
|---|---|---|
| **F1** CRITICAL — the store domain is an unsigned header that selects the victim | The store comes from the SIGNED BODY (`TOPIC_DOMAIN_FIELD`, `checkSignedDomain`); the header is a value checked against it; a mismatch is refused at the existing pre-transaction branch with the SAME message, so the refusal discloses nothing. Where a topic's payload carries no readable domain, the message is RECORDED and the DESTRUCTIVE effect is refused. | §4.0; `policy.ts` `domainInSignedBody` / `checkSignedDomain`; `api.ts` before the digest; §0 A4 |
| **F2** HIGH — a future `triggered_at` is never stale and pushes the cutoff forward | A stated time beyond `now + skew` is treated as ABSENT (`usableTriggeredAt`), and `retirementCutoff` is CLAMPED at `now`. | §5.2; `policy.ts` |
| **F3** HIGH + **invariant finding 1** — a windowed body key is a clock the attacker outwaits | `TOPIC_POLICY` gains `replayLookback`; `app/uninstalled` = `absolute` on §5.1's own disambiguator; the three commutative topics keep `window`. §12's row, §0 A3, §4.2 and `migrations/038`'s header comment are all NARROWED — each asserted something the probes falsified. | §5.3; `policy.ts`; `migrations/038` header |
| **F4** — `grantCouldReachACustomer([])` is false, so an empty grant set answered vacuously | Zero recorded `connector_token_version` rows → dead-letter `no_recorded_grant`, `guard_refusal = true`. **R1 was called *self-enforcing* here at v1.1.0 and that is STRUCK** — see the second-fold row below: since F-A the branch is unreachable from the shipped producer, so R1 is *stated, with a defence-in-depth branch*. | §7.3; `privacyRequestReceived.ts` |
| **F5** — a compliance flood under invented domains | A PROVISIONAL per-domain ceiling on null-tenant obligations, with its derivation beside it; and the record's *"only Shopify or a secret holder"* sentence is corrected — **a replayer needs no secret**. | §7.5, §4.4; `.env.example` |
| **F6** LOW — two false sentences in a contract artifact | Both rewritten to what is true after F1. | `src/contracts/v1/routes.ts` |
| **F7** LOW — three missing tests | Added beside I4/I5/I10: future `triggered_at`, header/body mismatch (both the uninstall AND the compliance cross-tenant write), zero recorded grant. | I16–I19 |
| **invariant 2** — `PRIVACY_REQUEST_FULFILMENT_WINDOW_DAYS` documented and read by nothing | Wired through `loadWebhookWindows` and the composition root, like the other two. | `policy.ts`, `src/app.ts` |
| **K1** — the concurrent-commit interleaving is unstated | §5.2 says it: transaction visibility resolves it, not the guard band. | §5.2 |
| **K2** — §4.3 over-claims | The narrower true guarantee is stated in the record's own words, and an advisory lock serialises classify-and-insert as a DETECTOR (043 §3.2 untouched). Residual in §9 R7. | §4.3, §9 R7; `api.ts` |
| **K6** — an overdue row does not say why | `pnpm audit:privacy-requests` gains the dead-letter reason via a LEFT JOIN, with ONE overdue predicate. **This replaced the proposed follow-up bead; no new bead.** | §6.4; `privacy.ts`, `scripts/audit-privacy-requests.ts` |
| **K5** — the tenth event's criterion should be reusable | The 043 amendment states it as a PREDICATE, not a one-instance carve-out: *a table produces an event when a consumer outside the writing module needs to act on it, INCLUDING when that consumer is a job whose refusal must survive the producing transaction.* | 043 §3.3's block; §8 |
| **B1** — 056 v1.3.0 reversed with no amendment | 056 → **v1.4.0** MINOR, change-log row + three blocks (§5.0, §5.3, I13). | 056 |
| **B2** — no 016 §1 row | Added. | 016 §1 |
| **B4** — the 25-day window has no derivation | §6.1 derives it, and the *"two numbers"* / *"three numbers"* disagreement is settled at **four**. | §6.1, §0 |
| **B5** — CLAUDE.md states A1 as fact | Qualified as an assumption signed open with its closing evidence, plus the F1 sentence. | CLAUDE.md |
| **B6** — a false sentence in `outbox_dead_letter` | `privacy_topic_not_auto_fulfillable`, a NON-guard reason, pinned by a test. | §7.4; `outbox.ts` |
| 043 nit — the v1.2.0 row sits mid-table | Moved last, ascending. | 043 |
| **F-A** (security re-check 1 / gate F-A) — the F1 repair was HALF-APPLIED | **Only an `agrees` verdict attributes a tenant.** `unknown` → `shop_id = NULL`, no per-shop rate token, no job. Adopted DIFFERENTLY from the lens's offer, which was a wording narrowing — see the note under §2's re-check paragraph. | §4.0; `api.ts`'s `shopId` resolution; I22 |
| **security re-check 2** — R1 is not self-enforcing | Downgraded to *stated, with a defence-in-depth branch*: the branch is unreachable from the shipped producer since F-A, and I19's test says it constructs the job by hand. | §7.3, §9 R1; `outbox.ts`'s JSDoc; the test's own comment |
| **security re-check 3** — `routes.ts` true for `mismatch`, false for `unknown` | One clause added. | `src/contracts/v1/routes.ts` |
| **security re-check 4 / gate note** — R7's lock claim was ASSERTED | A two-connection integration case races classify-and-insert, and §4.3 says **F1 is what makes the lock key untunable**. | §4.3; I20a |
| **gate F-B / F-C / F-D + notes** — rendering and stale facts | 056's I13 amendment moved inside its cell; 016's §7 append restated at the folded state; `tests/RTM.md`'s *four tables* → six and I16–I21 rejoined to one table; the INDEX's 056 label; *three floors* → four; A3's closing evidence; §9 R3 *adopted* → **deferred**; `outstandingPrivacyRequests` takes `DISTINCT ON`. | as listed |
| **B3** — register collision with PR #100 | **LANDED at `fab9fc2`.** Released after #100 merged (squash `7175552`); the branch is rebased onto `8068a58` with linear history, the ledger reads **37** (`036` + `037` + `038`, and `027` is once again the only gap because `037` closed the one it briefly held), and the registers are one increment above main: **006 1.85.0 · 000-INDEX 1.44.0 · 016 1.32.0**. No fixture is owed — `after-035` is 34 against a head of 37. | 006, 000-INDEX, 016, `tests/integration/migrations.test.ts` |

---

### 2.2 Positions adopted DIFFERENTLY from the ruling — preserved, in 061's shape

**Nothing was declined. Two things were adopted in a shape the reviewer did not literally ask for, and both are recorded here rather than left for a reader to notice.**

**(a) `TOPIC_DOMAIN_FIELD` is an ORDERED TWO-CANDIDATE list per topic, not one field name.** The ruling said *parse the signed body ONCE for its domain field (`myshopify_domain` on `app/uninstalled`, `shop_domain` on the three compliance topics)*. The code declares `["myshopify_domain", "shop_domain"]` for the uninstall and the reverse for the compliance topics, first present wins.

> **The builder's reason.** A4 is unverified, and the failure mode of a narrow guess is not neutral: a wrong single name yields `unknown` on every delivery, which refuses the retirement — so an uninstall would quietly stop ending anything, and the receipt table would fill with correctly-recorded messages that did nothing. A candidate list cannot weaken the check, because whichever name is found must still EQUAL the header and both candidates are inside the bytes the signature covers; what it buys is that one wrong guess about a third party's payload does not disable the control. The ordering is canonical-name-first so that a payload carrying both is read the same way every time.

**(b) F-A took the CODE where the lens offered a WORDING fix.** The security re-check asked for the four *worst outcome* sentences to be narrowed to `app/uninstalled`. They are kept as written, and the tenant attribution moved instead. A narrowed sentence would have been true and would have left the compliance half attributing an obligation from an unsigned header; the rule is worth more than the sentence describing it.

---

## 3. The two adversaries, stated once because everything else follows from it

> **Shopify's webhook HMAC covers the RAW BODY and nothing else. Every header is outside it.**

That single fact splits this bead's subject in two, and one mechanism cannot serve both halves:

| | Who sends it | What they control | The key that binds them |
|---|---|---|---|
| **Accidental** | the provider, retrying | nothing — the headers are Shopify's own | `X-Shopify-Webhook-Id`, already shipped (053 §5.5) |
| **Deliberate** | anyone holding one captured message | **EVERY header** — the id, the timestamp **and the store domain** | `sha256(body)` for the repeat, and **the store named inside the body** for the target (§4.0) |

⚠ **v1.0.0's version of this table listed two headers and stopped.** It named the id and the timestamp as adversary-chosen and did not name `X-Shopify-Shop-Domain` — which is the one that decides WHOSE tokens an uninstall destroys and WHICH tenant an obligation is attributed to. The consequence was not subtle: one captured signed message re-addressed at another shop, and the same edit moved the body-key tuple so the replay detector never fired. The security lens's F1, and §4.0 is the repair. **A key that binds a REPEAT is not the same as a key that binds a TARGET, and this record needed both.**

**Why the accidental case still gets a header-derived defence.** Because in that case the header is EVIDENCE: the sender is Shopify, and Shopify's own id and event time are the best available statements about which delivery this is and when it happened. A control that is worthless against an attacker is not worthless against a retry, and the two are different failure modes with different frequencies — the retry happens weekly and the replay may never happen at all.

**Why the deliberate case cannot be answered by a header.** An attacker who can present a valid HMAC is presenting bytes Shopify signed; the only thing they cannot vary is those bytes. So the key must be over the bytes, and `payload_digest` — a column 053 already required for a completely different reason (041 §8.4: the log holds references and not values) — turns out to be exactly it. That is a pleasant accident and it is recorded as one: the digest is not there because somebody anticipated replay.

---

## 4. Decision A — Each adversary gets its own key, and every refusal is RECORDED

### 4.0 The store comes from the SIGNED BODY, and the header is checked against it

**This section is F1's, and it is first because everything after it depends on the store being a value this system verified rather than one a caller supplied.**

`X-Shopify-Shop-Domain` is a header, so §3's rule applies to it — and v1.0.0 did not apply it. The probe the security lens ran is three lines: take one signed message from ANY store (the isolated dev store this record names as its own closing evidence will do), change the header to a victim's domain, deliver it.

* on **`app/uninstalled`**: the tenant resolution keys on the header, finds the victim's token versions, and **retires them**. `retired = 1` on a shop that was never uninstalled.
* on **`customers/redact`**: a `privacy_request` is written **under the victim's `shop_id`** — an unauthenticated cross-tenant WRITE, which is 019 T24's shape reached with no credential at all.
* and in both: the body-key tuple is `(connector, topic, shop_domain, payload_digest)`, so **substituting the domain evades the replay detector by the same character change**.

> **The ruling: the store is the one named INSIDE the signed bytes. The header is a value checked against it, and a disagreement is REFUSED before any row.**

`TOPIC_DOMAIN_FIELD` maps each topic to its payload's own field — `myshopify_domain` on `app/uninstalled`, `shop_domain` on the three compliance topics — and `checkSignedDomain` returns one of three answers:

| Answer | What happens | Why |
|---|---|---|
| `agrees` | everything proceeds | the domain is now a signed value |
| `mismatch` | **refused at the pre-transaction branch, zero rows** | one captured message re-addressed at another tenant. It costs one HMAC and one `JSON.parse`. |
| `unknown` | the message is **RECORDED and acknowledged**; any DESTRUCTIVE effect is **refused** | this build could not read a store out of this payload |

**The refusal reuses the existing branch and the existing message**, deliberately: from outside, *your headers are unusable* and *your body names a different store* are ONE answer (053 §8.3's constant answer). Distinguishing them would confirm both that the captured message is authentic and that the target store exists.

**And `unknown` is not a hole, it is the fail-closed direction for an ASSUMPTION.** The field names are §0 A4 — an unverified claim about a third party's payload — so the design has to be safe when the guess is wrong. It is: an unreadable shape records the message (so a `customers/redact` is never silently lost, 053 §9), refuses the retirement (so a token is never destroyed on a store nobody verified), and **attributes no tenant** (so an obligation is never written under a shop the unsigned header chose).

⚠ **THE THIRD CLAUSE IS v1.2.0's, AND WITHOUT IT THE SENTENCE BELOW WAS FALSE — F-A.** v1.1.0 gated the RETIREMENT on `agrees` and left the tenant resolution keyed on the header, so on the three compliance topics an unreadable payload was still attributed to the victim the header named, with an outbox job behind it. The security re-check's probe wrote exactly that row. **The repair was off for the privacy half while this section read as though it were on** — which is the precise condition these sentences exist to bound. So the sentences are KEPT and the CODE moved to make them true (`api.ts`, the `shopId` resolution):

```ts
const shopId = signedDomain === "agrees" && shopIds.length === 1 ? shopIds[0]! : null;
```

Three consequences follow from that one line and all three are wanted: the receipt and any obligation carry a NULL resolution (053 §5.5's own case), **no per-shop rate token is taken** (there is no shop to charge — §7.5's unresolved-domain ceiling bounds this path instead), and **nothing is enqueued**, because the enqueue already required a tenant.

**The worst outcome of a wrong guess is therefore *a token was not retired and an obligation was recorded against nobody*** — on the clock, counted by `pnpm audit:privacy-requests` as unresolved-tenant, and answerable by a person — **and never *the wrong shop's token was*, and never *an obligation under a shop the header chose*.**

### 4.1 The receipt window is a PROVISIONAL FLOOR with a stated derivation

`WEBHOOK_RECEIPT_WINDOW_SECONDS = 48 × 60 × 60`.

**The derivation, so it can be argued with rather than inherited (A2):** the provider retries a failing webhook with backoff over roughly 48 hours before giving up. A message older than that horizon is one the provider itself would no longer be sending, so refusing it costs nothing a legitimate retry would have delivered — and accepting it means acting on a fact about a world that has had two days to change.

It is a floor and not a measurement, and §0 A2 names its closing evidence. **Raise it with data, never to make a test pass.**

### 4.2 A refused message is RECORDED, and the answer on the wire is unchanged

`connector_webhook_receipt` gains `triggered_at timestamptz` (nullable) and `disposition text NOT NULL DEFAULT 'accepted'` with a CLOSED three-value CHECK:

* **`accepted`** — authentic, timely, and not a repeat of bytes seen inside the window. Its effects ran.
* **`stale`** — authentic and older than the window. Refused, and the receipt is the evidence it arrived. ⚠ **NARROWED at v1.1.0 (F3): `stale` is a control against a LATE RETRY and NOT against the deliberate adversary.** v1.0.0 presented it as part of the replay defence; the security lens declined to sign that, correctly — a replayer sets `triggered_at` to `now`, so staleness never fires for them. What binds a deliberate replay is §4.3's body key under §5.3's per-topic lookback, and what binds the TARGET is §4.0.
* **`replayed_body`** — authentic and byte-identical to a message already received for the same connector, topic and store inside the window, under a DIFFERENT id. No effect ran. **This is the one the unsigned id header cannot catch.** ⚠ *(v1.1.0: "inside the window" is now per topic — see §5.3. For `app/uninstalled` the lookback is ABSOLUTE.)*

> **Recording a refusal is not optional here, and 053 §9 is why**: *"a privacy request this system silently discarded is the failure that reads as compliance until somebody asks."* A dropped message makes the receipt table say a message never arrived, which is a false statement in the one artifact 041 §8.2 forbids untrue statements in.

**The wire answer is the SAME for all three**, and for a duplicate, and for a first delivery: `200` and `{acknowledged: true}`. 053 §8.3's constant-answer reasoning applies one layer over — a body that told a caller *your replay was detected* is a fact about this system's state handed to something that authenticated with a shared secret rather than as a tenant. **And `200` rather than a 4xx for a deliberate refusal is itself a decision**: a 4xx makes Shopify retry for 48 hours a message this system has already decided about, which converts one refusal into nineteen.

**`topic` stays OPEN-WORLD and `disposition` is CLOSED, and the asymmetry is the point.** `topic` is the PROVIDER's vocabulary and a CHECK on it turns an authentic-but-unrecognised message into a 500 and a retry storm (053 §5.5). `disposition` is THIS system's vocabulary, and a fourth value would be a fourth meaning that ought to cost a decision.

**One sentence v1.0.0 wrote about who can reach this path is STRUCK (F5).** It said, in effect, that only Shopify or somebody holding the app secret can produce a message this route accepts. **That is wrong, and the error is the same one F1 found in a different place: a replayer needs no secret.** They need one captured message, and they may then vary every header — which is why §7.5 adds a ceiling on what a stream of them can accumulate, and why §4.0 stops the one that mattered.

### 4.3 The body key is a DETECTOR — window-scoped or absolute per topic — and it is not the idempotency mechanism

The lookup — newest earlier receipt with the same `(connector, topic, shop_domain, payload_digest)` — is a `SELECT` before an `INSERT`, which is the shape 043 §3.2 forbids. **It is not forbidden here, and the distinction is not a loophole:**

* **Exactly-once for a DELIVERY is still decided by constraints**: `UNIQUE (connector, webhook_id)` on the receipt, `UNIQUE (connector, webhook_id)` on the obligation, `UNIQUE (privacy_request_id)` on the fulfilment, `UNIQUE (connector_token_version_id)` on the retirement. Not one of them was weakened.
* **The race this read admits is two concurrent replays both missing**, and v1.0.0 said its cost was *"two receipts, not two effects"*. ⚠ **That is NARROWER than the truth and the consistency lens's K2 is right about it.** Under true concurrency neither transaction sees the other's uncommitted receipt, both classify `accepted`, and both carry a DIFFERENT `webhook_id` — so on `customers/data_request` and `customers/redact` the result is **two independently-clocked, independently-audited `privacy_request` OBLIGATIONS from one replayed body**, each still fulfilled at most once. The true guarantee, in this record's own words rather than left for a reader to trace: **no double EFFECT per obligation — not no double obligation.**
* **A transaction-scoped advisory lock now serialises classify-and-insert**, keyed on a hash of `(connector, topic, shop_domain, payload_digest)`. It is a DETECTOR'S SERIALISATION and not an idempotency mechanism, which is why 043 §3.2 is untouched: removing it produces no double effect, only a double obligation. `pg_advisory_xact_lock` releases at COMMIT or ROLLBACK with no unlock path to forget, and it takes NO position in 042 §5.3(b)'s order because it is taken on a hash rather than on a row, as the first statement of the transaction. What it does not close is §9 R7. **And F1 is what keeps its key UNTUNABLE ON THE `agrees` PATH**, which the security re-check probed for and cleared: the key is `(connector, topic, shop_domain, payload_digest)`, and where the body's domain AGREES none of those four is caller-chosen — the domain comes from the signed body and the digest is over those same bytes. **Remove F1 and `shop_domain` is a header again**, at which point an attacker picks the key and can serialise a chosen shop's webhook traffic. A lock whose key an adversary chooses is a denial-of-service primitive wearing a correctness argument, which is why these two mechanisms cannot be reasoned about separately. ⚠ **The qualifier is load-bearing: under an `unknown` verdict the key REVERTS to a caller-chosen value.** F-A stops an unreadable payload attributing a TENANT; it does not make the header stop keying the digest lookup or this lock, because at that point there is no signed domain to key them on instead. What bounds that path is §7.5's per-bucket ceiling and not this lock, and §9 R9 carries what the ceiling does not close.
* **The lookback is PER TOPIC (§5.3), and v1.0.0 made it window-scoped everywhere.** For a REQUEST the window is right: two byte-identical messages years apart are two obligations, and an absolute key would make the second `customers/redact` disappear — worse than recording a replay twice. For `app/uninstalled` it was WRONG, and F3 is the correction: a window there is a clock the attacker only has to outwait.

**Staleness is decided BEFORE the body key**, and the order is stated because it is arbitrary-looking and is not: a message that is both late and a repeat is more usefully recorded as `stale`, because *something is delivering very late* is the fact a human reading the receipt table needs, while *we have seen these bytes* is a fact this system already holds.

### 4.4 `disposition` is not a status column, and the test is whether anything ever writes it twice

Nothing does. It is set once, at INSERT, on a table with an `ENABLE ALWAYS` append-only trigger, and it records **a decision made at a moment** rather than a state that moves. 041's objection to a status column is that it is a lossy second copy of a history held in full elsewhere; there is no history here to be a copy of — the receipt IS the event, and one delivery gets exactly one decision. A receipt whose disposition could be edited afterwards would not be a record of anything.

---

## 5. Decision B — The per-topic ordering table, and the one topic that is NOT commutative

Shopify delivers at-least-once and out of order. **Each topic with an effect is assigned an ordering class, in a CONSTANT (`TOPIC_POLICY` in `policy.ts`) rather than in prose here**, with a contract test asserting the constant and `KNOWN_TOPICS` agree in both directions — so a topic cannot gain an effect without somebody deciding what a late copy of it means.

| Topic | Class | Replay lookback (§5.3) | Effect | Why that class |
|---|---|---|---|---|
| **`app/uninstalled`** | **`event_time_bounded`** | **`absolute`** | retires every live token version granted for the store (053 §7.3) | **NOT commutative — §5.1** |
| `customers/data_request` | `commutative` | `window` | one `privacy_request` fact + its fulfilment job | A request is not a state, so a later copy has nothing to overwrite. Two deliveries of one message collapse on the id key and the body key; two genuinely distinct requests are two obligations and both are owed. |
| `customers/redact` | `commutative` | `window` | one `privacy_request` fact + its fulfilment job | As above. What this system owes is bounded by what it holds, and it holds no customer identifier at all — so there is no state whose order could matter. |
| `shop/redact` | `commutative` | `window` | one `privacy_request` fact and **NO job** (§7.4) | It arrives after an uninstall, so it always follows the message that ended the authority, and it asks for a deletion this bead does not perform. |
| *(a product or listing topic)* | **`sequenced`** — reserved, **no member** | — | — | §5.4: none is owed at G2. The class exists so E10-B08 has a name to be assigned rather than a decision to re-derive. |

### 5.1 The counter-example, which is a sequence and not a hypothesis

1. **T1.** The merchant uninstalls. This endpoint is unreachable — a deploy, a restart, a network partition.
2. **T2.** The merchant re-installs. A new `connector_token_version` is introduced and the shop works again.
3. **T3.** Shopify's retry of the T1 message finally lands, still inside its 48-hour horizon.

**As E03-B06 shipped, step 3 retires the token from step 2** and the shop silently stops drafting. The receipt's `UNIQUE` cannot see it: that delivery is the FIRST one carrying that id, because every earlier attempt failed before a row was written. Neither is the body key enough on its own — the retry carries the same bytes AND the same id, so it is caught as a same-id duplicate here, but a genuine second uninstall after a re-install would carry different bytes and a different id and still need the bound.

> **The ruling: an `app/uninstalled` ends the tokens that EXISTED WHEN IT HAPPENED. A version introduced after the event's own time is not covered by it.**

Implemented as one predicate on the retirement query — `v.created_at <= $cutoff` — where `cutoff = triggered_at + guard band`.

### 5.2 The bound crosses two clocks, and the guard band's DIRECTION is chosen

`triggered_at` is Shopify's clock; `connector_token_version.created_at` is this database's. **043 §2.4 already ratified exactly this kind of comparison** for `attempt_visibility`, together with its condition — *"beyond a single host, NTP or a monotonic source is a requirement, not an operational nicety"*. That condition binds here unchanged.

`WEBHOOK_CLOCK_SKEW_SECONDS = 300`, a PROVISIONAL floor, and the direction is the decision rather than the number:

* **Without the band**, skew toward "Shopify's clock is behind" makes the bound retire one token TOO FEW — leaving a version this system believes is live after the merchant killed it at Shopify. That is an ending that did not end, and 050 §5(a) inverts an ordering specifically to avoid its shape.
* **With the band**, the same skew retires one TOO MANY — the shop re-installs. An inconvenience with an obvious remedy.

Five minutes is far beyond plausible skew between two NTP-synced hosts and far below the minutes-to-days a merchant takes to re-install, which is what makes the band useful rather than merely safe.

**And the band is CLAMPED at `now` (F2).** A stated time cannot push an uninstall's reach into the future, because a future value is a header somebody chose rather than evidence about when anything happened: `usableTriggeredAt` treats a value beyond the band as absent, and `retirementCutoff` takes `min(triggered_at + band, now)`. Without the clamp, `triggered_at` in 2030 retired every version that shop would ever have.

**One interleaving the consistency lens traced and this record did not spell out (K1).** An uninstall's `SELECT` runs concurrently with an uncommitted re-install that is introducing a token version. **Transaction visibility resolves it, not the guard band**: the uninstall either sees the new row (committed before its snapshot, and then the event-time bound decides) or does not see it at all (uncommitted, so there is nothing to retire and nothing to race). The band is for CLOCK SKEW between two hosts and does nothing here; conflating the two would leave a reader believing a wider band buys concurrency safety, which it does not.

### 5.3 The replay lookback is per topic, and `app/uninstalled` is ABSOLUTE

**This section is F3's, and it is also the invariant review's finding 1 — two lenses reproduced the same defect by different routes, which is the strongest evidence a record can get that it is real.**

v1.0.0 made the body key window-scoped everywhere, and §4.3 argued the window on a REQUEST's ground: two identical redaction messages a year apart are two obligations. That argument is right for the three compliance topics and **wrong for `app/uninstalled`**, and the counter-example is §5.1's own, restored by patience:

1. capture a signed uninstall; let it be accepted;
2. the merchant re-installs; a new token version exists;
3. **wait out the window** — forty-eight hours, unattended — and replay the same bytes under a fresh id with `triggered_at = now`;
4. the digest lookup finds nothing inside the window, the message is `accepted`, and the re-installed token dies.

The invariant reviewer reached the same place more cheaply, by simply **omitting `triggered_at`**.

> **The ruling: `TOPIC_POLICY` gains `replayLookback`. `app/uninstalled` is `absolute`; the three commutative topics keep `window`.**

**The disambiguator is §5.1's own sentence**, which is why this needs no new principle: **two byte-identical `app/uninstalled` payloads are the same uninstall.** The payload is the shop object, and a genuine second uninstall after a re-install differs in it. So collapsing identical uninstall bodies forever costs nothing a real second uninstall would have needed, while a window there costs the whole of Decision B to anybody willing to wait.

**And the `window` side keeps its argument unchanged**: for a request, collapsing absolutely would make a second genuine obligation disappear, which is the worse failure.

### 5.3a A missing event time means UNBOUNDED, which is what E03-B06 shipped

`retirementCutoff(undefined) === undefined`, and the query's `$3::timestamptz IS NULL OR …` makes that *retire everything live*. Under a missing header the conservative direction is the one that leaves no live token behind, for §5.2's asymmetry.

⚠ **What that sentence must NOT be read as, after F3.** v1.0.0 let it imply that a missing or forged timestamp was harmless because the body key would catch the replay. It would not have: the invariant reviewer reproduced §5.1's counter-example by omitting the header precisely because the WINDOW then decided everything. A missing event time is safe now because `app/uninstalled`'s lookback is ABSOLUTE (§5.3) and because the store is signed (§4.0) — not because the bound's absence is itself a defence.

### 5.4 No product topic is owed at G2, and that is a finding rather than a convenience

**000-docs/005 — the v0 spec — names no inbound webhook topic at all.** `products/update`, `inventory_levels/update` and the order topics appear nowhere in it. And the bead that owns them is already filed and already blocked on this one: **E10-B08 `longbox-e5b.10.8`** — *Implement signed webhook and poll reconciliation for publish, sale, return, refund and deletion* — which `bd show longbox-e5b.3.8` lists under BLOCKS.

Two further reasons make this the right call rather than a deferral of convenience:

* **The scope policy forbids the authority those topics report on.** 053 §6 refuses `read_orders`, `write_orders`, `read_inventory` and `write_inventory`, each with the line it would breach. A subscription to `orders/create` on a connector with no order scope is not something this system can act on.
* **`listing_status_observation` has no producer yet** (043 §1 E8; the watcher is E10-B05's), and a product topic's whole purpose here would be to feed it. Subscribing before the consumer exists produces receipts nobody reads.

> **Ruling: this bead implements ordering for `app/uninstalled` and the three privacy topics, and assigns NOTHING to `sequenced`. The empty class is asserted by a test, so the first `sequenced` topic is a deliberate act whose author meets 043 §3.2's `session_seq` idiom rather than inventing a second ordering.**

---

## 6. Decision C — The privacy WORKFLOW: an obligation, a clock, and an answer that is a fact

**This bead owns the WORKFLOW half. It does not own the POLICY half, and the split is not lazy.** What a person is entitled to, on what clock, and what they are told is 041 §8.7(d)/(e)'s NEEDS-COUNSEL material, E01-B06's engagement and **E03-B09**'s bead. What this bead owes is that an obligation is recorded when it arrives, that it has a moment by which somebody must have answered, that the answer is a fact with an author, and that an unanswered one is FINDABLE.

**No statute is cited in this record, in the code, or in either CLI's output, and none may be.** The phrase in every artifact is *the topics Shopify requires an app to handle*.

### 6.1 `privacy_request` — the CLOCK, and it holds nothing about the subject

One append-only row per accepted message on a compliance topic. `shop_id` is NULLABLE for `connector_webhook_receipt.shop_id`'s reason word for word (053 §5.5): the commonest `shop/redact` arrives for a store that has already been offboarded, and the choices are to record the fact with a null resolution or to record nothing.

**It holds `payload_digest` and no identifier, and that is the point rather than an omission.** The message names a person; 041 §8.4's rule is that the log holds references and never personal values; a table that copied the identifier would be a second copy of the thing a redaction message asks this system to be rid of. The bytes are stored nowhere at all — the receipt keeps a digest and a length, and the buffer dies with the request.

Which raises the obvious question and it is answered rather than dodged: **if the row holds nothing about the subject, what is it for?** It is the clock. It records that an obligation started, when, and by when it is owed.

**`due_at` is STORED, not derived on read.** 041 §5.3's rule about reconstructed observations, applied to a deadline: a window changed next year must not silently restate what was owed last year.

**And the window itself has a DERIVATION, which v1.0.0 did not give it (the gate audit's B4).** `PRIVACY_REQUEST_FULFILMENT_WINDOW_DAYS = 25`, and the honest statement of where it comes from is this: **it is deliberately SHORTER than any external clock this system might turn out to be measured against, so that a finding fires EARLY rather than on the deadline.** That is the whole of the derivation — it is not derived from a statute, because no statute is cited anywhere in this bead and E01-B06's counsel engagement has not happened; it is not derived from a measurement, because none exists; and it is not the provider's number either. Within that rule the specific integer is arbitrary, and it is stated as arbitrary rather than dressed up: any value short enough to leave room to act would have done, and 25 is the one this repository chose.

**Two consequences follow and both are deliberate.** A finding may fire while an obligation is still perfectly timely by whatever clock eventually governs — that is the point of a floor. And the number is settable (`PRIVACY_REQUEST_FULFILMENT_WINDOW_DAYS`) so a deployment can shorten it further without a code change, which is 018 C3's rule pointing the unusual way round: here LOWERING binds MORE and is free, while RAISING it past whatever counsel eventually says is the change that needs a 006 row.

### 6.2 `privacy_request_fulfilment` — the ANSWER, and outstanding is a PREDICATE

There is no `status` on `privacy_request`, no `fulfilled_at` column on it, and no flag anywhere. **Outstanding means no fulfilment row exists** — 043 §2.4's derivation and 040's refusal of `scan_session.status`, one subsystem over. The predicate has ONE definition, the `privacy_request_outstanding` view, so the CLI, any future report and every test read the same sentence.

Four outcomes, closed, because each is a different sentence a shop could be shown: `no_data_held`, `data_exported`, `data_erased`, `not_applicable`. Three methods: `scope_policy` (the only one a machine may write), `operator`, `deletion_procedure`.

**A CHECK ties `method = 'scope_policy'` to `authored_by = 'system'` AND `operator_id IS NULL`**, and the two other methods to `authored_by = 'human'`. A machine answer never names a person and a person's answer is never attributable to the machine — stated as a constraint because a row that got this wrong would be a false statement about who decided.

**It is append-only, and the sharper half of the reason is this:** a wrong fulfilment is still a true record of what this system did. Correcting it in place would destroy the only evidence that the wrong answer was ever given.

### 6.3 `pnpm privacy-fulfil` — a CLI, because the act it records happens outside this system

`pnpm privacy-fulfil --request <id> --outcome <…> --by <uuid> [--procedure]`.

**A CLI on E03-D06/E03-D07's precedent**, and for one reason more: the act being recorded — somebody exported a file, ran a deletion, established the store was never a customer — happens OUTSIDE this software. A route would have to pretend the click was the act.

It runs as the **SCHEMA OWNER**, which is the only role that can: both tables are policied, and a request whose store matched no install has a NULL tenant no tenant context reaches. **`--by` is REQUIRED for every outcome and nothing verifies it**, exactly as `pnpm designate-staff` says of its own (058 §5 R1) — it is the only accountability record the command produces, and a fact with no author is a fact nobody signed.

It **REFUSES a second answer** rather than absorbing it, and the asymmetry with the consumer's `ON CONFLICT DO NOTHING` is deliberate: a machine redelivery is idempotency, while a person typing this twice has almost certainly mistyped an id and should be told.

**⚠ It writes the fact. It does not perform the deletion.** When E03-B09's procedure lands it calls the same function with `method: "deletion_procedure"`. Until then `--outcome data_erased` is an operator asserting they did the work, which is why the author is named in the row.

### 6.4 `pnpm audit:privacy-requests` — the K1 shape, and what a non-zero exit does NOT mean

Counts by topic and outcome; every outstanding request; **exit non-zero on any OVERDUE one**, so a scheduler needs no output parsing. That is 034 §3.4's shape, borrowed from `pnpm audit:cross-tenant`.

**It runs as the schema owner** — the requests that matter most are precisely the null-tenant ones, and a tenant context is exactly what would hide them. **It also says WHY a request is still outstanding (K6):** an overdue row now carries the dead-letter reason, joined from `outbox_dead_letter` on `(ref_table, ref_id)`, so an operator can tell a REFUSED job from a `shop/redact` that was never going to be automated from a null-tenant request that got no job at all (R2). Only the first needs a person now, and before this an operator triaged by guessing. **The overdue predicate stays in the view and is not restated** — one definition, which is the property the consistency lens asked not to lose while closing the gap beside it. It prints **counts, topics, outcomes and the STORE DOMAIN**, and the last one is a decision: a store domain names a MERCHANT and never a customer, and an operator who cannot tell which shop is overdue cannot act. `operator_id` is never projected (022 P3 — an audit reports the work, not the worker), and no customer identifier exists in these tables to print.

**A non-zero exit is a WORKFLOW failure and this record does not call it a K1.** 019 §3.4's K1 list is closed, and what is actually owed is E03-B09's and counsel's. The **CADENCE and the 019 T34 heartbeat are E13-B04-D1 (`longbox-e5b.13.4.1`)'s**, not this command's — a detector nobody runs reports nothing, and until that bead lands this is instrumented rather than closed.

**It says so out loud on an empty table**, on `pnpm audit:identity-access`'s precedent: a reconciliation over zero rows is green for the wrong reason, which is the stale detector 019 T34 exists to catch.

---

## 7. Decision D — The fulfilment of the two customer topics is a JOB with a fail-closed guard

### 7.1 Why a job at all, when everything else in this path is inline

**Because it can REFUSE.** Every other effect on the webhook path either succeeds or is a constraint absorbing a duplicate. This one asks a question about the store's recorded grants and must stop when the answer is not the expected one — and a fail-closed guard inside the acknowledgement transaction has only two endings, both bad:

* a **500** to Shopify, which is a retry storm and eventually an app whose webhooks the provider disables — **053 §5.5 names that hazard in as many words**, as the reason `topic` carries no CHECK;
* a **swallowed exception**, which is the silent discard 053 §9 exists to prevent.

On the outbox the refusal is a **dead letter**: visible in `outbox_dead_letter`, attributable, and never automatically re-driven (043 §5.5).

> **The general rule this record contributes, and it is what E10-B08 should inherit: any effect a webhook triggers that CAN REFUSE must be a job, because a refusal inside the acknowledgement is indistinguishable from a failure to receive.**

### 7.2 The enqueue happens in the receipt's own transaction, which cost a scope widening — stated, not tidied

The obligation and its job must commit together (043 §2.1). That transaction runs in the `connector-inbound` scope and cannot be a tenant one (053 §5.5: the tenant may be NULL, and one transaction carries one context). So **`outbox` joins `SERVICE_TABLES`** with `readScopes: ["connector-inbound"]` and a write check of `shop_id IS NOT NULL AND event = 'longbox.platform.privacy_request_received'`.

**The two alternatives, and why each is worse:**

* **Branch the context on whether the store resolved.** It would put the receipt path's two most different cases on two code paths, so the one that runs in production is the one the unresolved-tenant tests never take. It also reverses 053 §5.5's explicit ruling — *"this transaction cannot be a tenant one even when `shopId` happens to be known"* — which is a ratified sentence, not a preference.
* **Enqueue after the receipt commits.** It splits the fact from its effect, which is the half-written chain the outbox exists to remove.

**The widening is bounded twice and one half is not narrowable:**

* The **WRITE** names the event, so the inbound scope can enqueue that one job and can never enqueue a draft. A test pins the predicate, because if a future edit drops the event name the connector's inbound path can trigger an outward mutation with no human anywhere near it.
* The **READ** is the whole table and cannot be narrowed in this shape — a read policy is a scope list, not a row condition. **That is acceptable HERE and would not be on a content table**: an `outbox` row carries a reference and an envelope and never the referenced row's values (043 §2.5), and **this scope already reads every shop's `connector_token_version` cross-tenant by design**, which is a strictly more sensitive table. The widening is of degree, not of kind — but it IS a widening, and §9 R3 carries it.

`enqueue` needs the read because an `INSERT … RETURNING` is filtered by the SELECT policy.

### 7.3 What `no_data_held` claims, and the THREE things that make it checkable

The claim is: *this system holds nothing about the person the message names.* That is a statement made to a merchant and, through them, to a person, so it stands on three separate facts and not on an assurance:

1. **No scope this connector may request reads a customer.** `SHOPIFY_MAX_SCOPES` is `write_products` + `read_products`; a surplus scope REFUSES the install, two-sidedly (053 §6). Pinned by a test.
2. **No code path calls a customer-bearing endpoint.** Pinned by `tests/contract/no-customer-read-path.test.ts` over the Shopify client, the connector and the consumers. **This is not implied by (1)** — a shop on the legacy static path holds a token whose scopes this database never recorded, so what protects it is that nothing here ASKS for a customer.
3. **No RECORDED grant for that store carries a customer-bearing scope** — checked per store, at runtime, by the guard. `CUSTOMER_BEARING_SCOPES` includes the order scopes beside the customer ones, because an order carries the buyer, which is 053 §6's own reason for refusing `read_orders`.

**When (3) fails, the job DEAD-LETTERS with `customer_scope_was_granted`** and a person decides.

⚠ **AND ZERO RECORDED GRANTS IS ALSO A REFUSAL, WHICH v1.0.0 GOT BACKWARDS (F4).** `grantCouldReachACustomer([])` is FALSE, so an EMPTY recorded-grant set satisfied fact (3) **vacuously** — and the shop that has no recorded grant is not a hypothetical, it is the one on the legacy static path, which is the PILOT. So the automatic answer was produced, for that shop, by a check that examined nothing, and the resulting `no_data_held` row was **indistinguishable from one a real check produced**. That inverts 043 A3's fail-closed idiom, and its worst consequence is not the row: it made **residual R1 unfalsifiable**. A limitation everybody had agreed to state was also a limitation nothing could detect.

Zero recorded grants now dead-letters with **`no_recorded_grant`**, a GUARD refusal — the guard is what was missing.

⚠ **AND v1.1.0 CALLED THAT *SELF-ENFORCING*, WHICH IS FALSE (the security re-check's finding 2).** Since **F-A**, a store with no recorded grant resolves to a NULL tenant, and the producer enqueues nothing without a tenant — so **`no_recorded_grant` is UNREACHABLE from the shipped producer**, and I19's test reaches it only by writing the outbox row by hand, which its own comment now says. **R1 is *stated, with a defence-in-depth branch*, and no artifact may upgrade it.** The branch is kept rather than deleted because a future producer can reach it — E16-B02's cutover, or a human re-drive under 043 §6.3 — and a guard written only on the day somebody needs it is a guard nobody writes. It is a GUARD refusal in 043 A5's sense — the guard working is not the system being unreliable — so `outbox_dead_letter.guard_refusal` is TRUE for it and the 019 T17 aggregate does not count it as a fault.

> ⚠ **The residual is stated rather than assumed away. Fact (3) is VACUOUS for a shop on the legacy static path**: the pilot's per-store Dev Dashboard token was minted in a dashboard and its scopes are recorded nowhere in this database, so the query finds nothing and the guard passes. What carries such a shop is (1) and (2), which are properties of the CODE. The cutover that makes (3) real for every shop is **E16-B02**'s. §9 R1.

### 7.4 `shop/redact` gets NO job, and that is the honest answer

It asks for the deletion of a SHOP's data, which this system genuinely holds, on a policy nobody has ratified. There is no guard that makes that computable. So the fact is recorded, the clock starts, and the audit finds it — and **no consumer is registered**, because a consumer that delivered without doing anything would be a green job that answered nobody.

**A job for a topic nothing answers automatically is a PRODUCER defect and gets its own reason (the gate audit's B6).** The consumer's guard refuses it, and v1.0.0 refused it with `customer_scope_was_granted` — which is a **FALSE SENTENCE in `outbox_dead_letter`**, the artifact 041 §8.2 forbids untrue statements in, and which additionally counted a deployment defect as `guard_refusal = true`. `privacy_topic_not_auto_fulfillable` is its own NON-guard reason: a guard refusal says *a control worked*, and nothing was controlled here.

**And no job without a TENANT, for either customer topic.** `outbox.shop_id` is NOT NULL, so a request whose store matches no install cannot be enqueued at all. That is the right answer rather than a limitation to route around: there is no tenant to act within, the fact is still recorded, still on the clock, and still counted by the audit. **The backstop is the detector, not the queue.**

---

### 7.5 A ceiling on null-tenant obligations, because a replayer needs no secret (F5)

The per-shop rate token (048 R14) is only taken when the domain RESOLVES to a shop. So a caller replaying ONE captured compliance body under invented domains was bounded by the route's aggregate alone, and the lens's probe wrote **twenty-five null-tenant `privacy_request` rows**, each with a `due_at` — which puts `pnpm audit:privacy-requests` permanently at exit 1 and buries a real finding in noise. The detector this bead built was the thing the flood attacked.

**§4.0 closes most of it ON THE `agrees` PATH**: where the body names a domain this build can read, one captured body pins one domain, so the twenty-five become one. ⚠ **Under an `unknown` verdict it does not**: the header still keys the digest lookup and this ceiling's bucket, so one captured compliance body delivered under N invented header domains is N buckets — **8·N obligations, bounded per bucket and unbounded across them**. That is the honest arithmetic and §9 R9 carries it, because what closes it is not a ceiling but knowing the payload field names (A4). What remains is the case where a store's genuine `shop/redact` bodies could be replayed, and `PRIVACY_UNRESOLVED_DOMAIN_CEILING` (a PROVISIONAL floor, 8) bounds it.

**It bounds a TOTAL and not a rate, deliberately.** A rate limiter refuses for a minute and then forgets; the harm here is a permanently non-zero audit exit, so what must be bounded is how many rows can ever accumulate for one unresolved domain. **A tenant-resolved obligation is never bounded by it** — that shop's bucket was already taken, the message is about a store this system holds data for, and refusing one would be precisely the silent discard 053 §9 exists to prevent.

**The derivation:** a store matching no install is a store this system holds nothing for, so the only legitimate traffic on this path is a `shop/redact` for an already-offboarded shop — 053 §5.5's own example — and there is exactly ONE such message per offboarded store per topic. Eight is that number with room for the provider's retries and for a store that offboards, is re-onboarded and offboards again. **The cost is stated as §9 R8**: a store that offboards more than the ceiling's worth of times would have a genuine late message refused, and the receipt still records it.

## 8. Decision E — A tenth event, under `platform`, which required 043 §3.3 to be NARROWED rather than ignored

`longbox.platform.privacy_request_received`, `ref_table = 'privacy_request'`.

**Adding a name is ADDITIVE within v1** (042 §2.3, restated by 043 §3.3). What is not routine is the MODULE segment, because 043 §3.3 excluded platform's tables with this sentence:

> *"`media_deletion`, `retention_policy`, `retention_hold`, `retention_hold_release` and `retention_sweep_run` produce none: they are platform's own tables, and 029 §2.9 makes platform the graph's leaf — nothing may import it and it publishes to nobody who is not already inside it."*

**That sentence was written about the four retention tables and it holds for them.** Their consumer is platform's own sweep, which reads them as tables in the process that needs them. `privacy_request` differs on one axis and it is the axis the whole exclusion turns on: **its consumer is a job whose REFUSAL must be visible outside the transaction that acknowledged the message** (§7.1). The event does not exist to inform a reader; it exists to carry an effect out of an acknowledgement.

So **043 is amended by row (→ v1.2.0) with an appended block in §3.3**, narrowing the platform exclusion to state its actual criterion rather than its table list. Nothing in 043 is edited.

**Two further things this entry is NOT, both asserted by tests:**

* **It is not the SECOND command-shaped event.** 043 §3.4 ratifies EXACTLY ONE and makes a second a decision-record change rather than a catalogue addition. `draft_requested` is command-shaped because it SELF-REFERENCES — its subject has not happened. `privacy_request_received` references a committed witness row that exists before the event does, so 042 §7.1's re-read rule has something to protect. The count of one is unchanged and the test still asserts it.
* **It is not a person on a bus.** `privacy_request_fulfilment` produces NO event, with a stated exclusion rule: it carries `operator_id`, and an event about it would carry an operator identifier out of the identity module and onto a registry whose consumers are many (019 T35 non-waivable; 022 P3).

**Table ownership:** `privacy_request` and `privacy_request_fulfilment` are **platform's**, on 029 §2.11's own ruling — *"a tenth 'privacy' module for four tables and one cron is not worth its boundary"* — which is why the code is `src/services/privacy.ts`, one file, and not `src/services/privacy/`. **029 §2.10's ownership table does not yet carry either row, nor the five connector tables 053 added**; that is a paperwork gap in a ratified record and §9 R4 files it rather than editing a section this bead does not own.

---

## 9. Residuals — what is NOT closed, with the bead that owns each

| # | Residual | Owner |
|---|---|---|
| **R1** | **The runtime half of the `no_data_held` guard is VACUOUS for a shop on the legacy static path** — its token's scopes were never recorded here, so §7.3 fact (3) finds nothing and the claim rests on facts (1) and (2), properties of the CODE. ⚠ **STATED, with a DEFENCE-IN-DEPTH BRANCH — and NOT self-enforcing, which is what v1.1.0 called it and the security re-check falsified.** Since F-A such a store has a NULL tenant and is never enqueued, so `no_recorded_grant` is unreachable from the shipped producer; the branch exists for a future producer and its test constructs the job by hand. No artifact may state the guard as though it checked every shop, and none may call R1 self-enforcing. | **E16-B02** (the pilot cutover), with **E03-B09** for what the policy then says |
| **R2** | **A privacy request with a NULL tenant gets no job and no automated answer.** It is recorded, clocked and counted, and a person must answer it. That is by construction (`outbox.shop_id` is NOT NULL) and the detector is the whole backstop. | **E03-B09** `longbox-e5b.3.9` |
| **R3** | **The `connector-inbound` scope can now read every shop's `outbox` rows.** The write is pinned to one event name; the read is not narrowable in the current policy shape, which supports a scope list and not a row condition. **The security lens probed it (P4) and confirmed it is LATENT rather than live: no path returns those rows.** It also noted that the write check pins the EVENT but not `ref_table`/`ref_id`. **That minor is DEFERRED to this residual rather than adopted** — narrowing it further needs the same row condition E03-D35 proposes, and a half-narrowing here would read as a fix. 056 → v1.4.0 records the amendment this widening required. | **E03-D35 `longbox-e5b.3.45`** — *Give a service-scope read policy a row condition so a cross-tenant scope reads only the rows it needs*. **PROPOSED by this record and CREATED on `main` at `8068a58`**, ahead of this branch; its 015 row lands with the close. |
| **R4** | **029 §2.10's table-ownership list is missing the five connector tables (053) and these two.** A ratified record's inventory that lags the schema is how the next module boundary gets drawn from a stale list. | **E03-D36 `longbox-e5b.3.46`** — *Bring the 029 table-ownership inventory up to the live schema and make a new table owe an ownership row*. **PROPOSED by this record and CREATED on `main` at `8068a58`**; its 015 row lands with the close. |
| **R5** | **The cadence for `pnpm audit:privacy-requests` does not exist.** A detector nobody runs reports nothing, and until it is scheduled the workflow is instrumented rather than closed — exactly as 019 T35(b) and T35(c) read today. | **E13-B04-D1** `longbox-e5b.13.4.1` |
| **R6** | **The merchant-facing sentence about a privacy request is NOT written here**, on 053 §9's routing: the server emits no operator prose (042 §4.3). What a shop is told when a request arrives, and what its own privacy page says, is a candidate C-row under 021's T26 pre-send. | **E10-B02** (the merchant surface), with **E01-B06** (counsel) |
| **R7** | **One replayed body can still produce TWO obligations, in one case (K2).** The advisory lock serialises classify-and-insert within a database, so the constructible race is closed; what it does not cover is a second process reaching a DIFFERENT primary, or the lock being removed by somebody who reads it as decoration. The guarantee this record states is **no double EFFECT per obligation**, and it is not *no double obligation*. Each obligation is independently clocked and each is fulfilled at most once. | **E03-B09** (which owns what an operator does with two obligations naming one message) |
| **R8** | **The F5 ceiling can refuse a genuine message.** A store that offboards more than `PRIVACY_UNRESOLVED_DOMAIN_CEILING` times has its next null-tenant obligation refused — the receipt still records the message, so nothing is silently lost, but the CLOCK does not start. It is a PROVISIONAL floor and the honest trade is stated rather than hidden. | **E03-B09**, with the ceiling raised on data |
| **R9** | **Assumptions A1 and A4 are unverified, and A4 is new because of F1's fix.** If the HMAC does cover the headers, §4's two-adversary split is over-engineering. If the payload field NAMES are wrong, `checkSignedDomain` answers `unknown` on every delivery — and since **F-A** that means: the message is recorded, **no tenant is attributed on either half**, no token is retired and no job runs. ⚠ **At v1.1.0 that was NOT the answer for the compliance half** — the obligation was attributed from the unsigned header and enqueued, which the security re-check probed and which is why F-A is a code change rather than a wording one. **Both assumptions close on ONE signed dev-store delivery with a mutated header**, and A3 is discharged by the same delivery. | **E03-B10** (the independent security review), before the first real store ⚠ **And an `unknown` verdict returns two keys to a caller-chosen value**: the replay detector's digest lookup and §7.5's unresolved-domain bucket are both keyed on `shop_domain`, which under `unknown` is the unsigned header again — so the advisory lock is aimable and the ceiling is per-bucket rather than per-adversary (8 per invented domain, unbounded across them). F-A stops the TENANT attribution and not this; what closes it is knowing the payload field names, which is A4's own evidence. |

**Nothing above is a threshold change. 019 T17, T19, T24, T32, T33 and T35 are untouched, and this bead closes none of them.**

---

## 10. Contracts the code half satisfies

| # | Invariant | Where it is asserted |
|---|---|---|
| **I1** | A forged signature leaves ZERO rows in every table on this path, replay columns included. | `tests/integration/webhook-replay-privacy.test.ts` (row counts before and after) |
| **I2** | A same-id redelivery is answered identically, writes ONE receipt and produces no second effect. | same file |
| **I3** | A replay of the same BYTES under a fresh id is refused, recorded as `replayed_body`, and produces no obligation. | same file |
| **I4** | A message older than the window is refused as `stale`, keeps its stated event time on the row, and produces no obligation. | same file |
| **I5** | An `app/uninstalled` retires the version introduced before its event time and NOT one introduced after it. | same file |
| **I6** | With no stated event time, an `app/uninstalled` still ends every live version. | same file |
| **I7** | A `privacy_request` row contains no value from the message body and does contain the body's digest. | same file (whole-row `to_jsonb` search) |
| **I8** | The two customer topics enqueue exactly one job; `shop/redact` enqueues none. | same file |
| **I9** | Draining writes exactly one `no_data_held` fulfilment, `authored_by = 'system'` with a NULL operator, and a re-drain writes no second. | same file |
| **I10** | A store whose recorded grant carries a customer-bearing scope gets NO automatic answer, and the refusal appears in `outbox_dead_letter` with `guard_refusal = true`. | same file |
| **I11** | `TOPIC_POLICY` and `KNOWN_TOPICS` agree in both directions; nothing is `sequenced`. | `tests/webhook-replay-policy.test.ts` |
| **I12** | No customer-bearing scope is inside the declared maximum, and no file on the Shopify surface calls a customer endpoint. | `tests/webhook-replay-policy.test.ts`, `tests/contract/no-customer-read-path.test.ts` |
| **I13** | The `connector-inbound` write predicate on `outbox` names the one event. | `tests/rls-plan.test.ts` |
| **I14** | The catalogue's tenth entry is reference-shaped, so 043 §3.4's command count of one still holds. | `tests/contract/event-catalogue.test.ts` |
| **I15** | The audit finds an overdue request and its counts name no person. | `tests/integration/webhook-replay-privacy.test.ts` |
| **I16** | A captured message re-addressed at another tenant is REFUSED, with zero rows in the receipt, obligation and retirement tables, and the victim's live token untouched — for BOTH an uninstall and a compliance topic. | same file (F1's two probes, constructed) |
| **I17** | A payload shape this build cannot read is RECORDED and acknowledged, and retires NOTHING. | same file; `tests/webhook-replay-policy.test.ts` for the three verdicts |
| **I18** | A FUTURE stated event time is treated as absent: the delivery is not stale, and the retirement cutoff does not reach forward. | both files |
| **I19** | A store with ZERO recorded grants is refused `no_recorded_grant` with `guard_refusal = true`, and the audit reports the reason. | `tests/integration/webhook-replay-privacy.test.ts` |
| **I20** | `app/uninstalled` refuses a repeat of the same bytes however long the attacker waits; the compliance topics accept one outside the window. | `tests/webhook-replay-policy.test.ts` |
| **I21** | A non-auto-fulfillable topic carries its own NON-guard reason, and that reason is absent from `GUARD_REASON_CODES`. | `tests/webhook-replay-policy.test.ts`, `tests/outbox-predicates.test.ts` |
| **I22** | **An unreadable COMPLIANCE payload attributes NO tenant**: the obligation is recorded with `shop_id = NULL`, the victim named in the header gains no obligation, and zero jobs are enqueued. | `tests/integration/webhook-replay-privacy.test.ts` — **F-A's probe**, and the case that makes §0 A4's *worst outcome* sentence true on the half where it was false |
| **I20a** | **Two CONCURRENT deliveries of one body produce ONE obligation**, with dispositions `accepted` + `replayed_body` and BOTH receipts recorded. | same file, on TWO connections. R7's claim was ASSERTED at v1.1.0 and the gate re-audit said so: `consumer-idempotency` races the CONSUMER, and this races classify-and-insert, which is a different seam |

---

## 11. Migrations

`038_webhook_replay_and_privacy_workflows.sql`. **Expand only**, `IF NOT EXISTS` / `DROP CONSTRAINT IF EXISTS` throughout, re-runnable by hand (044 §2, §7).

No `-- contract:` header of either kind: nothing is retired, and **no policy is written in the file** — `src/db/rowLevelSecurity.ts` re-derives the boundary from the live catalog after every `pnpm migrate`, so a new table carrying `shop_id` is policied by that step. One `-- index lock:` declaration on the body-key index, which is built on a table this file did not create (044 §9).

**No prior-schema fixture is owed** (044 §3): the newest is `after-035` at 34 applied files against a head of 37, which is three behind the limit of four. `037` merged ahead of this branch and closed the gap it briefly held, so `027` is once again the only one — and `035` is still the right snapshot for what `038` does, because its only reach into an existing table is an `ADD COLUMN … NOT NULL DEFAULT` whose truth claim is about rows that are already there.

---

## 12. Alternatives considered

| Alternative | Why not |
|---|---|
| **An absolute `UNIQUE (connector, payload_digest)`** as the replay key | It collapses two byte-identical messages years apart, and the failure it produces is a second genuine `customers/redact` disappearing (§4.3). |
| **Refuse a stale message with a 4xx** so the provider knows | Shopify retries a 4xx for 48 hours, converting one refusal into nineteen deliveries of a message this system has already decided about (§4.2). |
| **A `status` column on `privacy_request`** | 043 §2.4's argument, one table over: a mutable flag is a lossy second copy of what `privacy_request_fulfilment` says in full (§6.2). |
| **Auto-fulfil `shop/redact` too** | There is no checkable predicate for it — this system genuinely holds a shop's data, on a policy nobody has ratified (§7.4). |
| **Register a no-op consumer for `shop/redact`** so every topic has one | A green delivery that answered nobody is worse than an absent one: it makes an unanswered obligation look handled. |
| **Do the fulfilment inline in the receipt transaction** | A guard that can refuse cannot refuse inside an acknowledgement without becoming a 500 or a silence (§7.1). |
| **Branch the transaction's tenant context on whether the store resolved** | Two code paths for the receipt's two most different cases, and it reverses 053 §5.5's ratified ruling (§7.2). |
| **Trust `X-Shopify-Shop-Domain` because the message is signed** | The signature covers the BODY. The header selects the victim, and one captured message re-addressed at another tenant was the whole of F1. |
| **Refuse a message whose payload shape this build cannot read** | It would let a wrong guess about a third party's payload (§0 A4) turn a `customers/redact` into a message nobody recorded — the exact failure 053 §9 exists to prevent. `unknown` records and refuses only the destructive half. |
| **A `UNIQUE (connector, payload_digest)` on `app/uninstalled` instead of an absolute lookback** | Same effect, worse failure mode: a UNIQUE turns a legitimate duplicate into a 500 and a retry storm, which is 053 §5.5's stated hazard. A lookback refuses quietly and records the refusal. |
| **Make the advisory lock the idempotency mechanism** | It would violate 043 §3.2 and, worse, it would be a lock somebody could remove without a test failing. The constraints under every effect stay the mechanism; the lock only serialises a detector. |
| **A per-domain RATE limit instead of a total ceiling (F5)** | A rate refuses for a minute and forgets. The harm is a permanently non-zero audit exit, so the total is what must be bounded. |
| **Trust `X-Shopify-Triggered-At` as authenticated** | It is a header and the signature covers the body. ⚠ **This row's second sentence at v1.0.0 — *a forged value buys nothing the body key does not already stop* — is STRUCK as FALSE.** Two probes falsified it: a FUTURE value was never stale and pushed the retirement cutoff forward (F2), and a windowed body key is a clock an attacker outwaits (F3). What makes the two uses safe is three separate repairs — §4.0's signed domain, §5.2's clamp, and §5.3's absolute lookback — not the digest key on its own. |

---

## 13. Consequences

**Better.** A replayed message cannot double-apply an effect and cannot end a re-installed shop's authority. A message that arrives two days late is refused and the refusal is evidence. Every message on a mandatory topic starts a clock, and an unanswered one is a non-zero exit rather than a silence. The dead-letter view separates the privacy guard working from the system failing.

**Worse, stated plainly.** There are now three reads and an advisory lock on the webhook path, and one more table pair to reason about. `outbox` is readable inside a cross-tenant scope for the first time (§9 R3). **FOUR** PROVISIONAL floors exist that somebody will eventually quote as though they were measurements — which is why each carries its derivation in the code and each is asserted by a test. And a shop on the legacy static path is REFUSED rather than answered (§7.3), which is safer and is also more work for a person until E16-B02's cutover (§9 R1).

**One measurement, recorded because it is a number this bead moved and not a threshold:** line coverage is **80.47 %** against the 80 floor (80.35 % before the rebase onto `main`, which brought E03-D24's own tests with it). It is not a claim about quality — it is the margin, and it is thin enough that the next person adding an unexercised branch to `src/services` or `src/consumers` will find out from CI rather than from a review.

**Not decided here.** What deletion removes, what an export contains, what a person is told, and on what clock — all E03-B09's and counsel's. Whether any product or listing topic is subscribed — E10-B08's. Whether the merchant sees any of this — E10-B02's.

---

## 14. Ratification

**SIGNED.** Ratified by the acting head of board (Jeremy Longshore, under the 2026-09-03 delegation) on **2026-09-06** at close of E03-B08 `longbox-e5b.3.8`, against PR #101 squash-merged to `main` as **`f1cdc2d`** (`f1cdc2d6dbb7e79291d504889af9b255414f3534`). The two-lens cannon §2 carries returned REJECT then ACCEPT-WITH-CHANGES (security) and ACCEPT-WITH-CHANGES (consistency); every finding across two folds is folded and none declined; the F-A ruling was taken as CODE — an unreadable payload attributes no tenant. Assumptions A1 and A4 stay signed OPEN and close on one dev-store delivery under E03-B10. The residuals in §9 stand as written.

> _Signed:_ Jeremy Longshore, acting head of board  _Date:_ 2026-09-06  _Against:_ `f1cdc2d`

The line below is the text as written at v1.2.0, kept verbatim as history:

> **UNSIGNED.** The acting head signs at close of E03-B08.

**What has happened:** the cannon was dispatched and returned four verdicts at `30c2501` — `security-auditor` **REJECT**, `longbox-invariant-reviewer` **BLOCK**, `longbox-gate-auditor` **NOT-READY** (six blockers), `martin-kleppmann-reviewer` **ACCEPT-WITH-CHANGES**. §2 carries both position statements verbatim, §2.1 is the fold, and **nothing was declined**. v1.0.0's builder drafts are struck and not reproduced.

**What is owed before the signature:** the FINAL gate re-audit at the landed head, and nothing else. The targeted **security re-check RETURNED** (REJECT → ACCEPT-WITH-CHANGES at `d31416e`, §2's appended paragraph), the **invariant re-verification RETURNED** (BLOCK → PASS-WITH-NOTES; both prior findings re-probed closed and K2 confirmed on two connections), and **B3's register re-cut is LANDED at `fab9fc2`** — rebased onto `8068a58`, ledger 37, registers 006 1.85.0 / 000-INDEX 1.44.0 / 016 1.32.0, with the two residual beads E03-D35 `longbox-e5b.3.45` and E03-D36 `longbox-e5b.3.46` created on `main` at `8068a58` and their 015 rows owed at close.
