# Decision Record — User Identity, Sessions on a Shared Counter Phone, MFA for Privileged Roles, CSRF, Invitations and Recovery

**Version:** 1.0.0
**Status:** **PROPOSED.** §14 is **unsigned**. Nine questions are open in §13 and are put to the cannon named there. **Nothing in §2–§9 exists; nothing here is TESTED** — this record writes no DDL, no route, no cookie and no line of TypeScript.
**Bead:** E03-B02 `longbox-e5b.3.2` (epic LBOX-E03 `longbox-e5b.3`, gate **G2**, evidence class **TEST**, owner-role security, risk critical, phase P1-foundation, layer security) — see 000-docs/014 §8 row E03-B02
**Drafted:** 2026-09-04 by `longbox-security-tenancy-builder` · **Cannon:** recommended in §13 · **Audit:** `longbox-gate-auditor` before close · **Decision owner:** Jeremy Longshore (acting head of board under the 2026-09-03 delegation)
**Sensitivity:** Restricted internal (014 §10). It names live exposures by `file:line` and describes the shape of every credential this system will hold. It contains no secret value, no shop name and no person's name.
**Supersedes:** nothing. It **discharges** three deferrals made by ratified records: 034 §2.5's *"No password hash, no MFA secret, no session token, no invitation state. Those are **E03-B02's**"*; 034 §2.8's *"how a `device_credential` is issued, verified and rotated — and what a rotation does to an in-flight session — is **E03-B02's**"*; and 046 §12.3's *"It does not decide authentication, roles, sessions or MFA — E03-B02 and E03-B03."*
**Inputs:** 014 §8 rows E03-B01 through E03-B10 and E13-B02 · 015 alias map · **046 v1.1.1 in full, and E1–E3, E5, E12, E13, E18, E21–E23, E25, E27, §2.3, §6.2, §6.3, §7.2, §7.3, §9.1, §9.2, §11 I2/I4/I5/I7/I8, §13.0 line by line** · **034 v1.1.1 §2.5, §2.6, §2.7, §2.8, §2.13, §3.1, §3.2, §3.3, §3.4, §4.1, §4.2, §4.4, §5** · 041 v1.1.2 §2.3, §2.4, §3.1, §3.6, §9.2, §10 · 042 v1.2.0 §2.5, §3.1, §3.3, §3.4, §4.1, §4.2, §5.1, §8.1, §8.4 · 043 §3.2 · 040 A8 · 047 v1.1.2 §4.3, §5.1, §5.3 · 044 §2, §6, §7 · 019 v1.2.0 T24, T31, T33, T34, T35, §3.0, §5, §9.1 · 018 §2 A1/A3, §4 C2, §5 · 021 v1.3.0 B1, C6, C8, C10 · **022 v1.1.1 P1, P2, P3, P6, P7, P9** · 023 v1.0.1 §2, §3, §5 · 029 §2.1, §3.1, §12 · 038 v1.0.2 §2, §3, §5 · 039 §5 · `src/app.ts`, `src/routes/scanSessions.ts`, `src/services/sessionApi.ts`, `src/services/rateLimit.ts`, `src/providers/registry.ts`, `src/contracts/v1/routes.ts`, `src/contracts/v1/errors.ts`, `src/db.ts`, `src/services/idempotency.ts`, `public/app.js`, `migrations/001`–`014`, `.env.example` · CLAUDE.md locked decisions 2, 4, 5.

## Change log

**Version convention** (006 `:6`, as used by 029/030/034/036/037/040/041/042/043/046/047): a **minor** bump means the content of a decision changed; a **patch** means a statement of fact was repaired with no decision changing.

| Version | Date | What changed | Authority |
|---|---|---|---|
| 1.0.0 | 2026-09-04 | Initial draft. **Status PROPOSED, §14 unsigned**, nine questions open in §13. Eight decisions: three principals and no fourth, with 034's four roles kept and the bead's own three-role framing corrected (§2); **two sessions, not one** — a long-lived device session and a short operator session on top of it, both as append-only issuance facts with **no status column**, current-ness derived, and idle expiry enforced by rotation rather than by a mutable `last_seen_at` (§3); **staff hold a PIN that is worthless off an enrolled device, and never a password** (§3.5); TOTP as the required second factor for owner, manager and support, with passkeys deferred and the reason stated (§4); **no synchronizer CSRF token**, replaced by three mechanisms that already carry weight and each fail loudly (§5); the session as the **only** source of `shop_id`, a URL/session mismatch answered `SHOP_NOT_FOUND` rather than a forbidden code, and `GET /api/v1/shops` re-shaped into *my shops* — which retires 046's last `defect` row (§6); invitations and device enrollment as append-only single-use facts delivered **out of band by the owner**, because no email service exists in this repository and inventing one here would put an inbox at the root of a shop's catalog (§7); and recovery as owner-only, code-first, Longbox-operated only under the existing manual break-glass runbook (§8). **Corrects one framing inherited from the bead's own directives:** the brief names the roles as *owner / staff / longbox-support break-glass*; **034 §2.6 ratified four** — `owner`, `manager`, `operator`, `support_break_glass` — as a closed CHECK enum, and this record uses those four unchanged. `manager` is absent from the representative shop (034 §2.6, the 19% with a second storefront), which is why a three-role reading is natural and still wrong: a role that exists in the schema and not in the pilot is a role the pilot cannot silently drop. **Proposes one amend-by-a-row on a ratified record**: 034 §2.8's `device_credential.key_ref` (§7.4, §12.4). | `longbox-security-tenancy-builder` |

## 0. Evidence posture

Per 018 §2 A1/A3, and with the lesson 046 v1.1.0 learned at its own ratification — **a negative claim asserted from a command's silence rather than from the symbol it was meant to deny is the failure this section exists to prevent, and 046 committed it in the record that states the rule** (046 E26: `ls` is aliased to `eza` and `grep` to `rg` in this shell, and the pair returned exit 1 over a file that exists):

- **Every "today" claim in §1 is REPRODUCED at `07972fa`** — `main`, the E03-D01…D04 security commit (PR #65) — each carrying a `file:line` **or** the verbatim command that produced it **with its exit status**. **Every command in this record was run with `/usr/bin/grep`, never the `rg` alias**, precisely because of 046 E26.
- **Every negative claim names the symbols that must return nothing, and characterises the matches that are not the thing being denied.** This record's central negative — *there is no caller identity in this system* — is 046 E1's, re-checked five weeks of commits later and unchanged; the difference is that 046 asserted it to rank a gap and this record asserts it to design the thing that closes it.
- **The symbols that must return nothing at `07972fa`, and do.** No identity schema: `/usr/bin/grep -rnE 'CREATE TABLE.*(app_user|session_token|app_session|invitation|membership|device_credential|password|mfa_)' migrations` → **exit 1, zero lines**. No credential machinery of any kind: `/usr/bin/grep -rniE 'bcrypt|argon2|scrypt|passkey|webauthn|totp|otpauth|csrf|samesite|set-cookie|signCookie|@fastify/(cookie|session|secure-session|jwt)|jsonwebtoken' --include=*.ts --include=*.js --include=*.json src public tests scripts package.json` → **exit 1, zero lines** — so there is not only no implementation, there is **no dependency that could implement one**: `package.json:42-47` lists `@fastify/multipart`, `@fastify/static`, `fastify`, `pg` and `zod`, and nothing else server-side. No CORS: `/usr/bin/grep -rniE 'cors|access-control-allow' --include=*.ts --include=*.json src package.json` → **exit 1** (this is load-bearing for §5, not incidental). No mail or SMS transport: `/usr/bin/grep -rniE 'nodemailer|smtp|sendgrid|postmark|resend|mailgun|@aws-sdk/client-ses|twilio' --include=*.ts --include=*.json --include=*.js src scripts package.json .env.example` → **exit 1** (load-bearing for §7 and §8).
- **The three matches that are NOT authentication, printed rather than counted around.** `/usr/bin/grep -rniE '\bcookie\b|\blogin\b|\bsign in\b|\bmfa\b|req\.user|authenticate' --include=*.ts --include=*.js src public` returns **three lines, exit 0, and none is a mechanism**: `src/providers/registry.ts:57` is a comment explaining that a namespace must not be derived from *"a `shopId` from a URL path (046 §4 B1's unauthenticated segment)"*; `src/services/roleSeparation.ts:46` is a comment about the **database** role the pool authenticates as; `src/contracts/v1/routes.ts:54` is the allowlist reason string saying the shop-picker defect stands *"until an authenticated session exists"*. **Two of the three are notes written by beads that were waiting for this record.**
- **Everything in §2–§9 is ASSERTED.** No table, column, constraint, cookie, route, hook or migration exists as a result of this record. Every invariant in §11 names a test file that does not exist.
- **The infrastructure this record leans on has SHIPPED, and one piece of it is not merely available but already load-bearing** (046 K-5). `withTransaction` is at `src/db.ts:105`, and `runIdempotent` (`src/services/idempotency.ts:247`) wraps **every mutating request** in it — so the transaction a session read, a rotation and E03-B04's later `SET LOCAL` all need is the envelope every write already runs inside. The two database roles (E02-D06), `ENABLE ALWAYS` on every append-only trigger with a declared list in `src/db/appendOnlyTables.ts` (E02-D05), the request idempotency table (`migrations/009`), the single error envelope (`src/http/errors.ts`) and the architecture gate are all on `main`. **So no invariant in §11 is blocked on a missing helper.** What blocks them all is that the tables they assert about do not exist.
- **No percentage appears in this record that is not a quoted 019 threshold**, per 021 (`021:62`, on 018 A3 / 020 Q10). §4 and §9 touch T24, T33, T34 and T35 and quote them; they compute nothing.
- **No number in this record is a measurement.** Every lifetime, threshold, code count and backoff figure in §3, §4 and §9 is a **PROVISIONAL floor with its derivation stated and explicitly non-evidentiary**, in the sense 042 A3 established for the rate parameters and 047 §3.2 reused for the mint retry bound. **A session lifetime is a circuit breaker, not a claim about how long being wrong is acceptable** — and this record deliberately declines to quote an industry figure in its place, because a borrowed number is a manufactured measurement wearing a citation.
- **Adopting this record does not authenticate one request.** §1 stays REPRODUCED and everything else stays ASSERTED. In particular it does not retire the unauthenticated shop enumeration (`src/routes/scanSessions.ts:145`), which 046 carries as the tree's last `defect`-kind row and §6.4 is the design for — but not the closure of.

## 1. What exists today (REPRODUCED at `07972fa`)

| # | Claim | Evidence |
|---|---|---|
| **E1** | **There is no authentication, no session, no user identity and no authorization anywhere in the system, and no dependency that could provide one.** 046 E1 recorded this at `2242547`; it reproduces unchanged at `07972fa` **after** the four security commits of PR #65, which hardened credentials, the storefront path and the client render and touched the front door not at all. §0 carries the four greps and the three characterised matches. | §0; 046 E1; `package.json:42-47` |
| **E2** | **Twelve registered routes, every one anonymous, and the only two `onRequest` hooks do something else.** `src/app.ts:69` (`GET /healthz`), `:133`–`:134` (the two 308 aliases), `src/routes/scanSessions.ts:70, 76, 81, 97, 104, 111, 118, 125` (the eight shop-scoped routes) and `:145` (`GET /api/v1/shops`). **There is no `preHandler` anywhere in `src/`**; the two `onRequest` hooks are the correlation id (`src/http/errors.ts:99`) and the ordinary rate bucket (`src/app.ts:82-89`). **Nothing anywhere asks who the caller is.** | `/usr/bin/grep -rn 'preHandler\|onRequest' --include=*.ts src` — two hook registrations, both characterised |
| **E3** | **`GET /api/v1/shops` returns every shop in the database to any caller, and it is the tree's LAST `defect`-kind allowlist row.** `src/services/sessionApi.ts:137-140`: `SELECT id, name, slug FROM shop ORDER BY created_at` — no `WHERE`, no tenant, no caller. Registered **outside** the tenant plugin at `src/routes/scanSessions.ts:145`, whose own docstring says why: *"closing it means deciding who the caller IS, and there is no caller identity before E03."* Carried at `src/contracts/v1/routes.ts:46-57` with `closingBead: "E03-B02 / E03-B03 (authn, RBAC)"`. The phone client calls it unauthenticated on load (`public/app.js:158`). 019 T24: cross-tenant access = 0, **non-waivable**, `any → K1` (`019:111`). **This record is the first half of that named closing bead.** | `sessionApi.ts:137-140`; `routes/scanSessions.ts:144-146`; `contracts/v1/routes.ts:46-57`; `public/app.js:158`; `019:111` |
| **E4** | **The tenant is a path segment the caller types, and the code says so in a comment written by another bead.** `src/routes/scanSessions.ts:71` and every sibling parse `shopId` from `req.params`; `src/providers/registry.ts:57` refuses to derive a credential namespace from it, in as many words: *"the caller holds a `shopId` from a URL path (046 §4 B1's unauthenticated segment), and a namespace derived from a caller-supplied string would be a namespace the caller chooses."* **E03-D01 routed around the unauthenticated segment by reading the shop's slug from the row instead** (`registry.ts:62-64`). That is the correct fix for a credential namespace and it is not available to a tenant boundary, which has nothing else to read. | `routes/scanSessions.ts:71`; `registry.ts:53-64` |
| **E5** | **The rate bucket is keyed on that same unauthenticated segment, so 042 §8.1's rule is today a different rule.** `src/app.ts:82-89` takes the ordinary bucket on the tenant plugin's `onRequest` from `req.params.shopId`. The rule is *"per shop, never per IP"*; what runs is **per shop-id-string a caller chose**. 046 G-20 assigns the fix to E13-B02 *"after G-1"*. **§6.2 observes that it is not E13-B02's at all once a session exists: it is one line of ordering inside this record's hook.** | `app.ts:82-89`; 042 §8.1; 046 G-20 |
| **E6** | **`operator_id` and `actor_verified` are reserved on four tables, written by nothing, and the migration says exactly why.** `migrations/003_reserve_principle_slots.sql:44-51`: *"`operator_id` is NULLABLE and `actor_verified` defaults to FALSE precisely because pre-G2 rows are aggregate-only BY CONSTRUCTION… nothing written before E03-B02 (authn) + E03-B03 (RBAC) is attributable to a person… No row is ever backfilled to true."* The same pair is reserved on `scan_session_transition` (`010:81`) and `outbox` (`011:74`), each with a comment naming the missing FK target: *"`app_user` does not exist (034 §4.1)"* (`010:76`, `011:142`, `011:179`, `011:220`, `007:10`). **Five migrations carry a comment about a table this record is the design for.** | `003:44-51`, `:71`; `007:10`; `010:76`, `:81`; `011:74`, `:137`, `:142`, `:179`, `:220` |
| **E7** | **`created_by` and `confirmed_by` exist and have stopped being written.** `001_init.sql:67` (`created_by text NOT NULL DEFAULT 'employee'`); the create path no longer passes it (`src/services/scanSession.ts:35`), nor does the confirm path pass `confirmed_by` (`src/services/supersession.ts:144`). The drop is E02-D10's contract step (041 §10 row 5). **So the system currently attributes nothing to anybody, which is the correct state and not a gap** — 022 P3: *"Pre-G2 data is aggregate-only by construction, not by policy."* | `001_init.sql:67`; `scanSession.ts:35`; `supersession.ts:144`; `022:39` |
| **E8** | **No audited accessor module exists, and until this record there was nothing for it to gate.** 034 §3.3 requires that exactly one module — `identity` — may `SELECT` `operator_id`, `created_by` or `confirmed_by`. `ls src/` returns `consumers contracts db events http providers routes services app.ts config.ts db.ts server.ts` — **no `identity`**. 046 E23's finding is that the partial substitute is architectural and real (no code SELECTs those columns at all) **and that it "stops holding the moment `operator_id` gets a writer"**. **§6.3 is that moment**, which is why §9.4 puts `auth_attempt` behind the same accessor rather than inventing a second rule for it. | `034:427`; `ls src/`; 046 E23 |
| **E9** | **`shop.slug` is now shape-constrained, and the constraint is load-bearing for a namespace this record inherits.** `migrations/014_credential_namespace_and_host_allowlist.sql` adds the `LONGBOX_<SEGMENT>_<REST>` CHECK on `shop_credentials.key_ref` and the shop-binding rule inside `resolveKeyRef`, with the split stated at `014:18-37`: *"the DATABASE enforces the SHAPE… the RESOLVER enforces the SHOP BINDING… a two-table fact no CHECK constraint may express."* **That split is the precedent §3.6 and §9.2 reuse for session and PIN verification**, and it is this repository's own, four commits old. | `migrations/014:1-56` |
| **E10** | **The error registry has a not-found code for a shop, and adding a new code for "wrong tenant" would itself be an oracle.** `src/contracts/v1/errors.ts:84` `SHOP_NOT_FOUND` (*"no shop with that id"*, `:242`) and `:91` `SESSION_NOT_FOUND` (*"no scan session with that id in this shop"*, `:243`). There is **no** forbidden/unauthorized code in the registry: `/usr/bin/grep -n '^  [A-Z_]*:' src/contracts/v1/errors.ts` lists twenty-one codes and none of them is one. **§6.5 decides that this absence is kept on purpose.** | `errors.ts:59-217`, `:239-261` |
| **E11** | **The error path already emits no secret, no operator prose and nothing reflected from the request.** `src/http/errors.ts:44-71` maps everything unrecognised to `INTERNAL_ERROR` and **drops the thrown message**; `:119-121`'s 404 reflects nothing, with the reason stated at `:114-118`; `src/app.ts:45-48` redacts `authorization` and `x-api-key` from the logger. **This is a control this record inherits and must not weaken** — §9.3's constant-answer rule is the same discipline applied to a new class of failure. | `http/errors.ts:44-71`, `:106-121`; `app.ts:45-48` |
| **E12** | **The phone client has no login and no notion of a person; it has a `<select>` of every shop in the estate.** `public/app.js:41` (`let shopId = null`), `:158` (`fetch("/api/v1/shops")`), `:162-168` (populate the picker), `:172-173` (*"Pick a shop first."*), `:148` (every later call builds `/api/v1/shops/${shopId}${path}`). **The client's entire tenancy model is one module-scoped variable set from a dropdown.** | `public/app.js:41`, `:148`, `:158`, `:162-173` |
| **E13** | **Two mutating-request preconditions already exist and, unusually, both help.** Every mutating route requires an `Idempotency-Key` header (`src/routes/scanSessions.ts:39-46`, 042 §5.1) and every request body is parsed by a `.strict()` Zod schema (`:28-37`, `schemas.ts:88`). **§5's CSRF argument rests on these two facts plus the absence of CORS (§0), and on nothing else.** | `routes/scanSessions.ts:28-46`; `contracts/v1/schemas.ts:88`; §0 |

**What §1 adds up to.** Every attribution slot this system will ever need has been cut, commented and left empty by five separate migrations, each naming a table that does not exist. The credential namespace has a shape rule that refuses to trust the URL's `shopId`, written by a bead four commits ago that had to route around the front door because it could not fix it. The rate limiter, the tenant prefix, the idempotency key and the append-only triggers are all in place, correct, and keyed to or protecting a caller nobody has ever identified. **The system is a well-built machine with a hole where the operator's name goes, and every part of it is already shaped around that hole.**

**The through-line, and it is not 046's.** 046 was about the perimeter: it mapped thirteen boundaries and found that every guarantee the log won is handed at the front door to whoever asks. **This record is about the first principal.** It does not close a boundary — it creates the thing that boundaries can be drawn around. Until a request carries a name, `shop_id` is a string a caller typed (E4), a rate budget is a bucket a caller picks (E5), `operator_id` is a column with no writer (E6), the accessor module has nothing to gate (E8), and *"which shop is this"* is answered by a dropdown listing every shop in the estate (E3, E12). **E03-B02's job is not to add a login screen. It is to make one request in this system able to say who is asking, on a phone that three people share, without building the per-person surface 022 P3 and 019 T35 forbid.**

## 2. Decision A — Three principals, four roles, and no fourth of either

### 2.1 The rule

> **This system has exactly three authenticable principals: the `app_user` (a person), the `device` (an enrolled phone or kiosk), and — already shipped — the database role (E02-D06). A shop is a scope, never a principal. A role is one of 034 §2.6's four, and a session never invents a fifth.**

034 §2.5 and §2.8 already ratified the *subjects*: `app_user` (a person with a login, no `shop_id`, because a person can hold roles in more than one scope) and `device` / `device_credential` / `device_credential_revocation` (*"the phone as an auth principal"*). This record adds the **mechanism** those sections deliberately excluded and changes neither subject.

### 2.2 The four roles are 034's, and the bead's three-role framing is corrected

The bead's directives name the roles as *owner / staff / longbox-support break-glass*. **034 §2.6 ratified four, as a closed CHECK enum on `membership.role`:** `owner`, `manager`, `operator`, `support_break_glass`. This record uses those four unchanged and does not re-argue the enum-versus-table decision.

The three-role reading is natural because **`manager` is absent from the representative shop** — 034 §2.6 sources it to *"the 19% with a second storefront"*. It is still wrong, and the reason is a specific hazard rather than pedantry: a role that exists in the schema and not in the pilot is exactly the role an implementation drops silently and a second shop discovers by being unable to express its own staffing. **`manager` is implemented and untested-by-a-real-shop at G2, and §11 I13 asserts it is implemented rather than allowing the pilot's shape to prune it.**

**What this record adds to §2.6 and nothing more:** the mapping from role to *authentication requirement*, which is §4's table. It adds no permission, no matrix and no check — **that is E03-B03's**, and §12.3 says so.

### 2.3 A shop is a scope, and the consequence is the whole of §6

`membership` (034 §2.7) is the join, and it is append-only with a separate `membership_revocation` — *"a role change is two rows, not one"*. So **the set of shops a caller may act in is a query over facts, not a column on a session**, and it can change while a session is live. §3.4 is where that lands: a membership write **rotates** every live session of the affected person, so a revoked employee's phone stops working at the next request rather than at the next expiry.

### 2.4 What is deliberately NOT a principal

| Not a principal | What it is instead | Why it matters here |
|---|---|---|
| **A shop** | a scope, resolved from the session's memberships (§6.1) | making a shop a principal is what a shared shop password *is*, and the bead's own note refuses it: **"No global pilot password."** |
| **A browser tab** | nothing; a session is bound to a device and a person, never to a tab | a per-tab identity would make *"who confirmed this book"* a function of a window the operator closed |
| **A batch or a bin** | work context (034 §2.10, §2.11), never authority | 022 P2: an override must be cheap, so authority is never re-established mid-batch |
| **An IP address** | not identity and not a rate key (042 §8.1) | a counter's Wi-Fi is one IP for a whole shop and two shops behind one carrier are one IP |

## 3. Decision B — Two sessions, not one

### 3.1 The rule

> **A device session and an operator session are separate records with separate lifetimes. The device session authenticates the app instance and pins the shop and the location; the operator session authenticates the person and pins the attribution. Both are server-side records; the browser holds an opaque token and nothing else. Neither has a status column: liveness is derived.**

This is 034 §2.8's construction made concrete, and 034 already argued why one principal cannot do the job: 022 P3 requires that an employee's self-view *"never [renders] on a shared or kiosk device without fresh authentication"*, while 033 §1 A13 (`033:41`) requires a shared counter phone to pass between two people — *"Next item — no re-login, no re-picking the box"* — between books. **Those two requirements are contradictory with one principal and trivially compatible with two.**

### 3.2 Server-side record, not a signed self-contained cookie

Three constructions were available.

**(a) A signed, self-contained cookie** (a JWT or a signed session object) with no server record. *Rejected*, and it is the honest alternative: it needs no table, no read on the hot path and no migration. What it cannot do is **stop**. Revocation of a self-contained token requires a denylist consulted on every request — which is a session table with a worse name, an unbounded growth problem and a failure mode where forgetting to consult it is invisible. And revocation is not an edge case here: it is §2.3's membership change, §3.4's operator switch, §7's lost-phone case and §8's recovery, all of which must take effect **now** and not at the next expiry.

**(b) Sticky server-side session state on the connection or in process memory.** *Rejected on evidence already in this repository.* `src/services/rateLimit.ts:80-139` holds two `Map`s, and 046 E25 records the three consequences: the buckets are per **process**, so two processes give one shop two budgets; a restart empties them; and nothing survives a deploy. **A rate bucket that resets on deploy is a nuisance; a session store that resets on deploy signs every operator out mid-batch, and one that does not reset because it is sticky on a pooled connection is 034 §3.2's `SET LOCAL` hazard wearing different clothes.**

**(c) An append-only session record in Postgres, an opaque token in the cookie.** **Adopted.** The token is 256 bits from a CSPRNG; the database stores `sha256(token)` and never the token. Every property this record needs — revocation, rotation, reuse detection, the audit trail T35(c) requires — is a *fact about a session*, and this system already has one correct place to put a fact.

**Why SHA-256 and not a slow KDF for the session token, stated because the reflex is the other way.** A password KDF (argon2id, bcrypt) exists to make a **low-entropy, human-chosen, long-lived** secret expensive to guess offline. A session token is a **256-bit, machine-generated, short-lived** secret: there is no dictionary, offline guessing is not a threat model, and a per-request KDF is a denial-of-service surface the attacker controls the rate of. **The PIN and the password get argon2id (§3.5, §4.2); the session token gets a fast hash, and the difference is the entropy of the input, not the sensitivity of the output.**

### 3.3 No status column, and idle expiry without a mutable `last_seen_at`

> **`app_session` is append-only. There is no `status`, no `active` boolean and no `last_seen_at`. A session is live iff a row exists, no revocation names it, no successor supersedes it, and now is before both its absolute and its idle expiry.**

040 A8 retired `scan_session.status`; 042 I5/§3.3 generalised the leak it caused; 047 §5.1 refused to reintroduce one on the LCID registry. Reintroducing one here would be the worst of the three, because a session's state is the one thing in the system that two rows disagreeing about is a **security** outcome rather than a reporting one.

The hard part is idle expiry, which naively wants a column that moves on every request. **It is solved by rotation rather than by mutation:**

> **A session is re-issued rather than touched. Each request whose session is older than the rotation period issues a NEW `app_session` row, chained by `rotated_from`, sets the new cookie, and leaves the old row in place as spent. `idle_expires_at` is computed at issuance from the rotation period; a session that is not used within it is never re-issued and simply expires.**

Four things fall out, and they are the argument:

1. **Idle and absolute expiry are both properties of immutable rows.** `issued_at`, `absolute_expires_at` and `idle_expires_at` are written once and never corrected.
2. **Rotation is free where it is mandatory anyway** — on privilege change (§3.4), on operator switch (§3.5) and on MFA completion (§4.3) — so the mechanism is not built twice.
3. **Token reuse becomes detectable.** Presenting a token whose row already has a successor, or a revocation, is not merely stale: it is **evidence that the cookie was copied**, because the legitimate client received the successor. The response is to refuse *and* revoke the whole chain, which turns a stolen cookie into a signed-out attacker and a signed-out operator, and the operator's re-authentication is one PIN. This is the single strongest property in §3 and it is unavailable to construction (a).
4. **The write volume is bounded by the rotation period, not by the request rate.** A scan session is a burst of eight or nine requests over a couple of minutes (E2's route list); a rotation period measured in tens of minutes makes rotations rare relative to requests. **The period is a PROVISIONAL floor with its derivation stated and no measurement behind it** (042 A3): it is short enough that a stolen cookie's window is bounded by the next legitimate request, and long enough that the row count per operator-day is smaller than the row count per operator-book. **It is set by E03-B02's build from the first measured rotation-per-request ratio on a real batch, and until then it is a configured value that no artifact quotes as a security property.**

`app_session_revocation` is the ending, with `UNIQUE (session_id)` — 034 §2.7's grant/release idiom, chosen there for exactly this reason: *"A revocation says 'that grant ended'; the earlier row was never wrong, and there is no replacement."* `rotated_from` carries `UNIQUE` for the same reason 041 R2 and 047 §6.1 do: **a session is superseded at most once, so the chain is a chain and never a fork** — and a second successor is precisely what a token-theft race looks like, so the constraint is a detector.

### 3.4 Rotation is mandatory on privilege change

> **Any write to `membership` or `membership_revocation` naming an `app_user` rotates every live session that person holds, in the same transaction.**

Not expires — **rotates**, so the person keeps working and the new session carries the new scope. The transaction boundary is the point: a role change that commits while a session on the old scope is mid-request must not leave a window in which the old scope is still resolvable, and `withTransaction` (`src/db.ts:105`) is already the envelope every write runs inside. A **revocation** of the last membership at a shop rotates to a session with no membership there, which §6.1 resolves as *no shops*, which the client renders as signed out.

### 3.5 The shared counter phone: a device session plus a PIN, and staff never hold a password

This is the section the bead is really about, and the honest statement of the problem is 033 §1 A13's: one phone on a counter, passed between two people, with no re-login between books — against 019 T35 and 022 P3, which require that what each person did is attributable and that nobody may render a per-operator surface.

> **The device session is long-lived and possession-bound. An operator session is a short session on top of it, established by the person tapping their name and entering a personal PIN. Switching operator is one tap and a PIN — never an email and a password. A PIN is verified only on a device that already holds a live device session, and is useless anywhere else.**

**Why a low-entropy secret is acceptable here and nowhere else.** A four-to-six digit PIN is indefensible as a primary web credential and entirely defensible as a **knowledge factor on a possession-bound channel**: the attacker must first hold an enrolled device with a live device session, which is a physical object behind a shop counter. The three controls that make it hold are stated as obligations rather than assumed: the PIN is verified with argon2id (§9.2), the lockout is per `(device_id, app_user_id)` and is a **fact** rather than an in-memory counter (§9.1), and a PIN never authenticates anything but an operator session — it can neither sign in on another device nor reach a privileged surface (§4.1).

**Why not "no credential at all — just tap your name".** It is the shape the ergonomics argue for and it fails 019 T35(c): *"periodic reconciliation of Longbox-origin sessions against break-glass rows; an unmatched session is K1"*. Attribution that anybody standing at the counter can assert about anybody else is not attribution; it is a label. **022 P1 makes a wrong call the system's defect and never the employee's fault — which is exactly what makes unverified attribution *worse*, not better: a name attached to a book without the person's act is a person who cannot contest it.**

**Why not full re-authentication per book.** 022 P2 requires overrides be cheap; 033 A13 requires no re-login between books; and a friction tax on switching operators is a tax that gets paid by *not switching*, which produces a phone signed in as whoever started the shift and attribution that is silently wrong. **The cheapest thing must be the correct thing.**

**What the operator picker may and may not render, because this is where 022 P3 is easiest to breach by accident.** The picker is an authentication affordance and may show the roster of display names for the shop. It may **not** be ordered by recency or activity, carry a count, a "last used", a badge, a streak or any per-person datum whatsoever, and **the session, the batch and the item may never render an operator's name next to them** — 034 §2.5's *"never rendered next to a session"*. Stated plainly: **a roster is a list of who could be holding the phone; a leaderboard is a list of what they did, and the difference is one sort order.** §11 I7 asserts it.

### 3.6 The cookie

> **One cookie, `__Host-lb_session`, carrying the opaque token and nothing else: `HttpOnly; Secure; SameSite=Strict; Path=/`, no `Domain`, no `Max-Age` beyond the session's own absolute expiry.**

- **`__Host-` prefix** — a browser refuses to accept it unless it is `Secure`, has `Path=/` and has **no `Domain`**, which makes the cookie unsettable by a sibling subdomain. This matters concretely: the estate serves many applications under `intentsolutions.io` behind one Caddy (see the estate ops authority), and a cookie without the prefix can be planted by any of them.
- **`SameSite=Strict`, not `Lax`.** `Lax` exists to preserve top-level cross-site *navigation* into a signed-in state, which is a property a linkable web page needs. **This is a phone client for a shop's own staff; there is no cross-site entry flow to preserve**, and §5 leans on `Strict` as one of its three mechanisms.
- **Two cookies or one?** One. The operator session's row names its `parent_session_id`; sending two cookies would let a client present a mismatched pair and require the server to reconcile them, which is a state machine on the wire for no gain.

## 4. Decision C — MFA for privileged roles: TOTP now, passkeys deferred, and the reason is recovery

### 4.1 Who

| Role | Primary factor | Second factor | Where it may be established |
|---|---|---|---|
| `owner` | email + password | **required** (TOTP) | any device; **never** an operator session on a shared phone |
| `manager` | email + password | **required** (TOTP) | any device; as above |
| `support_break_glass` | email + password | **required** (TOTP) | Longbox-operated only; 034 §2.7 already requires `effective_until` and `reason` on the grant |
| `operator` | PIN on an enrolled device (§3.5) | **not required** | an enrolled device only |

**Why `operator` is exempt, argued rather than waived.** 022 P6 and P2 make friction a design defect on the scan flow, and an operator's authentication is already two factors in the ordinary sense — possession of an enrolled device and knowledge of a PIN — with the possession factor being a physical object in a shop. **Requiring a phone-based second factor from a person standing at a shared phone is a ceremony that produces a shared authenticator**, which is worse than no second factor because it looks like one.

**And the line that keeps this honest:** an `owner` who is also working the counter holds an operator session by PIN like anybody else, and **that session cannot reach an owner surface**. A privileged action requires a session established by password + TOTP within a freshness window — 022 P3's *"never on a shared or kiosk device without fresh authentication"*, expressed as a property of the session record rather than a rule in a screen.

### 4.2 TOTP over passkeys, for a shop owner on a phone

**Passkeys (WebAuthn) are the stronger factor and the correct end state**, and this record says so rather than pretending otherwise: they are phishing-resistant, there is no shared secret to store, and the server holds a public key that is worthless if stolen. TOTP is a shared secret the server must be able to read, and its codes are phishable in real time.

**They are still not the choice for v0, on four grounds, of which the fourth is decisive.**

1. **Enrollment breadth.** A shop owner is one person with one phone and no IT. A passkey's practical cross-device story is platform sync — an iCloud or Google account Longbox cannot see, cannot evidence and does not appear in 046 §7.2's secret inventory or in any processor register (022 P7 caps the pilot at two external processors and E01-B06 owns the terms).
2. **A second browser surface at G2.** WebAuthn is a new client API on a client that today is one `public/app.js` with no build step (E12), and 022 P6 puts a WCAG 2.2 AA obligation on every Longbox-authored view — including, per its own text, **3.3.7 and 3.3.8, which bind E03-B02 by name**. TOTP's UI is a text input.
3. **No fallback that is not a recovery code anyway.** The honest fallback for a lost passkey is a printed recovery code — a shared secret of roughly TOTP's strength with worse ergonomics — so the passkey path does not remove the secret, it adds one.
4. **The failure modes are not comparable, and this is the ground that decides it. A lost TOTP secret is a *recovery event this record can define* (§8). A lost passkey is a *platform we do not control*.** In a one-owner shop with no second administrator, the first is a procedure and the second is an outage whose resolution belongs to a vendor.

> **Decision: TOTP (RFC 6238, 6 digits, 30-second step) is the required second factor for `owner`, `manager` and `support_break_glass`. The schema does not preclude passkeys — `user_authenticator.kind` is a CHECK enum whose only member today is `totp` — and adding `webauthn` as an *additional* factor is a later decision with its own record, never a replacement that removes the recovery path §8 depends on.**

**Where the TOTP secret lives, and the one thing this record will not pretend.** A TOTP secret must be readable by the server, so locked decision 2's *"raw keys never in the database"* — a rule about **provider** credentials named by `key_ref` — cannot be satisfied by indirection here. The decision is: **the secret is stored encrypted at rest with a key that lives in the process environment and never in the database, under a variable the fail-closed config check validates (E13-B02), and the vault addressing is E03-B05's.** This is 047's *"the rule and the encoding are two decisions with different half-lives"* and 046 Q1's SPLIT ruling applied to a new secret: the **rule** (never in the database in the clear, never in a log, never in a fixture) lands now; the **custody** waits for the vault. §12.4 hands it over and §11 I9 asserts the rule half.

### 4.3 Verification, replay and rotation

- A code is valid for its own step and one step either side, and **single-use per `(authenticator, step)`**: `last_used_step` is recorded and a re-presented step is refused. Without this, a code observed over a shoulder or in a screenshot is valid for the rest of its window.
- **Completing MFA rotates the session** (§3.3): the pre-MFA session is spent and a full session is issued, so no token that existed before the second factor is still live after it.
- Enrollment is confirmed by presenting a code from the enrolled secret; a secret that is generated and never confirmed never becomes an authenticator row.

## 5. Decision D — CSRF: no synchronizer token, and three mechanisms that each fail loudly

### 5.1 The rule

> **No CSRF token is issued and none is checked. Cross-site writes are refused by three properties that already exist for other reasons and each fail loudly rather than silently: `SameSite=Strict` on a `__Host-` cookie; a mandatory non-safelisted request header on every mutating route, checked before the session is read; and the total absence of a CORS policy, asserted by a test.**

### 5.2 The argument

A classic CSRF attack is a cross-site page causing the victim's browser to issue a state-changing request with the victim's cookies. Against this system it must clear four hurdles:

1. **The cookie is `SameSite=Strict`** (§3.6), so a cross-site request carries no session at all and is anonymous — which after this record means refused.
2. **Every mutating route requires an `Idempotency-Key` header** (E13, `routes/scanSessions.ts:39-46`, 042 §5.1). A cross-site HTML form cannot set a custom header; a cross-site `fetch` that sets one is no longer a *simple request* and triggers a CORS preflight.
3. **There is no CORS policy** (§0: `cors|access-control-allow` → exit 1), so the preflight is refused by the browser and the request is never sent.
4. **Every body is parsed by a `.strict()` Zod schema** (E13), so the form-encoded shapes a cross-site form *can* send fail validation before reaching a service.

**Would a synchronizer token add anything?** It would add a fourth mechanism whose characteristic failure is **silent**: a token that is issued, rendered, sent and then not actually compared. Every one of the three above fails visibly — a wrong cookie attribute breaks the operator's own session; a missing header returns `IDEMPOTENCY_KEY_REQUIRED`; a CORS header added by accident is a line in a diff and a failing test. **A control whose absence is invisible is worth less than a control whose absence breaks the happy path**, and this is the same reasoning 043 A3 used against instructions-as-invariants.

### 5.3 The residual, stated rather than buried

- **`SameSite` is a browser control.** A client that is not a browser is outside all three mechanisms. **That is not a hole to patch here; it is the reason a non-browser client must never be given a cookie.** E05-B08's offline queue is the same origin and the same browser; **E18-B02's partner authentication must be a bearer credential on a header, never a cookie**, and §12.4 hands it over with that constraint attached.
- **Mechanism (2) is contingent on a rule another record owns.** The day a mutating route is added that does not require `Idempotency-Key`, this defence silently disappears from that route. **So it is asserted over the route table rather than remembered** (§11 I6): every route whose method is not `GET`/`HEAD` requires the header, checked before authentication so that the cheapest refusal comes first.
- **A GET can still be cross-site-issued.** No `GET` in this system mutates (E2's route list), and §11 I6's second half asserts it stays that way.

## 6. Decision E — The session is the only source of `shop_id`

### 6.1 The rule

> **`shop_id` is resolved from the session's memberships, before any handler runs. The `shopId` in the URL is a value to be checked against it, never the tenant itself. A request whose URL shop is not one the session holds is answered exactly as a request for a shop that does not exist.**

This is 046 §9.2's obligation on this bead, quoted rather than re-derived: *"the identity it establishes is the only source of `shop_id` for a request; the path parameter becomes a value to be checked against the session, never the tenant itself"* (034 `034:408`).

The resolved context is 034 §3.1's `RequestContext`, unchanged, and this record fills in where each field comes from: `app_user_id` and `device_id` from the session chain; `shop_id` and `location_id` from the device session's enrollment or from the membership the URL selects; `role` as the highest role held at that scope; `organization_id` derived from the shop; `correlation_id` from the existing hook (`http/errors.ts:99`).

### 6.2 One hook, and its position closes a gap assigned to another bead

The authentication hook is a single `onRequest` inside the tenant plugin (`src/app.ts:75-93`), registered **before** the rate-limit hook. That ordering is not cosmetic:

> **Once the session resolves the shop, the ordinary rate bucket is keyed on the session's `shop_id` rather than on `req.params.shopId` — and 042 §8.1's rule *"per shop, never per IP"* becomes true for the first time.**

046 assigns that fix to E13-B02 *"after G-1"* (G-20). **It is not a separate change: it is `deps.limiter.takeOrdinary(ctx.shopId)` instead of `takeOrdinary(req.params.shopId)`, in a hook this record adds anyway.** E13-B02 keeps the per-process problem (E5's two `Map`s), which is a genuinely different defect and stays where 046 put it.

**Failing closed on hook order.** A route registered outside the tenant plugin never sees the hook, which is exactly how E3 happened. The route walk (`tests/contract/route-table-scoping.test.ts`) already fails closed on an unclassified route; §11 I5 extends it to fail closed on a route that is neither on the auth allowlist nor covered by the authentication hook.

### 6.3 `operator_id` and `actor_verified` come from the session, and only from the session

> **Every write records `operator_id` from the session and sets `actor_verified = true`. Neither is ever accepted from a request body. No pre-G2 row is backfilled and no `actor_verified` is ever flipped to true (034 §4.4, `migrations/003:44-51`).**

This is the moment 046 E23 named: the accessor module gets something to gate. **`created_by` and `confirmed_by` stay unwritten (E7) and are never resurrected as a fallback** — a system that writes both a verified id and an unverified string has two attributions and no rule for which is true.

### 6.4 `GET /api/v1/shops` becomes *my shops*, and the tree's last defect row closes

> **The route returns the shops the caller holds a live membership at — for a device session with no operator, exactly the one shop the device is enrolled to. `SELECT … FROM shop JOIN membership … WHERE membership.app_user_id = $ctx AND no live revocation`. Its allowlist row's `kind` flips from `defect` to `exemption`, and its reason becomes what it now is: the route that establishes which tenant, which therefore cannot sit inside the tenant prefix.**

Two consequences worth naming. **First, this is the whole of 046's rank-1 G-2 half that belongs to this bead** — the RBAC matrix and the T24 runtime assertion remain E03-B03's. **Second, it unblocks G-11**: 042 §3.4's *"no defect-kind row may exist at G2"* has no mechanism today (046 E4), and a G2 assertion that the `defect` count is zero cannot be written as a passing test until the last defect row is gone. **The assertion is still E03-B03's to write; this record is what makes writing it possible.**

### 6.5 A wrong tenant answers `SHOP_NOT_FOUND`, and no new code is added

> **A URL naming a shop the session does not hold is answered with the registry's existing `SHOP_NOT_FOUND` (`errors.ts:84`), with no `details`. No forbidden/unauthorized code is added to the registry.**

A distinct "you may not access this shop" answer confirms the shop exists, which is an enumeration oracle over exactly the table E3's route enumerates today. 019 T24 signs **cross-tenant access** at zero and marks it non-waivable; existence is access to the fact of existence. And 042 §4.3's rule that the server never writes operator prose does the rest of the work: the code carries developer English from the `MESSAGES` map and the client selects operator copy from the code, so the two cases are indistinguishable on the wire **and** on the screen.

**The cost, stated:** an operator who mistypes a shop id gets *"no shop with that id"* rather than *"you are not a member of that shop"*, which is less helpful. It is a URL the operator never types (E12's picker becomes §6.4's *my shops*), and the honest trade is that a support conversation is cheaper than an oracle.

## 7. Decision F — Invitations and device enrollment, delivered out of band

### 7.1 The rule

> **An invitation is an append-only fact naming a shop, a role, an inviter and an expiry, with `sha256(token)` stored and the token shown once. It is single-use because `invitation_acceptance` carries `UNIQUE (invitation_id)` — not because a status column says so. Acceptance grants the membership in the same transaction.**

The shape is 034 §2.7's grant/release idiom and 047 §5.1's no-status-column rule, and it is chosen for a reason specific to invitations: **a `status` column on an invitation is a column two concurrent acceptances can both read as `pending`**, where a UNIQUE constraint makes the second one a failed INSERT. Single-use is a constraint or it is a race.

### 7.2 There is no email service, and this record will not invent one

**§0's grep is exit 1**: no mailer, no SMS client, no transport of any kind, and none in `.env.example`. So the v0 delivery is stated rather than assumed:

> **The owner delivers the invitation code to the employee in person. The screen shows it once; the employee enters it on the enrolled device and sets a PIN.**

**This is not a placeholder for a real channel, and it is arguably stronger than one.** An invitation delivered across the counter to a person whose face the owner knows is authenticated by a channel no email provider can match; an emailed invitation makes an inbox the root of trust for a shop's catalog and adds a processor that sees a credential in transit — which 022 P7's two-processor pilot cap and E01-B06's processor terms both have to account for. **The transactional-delivery provider choice is routed to E13** (§12.4), with the criteria written down here rather than discovered there: it is a processor under 022 P7; it sees credentials in transit; and it must not become the recovery path §8 deliberately declines to build.

### 7.3 Device enrollment

An `owner` or `manager`, in a privileged session (§4.1), creates a **one-time, short-lived, shop-scoped enrollment code** naming a location. The phone posts it once and receives a device session; the `device` and `device_credential` rows are written in that transaction. 034 §2.8's `device.location_id` is `NOT NULL` (its I7), so an enrollment names a location or fails.

**A device session is long-lived and revocable, and the lost-phone case is the design target.** Revoking `device_credential` (034's `device_credential_revocation`) kills the device session and every operator session whose `parent_session_id` names it, on the next request — which is §3.3's derivation doing its job without a sweep.

### 7.4 One amend-by-a-row this record PROPOSES on a ratified record

034 §2.8 gives `device_credential` a `key_ref text NOT NULL` described as *"the NAME of a reference, never a key or a public key blob — the `shop_credentials:34-35` rule, applied verbatim (locked decision 2)"*.

**The rule was applied verbatim to an object it does not fit.** `shop_credentials.key_ref` names an **environment variable an operator provisions** — and `migrations/014` has since narrowed it to a `LONGBOX_<SEGMENT>_<REST>` shape bound to the shop's slug (E9). A device credential is **minted by the system, one per phone**, and there is no environment variable for it to name; satisfying the rule literally would mean an env var per enrolled device, which is unimplementable at the second phone.

> **Proposed: 034 takes an amend-by-a-row to v1.2.0 replacing `device_credential.key_ref` with `token_hash text NOT NULL` — `sha256` of a 256-bit system-minted secret — with the reason recorded. A hash of a system-minted secret is not a key: it opens nothing, and it is the same object `app_session` stores (§3.2).**

Locked decision 2 is untouched: it governs **provider** credentials, every one of which still names an environment variable and none of which is stored. **This amendment is applied only if §14 is signed**, following 047's handling of its own 030 amendment, and it carries a 006 row of the same date.

## 8. Decision G — Recovery: owner-only, code-first, and out of band by design

### 8.1 The rule

> **Recovery codes are the primary path: at MFA enrollment the owner receives a set of single-use codes, shown once, stored with argon2id. Using one is an append-only fact and forces MFA re-enrollment. There is no self-service email or SMS reset, because there is no email or SMS service (§0) and because introducing one here would make an inbox the root of trust for a shop's catalog.**

### 8.2 What happens when the codes are gone too

The residual case — an owner with no phone and no codes — is handled by what already exists rather than by a new mechanism:

> **A Longbox-operated recovery under the existing manual break-glass runbook.** 022 P7: *"at Pilot A every Longbox access to shop data is recorded as a 006 row naming operator, reason and expiry (a manual break-glass runbook), evidenced at least once before G3."* The recovery is a `support_break_glass` membership (034 §2.7, which already requires `effective_until` and `reason` by CHECK), it issues a single-use recovery grant, and it is an append-only fact **the owner sees on their next sign-in**.

**The identity check is out of band and is not this record's to invent**: the shop signed a pilot charter with a named signer (038 §9, 039), and the verification procedure is E11-B09's operational runbook. **What this record fixes is that the technical path is the audited one and not a second, quieter path** — there is no super-admin, no "reset password" affordance for Longbox staff, and no way to obtain an owner session except by holding the owner's factors or by an audited, expiring, reasoned grant.

### 8.3 Staff PIN reset needs no channel at all

The owner resets it in person, in a privileged session, and the employee sets a new PIN on the device. **The whole out-of-band problem for the ninety-percent case is solved by the fact that these people work in the same room.**

### 8.4 Four mechanisms explicitly refused

| Refused | Why |
|---|---|
| **Security questions** | a second password with lower entropy, drawn from facts a shop's own social media answers |
| **SMS as a factor or a reset channel** | SIM-swap is the documented failure mode for exactly this population, and it is a third processor against 022 P7's two-processor pilot cap |
| **"Email the owner a magic link"** | no email service exists (§0); building one to serve recovery makes an inbox the root of trust for the catalog, and the provider sees the credential |
| **A break-glass role that can mint an owner session silently** | 034 §2.6: *"`support_break_glass` is never granted at ratification and never grants itself"*; 022 P7: *"there is no invisible super-admin"* |

## 9. Decision H — Brute force, lockout, and answering identically

### 9.1 Attempts are facts, not counters in a process

> **`auth_attempt` is append-only: the principal attempted, the device, the method, the outcome and the time. Lockout is a derivation over it — per `(device_id, app_user_id)` for a PIN, per `app_user_id` for a password — with exponential backoff, never a global lock a stranger can trigger against a named person.**

The alternative is E5/046 E25's shape, and its three properties are already documented in this repository: per-process, empty on restart, keyed on something a caller chose. **A lockout with those properties is not a lockout; it is a lockout per worker.** The write cost is one row per **failed** attempt, bounded by the lockout itself; successes are recorded too, because T35(c)'s reconciliation of sessions against break-glass rows needs both sides.

**`auth_attempt` is per-operator data and goes behind 034 §3.3's accessor with the other three column names** — this is the record that finally gives that module something to gate (E8), and adding a fourth surface without putting it there would be the exact leak 034 §3.3 A5 closed for the legacy strings.

### 9.2 Password and PIN verification

argon2id for both, with parameters set at build time and recorded as **PROVISIONAL floors** (042 A3) rather than quoted as a security property. The split 046 K-2 and `migrations/014` established is reused verbatim (E9): **the database enforces the shape, the function enforces the binding.** A PIN hash is meaningless without its `(device, app_user)` scope, and that is a two-table fact no CHECK can express — so the verification function refuses an out-of-scope pair **in its own body**, before any hash is computed.

### 9.3 Every failure answers the same thing

An unknown email, a wrong password, a wrong PIN, a locked-out account, an unknown invitation token, a spent one and an expired one each produce **one code from the existing registry with no `details`**, and the same work is done in each case so the timing does not distinguish them. This is `http/errors.ts:44-71`'s existing discipline (E11) applied to a new class: *"maps everything unrecognised to `INTERNAL_ERROR` and drops the thrown message rather than forwarding it."* **A helpful error at an authentication boundary is a query interface over the user table.**

### 9.4 What is deliberately not built

No CAPTCHA (a third processor, and a per-IP control against 042 §8.1). No IP-based blocking (E5's reasoning: one shop is one IP). No "impossible travel" or device-fingerprint heuristic — **a behavioural detector over a shared counter phone is a per-operator surface arriving by the back door**, which is 022 P3's CFO constraint: *"the cheapest way to satisfy T35 is never to build a per-operator surface, and no such surface may be built and then restricted."*

## 10. The migration list, and the beads that build this

### 10.1 The migrations — unnumbered, as 041 §10 requires

**No file number is claimed here.** 041 §10's rule, restated by 047 §12.4: *"A file number is claimed when the file is written, never reserved in prose."* The tree holds `001`–`014`; the writing bead claims the next free integers per 044. **Every one is expand-only** (044 §2): tables and columns added, nothing dropped, nothing retyped, no existing column made `NOT NULL`.

| # | Content | Depends on |
|---|---|---|
| **M1** | 034 §4.1's tenancy migration, unchanged and not re-specified here: `organization`, `location`, `app_user`, `membership`, `membership_revocation`, `device`, `device_credential` (+ §7.4's `token_hash`), `device_credential_revocation`, and the `operator_id` FKs on the four tables that reserve the slot | nothing — it is **already specified and unbuilt**, and this record's whole design is downstream of it |
| **M2** | `app_session`, `app_session_revocation` — append-only, `ENABLE ALWAYS`, declared in `src/db/appendOnlyTables.ts` with a reason row (041 §9.2 item 4) | M1 |
| **M3** | `user_credential` (password, argon2id), `operator_pin` (per `(device, app_user)`), `user_authenticator` (`kind CHECK IN ('totp')`, encrypted secret, `last_used_step`), `recovery_code` | M1 |
| **M4** | `invitation`, `invitation_acceptance`, `device_enrollment_code`, `auth_attempt` — all append-only with their UNIQUEs | M1, M3 |

**Which tables are immutable and which are config**, following 034 §4.2's split (*"a record of something that happened is immutable; a statement about the present is corrected in place"*): **immutable** — `app_session`, `app_session_revocation`, `invitation`, `invitation_acceptance`, `device_enrollment_code`, `auth_attempt`, `recovery_code_use`. **Config, mutable, and each a declared exemption with a reason row** — `user_credential`, `operator_pin`, `user_authenticator` (a password is changed in place; its *change* is an `auth_attempt` fact, and versioning the hash would keep every old password's hash forever, which is a liability rather than an audit trail).

### 10.2 The implementing beads — recommendation

The bead's own acceptance criterion is *"Every non-public route denies anonymous access; rotation/expiry/recovery tests pass"*, which is one property and four subsystems. **The recommendation is that E03-B02 keeps the substrate and three discovered beads carry the parts that are separable, are gated on other decisions, or would otherwise expand B02 silently.**

| Alias | What | Why separable | Type |
|---|---|---|---|
| **E03-B02** *(this bead)* | M1, M2, the cookie, the authentication hook, the session derivation and rotation, password and PIN verification, the operator switch, `operator_id` writing, and the rate-key move (§6.2) | the substrate; nothing below is expressible without it | — |
| **E03-D06** | TOTP enrollment and verification, recovery codes, and the authenticator-secret key handling (§4.2, §8.1) | **gated on E03-B05's vault decision for the key's custody**, and it touches no shop-scoped route | task |
| **E03-D07** | Invitations and device enrollment — the two out-of-band flows (§7) | needs the E05 screens and carries E13's delivery decision as a stated non-dependency for v0 | task |
| **E03-D08** | `GET /api/v1/shops` → *my shops*, and the allowlist row flipped from `defect` to `exemption` (§6.4) | **the smallest change that retires 046's last defect row**, landing the moment the hook exists, and separately citable as the G-2 half this bead owns | bug |

**None of these is created by this record.** Filing them is the parent session's act after the cannon, with a 015 row each, per 023 §2 — the same handling 046 §9.3 used for E03-D01…D05.

## 11. Acceptance criteria and invariants

Each is falsifiable and names the test that will decide it. **None of these tests exists** (018: nothing here is TESTED). Unit tests flat in `tests/`, DB tests in `tests/integration/`, contract tests in `tests/contract/`.

**The bead's own acceptance line is I1 and I3** — *"Every non-public route denies anonymous access; rotation/expiry/recovery tests pass."*

| # | Invariant | Test file |
|---|---|---|
| **I1** *(the bead's acceptance line; 046 I2)* | **No route reaches the database or the filesystem without a resolved session.** Walk `app.registeredRoutes` (`src/app.ts:53-57`); assert every route not on the auth allowlist refuses an anonymous request, and that every mutating handler's `shopId` derives from the session context and never from `req.params` alone. **Fails on the current tree** — `routes/scanSessions.ts:71` and every sibling parse it from the path (E4). | `tests/contract/tenant-from-session.test.ts` |
| **I2** *(019 T24, non-waivable)* | **A session at shop A cannot reach shop B, and the refusal is indistinguishable from absence.** A live session for A calling `…/shops/<B>/scan-sessions/<id>` receives `SHOP_NOT_FOUND` with no `details`, byte-identical to the response for a shop id that was never issued (§6.5). | `tests/integration/session-tenant-isolation.test.ts` |
| **I3** *(the bead's acceptance line)* | **Rotation, expiry and revocation are total and derived.** Six cases: a rotated token is refused; **presenting a spent token revokes the whole chain** (§3.3); a revoked session is refused on the next request with no sweep; a session past `absolute_expires_at` is refused; one past `idle_expires_at` is refused; and a membership write rotates every live session of that person **in the same transaction** (§3.4). | `tests/integration/session-lifecycle.test.ts` |
| **I4** | **A session has no status column, and liveness cannot be stored.** Introspect `information_schema.columns`: no column on `app_session` named `status`, `active`, `revoked`, `expired` or `last_seen_at`; assert `app_session` and `app_session_revocation` reject `UPDATE` and `DELETE` from the app role; assert `UNIQUE (rotated_from)` and `UNIQUE (session_id)` exist. | `tests/integration/append-only.test.ts` (extended) |
| **I5** | **The authentication hook cannot be bypassed by where a route is typed.** Extend `tests/contract/route-table-scoping.test.ts`: every registered route is either inside the tenant plugin, or on the auth allowlist with an `exemption` reason, and **no route is neither**. Assert the auth hook is registered **before** the rate-limit hook, so the bucket is keyed on the session's shop (§6.2). | `tests/contract/route-table-scoping.test.ts` (extended) |
| **I6** *(§5)* | **The three CSRF mechanisms are asserted, not remembered.** (a) the `Set-Cookie` header carries `__Host-`, `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/` and **no `Domain`**; (b) every non-`GET`/`HEAD` route requires a non-safelisted header and refuses without it **before** reading the session; (c) no response on any route carries an `Access-Control-Allow-*` header and no CORS plugin is a dependency; (d) no `GET` route mutates. | `tests/contract/csrf-mechanisms.test.ts` |
| **I7** *(019 T35, non-waivable; 022 P3)* | **Authentication creates no per-operator surface.** The operator picker's payload carries display name and id only — **no count, no timestamp, no ordering key** — and is sorted by a stable, activity-independent key; no response DTO renders an operator identifier beside a session, batch or item (034 §2.5); no route accepts an operator identifier as a filter, sort or grouping parameter. Extends 046 I7 and 042 I7 to the new surface. | `tests/contract/state-routes-t35.test.ts` (extended) |
| **I8** | **`operator_id` is written from the session and from nowhere else.** A body carrying `operator_id`, `created_by` or `confirmed_by` is rejected by the `.strict()` schema; every write records the session's `app_user_id` with `actor_verified = true`; **no pre-G2 row's `actor_verified` is ever updated** (`003:44-51`). | `tests/integration/actor-attribution.test.ts` |
| **I9** *(019 T31, non-waivable)* | **No credential material is stored, logged or emitted.** Assert `app_session` stores a hash and never a token; `user_credential`, `operator_pin` and `recovery_code` store argon2id digests; `user_authenticator`'s secret column is ciphertext and its key comes from the environment (§4.2); a canary planted in a password, a PIN and a TOTP secret appears in no log line, no error body, no `pg_dump` fixture and no test output. Extends 046 I13. | `tests/contract/secret-surfaces.test.ts` (extended) |
| **I10** | **A PIN is worthless off an enrolled device, and lockout is a fact.** A correct PIN presented without a live device session is refused; a correct PIN presented on another shop's device is refused; N wrong PINs lock **that `(device, app_user)` pair only** and no other operator on the same phone; the lock survives a process restart (§9.1). | `tests/integration/operator-pin.test.ts` |
| **I11** | **A privileged surface is unreachable from an operator session.** A session established by PIN cannot perform any action whose role requirement is `owner`, `manager` or `support_break_glass`, **even when the person holds that role** (§4.1); and a privileged action requires a session whose MFA completion is within the freshness window. | `tests/integration/privileged-session.test.ts` |
| **I12** | **An invitation and an enrollment code are single-use by constraint.** Two concurrent acceptances of one invitation: exactly one commits, the loser gets a unique violation and not a second membership; an expired, unknown or spent token produces **one** code with no `details` (§9.3); acceptance writes the membership in the same transaction. | `tests/integration/invitation.test.ts` |
| **I13** *(§2.2)* | **All four roles are implemented, including the one the pilot does not use.** Assert the `membership.role` CHECK carries exactly `owner`, `manager`, `operator`, `support_break_glass`; assert a `manager` session resolves and is scoped to its locations. **A role present in 034 and absent from the code fails the build.** | `tests/integration/role-enum.test.ts` |
| **I14** *(019 T35(c))* | **Every Longbox-origin session reconciles to a break-glass grant.** For every `app_session` whose `app_user` holds `support_break_glass`, a live `membership` with `effective_until` and `reason` covers its `issued_at`; an unmatched session is **K1**. | `tests/integration/break-glass-reconciliation.test.ts` |

**I1, I2, I7, I8, I9 and I14 map to a non-waivable line** (T24 for I1/I2; T35 for I7/I8/I14; T31 for I9). **I1 fails on the tree as it stands, by design** — every route is anonymous today, and a test asserting otherwise is the gate doing its job. **No invariant here is blocked on a missing helper** (§0); all fourteen are blocked on M1, which 034 specified and nobody has written.

## 12. Alternatives, consequences, and what this record does not decide

### 12.1 Alternatives considered

**A1 — Buy identity: an external IdP (Auth0, Clerk, WorkOS, Supabase Auth).** *Rejected, and it is the alternative with the strongest case.* It would deliver everything in §3, §4, §7 and §8 in an afternoon, by people who do this full time, with passkeys included. Four things rule it out for v0 and none of them is "not invented here". **(a)** It is a processor holding the shop's operator identities, against 022 P7's two-processor pilot cap and E01-B06's terms — and it would spend one of the two on a component that touches no shop data. **(b)** The construction it will not sell is §3.5's: a device principal with a PIN-derived operator session on a shared phone. Every hosted IdP models a person on a device, and the shared-counter-phone shape is the one thing this record exists to get right. **(c)** `operator_id` must be a real FK into `app_user` in *this* database (034 §2.13), so the user table exists locally regardless and the IdP becomes a second source of truth for the same person. **(d)** It moves an availability dependency onto the scan flow: a shop cannot list books because a vendor is down. **The case for revisiting it is real and is written into §13 Q1**, because *"we could have bought this"* is the sentence this record most deserves to be asked.
**A2 — One session, with the operator switch as a field on it.** *Rejected*; §3.1. It makes 022 P3's fresh-authentication rule unimplementable, because there is nothing left to authenticate freshly against.
**A3 — A signed self-contained cookie with no session table.** *Rejected*; §3.2. Revocation degenerates to a denylist, which is a session table with worse properties.
**A4 — A shared shop PIN or a shared device login.** *Rejected*, and the bead itself refuses it in four words: **"No global pilot password."** It also destroys T35(c) reconciliation and 022 P1's blame clause in the same stroke — a defect traced to "the counter phone" is a defect traced to nobody, which sounds protective and means the employee cannot show it was not them.
**A5 — Passkeys now, TOTP never.** *Rejected*; §4.2, on the recovery ground rather than the security one.
**A6 — A synchronizer CSRF token.** *Rejected*; §5.2. A fourth mechanism whose failure is silent, behind three whose failures are loud.
**A7 — A mutable `app_session.last_seen_at` for idle expiry.** *Rejected*; §3.3. It is a write per request on a row the whole security model reads, and it reintroduces the mutable-state shape 040, 042 and 047 each refused. Rotation gives the same property over immutable rows and yields reuse detection as a by-product.
**A8 — Per-IP rate limiting or lockout at the authentication boundary.** *Rejected*; §9.4 and 042 §8.1, which this record does not reopen.

### 12.2 Consequences

**What gets better.**
- **Every gap 046 ranked below G-1 becomes expressible.** G-2 (the shop picker), G-3 (RLS needs a tenant to set), G-10 (a credential write surface needs an owner), G-11 (the G2 defect assertion) and G-20 (the rate key) each named authentication as their precondition; four of the five are unblocked by §6 alone and one is *closed* by §6.2.
- **The accessor module gets something to gate** (E8, 046 E23), and `auth_attempt` joins it at birth rather than being added to it later.
- **Five migrations' worth of comments stop being promissory** (E6): `operator_id` acquires a writer and an FK target.
- **A stolen cookie becomes detectable rather than merely time-limited** (§3.3), which no construction without a server-side record can offer.
- **The shared counter phone is designed for rather than tolerated**, and the design is the one place 022 P3 and 033 A13 were previously in tension.

**What gets worse, stated plainly.**
- **This is the largest single subsystem in E03, and it is on the critical path of five others.** §10.2's split is a mitigation, not a reduction.
- **A session read joins the hot path of every request.** It is one indexed lookup inside a transaction that already exists (§0), and it is still a new dependency on the database for requests that previously touched nothing.
- **Rotation writes rows.** The volume is bounded by a period nobody has measured yet (§3.3), and the first honest number arrives from a real batch.
- **A PIN is a low-entropy secret, and the argument for it is a chain of three controls** (§3.5). If any one of them is implemented weakly — a lockout in memory, a PIN accepted without a device session, an enrollment code that does not expire — the whole argument fails quietly. **I10 exists because that failure is quiet.**
- **The operator picker renders names, and one sort order away from it is a leaderboard** (§3.5, I7). This record makes a P3 boundary depend on a property of a payload.
- **Nothing here is built.** Every invariant in §11 names a test that does not exist, and §2–§9 sit behind a migration 034 specified and nobody has written.

### 12.3 What this record does NOT decide

- **The permission matrix.** Which role may do what, the per-permission positive and negative tests, the T24 runtime assertion and the G2 route-walk exit assertion are **E03-B03's**. This record establishes *who* is asking and at *which shop*; it grants nothing.
- **Row-level security.** The policy text and the `SET LOCAL` mechanism are **E03-B04's**; 034 §3.2 already fixes transaction-local context over sticky state and 046 K-5 records that the substrate is already load-bearing at `idempotency.ts:258`. **This record's contribution to it is that `SET LOCAL` finally has a trustworthy value to set** (§6.1).
- **The secret store.** The vault, its rotation and its revocation are **E03-B05's**; §4.2 places a *rule* on the authenticator key and hands the *custody* over, per 046's Q1 SPLIT ruling.
- **The privacy program.** Retention of `auth_attempt` and of expired sessions, holds and the deletion path are **E03-B09's**; this record adds two data classes and asserts nothing about their windows.
- **Connector OAuth, webhook signatures, media hardening** — E03-B06, E03-B08, E03-B07 respectively.
- **The screens.** Every view this record implies is **E05's**, under 022 P6's WCAG 2.2 AA obligation — including 3.3.7 and 3.3.8, which `022:63` binds to this bead by name (*"the last binds E03-B02"*) and which E05-B02 implements.
- **Transactional delivery.** The email/SMS provider is **E13's** (§7.2), with the criteria stated here.
- **Partner authentication.** **E18-B02's**, constrained by §5.3: a bearer credential on a header, never a cookie.
- **Any locked decision.** 2, 4 and 5 outrank this record; where anything here conflicts, the locked decision wins. §4.2 is the one place the record comes near locked decision 2 and it says so explicitly rather than quietly.
- **Any 019 threshold or 022 principle.** §7.4 proposes an amend-by-a-row on **034** and nothing else; no 019 line and no 022 principle is amended, and per `019:202` a 022/019 conflict halts and escalates to the acting head by a 006 row rather than being reconciled by a build agent.

### 12.4 What this record hands to other beads

| # | Artifact | Blocked on | Owner |
|---|---|---|---|
| 1 | M1 — 034 §4.1's tenancy migration, with §7.4's `token_hash` correction | nothing | **E02-B07 / E02-B10**, per 034 §4 |
| 2 | M2–M4 and the authentication hook | 1 | **E03-B02** (this bead) |
| 3 | TOTP, recovery codes, and the authenticator key's **custody** | 2, and E03-B05's vault decision | **E03-D06** → **E03-B05** |
| 4 | Invitations, device enrollment, and the transactional-delivery **provider choice** | 2; the delivery choice is not a v0 dependency (§7.2) | **E03-D07** → **E13** |
| 5 | *My shops* and the allowlist flip that retires the last `defect` row | 2 | **E03-D08** |
| 6 | The permission matrix, the T24 runtime assertion, the G2 defect-count assertion, and the `identity` accessor module — **which now gates four column names plus `auth_attempt`** (§9.1) | 2 | **E03-B03** |
| 7 | RLS policies, with the tenant taken from the session inside `withTransaction` | 2 | **E03-B04** |
| 8 | The rate limiter's per-process defect — **the key move is done here (§6.2); the shared budget is not** | 2 | **E13-B02** |
| 9 | The 029 §9 amend-by-a-row adding the identity tables to the `identity` module's owned-tables list | 1–2 | **E03-B02**, as a same-PR obligation |
| 10 | The 034 §2.8 amend-by-a-row (§7.4), applied only if §14 is signed, with a 006 row | ratification | acting head |

## 13. The nine questions for the cannon

Nine, and the first four are the ones a lens should be able to move.

1. **Should this have been bought rather than built (§12.1 A1)?** The four grounds are the shared-phone construction, the processor cap, the local FK, and the availability dependency. **Is the shared-counter-phone shape genuinely unbuyable, or is it a device session plus a hosted user store, in which case the build shrinks to §3.5 and §6?**
2. **Is §3.3's rotation-instead-of-touch the right way to get idle expiry over immutable rows, or is it a write-amplification trap wearing a Hickey costume?** The claim is that rotations are rare relative to requests. **Nobody has measured that, and §0 forbids quoting a number for it.** Is a session table that is a *declared config exemption* with a mutable `last_seen_at` — the shape `shop_credentials` and `request_idempotency` already have — the more honest answer, given that both of those are exemptions precisely because they are statements about the present?
3. **Is a PIN on a device session sufficient authentication for an act that a shop's whole catalog depends on?** The chain is three controls (§3.5) and it fails quietly if any is weak. **Is there a construction with the same ergonomics and a shorter chain?**
4. **Is §5's refusal to issue a CSRF token correct, or is it three controls that are each owned by another record and can each be changed by a bead that has never read this one?** Mechanism (2) is 042's idempotency header; mechanism (3) is the absence of a dependency. **I6 asserts all three — is an asserted absence a control?**
5. **`SHOP_NOT_FOUND` for a wrong tenant (§6.5): correct, or an operability cost this pilot cannot pay?** The oracle argument is real and so is the support call. **Does 019 T24's "cross-tenant access = 0" reach the fact of existence, or only the rows?**
6. **Does §3.4's rotate-on-privilege-change hold under concurrency?** A membership write and a request on the affected session commit in different transactions on different connections. **Is "rotate every live session in the same transaction as the membership write" actually sufficient, or does it need the session read to take a lock, and if so does that put a lock on the hot path of every request?**
7. **Is §4.2's TOTP ruling right, or is it a decision made against a recovery problem that §8's recovery codes already solve?** If recovery codes are the primary path for a lost factor, the fourth ground — the decisive one — weakens considerably. **Does the passkey case survive its own recovery story?**
8. **Is §7.2's out-of-band invitation an honest v0 or a deferred subsystem?** It is stronger for a three-person shop and it does not obviously scale to 038's national case. **At what shop size does "the owner reads a code across the counter" stop being the right answer, and should that threshold be written here or discovered at E13?**
9. **Is §9.1's `auth_attempt` a T35 hazard rather than a T35 control?** It is per-operator data, created to defend the system, placed behind the break-glass accessor. **022 P3's CFO constraint is that no per-operator surface may be built and then restricted. Is an append-only failure log a surface, or is it the audit substrate T35(c) explicitly requires?**

### Recommended lenses

**`security-auditor` and `martin-kleppmann-reviewer`.**

**`security-auditor`** needs no defence: it is the lens that will attack the PIN chain (Q3), argue with the CSRF refusal (Q4), and is the only available lens whose default posture is adversarial. It ran on 046 and its five dissents there — above all D5, that the aggregate instrument is *"a mitigation and not an equivalent"* — are the reasoning discipline this record needs applied to §3.5 and §9.

**`martin-kleppmann-reviewer` is the second, and it is chosen over `rich-hickey-reviewer` deliberately, although the Hickey case is genuinely strong here.** The Hickey case is Q2: this record's spine is *a session is a series of facts, not a mutable row*, which is his separation applied to authority, and §3.3's rotation construction is exactly the move he would either bless or call a cache with delusions. **The reason to take Kleppmann anyway is that the questions with teeth are about time and concurrency, not shape.** Q6 is a two-transaction race on privilege change; Q2's real content is write amplification against an unmeasured rate; §3.3's reuse detection is an at-most-once-supersession argument of exactly the form he ruled on in 047 A1 and A10; and §3.4's *"in the same transaction"* is a claim about a boundary he has twice found stated more strongly than the mechanism supported (042 A8, 043 A3). **A session is the one object in this system where being briefly wrong about the present is a security outcome**, and that is his axis.

**`rich-hickey-reviewer` is the named substitution and the case for it is Q2 and Q9** — both are "is this a fact or is this state" questions. If the acting head wants pressure on whether §3.3 has re-invented a status column with extra steps, rather than on whether it is correct under concurrency, Hickey is the swap to make. **Running all three is defensible on a record this size and is not recommended**: 047's experience was that a third lens offered for one question re-litigates a settled record, and Q2 is a question either of these two can answer.

## 14. Ratification

**UNSIGNED. This record is PROPOSED.**

| Field | Value |
|---|---|
| Decision | **Adopt §2–§9** — three principals and 034's four roles unchanged, with the bead's three-role framing corrected (§2); two sessions rather than one, as append-only issuance facts with no status column, idle expiry by rotation, and token-reuse detection as its by-product (§3); a device-bound PIN for staff and no staff password (§3.5); TOTP required for `owner`, `manager` and `support_break_glass`, passkeys deferred on the recovery ground, and the authenticator key's rule split from its custody (§4); no synchronizer CSRF token, replaced by three loudly-failing mechanisms that are asserted rather than remembered (§5); the session as the only source of `shop_id`, a wrong tenant answered as an absent one, `GET /api/v1/shops` re-shaped into *my shops*, and the rate key moved to the session's shop (§6); single-use invitations and enrollment codes delivered out of band, with the transactional-delivery provider routed to E13 (§7); owner-only recovery, code-first, with the residual case handled by the existing audited break-glass runbook and four mechanisms explicitly refused (§8); and lockout as a derivation over append-only attempt facts, with every authentication failure answering identically (§9). Together with §10's unnumbered migration list and bead split, §11's fourteen invariants, and §12.1's eight rejected alternatives. |
| Status | **PROPOSED — not binding on any bead.** |
| Acting head of board | *(unsigned)* |
| Date | *(unsigned)* |
| Cannon | *(not yet run)* — recommended: **`security-auditor`** and **`martin-kleppmann-reviewer`**, with **`rich-hickey-reviewer`** as the named substitution on Q2 and Q9. |
| Amendments at ratification | *(none — no cannon has run)* |
| Dissent preserved | *(none yet)* |
| Amendment this record PROPOSES on a ratified record | **034 §2.8 → v1.2.0 by a row:** `device_credential.key_ref` becomes `token_hash` (`sha256` of a 256-bit system-minted secret), because an env-var name for a per-device secret is unimplementable at the second phone and a hash of a system-minted secret is not a key (§7.4). **Applied only if §14 is signed**, with a 006 row of the same date. Locked decision 2 is untouched. |
| Gate audit | *(pending)* — `longbox-gate-auditor` before the bead closes. |
| Jeremy's revision right | **Standing.** Jeremy may revise any line by a 006 decision-log row naming date, old text, new text and reason (018 §5). Locked decisions 2, 4 and 5 outrank this record, as do 019's signed thresholds, 022's principles and every ratified record it cites — 034 and 046 above all, whose §2, §3 and §9.2 this record extends and, except for §7.4's proposed row, never amends. Per `019:202`, a 022/019 conflict halts and escalates to the acting head by a 006 row; **no build agent reconciles the two by interpretation.** |
| Recorded in | 006 decision-log row dated 2026-09-04 (**PROPOSED**, to be flipped in place at ratification per 018 §4 C2); 016 §1 row 048; 000-INDEX row 048; the change log above; bead `longbox-e5b.3.2`'s close reason will quote the ratified version. |

Once signed, changing any **decision** above — the principal set, the two-session construction, the absence of a status column, the rotation rule, the PIN's scope, the MFA requirement or its factor, the CSRF posture, the session-as-tenant-source rule, the wrong-tenant response, the invitation's single-use construction, or the recovery path — will require a new decision record naming this one as superseded (018 §4 rule S4), never an in-place edit. Three things are explicitly **not** decisions and may be amended in place by a patch bump plus a change-log row, following 029 §9, 042 §14, 046 and 047's precedent: **statements of fact about the existing tree** (a `file:line` that turns out wrong is a defect in the description, not the decision); **§10.1's migration contents**, which the writing bead refines against 044; and **every PROVISIONAL floor** — the rotation period, the session lifetimes, the lockout backoff, the recovery-code count and the argon2id parameters — which are circuit breakers that may be tightened freely and are never quoted as a security property.

**Ratification will not be evidence** (018 §2 A3). Signing §14 would record that a design was argued and adopted. It would **not** authenticate one request: **nothing here is built, nothing is TESTED**, every invariant in §11 names a test file that does not exist, and all fourteen are blocked on a migration 034 specified and nobody has written. **In particular, adopting this record does not retire the unauthenticated shop enumeration** (`src/routes/scanSessions.ts:145`, the tree's last `defect`-kind allowlist row), **the tenant that is a path segment** (`routes/scanSessions.ts:71`), **the rate bucket keyed on it** (`app.ts:82-89`), or **the four columns reserving an attribution nothing writes** (`migrations/003:44-51`). §1 stays REPRODUCED and everything else stays ASSERTED.
