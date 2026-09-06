# Decision Record — The Identity Accessor: One Door Between a Key and a Person, and the Fact It Leaves Behind

**Version:** 1.1.1
**Status:** **PROPOSED — UNSIGNED.** The two-lens cannon **was convened by the session** on 2026-09-06 against PR #97 head `e74a47f`: `security-auditor` **ACCEPT-WITH-CHANGES** and `rich-hickey-reviewer` **ACCEPT-WITH-CHANGES**. §2 now carries the dispatched lenses' **verbatim** statements; v1.0.0's labelled builder drafts are superseded rather than kept beside them, and §12 records how badly they anticipated. A `longbox-gate-auditor` **NOT-READY** is folded in the same pass. **Every finding is folded and none is declined**; two positions are adopted in a form the lens did not ask for and are preserved in §12. The acting head signs at CLOSE, after the `longbox-invariant-reviewer` PASS — a record that announced its own ratification in the commit that wrote it would be the artifact deciding its own review (053's rule, unchanged).
**Bead:** E03-D17 `longbox-e5b.3.27` — *Build the identity accessor module so every path that joins a row to a person is gated and audited* (epic LBOX-E03 `longbox-e5b.3`, gate G2, P1) — discovered 2026-09-04 by E03-B03 / 054 §8, because **019 T35(b) is non-waivable and had no owner at all**
**Filed:** 2026-09-05 · **Author:** `longbox-security-tenancy-builder` · **Owner:** parent session (acting head of board)
**Sensitivity:** Restricted internal (014 §10). It names tables, columns, functions and commands; it contains no person's name, no identifier of any live person, and no secret value of any kind.
**Scope of this commit:** the RECORD and its CODE HALF land together on one branch. Migration `035`; `src/identity/` (four files, one barrel); five migrated call sites and ONE DELETED READ; two `.dependency-cruiser.cjs` rules; four `pnpm arch` rules; a fifth app-role privilege class **and its boot assertion**; `pnpm audit:identity-access`; one unit suite, one integration suite, and a NEGATIVE FIXTURE for every rule half — including the boot assertion (grant the SELECT, watch the boot fail, watch the application really read its own log) and three refusal cases on the observed accessor pair. No count is asserted here: the suites are the inventory.

---

## Change log

**Version convention** (006 `:6`): a **minor** bump means the content of a decision changed; a **patch** means a statement of fact was repaired with no decision changing.

| Version | Date | What changed | Who |
|---|---|---|---|
| **1.1.1** | **2026-09-06** | **Patch — three statements of fact repaired and five clarified; no decision changes.** The gate audit's re-audit found the FOLD had introduced its own defects. **B1** — 019 §9.5 A10's *"exact sentence added"* cell quoted the RETIRED reason for the break-glass clause while the T35 row above carried the corrected one; the cell is now byte-identical to the applied sentence (019 → v1.6.1). **B2** — the 006 decision-log row said *v1.0.0*, *034 → v1.4.0*, *four accessors* and repeated F4's struck clause; all four corrected, and **006 keeps its 1.81.0** because a correction to an unlanded row is not a bump. **B3** — 048's addendum and §8 said the rule *"forbids the three attribution names"*; it gates **seven** `PERSON_PROJECTION_COLUMNS` from **any** table, which is the whole point of security F1, and both now say so (048's v1.6.1 row is unmerged, so the repair FOLDS into it rather than taking a v1.6.2). Plus: §10.1 renumbered **§11.1** (it sat under §11); *gate F8* labelled as the TWO-part finding it is; the finding arithmetic stated so *F7* and *Hickey 5* are not read as a ninth and tenth; §2's `e74a47f` marked as the pre-rebase head; and 016 §1 gains its 060 row. | gate re-audit → acting head |
| **1.1.0** | **2026-09-06** | **Minor — the cannon was dispatched and every finding is folded; four of them ADD ENFORCEMENT and one WIDENS A CONSTRAINT, which is why this is a minor and not a patch.** **§2 is now the lenses' own words**; the builder drafts are gone and §12 records that they anticipated two findings of eight, which is the honest measure. **Security F1 (HIGH):** `currentRecoveryNomination` projected a named human's name and contact note out of `shop_recovery_nomination`, wrote no fact and had NO CALLER — so **I1 was false in the tree it governs**. The read is DELETED and `contact_name`, `contact_note` and `email` join `PERSON_PROJECTION_COLUMNS`: a person's attributes are not the property of one table. **Security F2 (= gate F2):** the fifth privilege class had no runtime enforcement — `GRANT SELECT ON identity_access` was accepted and both boot assertions passed — so §3.4's *"enforced twice"* meant *build-time twice*. The insert-only class joins the boot assertion's forbidden-grant check. **Security F3:** the accessor pair is now OBSERVED from the request rather than typed as a literal, and an undeclared triple REFUSES; §4.4 states what remains (the purpose is still a literal). **F3b:** the public-surface rule reaches `scripts/`, which `pnpm depcruise` does not. **Security F4:** §4.3's *"the reads that resolve a third party's record do not exist yet"* was **FALSE** — the roster and the enrollment CLI both do — and is replaced by what actually bounds them. **Security F5 (= gate F8):** `created_at` is truncated to the hour, §5.2's caveat is carried into §3.2's index argument, and the timing-series residual is filed. **Hickey 1:** the rule `resolved_count` obeys is written down. **Hickey 4:** the two identical accessors are ONE. **Hickey 2:** §9 A8 argues the `SECURITY DEFINER` alternative and does not take it. **Gate F7:** `created_by` and `confirmed_by` join the key-kind enum — without them the first reader of a pre-G2 attribution string could not have written its fact at all. Plus nine dead §-cites, two wrong counts and one wrong section number repaired. | Two-lens cannon + gate audit → acting head |
| 1.0.0 | 2026-09-05 | Initial draft. **Status PROPOSED, §13 unsigned.** Six decisions: the accessor is a DIRECTORY with one barrel and not a file (§3.1); the audit fact records the ACCESSOR and never the SUBJECT (§3.2); the purpose vocabulary is closed by a CHECK and the accessor inventory by code, and the asymmetry is what makes the audit worth running (§3.3); the application may INSERT the fact and may never SELECT it — a fifth privilege class (§3.4); the boundary is enforced in the import graph AND over SQL text, because neither half sees the other's failure (§4); and 034 §3.3's break-glass clause is **NOT** implemented, with the reason stated rather than the clause quietly dropped (§4.3). | `longbox-security-tenancy-builder` |

---

## 0. Evidence posture

Every claim in §1 is a command and its output, taken at `df01ef6` (`main`, 2026-09-05) — the base this branch was cut from. **No timing figure, percentage or rate about Longbox appears in this record** (019 §3.3, 021 §2). No count is asserted from a line count where the thing being counted is not a line.

---

## 1. What exists today — REPRODUCED at `df01ef6` (`main`, 2026-09-05)

| # | Claim | Command and what it returns |
|---|---|---|
| **E1** | **There is no accessor module.** 019 T35(b) has said *"OPEN — no accessor module exists"* since `1ed9ffb`, and it was still true four beads later. | `git ls-tree -d --name-only df01ef6 src/` → `src/catalog`, `src/consumers`, `src/contracts`, `src/db`, `src/events`, `src/http`, `src/providers`, `src/routes`, `src/services`. No `src/identity`, and no `src/modules`. |
| **E2** | **The one statement that turns an id into a name exists TWICE, in two files, and one copy has no caller.** | `git show df01ef6:src/services/auth/api.ts \| grep -n "SELECT id, display_name FROM app_user"` → `860`. `git show df01ef6:src/services/auth/people.ts \| grep -n "SELECT u.id, u.display_name FROM app_user"` → `51`. `git grep -n readPerson df01ef6 -- src scripts tests` → **two hits, both declarations** (`people.ts:50`, `index.ts:148`'s re-export). Nothing calls it. |
| **E3** | **Five statements in the whole tree read the person table**, and they are the complete population this bead had to move or argue about. | `git grep -nE "(FROM\|JOIN) app_user([^_a-z]\|$)" df01ef6 -- src scripts \| grep -v app_user_origin` → `scripts/enroll-authenticator.ts:81`, `src/services/auth/api.ts:860`, `src/services/auth/credentials.ts:141`, `src/services/auth/memberships.ts:296`, `src/services/auth/people.ts:51`. |
| **E4** | **`operator_id`, `created_by` and `confirmed_by` are never SELECTed anywhere** — so T35(b)'s first clause was satisfied **by accident**, not by construction. | `git grep -nE "SELECT[^;]*\b(operator_id\|created_by\|confirmed_by)\b" df01ef6 -- src scripts` → **no hits**. Every occurrence of the three names in SQL is an INSERT column list (`scanSession.ts`, `supersession.ts`, `condition.ts`, `pricingService.ts`, `outbox.ts`). |
| **E5** | **One statement projects an email**, and it is a CLI. | `scripts/enroll-authenticator.ts:81` — `SELECT id, email, display_name FROM app_user WHERE id = $1`. |
| **E6** | **One statement reads the person table and projects only an id** — the sign-in lookup. | `src/services/auth/credentials.ts:141` — `SELECT u.id FROM app_user u WHERE u.email = lower($1)`. |
| **E7** | **Three files read `auth_attempt`**, which is 048 R17's fourth name and the half of §12.4 row 6 nobody had written down. | `git grep -cn "FROM auth_attempt" df01ef6 -- src scripts` → `credentials.ts:1`, `invitations.ts:1`, `pin.ts:1`. `authenticator.ts` has none: `secondFactorWait` delegates to `personWait` (057 §4.5's shared budget). |
| **E9** *(v1.1.0, the security lens's F1)* | **A SIXTH statement resolves a person, and E3's grep could not see it** — because E3 enumerated reads of `app_user` while I1 claims *the only place that turns a key into a person*. `src/services/auth/recovery.ts` projects a named human's name and a note about how to reach them, out of a DIFFERENT table, with no caller outside its own tests. | `git grep -n "contact_name" df01ef6 -- src scripts` → THREE hits, all in `recovery.ts`: `:252` (the type), `:278` (the INSERT column list — a write, and legitimate), **`:296` (the SELECT)**. `git grep -n currentRecoveryNomination df01ef6 -- src scripts` → `recovery.ts:291` and `index.ts:87`'s re-export. **No caller.** |
| **E8** | **There is no access-audit table.** 034 §3.3 requires every accessor call to *"write an access-audit row before returning"*; nothing in `migrations/` creates one. | `git grep -l identity_access df01ef6` → nothing. |

**What E9 means, and it is why v1.0.0's I1 was false.** The rule shipped at v1.0.0 keyed on the person TABLE plus four column names, and a person's attributes are not the property of one table. The read is deleted (§4.2) rather than routed through an accessor, and `contact_name`, `contact_note` and `email` joined the column list so the next author who writes it gets a red build.

**What E4 means, and it is the sharpest fact here.** A reader could have closed T35(b) at `df01ef6` by writing a grep test that passes today and calling the threshold met. It would have been true and worthless: nothing prevented the next author from adding `SELECT s.operator_id`, and nothing recorded the reads that already resolve a person by a different column name. **A threshold satisfied by the absence of a line is a threshold with no instrument** — 019 §3.0's own phrase, and the reason this bead builds a boundary rather than an assertion.

---

## 2. The two-lens cannon — **DISPATCHED**

Convened by the session on 2026-09-06 against PR #97 head `e74a47f` — **the PRE-REBASE head, preserved in PR #97's force-push history and NOT an ancestor of `main`**. The branch was rebased onto `f957aa3` after the fold, so `git log main` will not find that commit; the lenses read the tree it named, and saying which tree they read matters more than pinning a SHA a reader can walk to. Both statements are reproduced **verbatim and unedited**; v1.0.0's builder drafts are superseded and §12 records how far they missed.

### `security-auditor` — **ACCEPT-WITH-CHANGES**

> The security lens accepts 060's central trade — the fact records the accessor and never the subject — and, having attacked it, reports that the database half holds under probe: the application appends and cannot read, cannot write an unscoped or cross-tenant fact, and cannot mutate one, and neither can the schema owner. What the lens does not accept is four of the record's own sentences and two gaps the record does not name. `src/services/auth/recovery.ts` projects a named human's name and contact note from `shop_recovery_nomination` with no fact written and a green `pnpm arch`, because §1 E3 enumerated reads of `app_user` while I1 claims the only place that turns a key into a person — so the invariant is false in the tree it governs, and the offending read has no caller, which is the exact shape this bead deleted `readPerson` for. The fifth privilege class has no runtime enforcement: `GRANT SELECT ON identity_access TO longbox_app` was accepted, both boot assertions passed, and the application read its own access log, because 058 F2's `forbidden_grants` check takes only the no-grant list — so §3.4's "enforced twice" is build-time twice. The accessor pair is a caller-supplied literal while `authorization_decision` observes the request, which inverts the comparison access.ts draws and means both audit findings can only catch an author who honestly declares. "The reads that resolve a third party's record do not exist yet" is untrue: the roster hands every operator's name at the shop to any device session, and the enrollment CLI reads another person's email. And "a shop id names a tenant, never a person" fails at the cardinality the pilot actually has — a per-day first-sign-in series, served by the index the record chose to keep, is a shift record at a three-person shop and a timeclock at a one-owner one, which is §5.2's own caveat never applied where it bites. Fix the first two, restate the other three honestly, and this lens signs.

### `rich-hickey-reviewer` — **ACCEPT-WITH-CHANGES**

> The identity accessor gets the hard part right — it records the access and refuses the subject, and it can state precisely, in one sentence, what a reader loses by that refusal, which is the mark of a decision that was actually made rather than merely defaulted into; my disagreements are with two mechanisms riding along with that decision — a `resolved_count` column whose legitimacy as a per-event value rather than a per-log aggregate is correct but unargued, and a fifth privilege class that buys append-without-read at the cost of a permanently growing taxonomy when a `SECURITY DEFINER` accessor function sitting on infrastructure this repo already trusts would have bought the identical guarantee without teaching every future table a new word — and I'd sign this record once those two are named for what they are, because naming a trade-off is cheap and discovering it three tables later is not.

**Where each finding landed.** Security F1 → §3.2/§4.2 and a deletion; F2 → §3.4 and `roleSeparation.ts`; F3 → §4.4; F3b → §4.2; F4 → §4.3, rewritten; F5 → §3.2 and §11 R7. Hickey 1 → §3.2 and `src/identity/access.ts`; Hickey 2 → §9 A8, argued and NOT taken; Hickey 4 → §3.5, taken. **Nothing is declined.** Two are adopted in a shape the lens did not ask for and §12 preserves the difference.

**The arithmetic, because the labels are not a range.** EIGHT findings are folded — security **F1, F2, F3, F3b, F4, F5** and data-model **1, 2, 4**, counting `F3`/`F3b` as one finding with two halves. **`F7` and `Hickey 5` elsewhere in this record are NOT a ninth and tenth**: they name a lens's numbered *sub-point* within a folded finding — F7 is the wording repair inside security F2's write-ordering objection (§9 A4), and Hickey 5 is the reframing inside data-model 1's (§11 R6). The gate audit's own numbering (F1–F11) is a separate sequence and is counted separately in §13.

## 3. Decision

### 3.1 The accessor is a DIRECTORY with one public barrel, not a file — and it is not a tenth module

> **`src/identity/` holds the accessor, `src/identity/index.ts` is its only public surface, and it may import nothing but `src/db.ts`, `src/db/` and `src/config.ts`.**

**It is not a new module.** 029 §3.1 places `identity` at L1 with `ALLOWED = ["platform"]`, and in the flat layout that module's code is `src/services/auth/` — `authorizationAudit.ts` says so in as many words: *"It lives inside the identity module, which is where 034 §3.3 puts every such read."* This directory is that module's **audited accessor**, a sub-boundary inside it, and it becomes `src/modules/identity/access/` when E02-B03 move 3 relocates the layout. An edge from `src/services/auth/api.ts` into it is identity→identity and creates no new layer edge.

**Two constructions were available and the file lost on one property.** `src/services/auth/identity.ts` — one file beside its twenty-two siblings — is the smaller change and it cannot carry a `.dependency-cruiser.cjs` rule: the public-surface rule and the leaf rule both key on a PATH, and a path that is one file inside a directory whose other files freely import `pg`, the contract layer and each other expresses neither boundary. `src/catalog/`'s precedent is exact (E04-D01) and its comment says why in a sentence that transfers unchanged: *"a rule over a FULL barrel is mandatory."*

**And the leaf is the property that matters more than the barrel.** `identity-reaches-only-platform` forbids the accessor from importing anything under `src/services/auth/`. That absence is deliberate and it is the strongest thing in §4: **the accessor is imported BY the rest of identity and imports none of it back**, so it cannot acquire a session, a permission or a membership concern, and `no-circular` cannot be tripped by migrating one more caller.

`src/config.ts` is on the allowed list because `buildCommit()` lives there and the fact carries the deploying commit for 054 §4.2's K2 reason. dependency-cruiser is a per-EDGE checker: what `config.ts` itself reaches is config's business, and this rule states what identity reaches. Duplicating the three-line env reader to keep the list at two entries would have been a second definition of the build stamp, which is the shape 058 §3(d) refuses one function over.

### 3.2 The fact records the ACCESSOR and never the SUBJECT

> **`identity_access` holds `purpose`, `accessor_method`, `accessor_path`, `key_kind`, `resolved_count`, `shop_id`, `build_commit` and `created_at`. It holds no `app_user_id`, no `email`, no `display_name` and no subject of any kind. There is no column to put one in.**

This is the whole design and §5 argues it at length. In one sentence here: **a table keyed on the person looked up is a per-person timeline of every time their name was rendered — a per-operator surface built by the control that exists to prevent per-operator surfaces**, and it would be the only such table in the schema that grows on the hot path, because every operator session opened at a counter renders a display name.

`key_kind` is a closed enum of **seven** members — 034 §3.3's three COLUMN names (`operator_id`, `created_by`, `confirmed_by`, the last two put inside the contract by A5), **054 §8's two** (`authorization_decision`'s `membership_id` and `session_chain_id`), plus `app_user_id` (the ordinary key) and `shop_roster` (the bulk shape: a read keyed on a SHOP that produces people). Naming them all is what stops the accessor being built around whichever subset an author happens to need first. ⚠ **`created_by` and `confirmed_by` have NO CALLER and are here anyway** (the gate audit's F7): at v1.1.0's predecessor the enum held neither, so the FIRST reader of a pre-G2 attribution string could not have written its fact at all — the CHECK would have refused it — and the author's cheapest fix would have been to skip the accessor. **A gate whose correct use is impossible is a gate somebody routes around.** That is not the objection that keeps `break_glass_reconciliation` out of the PURPOSE enum (§3.3): a purpose is a reason somebody may ask, which is a surface's first half; a key kind is the shape of a column that already exists and is already named by a ratified contract.

`accessor_method` / `accessor_path` are `authorization_decision`'s pair in intent and in idiom: the route TEMPLATE for an HTTP request, the literal `CLI` plus the script path for an operator command, **never a URL** — a URL carries ids, and an id is a join back to the work (054 §4.2).

`shop_id` is **nullable and the null has exactly one meaning**, tied by `CHECK (shop_id IS NOT NULL OR accessor_method = 'CLI')` — `028`'s idiom for `session_chain_id`. A second factor belongs to a PERSON, who may hold memberships at more than one shop (034 §2.6), so the enrollment CLI has no tenant to name. **And the null is unwritable by the application**, because the table carries `shop_id` and is therefore policied `tenant_isolation` with no declaration and no service scope: a NULL can never satisfy `shop_id = current_shop_id()`. So every fact the running server writes names the tenant it happened in, by construction.

**The rule `resolved_count` obeys, written down (Hickey 1).** The lens accepted the column and refused that it was unargued — a number on an audit row is the shape that quietly becomes a metric.

> **A fact may carry the CARDINALITY OF ITS OWN RESULT. It may never carry a duration, a rate, or anything computed across rows.**

`resolved_count` is the first: a property of the single read the row records, known at write time, and the thing that makes a BULK access visible without naming anybody in it — one roster read of eleven people is one row saying eleven, not eleven rows and not an average. A duration would be a timing about somebody's work; a rate or a running total would be an aggregate the writer computed by reading other rows, which is a read model in a write path and a per-operator metric one join from existing. The rule lives in `src/identity/access.ts` as well as here, because the next column somebody wants is decided at that file.

**`created_at` IS TRUNCATED TO THE HOUR, and §5.2's caveat is why (security F5; the gate audit's F8 had TWO parts and this is the first — the second is §10's decoy flood).** §5.2 says that *"no subject is stored"* is a claim about the SCHEMA and never *"nobody can be identified"* — and the lens applied it where it bites, which v1.0.0 never did: **a per-day FIRST-SIGN-IN series over `(shop_id, purpose, created_at)` is a shift record at a three-person shop and a timeclock at a one-owner shop**, assembled from a table that holds no person, and served by the index this record chose to keep.

Truncation is the cheap half of the answer and it costs the instrument nothing: the audit's window is a `>=` over whole hours (its start is truncated too, so the window is strictly WIDER and never narrower), and every bucket it prints is a COUNT grouped by purpose and accessor. What it removes is the minute-level ordering a timeclock needs — and, as a consequence worth stating, **rows written in the same hour have no order at all**, which is why the integration suite matches on values rather than reading the newest row by position.

**It NARROWS the class and does not remove it, and no artifact may say otherwise:** an hourly series at a one-owner shop still says which hours that owner worked. The expensive halves are retention (E03-B09) and the 022 P3 notice describing THIS table (E01-B06); §11 R7 carries both with their owners.

**One index, on the tenant, and not one more.** 054 §4.2 removed `authorization_decision_chain_idx` because an index is a standing affordance and a fast per-session query is the covert timeclock 022 P3 forbids. That reasoning bites on a PERSON-adjacent column and not on this one: **a shop id names a tenant, never a person**, so the tenant index makes no per-person question cheap, and it keeps this table inside the blanket property `tests/integration/rls-tenant-isolation.test.ts` asserts of EVERY policied table. *(v1.0.0 drafted this paragraph as "no index beyond the primary key" and the integration lane refused it — correctly. A uniform invariant with one table exempted is an invariant somebody has to remember, and the exemption would have bought nothing: the column it refuses an index on is the one column here that is not about a person.)* What IS refused is every other index — none on `purpose`, none on the accessor pair, none on `created_at` — because the only reader is a scheduled schema-owner audit that GROUPs the whole table.

### 3.3 Two closed lists that close differently, and the asymmetry is the point

`IDENTITY_PURPOSES` is closed **twice** — by the TypeScript union and by `migrations/035`'s CHECK. A fifth purpose is a migration and a decision, on `032`'s argument for `origin`: *"the vocabulary of who a person is to Longbox should not be extensible by whoever writes the next INSERT."*

`DECLARED_ACCESSORS` is closed by **code alone** and cannot be a constraint: an accessor is a route template or a script path, and the set grows every time somebody adds a screen.

**That asymmetry is exactly what makes the audit worth running.** A CHECK on the accessor would have made the audit's central finding impossible to have — by making the row impossible to write. That sounds stronger and is weaker: the write would fail inside a request nobody was auditing, and the author would delete the audit call to make their route work. The purpose is constrained because its vocabulary is small and stable; the accessor is reconciled because its inventory is not.

**Four purposes are declared, each with a live caller.** `break_glass_reconciliation` is deliberately ABSENT. 022 P3's CFO constraint — *"never build a per-operator surface and then restrict it"* — reads on a vocabulary too, and E11-B09 is the bead that gives break-glass its read path; it adds the purpose in the migration that adds the reader.

### 3.4 The application may INSERT the fact and may never SELECT it

> **`appGrant: "insert-only"` — a FIFTH privilege class in `src/db/appRoleGrants.ts`, declared as a row.**

The mirror of `appGrant: "none"` rather than a softening of it, and the two answer different questions. `"none"` withholds the INSERT because *"a table that records who is being watched must not be writable by the process being watched"* (058 §3(c)). `"insert-only"` withholds the SELECT for the symmetric reason: **a process that can read its own access log can shape what an audit sees before the audit runs**, and nothing in the running system has a question to ask this table. Reading it is `pnpm audit:identity-access`'s job, as the schema owner.

The consequence is a property worth stating: **no code under `src/` reads `identity_access` at all**, and it is enforced twice — by a contract test, which makes a reader fail at BUILD, and by the grant, which makes one fail at RUNTIME.

⚠ **AT v1.0.0 THAT SENTENCE WAS FALSE AND THE LENS PROVED IT (security F2 = gate F2).** `GRANT SELECT ON identity_access TO longbox_app` was accepted, **both** boot assertions passed, and the application read its own access log — because 058 F2's forbidden-grant check took the **no-grant** list alone. *"Enforced twice"* meant *build-time twice*, and a grant plan is re-applied on every `pnpm migrate` while a hand-run `GRANT` between two runs is exactly the drift 058 F2 added that check for.

The insert-only class now joins that check: `assertTenantIsolationOrThrow` refuses to bind a port when the application role holds `SELECT`, `UPDATE` or `DELETE` on a table declared `insert-only`. **`INSERT` is deliberately absent from the three asked**, because it is the privilege the class exists to hold — asking about it would fail the boot on a correct grant. The negative fixture grants the SELECT, proves the boot fails, proves the application really could read the log while it stood, and proves the check goes clean again when the grant is revoked.

### 3.5 Three accessors, and the two that were one

⚠ **THIS SECTION ARGUED THE OPPOSITE AT v1.0.0 AND THE DATA-MODEL LENS WAS RIGHT TO REFUSE IT (Hickey 4).** `resolvePersonForSession` and `resolvePersonForInvitation` issued the IDENTICAL statement and differed only in the `purpose` their caller cited. The argument for keeping them apart was that one function taking a purpose lets a caller cite the wrong one by copying a line — and it did not survive contact with the rest of this record:

- `isDeclaredAccess` already polices the `(method, path, purpose)` triple, and since security F3 that triple is **checked before any read**, with the pair OBSERVED from the request. A miscited purpose is now a refused request, not a plausible row.
- The split cost a **second copy of the one statement this module exists to have exactly one of** — which is the defect §1 E2 reproduces and this bead was built to remove, reintroduced by the removal.

So there is one `resolvePersonByKey`, and three accessors in total: it, `resolveShopRoster` (the bulk shape), and `resolvePersonForAuthenticatorEnrollment` (the only one that projects an email, and the only one with no tenant). Each returns `undefined` rather than throwing, because the HTTP consequence of *"no such person"* differs by caller and a data module that picked one would be choosing somebody else's refusal code — 048 §9.3's constant-answer rule is the caller's to keep.

## 4. The boundary, in three places that fail differently

### 4.1 The import graph — `.dependency-cruiser.cjs`

- **`identity-public-surface-only`** — no file outside `src/identity/` may import past `src/identity/index.ts`. Reaching into `accessors.ts` would take the person query WITHOUT the audit fact, which is the whole control, and no layer rule would notice.
- **`identity-reaches-only-platform`** — the accessor imports the database handle and the process configuration and nothing else. §3.1 argues the absence that matters.

**And a THIRD edit to that file, which belongs in the record and not only in a PR body (gate F10).** `no-orphans`' exemption list gains one entry — `src/identity/index.ts` — on `src/catalog/index.ts`'s documented precedent and for the same reason: a module's public surface is entered from OUTSIDE the graph this config walks (`pnpm depcruise` cruises `src`, and `scripts/enroll-authenticator.ts` is one of its importers), so the barrel is unreachable **by construction** rather than dead. **Its siblings are not exempt**, which is what makes the exception safe: a file the barrel stops re-exporting becomes an orphan and fails the gate. A gate-config exemption is a hole somebody widened, and a record that lists two rules while quietly widening a third is doing the thing this bead exists to stop.

The whole `.dependency-cruiser.cjs` diff is **64 insertions and zero deletions**: two new rules, both `severity: "error"`, plus that one exemption entry. Nothing is removed and no severity is lowered. `.harness-hash` is re-pinned with `audit-harness init`, never hand-edited (PR #69's precedent).

Both new rules have negative fixtures in `tests/contract/architecture-gate.test.ts`, written into a scratch COPY of `src/` that symlinks the repository's real config — so the fixtures prove the SHIPPED gate can fail, which is 029 §5 move 8's standard and the reason defect N3 was ever found.

### 4.2 The text — `pnpm arch`

**No import graph can see a copied statement.** That is not a hypothetical: E2 reproduces the same eleven-word statement in two files, neither audited, neither visible to any rule. So the boundary is asserted over SQL text as well, in three rules over `src/` **and** `scripts/`:

- **`identity-is-the-only-person-join`** — outside the accessor, no SQL literal may project `display_name`, `operator_id`, `created_by`, `confirmed_by`, **`contact_name`, `contact_note` or `email`**, and none may `FROM`/`JOIN` the person table at all. ⚠ **The last three are the security lens's F1, and they are the reason a column list beats a table list.** v1.0.0's rule keyed on the person TABLE plus four column names, and `src/services/auth/recovery.ts` projected a named human's name and a note about how to reach them out of `shop_recovery_nomination` — a DIFFERENT table — with no audit fact, no caller and a green gate. **I1 was false in the tree it governs**, and §1 E3's grep is why nobody saw it: it enumerated reads of `app_user`. **A person's attributes are not the property of one table.** The projection walker reads every `SELECT … FROM` list and every `RETURNING` tail, and **not** `WHERE` clauses or INSERT column lists — which is what makes `INSERT INTO app_user (email, display_name)` legal (a write carries a name IN that the caller already holds) while `RETURNING id, display_name` is not (a write that hands one back is a read).
- **`identity-access-has-one-writer`** — rule 3b's shape, one table over. A second writer is a second definition of what counts as resolving a person, and the audit would be reconciling one of two vocabularies against one inventory.
- **`auth-attempt-is-substrate-not-surface`** — 048 R17 and I7's fourth name, which §12.4 row 6 hands to this scope and which nobody had written down. Every `FROM auth_attempt` in either tree is a declared lockout derivation; the inventory holds three rows for **three** factors, because `secondFactorWait` delegates to `personWait` rather than spelling its own (057 §4.5).

- **`identity-public-surface-only`, as a TEXT rule over `scripts/`** (security F3b). `pnpm depcruise` cruises `src` and only `src`, so the import-graph rule stopped at a directory edge while `scripts/` imports the module — a CLI could have reached `accessors.ts` directly and taken the person query WITHOUT the audit fact, which is the whole control. Adding `scripts/` to the cruise was the other option and was not taken: the cruise's module census is asserted byte-for-byte by the scratch-tree fixture, and widening the cruised set changes that census for every rule at once to close one hole.

**Scope is both trees**, which is 058 F6's lesson applied with more force: one of the five migrated callers IS a CLI, so a rule handed `src/` alone would have been blind to the only accessor that reads an email.

**The exemption list is ONE row** — `credentials.ts`'s sign-in lookup — and §5.3 argues it. Every rule is an EQUALITY, not a ceiling: a declared file that stops holding its statement fails too, because a stale exemption is a hole nobody is looking at.

### 4.3 What 034 §3.3 asks for that this bead does NOT build, said plainly

034 §3.3's contract has two clauses this record does not satisfy. They are named here rather than quietly dropped — and the FIRST one's reason was **wrong at v1.0.0 and is replaced** (the security lens's F4).

**"Every call to it requires the `support_break_glass` role."** v1.0.0 said *"the reads that resolve a third party's record do not exist yet"*. That is **false**, and the lens reproduced it in one sentence: **the roster hands every operator's display name at the shop to any live device session, and `pnpm enroll-authenticator` reads another person's email**. Two of the three accessors resolve third parties. The record was describing a system it did not have.

**What actually bounds them is not a role**, and stating it correctly is stronger than the sentence it replaces:

- the **roster** is bounded by a live DEVICE session at that shop (048 R8 — *"who works here"* is a per-shop datum a passer-by on the same Wi-Fi has no claim on), by a **two-column projection**, and by an **activity-independent sort**. It is a list of who could be holding the phone and it cannot become a list of what they did; that is 048 §3.5's own line and it is enforced by the SQL, not by a role;
- the **enrollment CLI** is bounded by schema-owner database access plus a shell on the host — which is a real bound and a coarse one, and 057 §9 R9 already records what that substitutes for elsewhere.

**`support_break_glass` is not among those bounds and cannot become one.** It holds NOTHING (054 §3, 022 P7's *"no invisible super-admin"* as an empty list), so requiring it would make the counter flow **unreachable rather than gated**. The role belongs to a surface that renders a NAMED person's RECORD to somebody who is not them — which is E11-B09's read path, and 054 §8 already says it reaches per-operator data *through* this accessor and not around it. This bead builds the door E11-B09 must come through and does not fit a lock that would jam the only traffic there is.

**"Covered by the T34 heartbeat."** A heartbeat needs a scheduler, and every detector's is **E13-B04-D1 (`longbox-e5b.13.4.1`)**. This ships the query and its exit code; a detector nobody runs reports nothing.

**So 019 T35(b) moves from OPEN-with-no-owner to INSTRUMENTED, and the 019 amendment row says exactly that and no more.**

### 4.4 What the OBSERVED accessor pair fixes, and what it does not (security F3)

At v1.0.0 both halves of the accessor pair were **a string the caller typed**. That inverts the comparison this module's own file drew against `authorization_decision`, which takes `req.method` and `req.routeOptions.url` from the request the hook already matched: a route could have recorded any pair at all, and **both of the audit's findings could only ever have caught an author who declared honestly**.

The pair is now OBSERVED — `req.method` plus the template Fastify matched, handed to `httpAccessor` by the route layer — and the **triple is checked there**, before any read. A surface citing a pair or a purpose it was not declared for **fails the request** rather than writing a plausible row for somebody to find later, which is the fail-closed direction the auth hook already takes for an undeclared tenant route. A build-time half sits beside it: a contract test asserts every declared HTTP accessor names a route this application actually registers, so a renamed route is a red build rather than a 500 on a counter phone.

⚠ **WHAT REMAINS, STATED RATHER THAN IMPLIED.** The METHOD and the PATH are observed; **the PURPOSE is still a literal, and it cannot be observed** — a route may legitimately cite more than one, and nothing in a request says which read is about to happen. An author who declares `session_display_name` for a surface and then writes a roster read citing it produces a row that is internally consistent and wrong. What the observation buys is that the pair cannot be INVENTED, which is the half the lens reproduced; the remainder is a code-review property and is recorded as one.

## 5. Why the fact holds no subject — the argument in full

The obvious design records who was looked up. It is what an investigator wants and it is refused. Three grounds, in increasing order of weight.

**(a) It is the surface the control exists to prevent.** 022 P3: *"No individual-level telemetry view — for the employee, the owner or Longbox — exists…"* A table keyed on the person looked up is a per-person timeline. That it is a timeline of READS about them rather than of WORK by them is not a distinction 022 P3 draws, and drawing it here would be this record deciding a principle in its own favour.

**(b) It would grow on the hot path, keyed by the person it is about.** Every operator session opened at a counter renders a display name. A subject-keyed table means the phone writes a row about its holder on every sign-in, and the join that reconstructs a shift becomes free — the exact affordance 054 §4.2 removed an index to keep expensive.

**(c) The question it would answer is not the question T35(b) asks.** T35(b) asks that person-resolution be *"selectable only inside one audited accessor module"*. That is a question about the CODE and the ACCESSOR, and this table answers it: how often, from where, and for what stated reason did this system turn a key into a person. *"Who read this employee's name"* is a different and legitimate question, and it has a named home with a named obligation attached: the break-glass read path, whose 7-day notice to the employee (022 P3, GC) is what makes asking it lawful in the sense this project cares about. **Answering it from an unnotified table would be building the surface and skipping the notice.**

### 5.1 What a reader loses, stated as a loss

This table cannot answer *"who read this person's record, and when"*. If that question is ever asked in an incident, the answer from here is a count and an accessor, and the rest must come from the break-glass path's own records. **That is a real reduction in forensic power and it is the price of (a).** It is recorded in §7 as a residual rather than presented as a feature.

### 5.2 It is stronger than "names no person" and weaker than "is not about people"

`breakGlassAudit.ts` withholds an identifier its rows DO carry, and its own comment concedes that at pilot scale a count of one identifies somebody to anybody who knows the roster. Here the column does not exist, so no reader and no future export can reach for it. **But the same caveat applies one level up**: a shop with two staff and one access of `operator_picker_roster` is not anonymous to somebody who was standing there. The claim this record makes is *"no subject is stored"*, and no artifact may upgrade it to *"nobody can be identified"*.

### 5.3 The one exemption, and why it is a control rather than a convenience

`src/services/auth/credentials.ts:141` — `SELECT u.id FROM app_user u WHERE u.email = lower($1)` — stays where it is. It projects `u.id` alone and resolves a value the CALLER supplied, so it discloses nothing about a person the caller did not already name; the rule flags it only because it reads the person TABLE, which is the stronger boundary §4.2 draws on purpose.

**Routing it through the accessor would be a defect.** It is the FIRST statement of an unauthenticated sign-in, so an accessor call there lets anybody with a socket append to `identity_access` without holding a session — **an audit table a stranger can grow**, which is the failure 054 §10 records for `authorization_decision` and fixed by taking a rate token first. A failed sign-in is already recorded, as an `auth_attempt` failure under 048 §9.1's derivation.

---

## 6. The audit — `pnpm audit:identity-access`

Schema owner only (`assertSchemaOwnerOrThrow`), per-purpose and per-accessor COUNTS, non-zero exit on a finding, a **PROVISIONAL** 24-hour default window that no artifact may quote as a detection guarantee.

**Two findings and one drift check**, defined in `scripts/identityAccessAudit.ts`'s header and reproduced here:

1. **An undeclared accessor** — a `(method, path)` pair in no `DECLARED_ACCESSORS` row. Somebody added a surface that resolves people and did not declare it, so it was not reviewed as one.
2. **An undeclared purpose for a declared accessor** — the copy-paste failure: a new read reusing the nearest existing `purpose` string because it type-checks.
3. **Purpose drift** — the database's own CHECK, read back with `pg_get_constraintdef`, compared with `IDENTITY_PURPOSES`. Either direction means the closed vocabulary has two definitions, and T35(b) would be enforced by whichever one the reader happened to read.

**What the exit code is, and what it is not.** 019 §3.4's K1 list is CLOSED and 043 §5.4 is explicit that a record has no standing to open it; **this record opens nothing.** T35's rule is *"any rendering → K1"*, and a finding here is evidence that a person-resolution reached an unreviewed surface — which is where a rendering comes from and is not itself proof that one happened. So the exit code is a **T35(b) gate failure**, reported in those words, and whether a given finding is a K1 is decided by reading the named accessor against T35(a). Saying more would be inventing a rule; saying less would make the exit code advisory.

---

## 7. Invariants

| # | Invariant | Test |
|---|---|---|
| **I1** | **`src/identity/` is the only place in either tree that turns a key into a person.** No SQL literal outside it projects `display_name`, `operator_id`, `created_by` or `confirmed_by`, and none reads `app_user` beyond the one declared exemption. | `pnpm arch` rule `identity-is-the-only-person-join`; `tests/contract/architecture-gate.test.ts` (six negative fixtures, incl. the write/read asymmetry and the `app_user_origin` lookahead) |
| **I2** | **The accessor's internals are unreachable from outside the barrel, and the accessor reaches nothing but platform.** | `.dependency-cruiser.cjs` `identity-public-surface-only` + `identity-reaches-only-platform`; two scratch-tree negative fixtures |
| **I3** | **Every accessor call leaves exactly one fact — including one that resolved nobody.** | `tests/integration/identity-access.test.ts` (a), (b); `tests/identity-accessor.test.ts` |
| **I4** | **The fact carries no subject, and there is no column for one.** | `tests/integration/identity-access.test.ts` (f) — an `information_schema.columns` assertion by NAME over five forbidden names |
| **I5** | **`identity_access` refuses UPDATE and DELETE from the SCHEMA OWNER** — the one principal that could have done it, since the trigger is `ENABLE ALWAYS`. | `tests/integration/identity-access.test.ts` (c) |
| **I6** | **The application role holds INSERT and no SELECT**, asserted both by a refused read and by reading the privilege out of `information_schema.role_table_grants` — so the refusal cannot pass for the wrong reason. | `tests/integration/identity-access.test.ts` (d); `tests/app-role-grants.test.ts` |
| **I7** | **The application cannot write an UNSCOPED fact**, and an unscoped row that does not claim to be a CLI is refused by the CHECK. | `tests/integration/identity-access.test.ts` (e) |
| **I8** | **`identity_access` has exactly one writer**, and no writer is a violation too. | `pnpm arch` rule `identity-access-has-one-writer`; two negative fixtures |
| **I9** | **Every `FROM auth_attempt` in either tree is a declared lockout derivation** (048 R17, I7's fourth name). | `pnpm arch` rule `auth-attempt-is-substrate-not-surface`; one negative fixture |
| **I10** | **The database's purpose CHECK and the code's closed union agree**, and a purpose outside it is refused even from the schema owner. | `tests/integration/identity-access.test.ts` (g) ×2 |
| **I11** | **The audit finds an undeclared accessor** and reports it as a T35(b) gate failure. | `tests/integration/identity-access.test.ts` (g) |
| **I12** | **Nothing under `src/` reads `identity_access`.** | `tests/contract/architecture-gate.test.ts` |
| **I13** *(v1.1.0, security F2)* | **The boot assertion REFUSES a `SELECT`, `UPDATE` or `DELETE` granted to the application on an insert-only table — and does NOT refuse the `INSERT` the class exists to hold.** | `tests/integration/rls-tenant-isolation.test.ts` — the grant is made, the boot fails, the application is shown really reading the log while it stood, and the check goes clean on revoke; plus the mirror case asserting `INSERT` alone is not a finding |
| **I14** *(v1.1.0, security F1)* | **A person's attributes are gated by NAME wherever they live** — a `contact_name` projection from `shop_recovery_nomination` is a violation — **and the read that prompted it is GONE from the tree, not merely forbidden.** | `tests/contract/architecture-gate.test.ts` — one fixture for the projection, one asserting no file in either tree declares `currentRecoveryNomination` once comments are stripped |
| **I15** *(v1.1.0, security F3)* | **An undeclared accessor pair or purpose REFUSES the request**, the method is normalised, an unrouted template refuses, and **every declared HTTP accessor names a route this application registers.** | `tests/identity-accessor.test.ts` (four refusal cases + the route-table check) |
| **I16** *(v1.1.0, security F3b)* | **No file in either tree imports past `src/identity/index.js`** — the half `pnpm depcruise` cannot see, because it cruises `src` alone. | `pnpm arch` rule `identity-public-surface-only`; two fixtures (a deep import from a CLI fails, the barrel import passes) |
| **I17** *(v1.1.0, security F5)* | **`created_at` is on an hour boundary for every row**, so a within-hour ordering does not exist — and the audit still works over it, because its window start is truncated too. | `tests/integration/identity-access.test.ts` |
| **I18** *(v1.1.0, gate F7)* | **The key-kind enum names every path 034 §3.3 and 054 §8 do**, including `created_by` and `confirmed_by`, which have no caller — without them the first reader of a pre-G2 attribution string could not write its fact at all. | `tests/identity-accessor.test.ts`; `migrations/035`'s CHECK |

---

## 8. Amend-by-a-row obligations discharged in this PR

| Obligation | Where it was written | What this discharges |
|---|---|---|
| **019 T35(b)'s accessor clause** | 019 §3.3 T35 row, `(b) gate-tests`, *"OPEN — no accessor module exists at `1ed9ffb`"* | The module exists, is the only person-join in the tree, audits every call, and has a reconciliation. **Status moves to instrumented, not closed** — the clause's break-glass and heartbeat halves are §4.3's. A 019 amendment row (v1.6.0, instrument-only) records it; **no threshold value moves, T35 stays 0 and non-waivable.** |
| **034 §3.3** | *"The contract this record fixes, for E03-B03 to implement"* | Discharged as to the module, the audited accessor, the access-audit row and the no-other-projection rule. §4.3 names the two clauses it does not discharge and whose beads they are. A 034 change-log row records it. |
| **048 §12.4 row 6, fourth part** | *"…and the `identity` accessor module — which now gates four column names plus `auth_attempt`"* | Discharged, and the rule is WIDER than row 6's own four names: `display_name`, `operator_id`, `created_by`, `confirmed_by`, `contact_name`, `contact_note` and `email` — **the seven `PERSON_PROJECTION_COLUMNS`, from ANY table and not only from `app_user`** are behind it, because a person's attributes are not the property of one table (§4.2, the security lens's F1). `auth_attempt` is I9's inventory. Row 6's other three parts (the permission matrix, the T24 runtime assertion, the G2 defect-count assertion) are E03-B03's and E03-B04's and are untouched. |
| **058 §3(c)'s `appGrant` statement** | 058 §3(c): *"Both are declared `appGrant: \"none\"` … so the grant step's opening `REVOKE ALL` leaves `longbox_app` with no privilege at all on them"* | **A PATCH row on 058, not an amendment.** `appGrant` now has a THIRD value — `insert-only` — so a reader of 058 §3(c) meets a field with a wider domain than that section describes. **058's own statements are untouched and no decision in it moves**: `app_user_origin` and its retirement are still `"none"`, still for the reason given, and the new value is the MIRROR of theirs rather than a softening (they withhold the INSERT because an appended row changes what a control sees; this withholds the SELECT because a process that reads its own access log can shape what an audit sees). 058 §3(c)'s boot-assertion half is EXTENDED rather than replaced: the same `forbidden_grants` check now takes both lists. **056 takes no row** — it names `appGrant` once in passing and describes no privilege class. |
| **054 §8's `authorization_decision` clause (S5′)** | *"`membership_id` and `session_chain_id` join to a person exactly as `operator_id` does… they belong behind the same audited reader"* | Discharged as to the VOCABULARY: both are `key_kind` members from day one, so the reader that resolves either records itself. There is no such reader yet — E11-B09's is the first — and §4.3 says so. |

---

## 9. Alternatives considered

**A1 — One file, `src/services/auth/identity.ts`.** Rejected on §3.1: neither dependency rule can key on it, and the leaf property is unstatable.

**A2 — Key the fact on the person looked up.** Rejected on §5, and it is the alternative a security lens will most nearly win.

**A3 — Constrain the accessor list with a CHECK too.** Rejected on §3.3: it makes the audit's central finding unhavable by making the row unwritable, and it moves the failure into a request nobody is auditing.

**A4 — Put the accessor's INSERT outside the caller's handle, on the pool, as `authorization_decision` does.** Rejected. 054 §4.5's two reasons do not transfer: a person-resolution only happens on a path that got far enough to read, and **the fact is lost for a read whose effect was undone** — which is over-recording in reverse and is the direction this table can afford. *(v1.0.0 wrote "a read that rolls back disclosed nothing", and the security lens's F7 is right that this is not the same statement: the read HAPPENED, and the value existed in the process. What rolling back undoes is the effect, not the disclosure. The trade is still the one taken; the sentence describing it was too kind to itself.)* Travelling on the caller's handle gives the invitation redemption a genuinely atomic fact for free, and costs the others nothing they were not already paying.

**A5 — Route the sign-in's email lookup through the accessor "for completeness".** Rejected on §5.3: it hands an unauthenticated stranger an append to the audit table.

**A6 — Declare `break_glass_reconciliation` now so E11-B09 needs no migration.** Rejected on 022 P3's CFO constraint: a vocabulary is a surface's first half, and E11-B09 adding the purpose in the migration that adds the reader is one PR a reviewer can read whole.

**A7 — Gate the accessors on `support_break_glass` as 034 §3.3 says.** Rejected on §4.3, and **the reason v1.0.0 gave was wrong**: two of the three accessors DO resolve third parties. The correct reason is that the role holds nothing, so the gate would make the counter flow unreachable rather than gated, and that what bounds a roster is a device session, a two-column projection and an activity-independent sort.

**A8 — A `SECURITY DEFINER` accessor FUNCTION instead of a fifth privilege class (Hickey 2, argued and NOT taken).** The lens is right that this buys the identical guarantee — a function owned by the schema owner, granted `EXECUTE` to the application, appending the fact and returning the person, with the application holding no privilege on the table at all — and right that a permanently growing privilege taxonomy is a real cost that is cheap to name now and expensive to discover three tables later. It is not taken, on three grounds, and the third is the one that decided it:

1. **It does not remove the re-granting problem, it moves it.** `src/db/appRoleGrants.ts` exists because *"a GRANT is not permanent the way a trigger is"* — `CREATE TABLE` grants nothing, so the plan is re-derived and re-applied after every migration. A function's `EXECUTE` has exactly that property: `CREATE OR REPLACE FUNCTION` resets it, so the plan would need a function-grant class beside its table-grant classes. The taxonomy grows either way; only the noun changes.
2. **It moves the boundary out of TypeScript and into SQL, where this repository's other boundaries are not.** The accessor's argument checking (`httpAccessor`'s refusal of an undeclared triple) would be split across a language boundary or duplicated, and 056 §13 already had to defend putting *one* closed union in a policy predicate.
3. **A privilege class is VISIBLE IN ONE DECLARATION and a function's is not.** `appGrant: "insert-only"` sits on the table's own row in `src/db/appendOnlyTables.ts`, is read by the grant plan, the boot assertion and two test suites from that single source, and a reviewer sees the whole privilege story of a table on one line. A `SECURITY DEFINER` function distributes the same fact across a migration, a grant plan and the function body — and, as security F2 demonstrated on the simpler design, the failure mode here is *"the enforcement everybody assumed was there"*.

**The cost the lens named is real and is not waved away**: the class must not grow casually. `appendOnlyTables.ts` carries the rule for `"none"` — *"keep this set as small as that argument reaches; 'the app does not use it' is a reason to review the grant, not by itself a reason to remove it"* — and `insert-only` inherits it verbatim. §12 preserves the lens's position.

---

## 10. Consequences

**What gets better.**
- **019 T35(b) has an owner and an instrument** where four beads ago it had neither, and E11-B09 now has a door to come through rather than a boundary to invent.
- **The duplicate person query is gone** — E2's two copies are one accessor, and the dead `readPerson` export went with it.
- **T35(b)'s first clause stops being satisfied by accident** (E4): `operator_id`, `created_by` and `confirmed_by` are now unprojectable outside the module by rule rather than by nobody having written the line yet.
- **048 R17's fourth name became a test.** *"Every query over `auth_attempt` is either the lockout derivation or an audited break-glass query"* was an assertion in a document; it is now an inventory with counts.
- **`upsertPerson` stopped returning a name**, which is a write that was quietly a read.

**What gets worse, stated plainly.**
- **Four reads on the authentication path now cost one extra INSERT each.** It is one statement on an unindexed table and it is on the hot path of every operator sign-in. **No number is quoted because none has been measured** (018).
- **The table grows without a sweep.** Retention is E03-B09's, and until that lands it only grows. It is bounded by the requests that reach a live session — which is what 054 §10 records as *"bounded by nothing an attacker holding a live session had to respect"* one table over. **This table has no rate-token guard of its own**, because its writes happen inside routes the auth hook has already rate-limited on the shop's `ordinary` class; that is a weaker bound than 054's explicit one and it is stated here rather than assumed.
- **On a `tenantDb` handle the read and the fact are two transactions.** `scopedDb` runs each statement in its own small transaction, so a process that dies between them loses the fact for a value that never left the process. The atomic fix is one transaction, which is 054 A5's refused shape for the audit table beside it; the invitation redemption already gets atomicity for free because it has a transaction to offer.
- **The text rule reads template literals only.** A statement assembled by concatenation or built by a query builder is invisible to it. There is no such construction in this repository today — which is what makes the rule worth having and also what bounds it.
- **The forensic question "who read this person's record" is not answerable from here** (§5.1), by design and at a cost.
- **A decoy flood is available and bounded only by a rate token.** One statement can append five hundred `identity_access` rows citing a declared accessor, and the audit exits 0 on them — it reconciles the VOCABULARY, not the volume, and it has no baseline to compare against (**the gate audit's F8, second part** — the first is §3.2's timing series; F8 named two mechanisms and this record answers both, which is why it appears twice). What bounds it is the auth hook's per-shop `ordinary` rate class on the routes that write these facts, which is a **weaker bound than 054's explicit pre-audit rate token** and is stated as such. A caller who can already open sessions can make the table noisy; they cannot make it say something false about an accessor, because the accessor pair is observed.
- **A TENTH top-level entry under `src/`** in a layout that 029 §5 move 3 intends to relocate wholesale. It is the second one to land ahead of that move (`src/catalog/` was the first) and it moves with it.

---

## 11. Residual risk

| # | Residual | Owner |
|---|---|---|
| **R1** | **The accessor is not gated on `support_break_glass`**, so 034 §3.3's contract is partially discharged and 019 T35(b) is *instrumented*, not *closed*. The read that needs the gate — a surface rendering a NAMED person's RECORD to somebody who is not them — does not exist yet. The two reads that DO resolve third parties (the roster, the enrollment CLI) are bounded by a device session, a two-column projection and an activity-independent sort, never by a role. | **E11-B09 `longbox-e5b.11.9`** |
| **R2** | **No scheduler and no T34 heartbeat** for `pnpm audit:identity-access`. A detector nobody runs reports nothing. | **E13-B04-D1 `longbox-e5b.13.4.1`** |
| **R3** | **No retention window on `identity_access`.** The table only grows, and the pre-volume rule 054 §4.5 hands E03-B09 for `authorization_decision` — *no window, sweep or rollup may assume one row per act* — applies here too: one row is one ACCESS, and a route that resolved a person twice in one request is two. | **E03-B09 `longbox-e5b.3.9`** |
| **R4** | **This bead creates a new store of records about people at work**, and 022 P3's versioned monitoring notice must name it — in the notice's own terms, not this record's — before a live shop. Same obligation 054 §8 filed for `authorization_decision`. | **E01-B06** (021 registers it as C10; T26 pre-send governs) |
| **R5** | **`app_user` still carries no tenant policy** (056 §11 R9). The module graph, this accessor and every read being by the authenticated person's own id or by a digest are what bound it. Unchanged by this bead, and narrowed by it: there is now one door instead of five statements. | **E03-D21 `longbox-e5b.3.31`** |
| **R6** | **The read and the fact are not atomic on a `tenantDb` handle** (§10), so a process that dies between them loses the fact for a read that DID happen. **Reframed at v1.1.0 (Hickey 5, security F7):** the honest statement is not *"a disclosure that did not happen"* — it is that **audit completeness cannot be proven here, only asserted.** Nothing in this design lets a reader distinguish *"no access happened"* from *"an access happened and its fact was lost"*, and the atomic fix is the shape 054 A5 refused. Every claim this record makes about the audit is therefore a claim about the accessor's CODE PATH and never about the table being a complete history. | accepted; no bead |
| **R7** | **A per-day first-sign-in series is a shift record at a small shop** (§3.2, security F5). Truncating `created_at` to the hour NARROWS it and does not remove it: an hourly series at a one-owner shop still says which hours that owner worked. The two halves that would remove it are a retention window and a notice describing this table in the employee's own terms. | **E03-B09 `longbox-e5b.3.9`** (retention) + **E01-B06** (the 022 P3 notice — it must describe THIS table, not this record's version of it) |
| **R8** | **A recovery screen will need `contact_name` again** (§4.2, security F1). The read is deleted rather than routed through an accessor, because building one would mean inventing a purpose for a surface nobody has designed — 022 P3's CFO constraint applied to a vocabulary. When that screen exists it goes through the accessor with its OWN purpose and its own migration, exactly as `break_glass_reconciliation` will. | **PROPOSED alias E03-D29 `longbox-e5b.3.39`** — not created by this record |
| **R9** | **The text rule cannot see a concatenated statement** (§10). Accepted and bounded: the database-level backstop is that the application holds no SELECT on the fact table, so no arrangement of application SQL can read the audit back — but nothing at the database stops a concatenated read of `app_user`. | accepted; the day a query builder enters this repository, this rule needs a second mechanism |

**This record files no new bead.** Every residual above has an existing owner or is an accepted trade with its ground stated. If the cannon disagrees, the next free alias is **E03-D29 `longbox-e5b.3.39`** (E03-D28 `longbox-e5b.3.38` is the last taken).

---

### 11.1 What the rebase owed, and what it turned out not to

This branch was cut before E03-D19's `migrations/034` and E03-D20's work landed on `main`. Two obligations were recorded here before the rebase; the rebase settled them differently, and both outcomes are stated because a rebase is the moment a discipline is quietly dropped **or** a precaution is quietly kept for no reason.

- **`migrations.test.ts` — OWED AND DONE.** The ordered list carries **both** `034` and `035`, the count is **34**, and the comment is restated to **ONE** gap: `027`, reserved by E03-B06 and never written. This branch's pre-rebase version said *two* gaps, because `034` was somebody else's in-flight file when it was written; that sentence is now false and is gone. `035` KEEPS its number, on the rule `030` states and `034` had just demonstrated one row up: a number moves freely before a merge and never after one.
- **A prior-schema fixture — NOT owed, and the pre-rebase note here was wrong.** 044 §3's rule counts migration FILES against the newest snapshot's `applied`. The arithmetic that made this an obligation used `after-030` at `applied: 29` against 34 files (**5 > 4**) — but **E03-D19 shipped `after-033` at `applied: 32`** in the same PR that added `034`, so the real figure is **34 − 32 = 2**, comfortably inside the limit, and `tests/integration/prior-snapshot-upgrade.test.ts` passes untouched. **No fixture is cut**: `after-033` already exercises the upgrade INTO this migration from a real prior schema, and adding `after-034` would generate a large committed file to satisfy a rule that is not asking. Recorded rather than silently skipped, because the instruction to cut one was given in good faith against the pre-merge tree.

**And the 044 §9 index-lock rule, checked rather than assumed:** `pnpm migrate --dry-run` warns on ten migrations that build a non-`CONCURRENTLY` index on a **pre-existing** table, and `035` is not among them — `identity_access_shop_idx` is built on a table created in the same file, so there is no lock to take from anybody. No `-- index lock:` header is owed, and this paragraph is the evidence that the question was asked.

## 11a. What this record does NOT decide

- **The break-glass READ path and its 7-day notice — E11-B09's.** It reaches per-operator data through this accessor and not around it, which is 054 §8's sentence and unchanged. It also adds the `break_glass_reconciliation` purpose, in the migration that adds its reader.
- **Retention of `identity_access` — E03-B09's.**
- **The detector heartbeat — E13-B04-D1's.**
- **Any 019 threshold or 022 principle.** Nothing here amends one. The 019 amendment this PR files is **instrument-only**: T35 stays 0, stays non-waivable, and its (a) and (c) clauses and the route-walk half of (b) are untouched character for character. Per `019:202` a conflict halts and escalates by a 006 row.
- **`019 §3.4`'s K1 list**, which is closed (§6).

## 12. Dissents and adopted-differently, preserved

Both lenses returned ACCEPT-WITH-CHANGES and **nothing was declined**. Two positions were adopted in a shape the lens did not ask for, and one was not adopted at all; the difference is recorded here rather than smoothed over.

**Data-model lens, on the fifth privilege class (Hickey 2) — NOT ADOPTED.** In its own words:

> *"a fifth privilege class that buys append-without-read at the cost of a permanently growing taxonomy when a `SECURITY DEFINER` accessor function sitting on infrastructure this repo already trusts would have bought the identical guarantee without teaching every future table a new word — and I'd sign this record once those two are named for what they are, because naming a trade-off is cheap and discovering it three tables later is not."*

The lens's condition — *name it for what it is* — is met in §9 A8, which argues the alternative on its merits and refuses it on three grounds. **The lens's preferred construction is not what shipped**, and its reasoning about the cost stands unrebutted: the taxonomy does grow, and the rule holding it small is prose in `appendOnlyTables.ts` rather than a mechanism. A reader who thinks the function was the better call has §9 A8's three grounds to attack and this paragraph as the record that the question was live.

**Security lens, on the accessor pair (F3) — ADOPTED IN PART, and the part is stated.** The lens's objection was that a caller-supplied literal *"means both audit findings can only catch an author who honestly declares"*. The METHOD and PATH are now observed and an undeclared triple refuses the request; **the PURPOSE is still a literal and cannot be observed** (§4.4). The finding is folded, the hole is narrowed, and it is not closed — a dishonest author can still cite a declared purpose for the wrong read.

**Security lens, on the timing series (F5) — ADOPTED IN PART.** The lens's point was that *"a shop id names a tenant, never a person"* fails at the cardinality the pilot actually has. Truncating `created_at` to the hour is the cheap half and it is taken; **the class is narrowed and not removed**, the index the lens objected to is KEPT (it is the tenant index every policied table carries, and dropping it would exempt this table from a uniform property to buy a partial mitigation), and the expensive halves are filed as §11 R7 with two named owners.

**What the v1.0.0 builder drafts anticipated, for the record.** Two of the eight findings: the drafted security position guessed the subject-keyed objection (§5's A2, which the lens accepted rather than pressed) and guessed that most gated reads are the caller's own — which it then got exactly backwards, asserting there were no third-party reads at all, and that assertion became security F4. It anticipated neither F1, F2, F3 nor F5, and neither Hickey finding. That is the honest measure of drafting a lens rather than dispatching one, and it is why §2 now carries the real statements.

## 13. Ratification

**PROPOSED — NOT ratified at v1.1.1. §13 is UNSIGNED.** The two-lens cannon was dispatched and both lenses returned ACCEPT-WITH-CHANGES; all eight findings are folded, none is declined, and §12 preserves the three positions adopted differently or not at all. A `longbox-gate-auditor` NOT-READY is folded in the same pass — nine dead section cites, two wrong counts, one wrong section number, the missing 058 row and the missing gate-config exemption, plus F7's enum widening, which was a decision and not a repair.

**The acting head signs at CLOSE**, after the `longbox-invariant-reviewer` verdict on the code half and the merge SHA.

**What ratification will NOT authenticate when it comes.** It will not close 019 T35(b), which needs E11-B09's gate and E13-B04-D1's heartbeat (§4.3). It will not make §11's residuals smaller by having been signed — in particular R6, which says audit completeness here is asserted and not proven. And it will not settle whether the subject-keyed question in §5.1 should ever be answerable, which is E11-B09's to decide with the notice attached.
