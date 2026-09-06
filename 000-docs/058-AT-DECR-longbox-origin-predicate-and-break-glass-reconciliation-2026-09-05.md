# Decision Record — The Longbox-Origin Predicate: Making T35(c)'s Reconciliation Able to See the Session It Was Written For

**Version:** 1.1.3
**Status:** **RATIFIED at v1.1.1** (2026-09-05, signed by the acting head under the 2026-09-03 delegation at close of E03-D14 — PR #92 squash-merged to `main` as `d10467c`, the bead closed against that SHA, after the invariant re-verification PASS-WITH-NOTES at `b7400f0` (every reproduced finding CLOSED by hand: the back-dated retirement is FORCED to now(), the boot assertion fails on a stray grant, the K1 survives) and the gate audit's fact repairs at v1.1.0). The text that follows is the PROPOSED-era status, kept verbatim as history: **PROPOSED — UNSIGNED.** The two-lens cannon **was convened by the session** on 2026-09-05 against PR #92 head `635aabe`: `security-auditor` **ACCEPT-WITH-CHANGES** (F1–F8) and `rich-hickey-reviewer` **ACCEPT-WITH-CHANGES** (H1, plus H2 and four affirmations). §2 now carries the dispatched lenses' **verbatim** statements; v1.0.0's builder drafts are superseded rather than kept beside them. All nine findings are folded, two dissents are preserved verbatim in §14, and the alternatives the cannon raised and this record did NOT take are in §13. A `longbox-gate-auditor` NOT-READY on statements of fact is folded in the same pass. **The acting head signs at CLOSE**, after the invariant review; a record that pre-announced its own ratification would be the artifact deciding its own review (053's rule, unchanged).
**Bead:** E03-D14 `longbox-e5b.3.24` — *Give T35(c) reconciliation a Longbox-origin predicate so staff sessions outside a break-glass grant are visible* (epic LBOX-E03 `longbox-e5b.3`, gate G2) — discovered 2026-09-04 by the security lens on 054, finding **F3**
**Filed:** 2026-09-05 · **Author:** `longbox-security-tenancy-builder` · **Owner:** parent session (acting head of board)
**Sensitivity:** Restricted internal (014 §10). It names tables, columns, functions and commands; it contains no person's name, no identifier of any live person, and no secret value of any kind.
**Scope of this commit:** the RECORD and its CODE HALF land together on one branch. Migrations `032` and `033`; `src/services/auth/origin.ts`; the widened reconciliation in `src/services/auth/authorizationAudit.ts`; the no-grant clause of the boot assertion in `src/services/roleSeparation.ts`; `pnpm audit:break-glass`, `pnpm designate-staff`, `pnpm retire-staff-designation`; one new `pnpm arch` rule.

---

## Change log

**Version convention** (006 `:6`): a **minor** bump means the content of a decision changed; a **patch** means a statement of fact was repaired with no decision changing.

| Version | Date | What changed | Authority |
| --- | --- | --- | --- |
| **1.1.3** | **2026-09-06** | **A PATCH, and a ROW ONLY — no sentence of this record is edited.** `appGrant`, which §3(c) introduced here as the class that withholds every privilege on the tables recording WHO IS WATCHED, gains a **FOURTH value**: `"read-append"` (E03-D21 `longbox-e5b.3.31`, 000-docs/062 §3.2), beside `"full"`, `"none"` and 060's `"insert-only"`. It grants `SELECT, INSERT` and withholds `UPDATE` and `DELETE`, and its one member is `app_user`: `migrations/036` policies the person table `FOR ALL` over rows a shop legitimately sees, so no tenant predicate can refuse an UPDATE of a co-worker's row and the GRANT is the whole control — the security lens reproduced a one-statement rewrite of another person's login identifier. It joins the boot assertion's forbidden-grant check on this record's own F2 reasoning, asked about `UPDATE` and `DELETE` only, because `SELECT` and `INSERT` are the privileges the class exists to hold. **§3(c) is UNTOUCHED**: `app_user_origin` and its retirement stay `"none"`, and a table that records who is being watched must still not be writable by the process being watched. No ruling, invariant or residual in this record changes. | E03-D21 → acting head |
| **1.1.2** | **2026-09-06** | **Patch — one statement of fact widened; no decision in this record changes and §15 stays as it is.** §3(c) and the boot-assertion half describe `appGrant` as if its domain were `"none"` and absent. **E03-D17 (`longbox-e5b.3.27`, 000-docs/060, migration `035`) adds a THIRD value, `insert-only`**, so a reader of §3(c) now meets a field wider than that section describes. **Nothing here moves:** `app_user_origin` and `app_user_origin_retirement` are still `"none"`, still for the reason §3(c) gives — a table that records who is being watched must not be writable by the process being watched — and the new value is that argument's MIRROR rather than a softening of it: `"none"` withholds the INSERT because an appended row changes what a control SEES; `insert-only` withholds the SELECT because a process that can read its own access log can shape what an audit sees before the audit runs. **F2's boot assertion is EXTENDED, not replaced**: the same `forbidden_grants` check now takes both declared lists, and both halves are `COALESCE`d before concatenation because `array_agg` over zero rows is NULL and `NULL || anything` is NULL — a check that would otherwise have gone quietly green the moment either half was clean. **056 takes no row**: it names `appGrant` once in passing and describes no privilege class. | amend-by-a-row from E03-D17 (000-docs/060 §8) |
| **1.1.1** | **2026-09-05** | **A PATCH — the signature.** Status → RATIFIED; §15 records the signing, the re-verification verdict it waited on, and the merge SHA `d10467c` the bead is closed against; R5's bead is filed as E03-D23 `longbox-e5b.3.33`. No ruling, invariant, residual or dissent changed. | Acting head, at close of E03-D14 |
| **1.1.0** | **2026-09-05** | **A MINOR, and the number is argued rather than assumed.** The session-convened cannon returned two ACCEPT-WITH-CHANGES and **nine findings, all folded, none declined**. Two of them make this a minor rather than a patch. **(F1)** §3(b), §9 A5 and §11 R1 asserted that retroactive narrowing was *"not expressible"* — and it was one INSERT: `created_at`'s `DEFAULT now()` applies only when the writer OMITS the column. `migrations/033` adds the enforcement the record claimed existed, so **a decision changed** (the asymmetry moves from asserted to enforced) rather than a fact being repaired. **(F4)** *"discharged"* is narrowed to *"discharged for APPLICATION sessions"* — a claim moved. Also folded: **F2** (a runtime check on the no-grant class, which had none), **F3** (`--by` REQUIRED on both CLIs), **F5** (a session still live is in scope whenever it was issued), **F6** (the one-writer rule reads `scripts/` too), **F7** (*"names no person"* → *"by identifier"*), **F8** (the window's moment comes from the connection), **H1** (a second copy of the liveness logic, removed), **H2** (E03-D11 named on R1). §2 is REPLACED by the dispatched statements; §13 and §14 are new. A **gate-audit NOT-READY on statements of fact** is folded in the same pass: 019 takes a **MINOR to v1.5.0** because its A9 row changes ratified body text (B1); the cadence residual names **E13-B04-D1 `longbox-e5b.13.4.1`** and not E13-B04 (B2); §10 warns that E03-D11's `031` turns two assertions red by design (F3); doc `057` is recorded as RESERVED (F2); 048 I14 is deliberately not amended (F1). | the cannon → acting head |
| 1.0.0 | 2026-09-05 | Initial record. Four decisions: the designation is an APPEND-ONLY FACT with an append-only ending and no column an UPDATE can flip (§3(a)); the START may be back-dated and the END may not, because one widens the audited population and the other narrows it retroactively (§3(b)); the application role holds NO privilege on either table (§3(c)); and the predicate has ONE definition, a STABLE SQL function, with no `shop_id` anywhere (§3(d)). Plus §4's audit CLI and §5's issuance CLIs. Amends **054 → v1.1.3** (§6's claim returns from *narrowed* to *discharged*, by a row) and **019 → v1.4.1** (T35(c)'s instrument row, by a row; **no threshold value moves and no non-waivable status changes**). | E03-D14 |

---

## 0. Evidence posture

018 governs. Every claim about the tree in §1 is **REPRODUCED** — a command and its output at a named commit — and every claim about behaviour is **TESTED**, with the test named. Every number that is not a measurement is declared **PROVISIONAL** and is never quoted as a detection guarantee (021 B16). **No statute is cited anywhere in this record.** The two lens positions in §2 are **builder drafts** and are labelled in place.

---

## 1. What exists today — REPRODUCED at `70abeed` (`main`, 2026-09-05)

⚠ **THIS SECTION DESCRIBES THE WORLD BEFORE THIS BEAD, AND IT IS UNCHANGED AT v1.1.0.** The cannon's findings are about what v1.0.0 *shipped*, not about what preceded it; where a v1.0.0 claim did not survive execution, the correction is in §3 and §14 rather than here.

| Fact | Command | Output |
| --- | --- | --- |
| There is no staff flag anywhere in the schema | `grep -rn "staff\|longbox_origin\|is_internal" migrations/` | *(no matches)* |
| The reconciliation selects only break-glass holders | `sed -n '/unreconciledBreakGlassSessions/,/ORDER BY/p' src/services/auth/authorizationAudit.ts` | `EXISTS (SELECT 1 FROM membership m WHERE m.app_user_id = s.app_user_id AND m.role = 'support_break_glass')` |
| 054 §6 says so, and names this bead | `grep -n "E03-D14" 000-docs/054-*.md` | *"A Longbox employee who was never granted break-glass is invisible to it. That is a real gap and not a rounding: the predicate that closes it is **E03-D14**"* |
| The reconciliation has no caller and no schedule | `grep -rn "unreconciledBreakGlassSessions" --include=*.ts src/ scripts/` | one export, one re-export, zero runtime callers |
| Head is migration `030`; `027` is a gap E03-B06 reserved and never wrote | `ls migrations/ \| tail -3` | `028_… 029_… 030_…` |

**The finding, stated as the code stated it.** The population of a reconciliation for *"Longbox-origin database sessions"* was *"every session of a person who holds `support_break_glass` at some time"*. Those are different sets, and the difference is not a rounding error: a Longbox staff account that reached a shop by any other means — an invitation redeemed on a shop's phone, a membership somebody granted, a session that outlived the grant that justified it — was **invisible by construction**. No amount of running the query would have found one, because the population it selects from is defined by the grant it is checking for. 019 T35(c) is **non-waivable** and an unmatched session is **K1** (019 §3.4), so a detector that cannot express its own population is a non-waivable threshold with no instrument.

---

## 2. The two-lens cannon — **DISPATCHED**

Convened by the parent session on 2026-09-05 against PR #92 head `635aabe`. Both lenses returned **ACCEPT-WITH-CHANGES**. v1.0.0's §2 carried positions this builder had drafted in-band, because no builder agent holds the Agent tool; **those drafts are superseded rather than kept beside these**, on 054's precedent. The statements below are the lenses' own, verbatim.

### 2.1 The security lens (`security-auditor`) — ACCEPT-WITH-CHANGES, eight findings

> The security lens ACCEPTS 058 WITH CHANGES. Its shape is the right one: an append-only designation with an append-only ending, a mandatory as-of, one SQL definition of the predicate, no wire surface, a union that keeps the half already tested, and an output that names a tenant and no person. Two of its own headline claims, however, do not survive execution. The retirement's `created_at` is a DEFAULT and not a constraint, so the retroactive narrowing §3(b), A5 and R1 call "not expressible" is one INSERT — and in a form stronger than A5 imagined, since a retirement dated before its designation's own start erases that designation for all of history, with I13's contract test asserting the absence of a differently-named column while the attack passes underneath it. And `appGrant: "none"` is a single layer with no runtime check: with row-level security deliberately absent from both tables, a stray GRANT leaves the application role able to append that same back-dated retirement while the role-separation and tenant-isolation boot assertions both report green, as reproduced here. Neither finding requires a redesign — a `BEFORE INSERT` trigger that forces `created_at := now()`, and one `has_table_privilege` query added to the boot assertion over the no-grant class, close both — but until they land, the record must not claim the narrowing is unavailable or that the privilege is the whole mechanism. Two scope claims also need narrowing rather than fixing: the actor of a retirement is optional and no authorization decision is recorded for the strongest privileged act in the system, and the instrument reconciles APPLICATION sessions, so every schema-owner database session — including the one that writes the designation itself — remains outside it by construction, which is the same phrase this record uses about the defect it closes. 054 §6 should return to "discharged for application sessions", not to "discharged".

**F1–F8, and where each landed.** **F1** (HIGH) — the retirement's `created_at` was a DEFAULT, so the retroactive narrowing this record called *"not expressible"* was one INSERT, in a form stronger than §9 A5 imagined: a retirement dated before its designation's own start makes the predicate false at every instant, erasing the designation for all of history. `migrations/033` forces the value, refuses a future start at the database, and refuses a retirement that predates its designation; §6 I13 is rewritten to ATTEMPT the back-dated INSERT and assert the refusal. **F2** (MED-HIGH) — with both tables RLS-exempt, the GRANT was the whole control and nothing checked it at runtime; the boot assertion now reads `has_table_privilege` over the no-grant class and fails closed, with a live fixture. **F3** (MED) — `--by` is REQUIRED on both CLIs, and §5 says why an `authorization_decision` row is not written. **F4** (MED) — *"discharged"* is narrowed to APPLICATION sessions in §7, §11 and every amended record. **F5** (LOW-MED) — the window keeps a session still live whenever it was issued. **F6** (LOW) — the one-writer rule reads `scripts/`. **F7** (LOW) — *"names no person"* becomes *"names no person by identifier"*. **F8** (LOW) — the window's moment is the connection's `now()`.

⚠ **The lens's closing instruction is honoured literally: §2's v1.0.0 draft S-draft-1 must NOT be read as discharged.** It asked for exactly the property F1 then found missing, and a record that quoted its own draft as satisfied would be the artifact grading its own homework.

### 2.2 The data-model lens (`rich-hickey-reviewer`) — ACCEPT-WITH-CHANGES, one finding

> The data model earns its append-only claim honestly: a designation is a row, its ending is a row, the predicate that reads them is evaluated as-of a moment and has exactly one definition in the schema, and the one asymmetry that matters — a start may widen the past, an end may only narrow the future — is enforced by the shape of the table rather than asserted in a comment. That is identity, value, and time kept as three things instead of one, and it is why "narrowed" can honestly become "discharged" without anyone quietly renaming a smaller claim into a bigger one. The single crack I found is a second, hand-written copy of the predicate's own logic sitting one function away from the one the contract test checks — small, contained, and worth closing before this becomes the drift the record's own argument warned against.

**H1, and the affirmations.** **H1** — `liveOriginDesignationCount` had written the liveness logic out again, one function away from the definition §3(d) says is the only one; it now calls `longbox_is_origin_staff` and the contract test bans the SHAPE (`NOT EXISTS … app_user_origin_retirement` outside the migration) rather than fixing the instance. **H2** is a forward note, not a defect: designation issuance must move off the raw schema-owner CLI when the privileged session lands, and §11 R1 now names **E03-D11** for it. **H3, H4, H5 and H7 are affirmations** and are recorded because an affirmation is a finding: the UNION is right (capability and classification are different questions), the window belongs to the QUERY and not to the schedule, and *"discharged"* is honest as a statement about the model — subject to F4's narrowing.

### 2.3 Where the two lenses met, and where they did not

They met on the shape: an append-only designation with an append-only ending, one definition of the predicate, a mandatory as-of, no wire surface.

**They did not meet on whether the asymmetry was ENFORCED**, and §14 preserves both sentences verbatim rather than reconciling them. The data-model lens read the schema and saw an ending that can only narrow the future; the security lens ran an INSERT and found it could reach the past. **Both were describing `635aabe` and only one had executed.** That is the whole argument for a cannon with two lenses and for 018's REPRODUCED rung, and it is why §6 I13 is now a probe rather than a column-name assertion.

## 3. Decision — the origin is an APPEND-ONLY FACT about a PERSON, and the predicate is one SQL function

### 3.1 The rule

> A person is **Longbox-origin at a moment** iff some `app_user_origin` row names them with `origin = 'longbox_staff'` and an `effective_from` at or before that moment, and no `app_user_origin_retirement` for that row was created at or before that moment.

Four decisions make it that and not something easier.

### (a) A ROW, not a column on `app_user`

The bead offered two shapes: an organization-level "longbox staff" fact, or an `app_user` attribute set only by a CLI. **Both are rejected in favour of a third**, and the reason is the same for each.

`app_user` is a **declared MUTABLE table** (048 §10.1: a person is a statement about the present, not a thing that happened). A boolean on it is flipped by one UPDATE, leaves nothing behind, and takes every past session out of the audited population with it — the detector would answer a different question after every edit and could not say when the answer changed. An organization-level fact has the same problem one join further away, plus a worse one: it ties a person's origin to a tenancy row, and the session most worth finding is precisely the one at a shop the person holds nothing at.

So it is a grant/release pair on `membership`'s own idiom (034 §2.7): **an issuance fact and an ending fact, both append-only under `ENABLE ALWAYS` triggers**, with no `status`, no `retired_at` and no `is_active`. Liveness is a predicate over rows, which is 048 §3's rule for sessions and 041 §2.1's rule for everything.

### (b) The START is settable and the END is not — the asymmetry IS the control

`effective_from` may be back-dated. A designation records something that was **true before anybody wrote it down**, and an audit that could not backdate would be permanently blind to every session opened before somebody remembered to run the CLI. Back-dating a start **widens** the audited population, which costs an operator nothing and buys an investigator the sessions that already happened. A FUTURE start is refused in the CLI (a CHECK cannot express it — `now()` is not immutable), because a designation that has not begun yet is one that hides the sessions somebody is about to open.

The retirement has **no such column**. It ends the designation at its own `created_at`, which the writer does not choose and cannot supply. Narrowing the population retroactively — hiding a session that has already happened — is the one motion an attacker with write access would want, and it is not expressible.

⚠ **This is the whole reason the designation is not "a flag a CLI sets".** A flag can be unset. These rows can only be added to, and the only addition available narrows the future.

> ⚠ **AND AT v1.0.0 THAT SENTENCE WAS A CLAIM, NOT A CONTROL — the security lens's F1.** `created_at timestamptz NOT NULL DEFAULT now()` is a DEFAULT: it applies when the writer omits the column and does nothing when the writer supplies it. So the retroactive narrowing this section called *"not expressible"* was **one INSERT**, and the lens reproduced it on a live schema. It also found a form §9 A5 had not imagined: a retirement dated BEFORE its designation's own `effective_from` makes the predicate false at every instant, which does not END a designation but **ERASES it for all of history**.
>
> **`migrations/033` is the enforcement, in three checks that fail differently** (034 §3.2): a `BEFORE INSERT` trigger that FORCES `created_at := now()` (it overwrites rather than refuses, so an honest caller that names the column keeps working and the value it named buys nothing); a trigger that REFUSES an `effective_from` in the future, which lived in TypeScript alone and is a check the database did not have; and a trigger that refuses a retirement predating its designation — implied by the first, and present because the failure it guards against is **the first being dropped by a future migration**, which no default and no application check can notice. All three are `ENABLE ALWAYS`, so no `session_replication_role` switch turns them off.
>
> **The test that missed it is as instructive as the defect.** §6 I13 asserted the ABSENCE of the column names `effective_from`, `effective_until` and `retired_at` from the retirement table — and the attack needed none of them: it used `created_at`, the column the design put there on purpose. **A test that names what must not exist cannot see a property that fails through what must.** I13 now ATTEMPTS the back-dated INSERT as the schema owner and asserts the refusal.

### (c) The application role holds NO privilege on either table

Both tables are declared **`appGrant: "none"`**, a class that until this bead existed only on `APPEND_ONLY_EXEMPTIONS` and now exists on `APPEND_ONLY_TABLES` too. The grant step's opening `REVOKE ALL` is the whole mechanism; `planAppRoleGrants` checks the no-grant class **before** the append-only one, so a table declaring both lands in the narrower one.

The argument in one sentence: **a table that records who is being watched must not be writable by the process being watched.** The append-only trigger already refuses every UPDATE and DELETE from every role, so the privilege buys nothing against editing — what it buys is the refusal of an **INSERT**, and specifically of a retirement, which is the one write that narrows 019 T35(c)'s population. A compromised server can no longer take a staff account out of the audit.

Designation is therefore a **schema-owner act** reached from a CLI, which is the shape 048 §12.4 row 3a forces on every other privileged issuance until E03-D11 lands the privileged session.

> ⚠ **AND AT v1.0.0 THE GRANT WAS THE WHOLE MECHANISM, WITH NOTHING CHECKING IT — the security lens's F2.** Every other table in this schema has a policy behind its grant; these two, by §3(d), have none, because they carry no tenant. So a stray `GRANT INSERT … TO longbox_app` — one statement, from a migration, a console, or a hand-run fix — left the application role able to append the back-dated retirement F1 describes, **while `checkRoleSeparation` and `checkTenantIsolation` both reported green**, as the lens reproduced.
>
> **The boot assertion now reads the privilege itself.** `checkTenantIsolation` asks `has_table_privilege(current_user, t, 'SELECT'|'INSERT'|'UPDATE'|'DELETE')` over `NO_APP_GRANT_TABLE_NAMES` — the SAME declaration the grant step reads, so the check and the plan cannot disagree about which tables they are — and any true answer fails the assertion closed. `has_table_privilege` rather than a `role_table_grants` read, deliberately: the question is not *"was a GRANT statement issued"* but *"can this role reach the table by ANY path"* — a direct grant, `PUBLIC`, or a role it is a member of — and only the privilege function answers that one. `tests/integration/break-glass-origin.test.ts` grants, observes the refusal, revokes, and observes green again, so the check is known to react to the privilege rather than to a permanent property of the fixture.

### (d) No `shop_id`, and ONE definition of the predicate

Origin is a fact about a **person** and follows them to every shop. A `shop_id` would make the predicate answer per tenant and hide the single most interesting row this detector can produce: a Longbox account at a shop it holds no grant at. Both tables are therefore declared RLS exemptions (056 §7, the "person" class, beside `app_user`), bounded more tightly than their neighbours by (c).

The predicate itself is **`longbox_is_origin_staff(app_user_id, timestamptz)`** — a `STABLE`, SECURITY-INVOKER SQL function in `migrations/032`. The reconciliation calls it, the CLIs call it, and **no TypeScript copy exists**. `SECURITY DEFINER` is asserted ABSENT by a contract test, because a definer function over these tables would hand back the read (c) just took away.

**As-of is MANDATORY, with no `now()` overload**, on `resolve(lcid, asOf)`'s precedent (047): the question is *"was this person staff WHEN THIS SESSION WAS ISSUED"*, and a default of `now()` would silently answer a different question for every session issued before a designation was retired.

### 3.2 The population is a UNION, and neither half contains the other

`unreconciledBreakGlassSessions` now selects a session when **either**:

1. its person was **Longbox-origin at issuance** — T35(c)'s own sentence, unexpressible until this bead; **or**
2. its person holds a `support_break_glass` grant at some time — the original population, **KEPT**.

(2) is not redundant. The role is not reserved to Longbox: a shop's own person can be granted break-glass, and a session of theirs outside its window is exactly the unmatched row 019 §3.4 makes K1. Dropping it to tidy the query would delete the half that is already tested (054 I14).

Each returned row says **which** predicate put it there, so the audit reports two counts and an operator can tell *"our support person strayed past a ticket"* from *"a Longbox account was at a shop with no grant at all"* without reading one identifier.

⚠ **The query names NO chain kind.** Device sessions are excluded by `app_user_id IS NOT NULL` — a phone is not a person — and not by `kind = 'operator'`, so **E03-D11's privileged chain joins this population with no edit**. A contract test asserts the literal is absent, because the failure it prevents is a detector that goes quiet rather than red.

---

## 4. The audit — `pnpm audit:break-glass`

A sibling of `pnpm audit:cross-tenant` and deliberately shaped like it: it runs as the **schema owner** on `MIGRATE_DATABASE_URL` (the application holds no privilege on the designation tables, and a tenant context is exactly what would hide the rows it looks for), prints **counts**, and **exits non-zero on any finding** so a scheduler needs no output parsing.

**What it prints, and the one identifier it will print.** Counts per shop, per population. Never a session id, never an `app_user_id`, never a display name, never a per-session timestamp — 019 T35 signs per-operator rendering at zero and 022 P3 forbids the covert timeclock, so a detector whose output was a list of people would be that artifact with a cron entry. The one identifier is the **shop id**, on `audit-cross-tenant`'s line exactly: a shop id names a TENANT, which is what an operator must know to act, and names no person. Who the person was is reachable only through the identity module's audited accessor, **E03-D17**.

⚠ **It names no person BY IDENTIFIER, which is not the same as naming no person** (the security lens's F7). At pilot scale a count of one at a shop with one designated person identifies that person to anybody holding the roster, and no projection can prevent that — **the finding IS about somebody**. What the output withholds is the identifier: nothing it prints can be JOINED to a session, a scan or a shift, which is the property 022 P3 asks for. v1.0.0 said *"names no person"* flatly, which was a stronger claim than the shape supports.

**The moment comes from the CONNECTION, not from the process** (F8). Every timestamp this audit compares against is written by the database's clock, so a boundary taken from the client's would compare two clocks — and a scheduler on a host whose time had drifted forward would silently shorten its own window and report clean.

**It also prints the number of live designations.** *"Ran and found nothing"* and *"ran over nothing"* are different facts, and a reconciliation over an empty designation table is green for the wrong reason — the stale-detector failure 019 T34 exists to catch.

**The window is a PROVISIONAL floor and never a detection guarantee.** The default lookback is **24 hours**, matching the daily cadence 019 T24 and T35(c) describe; `--hours N` widens it and `--all` removes it. There is a window at all because the history is append-only: an unreconciled session can never be *repaired*, only investigated, so an audit that never forgets stays red forever after one incident and is therefore ignored. **The incident record is the K1 row in 006; the exit code is for the cadence.** The bound is one-sided — the last N hours from the moment the audit runs.

⚠ **A window keyed on `issued_at` ALONE drops a session that is STILL LIVE** (F5). At `635aabe` the 24-hour default sat beside an operator session's 12-hour absolute life, so the two were one configuration change from disagreeing — raise the session's life past the lookback and a live, unreconciled session falls out of the window it was opened before. The predicate now reads *issued inside the window **OR** not yet absolutely expired*.

**Two rules the CALLER owes, stated here because the query cannot enforce them.** The lookback must **exceed the cadence** — a daily job on a 24-hour window has no margin for a late start — and **a missed run is answered with `--hours` or `--all`**, not by the query remembering. There is deliberately **no watermark**: this is a window, not a cursor, and a cursor would make a missed run invisible instead of merely unexamined.

**The SCHEDULE and the T34 heartbeat remain E13-B04-D1 (`longbox-e5b.13.4.1`)'s**, with every other detector's cadence. This is the query and its exit code; a detector nobody runs reports nothing. ⚠ **The owner is the -D bead and NOT its parent E13-B04** (`longbox-e5b.13.4`, health and readiness): v1.0.0 named the parent, and a residual pointed at a bead whose acceptance does not carry the obligation is a residual with no owner.

---

## 5. Issuance — two CLIs, for the reason every other privileged issuance is one

```
pnpm designate-staff --user <uuid> --reason "<why>" [--by <uuid>] [--effective-from <iso>]
pnpm retire-staff-designation --user <uuid> --reason "<why>" [--by <uuid>]
pnpm audit:break-glass [--hours N | --all]
```

048 §12.4 row 3a: privileged issuance needs the privileged session, the FIRST factor has no bead until **E03-D11 (`longbox-e5b.3.21`)**, and `issue-invitation`, `issue-enrollment-code`, `enroll-authenticator` and `connector-install` are all CLIs for that reason. Designating a colleague is a stronger act than any of them — it decides who 019 T35(c) watches — so it does not get a weaker home.

The logic sits in `scripts/staffDesignation.ts` beside the CLI, on `crossTenantAudit.ts`'s precedent, **so the role check is testable**: a guard that only exists inside a `main()` nobody can call is a guard nobody has seen fail. `retire-staff-designation` is keyed on the PERSON rather than on a designation id, because that is the question an operator has and a designation id is not something anybody wrote down; an already-retired designation is skipped rather than re-retired.

**`--by` IS REQUIRED ON BOTH CLIs, and it was optional at v1.0.0** (the security lens's F3). Designating a colleague is the most privileged act in this system — it decides who 019 T35(c) watches — and it was recording LESS about its actor than an invitation does. **No `authorization_decision` row is written for either act, and the reason is structural rather than a preference:** that table is `shop_id NOT NULL` (054 §4.2) and a designation has no shop, by §3(d)'s own argument. Inventing one would be a false tenant on an audit row, and widening the table is 054's decision to take, not this record's. So `designated_by` and `retired_by` are **the only accountability record either CLI produces**, and §11 R1 says plainly that nothing verifies them: a schema owner can name anybody. Requiring the flag does not make the value true; it makes an omission a deliberate act rather than a default.

**A designation grants NOTHING.** Origin is not a role, carries no permission, is not in `ROLE_GRANTS`, and is never consulted by the authentication hook. It decides only who is watched — and both CLIs say so in their own output, because a colleague reading the receipt should not have to infer it.

---

## 6. Invariants

| # | Invariant | Test |
| --- | --- | --- |
| **I1** | A staff session **under a live break-glass grant** at that shop reconciles — zero findings. | `tests/integration/break-glass-origin.test.ts` (a) |
| **I2** | A staff session with **no grant anywhere** is a finding. **This is the case that could not be expressed before `migrations/032`**, and the test asserts both sides of the transition: nothing before the designation, the session after it. | same file (b) |
| **I3** | A grant at **another shop** does not cover a staff session here — the reason origin carries no `shop_id`. | same file (b′) |
| **I4** | A staff session issued **after the grant expired** is a finding. | same file (c) |
| **I5** | An **ordinary operator's** session is in no population at all (022 P3: this detector's business is narrow). | same file (d) |
| **I6** | A **retired** designation takes LATER sessions out of the population and **leaves EARLIER ones in** — §3(b)'s asymmetry, asserted in one case so neither half can be lost alone. | same file (e) |
| **I7** | Re-designating is a NEW row, not an un-retirement, and the person is watched again. | same file (e′) |
| **I8** | The CLI **refuses on the application role** before writing anything, and the application role additionally holds **no privilege on either table** — a raw INSERT and a raw SELECT are both `permission denied`. Two mechanisms, tested separately, because a script's guard is not a database's. | same file (f), (f′) |
| **I9** | A blank reason and a FUTURE `--effective-from` are refused, leaving no row. | same file |
| **I10** | Both tables are append-only **from the schema owner** (the strongest available principal short of a superuser), and a designation is retired **at most once**, by the UNIQUE. | same file; `tests/integration/append-only.test.ts` (the declared-list loop, both recipes added) |
| **I11** | A **device** session is never in the population, and the exclusion is by `app_user_id IS NOT NULL` rather than by a `kind` literal — so a third chain kind joins without an edit. | same file; `tests/contract/origin-designation-surface.test.ts` |
| **I12** | The predicate has **ONE definition**: a `STABLE` SQL function, named by an exported constant the query INTERPOLATES, with no `SECURITY DEFINER` and no TypeScript re-implementation. | `tests/contract/origin-designation-surface.test.ts` |
| **I13** *(REWRITTEN at v1.1.0 — F1)* | The designation's column list is **CLOSED** (no shop, session, device or chain column, and no status column) and the retirement declares no second time column — **the SHAPE half**. **And the PROPERTY is now a PROBE**: a back-dated retirement is ATTEMPTED as the schema owner and the stored value is `now()`; a designation starting in the FUTURE is REFUSED at the database; a retirement predating its designation is REFUSED with the forcing trigger switched off by name, and the trigger is asserted back at `tgenabled='A'` afterwards. ⚠ v1.0.0's I13 asserted the ABSENCE of three column NAMES while the attack used the column the design put there on purpose. | `tests/contract/origin-designation-surface.test.ts` (shape + the three `migrations/033` declarations); `tests/integration/break-glass-origin.test.ts` (F1 ×3) |
| **I13a** *(NEW at v1.1.0 — F2)* | A **stray GRANT on a no-grant table fails the BOOT ASSERTION**, in both directions: green before, `forbiddenGrants` naming the table and `ok: false` after `GRANT INSERT`, the failure message naming it, `assertTenantIsolationOrThrow` throwing, and green again after the REVOKE — so the check is known to react to the privilege rather than to a permanent property of the fixture. | `tests/integration/break-glass-origin.test.ts` (f″) |
| **I13b** *(NEW at v1.1.0 — H1)* | **NO file outside the migration re-states the predicate's liveness logic.** Asserted as a banned SHAPE (`NOT EXISTS … app_user_origin_retirement`) over both identity files, **and as an equality** — the migration must still contain it, so a rule that would pass with the predicate deleted is not the rule H1 asked for. | `tests/contract/origin-designation-surface.test.ts` |
| **I14** | It has **no wire surface**: no route, no DTO, nothing in the generated OpenAPI, and an authored `CATALOGUE_EXCLUSIONS` row saying why it emits no event. | same file; `tests/contract/event-catalogue.test.ts` |
| **I15** | **One writer**, enforced by `pnpm arch` rule 3c, with both negative fixtures (a second writer, and no writer at all). | `tests/contract/architecture-gate.test.ts` |
| **I16** | The audit's projection names a **tenant and no person**, counts the two populations separately, and is order-independent; the default lookback is pinned as one number. | `tests/break-glass-audit.test.ts` |
| **I17** | `pnpm audit:break-glass` reports per-shop counts, sees its window, and `--all` is a superset of the windowed answer. | `tests/integration/break-glass-origin.test.ts` |
| **I18** *(NEW at v1.1.0 — F5)* | A session **still live** is in scope whenever it was issued: the window predicate reads *issued inside it OR not yet absolutely expired*, so a lookback shorter than a session's life cannot drop the session it was opened before. | `src/services/auth/authorizationAudit.ts` (the predicate); `tests/integration/break-glass-origin.test.ts` (the window case) |

**Twenty invariants, all twenty TESTED** — 1652 unit cases (94 files) and a 20-case lane suite — seventeen at v1.0.0, plus **I13a** (F2's runtime check), **I13b** (H1's banned shape) and **I18** (F5's still-live session), with **I13 REWRITTEN from a column-name assertion into a probe**. The count is stated and re-counted because 042 v1.1.1's gate audit found two tallies nobody re-counted after an amendment; this table has now been counted twice.

---

## 7. What this record does NOT decide

- **The SCHEDULE and the T34 heartbeat — E13-B04-D1 (`longbox-e5b.13.4.1`)'s**, unchanged. This ships the query and its exit code. ⚠ **The owner is E13-B04-D1 and NOT E13-B04** (`longbox-e5b.13.4`, which is health and readiness): the gate audit caught v1.0.0 naming the parent, and a residual pointed at a bead whose acceptance does not carry the obligation is a residual with no owner. E13-B04-D1's acceptance now carries the daily-schedule clause.
- ⚠ **THE DATABASE-SESSION HALF OF T35(c) — NOT CLOSED, AND NOT CLOSEABLE BY THIS INSTRUMENT** (the security lens's F4). T35(c) says *"Longbox-origin **database** sessions"*. What this reconciles is `app_session` — **APPLICATION** sessions, the two chains 048 §3 defines. Every schema-owner DATABASE session is outside it **by construction**, which is the same phrase this record uses about the defect it closes: `psql` on `MIGRATE_DATABASE_URL`, `pnpm migrate`, and **`pnpm designate-staff` itself** leave no `app_session` row and therefore cannot appear. The control that would close it is **connection-level auditing** — a `log_connections`/`pgaudit`-class facility with its own retention and its own privacy argument under 022 P3 — and it is emphatically **not** E13-B04-D1's schedule, which would run this same query more often over the same population. **Proposed as `E03-D23` (`longbox-e5b.3.33`; last taken is E03-D22 = `longbox-e5b.3.32`) — NOT created here**, because filing a bead is the session's act. Until it lands, every artifact says **"discharged for APPLICATION sessions"**.
- **048 I14 is deliberately NOT amended** (gate audit F1). Its headline — *"Every Longbox-origin session reconciles to a break-glass grant"* — is unchanged and was never the narrowed claim; the narrowing lived in **054 §6**, which is where the amendment goes. What moves is the RTM's 048 I14 row: its population half is covered, its cadence half stays ⛔, and the row stays **PARTIAL**.
- **The audited accessor module — E03-D17's** (`longbox-e5b.3.27`). The reconciliation projects an `app_user_id` because T35(c) is the sanctioned exception (a reconciliation that could not name the person it failed to reconcile would be a detector with nothing to report), and it lives inside the identity module where 034 §3.3 puts every such read. **019 T35(b) is unaffected and still renders OPEN.**
- **Who decides that somebody is Longbox-origin, as a process.** This builds the mechanism and the receipt. The human procedure — who runs the CLI, on whose say-so, and how a colleague is told they are designated — belongs with **E01-B06**'s monitoring notice (022 P3 requires each employee to receive a plain-language notice of what Longbox records about them; a designation is a new record about a person and the notice must name it, in the notice's own terms). **Routed to E01-B06 by the bead note of 2026-09-05**, which names `app_user_origin` and `app_user_origin_retirement` under 022 P3 — so this is a discharged hand-off rather than a sentence hoping somebody reads it. The wording itself stays a [counsel] item under 021's T26.
- **The break-glass READ path and its 7-day notice — E11-B09's**, unchanged.
- **Retention of the designation rows — E03-B09's.** They are facts about employment and outlive a session; the window is that bead's to set.
- **Any 019 threshold or 022 principle.** Nothing here amends one; §8's two amendments are an instrument row and a claim restatement, and neither moves a value.

---

## 8. Amend-by-a-row obligations, discharged in this PR

| Record | Version | The row |
| --- | --- | --- |
| **054** | 1.1.2 → **1.1.3** (patch) | §6's ⚠ paragraph said the reconciliation's population is *"a superset of what matters and a SUBSET of 'Longbox-origin'"* and that the closing predicate is E03-D14. It has landed. The paragraph is **kept verbatim** as the record of what was true, with an amendment row stating that the claim returns from **narrowed** to **discharged** and naming this record and `migrations/032`. **RATIFIED records are amended by rows, never edited**, so the original sentence stays readable and a future reader sees the transition rather than a tidied claim. |
| **019** | 1.4.0 → **1.5.0** (MINOR — the acting head's ruling on the gate audit's B1: every prior amendment block took a minor, §9.1 → 1.2.0, §9.2 → 1.3.0, §9.3 → 1.4.0, and this one changes RATIFIED BODY TEXT rather than only adding a block) | T35(c)'s instrument now exists and is named: `pnpm audit:break-glass` over `unreconciledBreakGlassSessions`, whose population is the union in §3.2. **No threshold value moves, no definition changes, and no non-waivable status changes** — T35 stays 0 and stays non-waivable; the K1 rule is untouched. The row records the INSTRUMENT, which 019 §3.3's own vocabulary calls a *detector*, and re-states that its cadence is still E13-B04-D1's. |

---

⚠ **048 I14 is NOT amended, and the omission is deliberate** (gate audit F1). Its headline — *"Every Longbox-origin session reconciles to a break-glass grant"* — is unchanged and was never the narrowed claim; the narrowing lived in **054 §6**, which is where the amendment goes. What moves is `tests/RTM.md`'s 048 I14 row: population covered **for application sessions**, cadence still ⛔, row still **PARTIAL**.

---

## 9. Alternatives considered

**A1 — A boolean `is_longbox_staff` on `app_user`.** Rejected: §3(a). One UPDATE, no trace, and every historical answer changes with it.

**A2 — An organization-level "longbox staff" fact.** Rejected: §3(a). It ties a person's origin to a tenancy row, and the session worth finding is at a shop the person holds nothing at.

**A3 — Replace the break-glass population rather than union with it.** Rejected: §3.2. The role is not reserved to Longbox, and the existing half is already tested under 054 I14.

**A4 — Evaluate the predicate at `now()` rather than as-of the session.** Rejected: §3(d). A retirement would retroactively re-answer every historical row, which is the direction §3(b) exists to close.

**A5 — Let the retirement carry an `effective_until` the operator supplies.** Rejected, and it is the sharpest rejection in the record: that column is the whole attack. It would let a writer hide a session that has already happened.

**A6 — Give the application role the uniform append-only grant, like every other append-only table.** Rejected: §3(c). It is the only class of table in this schema whose contents decide what a control can see.

**A7 — A route instead of a CLI.** Rejected: 048 §12.4 row 3a. A route that called itself privileged while nothing enforced privilege would be worse than an honest CLI.

**A8 — Keep the audit unbounded so nothing is ever forgotten.** Rejected: §4. A permanently red exit code is an ignored exit code. `--all` keeps the unbounded question one flag away, and the K1 record is the 006 row.

---

## 10. Consequences

- **019 T35(c) has an instrument that can express its own population.** Before this, the non-waivable threshold had a query that could not have found the session it was written for.
- **A new store of records about people at work exists**, and 022 P3's monitoring notice must name it (§7, E01-B06). This record says so rather than leaving it to be discovered.
- **Two more tables the application cannot touch.** The `appGrant: "none"` class is now three members and spans both declaration lists; the ordering in `planAppRoleGrants` is what makes that true, and it is tested.
- **One more `pnpm arch` rule** (twelve tree rules), with both negative fixtures.
- **Migration head moves to `033`**, past E03-D11's in-flight `031` and past the `027` gap. The fixture set gains `after-030.sql` — the newest RELEASED schema — so the upgrade path is tested from the shape an operator actually runs.
- ⚠ **E03-D11's `031` WILL TURN TWO ASSERTIONS RED, BY DESIGN, and the next builder should read them as expected rather than as a break** (gate audit F3): `tests/integration/migrations.test.ts`'s filename list and its `expect(… .n).toBe(31)` count. Both exist to make a silent divergence loud, so the correct response is one line added to the list and one number raised — not a loosened assertion. Said here because a stranger's red build on somebody else's PR is the worst way to learn it.
- **The enforcement is a SECOND migration (`033`) rather than an edit to `032`.** `032` had already been applied by CI when the cannon reported, and the ledger keys on filename with a checksum: folding the fix back into the file that made the claim would have rewritten a migration a database had run. A second file is also the honest record — it shows that the claim shipped before the control did.

---

## 11. Residual risk

- **R1 — A schema-owner compromise defeats all of this.** Whoever holds `MIGRATE_DATABASE_URL` can append a retirement, and §3(b) bounds only the retroactive half: sessions from that moment on stop being watched. The append-only trigger keeps the retirement itself visible with its reason and timestamp, so the act is recorded — but it is recorded, not prevented. **No artifact may say this defends against the schema owner.** Two things narrow the window rather than closing it: `migrations/033` means the compromise cannot reach the PAST, and `--by` means the row names somebody — though **`designated_by` / `retired_by` are the only accountability record either CLI produces and NOTHING VERIFIES THEM** (F3): a schema owner may name anybody. **Designation issuance should move off the raw schema-owner CLI when the privileged session lands — E03-D11 (`longbox-e5b.3.21`)** (the data-model lens's H2), which is the same bead that would let both CLIs become routes.
- **R2 — A designation nobody writes is a person nobody watches.** The mechanism cannot know who works at Longbox; it records what an operator asserts. The audit prints the live designation count precisely so *"no findings"* and *"no designations"* are distinguishable, but the process that keeps the list true is a human one and is E01-B06's and E16's, not this record's.
- **R3 — The reconciliation is not scheduled.** Until **E13-B04-D1 (`longbox-e5b.13.4.1`)** gives it a cadence and a T34 heartbeat, an unmatched session is K1 only when somebody runs the command. Unchanged from 054 §6, and stated again because it is the difference between a detector and a query.
- **R5 — It reconciles APPLICATION sessions, not DATABASE sessions** (F4). §7 states the scope and proposes the bead. Until that lands, *"T35(c) discharged"* is false as written and *"discharged for application sessions"* is the sentence every artifact must use — including 054 §6's amendment and 019's A9 row, both of which say so.
- **R4 — It detects a session, not an ACT.** *"Did the unreconciled session do anything?"* is `decisionsByUnreconciledSessions`'s question and is deliberately expensive (054 §6, K4). This record adds nothing to that side and does not widen what the decision log holds.

---

## 11a. What an INDEPENDENT reviewer verified clean, by execution

The `longbox-invariant-reviewer` audited the code half at `635aabe` and returned **BLOCK on ONE finding** — the security lens's F1, reproduced independently: a schema-owner INSERT with `created_at` set ten years back made a K1 evaporate retroactively and turned the audit's exit code from 1 to 0. **The BLOCK is closed by `migrations/033`** on the fix-the-claim path rather than the restate-only path, because 019 T35(c) is non-waivable and this record's whole argument for a row over a column was that property.

Everything else it checked, it checked **by execution**, and the list is recorded here because an affirmation somebody ran is evidence and an affirmation nobody ran is a hope:

- both tables carry an `ENABLE ALWAYS` append-only trigger, and the boot detector still sees them after `033` adds three more (the detector reads `%_append_only` only, so the new triggers are correctly invisible to it);
- the app role holds **zero** privileges on both, verified from the catalog and by execution;
- **one** `STABLE`, SECURITY-INVOKER definition of the predicate, with no TypeScript re-implementation;
- the population is the UNION and the query contains **no `kind` literal**;
- `EVENT_CATALOGUE` is **byte-unchanged** — two exclusion rows only, no event added;
- no wire surface: no route, no DTO, nothing in the generated OpenAPI;
- `032` past the `031` gap is legal under the runner's filename ledger; `after-030.sql` is a genuine prior schema; the prior-snapshot upgrade is green from **eight** snapshots;
- unit coverage 80.09 against a floor of 80 — **80.69 after WARN2's fix**, with `origin.ts` at 93.9%.

Three notes beyond the cannon's list were taken. **WARN2** — that 0.09-point margin was a floor the next service PR would trip for reasons of its own, with `src/services/auth/origin.ts` 8.95 points under the unit lane: `tests/origin-designation.test.ts` now covers the refusals with a stub `Queryable`, and asserts *no query was issued* rather than *no row landed*, which is the stronger claim and the one only a stub can make. **NOTE3** is the security lens's F6 by another route and landed with it. **NOTE4** — `retireStaffDesignation` looped `retireOrigin` outside any transaction, so a failure partway through left a person half-retired while the receipt printed a count that had never been true; it is now **one statement**, atomic without needing a connection (the callers pass a `pg.Pool` as often as a `pg.Client`, where `BEGIN` would be a lie), idempotent by the same `UNIQUE (origin_id)` that makes an ending happen at most once, and `RETURNING` the count that actually landed. **NOTE5** — CLI `main()` bodies are untested, which is precedent-consistent across this repository and is not changed here.

---

## 12. Consequences of the cannon, in one place

Nine findings, **all folded, none declined**. What that cost: one migration (`033`), one clause on the boot assertion, one required flag on two CLIs, one widened window predicate, one rule moved to both trees, two sentences narrowed, one duplicated query removed. What it bought: the two headline claims of v1.0.0 — *"narrowing the population retroactively is not expressible"* and *"the application cannot write these tables"* — are now true rather than asserted, and the third — *"T35(c) discharged"* — is stated at the size it actually holds.

---

## 13. Alternatives the cannon raised and this record did NOT take

**A9 — `ENABLE ROW LEVEL SECURITY` with NO policy on both tables**, so the plan is corrective and the app role sees nothing even with a stray GRANT. Offered by the security lens as an option beside F2's boot check, and **declined, with the reason stated rather than the option deleted** (054's rule for a rejected alternative).

Three grounds. **(i) It would create a control with no detector.** The boot assertion's set comparison is scoped to POLICIED tables — those carrying a tenant column — so a permissive policy ADDED to an RLS-enabled-but-unpolicied table would be OR-combined by Postgres and seen by nothing. That is precisely the shape 056's own F2 condemned, and trading a checked control for an unchecked one is not defence in depth. **(ii) The value of the stray grant is already gone.** `migrations/033` refuses the back-dated retirement from EVERY role including the schema owner, so the write the grant would have enabled is no longer the write that mattered. **(iii) It would add a fourth declared class** to `src/db/rowLevelSecurity.ts` — policied / exempt / service-scoped / enabled-but-unpolicied — for two tables, and a classification nobody else needs is a classification the next author gets wrong.

**It stays available and is not closed by this record**: if a third table ever joins the no-grant class, or if the boot check's set comparison is widened to non-policied relations, the balance changes.

**A10 — Refuse a supplied `created_at` rather than force it.** Considered and not taken. Refusing makes `INSERT … (origin_id, reason, created_at)` an error for a caller that meant nothing by it; forcing makes the column unwritable by construction and leaves every honest caller working. The security property is identical and the failure mode is kinder.

**A11 — Write an `authorization_decision` row for a designation.** Not taken: that table is `shop_id NOT NULL` and a designation has no shop (§5). Inventing a tenant for an audit row would be a falsehood in the one table 054 built to be true.

---

## 14. Dissents, preserved verbatim

Two sentences from the cannon contradict each other, and **both are preserved rather than reconciled**, because the disagreement is the most useful thing the cannon produced.

**The data-model lens (§2.2), on the asymmetry:**

> the one asymmetry that matters — a start may widen the past, an end may only narrow the future — is **enforced by the shape of the table** rather than asserted in a comment.

**The security lens (§2.1), on the same asymmetry:**

> The retirement's `created_at` is a DEFAULT and not a constraint, so the retroactive narrowing §3(b), A5 and R1 call "not expressible" is **one INSERT**.

**Which was true at `635aabe`: the security lens's.** The shape of the table did NOT enforce it — `DEFAULT now()` is not a constraint, and the data-model lens read the DDL where the security lens ran it. **What v1.1.0 does is make the data-model lens's sentence true**, by `migrations/033`, so the record ends where that lens thought it began.

**The lesson is kept rather than the embarrassment tidied away.** A reviewer reading a schema and a reviewer executing against one answer different questions, and 018's REPRODUCED rung exists for exactly this gap. It is also why §6 I13 is now a probe: the test that was supposed to guard this property asserted the absence of three column NAMES while the attack walked through the column the design put there on purpose.

---

## 15. Ratification

**RATIFIED at v1.1.1, 2026-09-05.** Signed by the acting head at close of E03-D14 with the merge SHA `d10467c9b77b421db1a1e9c452c21ca66f452e85` (PR #92, 8/8 required checks; 1652 unit / 749+1 integration at b7400f0). The signature authenticates §3–§8 as decided, §2 as the lenses' own words, §13 (incl. the declined ENABLE-RLS-no-policy item) and §14's preserved contradiction as the honest record; it narrows nothing in R1–R5. The database-session half of T35(c) is filed as **E03-D23 `longbox-e5b.3.33`** (015 row 280). The paragraph below is the PROPOSED-era text, kept as history.

**UNSIGNED (as written at v1.1.0).** The cannon is dispatched and folded (§2, §13, §14); the gate audit's fact repairs are applied; `longbox-invariant-reviewer` audits the code half and `longbox-gate-auditor` re-audits this record. **The acting head signs at CLOSE with the merge SHA**, and 000-docs/006 carries the row. Until then no artifact may cite this record as ratified, and every citation of T35(c) that leans on it must carry §7's *application sessions* qualification and §11 R3's *not yet scheduled*.
