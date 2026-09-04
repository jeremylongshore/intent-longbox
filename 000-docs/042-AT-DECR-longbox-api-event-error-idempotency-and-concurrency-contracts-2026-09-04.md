# Decision Record — The Versioned API, Its Resource Shape, the Error Contract, Idempotency, Optimistic Concurrency and the Outbound Event Contract

**Version:** 1.1.1
**Status:** **RATIFIED 2026-09-04** by the acting head of board under Jeremy Longshore's 2026-09-03 delegation, after a two-lens cannon (`martin-kleppmann-reviewer`, `martin-fowler-reviewer`, both ACCEPT-WITH-CHANGES). Binding per §14. Amendments A1–A11 absorbed in full, none declined; **one draft decision was STRUCK on the cannon's finding** (§7's generated event catalogue, A2); four dissents preserved in §14.
**Bead:** E02-B08 `longbox-e5b.2.8` (epic LBOX-E02 `longbox-e5b.2`, gate G2, evidence class CODE, owner-role eng, risk critical) — see 000-docs/014 §8 row E02-B08
**Drafted:** 2026-09-04 by `longbox-domain-builder` · **Cannon:** `martin-kleppmann-reviewer` + `martin-fowler-reviewer`, 2026-09-04 — **both reproduced every §1 claim they sampled** (identify has no `RETURNING`; `confidence`/`provider`/`model`/`costUsd` on the wire; three envelopes; `GET /api/shops` unscoped; the two `SELECT *`s; `withTransaction` absent). **No §1 finding is disputed.** · **Audit:** `longbox-gate-auditor` before close · **Decision owner:** Jeremy Longshore
**Sensitivity:** Restricted internal (014 §10)
**Supersedes:** nothing — first record on the API, error, idempotency, concurrency and event contracts. It **discharges** 029 §11's non-decision at `029:704` and, with E02-B09, is the replacement 029 §12.2 names in advance at `029:739`.
**Inputs:** 014 §8 rows E02-B08, E02-B09, E02-B10, E03-B01, E03-B02, E03-B03, E03-B07, E03-B08, E05-B04, E05-B08, E05-B09, E10-B01, E10-B03, E10-B05, E13-B01, E14-B04, E17-B01 · 015 alias map · 005 v1.1.0 §API surface (`005:68-89`) · 018 v1.1.0 (evidence rules) · 019 v1.2.0 §2, §3.0, T3, T7, T17, T18, T19, T20, T23, T24, T33, T34, T35, K1, K2, K4 · 021 v1.3.0 B14, B16, B17, B19, B20 · 022 v1.1.1 **P6 (`022:65`, `022:67`)**, P3, P7, P8 · 023 v1.0.1 §3, §5 · 029 v1.2.0 §2.9, §2.10, §3.1 (`029:270-283`), §5 move 8 note N2 (`029:507-516`, `029:596`), §9 amend-by-a-row (`029:680-683`), **§11 (`029:704-705`)**, **§12 (`029:712-743`)**, H6 (`029:52`) · 030 v1.1.1 §5.2 single-rate versioning (`030:339-341`), §7.1 (`030:406`) · 033 §5.1, §5.3, §9 · 034 v1.1.1 (tenancy) · 035 (pilot volumes) · 036 v1.1.1 §5.1 D1, §5.2 · 037 v1.1.1 §1.1 · **040 v1.2.0 §3.4, §5.1, §5.2, §7 in full, §8.1 items 3–4, A8, A9, I20** · **041 v1.1.1 §2.0, §2.4, §2.5, §2.6, §3.5, §4.1, §4.2, §4.5, §5.3, §8.4, §9.2, A4, A8, A11, I20** · `src/app.ts`, `src/server.ts`, `src/config.ts`, `src/routes/scanSessions.ts`, `src/services/scanSession.ts`, `src/services/identify.ts`, `public/app.js`, `tests/integration/smoke.http.test.ts`, `tests/integration/photos.multipart.test.ts`, `tests/public-copy.test.ts`, `tests/RTM.md`, `tests/JOURNEYS.md`, `.github/workflows/ci.yml` · CLAUDE.md locked decisions 2, 3, 4, 5, 7.

## Change log

**Version convention** (006 `:6`, as used by 029/030/034/036/037/040/041): a **minor** bump means the content of a decision changed; a **patch** means a statement of fact was repaired with no decision changing.

| Version | Date | What changed | Authority |
|---|---|---|---|
| 1.0.0 | 2026-09-04 | Initial draft. **Status PROPOSED, §14 unsigned**, nine questions open in §13. Seven decisions: the versioned surface and its compatibility rule with Zod as the contract source of truth and OpenAPI as a gated build artifact (§2); the resource shape, the response-DTO rule and the tenant prefix made structural (§3); one error envelope with a code registry and the rule that the server never emits operator prose (§4); `Idempotency-Key` on every mutating route, with the constraint — not a lock, not a status — doing the serialising (§5); optimistic concurrency on 040 A1's causal reference, wire shape only (§6); the outbound event contract as a reference plus an envelope, with names generated from 041 §9.2's declared list (§7); and a per-shop rate posture that fails closed to the manual path rather than to an error (§8). **Corrects one inherited citation** (§0, E23): 040 §7 and this bead's own `Docs:` line attribute the call envelope to "029 §10", which is *Consequences* and assigns nothing. | `longbox-domain-builder` |
| **1.1.0** | **2026-09-04** | **RATIFIED. Eleven amendments absorbed, none declined, and one draft decision struck.** **A1** (Fowler) §2.2 states the reversibility test it was applying without naming: versioning now is cheap and *reversible* — unused `v2` machinery is simply never built — while versioning after a partner integrates is irreversible at acceptable cost. **A2** (Fowler + Q6, the one strike) §7's **generated event catalogue and every event name are REMOVED**. What survives is only what a client or E02-B09 can be tested against: an event is a row reference plus 041 §2's envelope; ordering is `session_seq` within a session and nothing above; delivery is at-least-once with consumers idempotent on `(event, ref.id)`; and the event's version **is** the referenced row's `definition_version`, with the separate `event_version` field struck. The catalogue is **E02-B09's record, written against a running outbox**, because a naming scheme fixed against zero running code is unfalsifiable — §10 A8 records the reversal. **A3** (Fowler, REQUIRED) §8.4's two rate parameters and 041's `tx_max_retries` take **PROVISIONAL, explicitly non-evidentiary circuit-breaker defaults** with their derivation stated — 018 A3 caps claims of fact, not safety floors, and refusing to pick any number conflated the two. `abandon_after` stays OPEN because 040 §3.5 signed it so. **A4** (Fowler) §9.1 row 3: the identify DTO change and `public/app.js`'s consumption change land in the **same PR**, as a constraint on the executing bead. **A5** (Kleppmann, REQUIRED) new **I21** — the `request_idempotency` INSERT → work → UPDATE sequence runs in one transaction on **one connection held for the request's lifetime**, never `pool.query` per statement, and a concurrent second request on an uncommitted key blocks at the database and can never observe a partial row; an E02-D04 acceptance line. **A6** (Kleppmann, REQUIRED) new **I22** — a **fixed lock acquisition order** in every mutating handler, the idempotency INSERT always before the anchor `FOR UPDATE`, with a lint over handler bodies; §4.2 adds `40P01 deadlock_detected` beside `40001` as retryable, and 041 §4.5's retry scope is widened by an amend-by-a-row (041 → v1.1.2, applied in this commit). **A7** (Kleppmann) §9.4 obligation on E02-B09: the outbox's own draining order confers **no** consumer guarantee beyond §7.2's. **A8** (Kleppmann, **Q8 RULING**) §3.4's allowlist rows gain `kind ∈ {exemption, defect}`; `GET /api/v1/shops` is a **defect** row, and **no defect-kind row may exist at G2**. As drafted it was a waiver by declaration; with the tag it is not. **A9** (Kleppmann, REQUIRED) a retry that changes `against` after a `409 STALE_WORLD_VIEW` is a **new act** and mints a **new** `Idempotency-Key`; explicit in I11 and an E05-B08 obligation. **A10** (Fowler + **Q1**) §2.4's pack-version-versus-API-version distinction is **VALIDATED**, and its "two orders of magnitude" churn claim is reworded as a **direction rather than a measurement**. **A11** the 040 §7 `029 §10` mis-cite is **patched now rather than filed** (040 → v1.2.1). | Two-lens cannon → acting head, §14 |
| 1.1.1 | 2026-09-04 | **Patch after the gate audit of `fb6dbb7` (statements of fact only — no decision changed, no re-cannon, §14 stays signed).** `longbox-gate-auditor` returned **NOT-READY on statements of fact**, having verified every decision, every amendment and every dissent. Eight repairs, and the first is the consequential one. **(1) E6 and E7 were FALSE at the merge base `3269573`, and false by the same mechanism that broke 041 E8: a substring collision with a name that arrived in a later merge.** PR #54 landed `src/db/appendOnlyTables.ts`, whose declared-list entry for `request_idempotency` — **a table that still does not exist** — is matched by both greps. E6's *"zero lines, exit 1"* is now **three lines, exit 0**; E7's *"six lines… not one is a request key"* is now **ten lines, three of them naming `request_idempotency`**. Both are re-derived at `3269573` with their real output pasted, and both now name **the symbols that must return nothing** rather than resting on a count. **The findings are unchanged and are arguably stronger**: the three new matches are a pending-list entry for a table nothing creates, which is 042 §5.2's own decision being *declared* and not *built*. **(2)** I20 said routes issue *"sixteen"* `db.query` calls; the count is **eight**, at `b72033f` and at `3269573` alike — an inflated number in an invariant about counting things. **(3)** §11's preamble and §14 said **four** invariants are ⚠ conditional on E02-B10; only three carry the marker (I15, I16, I20). **(4)** §12.2 said **three** invariants are blocked, which was true before A5 and A6 added I21 and I22 and false after; it is **five**. **(5)** E11 cited `smoke.http.test.ts:153`; the assertion is at **`:152`**. **(6)** I2 asserted the exemption reason names **two** things while §13 Q4 says **three**; I2 now says three. **(7)** 016 §1 row 042's Hash cell held a duplicated Owner string; it now carries the landing commit, as row 041 does. **(8) Found in the same pass, not by the audit:** §0 and §9.1 row 0 describe 041 §10 row 0 (`ENABLE ALWAYS`, E02-D05) as a precondition *to come*, and **it landed at `3269573` as migration `006`** — so the sentence was true when written and is stale now. §0 and §9.1 record that it shipped, and that **the transaction helper E02-D04 is now the only unshipped precondition**. | `longbox-gate-auditor` report on PR #55 → acting head |

## 0. Evidence posture

Per 018 A1/A3, and with 029 v1.0.0's gate-audit blocker B1 as the governing lesson — a "today" claim asserted at REPRODUCED on the strength of having read a file, later found false:

- **Every "today" claim in §1 is REPRODUCED at `b72033f`** — `main`, the 041 ratification merge (PR #53) — each carrying a `file:line` **or** the verbatim command that produced it **with its exit status**. §1 prints the commands so a reader re-runs them rather than trusting the reading. **A rung is earned by the citation, not by the reading.**
- **A negative claim names the symbols that must return nothing, never "zero lines" alone.** 041 v1.1.1's gate audit found three claims whose *substance* held while their *evidence sentence* had gone stale, and the worst of them — E8's *"no envelope column exists anywhere in code"* — was false because a later migration introduced one name the grep covered. The lesson is applied here rather than repeated: every negative row below lists **the exact identifiers searched**, so a reader can tell a surviving finding from a stale sentence without re-deriving the argument. Where a grep returns matches that are not the thing being denied, the matches are printed and characterised (E1, E6, E7, E21).
- **Everything in §2–§9 is ASSERTED.** No route, schema, table, header, error code, event or line of code exists as a result of this record. Every invariant in §11 names a test file that does not exist. This record writes no migration and no TypeScript.
- **⚠ BLOCKING PRECONDITION, inherited and restated a third time — 029 §12's request transaction still does not exist.** 040 §0 recorded it at `aa448bb`; 041 §0 restated it at `12470b3`; it reproduces at `b72033f` (§1 E24). **§5's idempotency record must be written inside the same transaction as the effect it makes idempotent, and §6's concurrency check must read and write under the same anchor lock.** Neither is testable, and neither may be claimed, until **E02-D04 `longbox-e5b.2.14`** ships `withTransaction`. This record therefore specifies §5 and §6 and orders them behind that bead, and **adopting this record does not change the running system by one line.**
- **One further precondition has SHIPPED and one has not (v1.1.1).** 041 §10 row 0 — `ENABLE ALWAYS` plus the `pg_trigger` test, **E02-D05 `longbox-e5b.2.15`** — **landed at `3269573` as migration `006`, with `src/db/appendOnlyTables.ts` as 041 §9.2 item 4's declared list.** So the append-only model is enforced against the bypass 041 §1 E14 reproduced, and **E02-D04's transaction helper is now the only unshipped precondition under this record.** Separately, §3's "make an unscoped route unrepresentable" argument leans on an architecture gate that **is not installed** — `.dependency-cruiser.cjs` does not exist (E22), which is E02-B10's. Where a decision below says *unrepresentable*, it means *unrepresentable once the named gate exists*, and §11 marks every such invariant.
- **No percentage appears in this record that is not a quoted 019 threshold.** 019 §2 (`019:34`) is explicit: *"Percentages without N and date are forbidden as claims of fact in 006, bead notes, docs and session prose; targets stay sayable when labeled PROPOSED/TARGET"*, and 022 P6 (`022:65`) applies the same rule to screens. §4.3 and §11 I9 make it a property of the contract rather than a rule someone remembers.
- **No numeric threshold is set here.** The lines this record leans on — T24 cross-tenant access = 0 (non-waivable), T35 per-operator rendering = 0 (non-waivable), T23 lost/duplicated offline items = 0, T17 draft success ≥99%, T3 ≤1%, T7 numeric grades = 0 (non-waivable), T19 auto-publish incidents = 0 (non-waivable), T33 consent coverage (non-waivable, G1 blocker), K1, K2, K4 — are quoted from 019 v1.2.0 as 040 §0 and 041 §0 quote them, and are **never re-derived**. **And no number set in this record is a measurement.** §8.4's two rate parameters and 041's `tx_max_retries` carry **PROVISIONAL circuit-breaker floors** at ratification (A3), each with its derivation stated and each explicitly non-evidentiary — 018 A3 caps claims of *fact*, not safety floors, and the distinction is A3's contribution. `abandon_after` stays **OPEN** because it describes what a session reads rather than protecting the system, and a provisional value there would manufacture provisional facts.
- **One inherited citation is CONTRADICTED and corrected rather than carried (E23).** 040 §7 says *"Every mutating call carries actor, tenant, correlation id, idempotency key and schema version (E02-B08's own acceptance; 029 §10)"*, and this bead's `Docs:` line points the same way. **029 §10 is "Consequences" (`029:685-698`) and contains no envelope, no schema version and no API surface.** The genuine hooks are 029 §11's non-decision (`029:704`) and §12.3's forward reference (`029:739`), both of which name E02-B08 explicitly. The *requirement* is real and is this bead's acceptance criterion; only the pointer was wrong. §9.3 files the repair as a 040 patch rather than performing it here.
- **Ratification will not move anything up the ladder.** When §14 is signed it will record that a design was argued and adopted. It will not make any claim in §2–§9 true of any running system, and in particular it will not retire the three live schema defects 041 §1 E16–E18 establish, nor the half-written-chain gap, nor the two live tenancy exposures this record adds to the list (E4, E5).

## 1. What exists today (REPRODUCED at `b72033f`)

| # | Claim | Evidence |
|---|---|---|
| **E1** | **There is no version anywhere in the Longbox API.** `grep -rniE '"/api/v\|/v1/\|schema_version\|api_version\|X-API-Version' src public tests migrations` returns matches, **and every one of them is somebody else's version**: Anthropic's `/v1/messages` (`src/providers/anthropic.ts:23`), eBay's `/buy/browse/v1/` and `/identity/v1/oauth2/token` (`src/services/ebay.ts:53`, `:69`), and Shopify's pinned `SHOPIFY_API_VERSION` (`src/routes/scanSessions.ts:397`), plus their tests. **No Longbox route, header, body or artifact carries a version of ours.** The one versioning discipline in the tree is 005's instruction for the *Shopify* version — *"Pinned API version in config; bump deliberately with a changelog entry"* (`005:146`). | grep, exit 0, every match third-party; `anthropic.ts:23`; `ebay.ts:53`, `:69`; `routes:397`; `005:146` |
| **E2** | **The registered surface is exactly ten routes in two files, plus two static mounts.** `grep -rnE 'app\.(get\|post\|put\|patch\|delete)\(' --include=*.ts src` returns ten lines: `app.ts:25` (`GET /healthz`) and `routes/scanSessions.ts:87, 92, 105, 115, 163, 196, 263, 295, 356`. The static mounts are `app.ts:18` (`/` → `public/`) and `app.ts:19-23` (`/${uploadsDir}/`). There is no other HTTP surface. | grep, ten matches; `src/app.ts:18`, `:19-23`, `:25` |
| **E3** | **Shop scoping is a string constant, and nothing enforces it.** `const base = "/api/shops/:shopId/scan-sessions"` (`routes:84`) is template-interpolated into seven registrations. A route registered with any other literal is registered identically — Fastify has no prefix plugin here, `registerScanSessionRoutes` takes the app directly (`routes:83`, called at `app.ts:27`), and there is no `onRoute` hook, no route-table assertion and no allowlist. **The tenant boundary is a convention held by one `const`.** | `routes:83-84`; `src/app.ts:27`; grep for `register(` with `prefix` in `src` → only the two `fastifyStatic` mounts |
| **E4** | **`GET /api/shops` returns every shop in the database to any caller, and it still does.** `routes:87-90`: `SELECT id, name, slug FROM shop ORDER BY created_at` — no `WHERE`, no tenant, no authentication, and it is registered **outside** `base`. The phone client calls it unauthenticated on load (`public/app.js:38`). **This is not a new finding and this record does not claim it as one**: 034 E9 (`034:43`) names it — *"Every shop is enumerable without credentials… That endpoint is what makes E8 exploitable rather than merely weak"* — and 034 §3.4 (`034:445`) walks the resulting cross-tenant read as a worked K1. **What is new is only that it reproduces unchanged at `b72033f`**, and that §3.4 below has to decide what an API contract says about it rather than leaving it to E03. 019 T24: cross-tenant access = 0, **non-waivable**, `any → K1`. | `routes:87-90`; `public/app.js:38`; `tests/integration/smoke.http.test.ts:54-56`; `034:43`, `034:445` |
| **E5** | **Every shop's photo bytes are served from one unscoped static tree, and this too is already on the record.** `app.ts:19-23` mounts `config.uploadsDir` at `/${uploadsDir}/` with `decorateReply: false` and no auth, no signature and no expiry; paths are `<uploadsDir>/<sessionId>/<timestamp>-<kind>.<ext>` (`routes:128-130`), so the only protection is the unguessability of a v4 UUID. The draft path composes listing image URLs straight from it (`routes:386`, `` `/${p.storage_url}` ``). **022 P7 (`022:72`) names it** — *"today `uploads/` is a public static mount, one of the eight 019 §3.0 safety controls"* — and **019 §3.0 (`019:49`) makes *"private uploads with the public static mount removed"* a G2 item.** Recorded here because a URL is an API contract and §3.5 owes E03-B07 a shape. | `src/app.ts:19-23`; `routes:128-130`, `:386`; `022:72`; `019:49` |
| **E6** *(re-derived at `3269573`, v1.1.1)* | **No request carries or returns a correlation id, and 034 already specified one.** `grep -rniE 'request_id\|correlation\|x-request-id\|reqId\|traceparent' src public tests` returns **three lines, exit 0**, and **not one is a correlation id** — all three are the substring `request_idempotency` inside PR #54's declared-list machinery: `src/db/appendOnlyTables.ts:196` (the list entry), `tests/integration/migrations.test.ts:160` (a comment naming the pending tables) and `tests/append-only-detector.test.ts:71` (the pending assertion). **The symbols that must return nothing, and do:** `correlation_id`, `request_id`, `x-request-id`, `reqId` and `traceparent` appear **nowhere** in `src`, `public` or `tests`. Fastify assigns an internal `req.id` and the logger emits it, but nothing puts it in a response, an error body or a database row, so *"what happened to this request"* has nothing to join on. **034 §3.1 (`034:391-399`) declares `correlation_id uuid` in the resolved `RequestContext`, attributed to "029 §2 / E02-B08"** — the field is assigned to this bead by a ratified record, and §4.7 adopts 034's spelling rather than minting a second name. *(v1.1.0 read "zero lines, exit 1", true at `b72033f` and false one merge later. The finding is unchanged; the sentence was not.)* | grep, three matches, all characterised; `src/db/appendOnlyTables.ts:196`; `tests/integration/migrations.test.ts:160`; `tests/append-only-detector.test.ts:71`; `src/app.ts:10-15`; `034:391-399` |
| **E7** *(re-derived at `3269573`, v1.1.1)* | **No request carries an idempotency key, and `request_idempotency` still does not exist as a table.** `grep -rniE 'idempoten' src migrations public tests` returns **ten lines, exit 0, and not one is a request key**. Six are about **re-running a migration** — `003:130` (`media_deletion`'s unique storage key), `005:141` and `006:5` (the idempotent trigger form), `migrations.test.ts:1`, `:74`, `principle-slots.test.ts:182`, `confirmation-outcome.test.ts:49`. **Three name `request_idempotency` and are PR #54's declared-list entry for it** — `src/db/appendOnlyTables.ts:196` (`kind: "permanent", pending: true`), `migrations.test.ts:160` and `append-only-detector.test.ts:71` — which is **this record's own §5.2 exemption, declared and not built**: `grep -rn 'CREATE TABLE.*request_idempotency' migrations` returns **zero lines, exit 1**. **The symbols that must return nothing, and do:** `Idempotency-Key` appears in no route, no handler, no test and no client; no request reads or writes a key. A retried POST still appends a second record at every step and a second Shopify product at the last. *(v1.1.0 read "six lines", true at `b72033f`. **The finding is stronger, not weaker**: the table is now on a declared list as pending, so its absence is recorded rather than merely true.)* | grep, ten matches, all characterised; `appendOnlyTables.ts:196`; `CREATE TABLE` grep exit 1 |
| **E8** | **There are two incompatible error envelopes, and the only one carrying a machine-readable code arrived by accident.** Twenty-eight handler-authored failures send `{ error: … }` (`routes:94` through `:371`). The 413 path sends Fastify's own serializer shape — `{statusCode, code, error, message}` — because the handler **throws** a decorated `Error` with `statusCode` and `code` (`routes:44-49`, thrown at `:140`) instead of calling `reply.send`. `tests/integration/photos.multipart.test.ts:172` asserts `res.json().code` toBe `"FST_REQ_FILE_TOO_LARGE"`. **The one response in this API a client can branch on programmatically is the one no handler composed.** | `routes:44-49`, `:140`; `tests/integration/photos.multipart.test.ts:171-172` |
| **E9** | **The `error` key holds two different types.** Sometimes a string — `"shop not found"` (`routes:96`), `"scan session not found"` (`:109`), `"kind must be cover\|barcode\|defect"` (`:125`) — and sometimes a Zod `flatten()` object (`:94`, `:100`, `:107`, `:117`, `:176`, `:208`, `:265`, `:276`, `:297`, `:316`, `:358`). No client can give the field a type. | grep `'{ error: '` over `src`, twenty-eight matches, split as listed |
| **E10** | **A third shape: `POST …/identify` returns its success body on failure.** `routes:192` is `if (outcome.error) return reply.code(502).send(outcome)` — so a 502 body is an `IdentifyOutcome` with an `error` **string field inside it**, beside `candidates`, `band`, `confidence`, `provider`, `model` and `costUsd`. It is neither `{error}` nor Fastify's shape. And `routes:182` returns `{ error: (err as Error).message }` at 503 — **a provider adapter's exception message, forwarded verbatim to the caller.** | `routes:182`, `:192-193`; `src/services/identify.ts:15-27` |
| **E11** | **Three unrelated conditions share one status with no code, and the test suite distinguishes them by matching English prose.** 409 is returned for *"shop has no pricing policy; run register-shop"* (`routes:319`), *"session has no human confirmation yet"* (`:367`) and *"session has no pricing snapshot yet"* (`:371`). `tests/integration/smoke.http.test.ts:152` asserts `expect(draft.json().error).toMatch(/no human confirmation/)`. **A prose match is the only discriminator that exists, in the tests and in the client alike.** | `routes:319`, `:367`, `:371`; `tests/integration/smoke.http.test.ts:152` |
| **E12** | **The only client renders the raw error body to the operator, as text.** `public/app.js` calls `status(JSON.stringify(data))` or interpolates it on every failure path — `:60`, `:94`, `:214`, `:257`, `:285`, `:328` — and the photo path renders `await res.text()` (`:73`). `status()` writes to `textContent` (`:24-26`). **So a Zod `flatten()` blob is operator-facing copy today**, and a provider exception message (E10) is one 503 away from the same screen. 022 P6 (`022:67`): *"Errors say what to do next; a screen never blames the person."* | `public/app.js:24-26`, `:60`, `:73`, `:94`, `:214`, `:257`, `:285`, `:328` |
| **E13** | **The identify response carries a raw confidence float, the provider id, the model name and the per-call cost — and the only guard against rendering them is a grep over the client.** `IdentifyOutcome` (`src/services/identify.ts:15-27`) declares `confidence: number`, `provider: string`, `model: string`, `costUsd: number`; `routes:193` returns it whole. `tests/public-copy.test.ts` then statically scans `public/app.js` for a `%`, a `.toFixed` near `confidence`, and a `costUsd` interpolation. **The contract emits exactly what 022 P6 (`022:65`, *"never probability language and never a bare number pretending to be a grade"*), 022 P8 (cost stays in `cost_log`) and 021 B19 (no "AI" in a shop-facing sentence) forbid on a screen, and the enforcement lives one layer downstream of the thing that emits it.** | `src/services/identify.ts:15-27`, `:151-162`; `routes:193`; `tests/public-copy.test.ts:31-60` |
| **E14** | **`llm_rerank`'s id is never returned, so 040 A1's required causal reference is UNSATISFIABLE on the confirm path today.** The `llm_rerank` INSERT at `src/services/identify.ts:129-133` has **no `RETURNING`** clause; `IdentifyOutcome` carries `candidateSetIds: string[]` (`:16`) and no rerank id. 040 §7 makes `against` **required** on the transitions endpoint and 041 §3.5 puts `against_table`/`against_id` on `human_confirmation`. **A client instructed to send the record it was shown has no id for the record it was actually shown.** No prior record names this; it is a response-shape defect that blocks a ratified design. | `src/services/identify.ts:16`, `:129-133`, `:151-162` |
| **E15** | **`GET …/:id` returns the `scan_session` row whole via `SELECT *`, so the column 040 retires is in a response body.** `getScanSession` is `SELECT * FROM scan_session WHERE id = $1 AND shop_id = $2` (`src/services/scanSession.ts:31`), typed as `ScanSessionRow` with `status: string` (`:6-12`), returned at `routes:111`. Three tests assert on it: `tests/integration/smoke.http.test.ts:67` (`"in_progress"`) and `:126` (`"drafted"`), and `tests/integration/scan-session-flow.test.ts:36`. **This is 040 A8's acceptance line, and it reproduces unchanged.** | `scanSession.ts:6-12`, `:31`; `routes:108-111`; the three test lines |
| **E16** | **The event trail is `SELECT *` over seven interpolated table names**, so `GET …/:id`'s `events` payload is every column of every row of seven tables — **and it grows automatically with every future migration.** `getSessionEvents` hardcodes the list (`scanSession.ts:73-81`) and interpolates each name into `SELECT * FROM ${t}` (`:85`). 041 §3.6 I9 makes the trail's *completeness* a rule and is right to; **nothing bounds its *projection*, and the two are different properties.** Every column 041 §2 adds to a witness table — `authored_by`, `actor_role`, `operator_id`, `definition_version`, `session_seq` — lands in this response on the day its migration applies, with no route, test or reviewer involved. | `scanSession.ts:73-81`, `:85`; `routes:110-111` |
| **E17** | **No route declares a response shape.** Fastify's `schema` option is used nowhere; `grep -n 'schema:' src/routes/scanSessions.ts src/app.ts` returns **zero lines, exit 1**. Every handler returns an object literal or a database row, and there is no serializer, no response type and no assertion that a response contains what it says it contains. | grep, exit 1 |
| **E18** | **The request shapes are Zod literals inline in the handlers, and they are not a contract.** `routes:51-52` (the two param schemas), `:97-99`, `:168-175`, `:201-207`, `:268-275`, `:302-315`. None is exported; none is imported by a test; none is emitted as an artifact. The bead's own note names this exactly — *"Today's Zod route shapes become one implementation of the contract, not the contract."* | `routes:51-52`, `:97-99`, `:168-175`, `:201-207`, `:268-275`, `:302-315` |
| **E19** | **There is no OpenAPI document and no generator.** `grep -rniE 'openapi\|swagger\|zod-to-json\|fastify-type-provider' package.json src` returns **zero lines, exit 1**. E14-B04's acceptance is *"Generate API, event, backward-compatibility and idempotency contract tests"*, and it is blocked on this bead; there is nothing for it to generate from. | grep, exit 1; `bd show longbox-e5b.14.4` |
| **E20** | **No event is published, and the only event vocabulary that exists is declared aspirational.** 029 `:52` states it in as many words: *"⚠ Every 'Publishes' and 'Consumes' list below is ASPIRATIONAL, not a description of running code. There is no event bus, no outbox and no publish call anywhere in this repository today; `workflow`'s fan-out is direct synchronous function calls."* The thirty-two names in 029 §2 (`029:67`, `:85`, `:99`, `:113`, `:127`, `:141`, `:157`, `:171`, `:185`) are PascalCase past-tense labels for Hickey records, **not a wire format**: no payload, no envelope, no ordering rule, no versioning. | `029:52`; the nine Publishes/Consumes lines |
| **E21** | **There is no rate limiting, throttle or quota of any kind.** `grep -niE 'rate\|throttle\|quota\|limit' src/app.ts` returns **one construct**: `multipart` `limits: { fileSize: 25 * 1024 * 1024, files: 1 }` (`app.ts:17`), which bounds one upload's bytes and not any caller's rate. **`POST …/identify` — the only route that spends money per call (`identify.ts:89`, cost recorded at `:145-147`) — is unmetered**, and nothing bounds calls per shop, per session or per minute. | grep; `src/app.ts:17`; `src/services/identify.ts:89`, `:145-147` |
| **E22** | **`.dependency-cruiser.cjs` does not exist.** `ls .dependency-cruiser.cjs` → **exit 2**. 029 §5 move 8 (`029:596`) and 040 I4d both require it, and 029 §5 move 8 note N2 (`029:507-516`) additionally requires a **non-graph** assertion, because the real damage — `db.query` on a Pool passed as a parameter — *"no import-graph rule can see"*. The required checks today are the eight jobs in `.github/workflows/ci.yml` (`:23` Lint, `:40` Typecheck, `:53` Unit + coverage, `:66` Integration + smoke, `:97` Secret scan, `:126` PR names its bead, `:158` harness verify + escape-scan, `:177` conform). **Every "make it unrepresentable at merge" argument in this record is therefore conditional on E02-B10, and §11 marks each one.** | `ls`, exit 2; `.github/workflows/ci.yml:23`, `:40`, `:53`, `:66`, `:97`, `:126`, `:158`, `:177` |
| **E23** | **An inherited citation is wrong, in this bead's own `Docs:` line and in 040 §7.** Both attribute the actor / tenant / correlation-id / idempotency-key / schema-version envelope to **029 §10**. `029:685` is `## 10. Consequences`; the section runs to `029:698` and consists of eight ratification-consequence bullets and a counterfactual. **It assigns no envelope and mentions no API.** Three records do carry the requirement: `029:704` — *"their payloads, versioning, actor/tenant/correlation/idempotency fields, error taxonomy and delivery semantics are E02-B08 and E02-B09"*; `029:739` — *"E02-B08 … and E02-B09 … replace it"*; and **`034:391-399`, which declares the `RequestContext` fields by name and attributes `correlation_id` to E02-B08.** The requirement stands and is better sourced than the pointer suggested; only the pointer was wrong. | `029:685-698`; `029:704`; `029:739`; `034:391-399`; 040 §7 closing paragraph |
| **E24** | **029 §12's request transaction still does not exist**, for the third record running. `src/db.ts` exports `getPool` (`:5`) and `closePool` (`:12`) and no transaction helper; `grep -rniE 'BEGIN\|COMMIT\|ROLLBACK\|withTransaction' --include=*.ts src` returns **one match and it is a prose comment** (`src/config.ts:38`); the only `BEGIN`/`COMMIT`/`ROLLBACK` in the repository are `scripts/register-shop.ts:46`, `:75`, `:84`. **E02-D04 is `longbox-e5b.2.14`, OPEN.** | grep, one comment match; `src/db.ts:5`, `:12`; `bd show longbox-e5b.2.14` |

**What §1 adds up to.** Longbox has an HTTP surface and does not have an API. The distinction is not pedantry: an API is a thing a second program can be written against, and every property that would make this one such a thing is absent. It has **no version**, so nothing can be promised and nothing can be deprecated (E1). It has **no declared request or response shape** — the Zod literals are validators inside handlers and the responses are database rows (E17, E18) — so there is nothing for E14-B04 to generate a contract test from and nothing for E17-B01 to hand a partner (E19). It has **three error shapes**, one of which is a success body with a field renamed, and the only machine-readable code in the system is the one a handler threw rather than composed (E8, E9, E10). It has **no idempotency**, so a retry over the counter's Wi-Fi duplicates a record at every step (E7). It has **no correlation id**, so a support question has nothing to join on, three months after 034 specified one (E6). And it still **enumerates every tenant on an unauthenticated route** and serves every tenant's photographs from one unscoped tree (E4, E5) — **both already named by 034 E9 and 022 P7, both still live**, against a threshold 019 signs at zero and marks non-waivable.

**The through-line, and it is not the same one as 040's or 041's.** Those two records are about the log: 040 stopped the system keeping a second, lossy copy of a fact, and 041 made the log say who wrote each row, in what order and against what. **This record is about the boundary — and the finding is that the boundary is where every guarantee those records won is given back.** The log will refuse a machine-authored condition by CHECK, and the response still hands the operator's client a raw model name and a confidence float and trusts it not to render them (E13). The log will record what world a write was made against, and the response never returns the id of the record the operator was shown, so the client cannot say (E14). The log will be append-only under `ENABLE ALWAYS` triggers, and a flaky connection still appends twice because no request carries a key (E7). The column 040 retires is dropped from the schema and still leaks from a `SELECT *` (E15) — and the leak is a *class*, not an instance, because the projection is unbounded and grows with every migration (E16). **E02-B08 is the decision that the contract is the boundary's, not the handler's: the shape a caller may send, the shape it gets back, what an error means, what a retry means, what a conflict means, and what the system says out loud when something happens.**

## 2. Decision A — The versioned surface, and what "versioned" means with one client

### 2.1 The rule

> **The API is versioned in the path: `/api/v1/…`. A version fixes the request shapes, the response DTOs, the error-code registry and the event envelope. Within a version, change is ADDITIVE ONLY. The contract's source of truth is Zod schemas in `src/contracts/v1/`; the OpenAPI document is a generated, committed build artifact, and CI fails when the generated file differs from the committed one.**

### 2.2 Path, not header

Three constructions were available and the choice is not close, though the losing argument is real.

**(a) Path prefix — `/api/v1/shops/:shopId/…`.** Adopted.
**(b) Header — `X-Longbox-API-Version: 1`, or `Accept: application/vnd.longbox.v1+json`.** Rejected.
**(c) No version until a second consumer exists.** Rejected, and it is the one a careful reader will reach for.

The argument for (a) over (b) is not aesthetic and it is not about REST. **It is that this project's entire evidence regime is citation, and a header is not citable.** 018 caps a claim at what its artifact supports, and every record in this series — 029, 034, 036, 037, 040, 041 and §1 above — earns its rungs with a `file:line`, a `grep` and its exit status, or an HTTP path. A version that lives in a header appears in no log line a reader can grep, no `curl` a reviewer pastes into a bead note, no Caddy matcher, and no test URL. A version in the path appears in all of them, for free, forever. Against that, (b)'s genuine advantage — a URL is a stable identifier and should not encode a representation choice — **does not apply to this surface**, because these are not resource identifiers: `POST …/identify`, `POST …/confirm`, `POST …/draft` and `POST …/price` are remote procedure calls wearing REST clothing, and pretending otherwise would be the only reason to prefer a header.

There is a second, operational reason. The estate's single ingress is Caddy (`~/000-projects/intent-os/ops/`), and routing or rate-limiting a path prefix is a one-line matcher while doing the same on a content-negotiated header is a different class of configuration. §8's per-shop posture is easier to hold at the edge when the version is in the path.

**And (c) — "one client, same origin, why version at all?" — is the argument this record has to answer honestly, because it is nearly right.** There is exactly one consumer today (`public/app.js`, E2), it is ours, it is served from the same origin by the same process (`app.ts:18`), and it ships in the same deploy. Versioning buys **nothing** for it. What it buys is for the four beads that are **blocked on this one**: E17-B01 (the partner API, its scopes, consent, entitlements, quotas and **version/SLA policy** — the acceptance criterion names version policy explicitly), E10-B01 (the versioned commerce capability contract and connector certification kit), E14-B04 (generate API, event, backward-compatibility and idempotency contract tests), and E05-B08 (the offline queue, whose replayed writes are by construction written by an *older* client than the one running). **A partner API introduced without a version is a promise that cannot be kept, and an offline queue is a second consumer running old code by design.** The version is not for today's client; it is for the client that is three weeks behind in someone's pocket.

**The test being applied is reversibility, and it is named here because the draft applied it without saying so (A1, Fowler).** The question is not *"is a version useful today"* — it plainly is not. It is *"which mistake can be unmade"*:

> **Versioning now is cheap and reversible: if a second consumer never arrives, the `v2` machinery is simply never built, and the whole cost was one path segment. Versioning after a partner has integrated is irreversible at acceptable cost: the version has to be introduced *as* the breaking change it exists to prevent.**

That asymmetry is what decides it, not a forecast about consumers. It is the same shape 030 §3.3 used to keep `edition_signature` a table rather than a column — *"Table-versus-column here is not decided by how often aliases occur. It is decided by which failure mode is recoverable"* — and stating it that way makes the decision checkable by a reader who disagrees with the forecast.

### 2.3 What a version fixes, and what it does not

A version is a **compatibility contract**, not a release number, and the distinction decides the cadence rule:

| Change | Within `v1`? |
|---|---|
| A new optional request field | **Yes** — additive |
| A new field on a response DTO | **Yes** — additive; clients ignore unknown fields |
| A new error code in the registry | **Yes** — additive; §4.4 fixes what a client does with an unknown code |
| A new route | **Yes** — additive |
| A new event name | **Yes** — additive. *(The naming scheme itself is **not** fixed here — A2 struck it and handed it to E02-B09; §7.4.)* |
| Removing or renaming any field | **No — `v2`** |
| Making an optional request field required | **No — `v2`** |
| Tightening a validation rule so a previously-accepted body is rejected | **No — `v2`** |
| Changing the HTTP status an existing error code maps to | **No — `v2`** |
| Changing what an existing error code *means* | **No — `v2`**, and never by reuse: a retired code is retired forever |
| Changing the ordering guarantee of an event stream (§7.2) | **No — `v2`** |

**Deprecation.** `v1` and `v2` are served concurrently. A version is retired no sooner than **two pilot batches** (019 §5's structure) and no sooner than 30 days after `v2` ships, announced by a 006 decision-log row naming the date, and every response on the deprecated version carries a `Deprecation` and a `Sunset` header from the day `v2` ships. **Numbers are not invented here**: "two batches" is a *structure* 019 already fixes, not a duration this record chose.

### 2.4 Reconciling with 030's single-rate posture — two different objects, one discipline

030 §5.2 (`030:339`) fixes the opposite cadence for a vertical pack: *"One version number governs the whole manifest… The parts do not version independently"*, and (`030:341`) *"The cost is churn — a typo fix in the prohibited-claims list is a version bump — and that is the right trade for a table whose entire job is to make past rows interpretable."* An additive-only API version with a deprecation window looks like a departure, and a later auditor would be right to ask. **It is not, and the reason is worth stating so the two records do not read as contradictory.**

> **A pack version is an as-of pointer for stored rows; an API version is a coordination point between two running programs.** Churn is nearly free for the first — nothing has to migrate, because an old row cites the version it was written under and that row is still on disk. Churn is expensive for the second — every bump costs every client a deploy, and E05-B08's offline queue cannot deploy at all until it reconnects.

**VALIDATED at ratification (A10, Fowler; §13 Q1 answered).** The cannon was asked whether this is a distinction or a rationalisation and answered that it is the former: the two version numbers govern different objects with different failure modes, and treating them alike would be the error. **One wording was corrected.** The draft said a bump *"costs the second two orders of magnitude more than the first"*, which is a measurement nobody took — precisely the class of claim 019 §2 and 018 A3 forbid, made by the record that spends §0 forbidding it. **It is a direction, not a magnitude**: a pack bump costs a row, an API bump costs every client a deploy, and the second is larger by an amount this record has not measured and does not need.

The *discipline* is identical in both: one number, an immutable meaning, and no silent re-versioning of a part under a stable whole. Only the cadence differs, and it differs because the cost of a bump differs by two orders of magnitude. **§13 Q1 puts this to the cannon rather than assuming it.**

### 2.5 The source of truth — Zod in `src/contracts/v1/`, OpenAPI generated and gated

Three candidates for where the contract *lives*:

**(a) A hand-written OpenAPI document, with the Zod validators kept in step by review.** *Rejected*, and 041 §12.2 already names the failure mode as a pattern rather than an incident: *"a `file:line` in a decision record is a perishable claim about a moving tree"*. A hand-written spec is that claim, made about every field, refreshed by nobody. It would be wrong within one merge.

**(b) Zod only, no OpenAPI.** *Rejected on the bead's own acceptance criterion* — *"OpenAPI/events generate contract tests"* — and on E14-B04, which is blocked on this bead and needs an artifact to generate from. A TypeScript type is not something a partner or a connector-certification kit can be handed (E10-B01, E17-B01).

**(c) Zod schemas in `src/contracts/v1/` as the single source of truth; `contracts/openapi.v1.json` generated from them, committed, and diff-gated in CI.** **Adopted.**

The shape is not novel here — it is **the shape this repository already uses twice**, and choosing a third spelling would be the error. `@intentsolutions/audit-harness` pins its artifacts by hash and CI verifies the manifest (`.harness-hash`, `.github/workflows/ci.yml:169`); 041 §9.2 item 4 decides *"one checked-in list in `src/`, read by the migration loop, the CI gate, the boot check and the five-minute detector"*, asserting equality **both ways**. **This is that construction applied to the wire: one declared shape, several readers, and a build failure when they disagree.**

Concretely, and this is the whole of the migration §9 asks for:

1. The inline Zod literals at `routes:51-52`, `:97-99`, `:168-175`, `:201-207`, `:268-275`, `:302-315` (E18) move to `src/contracts/v1/`, named and exported.
2. **Every route gains a response DTO** (§3.3) beside its request schema. Today there are none (E17).
3. The route handlers import them. **The route file stops being the contract and becomes one implementation of it** — the bead's note, verbatim.
4. `pnpm contracts:emit` regenerates `contracts/openapi.v1.json`; a CI job fails if the working tree differs after regeneration. **The generated file is committed** so a reviewer sees a contract change as a diff in the PR, which is what makes the additive-only rule of §2.3 reviewable rather than aspirational.

**The version is single-rate across the surface.** There is one `v1`, not a version per route. Per-route versioning is 030 §5.2's rejected shape (`030:341` — *"a signature function silently re-versioned under a stable schema version would change what dedupes against what while every row still claimed the same pack"*) with routes substituted for pack parts, and it fails the same way: a client that pins seven route versions has no answer to *"what version am I speaking?"*

## 3. Decision B — The resource shape, the response DTO, and a tenant prefix that is structural

### 3.1 The surface, route by route, as it stands and as it becomes

Ten routes (E2). Every row's "Today" column is REPRODUCED at `b72033f`; every "Under this record" cell is ASSERTED.

| # | Method + path (today) | File:line | Request shape today | Response today | Statuses today | Under this record |
|---|---|---|---|---|---|---|
| R0 | `GET /healthz` | `app.ts:25` | none | `{ ok: true }` | 200 | Unchanged and **unversioned by declaration** — it is a liveness probe for E13-B04, not an API call. On §3.4's allowlist with that reason. |
| R1 | `GET /api/shops` | `routes:87-90` | none | `{ shops: [{id,name,slug}] }` — **every shop in the database** | 200 | `GET /api/v1/shops`. **Returns only shops the caller is entitled to.** Pre-G2 there is no caller identity (034), so it is on §3.4's allowlist **with its exposure declared, not hidden** — the same discipline `003:46-51` uses for `actor_verified=false`: named by construction. E03-B02/B03 close it; **this record refuses to let it be closed by silence.** |
| R2 | `POST /api/shops/:shopId/scan-sessions` | `routes:92-103` | `{ created_by?: string }` (`:97-99`) | `{ session }` — the row, `SELECT *`-derived | 201, 400, 404 | `+ Idempotency-Key` (§5). Response DTO `ScanSessionCreated` — **`created_by` stops being written** (041 §8.4, I20 in §11). |
| R3 | `GET …/scan-sessions/:id` | `routes:105-112` | params only (`:52`) | `{ session, events }` — **two `SELECT *`s** (`scanSession.ts:31`, `:85`) | 200, 400, 404 | `{ session, state, transitions, events }` with **explicit projections** and the derived state (040 A8). **This is an acceptance line of this bead** — §11 I5. |
| R4 | `POST …/:id/photos` | `routes:115-161` | multipart, `kind ∈ {cover,barcode,defect}` (`:124`) | `{ photo: {id,kind,storage_url} }` | 201, 400, 404, **413** | `+ Idempotency-Key` (§5.5 for the multipart case). 413 becomes registry code `PHOTO_TOO_LARGE` in the envelope (§4.5). `storage_url` becomes a **scoped, expiring URL** — handed to E03-B07 with the shape fixed here (§3.5). |
| R5 | `POST …/:id/identify` | `routes:163-194` | `{ barcode_digits?: string }` (`:168-175`) | `IdentifyOutcome` **whole** — incl. `confidence`, `provider`, `model`, `costUsd` (`identify.ts:15-27`) | 200, 400, 404, 502, 503 | `+ Idempotency-Key`. **DTO strips `confidence`, `provider`, `model` and `costUsd`** (§3.3, §4.6) and **adds the ids of the records it wrote**, including the `llm_rerank` id, without which §6 is unsatisfiable (E14). 502/503 become registry codes with `retryable: true`. |
| R6 | `POST …/:id/confirm` | `routes:196-261` | `{ issue, source, confirmed_by? }` (`:201-207`) | `{ confirmation: {id, created_at, outcome} }` | 201, 400, 404 | `+ Idempotency-Key`, `+ against` (§6). **409 `STALE_WORLD_VIEW`** when the reference is not current. **409 `CONTRADICTION_BLOCKS_ONE_TAP`** on 040 F3. `confirmed_by` stops being written (041 §8.4). `setSessionStatus` (`:259`) is removed — 040 §7. |
| R7 | `POST …/:id/condition` | `routes:263-293` | range + defects + notes (`:268-275`) | `{ assessment: {id, created_at} }` | 201, 400, 404 | `+ Idempotency-Key`, `+ against`. **No numeric grade in request or response, in v1 or ever** (locked decision 5; 019 T7 non-waivable; 037 §1.1) — §11 I8 asserts it over the generated OpenAPI, which is a stronger assertion than a code grep because it covers the *declared* contract. |
| R8 | `POST …/:id/price` | `routes:295-354` | title/issue/variant/grade/upc/query/override (`:302-315`) | per-source summaries + suggestion + `stub` | 201, 400, 404, 409 | `+ Idempotency-Key`. The 409 at `:319` becomes `SHOP_HAS_NO_PRICING_POLICY`. Stub flagging stays and is **part of the DTO**, not a convenience key (033 D5). |
| R9 | `POST …/:id/draft` | `routes:356-425` | none | `{ draft, stub, product_set_input }` | 201, 404, 409, 502 | `+ Idempotency-Key`, `+ against`. The two 409s (`:367`, `:371`) become `SESSION_HAS_NO_CONFIRMATION` and `SESSION_HAS_NO_PRICING`; 040 F6 adds `SESSION_HAS_NO_CONDITION`; 040 G-c adds `BLOCKED_BY_RETENTION_HOLD`. `setSessionStatus` (`:419`) is removed. |
| — | `POST …/:id/transitions` *(new)* | — | — | — | — | 040 §7 specifies it; **this record adds only its envelope**: `Idempotency-Key` required, `against` required, and the response DTO carries the derived state so the client need not re-`GET`. |
| — | `GET …/scan-sessions?state=…` *(new)* | — | — | — | — | 040 §7's resumable list. **Never accepts an operator parameter** (040 F9, 019 T35) — §11 I7. Retires 005's `?status=in_progress` (`005:85`) as a name; the parameter is `state`. |

Two static mounts are not routes and are treated in §3.5.

### 3.2 The URL keeps its shape, and 005 is the record that changes

005 `:70` says *"all routes shop-scoped (shop resolved from env config in v0)"* and then specifies eleven paths with **no shop segment** (`005:73-88`). The tree went the other way and was right to: `/api/shops/:shopId/…` (E3) makes the tenant a path parameter rather than an ambient config value, which is what makes multi-shop real (`CLAUDE.md` §Build & test: *"Multi-shop is real: shops are rows"*) and what gives §3.4 something to enforce.

**And 034 has already ruled out the three alternatives.** `034:408` states the contract line without qualification:

> *"every shop-scoped table carries `shop_id`; the context above is resolved before any handler; **no handler derives tenancy from a body field, a query parameter or a header**"*

That forecloses a tenant in the body, in a query parameter and in a header, and leaves the path and the authenticated session. Since there is no session yet (E03-B02), **the path is the only option that exists**, and it is the one that will still be checkable after the session arrives: `034:412` records that RLS depends on a transaction that does not exist, and a path parameter is the thing a route-table walk can assert about in the meantime (§3.4).

**Decision: the tenant stays in the path, and 005's API section is superseded by §3.1 when this record ratifies** — 005 takes a Version bump then, not now. 005's two report routes (`005:86-87`, `/api/reports/accuracy`, `/api/reports/costs`) are `reporting`'s (029 §2.8) and are **not** designed here; §12 hands them to E11.

### 3.3 Response DTOs, and the rule that generalises 040 A8

040 A8 makes the `SELECT *` `status` leak an explicit acceptance line for this bead, asserted by 040 I20. **That is an instance, and the class is worth naming, because fixing the instance would leave the mechanism intact.**

> **No route response is derived from `SELECT *`. Every route returns a named response DTO declared in `src/contracts/v1/`, and a response body may contain no key the DTO does not declare.**

Three properties, in increasing importance:

1. **It closes the named instance.** `scan_session.status` cannot leak from a projection that does not select it (E15).
2. **It closes the class.** E16 is the general form: `getSessionEvents` interpolates seven table names into `SELECT *`, so **every column 041 §2 adds to a witness table lands in a response body on the day its migration applies** — `authored_by`, `actor_role`, `operator_id`, `definition_version`, `session_seq`, and whatever comes after. Some of those are per-operator data that 019 T35 signs at zero and marks non-waivable, and 034 §3.3 puts behind an audited break-glass accessor. **A `SELECT *` in a read model is a standing commitment to publish every future column**, and nobody would write that commitment down.
3. **It makes the OpenAPI document honest.** A generated spec (§2.5) can only describe what a DTO declares. If the handler returns a row, the spec describes a fiction.

**The test is a static one and it is cheap** (§11 I5): assert that no file under `src/` contains `SELECT *` outside a declared exemption list with a reason per row — 041 §9.2's exemptions-are-rows-not-absences idiom — and assert that every registered route's response validates against its DTO in the integration lane. The exemption list is expected to hold **`getSessionEvents`'s trail read and nothing else**, because 041 I9 requires the trail to be complete; and its row will say so, which means the one legitimate `SELECT *` in the system is the one a reader finds by reading the list rather than by searching the tree.

### 3.4 Making an unscoped route unrepresentable

E3 is that the tenant boundary is a `const`. E4 and E5 are what that already costs. The fix has two halves and only the second is structural.

**Half one — one prefix, one plugin.** The shop-scoped surface is registered as a Fastify plugin mounted once at `/api/v1/shops/:shopId`, so a route added inside it **cannot** be added without the prefix: it does not spell the prefix at all. This removes the failure mode where a new route is registered against a different literal and looks identical to a reviewer.

**Half two — the route-table assertion, which is the part that actually holds.** A plugin boundary is a convention a determined author routes around, exactly as `base` is today. So:

> **A test walks Fastify's registered route table and asserts that every route either sits under the tenant prefix, or appears on a declared unscoped allowlist with a written reason.**

**This record did not invent that test and should not be read as having done so.** 019 T35(b) (`019:118`) already requires *"a CI walk of Fastify's registered route table (not a hand-kept list) that fails closed on any unclassified route"*, and 034 §3.3 (`034:436`) restates it as a corollary of the accessor rule. **What this record adds is the classification the walk reads** — a route is *tenant-scoped*, or it is an *allowlisted exception with a reason and a closing bead* — because a walk that fails closed on an unclassified route needs somewhere for a classification to live, and 019 and 034 both specify the walk without specifying that.

**Every row carries a `kind`, and the two kinds are not the same epistemic object (A8, Kleppmann — the Q8 ruling).** The draft had one undifferentiated list, and the cannon's objection was decisive: *"a declared exposure against a non-waivable threshold is not the same epistemic object as a declared trigger exemption."* 041's exemptions are things that are **correct** and would look wrong without a reason. `GET /api/shops` is **not correct**. Filing them in one list makes the second read as permitted, which is how a citation becomes a waiver.

> **`kind ∈ {exemption, defect}`. An `exemption` is a route that is correct outside the tenant prefix and says why. A `defect` is a route that is WRONG, is not fixed yet, and names the bead that fixes it. A defect row means "this record refused to hide it", never "this record permitted it".**

| Route | `kind` | Reason | Closing bead |
|---|---|---|---|
| `GET /healthz` | `exemption` | liveness probe; returns `{ok:true}`, reads nothing, has no tenant | — (E13-B04 owns the probe) |
| `GET /api/v1/shops` | **`defect`** | the shop picker **returns every shop to any caller** (E4). A live **019 T24** exposure — cross-tenant access = 0, **non-waivable**, `any → K1`. It is not exempt from anything; it is broken, and the phone client depends on it until an authenticated session exists | **E03-B02 / E03-B03** |

> **G2 exit condition: no `defect`-kind row may exist on the allowlist at G2.** The list is allowed to carry a defect *now*, because hiding it would be worse and deleting the route would break the only client before there is anything to replace it with. It is **not** allowed to carry one when the gate that signs T24's controls closes. §11 I6 asserts the tag; the G2 gate asserts the count is zero.

The `exemption` half is 041 §9.2 item 4's construction — *"Exemptions are rows on the list with a reason, never absences. An absence is indistinguishable from an oversight"* — and it is applied here for the same reason 041 applies it to triggers: the thing this project keeps getting wrong is not making bad decisions, it is failing to notice that a decision was made by default. E4 is a worked example: nobody decided to publish the tenant list; a route was registered outside a `const`. **The `defect` half is this record's addition, and it exists because 041's idiom does not stretch to a non-waivable line.**

**⚠ Both halves are gates, and §0 records that the architecture gate is not installed (E22).** Half two is an ordinary vitest assertion and needs nothing; half one's *enforcement* — a route file that reaches `pg` or another module directly — is 029 §5 move 8 note N2's obligation on E02-B10 (`029:507-516`), which explicitly requires **a non-graph assertion** because import-graph analysis cannot see a `db.query` on a Pool passed as a parameter. §11 marks the affected invariants.

### 3.5 The two static mounts

`app.ts:18` serves `public/` and is the client itself; nothing to decide.

`app.ts:19-23` serves every shop's photographs from one unscoped tree with no auth, no signature and no expiry (E5), and `routes:386` composes listing image URLs from it. **This record does not design media security — E03-B07 does, and it is blocked on this bead — but it fixes the contract shape E03-B07 must satisfy**, because a URL is part of an API and handing E03-B07 an unconstrained one would be handing it the decision:

> A photo is addressed by a **shop-scoped, time-bounded, signed URL** issued by the owning module (029 §2.9 — platform owns *"object storage and signed delivery (E13-B06)"*), never by a filesystem path served from a static mount. `scan_photo.storage_key` is an internal reference and is **never** a response field. The listing image URL handed to Shopify is a separate decision with a different lifetime and is E10-B04's.

**One consequence, stated because it will otherwise arrive as a bug:** `routes:160` returns `storage_url` in the photo-upload response and `routes:386` builds `/${p.storage_url}` from it. Both are `storage_key` leaks under the rule above, and both are within this bead's DTO work.

## 4. Decision C — One error envelope, a code registry, and a server that never writes operator prose

### 4.1 The envelope

> **Every non-2xx response, from every route, in every version, is exactly this shape and nothing else:**

```jsonc
{
  "error": {
    "code": "SESSION_HAS_NO_CONFIRMATION",  // from the registry; the only field a client branches on
    "message": "…",                          // developer-facing English; NEVER rendered to an operator
    "details": { },                          // structured, code-specific; never free prose
    "correlation_id": "01J…",                // §4.7; the join key for support and for the log
    "retryable": false                       // §4.4; what a client and the offline queue may do next
  }
}
```

Five fields, and each earns its place against a specific finding in §1: `code` because three conditions share a 409 today and prose is the only discriminator (E11); `message` because a developer needs one and today it is doing an operator's job (E12); `details` because Zod's `flatten()` output is genuinely useful and today it is loose in the `error` key (E9); `correlation_id` because there is none, three months after 034 named it (E6); `retryable` because E05-B08's queue must decide whether to re-enqueue and today it must guess from a status code.

**`error` is an object in every response, never a string.** E9 is the type ambiguity; the fix is not to allow both.

### 4.2 The registry

> **Error codes are a TypeScript enum in `src/contracts/v1/errors.ts`, and each entry declares four things: its HTTP status, whether it is retryable, whether it is operator-renderable, and the 021 registered-copy row the client uses when it is.**

A representative slice — the full set is the implementing bead's, generated into the OpenAPI document, and every one maps to a §1 finding or a ratified rule:

| Code | HTTP | Retryable | Operator-renderable | Replaces / implements |
|---|---|---|---|---|
| `VALIDATION_FAILED` | 400 | no | no | the eleven Zod `flatten()` sends (E9); the flatten output moves to `details` |
| `SHOP_NOT_FOUND` | 404 | no | no | `routes:96` |
| `SESSION_NOT_FOUND` | 404 | no | no | `routes:109`, `:119`, `:167`, `:200`, `:267`, `:299`, `:360` |
| `PHOTO_TOO_LARGE` | 413 | no | **yes** | `routes:44-49` — the accidental envelope (E8), now deliberate |
| `SHOP_HAS_NO_PRICING_POLICY` | 409 | no | no | `routes:319` |
| `SESSION_HAS_NO_CONFIRMATION` | 409 | no | **yes** | `routes:367` |
| `SESSION_HAS_NO_PRICING` | 409 | no | **yes** | `routes:371` |
| `SESSION_HAS_NO_CONDITION` | 409 | no | **yes** | **040 F6** — new; a draft with no condition is refused |
| `CONTRADICTION_BLOCKS_ONE_TAP` | 409 | no | **yes** | **040 F3 / locked decision 7** — §4.6 |
| `STALE_WORLD_VIEW` | 409 | no | **yes** | **§6 / 040 §5.1** — the second device |
| `SESSION_IS_TERMINAL` | 409 | no | **yes** | **040 I5** — nothing follows a `voided` transition |
| `BLOCKED_BY_RETENTION_HOLD` | 409 | no | no | **040 G-c / 022 P7 Q6** |
| `IDEMPOTENCY_KEY_REUSED` | 422 | no | no | **§5.4** — same key, different body |
| `IDENTIFY_PROVIDER_UNAVAILABLE` | 503 | **yes** | **yes** | `routes:182` — and the provider's exception message stops being the body (E10) |
| `IDENTIFY_FAILED` | 502 | **yes** | **yes** | `routes:192` — and the 502 stops being a success body (E10) |
| `RATE_LIMITED` | 429 | **yes** | **yes** | **§8** |
| `WRITE_CONFLICT_RETRY_EXHAUSTED` | 409 | **yes** | **yes** | **A6** — the transaction exhausted `tx_max_retries` on `40001 serialization_failure` **or** `40P01 deadlock_detected`. Distinct from `STALE_WORLD_VIEW`, which is **not** retryable: this one means *nobody won yet*, that one means *someone else won* |
| `INTERNAL_ERROR` | 500 | **yes** | **yes** | today: an unhandled throw, serialized by Fastify |

**A retired code is retired forever and is never reused with a new meaning** (§2.3). This is 030 §5.2's immutable-meaning discipline applied to a smaller object, and it costs nothing.

**Both Postgres write-conflict classes are retryable, and 041 is amended to say so (A6, Kleppmann).** 041 §4.5 scopes the helper's retry to `40001` and `40P01` already; what the cannon found is that **this record's §5.3 introduces a deadlock class 041 could not have anticipated** — two handlers that take the idempotency row and the session anchor in different orders deadlock, and `40P01` is the code Postgres returns. §5.3 fixes the order so the deadlock is unconstructible (I22), and the retryable classification is stated here so a client and the offline queue treat both identically. **041 takes an amend-by-a-row for the scope sentence** (041 → v1.1.2), applied in the same commit as this ratification.

### 4.3 The rule that does the real work — the server never emits operator prose

> **`message` is a developer string. It is never rendered to an operator, in any client, ever. Operator-facing copy is selected by the client from `code`, and every such string is a 021 registered string before it is written (033 §9).**

This is 022 P6 (`022:67`) — *"Errors say what to do next; a screen never blames the person"* — made **structural rather than aspirational**, and it is the same move 041 §2.3 makes with `authored_by`: stop forbidding a thing and start making it unrepresentable.

The argument is E12 plus E13 read together. Today the server emits a Zod `flatten()` blob and a provider's exception message, and the client renders both verbatim to a person standing at a long box (`public/app.js:60`, `:73`, `:94`, `:214`, `:257`, `:285`, `:328`). Today the server also emits `confidence`, `provider`, `model` and `costUsd` in a success body, and the only thing between a model name and a screen is `tests/public-copy.test.ts` — **a static grep over one client file.** That guard is real and it works, and it is in the wrong place: it defends the last thirty lines of a pipeline whose first line hands over the forbidden material. Add a second client — E05's PWA, the offline queue's replay UI, a partner's integration under E17-B01 — and the guard covers none of them.

**Under this rule the server has no forbidden prose to leak, because it emits no operator prose at all.** 021 B17 (no number as a Longbox grade), B19 (no "AI" in a shop-facing sentence about condition), B14 (no invented provenance wording), 022 P6's percentages and 022 P8's cost all become properties of a **registered-copy table the client reads**, which is where 021 already says they live. The check the API owes is then a small one and a mechanical one (§11 I9): **no string in `src/contracts/v1/` or in any handler's `message` is marked operator-renderable, and no response DTO declares a field named for a percentage, a model, a provider or a cost.**

### 4.4 `retryable`, and why it is a field rather than a status-code convention

A client can *usually* infer retryability from the status. It cannot always, and the case where it cannot is the one that matters: **a 409 from §6's stale-world check is not retryable** (retrying sends the same stale reference and gets the same answer; a person must resolve it), while **a 409 from a write conflict is** — 041 §4.5 retries `40001` and `40P01` internally and surfaces `WRITE_CONFLICT_RETRY_EXHAUSTED` only after `tx_max_retries` (**PROVISIONAL 3**, §8.4). Two 409s, opposite answers, and E05-B08's offline queue is the thing that has to tell them apart on reconnect with no human present.

019 T23 signs **lost/duplicated offline items = 0**. A queue that guesses wrong in one direction duplicates and in the other drops. **So retryability is a fact the server knows and states, not an inference the client re-derives** — the same reasoning 041 A1 uses against inferring causality from a clock, one layer up.

### 4.5 Framework errors join the envelope through one handler

`app.ts` registers no `setErrorHandler` today, which is why the 413 has Fastify's shape (E8) and why an unhandled throw is serialized by Fastify's default. Decision: **one `setErrorHandler` in `platform` (029 §2.9 owns *"error taxonomy"*) maps every framework error into the envelope**, preserving `FST_REQ_FILE_TOO_LARGE` as the registry entry `PHOTO_TOO_LARGE` so the existing behaviour keeps a meaning.

**This changes a shipped test and the change is named rather than discovered**: `tests/integration/photos.multipart.test.ts:172` asserts `res.json().code`; under the envelope that becomes `res.json().error.code`. It is the only assertion in the suite that reads an error's machine-readable field, because it is the only one that has one.

### 4.6 Gate outcomes are codes, not prose

040 F3 forbids a `one_tap` confirmation when the driving `llm_rerank.contradiction` is true, and states it is *"a **schema-level** rule, not a UI convention: the API rejects it, so a client that skips the downgrade cannot produce the row."* **A rejection whose only content is an English sentence is a UI convention with extra steps** — the client has to parse it, and a second client will parse it differently.

So: `CONTRADICTION_BLOCKS_ONE_TAP`, with `details: { band: "medium", reasons: [...] }` carrying the structured contradiction reasons `checkEvidenceContradiction` already computes (`identify.ts:116`, stored at `:141`). The client renders 021's registered copy for a forced pick. **`reasons` are evidence strings about the book, not prose about the person** — and they are already written to `llm_rerank.response`, so this exposes nothing new; it stops the same information arriving as an unparseable sentence.

The same treatment covers the other gates: `SESSION_HAS_NO_CONDITION` (040 F6), `SESSION_IS_TERMINAL` (040 I5), `BLOCKED_BY_RETENTION_HOLD` (040 G-c). Each is a rule some record already ratified, and each is currently either absent or a sentence.

### 4.7 `correlation_id`, and why it is not called `request_id`

One id per request, generated by `platform` (029 §2.9 owns *"id generation"*), returned in **every** response — success and failure — as a header and, on failure, in the envelope. It is the join key for the log, for a support question, and for E13's observability work.

**It is called `correlation_id` because 034 got there first.** `034:391-399` declares the resolved `RequestContext` with `correlation_id uuid // 029 §2 / E02-B08`, so the field is already named in a ratified record and already assigned to this bead. The draft of this record called it `request_id`, which is the more usual word and is arguably the more accurate one — a correlation id conventionally spans several requests. **It was changed, and the reason is the one §7.2 gives about event names and 041 §9.2 gives about the trigger set: a second spelling of one thing is how two things start to drift.** 041 §2.5 made the same call in the other direction — *"`created_at` is not renamed to `recorded_at`… The decision is to state the semantics"* — and the rule underneath both is the same: **one name per idea, and the name is whichever one is already written down.**

It is **not** an idempotency key (§5) and the two are never conflated: a retry is a *new* request, with a *new* `correlation_id`, carrying the *same* `Idempotency-Key`. That is precisely what makes a replay traceable, and §11 I14 asserts it.

**It is not stored on a witness row.** 041 §2 fixed the row envelope and this field is not in it; adding it would be a second envelope on a shape 041 argued closed. It belongs in the log and in the `request_idempotency` row (§5.3), both of which are operational rather than historical.

## 5. Decision D — Idempotency

### 5.1 The rule

> **Every mutating route requires an `Idempotency-Key` header. A repeat with the same key and the same request hash returns the stored response and appends nothing. A repeat with the same key and a different request hash is `422 IDEMPOTENCY_KEY_REUSED`. Keys are scoped per shop.**

All eight mutating routes: R2, R4, R5, R6, R7, R8, R9 and the new `POST …/transitions`. **Not "should" and not "on the paths that matter"** — 040 §5.2 makes the point and it is the reason the header is required rather than optional: `listing_link.idempotency_key` (`036:229`, with `UNIQUE (shop_id, channel, idempotency_key)` at `036:395`) already gives the *binding* this guarantee, *"applied one layer up so the retry is a no-op at **every** step and not only the last one."*

**And the replay must return, never re-write.** 033 §5.1, quoted at `035:316`, is the constraint: *"a retry appends; it can never silently overwrite an earlier attempt."* A stored-response replay satisfies it in the only way an append-only system can — **the second call writes nothing at all**, so there is no overwrite and no second append. An implementation that "updated the previous record instead" would satisfy the letter of *no duplicate* and break the rule outright.

**A retry that changes its mind is not a retry (A9, Kleppmann, REQUIRED).** The idempotency key identifies **an act**, and §6's `against` is part of what the act asserts. So:

> **A client that receives `409 STALE_WORLD_VIEW`, refreshes its view and re-submits with a different `against`, is performing a NEW act and MUST mint a NEW `Idempotency-Key`. `STALE_WORLD_VIEW` invalidates the queued key.**

Without that rule the two mechanisms contradict each other: re-submitting the same key with a changed `against` changes the body, so §5.4's hash comparison returns `422 IDEMPOTENCY_KEY_REUSED` — and the operator, who did exactly the right thing, is told they made a client bug. Re-using the key while somehow *permitting* the changed body would be worse: the stored response for the losing act would be replayed for the winning one. **The rule is not a workaround for the 422; it is the statement that resolving a conflict is a decision, and a decision is an act.** It binds the offline queue in particular, where nobody is watching: a queued write that comes back `STALE_WORLD_VIEW` must be re-queued under a fresh key or dropped to a human, never retried under the old one. **E05-B08 carries it (§9.4), and I11 constructs the case.**

**This generalises 036 and does not restate it.** `036:189` gives commerce *"duplicate prevention across retries, the transactional outbox and idempotency (E10-B09)"* for the **binding path only**, and `036:774` reserves the SKU format, reconciliation cadence, webhook transport and the outbox/retry/DLQ to E10-B03/B05/B08/B09 and to new records. **Nothing here touches any of those.** What this record adds is one layer up and one layer earlier: a key on every mutating call, so the duplicate 019 T23 counts — a duplicated `candidate_set`, a duplicated confirmation, a duplicated snapshot — is prevented before anything reaches a binding.

### 5.2 The table

041 §4.2 and 040 §5.2 both specify it; this record adds only the request-hash discipline and states the exemption that 041 A11 decided.

```
request_idempotency(
  id               uuid PK DEFAULT gen_random_uuid(),
  shop_id          uuid NOT NULL REFERENCES shop(id),   -- locked decision 4
  idempotency_key  text NOT NULL,
  route            text NOT NULL,        -- the route TEMPLATE, not the resolved path
  request_hash     text NOT NULL,        -- §5.4
  response_status  integer NOT NULL,
  response_body    jsonb NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shop_id, idempotency_key)
)
```

**`platform`-owned** (029 §2.9 already claims *"idempotency keys"* at `029:176`), and §9.2 writes the amend-by-a-row entry.

**Exempt from the append-only trigger set, as a declared row with its reason** — 041 A11, Q7 answered yes: *"A table that stores response bodies and cannot delete a row cannot honour a deletion right."* It joins 041 §9.2's exemption table beside `scan_session` (temporary) and `physical_item_active_listing` (permanent). **Its retention window is E13-B01's** (040 A9), and this record neither sets one nor permits one to be assumed — §11 I2 asserts the exemption is *declared with a reason* rather than merely absent — and A5 adds a third reason the draft had not seen: the row is request-scoped operational state written and completed inside one transaction on one held connection (I21), which is not a witness table in any sense.

### 5.3 The constraint does the serialising — there is no in-flight state

The obvious design has three states — new, in flight, complete — and a status column to hold them. **That column is not built, and the reason is a ratified rule rather than a preference.**

041 §4.2(i) is DECIDED: *"A constraint, where one exists — always preferred… A constraint is the cheapest correct answer and it is correct under every isolation level."* Apply it:

1. The handler **INSERTs the `request_idempotency` row first, inside `withTransaction`**, then does the work, then updates the row's response fields — all in the same transaction, committed once.
2. A concurrent request with the same key **blocks on `UNIQUE (shop_id, idempotency_key)`** — Postgres holds the second inserter until the first transaction resolves.
3. If the first **commits**, the second gets a unique violation, re-reads the row inside its own transaction, and returns the stored response. Correct.
4. If the first **rolls back**, the second's insert succeeds and it does the work. Also correct — **nothing happened**, so nothing should be replayed.

#### The two mechanical preconditions the argument above silently assumes (A5, A6 — Kleppmann, both REQUIRED)

The cannon accepted the construction and refused the prose: *"proved only in English, against a transaction helper that does not exist."* Steps 1–4 are correct **only** under two conditions the draft never stated, and both are now invariants and E02-D04 acceptance lines.

> **(a) One connection, held for the request's lifetime (A5, I21).** The INSERT, the work and the UPDATE run on **one** `pg.PoolClient` checked out for the whole request — never `pool.query` per statement. A pooled call per statement would scatter the sequence across connections, each in its own implicit transaction: the uncommitted INSERT's lock would be released at the first statement boundary, step 2's block would not happen, and a concurrent second request could observe a **partially written** row — an idempotency record with no response, which is exactly the in-flight state §5.3 claims does not exist. **The claim "there is no in-flight state" is false if the connection is not held.** 041 §4.1's `withTransaction(pool, fn)` signature already implies it; nothing said it out loud.
>
> **(b) One fixed lock acquisition order, in every mutating handler, with no exceptions (A6, I22).** The `request_idempotency` INSERT is taken **before** the anchor `SELECT … FROM scan_session … FOR UPDATE` (041 §4.2), in every handler, always. Two handlers that take the two locks in opposite orders deadlock under concurrency, Postgres kills one with `40P01`, and the symptom is an intermittent failure at the counter that reproduces on nobody's laptop. **A fixed order makes the deadlock unconstructible rather than rare**, which is the same posture 036 §5.2 takes toward the D1 race — let the structure refuse it, rather than hoping the interleaving does not occur. It is enforced by a lint over handler bodies (I22), not by review, because a handler written six months from now by someone who has not read this section is exactly the case the rule exists for.

**Why this order and not the reverse.** The idempotency row is the request's *identity* and the session anchor is its *subject*; a replayed request must be recognised as a replay **before** it takes any lock on domain state, or a duplicate blocks a live session for the duration of work it was never going to do. Taking identity first also means the cheapest possible rejection path — a replay returns a stored response having touched no session row at all.

**No status column, no in-flight code, no lease, no timeout.** The three-state machine was going to be a mutable status column on an operational table, which is the exact shape 040 spent a document removing from `scan_session`, and it turns out the constraint already expresses it. That is 041 §4.2's preference order paying for itself the first time it is used.

**Note the row is UPDATEd** (step 1 writes it, step 3 completes it), which is legal precisely because the table is exempt from the append-only set (§5.2) — and this is the second, independent reason for that exemption beyond the deletion right 041 A11 named. **§13 Q4 asks whether the exemption's stated reason should be widened to say so**, since a reason that names only half of why is a reason a later reader will trim.

### 5.4 The request hash

> **`request_hash` is SHA-256 over a canonical serialization of (method, route template, resolved path parameters, request body). No fuzzy comparison, ever.**

The hash class is pinned the way 041 A5 pins `content_hash` — *"SHA-256 of the exact bytes… No perceptual or fuzzy hash… may be stored under this or any other column without its own decision record"* — and for the same reason: a hash whose matching rule is negotiable is a hash whose meaning drifts. Canonicalisation is sorted keys, no insignificant whitespace, and is itself part of the `v1` contract (a change to it is a `v2` change under §2.3, because it changes which retries are recognised).

**`Idempotency-Key` and `correlation_id` are not in the hash** — the first is the key and the second differs by construction on every retry.

### 5.5 Multipart

`POST …/photos` carries up to 25 MiB (`app.ts:17`). Hashing the body would mean buffering or a second pass. **Decision: for multipart routes, `request_hash` covers the non-file fields plus the SHA-256 of the file bytes, computed on the stream that is already being written to disk** (`routes:136`, the existing `pipeline(file.file, createWriteStream(tmpPath))`). No second read, no buffering, and the digest is the same one `scan_photo.content_hash` wants (`003:35-36`), so it is computed once and used twice.

**The ordering already in the tree is preserved and is load-bearing.** `routes:134-145` writes to a `.part` path, renames on success, and removes the bytes if the row insert fails (`:155-159`). 041 §4.1 forbids side effects inside the transaction body and §8.2 makes the same point about the purge: *"Where an operation spans a transactional store and a non-transactional one, the non-transactional side goes first and the transactional side is the record of it."* **The filesystem write stays outside the transaction and the idempotency row stays inside it**, which means a replayed photo POST can re-write bytes it then discards — cheap and correct — and can never double-append a row.

### 5.6 The offline queue generates the key when the operator acts

E05-B08's queue records a write at the counter and replays it minutes later. **The `Idempotency-Key` is minted at the moment of the act, stored with the queued write, and replayed unchanged.**

This is the same rule 041 A4 fixes for `session_seq` — *"`session_seq` is commit order. It is not the order in which the acts happened"* — applied to the key: a key minted at replay would make two replays of one act two different requests, which is precisely the duplication 019 T23 signs at zero. **The key is a fact about the act; `session_seq` is a fact about the commit; `against` (§6) is a fact about what the actor saw.** Three different questions, three different fields, and 041's whole argument is that collapsing any two of them is how a system starts inferring instead of recording.

**E05-B08 carries this as a note-obligation** (§9.4), beside the one 041 A12 already put on it.

## 6. Decision E — Optimistic concurrency, wire shape only

### 6.1 The rule

> **Every state-changing request carries `against` — the highest-witness record the actor was shown — as `{ "table": …, "id": … }` in the request body. The server compares it to the session's current witness under the anchor lock, and refuses with `409 STALE_WORLD_VIEW` when the world has moved. This record fixes the wire shape and nothing else.**

The semantics are already ratified and are not reopened: 040 A1 and §3.4 clause 2 define what the reference means and how the comparison runs; 041 §3.5 collapses 040's `observed_current_id` into the same `against_table`/`against_id` pair and puts them on `human_confirmation` and `condition_assessment`; 041 §4.2 puts the read and the write under one `SELECT … FROM scan_session … FOR UPDATE`, which is what makes the refusal *deterministic rather than racy* — the loser blocks, reads the winner's row, and is refused with the winner's answer in hand.

### 6.2 Body, not header

`against` goes in the **request body**, and the reason is §5.4: `request_hash` covers the body and not the headers. A world-view in a header would sit outside the hash, so a replayed request could carry a *different* view than the original and still be recognised as the same request. **The idempotency and concurrency mechanisms have to agree about what a request is**, and the cheapest way to make them agree is to put everything that is part of the request's meaning in the one place the hash covers.

### 6.3 One-tap carries it, and today it cannot

040 §7 makes `against` **required** on the transitions endpoint and 040 A1's rationale generalises it to every decision made against a displayed state. The one-tap confirm is the case worth walking, because it is the fast path and because **E14 is the finding that it does not work today.**

On a first confirmation there is no prior confirmation, so the highest witness the operator was shown is the re-rank that produced the candidate they tapped: `against = { table: "llm_rerank", id: … }`. On a correction it is the confirmation being superseded: `{ table: "human_confirmation", id: … }`. **The client therefore needs the `llm_rerank` row's id, and `POST …/identify` never returns it** — the INSERT at `identify.ts:129-133` has no `RETURNING` and `IdentifyOutcome` carries only `candidateSetIds` (`:16`).

> **Decision: `POST …/identify`'s response DTO returns the ids of every record the call wrote — the `candidate_set` ids it already returns, and the `llm_rerank` id it does not.** Without it, a ratified requirement is unsatisfiable by construction, and the failure would surface as E05 sending a `candidate_set` id where a rerank id belongs, which the comparison in 040 §3.4 clause 2 would accept as a lower-rung witness and treat as stale.

That is a small change to one INSERT and one interface, and it is the kind of thing that is nearly free now and expensive after two clients depend on the current shape.

### 6.4 What the operator sees is not this record's

040 A9 makes it an **E05 acceptance criterion**: the losing operator is shown *"Someone else answered this one."* with the other answer beside their own and one action to keep theirs — *"never a 409 body, never a stack trace, never the other operator's name (022 P3, 019 T35 — the surface says *someone*)."*

This record supplies the two things that criterion needs from the wire and nothing more:

- the code `STALE_WORLD_VIEW`, so the client selects registered copy rather than parsing prose (§4.3);
- `details: { current: { table, id } }` — **the reference only, never the row, and never an actor**. The client fetches the other answer through the ordinary read path, which is already tenancy-scoped and, once 034 §3.3's accessor lands, already break-glass-gated for per-operator fields. **Putting the winning row in the error body would be a second read path with its own leak surface**, and it would be the path where two operators are already confused — the worst place to invent one.

### 6.5 `against` is optional in `v1`, and the fallback is counted

040 A1 permits a legacy client with no reference, degrading to `created_at` and **incrementing a logged fallback counter** (040 I18). So `against` is **optional in the `v1` schema and required by E05's client**, and the count is the evidence that the fallback is not quietly becoming the norm. Making it required in the schema on day one would 400 every replay from a queue written by yesterday's client — which is E05-B08's normal operation, not an error. **Making it required is a `v2` change** (§2.3), and by then the fallback counter will say whether it can be made safely. *An uncounted fallback is a silent return to the rule it replaced.*

**And a changed `against` is a new act, not a retry (A9).** §5.1 states the rule; it is repeated here because this is the section a client author reads. Refreshing after a `409 STALE_WORLD_VIEW` and re-submitting means minting a **new** `Idempotency-Key`, and any client — the phone, the offline queue, a partner under E17-B01 — that reuses the old one is asking two different acts to share one identity.

## 7. Decision F — The outbound event contract

**⚠ Nothing publishes today (E20), the outbox is E02-B09's, and this section was CUT at ratification.** The draft
fixed five things. **The cannon struck one of them (A2)** — the generated event catalogue and every event name —
and what remains is only what a client or E02-B09 can actually be tested against. Delivery, retry, dead-lettering
and replay are E02-B09's; 029 §11 (`029:704`) assigns *"delivery semantics"* there by name, and `036:774`
independently reserves the webhook transport, the reconciliation cadence and the outbox/retry/DLQ to
E10-B05/B08/B09 and to **new decision records**. **This record absorbs none of them.**

### 7.1 An event is a reference, not a copy

> **An outbound event carries a reference to a committed row plus 041 §2's envelope. It never carries the row's values.**

041 §2.0 already settles what an event can mean here — *"The `scan_session` is the unit of causal ordering… Above
a session… nothing orders anything"* — and 041 §8.4's reference-not-value rule settles what it may contain. Three
reasons, in increasing weight:

1. **A copy is a second source of truth**, which locked decision 4 forbids and 041 §6.4 turns into a testable prohibition: *"A materialized read model may never be the only place a fact lives."* A payload sitting in an outbox row, or in a consumer's inbox, is exactly that.
2. **A copy is un-purgeable.** 041 §8 destroys bytes and appends a tombstone; an event carrying the deleted photo's metadata would be a copy of purged content in a queue, outside the purge path — 041 §8.3's objection to the raw `content_hash`, arriving through a different door.
3. **A copy is not replayable.** 041 §2.6: *"A derived artifact is replayable if it can be dropped entirely and recomputed from the witness tables plus its own `definition_version`, with no other input."* A consumer that re-reads the referenced row gets the current truth, including any supersession appended since. A consumer holding a copy gets a snapshot that silently ages.

```jsonc
{
  "shop_id": "…",
  "scan_session_id": "…",
  "session_seq": 42,
  "ref": { "table": "human_confirmation", "id": "…" },
  "definition_version": null,
  "occurred_at": "…",
  "recorded_at": "…",
  "correlation_id": "…"
}
```

**The event's name is deliberately absent from that example**, and §7.4 is why.

`occurred_at` / `recorded_at` are 041 §2.5's `observed_at` / `created_at`, spelled on the wire the way that
record spells them in prose. `definition_version` is present only where 041 §2.4 puts it on the row, and is null
otherwise — which is the honest answer, not a gap: nothing versioned produced that row.

### 7.2 What a consumer may rely on

> **Within one `scan_session`, events are delivered in `session_seq` order. Across sessions, across shops and across time, nothing orders anything. Delivery is at-least-once, and every consumer is idempotent on `(event, ref.id)`.**

This is 041 §2.0 promoted to a wire guarantee — and it is a *smaller* promise than most event systems make,
deliberately. 041 §5.3 A4 is why: `session_seq` is **commit order, not act order**, and for a replayed offline
write it is reconnect time. A consumer that reads `session_seq` as when the operator acted will be wrong exactly
when the counter's Wi-Fi was bad, which is the case E05-B08 exists for. **So the guarantee is stated at the
strength it actually has**, and §11 I4 asserts a consumer cannot rely on more.

Exactly-once is not offered and cannot be. Idempotency on `(event, ref.id)` is what makes at-least-once safe, and
it is cheap because the payload is a reference: re-reading a row twice is a read.

**And the producer's own draining order is not a guarantee (A7, Kleppmann).** Whatever order E02-B09's outbox
drains its rows in — insertion order, row id, or anything else — **confers nothing on a consumer beyond the
sentence above**, and a consumer that processes two deliveries concurrently must remain correct. Producer-side
ordering and consumer-side concurrency are independent, and a consumer that infers the second from the first has
inferred a guarantee nobody made. §9.4 carries it as an obligation on E02-B09 so it is not re-derived there.

### 7.3 Versioning — the row's `definition_version` is the event's version, and there is no second one

The draft gave the envelope its own `event_version`, moving with the API version. **A2 strikes it.**

An event has no content of its own (§7.1), so it has no content version to carry. An envelope version *separate
from* the referenced row's `definition_version` would be a second version number for one thing — the exact
failure 041 §9.2 exists to prevent one layer down, and the one §4.7 avoided when it declined to mint `request_id`
beside `correlation_id`.

> **Decision: an event carries `definition_version`, taken from the referenced row (041 §2.4), and no
> `event_version` field exists. The envelope's own shape is versioned by the API version (§2) — an envelope
> change is an API change, because the envelope is part of the contract §2 governs.**

### 7.4 What this record does NOT fix — the catalogue (A2, Fowler + Q6)

The draft derived event *names* from 041 §9.2's declared table list — `longbox.<module>.<table>.<verb>` — and
argued that a generated catalogue cannot drift from the schema. **The cannon struck it**, and the reasoning
generalises past this record:

> *"Ceremony over code that doesn't exist yet… no amount of cannon deliberation substitutes for building the outbox."*

The naming rule was not wrong. It was **unfalsifiable**: there is no outbox, no consumer and no publish call
(E20), so nothing could have shown the scheme inadequate, and the argument for it rested entirely on an analogy
to the trigger set. Worse, the draft's own §7.2 had already found the scheme producing an awkward result — three
of 029 §2's aspirational names have no table and therefore no event — and had reported that as a *feature*. **A
design that can only be confirmed, never falsified, is the thing 018's whole ladder exists to keep out of a
record.**

> **The event catalogue — the names, the verb set, and the generation rule — is E02-B09's, written against a
> running outbox with at least one real consumer.** §7.1–§7.3 stand because each is testable against a client and
> against E02-B09's implementation the day it exists: a payload either carries values or it does not; ordering
> either holds within a session or it does not; a version field either exists or it does not.

What this costs, stated: E02-B09 inherits a naming decision instead of a naming rule, and 029 §2's thirty-two
aspirational labels stay aspirational for one more bead. That is the honest position — H6 (`029:52`) has said so
since 029 ratified, and this record declining to close it changes nothing except that it stops pretending to.

## 8. Decision G — The rate and abuse posture for v0

### 8.1 Per shop, never per IP

> **Rate limiting is keyed on `shop_id`. There is no per-IP limit, and none may be added.**

Two reasons, and the second is the one that makes it a decision rather than a default.

**It does not work.** Every operator in a shop is behind one counter's Wi-Fi (033 §5.1), so a per-IP bucket throttles the shop as a unit anyway — while *also_ mistaking two shops behind one ISP or one mobile carrier for one shop. It is the wrong key for the thing being protected and it produces false positives on the one topology the pilot actually has.

**And it is a per-operator surface by the back door.** A per-IP or per-device bucket that fires is a record that *this device* exceeded a limit, and a device is one operator at a counter (034 §2.8 makes the device an auth principal precisely because it is). 019 T35 signs per-operator rendering at 0, **non-waivable**, and 022 P3 is the principle behind it. A rate-limit dashboard is a speed dashboard with a different title. **The tenant is the shop; the bucket is the shop.**

### 8.2 Two classes, because only one of them costs money

`POST …/identify` is the only route that calls a paid provider (`identify.ts:89`, cost recorded at `:145-147`); everything else is a database write. So:

| Class | Routes | Bucket | On exhaustion |
|---|---|---|---|
| **metered** | `POST …/identify` | per shop | **falls back to the manual path, never to an error** — see §8.3 |
| **ordinary** | every other mutating route | per shop | `429 RATE_LIMITED` with `Retry-After`, `retryable: true` |

### 8.3 The one part that needs no number — metered fails closed to the manual path

> **A shop that exhausts its metered budget does not get an error. It gets the manual-search flow.**

019 K4 is *"the pipeline never blocks on a provider"*, and 040 §4.6 tabulates how the system already honours it: a dead pricing source is a surviving source or the policy floor; a missing credential is a flagged stub; a model that errors or abstains is *"the manual-search path — `human_confirmation` with `source='manual_search'` (033 A3, §5.3). **Not a failure; a different route to the same rung.**"*

**A throttle we impose on ourselves is a provider outage we caused, and it would be incoherent to handle it worse than one we did not.** So the metered class degrades exactly as a provider failure degrades, through a path that already exists and is already tested. The operator is told the shop is on manual entry for now, in registered copy, and keeps working. **This is a decision with teeth and it needs no threshold**, which is why it is stated separately from §8.4's numbers.

### 8.4 The numbers — PROVISIONAL floors, because there is nothing to measure them from yet

**No request-rate figure exists anywhere in the ratified set.** 035 quantifies *items*, not calls: Pilot A 25 supervised, Pilot B 100 mixed, Pilot C ≥300 across ≥2 operators over ≥4 weeks, **≥425 cumulative** (`035:37-43`, matching `019:148-150`). 034 §4.6's representative shop is *"two operators, one shared counter phone, roughly four hours a week on back issues"* (`034:528`) with one registered device (`034:537`). The only latency figure is T10's ≤90 s median capture-to-draft (`019:76`), and the only concurrency figure in the estate is `019:155`'s *"T24 at 500-shop synthetic load"* at G5 — a security test, not a traffic model.

**The draft concluded from that that no number may be set, and the cannon overruled it (A3, Fowler, REQUIRED).** The objection is precise and it lands:

> *"Refusing to pick any number conflates claims of fact with safety floors. 018 A3 caps what may be **claimed**; it says nothing about what may be **configured** as a circuit breaker. A system with no limit at all is not epistemically humble — it is unprotected, and it ships that way to a shop."*

**"No limit until measured" is itself a decision with a failure mode**, and the draft had not priced it: a runaway client loop or a leaked credential burns a shop's model budget with nothing in the way, which is a 019 K4 economics event caused by an absent control. So:

> **The parameters take PROVISIONAL circuit-breaker defaults. They are a safety floor, not a measurement — 018 A3 caps claims of fact, not floors — and they are set generously enough that they cannot bind under any plausible pilot traffic. They fire on a runaway client or on abuse, and on nothing else.**

**The derivation, stated so a reader can check that it is a ceiling and not an estimate.** Take 035's largest batch — Pilot C's ≥300 items (`035:41`) — and compress the entire batch into one four-hour session on one shop, which is roughly the shop's whole month of back-issue time (`034:528`) spent at once: 75 items/hour. Each item costs at most about ten mutating calls (create, three photos, identify, confirm, condition, price, draft, plus a transition). That is **≈13 requests/minute for the entire shop at a load no pilot shop will ever produce.**

| Field | Value |
|---|---|
| `shop_ordinary_rate` | **PROVISIONAL 120 requests/min/shop.** ≈9× the compressed ceiling above. A shop cannot reach it by working; a loop reaches it in seconds |
| `shop_metered_budget` | **PROVISIONAL 500 paid identify calls/shop/day.** Identify is one call per item, so this is >1.5× the *entire Pilot C batch* in a single day |
| `tx_max_retries` (041 §4.5) | **PROVISIONAL 3.** Retries on `40001`/`40P01` only (§4.2, A6). Three attempts is the point past which a conflict is structural rather than transient, and I22's fixed lock order is what should make the second and third attempts rare |
| Rung | **PROVISIONAL — explicitly NON-EVIDENTIARY.** These numbers are **not** measurements, are **never** quoted as capacity, throughput or performance in any artifact at any class (021 B16), and support no claim of fact whatsoever. They are floors |
| Closing evidence | the observed per-shop request-rate and identify-call distributions across the 019 §5 pilot batches, **segmented by shop shape** as 034 A6 segments the gap rule — a solo owner-operator and a two-operator counter are different traffic. **The real values close from the counters; the floors are what run while the counters fill** |
| Guard | **every throttle event is counted from day one**, and a throttle that ever fires during normal pilot work is itself a finding — either the floor was miscalculated or something is wrong, and both are worth a 006 row |
| Red line | 018 C3: a floor may be **raised** freely (it binds less); **lowering one after seeing a result it would change** requires a 006 row saying so in those words |

**`abandon_after` is untouched and stays OPEN.** 040 §3.5 signed it OPEN deliberately, and it is not a circuit breaker — it is a **derivation parameter that decides what a session reads**, so a provisional value would produce provisional *facts*, which is exactly what 018 A3 does forbid. **The distinction the cannon drew is between a number that protects the system and a number that describes it**, and only the second is capped by the evidence rules.

### 8.5 What this is not

It is not authentication (E03-B02), not abuse detection, not a WAF, not DDoS protection, and not a quota product. It is one bucket per shop per class, a counter, and a fallback. **E03-B01's threat model is blocked on this bead and owns the abuse surface**; this record gives it a boundary to reason about rather than the current state, which is nothing at all (E21).

## 9. What this record hands to other beads

**Nothing in this section is written.** No file number is claimed and no migration is numbered — 041 §10's rule, learned twice: *"A file number is claimed when the file is written, never reserved in prose."*

### 9.1 Order

| # | Artifact | Blocked on |
|---|---|---|
| ~~**0**~~ | ~~041 §10 row 0 — `ENABLE ALWAYS` + the `pg_trigger` test~~ | **SHIPPED** at `3269573` — migration `006` plus `src/db/appendOnlyTables.ts` (E02-D05 `longbox-e5b.2.15`, PR #54) |
| **1** | `withTransaction` + the `FOR UPDATE` anchor | 0 by convention. **E02-D04 `longbox-e5b.2.14`.** §5 and §6 are untestable before it |
| **2** | `src/contracts/v1/` — request schemas, response DTOs, the error registry, the event **envelope** (§7.1); `contracts/openapi.v1.json` + its CI diff gate. **No catalogue and no event names** — A2 hands those to E02-B09 | 1 |
| **3** | The routes move to `/api/v1`, adopt the DTOs and the envelope, gain `Idempotency-Key` and `against`; `setErrorHandler`; `correlation_id`; the identify DTO returns its record ids (§6.3). **A4 constraint on the executing bead: the identify DTO change — adding the `llm_rerank` id, removing `confidence`/`provider`/`model`/`costUsd` — and `public/app.js`'s consumption of it land in the SAME PR.** Split across two, the client reads fields the server no longer sends, or the server keeps sending fields 022 P6 forbids because "the client still needs them" — and the second is how a temporary state becomes permanent | 2 |
| **4** | *migration* — `request_idempotency` with `UNIQUE (shop_id, idempotency_key)`, on 041 §9.2's exemption list with its reason | 1 |
| **5** | The unversioned aliases are removed; the `Deprecation`/`Sunset` window closes | E02-B10 |

Rows 2 and 3 are **E02-B08's own**. Row 4 rides with whichever migration lands next (040 §8.1 item 3 already sketches the table). Row 5 is E02-B10's contract step, beside 040 §8.2's.

### 9.2 The 029 amend-by-a-row entries this bead owes

029 §9 (`029:680-683`) permits amending a statement of fact by a row. **This record does not edit 029.** These are the exact rows for the parent to apply.

> **Entry A — 029 §2.9 (`platform`), "Tables owned".** Add **`request_idempotency`**.
> *Rationale:* `029:176` already claims *"idempotency keys"* among platform's responsibilities; this is the table. (040 §8.5 Entry C writes the same row; if that one has already been applied, this is a no-op and the parent should say so rather than apply it twice.)

> **Entry B — 029 §11 (`029:704`).** Append: *"E02-B08 discharges the API, error, idempotency and concurrency half of this bullet (000-docs/042); E02-B09 retains delivery semantics."*
> *Rationale:* the bullet is a non-decision that names the bead that will decide it. Recording that it has been decided is a statement of fact about the estate, not a change to 029's decision.

> **Entry C — 029 §12.3 (`029:739`).** Append a pointer to 042 §7, which fixes the event contract §12.3 says will replace §12. **§12 itself is NOT superseded by this record** — the transaction is still the consistency mechanism until E02-B09's outbox lands, and 041 §4 specifies it. §13 Q7 asks the cannon to confirm this reading rather than the stronger one.

### 9.3 The two patches this record PERFORMS (A11, A6)

The draft filed both for the parent. **The cannon directed that they be performed now** — a citation repair that waits is a citation repair that does not happen, which is 029 §9's own reason for making factual repair cheap.

**040 → v1.2.1 (A11).** §7's closing paragraph attributes the call envelope to *"029 §10"*, which is Consequences (E23). Under 040 §14 — *"statements of fact about the existing tree… may be amended in place by a patch bump plus a change-log row"* — this is a **patch, not a decision change**: the pointer becomes `029:704`, `029:739` and `034:391-399`. **Applied in the same commit as this ratification**, with its own 040 change-log row.

**041 → v1.1.2 (A6).** §4.5's retry sentence is widened to state that `40P01 deadlock_detected` is retried on the same footing as `40001 serialization_failure`, and to point at §5.3's fixed lock order as what makes the deadlock class unconstructible in the first place. A **patch**: 041 already retried both codes, and what changes is a statement about which conditions produce them. **Applied in the same commit**, with its own 041 change-log row.

### 9.4 Note-obligations

- **E02-D04 `longbox-e5b.2.14` — two acceptance lines (A5, A6).** `withTransaction` holds **one connection for the request's lifetime** and never issues a pooled call per statement (**I21**); and every mutating handler takes its locks in the **fixed order** of §5.3(b) — idempotency row, then the `scan_session` anchor — enforced by a lint over handler bodies (**I22**). Neither is optional and neither is this record's to test.
- **E02-B09 — the draining-order obligation (A7).** The outbox's own drain order confers **no** consumer guarantee beyond §7.2's, and a consumer processing two deliveries concurrently must stay correct. **And the event catalogue is E02-B09's outright (A2)** — the names, the verb set and the generation rule are written against a running outbox, not derived here.
- **E05-B08 — two obligations.** The `Idempotency-Key` is minted when the operator acts, not at replay (§5.6), joining the one 041 A12 already put on that bead; **and a queued write that returns `409 STALE_WORLD_VIEW` must be re-queued under a FRESH key or escalated to a human, never retried under the old one (A9, §5.1).**
- **E05-B09 / E05-B04** — 040 A9's stale-read criterion consumes `STALE_WORLD_VIEW` and `details.current`, and nothing else (§6.4).
- **E14-B04** — generate contract tests from `contracts/openapi.v1.json`. **Not from an event catalogue** — there is none until E02-B09 (A2).
- **E03-B07** — the media URL contract in §3.5.
- **E03-B02 / E03-B03** — §3.4's allowlist, and specifically its one **`defect`-kind row**, which must not exist at G2 (A8).

## 10. Alternatives considered

**A1 — No version until a second consumer exists.** *Rejected*, §2.2, and it is the alternative a careful reader reaches for first, because it is right about today. The counter is that **four beads blocked on this one are the second consumer**: E17-B01's partner API (whose acceptance names version/SLA policy), E10-B01's connector certification kit, E14-B04's generated contract tests, and E05-B08's offline queue — which is a second consumer *by construction*, since a queued write is replayed by a client that is by definition older than the one running. Introducing a version after a partner is integrated means introducing it as a breaking change.

**A2 — Version in a header.** *Rejected*, §2.2. The genuine argument for it — a URL is a stable identifier and should not encode a representation choice — does not apply to a surface where `POST …/identify` and `POST …/confirm` are procedure calls. The argument against it is that this project's evidence regime is citation, and a header appears in no `grep`, no bead note, no Caddy matcher and no test URL.

**A3 — A hand-written OpenAPI document.** *Rejected*, §2.5. 041 §12.2 names the failure mode as a pattern: a spec is a perishable claim about a moving tree, and one nobody regenerates is wrong within a merge.

**A4 — RFC 9457 `application/problem+json` as the error envelope.** *Considered and not adopted, and the margin is thin.* It is a real standard, it is what a partner integrating under E17-B01 would recognise, and its `type` URI is a better long-run identifier than a bare enum. It was not adopted for `v1` on two grounds: `type` as a dereferenceable URI is a documentation-hosting commitment this project has not made (the repo is deliberately private — locked decision 1), and `problem+json`'s `detail` field is **prose**, which is the exact thing §4.3 removes from the server's mouth. **A future record may adopt it as a wire alias over the same registry** — `type` derived from `code` — without changing anything decided here, and §13 Q3 asks whether that should be `v1` rather than later.

**A5 — A status column on `request_idempotency` for the in-flight state.** *Rejected*, §5.3 — and it is worth naming because it was the draft's first shape. The `UNIQUE (shop_id, idempotency_key)` constraint already serialises concurrent requests, so the three-state machine had nothing to do. Building it would have been a mutable status column on an operational table, one record after 040 removed exactly that from `scan_session`.

**A6 — Idempotency only on `POST …/draft`.** *Rejected*, §5.1. It is the cheap version, and 036 §5.2's `listing_link.idempotency_key` already covers the binding. 040 §5.2 answers it: the duplicate 019 T23 counts is not only the duplicated Shopify product — it is the duplicated `candidate_set`, the duplicated confirmation and the duplicated snapshot, each of which corrupts the eval set (R9) and the T3/T20 numerators before anything reaches a listing.

**A7 — Events carry the row's values.** *Rejected*, §7.1. It is what almost every event system does and it is wrong here specifically: a payload is a second source of truth (locked decision 4), it is un-purgeable (041 §8), and it ages while the row it copied is corrected by supersession. **The reference costs the consumer a read and buys the property that a consumer can never be looking at a superseded fact.**

**A8 — A generated event catalogue, derived from 041 §9.2's declared table list.** ~~*Adopted in the draft.*~~ **STRUCK AT RATIFICATION (A2, Fowler + Q6), and the reversal is the most instructive thing in this record.** The rule was defensible — 041 §1 E9 shows the same list spelled five times and already disagreeing twice, and generating names from one declaration is the fix 041 §9.2 applies to triggers. What it was not was **falsifiable**: with no outbox, no consumer and no publish call (E20), nothing could have shown the scheme inadequate. **A design fixed against zero running code cannot be wrong, which means it cannot be right either** — and the draft's own §7.2 had already met a result the scheme could not accommodate (three of 029 §2's names have no table) and reported it as a feature. The catalogue goes to **E02-B09**, to be written against a running outbox and at least one real consumer. §7.4 states what survives and why.

**A9 — Per-IP rate limiting.** *Rejected*, §8.1, on two independent grounds: it is the wrong key for a shop behind one counter's Wi-Fi, and a per-device bucket is a per-operator surface against a non-waivable line.

**A10 — Adopt 030's single-rate posture literally: any change to any part of the API is a version bump.** *Rejected*, §2.4, and **the rejection was validated at ratification** (A10). The discipline transfers; the cadence does not, because a pack version is an as-of pointer for stored rows while an API version is a coordination point between running programs, and a bump costs the second more — **a direction, not a measured multiple** (the draft claimed "two orders of magnitude" and nobody had counted). Stating it explicitly is what stops the two records reading as contradictory to a later auditor.

## 11. Acceptance criteria and invariants

Each is falsifiable and names the test that will decide it. **None of these tests exists** (018: nothing here is TESTED). Unit tests flat in `tests/`, DB tests in `tests/integration/`, contract tests in `tests/contract/`, per the tree's convention.

**Five are ⛔ UNWRITABLE until E02-D04 `longbox-e5b.2.14` ships `withTransaction`** — their subject is the transaction. **Three are ⚠ conditional on E02-B10 installing the architecture gate** (E22) — I15, I16 and I20 — and say so rather than claiming an enforcement that does not exist. **Seven are written to FAIL on the tree as it stands** — that is the point: they name a defect rather than a design.

**The five acceptance lines this bead inherits are I1, I5, I11, I12 and I13**, and they are listed first. **I21 and I22 are E02-D04 acceptance lines this record adds** (A5, A6): they are not tests of E02-B08's output, they are conditions on the helper E02-B08 is built upon, and §5.3 is unsound without both.

| # | Invariant | Test file |
|---|---|---|
| **I1** *(041 A8 / I20 — inherited acceptance line)* | **No file under `src/` writes `created_by` or `confirmed_by`, and no append-only table gains a personal identifier as a value.** Static assertion over 041 §9.2's declared list. **041 A8 requires this to land in the same PR as the deprecation comment** — *"a comment saying a column is deprecated, with nothing asserting it stopped being written, is a note rather than a deprecation."* **Fails on the current tree**: `routes:101` passes `created_by` and `routes:255` passes `confirmed_by`. | `tests/contract/no-personal-values-in-the-log.test.ts` |
| **I2** *(041 A11 — inherited acceptance line)* | **`request_idempotency` is exempt from the append-only trigger set as a DECLARED row with a reason, not an absence, and it has no retention sweep.** Assert the table carries no `%_append_only` trigger; assert 041 §9.2's declared list contains a `request_idempotency` row whose reason string is non-empty and names **all three** grounds §13 Q4 settles — the deletion right (041 A11), §5.3's mid-request UPDATE, and **A5's**: the row is request-scoped operational state written and completed inside one transaction on one held connection, so it is not a witness table in any sense; assert no sweep references it, and that the deferral to E13-B01 is recorded. | `tests/integration/append-only-trigger-set.test.ts` (extended) |
| **I3** *(040 A9 — inherited acceptance line)* | **A stale write is refused with a code and a reference, and nothing more.** Two concurrent confirms with the same `against`; assert one commits and one returns `409` with `error.code = "STALE_WORLD_VIEW"` and `error.details.current = {table, id}`; assert the body contains **no operator name, no `created_by`, no `confirmed_by` and no row contents** (019 T35, 022 P3). The operator-facing half is E05's (040 A9) and is not asserted here. ⛔ **blocked on E02-D04** — the deterministic refusal needs the anchor lock (041 §4.2). | `tests/integration/concurrent-confirmation-conflict.test.ts` |
| **I4** *(041 §5.3 — inherited acceptance line)* | **Events are ordered by `session_seq` within a session and by nothing across sessions.** Assert the contract's ordering declaration is per session and that **no cross-session or global guarantee is stated anywhere**; construct 041 I6(e)'s dual-offline replay — two writes queued against the same witness, replayed in each of the two possible orders — and assert the emitted event sequence for the session is identical under both, decided by `against_*`. **A consumer that could rely on cross-session order would pass a weaker test**, so the test also asserts the contract *declares no such guarantee*. | `tests/contract/event-contract.test.ts` |
| **I5** *(040 A8 / I20 — inherited acceptance line, generalised by §3.3)* | **No response body carries a `status` key sourced from `scan_session`, and no route response is derived from `SELECT *`.** Three assertions. (a) `GET …/:id`'s body has no `status` key. (b) Static: no file under `src/` contains `SELECT *` outside a declared exemption list, each row carrying a reason; the list is expected to hold `getSessionEvents`'s trail read and nothing else. (c) Every registered route's response validates against its declared DTO with `strict` unknown-key rejection. **Fails on the current tree**: `scanSession.ts:31` and `:85` are both `SELECT *` and `routes:111` returns the row whole. | `tests/contract/no-status-in-response.test.ts` |
| **I6** *(A8)* | **Every route is versioned and tenant-scoped, or is on the allowlist with a `kind`, a reason and a closing bead.** Walk Fastify's registered route table; assert every path starts with `/api/v1/shops/:shopId` or appears on the declared allowlist with `kind ∈ {exemption, defect}`, a non-empty reason, and — for a `defect` — a closing bead. **Then the G2 gate: assert the count of `defect`-kind rows is zero.** That assertion is expected to **fail until E03-B02/B03 land**, and failing is its job: it is the mechanical form of "this record refused to hide it". **Also fails on the current tree** for the ordinary reason: ten routes, none versioned, and `GET /api/shops` (`routes:87`) carries no declaration at all. | `tests/contract/route-table-scoping.test.ts` |
| **I7** | **No route accepts an operator parameter, and no response carries one (019 T35 non-waivable, 034 §3.3, 040 F9).** The two assertions are 034's corollaries verbatim (`034:433-434`) — *"No route accepts an operator or `created_by` value as a filter, sort or grouping parameter"* and *"No response body or export carries an operator identifier alongside more than one `scan_session_id`"* — run here **over the generated OpenAPI** rather than over the handlers. Rides on E03-B03's route walk. **The spec is the stronger subject**: it covers the contract a partner is handed under E17-B01, not only the code that happens to serve it today. | `tests/contract/state-routes-t35.test.ts` (extended) |
| **I8** | **No numeric grade appears anywhere in the declared contract (019 T7 non-waivable, locked decision 5, 037 §1.1).** Over the generated OpenAPI and the §7.1 event envelope: no request field, response field, error `details` key or event field is typed numeric and named for a grade; the condition DTO's range fields admit only the seven band words `GRADE_LABELS` declares (`src/services/condition.ts`). Complements 041 I2 (which forbids the writer) and 037 I3 (which forbids the rendered suggestion); **this one forbids the shape from existing in the contract at all**, and the three fail differently. | `tests/contract/no-numeric-grade-in-contract.test.ts` |
| **I9** | **The server emits no operator prose (022 P6 `022:67`).** Three assertions. (a) No error-registry entry marked operator-renderable carries a `message` that is ever rendered — the client selects from `code`. (b) No response DTO declares a field named for a confidence, a percentage, a provider, a model or a cost. (c) The generated OpenAPI contains no `%`, no model identifier and no provider identifier in any example or description. **Fails on the current tree**: `IdentifyOutcome` (`identify.ts:15-27`) declares `confidence`, `provider`, `model` and `costUsd`, and `routes:193` returns it whole. **This is `tests/public-copy.test.ts` moved upstream of the thing it guards**, and that test stays — the two are needed and they fail differently. | `tests/contract/server-emits-no-operator-copy.test.ts` |
| **I10** | **One envelope, no exceptions.** Drive every route into every failure it can produce, including the 413 and an unhandled throw; assert every non-2xx body is exactly `{error:{code,message,details,correlation_id,retryable}}`, that `code` is in the registry, and that `retryable` matches the registry's declaration. **Fails on the current tree**: three shapes exist (E8, E9, E10). | `tests/integration/error-envelope.test.ts` |
| **I11** | **The retry is a no-op at every step (019 T23).** Call each of the eight mutating routes twice with one `Idempotency-Key`; assert one record per step, one Shopify call, and a byte-identical response body. Then same-key/different-body → `422 IDEMPOTENCY_KEY_REUSED`. Then the concurrent case: two simultaneous requests with one key, asserting one does the work and the other returns the stored response **via the unique-violation path, with no in-flight state anywhere** (§5.3). **Then A9's case: a request that gets `409 STALE_WORLD_VIEW`, then re-submits with a refreshed `against` under a NEW key, succeeds and produces exactly one record — and the same re-submission under the OLD key returns `422 IDEMPOTENCY_KEY_REUSED`**, which is the behaviour that makes the rule enforceable rather than advisory. ⛔ **blocked on E02-D04.** | `tests/integration/request-idempotency.test.ts` |
| **I12** | **An idempotency key never crosses a shop.** Replay a key issued in shop A against shop B's route; assert it is treated as a new request and that shop A's stored response is not returned (019 T24, non-waivable). ⛔ **blocked on E02-D04.** | `tests/integration/request-idempotency.test.ts` |
| **I13** | **`POST …/identify` returns the ids of every record it wrote.** Assert the response carries the `candidate_set` ids **and** the `llm_rerank` id, and that the id is the row's. **Fails on the current tree**: the INSERT at `identify.ts:129-133` has no `RETURNING` and the id is never returned (E14), which makes 040 A1's required causal reference unsatisfiable on the confirm path. | `tests/integration/identify-returns-record-ids.test.ts` |
| **I14** | **Every response carries a `correlation_id`, and it differs across retries of one idempotency key.** Assert the header is present on 2xx and the field on non-2xx; assert two requests sharing an `Idempotency-Key` carry different `correlation_id`s — **which is what makes a replay traceable and is why the two are never conflated** (§4.7). | `tests/integration/correlation-id.test.ts` |
| **I15** | **The committed OpenAPI equals the generated one.** Regenerate from `src/contracts/v1/`; assert no diff. **This is the gate that makes §2.3's additive-only rule reviewable**, because a contract change becomes a diff in the PR. ⚠ **needs a CI job; E02-B10 owns the required-check wiring.** | CI job + `tests/contract/openapi-is-current.test.ts` |
| **I16** | **A version bump is additive or it is not `v1`.** Diff the committed `contracts/openapi.v1.json` against its previous committed revision; assert no field was removed or renamed, no optional field became required, and no error code changed its status or meaning. ⚠ **conditional on E02-B10** for the required check; the assertion itself is ordinary. | `tests/contract/openapi-additive-only.test.ts` |
| **I17** | **No event carries a version field of its own (§7.3, A2).** Assert no emitted event payload declares `event_version` or any envelope-level version beside the referenced row's `definition_version`; assert the envelope's key set is exactly §7.1's. *(The draft's I17 asserted a generated catalogue; **A2 struck the catalogue**, so the invariant that survives is the negative one — there is no second version number. Naming the catalogue is E02-B09's, and so is its test.)* | `tests/contract/event-contract.test.ts` |
| **I18** | **An event carries a reference and never a value (§7.1).** Assert every event payload's keys are exactly the envelope plus `ref`, and that no key holds a column value from the referenced row. Then the purge case: purge a photo (041 §8) and assert no emitted event ever carried its `storage_key`, its bytes or its hash. | `tests/contract/event-carries-no-values.test.ts` |
| **I19** | **A throttle is counted before it is enforced (§8.4).** Assert the counter increments on a would-be throttle while no limit is configured, and that no request is refused while both parameters are UNSET. Then, once configured: `429` with `Retry-After` and `retryable: true` for the ordinary class, **and the manual path — not an error — for the metered class** (§8.3, 019 K4). | `tests/integration/rate-posture.test.ts` |
| **I20** | **No route reaches the database directly (029 §5 move 8 note N2).** Non-graph static assertion that no file under `src/routes/` contains `db.query` or `INSERT INTO`. ⚠ **E02-B10 owns this**; it is listed here because §3.4's plugin boundary is a convention without it, and because `routes` issues **eight** `db.query` calls today — `grep -c 'db.query' src/routes/scanSessions.ts` → **8**, at `b72033f` and at `3269573` alike. *(v1.1.0 said "sixteen", which was an inflated number inside an invariant about counting things.)* **Fails on the current tree.** | E02-B10's lint assertion + `tests/contract/routes-are-thin.test.ts` |
| **I21** *(A5 — an E02-D04 acceptance line)* | **One connection, held for the request's lifetime, and no partially written idempotency row is ever observable.** Two assertions. (a) Static: `withTransaction`'s body acquires one `pg.PoolClient` and every statement in `fn` runs on it — **no `pool.query` inside a transaction body**, asserted over the helper and over every handler. (b) Behavioural, with an **artificially delayed first transaction**: hold the first request between its `request_idempotency` INSERT and its COMMIT, fire a second request with the same key, and assert the second **blocks** rather than reading anything — then, on commit, returns the stored response; and on rollback, does the work. **§5.3's "there is no in-flight state" is false if this test does not pass**, which is why it is an acceptance line and not a nicety. ⛔ **blocked on E02-D04.** | `tests/integration/request-idempotency-isolation.test.ts` |
| **I22** *(A6 — an E02-D04 acceptance line)* | **A fixed lock acquisition order, enforced mechanically.** Two assertions. (a) Static lint over every mutating handler body: the `request_idempotency` INSERT precedes the `SELECT … FROM scan_session … FOR UPDATE`, with **no exceptions and no opt-out comment**. (b) Behavioural: two concurrent requests on one session with different keys interleave without deadlocking, and a deliberately **reversed-order fixture handler makes the lint fail** — 029 §5 move 8's *"prove the gate can fail"* applied to a rule whose violation is otherwise an intermittent `40P01` at a counter. ⛔ **blocked on E02-D04.** | `tests/contract/lock-order.test.ts` + `tests/integration/lock-order-concurrency.test.ts` |

**I1, I3, I7, I8, I9 and I12 map to a non-waivable line** (T35 for I1/I3/I7; T7 for I8; T24 for I12; T35/T7 jointly for I9), and **I6 now carries T24 as well**, because A8's `defect` tag is what keeps the shop-enumeration row from reading as permitted. **I1, I5, I6, I9, I10, I13 and I20 fail on the tree as it stands.** **I3, I11, I12, I21 and I22 are ⛔ blocked on E02-D04**; the last two are its acceptance lines rather than this bead's output. The rest are structural.

## 12. Consequences, and what this record does not decide

### 12.1 What gets better

- **There is an API.** A version, declared request shapes, declared response shapes, one error envelope and a code registry — the five things E14-B04, E10-B01 and E17-B01 are each blocked on, and none of which exists (E1, E17, E18, E19).
- **The `SELECT *` class closes, not only the instance.** 040 A8 named `status`; §3.3 names the mechanism, and E16 shows why that matters: every column 041 §2 adds to a witness table would otherwise land in a response body the day its migration applies.
- **022 P6 stops being a downstream grep.** The server emits no operator prose (§4.3), so a second client cannot re-introduce the violation `tests/public-copy.test.ts` currently guards on one file.
- **040 A1's causal reference becomes satisfiable.** E14 is a ratified requirement blocked by a missing `RETURNING`; §6.3 closes it.
- **The retry stops duplicating at every step**, which is what 019 T23's signed zero needs on a counter with bad Wi-Fi (033 §5.1), and it stops by a constraint rather than a state machine (§5.3).
- **Two live tenancy exposures are on the record** with declared owners: the shop enumeration (E4) and the unscoped photo tree (E5). Neither was named by 029, 034, 036, 040 or 041.
- **The event envelope is fixed and the naming is honestly deferred.** The draft claimed 029's vocabulary *becomes derivable*; **A2 struck that** and it belongs in §12.2 instead. What genuinely improves is that a payload's *shape* — reference, envelope, no values, no second version number — is decided and testable, which is the half E02-B09 cannot invent for itself without re-opening locked decision 4.

### 12.2 What gets worse, stated plainly

- **Every client call changes.** A version prefix, a required header on eight routes, a new body field on four, and a different error shape everywhere. There is one client and it is ours, which is the only reason this is affordable — and it is affordable **now** and not after E17-B01.
- **`request_idempotency` grows unboundedly and its retention is still not decided.** 040 A9 deferred it to E13-B01 and this record does not close it either. §5.2 says so; **an unowned table that grows forever is how a retention commitment quietly stops being true**, and this is the second record to write that sentence about the same table.
- **The `request_hash` is a new correctness surface.** A canonicalisation bug makes a legitimate retry a `422`, and a canonicalisation *change* silently changes which retries are recognised — which is why §5.4 makes it part of the `v1` contract rather than an implementation detail.
- **Five invariants are blocked and three are conditional.** I3, I11, I12 and — after A5 and A6 — **I21 and I22** cannot be written until E02-D04 ships the transaction helper; I15, I16 and I20 need E02-B10's CI wiring, and §3.4's structural half needs the gate that does not exist (E22). **Ratifying this record makes none of them hold.** *(v1.1.0 said three and four; the amendments that added I21 and I22 moved both counts and this sentence was not re-counted.)*
- **The metered fallback (§8.3) is a good decision that lands on E05 and E06.** "Falls back to the manual path" is one sentence here and a flow, a registered string and a telemetry line there.
- **Three numbers are now configured that nobody has measured.** A3's floors are deliberately generous and explicitly non-evidentiary, but they are still numbers in a config file, and the failure mode is that someone six months from now quotes `shop_metered_budget` as a capacity figure. §8.4 forbids it in as many words and 021 B16 forbids it generally; **the guard is a sentence, and sentences are the weakest guard this record uses anywhere.**
- **029's aspirational event vocabulary stays aspirational for one more bead.** The draft would have closed it; A2 reopened it deliberately, on the ground that closing it against zero running code was not closing anything. That is the right call and it is still a cost: E02-B09 inherits a naming *decision* where it could have inherited a naming *rule*.

### 12.3 What this record does NOT decide

- **It does not write the contracts, the routes, the migration or any test.** §9 is a sequence; E02-B08 executes rows 2 and 3, E02-B10 owns row 5.
- **It does not decide delivery, and after A2 it does not decide naming either.** The outbox, retry budget, dead-letter, replay **and the event catalogue** are **E02-B09**; 029 §11 assigns *"delivery semantics"* there by name and A2 adds the names themselves. §7 fixes what an event *is* and what a consumer may rely on — never how it arrives, and never what it is called.
- **It does not decide authentication, roles or scopes.** `actor` on a call is a column today (034); who fills it and how the check runs is **E03-B02** / **E03-B03**, and pre-G2 rows stay `actor_verified=false` forever (034 §4.4). §3.4's allowlist declares the gap; it does not close it.
- **It does not decide media security.** §3.5 fixes the URL *contract*; the storage, signing and expiry are **E03-B07** and **E13-B06**.
- **It does not decide the partner API.** Scopes, tenant consent, entitlements, quotas and the SLA policy are **E17-B01**; this record gives it a version to hang them on.
- **It does not decide `request_idempotency`'s retention.** **E13-B01**, unchanged from 040 A9.
- **It does not set a rate limit.** §8.4 signs both parameters OPEN with their closing evidence.
- **It does not design the reporting endpoints.** 005 `:86-87`'s `/api/reports/accuracy` and `/api/reports/costs` are `reporting`'s (029 §2.8) and are **E11**'s; §3.2 records only that they are not in §3.1's surface.
- **It does not amend 029 or 005.** §9.2 writes the 029 rows for the parent to apply; §3.2 says 005 takes a Version bump at ratification. **It DOES amend 040 and 041, by one patch row each, performed in the same commit** (§9.3, A11 and A6): 040 → v1.2.1 for the `029 §10` mis-cite, 041 → v1.1.2 for the retry-scope sentence. Both are statements of fact under those records' own §14 clauses; **no decision in either is touched.**
- **It does not name a single event.** A2 struck the catalogue; §7.4 says why and hands it to **E02-B09**.
- **It does not supersede 029 §12.** The request transaction remains the consistency mechanism until E02-B09's outbox lands; §9.2 Entry C and §13 Q7 put that reading to the cannon rather than assuming the stronger one 029 §12.3 might permit.
- **It does not reverse or amend a locked decision.** Locked decisions 2, 3, 4, 5 and 7 constrain this record; where anything here conflicts with one, the locked decision wins.

## 13. The questions, as answered by the cannon

v1.0.0 put nine questions to two lenses; both returned **ACCEPT-WITH-CHANGES**. **Three came back as changes to
the design** (A2 from Q6, A3 from Q9, A8 from Q8), two were answered as drafted, and **six amendments arrived
that the draft had not asked for** (A1, A4, A5, A6, A7, A9, A11). The reasoning is kept rather than deleted,
because the reasoning is the record.

1. ~~**Is §2.4's reconciliation with 030 honest, or is it a rationalisation?**~~ — **ANSWERED: honest, and
   VALIDATED (A10, Fowler).** The two version numbers govern different objects with different failure modes; a
   pack version is an as-of pointer for stored rows and an API version is a coordination point between running
   programs, and treating them alike would be the error rather than the fix. **One wording was struck**: the
   draft's *"two orders of magnitude"* is a measurement nobody took, in the record that spends §0 forbidding
   exactly that. It now reads as a direction.

2. ~~**Is a path version right, or is the citation argument too clever?**~~ — **ANSWERED: right, and the argument
   was incomplete rather than too clever (A1, Fowler).** The citation point stands, but it is not what decides
   it. The decisive test is **reversibility**: versioning now is cheap and undoable, versioning after a partner
   integrates is not. §2.2 now states that test, so a reader who rejects the citation argument still has a reason
   to reach the same answer.

3. ~~**Should `v1` be RFC 9457 `problem+json`?**~~ — **ANSWERED: no, as drafted, and the margin stays thin.**
   Neither lens moved it. `type` as a dereferenceable URI is a hosting commitment a private repo has not made,
   and `problem+json`'s `detail` is prose, which is precisely what §4.3 removes from the server's mouth. **The
   door stays open exactly as drafted**: a later record may add it as a wire alias over the same registry without
   disturbing anything decided here.

4. ~~**Should `request_idempotency`'s exemption reason be widened?**~~ — **ANSWERED: yes, and it is wider than
   the question realised (A5).** The draft named two reasons — the deletion right, and §5.3's UPDATE. The cannon
   added the third and most operational: the row is written and completed **inside one transaction on one held
   connection** (I21), so it is not a witness table in any sense — it is request-scoped operational state. **I2
   asserts the reason names all of it**, and the widening is 041's to apply on its next touch, not this record's
   to force.

5. ~~**Is `against` in the body right, or should it be a header?**~~ — **ANSWERED: body, as drafted, and A9
   sharpened why.** `request_hash` covers the body; a header would let a replay carry a different world-view than
   the original and still be recognised as the same request. **A9 completes the argument the draft left half-
   made**: because `against` is inside the request's identity, changing it after a `409 STALE_WORLD_VIEW` is a
   *new act* requiring a *new key*. Without that rule the two mechanisms contradict each other on the one path
   where two people are already confused.

6. ~~**Does §7.2's generated event catalogue over-fit the schema?**~~ — **ANSWERED: the question was too kind to
   the draft, and the catalogue is STRUCK (A2, Fowler).** The problem is not over-fitting. It is that a naming
   scheme fixed against **zero running code** — no outbox, no consumer, no publish call — is **unfalsifiable**,
   and the draft had already met a result it could not accommodate and recorded it as a feature. *"No amount of
   cannon deliberation substitutes for building the outbox."* §7 keeps only what a client or E02-B09 can be
   tested against; the catalogue goes to **E02-B09**, written against a running outbox. §10 A8 records the
   reversal, because a struck decision is more instructive than an adopted one.

7. ~~**Does this record supersede 029 §12, or only pre-empt half of it?**~~ — **ANSWERED: the narrow reading, as
   drafted.** §12 stands until E02-B09's outbox lands. Declaring superseded a mechanism that §5 and §6 are
   *built on* would have been incoherent, and 029 §11 (`029:705`) already frames §12 as explicitly temporary. §9.2
   Entry C records the pointer without claiming the supersession.

8. ~~**Is the allowlist honesty or a waiver by declaration?**~~ — **ANSWERED: as written it WAS a waiver by
   declaration; with A8's tag it is not (Kleppmann).** The ruling is the sharpest thing in the cannon and it
   generalises: *"a declared exposure against a non-waivable threshold is not the same epistemic object as a
   declared trigger exemption."* 041's exemptions are things that are **correct**; `GET /api/shops` is
   **broken**. Filing both in one undifferentiated list makes the second read as permitted. So rows carry
   `kind ∈ {exemption, defect}`, the shop picker is a **defect**, and **no defect-kind row may exist at G2**. A
   defect row means *this record refused to hide it*, never *this record permitted it*.

9. ~~**Four OPEN parameters across four records — discipline or finding?**~~ — **ANSWERED: it was a finding, and
   two of the four were the wrong call (A3, Fowler).** *"Refusing to pick any number conflates claims of fact
   with safety floors."* 018 A3 caps what may be **claimed**; it says nothing about what may be **configured as a
   circuit breaker**, and a system with no limit is not humble, it is unprotected. `shop_ordinary_rate`,
   `shop_metered_budget` and `tx_max_retries` take **PROVISIONAL, explicitly non-evidentiary defaults** derived
   from 035's item ceiling and generous enough never to bind under real pilot work. **`abandon_after` stays
   OPEN**, and the distinction is the useful part: it is a parameter that decides *what a session reads*, so a
   provisional value would manufacture provisional facts — which 018 A3 does forbid. **A number that protects the
   system and a number that describes it are not the same object.**

**Six amendments the draft did not ask for.** **A5 and A6 (Kleppmann, both REQUIRED)** — §5.3's elegance was
*"proved only in English"*: it is correct only if one connection is held for the request's lifetime (I21) and
only if every handler takes its locks in one fixed order (I22), and neither was stated. **A4 (Fowler)** — the
identify DTO change and its client must land in one PR, or the server keeps sending fields 022 P6 forbids because
the client still needs them. **A7 (Kleppmann)** — the outbox's own drain order confers nothing on a consumer, and
E02-B09 should not have to re-derive that. **A9 (Kleppmann)** — a retry that changes `against` is a new act.
**A11** — the 040 mis-cite is repaired now rather than filed, because a filed repair is a repair that does not
happen.

## 14. Ratification

| Field | Value |
|---|---|
| Decision | **Adopt §2–§9** — the path-versioned surface with additive-only compatibility and Zod-as-source-of-truth (§2); the resource shape, the response-DTO rule and the tenant prefix with A8's `kind`-tagged allowlist (§3); one error envelope, the code registry and the rule that the server emits no operator prose (§4); `Idempotency-Key` on every mutating route, serialised by the constraint, on one held connection and under one fixed lock order (§5); optimistic concurrency on 040 A1's causal reference, wire shape only, with A9's new-act rule (§6); the outbound event contract **as cut by A2** — a row reference plus 041's envelope, `session_seq` ordering within a session, at-least-once with idempotent consumers, and the row's `definition_version` as the only version (§7); and the per-shop rate posture with A3's PROVISIONAL circuit-breaker floors (§8) — as the canonical API, error, idempotency, concurrency and event contracts for intent-longbox, **with amendments A1–A11 absorbed, none declined, and one draft decision STRUCK (§7's catalogue)**, together with §11's twenty-two invariants and §10's rejected alternatives. Apply §9.2's three amend-by-a-row entries to 029 under its §9 clause. **§9.3's two patches — 040 → v1.2.1 and 041 → v1.1.2 — are performed in this commit.** Binding on E02-B09, E02-B10, E02-D04, E03-B01, E03-B02, E03-B03, E03-B07, E05-B04, E05-B08, E05-B09, E10-B01, E10-B03, E13-B01, E14-B04 and E17-B01. |
| Status | **RATIFIED.** |
| Acting head of board | **Claude, acting head of board**, under Jeremy Longshore's 2026-09-03 delegation recorded in 006 |
| Date | **2026-09-04** |
| Cannon | `martin-kleppmann-reviewer` and `martin-fowler-reviewer`, 2026-09-04 — **both ACCEPT-WITH-CHANGES.** **Both lenses reproduced every §1 claim they sampled**: identify has no `RETURNING`; `confidence`/`provider`/`model`/`costUsd` reach the wire; three error envelopes; `GET /api/shops` is unscoped; the two `SELECT *`s; `withTransaction` is absent. **No §1 finding is disputed by either lens.** |
| Amendments at ratification | **A1** (Fowler) §2.2 names the **reversibility test** it was applying — versioning now is cheap and undoable, versioning after a partner integrates is not · **A2** (Fowler, **the strike**) §7's **generated catalogue and every event name are REMOVED**; what survives is a row reference plus 041's envelope, `session_seq` ordering within a session and nothing above, at-least-once with consumers idempotent on `(event, ref.id)`, and the row's `definition_version` as the event's only version — `event_version` struck. **The catalogue is E02-B09's, written against a running outbox**, because a design fixed against zero running code is unfalsifiable · **A3** (Fowler, REQUIRED) `shop_ordinary_rate`, `shop_metered_budget` and `tx_max_retries` take **PROVISIONAL, explicitly non-evidentiary circuit-breaker defaults** with their derivation stated; **018 A3 caps claims of fact, not safety floors**; `abandon_after` stays OPEN because it describes rather than protects · **A4** (Fowler) the identify DTO change and `public/app.js`'s consumption land in the **same PR** · **A5** (Kleppmann, REQUIRED) **I21** — one connection held for the request's lifetime, never `pool.query` per statement; a concurrent second request on an uncommitted key blocks and can never observe a partial row; an E02-D04 acceptance line · **A6** (Kleppmann, REQUIRED) **I22** — one **fixed lock acquisition order** in every mutating handler, idempotency INSERT before the anchor `FOR UPDATE`, enforced by lint; §4.2 adds `40P01` beside `40001` as retryable; 041 → v1.1.2 · **A7** (Kleppmann) the outbox's drain order confers **no** consumer guarantee beyond §7.2's · **A8** (Kleppmann, the **Q8 ruling**) allowlist rows carry `kind ∈ {exemption, defect}`; the shop picker is a **defect**; **no defect row may exist at G2** · **A9** (Kleppmann, REQUIRED) a retry that changes `against` after `STALE_WORLD_VIEW` is a **new act** and mints a **new key** · **A10** (Fowler) §2.4 **VALIDATED**, its churn claim reworded as a direction rather than a measurement · **A11** the 040 `029 §10` mis-cite is **patched now**, not filed. **None declined.** |
| **Dissent preserved** | **`martin-kleppmann-reviewer`, on Q8:** *"a declared exposure against a non-waivable threshold is not the same epistemic object as a declared trigger exemption … a waiver dressed as a citation."* **Resolved by A8** rather than overruled — the `defect` tag and the G2 exit condition are what make the distinction structural. · **`martin-kleppmann-reviewer`, on §5.3 and §6.1:** *"proved only in English, against a transaction helper that does not exist … written down as testable invariants."* **Resolved by A5 and A6**, which turn two silent assumptions into I21 and I22 and make both E02-D04 acceptance lines. · **`martin-fowler-reviewer`, on §7:** *"ceremony over code that doesn't exist yet … no amount of cannon deliberation substitutes for building the outbox."* **Adopted in full by A2** — the catalogue is struck, not defended. · **`martin-fowler-reviewer`, on §8.4 against 018 A3:** *"refusing to pick any number conflates claims of fact with safety floors."* **Adopted by A3.** |
| Adopted without change | **`martin-fowler-reviewer` on §4.3** — the rule that the server emits no operator prose, moving the 022 P6 guard upstream of the thing that emits the forbidden material rather than downstream of it. · **`martin-fowler-reviewer` on §3.3 and I5** — generalising 040 A8 from the `status` instance to the `SELECT *` class, recorded as **the model the rest of the record should have followed**: find the mechanism, not the occurrence. Both are noted because they were the draft's least certain passages and neither lens moved them. |
| Gate audit | *(pending)* — `longbox-gate-auditor` before the bead closes. |
| Jeremy's revision right | **Standing.** Jeremy may revise any line by a 006 decision-log row naming date, old text, new text and reason (018 §5). Locked decisions 2, 3, 4, 5 and 7 outrank this record, as do 019's signed thresholds and every ratified record it cites. Per `019:202`, a 022/019 conflict halts and escalates to the acting head by a 006 row; **no build agent reconciles the two by interpretation.** |
| Recorded in | 006 decision-log row dated 2026-09-04 (flipped **in place** from the PROPOSED row filed earlier the same day, per 018 §4 C2 — the PROPOSED text is preserved in version control); 016 §1 row 042, with rows 040 and 041 updated for their patches; 000-INDEX row 042; 040's change log at v1.2.1 and 041's at v1.1.2; the change log above; bead `longbox-e5b.2.8`'s close reason quotes this block. |

Binding from 2026-09-04. Changing any **decision** above — the version's location or its compatibility rule, the
contract's source of truth, the response-DTO rule, the allowlist's two kinds, the error envelope or a code's
meaning, the idempotency semantics, the lock order, the concurrency wire shape, the event payload or its ordering
guarantee, or the rate posture's key — requires a new decision record naming this one as superseded (018 §4 rule
S4), never an in-place edit. Four things are explicitly **not** decisions and may be amended in place by a patch
bump plus a change-log row, following 029 §9's precedent: **statements of fact about the existing tree** (a
`file:line` that turns out wrong is a defect in the description, not the decision); **the error registry's
membership**, which is *designed* to grow — adding a code is additive under §2.3 and is the rule working;
**`shop_ordinary_rate`, `shop_metered_budget` and `tx_max_retries` (§8.4)**, which are PROVISIONAL floors that
close by measurement and may be **raised** freely; and **§3.4's allowlist rows**, which are designed to shrink —
removing the `defect` row when E03-B02/B03 land is the plan working, not an amendment to it.

**Ratification is not evidence** (018 §2 A3). This block records that a design was argued by two lenses and
adopted, and that one of its decisions did not survive the argument. It does **not** make any claim in §2–§9 true
of any running system: **nothing here is built, nothing is TESTED**, every invariant in §11 names a test file that
does not exist, **five are ⛔ blocked** on a transaction helper that does not exist, three are **⚠ conditional** on
an architecture gate that is not installed (I15, I16 and I20), and seven are written to **fail on the
current tree**. §1 stays
REPRODUCED and everything else stays ASSERTED. **In particular, ratification does not retire the two live tenancy
exposures — the unauthenticated shop enumeration at `routes:87`, now carried as a `defect` row that must not
survive G2, and the unscoped photo tree at `app.ts:19-23` — both live at `b72033f`.**
