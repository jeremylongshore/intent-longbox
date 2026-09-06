# Decision Record — The Person Tables Behind a Membership Policy: What `app_user` Is Now Bounded By, and What Its Neighbours Are Not

**Version:** 1.1.1
**Status:** **PROPOSED — UNSIGNED.** The two-lens cannon **WAS DISPATCHED by the session** on 2026-09-06 against PR #99 head `518b076`: `security-auditor` **ACCEPT-WITH-CHANGES** (F1–F6) and `martin-kleppmann-reviewer` **ACCEPT-WITH-CHANGES** (K1–K6). §2 now carries **both lenses' verbatim position statements**; v1.0.0's labelled builder drafts are SUPERSEDED rather than kept beside them (054 §0's precedent), and §10 records how badly they anticipated. A `longbox-invariant-reviewer` **BLOCK** on one claim (= security F1) and a `longbox-gate-auditor` **NOT-READY** on five facts are folded in the same pass. **Every finding is folded and none is declined**; one lens position is adopted in a form the lens did not ask for and is preserved in §10. The acting head signs at CLOSE — a record that announced its own ratification in the commit that wrote it would be the artifact deciding its own review (053's rule, unchanged).
**Bead:** E03-D21 `longbox-e5b.3.31` — *Put the person-scoped tables behind a database policy so a forgotten predicate on `app_user` or its neighbours cannot cross tenants* (epic LBOX-E03 `longbox-e5b.3`, gate **G2**, evidence class TEST, layer security) — discovered 2026-09-05 by the 056 re-audit, because **§11 R9 had no owner at all**.
**Drafted:** 2026-09-06 by `longbox-security-tenancy-builder` · **Audit:** `longbox-invariant-reviewer` (code) and `longbox-gate-auditor` (this record) before close · **Decision owner:** Jeremy Longshore (acting head of board under the 2026-09-03 delegation)
**Sensitivity:** Restricted internal (014 §10). It names tables, columns, policies and one service scope. It names no shop, no person, no address and no secret value of any kind.
**Supersedes:** nothing. It **discharges 056 §11 R9 FOR `app_user`** — the five credential tables keep their exemption on new and separate grounds (§4), so R9 is narrowed rather than closed — and it **discharges 060 §11 R5 in full**. It retires the `app_user` row of 056 §7's *the person* class. It amends 056 and 060 by change-log rows only; no ruling in either moves.
**Inputs:** **056 v1.3.0 §4, §5, §5.0, §6.1, §6.2, §7, §10 I8, §11 R1/R5/R9, §13** · **060 v1.1.2 §1, §3.1–§3.5, §5.3, §11 R5** · **048 v1.6.x §4.1, §6.1, §6.4, §7.1, §7.2, §9.1, §9.3, R8, R19, R20** · **058 §3(c)** · **054 §3.4, §8** · **034 §2.5, §2.6, §2.7, §3.3** · **041 §2.1, §9.2** · **042 §5.1, §5.3(b)** · **044 v1.1.0 §2 A1, §4 A1, §9** · **022 P3** · **019 T24, T35(b), T35(c)** · `migrations/019`, `migrations/029`, `migrations/036`, `src/db/{rowLevelSecurity,tenantContext,appendOnlyTables,appRoleGrants}.ts`, `src/services/roleSeparation.ts`, `src/services/auth/{api,people,memberships,credentials,invitations}.ts`, `src/identity/accessors.ts`, `scripts/architectureRules.ts` · CLAUDE.md locked decision 4.

---

## Change log

**Version convention** (006 `:6`): a **minor** bump means the content of a decision changed; a **patch** means a statement of fact was repaired with no decision changing.

| Version | Date | What changed | Who |
|---|---|---|---|
| **1.1.1** | **2026-09-06** | **A PATCH — one statement of fact repaired and one invariant restated; no decision moves.** The re-verification at `ba113ab` reproduced a hole in the boot assertion this bead extended: it asked `has_table_privilege`, which answers about the **table-level grant alone** — so after `GRANT UPDATE (email, display_name, status) ON app_user TO longbox_app` it answered FALSE, the check passed, and a tenant-context UPDATE returned `UPDATE 1`. **A column grant is a grant.** All three privilege classes now ask `has_any_column_privilege` for `SELECT`, `INSERT` and `UPDATE`, which SUBSUMES the table-level answer, so the widening closes the hole with no second question to keep in step — **`DELETE` keeps the table-level function, and that is not an oversight**: PostgreSQL has no column-level DELETE, so `has_any_column_privilege` rejects the word outright and the table-level answer is the complete one — and it applies to `"none"` and `"insert-only"` as well as to this bead's `"read-append"`, because an insert-only table's SELECT and a no-grant table's INSERT are as reachable one column at a time as an UPDATE is. **I5 is restated to say COLUMN grants explicitly**, §7 R8 records what the class of hole was, and a fixture grants the three columns, proves the UPDATE really succeeds, and watches the boot refuse. Two smaller repairs ride with it: the R-D reorder is now PINNED by an assertion that a refused invitation issues no `INSERT INTO app_user` (0 of 12 statements), rather than resting on the call order being read correctly; and I12's plan case reads `SELECT id FROM app_user` UNFILTERED, because binding a SHOP id to `app_user.id` planned a probe over an empty result and the read that matters is the one a forgotten predicate produces. **No ruling, residual owner or threshold changes**, and §5's two defects are unchanged — this is a third, in the same check, found by the same discipline of running it rather than reading it. | Re-verification at `ba113ab` → `longbox-security-tenancy-builder` |
| **1.1.0** | **2026-09-06** | **MINOR — three findings ADD ENFORCEMENT that this bead shipped without, and one of them makes a sentence TRUE that was false.** **(F1, HIGH; the invariant review's BLOCK)** *"the running server can admit a person and can never rename, suspend or deactivate one"* was **false outside the admission scope**: `tenant_isolation` is `FOR ALL` and the application role held table-level DML, so under an ordinary tenant context one statement rewrote any co-worker's display name, status or **login identifier** — including a person shared with another shop, which is the **first cross-tenant WRITE effect** in this design. The policy cannot narrow it (the row is one the shop legitimately sees); the GRANT can. `app_user` moves to a SIXTH privilege class, **`appGrant: "read-append"`** — `SELECT, INSERT`, no UPDATE, no DELETE — with a boot-assertion branch and four refusal cases. **(F2 = K3, HIGH)** the boot check *could not see a relaxed policy*: **both** normalisers stripped parentheses, so this bead's own predicate with ONE pair of brackets removed compared EQUAL and booted green while returning every person in the estate. There is now **ONE comparison, in TypeScript, over `policyTokens()`** — a DEPTH-ANNOTATED token sequence — the SQL half is deleted, and every declared predicate is written in the deparser's shape (§5). **(F3)** the exempt tables were never asked whether they are exempt IN THE DATABASE; a branch now refuses a boot on any policy or `relrowsecurity` over a declared exemption, which is what turns §4's *a policy here would be HARMFUL* from an argument into a control. **(F4)** `mayGrantRole` ran AFTER the admission, so an authorization refusal left a person row behind; it is hoisted, and §6 stops calling what remains *inert*. **(F5)** the person-join exemptions now declare the PROJECTION they are exempt for. **(F6)** §3.1 states that the policy is blind to `scope_kind` and `role`, and why. **(K2)** the liveness triple is no longer six hand copies: `migrations/036` creates `membership_is_live(membership)` and all six readers call it. **(K6)** the plan assertion is POSITIVE and runs at scale — and the invariant review corrected what it asserts: the EXISTS is a **hashed SubPlan over `membership_shop_idx`**, once per query, not a per-row probe of the composite index. **(K1, K5)** §6 and §4 gain the sentences they were missing. Plus the gate audit's five fact repairs, an `after-035` schema fixture, and §8/§10 as the ruling asked. | Cannon + invariant review + gate audit → `longbox-security-tenancy-builder` |
| 1.0.0 | 2026-09-06 | Initial record. **Status PROPOSED, the ratification section unsigned, §2 builder-drafted and labelled.** Four decisions: `app_user` is policied by a membership-EXISTS predicate (§3.1); the admission that predicate cannot serve is a DECLARED SCOPE and not a hole (§3.2); `upsertPerson` stops using `ON CONFLICT DO UPDATE`, which is what keeps the scope's privileges to SELECT and INSERT (§3.3); and the seven remaining person-scoped tables each keep their exemption **on their own ground**, re-argued rather than inherited (§4). One defect found in the boundary this bead extends (§5). | `longbox-security-tenancy-builder` |

---

## 0. Evidence posture

Per 018 A1/A3. Every claim about the tree is REPRODUCED against the branch head unless marked otherwise; every claim about the DATABASE is reproduced against `postgres:16` in the integration lane, which is the only place a policy's real behaviour can be observed. Nothing here is asserted on the strength of having read a file — 029 v1.0.0's gate-audit blocker B1 is the governing lesson, and §5 below is what happens when a claim is checked instead.

---

## 1. What exists today, and the sentence this bead is answering

056 §11 **R9**, verbatim:

> **R9. The person tables are not policied, and the reason is a transaction rather than a principle.** `app_user`, `user_authenticator` and its retirement, `recovery_code` and its use carry no `shop_id` and no policy (§7). A membership-EXISTS policy is expressible — §7 uses that exact shape elsewhere — but `grantInvitation` writes a membership and reads the person in ONE transaction, so a newcomer would be refused during the act of admitting them. What bounds them meanwhile is the module graph and every read being by the authenticated person's own id or by a digest. **E03-D21** (`longbox-e5b.3.31`) owns it […]. Until it lands the honest statement is that this class is bounded by code, not by the database.

060 §11 **R5** carries the same residual one layer up: *"`app_user` still carries no tenant policy (056 §11 R9). The module graph, this accessor and every read being by the authenticated person's own id or by a digest are what bound it. Unchanged by this bead, and narrowed by it: there is now one door instead of five statements."*

**Both are true statements about the head this branch was cut from, and both stop being true here.**

REPRODUCED against `009d617` (`main`, 2026-09-06 — the head this branch is rebased onto; the merge SHA at close supersedes it as the pin every closing artifact cites).

---

## 2. The two-lens cannon — **DISPATCHED**

Convened by the session on 2026-09-06 against PR #99 head `518b076`. Both statements are reproduced **verbatim and unedited**; v1.0.0's builder drafts are superseded rather than kept beside them, and §10 records what they got wrong.

### `security-auditor` — **ACCEPT-WITH-CHANGES**

> The security lens accepts putting `app_user` behind a membership-EXISTS policy and accepts `person-admission` as a declared eighth scope: the predicate is character-faithful to the membership reader, a revoked grant genuinely stops answering, a future-dated one never starts, the scope reaches one table and holds SELECT and INSERT and nothing else, and refusing `WITH CHECK (true)` and the mid-transaction tenant switch were both the right calls. It does not accept two of the record's own sentences. First, "the running server can admit a person and can never rename, suspend or deactivate one" is false outside the admission scope: `tenant_isolation` is `FOR ALL`, the application role holds UPDATE on `app_user`, and under an ordinary tenant context a single statement rewrites any co-worker's display name, status, or login email — including a person shared with another shop, which is the first cross-tenant write effect in this design and is the exact shape of the forgotten predicate the boundary exists to stop. Second, the boot assertion that is supposed to catch a relaxed policy cannot see one: because both normalisers strip parentheses, a predicate weakened only by removing the grouping around this bead's own `effective_until` disjunction is byte-identical to the declared text, boots green, and returns every person in the estate to any shop holding one time-bounded grant. A comparison that erases operator precedence is not a boundary check, and neither is an inventory that cannot see a policy on an exempt table — which is where the record's strongest argument, that a filter over `user_authenticator` would turn a misconfiguration into an unfalsifiable replay refusal, currently rests on nobody having written one. Fix the claim or the grant, fix the normaliser, add the exempt-table branch, and stop calling an orphaned person row inert when the first shop to type an address owns that person's name in every other shop forever.

### `martin-kleppmann-reviewer` — **ACCEPT-WITH-CHANGES**

> The membership-EXISTS policy on `app_user` is the correct invariant — one join, no duplicated tenant column, and the liveness predicate is provably (by grep, not by claim) the same text the application already uses in five places — and the declared `person-admission` scope correctly resolves the one moment a person must be reached before any grant names them, without reopening 056 §3's rule that a transaction has exactly one tenant for its whole life; I would have rejected the mid-transaction-context alternative for the identical reason the builder did. My disagreement is narrower and lives entirely in §5: the boot assertion's fix for the wrapped-predicate bug (stripping parentheses in addition to whitespace) resolves the false-positive it was built to catch while reopening a false-negative the record does not name — two predicates that differ only in how they associate AND/OR across a parenthesis boundary normalise to an identical string, and the assertion's whole purpose is to detect exactly that kind of relaxation. This is not a reason to block the merge, because no predicate in today's schema exercises the collision, but it is a reason not to consider §5's finding closed by its own fix, and I would ask that the smallest sound repair — comparing two predicates as Postgres's own deparser renders them, rather than as two independently hand-rolled string-strippers agree — be filed and prioritized ahead of the next `TENANT_PREDICATES` entry, not after it.

---

## 3. Decision

### 3.1 `app_user` is POLICIED, on a live membership one join away

> **`EXISTS (SELECT 1 FROM membership m WHERE m.app_user_id = app_user.id AND m.shop_id = current_shop_id() AND <the liveness triple>)`, on both halves of `tenant_isolation`.**

**056's first reason for declining this was wrong and its own §7 says so.** v1.0.0 argued that a membership-EXISTS policy would encode *a person belongs to one shop*; the invariant review of E03-B04 rejected that, correctly, and §7 already uses the parent-EXISTS shape for `retention_hold_release`. The predicate admits **every** shop where the person holds a live grant and no other, which is exactly 034 §2.6's model.

**056's second reason — the same-transaction one — is HALF true, and the half that is false is the half it rested on.** R9 says *"`grantInvitation` writes a membership and reads the person in ONE transaction, so a newcomer would be refused during the act of admitting them."* Reproduced against the tree: `api.ts` calls `grantInvitation(tx, …)` — which INSERTs the membership — and **then** `resolvePersonByKey(tx, …)`. The row the policy looks for is already there when it looks, and the redemption path needed no change at all. What R9 described is a hazard the code it was written about does not have.

**What is true is that ISSUANCE has no grant to point at**, and that is §3.2.

**The liveness predicate is not a copy of `memberships.ts`'s — it is the SAME FUNCTION** (K2). Four copies of the triple lived in `memberships.ts` and a fifth in the roster; writing a sixth here, even character-faithfully, would have made the BOUNDARY a second definition of *works here*, and two definitions drift the first time either is corrected. `migrations/036` creates `membership_is_live(membership)`; all six readers call it, and the lane asserts both directions — every reader calls the function, and no reader still spells the triple. `membership_revocation` sits inside the `NOT EXISTS` and is itself policied — 056 §6.1's trap one table over, where a guard expressed as an ABSENCE over an invisible table **passes** and a revoked grant keeps answering. Under an ordinary tenant context both tables are visible, and the lane asserts the revocation actually bites.

**It is deliberately blind to `scope_kind` and to `role`** (F6). A location-scoped grant and a `support_break_glass` grant both admit the person to the shop's roster, because row-level security is the TENANT boundary and 054 is the location-and-permission boundary — a policy that narrowed by location would be a second authorization system living in SQL, which 056 §13 refused once already. Break-glass being VISIBLE is the correct direction for 022 P7: the roster query excludes that role itself, and a holder who could not be resolved to a name at all would be the invisible super-admin P7 forbids.

**The tenant is a join and never a column.** A `shop_id` on `app_user` would make a person who works at two shops two people with two passwords (034 §2.6). **What it costs was reproduced, and the first guess was wrong** (the invariant review). The guess was that the two equality quals would drive `membership_user_shop_idx`. What the planner does is better: it turns the correlated `EXISTS` into a **hashed SubPlan**, building the set of people who work at `current_shop_id()` ONCE PER QUERY through a bitmap index scan on **`membership_shop_idx`**, with `membership_is_live(m.*)` as a filter inside that single scan. That is 056 I8's *the policy folds into a one-time filter* in its strongest form. Both indexes were created by `019` with the table, so **no index is built here and no 044 §9 `-- index lock:` header is owed** — checked by `pnpm migrate --dry-run` rather than assumed.

### 3.2 The admission is a DECLARED SCOPE, not a hole

> **`person-admission` — an eighth member of 056 §5's closed union. It may `SELECT` `app_user` and may `INSERT` a row whose `status = 'active'`. It may do nothing else, to that table or to any other.**

An invitation NAMES its addressee before any code is minted (048 §7.1) — which is what stops a code read aloud across a counter from becoming an account somebody else chose the name for — so `upsertPerson` runs for a person who may hold no grant anywhere. Worse for a policy: the address may already belong to somebody who works at **another** shop, whose row this shop must find and may not read.

**Three shapes were available and two are refused.**

- **`WITH CHECK (true)` for the INSERT.** Refused. It is the shape 056 §5.0 forbids for every other service write (*"never `true`"*), and it does not even solve the problem: the conflicting-address case needs a READ, and a permissive INSERT check does not grant one.
- **A context that CHANGES inside the request transaction.** Refused, and this is the one worth writing down. It would preserve atomicity — which §6's cost is the price of not having — but it would make *"which tenant was this transaction about"* a question with two answers. 056 §3 makes the tenant one value, set once, travelling with `BEGIN`, taken from the session; a mid-transaction switch is a second mechanism with the same name, and `pnpm arch`'s exact call-site counts would have to learn a new kind of entry to see it.
- **A declared scope in a transaction of its own.** Taken. It reuses the machinery 056 §5.0 already built — a `service_context` policy `FOR SELECT` over the scopes the table names, and a `service_write` policy `FOR INSERT` whose check is the scope list AND a condition about the row — with no new policy name, no new emitter shape and no new boot-assertion column.

**The row condition is `status = 'active'`, and it is not decoration.** The admission scope may create an ACTIVE person and nothing else.

⚠ **BUT THE SCOPE WAS NEVER WHAT MADE THE SENTENCE TRUE, AND v1.0.0 CLAIMED IT WAS** (security lens F1, and the invariant review's BLOCK). v1.0.0 read: *"the running server can admit a person and can never rename, suspend or deactivate one."* That was **false outside the admission scope**. `tenant_isolation` is `FOR ALL`, and `app_user` was an append-only EXEMPTION — which is an exemption from the TRIGGER and was silently also a table-level DML **grant**. So under an ORDINARY tenant context, one statement rewrote any co-worker's display name, status or **login identifier**, on a person who may be shared with another shop. That is the **first cross-tenant write effect** in the tenant design, and it is exactly the forgotten-predicate shape the boundary exists to stop.

**The policy cannot narrow it and only the GRANT can.** The row being rewritten is a person this shop legitimately sees, so no tenant predicate refuses the statement. `app_user` therefore moves to a SIXTH privilege class — **`appGrant: "read-append"`**: `SELECT, INSERT`, no `UPDATE`, no `DELETE`. Nothing in `src/` or `scripts/` updates or deletes a person, so nothing breaks; correcting a person's row becomes a schema-owner act, enforced rather than conventional, which is the same property 056 §4 gives `shop`. The boot assertion refuses a port when the serving role holds either privilege — the third privilege class to join that check, after 058 F2's `"none"` and 060 F2's `"insert-only"`, and for the same reason each time: **a grant plan is re-applied on every migrate, and a hand-run `GRANT` between two runs is drift nothing else sees.** ⚠ **And it asks about COLUMN grants, not only table-level ones** (v1.1.1): the re-verification reproduced `GRANT UPDATE (email, display_name, status) ON app_user` passing the check while the UPDATE it enabled returned `UPDATE 1`. A column grant is a grant; all three classes now ask `has_any_column_privilege` for the three privileges Postgres can grant per column, and keep the table-level function for `DELETE`, which it cannot.

**`second-factor` also joins `app_user`'s read scopes, and that is a repair rather than a widening.** `findPersonIdByEmail` is the FIRST statement of an unauthenticated sign-in (057 §4.5): no shop is known, so no membership can be asked about. It is the same shape as a cookie's digest lookup, in a scope that already existed for the person's other three tables.

**The CLIs are unaffected and it is worth saying why**: `pnpm register-shop` and `pnpm issue-invitation` run as the SCHEMA OWNER, which bypasses every policy (056 §4). They enter no scope and none is declared for them.

### 3.3 `upsertPerson` stops using `ON CONFLICT … DO UPDATE`, and that is the security half

The statement was `ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email` — a no-op UPDATE whose only job was to make `RETURNING id` produce a row on the conflicting path. **Under row-level security an `ON CONFLICT DO UPDATE` is an UPDATE**: it needs an UPDATE policy whose `USING` can see the existing row. Keeping it would have meant granting the admission scope the right to update **any** person's row, cross-tenant, including their login identifier — a strictly worse capability than the one this bead exists to add.

So: `DO NOTHING`, and a second statement that reads the id back. Three consequences, all of them stated:

1. **The scope holds `SELECT` and `INSERT` and nothing more**, which is what makes §3.2's sentence about renaming true.
2. **The read is a second STATEMENT and not a CTE.** A `WITH ins AS (INSERT … DO NOTHING RETURNING id) … SELECT … WHERE NOT EXISTS (SELECT 1 FROM ins)` evaluates both halves against ONE snapshot, so a row another transaction commits in between is invisible to the fallback and the statement returns nothing at all. Two statements in READ COMMITTED take two snapshots — **and the first statement is what makes the second one late enough**: `ON CONFLICT DO NOTHING` WAITS on an in-flight duplicate insert until that transaction commits or aborts, so by the time the read runs the row it collided with is either committed and visible or gone.
3. **It is a SECOND declared `pnpm arch` person-join exemption**, and the list's shortness is the control (022 P3). Both rows are the same statement — `SELECT u.id … WHERE u.email = lower($1)` — projecting an id alone from a value the caller supplied, resolving nothing about a person the caller did not already name. They are **not** merged into one function: one is reached by anybody with a socket and the other only by a holder of `membership.invite` in a privileged session, and a shared code path would put those two callers on one line. Routing either through `src/identity/`'s accessor is refused for 060 §5.3's reason and, for this one, for a second: it is a WRITE path, and 060 §1 excludes writes because a write carries a name INTO the database that the caller already holds.

### 3.4 The display name is still not overwritten — now by construction

034 §2.5 makes a display name the person's own, and a second invitation for an existing address must not let the inviter rename somebody who already works somewhere. That used to be true because of a carefully chosen `SET` clause. It is now true because there is no `SET` clause at all.

---

## 4. The other person-scoped tables: each decided, none inherited

056 §7's *the person* class held seven more tables whose reason was, in substance, *same as `app_user`*. **A reason that points at a row which has moved is a reason nobody has checked**, so each is re-decided here. All seven stay exempt, and none of them stays for `app_user`'s old reason.

| Table | Decision | Ground, on its own |
|---|---|---|
| `user_credential` | **Exempt** | (a) It holds no attribute of a person — one argon2id digest over `password ‖ pepper`, so a cross-tenant read returns something that opens nothing without a value this database does not hold. (b) Every application-role path to it is INSIDE the `second-factor` scope, where a tenant predicate is vacuous by construction. A policy would be in force on no path the running server takes — **decoration on a boundary, which is worse than a declared absence, because it makes the boundary look denser than it is.** |
| `user_authenticator` | **Exempt** | Everything above, plus the decisive one: 048 **R19** consumes a TOTP step exactly once by `UPDATE … WHERE last_used_step < $2`, and **the affected-row count IS the authorization**. A policy over that statement converts any misconfiguration into a zero-row UPDATE, which this system reads as *this code was already used* — a refusal indistinguishable from a replay, on the path a person uses to get in. **A row filter does not belong over a statement whose row count is a verdict.** The sealed secret is additionally AEAD-bound to the row's own id, so a row read cross-tenant is not a usable factor. |
| `user_authenticator_retirement` | **Exempt** | The ending fact for the row above, appended inside the same scope. |
| `recovery_code` | **Exempt** | `user_credential`'s two grounds. Single use is `UNIQUE (code_id)` on the use row — a constraint the database decides, not a row a policy filters. |
| `recovery_code_use` | **Exempt** | The same. |
| `app_user_origin` | **Exempt, and it must NOT move** | 058 §3(c): the app role holds **no privilege at all** (`appGrant: "none"`), asserted at boot. And a membership-EXISTS policy is exactly a **per-tenant answer**, which is what 019 T35(c) must not get — the session worth finding is the one at a shop the person holds nothing at, so a tenant-keyed policy would hide precisely the row the reconciliation exists to find. |
| `app_user_origin_retirement` | **Exempt** | The ending fact for the row above; `appGrant: "none"` for the same reason. |

**The shape of the answer is worth naming, and it is THREE groundings rather than one** (the consistency lens's K5 — a per-table table with a summary that flattened it into a single reason would be a table nobody reads twice):

1. **Vacuous under a scope.** `user_credential`, `recovery_code`, `recovery_code_use` and `user_authenticator_retirement` are reached by the application only inside `second-factor`, where a tenant predicate matches nothing by construction — so a policy would be in force on no path the running server takes.
2. **Harmful.** `user_authenticator` alone: 048 R19 makes an affected-row count the authorization, and a row filter over that statement converts a misconfiguration into a refusal indistinguishable from a replay. This is the only row where a policy would be worse than none, and it is now ENFORCED rather than argued — the boot assertion refuses a port on any policy over a declared exemption (§5).
3. **The wrong question.** `app_user_origin` and its retirement need an answer that is the SAME at every shop, because 019 T35(c) looks for the session at a shop the person holds nothing at. A tenant-keyed policy is a per-tenant answer, which would hide exactly that row.

`app_user` moved because none of the three applies to it: it holds a person's ATTRIBUTES, it has real readers under an ordinary tenant context, and the answer it needs IS per-tenant.

---

## 5. Two defects found in the boundary this bead extends, and the second one is the boundary

056 F2 rebuilt `assertTenantIsolationOrThrow` as a SET comparison: every policy that EXISTS against every policy the design EMITS, by table, name, command and both predicates. That comparison normalised both sides **twice, in two languages** — `normalisePredicate()` in TypeScript, and four `replace()` calls inside `ISOLATION_SQL`. Both defects below are that duplication, found from opposite directions.

### 5.1 A FALSE POSITIVE, found while building this bead

The TypeScript half stripped every whitespace character; the SQL half stripped the SPACE character, the two parentheses and `::text`, and **no other whitespace**. The two agreed on every predicate that had ever existed in this schema, because Postgres deparses a short one onto a single line — and disagreed the moment one was long enough for the deparser to WRAP it, which `app_user`'s `EXISTS`-over-membership is. **Reproduced:** `app_user:tenant_isolation ALL` was reported ALTERED and the server refused to bind a port, on a policy byte-identical to the declared one.

It **failed CLOSED**, which is the direction to fail in, and it was still wrong: a correct deployment would not have started.

*(v1.0.0 described the SQL half as stripping "the SPACE character with four `replace()` calls and nothing else". That was wrong by three: the calls also removed both parentheses and the cast. The divergence was over non-space WHITESPACE only, and the sentence is repaired here rather than left as a tidy story — the gate audit's B5.)*

### 5.2 A FALSE NEGATIVE, found by the cannon — and this one is the finding

**Both** normalisers deleted parentheses. Deleting a parenthesis deletes operator precedence, and the security lens reproduced what that costs on this bead's own policy: take the declared predicate and remove ONE pair of brackets, the grouping around

> `AND (m.effective_until IS NULL OR m.effective_until > now())`

and the conjunction becomes `(… AND … IS NULL) OR (… > now())`. Both string-strippers normalise the relaxed text to the declared text **character for character**. It boots green. And it is not a theoretical relaxation: the `OR` breaks the correlation to `app_user.id` as well as the conjunction, so **one time-bounded grant anywhere in the reader's own shop makes the `EXISTS` true for every person in the estate** — and every break-glass grant is time-bounded by 034 §2.7's CHECK. *A comparison that erases operator precedence is not a boundary check.*

**The ruling: ONE comparison, in ONE language.** The SQL normalisation is DELETED; `LIVE_POLICIES_SQL` fetches `qual` and `with_check` RAW and judges nothing. `policyTokens()` is the only rule, and both sides go through it: each token is tagged with the parenthesis DEPTH it sits at, whitespace is irrelevant, `::text` is dropped, and two predicates match only when every token appears at the same nesting level in the same order.

**The cost, stated plainly, because it is a real one.** Postgres stores a parse tree and re-renders it FULLY PARENTHESISED, so depth only compares if both sides are shaped alike — which means **every declared predicate in `src/db/rowLevelSecurity.ts` is now written in the deparser's shape**. That is hand-kept, and what stops it going stale is that the integration lane compares every LIVE policy against every DECLARED one: a mis-shaped declaration fails the lane and the boot on the first run, loudly, rather than drifting.

**The smallest sound repair is the consistency lens's and it is FILED, not built** — §8 A3, PROPOSED alias **E03-D32** (`longbox-e5b.3.42`). Comparing both sides as Postgres's own deparser renders them removes the hand-shaping entirely; it needs a round trip at boot on a connection that may not hold `CREATE POLICY`, which is a decision about the boot path rather than an edit to a function, and the lens asked for it *"ahead of the next `TENANT_PREDICATES` entry, not after it"*. That priority is recorded in §10 as adopted.

### 5.3 And an inventory that could not see a policy where there should be none

The same section of the same check had a third hole, and it is the security lens's F3: nothing asked whether a table this design declares EXEMPT is exempt **in the database**. §4's strongest argument — that a policy over `user_authenticator` would be HARMFUL — rested entirely on nobody having written one. A branch now reports any declared exemption carrying `relrowsecurity` or a policy of any kind, as its own array, because its remedy is the opposite of every other one here: DROP the policy, do not add one. The fixture plants `USING (false)` on `user_credential` and watches the boot refuse.

---

## 6. What this costs, stated rather than argued away

**An invitation refused after the admission leaves an `app_user` row behind — and v1.0.0 called it *inert*, which the security lens refused.** The admission commits in its own transaction, before `runIdempotent`'s.

**The largest class of that is GONE (F4).** `mayGrantRole` used to be reached inside `issueInvitation`, inside the idempotent transaction, which is *after* the person is committed — so an AUTHORIZATION REFUSAL left a side effect. An authorization refusal that leaves a side effect behind is the wrong shape whatever the side effect is. The gate is extracted (`mayIssueInvitation`) and the route calls it FIRST, on its own transaction; a manager refused for naming an owner now creates no row at all. The ruling on the cannon's question is therefore: **moved before — and the CEILING still cannot precede the idempotency row**, because the outstanding-invitation count is read inside the request transaction that 042 §5.3(b) opens with the idempotency INSERT, and hoisting it would be reading a count outside the transaction that enforces it.

**What remains, and why it is not inert.** Two paths still produce an orphan: the shop's per-shop ceiling, and any rollback of the request transaction. The row holds an address and a display name the caller supplied, and it reaches nothing — every route is behind a session, every session needs a credential or a PIN under a membership, and this row has no membership anywhere. But *reaches nothing* is not *costs nothing*, and the lens named the cost precisely: **the first shop to type an address owns that person's `display_name` estate-wide.** `upsertPerson` never overwrites an existing display name (§3.4), so a second shop inviting the same person inherits whatever the first one typed, forever, at every shop.

**And a replay makes a second one.** `runIdempotent` recognises a replay INSIDE the request transaction, so a retried key reaches the admission again — harmless when the address is the same, because the upsert is idempotent on it. **A retry that reuses the key with a DIFFERENT email mints a second person** before `runIdempotent` refuses the mismatch. R-D's reordering does not change that: the rank gate passes on both attempts.

**What bounds it, honestly.** The route's `ordinary` rate token bounds the RATE at which a holder of `membership.invite` can do this; nothing bounds the TOTAL, because the invitation ceiling sits behind the idempotency row. One row is one ADMISSION, never one invitation — the same pre-volume rule 054 §4.5 hands E03-B09 for `authorization_decision`, and §7 R3 routes it there explicitly.

**One row an audit must not misread** (the consistency lens's K1): an orphaned admission is **not a person who ever worked at the shop that typed the address**. Every count that means *worked here* is keyed on `membership` — the roster (`resolveShopRoster`), `membershipsAt`, `liveMembershipShopIds`, `liveRolesOf`, and 019 T35(c)'s reconciliation, which joins sessions to grants. None of them can see an orphan, and none of them should be changed to.

**The alternative was refused in §3.2 and the trade is the honest one**: a transaction whose tenant changes half way through buys atomicity by making the system's central security value ambiguous.

**On the hot path: nothing.** The counter flow reaches `app_user` through three reads that all run under an ordinary tenant context, for a person who holds a live grant at that shop by construction. The policy is a hashed SubPlan over `membership_shop_idx`, evaluated once per query (§3.1).

---

## 7. Residual risk

| # | Residual | Owner |
|---|---|---|
| **R1** | **The application role can still set the context to any value it likes.** 056 R1 is unchanged and this bead does not narrow it: the policy defends a FORGOTTEN PREDICATE — a report that joins `app_user` one table too many, a generated query — and not a compromised process. No artifact, 021 C-row or partner-facing sentence may describe it otherwise. | accepted; 056 R1 |
| **R2** | **`person-admission` is an EIGHTH place a statement sees more than one shop** (056 R5, whose count moves from seven to eight). Inside it a `SELECT` from `app_user` spans tenants by construction, which is the entire point. Bounded by 056 §5.2's four mechanisms: one call site held EXACT by `pnpm arch`, a `FOR SELECT` policy naming only the scopes the table declares, an INSERT check about the row, and a diff for every one of those. | accepted; declared here |
| **R3** | **A refused invitation can still leave an orphaned person row, and it is NOT inert** (§6). The AUTHORIZATION class is gone — the rank gate moved before the admission — but the shop's ceiling and any rollback still produce one, **and an idempotency REPLAY that reuses a key with a DIFFERENT email mints a second** (the reordering does not change that: the rank gate passes on both attempts). The cost is that **the first shop to type an address owns that person's display name estate-wide**, and the route's `ordinary` token bounds the RATE while nothing bounds the TOTAL — the invitation ceiling sits behind the idempotency row and cannot be hoisted in front of it. One row is one ADMISSION, never one invitation, which is 054 §4.5's pre-volume rule one table over. | **E03-B09 `longbox-e5b.3.9`** |
| **R4** | **The seven exempt tables are still bounded by code and not by the database** (§4) — now with three separate groundings rather than one delegated reason, which is the improvement, and still not a boundary. `user_authenticator`'s ground in particular is a reason a policy would be HARMFUL rather than unnecessary. **What DID change is that the absence is now enforced**: §5.3's branch refuses a boot on any policy over a declared exemption, so the harm argument can no longer be quietly falsified by somebody adding one. | accepted; §4, enforced by §5.3 |
| **R5** | **A foreign key is still checked with RLS off** (056 R7/R11), so `membership.app_user_id` and `membership.granted_by` resolve a person the writer cannot read. That is what makes `grantInvitation` work at all, and it is the same mechanism R11 tracks on seven sibling edges. | **E03-D27 `longbox-e5b.3.37`** |
| **R6** | **The declared predicates are written in the DEPARSER'S SHAPE, by hand** (§5.2). There is now one normaliser rather than two, which is the repair the cannon asked for — but the declaration must be parenthesised the way Postgres re-renders it, and that shape is kept by a human. It cannot drift silently (the lane compares every live policy against every declared one, so a mis-shape fails the first run) and it can still be *tedious*, which is how a shortcut gets taken. Round-tripping the declaration through the deparser removes the hand work entirely, and the consistency lens asked for it **ahead of the next `TENANT_PREDICATES` entry, not after it**. | **PROPOSED alias E03-D32 `longbox-e5b.3.42`** — filed by this record, not created |
| **R8** | **A privilege check is only as wide as the question it asks.** `has_table_privilege` was blind to a COLUMN grant, and the boot assertion reported green while the application could UPDATE a co-worker's row three columns at a time. `has_any_column_privilege` closes that specific hole across all three classes — but the general shape does not go away: this check asks about four named privileges on a named list of tables, and anything reachable by a path it does not ask about is invisible to it. It cannot see a `SECURITY DEFINER` function (056 R6, unchanged), a rule, or a trigger owned by the schema owner. | accepted; 056 R6 owns the `SECURITY DEFINER` half |
| **R7** | **`policyTokens()` treats a string literal as opaque tokens split on whitespace**, so two predicates differing only inside a quoted string that contains a space compare as different token runs — which is the safe direction, and is still a shape nobody has exercised. No policy in this schema contains one today. | accepted; re-check the day one does |

---

## 8. Alternatives considered

| # | Alternative | Verdict |
|---|---|---|
| **A1** | **`WITH CHECK (true)` for the admission's INSERT.** | **Refused.** It is what 056 §5.0 forbids for every other service write, and it does not solve the problem: the conflicting-address case needs a READ, which a permissive INSERT check does not grant. |
| **A2** | **A tenant context that CHANGES inside the request transaction**, so the admission stays atomic with the invitation. | **Refused.** It buys atomicity by making *"which tenant was this transaction about"* a question with two answers — the property 056 §3 exists to keep single — and `pnpm arch`'s exact scope-entry counts would need a new kind of entry to see it. §6 states what refusing it costs instead. |
| **A3** | **Compare policy predicates as Postgres's own deparser renders BOTH sides**, by round-tripping the declaration through the database rather than hand-shaping it. | **Right, and NOT TAKEN HERE.** It is strictly stronger than §5.2's depth-token comparison and removes R6 outright. It is deferred because it needs a round trip at boot on a connection that may not hold `CREATE POLICY` — a decision about the boot path, not an edit to a function — and because taking it inside a bead that is already changing every policy would be the scope creep 056 §11 R7 was split to avoid. **PROPOSED alias E03-D32**, prioritised ahead of the next `TENANT_PREDICATES` entry as the lens asked. |
| **A4** | **Keep `ON CONFLICT … DO UPDATE` and give the admission scope an UPDATE policy.** | **Refused.** An `ON CONFLICT DO UPDATE` is an UPDATE to row-level security, so the scope would hold a cross-tenant right to rewrite any person's row, login identifier included — strictly worse than the capability this bead exists to add (§3.3). |
| **A5** | **Narrow the tenant policy on `app_user` to `FOR SELECT`**, leaving writes to the grant alone. | **Refused, and this is the one worth arguing.** It would look like it solved F1, and it would not: with no `WITH CHECK` an INSERT under an ordinary tenant context would be admitted by default, which is exactly the hole §3.2 refuses. `FOR ALL` plus a grant that withholds UPDATE and DELETE is narrower on both halves. |
| **A6** | **Policy the five credential tables anyway, for uniformity.** | **Refused per table in §4**, and one of the five is a refusal on HARM rather than on cost: a row filter over 048 R19's replay guard turns a misconfiguration into a refusal indistinguishable from a replay. Uniformity is not a reason to put a filter over a statement whose row count is a verdict. |

---

## 9. Invariants

| # | Invariant | Where it is asserted |
|---|---|---|
| **I1** | `app_user` has row-level security enabled and a `tenant_isolation` policy whose predicate, on BOTH halves, is the membership-EXISTS one — and `POLICIED_WITHOUT_SHOP_ID` is the single answer to *which shop-less tables are policied*, read by the plan, the boot assertion and the lane. | `tests/rls-plan.test.ts`; `tests/integration/rls-tenant-isolation.test.ts` |
| **I2** | A person with a live grant at shop A only is **zero rows** under every other shop's context, by primary key AND with no predicate at all; a person with grants at A and B is visible under both. | `rls-tenant-isolation.test.ts` (generated over four shops) |
| **I3** | **A revoked membership hides the person from that shop thereafter**, and leaves them visible at a shop they still work at; an expired grant stops admitting. | same file |
| **I4** | The admission scope may `SELECT` and `INSERT` `app_user`, its INSERT check refuses a non-`active` status, and no other scope may write it at all. | `rls-plan.test.ts` (shape); `rls-tenant-isolation.test.ts` (behaviour) |
| **I5** | **The application role holds `SELECT` and `INSERT` on `app_user` and nothing else**, so an UPDATE or a DELETE is refused by the GRANT under every context — and the boot assertion refuses a port if either privilege is held **at the TABLE or on ANY COLUMN**. | same file (four refusals, the privilege read directly, and TWO negative fixtures: a table-level `GRANT UPDATE`, and a column-level `GRANT UPDATE (email, display_name, status)` that used to pass the check while the UPDATE it enabled returned `UPDATE 1`) |
| **I6** | There is **ONE definition of a live grant** — `membership_is_live(membership)` — and six readers call it; no reader still spells the triple. | `rls-plan.test.ts`, in both directions, by grep over the tree and the migration |
| **I7** | The four identity-accessor reads return exactly what they returned before, against a real database. | `tests/integration/identity-access.test.ts`, unchanged by this bead |
| **I8** | **A policy relaxed only by REMOVING PARENTHESES fails the boot**, and the relaxation is proven real by a cross-tenant read that succeeds while it stands; a predicate the deparser WRAPS across lines still passes. | `rls-tenant-isolation.test.ts` (two cases) |
| **I9** | **A table declared exempt carries no policy and no `relrowsecurity`**, and a planted one refuses the boot. | same file (a `USING (false)` policy on `user_credential`) |
| **I10** | Every remaining person-scoped exemption states a ground that does not delegate to `app_user`'s. | `rls-plan.test.ts` |
| **I11** | The cross-tenant scopes are still an EXACT inventory: `person-admission` is named at exactly one site outside the declaration files, and the number of scope ENTRIES equals the sum of the per-scope counts. | `pnpm arch`; `tests/contract/architecture-gate.test.ts` |
| **I12** | The policy is a **hashed SubPlan over `membership_shop_idx`**, once per query, against a database holding hundreds of memberships across dozens of shops — never a sequential scan of `membership`. | `rls-tenant-isolation.test.ts` (a scaled fixture, after `ANALYZE`) |
| **I13** | A person-join exemption declares the PROJECTION it is exempt for, and a widened projection fails the gate. | `pnpm arch`; `tests/contract/architecture-gate.test.ts` |
| **I14** | A database restored from the schema at `035` — the last one before this boundary existed — is behind the boundary after `pnpm migrate`. | `tests/integration/prior-snapshot-upgrade.test.ts` (`after-035.sql`) |

---

## 10. Dissents and adopted-differently, preserved

**One position is adopted in a form the lens did not ask for**, and it is recorded here rather than smoothed over.

> **The consistency lens asked for the deparser round-trip** — *"the smallest sound repair … be filed and prioritized ahead of the next `TENANT_PREDICATES` entry, not after it"* — and what shipped is the DEPTH-TOKEN comparator instead, with the round trip filed as E03-D32.

The reasoning for the difference, and what it concedes: the lens is **right that the round trip is the smallest SOUND repair**, and §8 A3 says so. The depth-token comparator is sound against the relaxation the security lens reproduced (the fixture proves it), and it removes the two-normaliser problem the lens actually objected to — there is one rule now, not two. What it does NOT remove is the hand-kept shape (R6), which is a smaller version of the same class of defect: a human keeping two representations in step. The lens's priority is adopted verbatim — E03-D32 goes **ahead of** the next `TENANT_PREDICATES` entry, not after it — and this record does not claim §5 is closed by its own fix, which is the thing the lens asked most directly not to claim.

**What the builder's v1.0.0 drafts anticipated, measured honestly.** §2's superseded drafts guessed that the security lens would press on the admission scope's read surface and on §6's *inert*, and that the consistency lens would press on the duplicated liveness predicate and the two normalisers. **Two of six security findings and two of six consistency findings.** What neither draft came close to is the pair that mattered: that the record's own no-rename sentence was FALSE because of a GRANT rather than a policy (F1), and that erasing parentheses erases precedence (F2/K3). Both of those needed somebody to run the thing rather than read it.

---

## 11. Ratification

**UNSIGNED.** The two-lens cannon is dispatched and folded (§2, §10); the `longbox-invariant-reviewer` BLOCK and the `longbox-gate-auditor` NOT-READY are folded in the same pass, with nothing declined. What is owed before close is the **re-verification** of both at the folded head. The acting head signs at CLOSE, against the merge SHA.
