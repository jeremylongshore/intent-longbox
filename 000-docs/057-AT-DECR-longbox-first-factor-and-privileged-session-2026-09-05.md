# Decision Record — The First Factor, the Third Session, and the Custody of the One Pepper

**Version:** 1.1.4
**Status:** **RATIFIED at v1.1.3, amended by a row at v1.1.4** (2026-09-05, signed by the acting head under the 2026-09-03 delegation at close of E03-D11 — PR #94 squash-merged to `main` as `bd563e4`, the bead closed against that SHA, after the invariant re-verification at `55dabd6` (R-A/R-B/R-E and every fold reproduced by hand; its two blocks — a colliding claim id and a measured-false oracle sentence — repaired at v1.1.2) and the gate re-audit whose four blockers are v1.1.1). The text that follows is the PROPOSED-era status, kept verbatim as history: **PROPOSED at v1.1.2.** The two-lens cannon **WAS DISPATCHED** by the parent session against PR #94 at `d0f58cb`: `security-auditor` **ACCEPT-WITH-CHANGES** (F1 HIGH, F2–F5) and `martin-kleppmann-reviewer` **ACCEPT-WITH-CHANGES** (K1, K2, K6). §2 carries **both statements verbatim**, and v1.0.0's builder-drafted positions are SUPERSEDED rather than kept beside them (054 §0's precedent). The code half additionally carries a `longbox-invariant-reviewer` verdict of **PASS-WITH-NOTES** and a `longbox-gate-auditor` verdict of **NOT-READY on facts**; all of it is folded here, nothing declined. **§15 is still UNSIGNED**; the acting head signs at CLOSE, because a record that pre-announced its own ratification would be the artifact deciding its own review.
**Bead:** E03-D11 `longbox-e5b.3.21` (epic LBOX-E03 `longbox-e5b.3`, gate **G2**, evidence class TEST, owner-role security, risk P1, phase P1-foundation, layer security) — discovered 2026-09-04 by E03-D06 / PR #82, from 048 §12.4 row 3a
**Drafted:** 2026-09-05 by `longbox-security-tenancy-builder` · **Audit:** `longbox-invariant-reviewer` (code) and `longbox-gate-auditor` (this record) before close · **Decision owner:** Jeremy Longshore (acting head of board under the 2026-09-03 delegation)
**Sensitivity:** Restricted internal (014 §10). It names no shop, no person and no secret value. It describes the shape of every credential this system holds and the blast radius of losing one of them, which is a map of the design and not of anybody's data.
**Supersedes:** nothing. It **discharges** four obligations that ratified records left with no owner or with the wrong one: 048 §10.2's table, which assigned `user_credential` **to no bead at all**; 048 §12.4 **row 3a**, filed by E03-D06 when that bead shipped the second factor and found the first one missing; 048 §12.4 **row 3's remainder** — the pepper's custody, backup and rotation, handed to E03-B05, whose record (050) **does not contain the word "pepper" once** (055 §2 E5); and 055 §9 items **4a**, **4b** and **11**.
**Inputs:** 014 §8 row LBOX-E03 · 015 alias map · **048 v1.5.2 §3.1, §3.3, §3.5, §3.6, §4.1–§4.3, §7.1–§7.3, §8.1–§8.2, §9.1–§9.3, §10.1–§10.2, §12.3, §12.4 rows 3/3a, I11, I15, I16** · **054 v1.1.4 §3.2–§3.4, §4.3–§4.5, §5** · **042 v1.4.3 §3.1, §3.4, §5.1, §5.3(b), §8.1, I5, I22** · **056 v1.1.2 §3, §5, §7, §11** · **055 v1.0.4 §2 E4–E6, RULING 1, RULING 4, RULING 6, §9 items 4a/4b/5/11** · **053 v1.0.6 §8** · **041 v1.x §4.2, §9.2 items 1/4, §10** · **050 §3, §4** · **034 v1.2.0 §2.5–§2.8, §3.1–§3.3, §4.2** · **019 v1.5.0 T24, T31, T35 (non-waivable)** · **022 P1, P3, P6, P7** · 044 §2, §6, §7 · 023 §3, §5 · `migrations/031_first_factor_and_privileged_session.sql`, `src/services/auth/{credentials,people,sessions,principal,policy,hook,api,authenticator}.ts`, `src/contracts/v1/{routes,schemas,errors}.ts`, `scripts/reencrypt-authenticators.ts` · CLAUDE.md locked decisions 2 and 4.

## Change log

**Version convention** (006 `:6`): a **minor** bump means the content of a decision changed; a **patch** means a statement of fact was repaired with no decision changing.

| Version | Date | What changed | Authority |
|---|---|---|---|
| **1.1.4** | **2026-09-06** | **PATCH — E03-D24 `longbox-e5b.3.34` DISCHARGES §9 R2 and R2a and NARROWS R8. No decision in this record moves and §14 stays signed; what changes is that three residuals stop describing the live system.** **R2a** said `setPassword` has no production caller, so nothing provisions a first factor in a deployment and the un-pended issuance routes are reachable in a seeded database and not by a shop: `POST /api/v1/credentials` is that caller (000-docs/063 §3.3), reached from the operator session on the counter phone, and an integration case takes a shop from NO PASSWORD to a live privileged session over HTTP alone. **R2** said a person forced to re-enrol by a recovery code completes it from a schema-owner CLI: `POST /api/v1/authenticators/offers` and `POST /api/v1/authenticators` are reachable from exactly that session, and 048 §8.1's *nothing else* is now a DECLARED set of three routes rather than a proxy over `requires` (063 §3.5). **R8** is NARROWED and not closed — `enrolOwnAuthenticator` holds BOTH lockout anchors in one transaction, so the routed recovery path serialises against a concurrent password attempt, and `pnpm redeem-recovery-code` is unchanged and remains the declared single-anchor exception. ⚠ **§4.4's `selfService` FLAG IS REPLACED** by a marker in the route table (063 §3.2), and §4.4's sentence *a route that touches … a credential … is not self-service* is NARROWED to *anything beyond the caller's own PERSON* — a credential is the one entry in that list which belongs to a person rather than to a shop or a third party. **§4.4b's rule is GENERALISED to a class** of three acts by 063 §3.3, on its own ground: an act re-presents the factor when its damage outlives the session it was done from. The sections' original text is kept verbatim; the amendments are this row and the appended block below. | E03-D24 → `longbox-security-tenancy-builder` |
| **1.1.3** | **2026-09-05** | **A PATCH — the signature.** Status → RATIFIED; §14 records the signing, the two re-verification verdicts it waited on, and the merge SHA `bd563e4` the bead is closed against. No ruling, invariant, residual or dissent changed. | Acting head, at close of E03-D11 |
| **1.1.2** | **2026-09-05** | **PATCH — one claim MEASURED FALSE and retracted, three notes recorded, four pointers repaired. No ruling moves.** ⚠ **The retraction is the reason this patch exists**: v1.1.0 said the tighter sign-in bucket *"closes the oracle"* and that a known and an unknown address *"start refusing fast at the same attempt count"*. The invariant reviewer measured minute two and found a warmed known address answering **6–16 ms on four attempts of five** while an unknown one paid **about 600 ms on all five**. The cause is a WINDOW MISMATCH: the bucket refills every MINUTE, `LOCKOUT_WINDOW_MS` is FIFTEEN. The bucket cuts the oracle's observation RATE from about 120/min to about 5/min and **does not close the class** — which §9 R10 already said and five other sites contradicted. All six now say the same thing (§4.5a, this log, §2's F2 row, R10, `src/services/rateLimit.ts`, `src/services/auth/api.ts`, the rate-class contract row, CLAUDE.md and 006). **No fix is added, because the only fix is hashing while blocked and 048 §9.3 refuses it.** THREE NOTES, no code change: a copied MANAGER cookie still mints permanent managers and operators — owner-only step-up is the ruling and `mayGrantRole`'s rank cap is what bounds the rest (§4.4b); `authorization_decision` records an ALLOWANCE for an owner attempt that dies at the freshness gate, the same N:1 054 §4.3 accepts (§4.4b); and the eviction is **SHOP-scoped**, said plainly rather than left in a preposition (§4.4a). A K4 probe of re-seal against concurrent verification is recorded in §4.6 with its result — the verify blocked and then SUCCEEDED, so there is **no** spurious refusal and this record never claimed one. Pointers: §10's handoff row 6 no longer routes the escrow's transitive reach to **E13-D01**, which §9 R1 already ruled CLOSED at `77000dd` — the open half is intent-os `spine-u1a.2.3` and 055 §8 I9's FILE half; rule 12's *"the consistency lens's K3"* attribution is dropped, because the dispatched lens raised no such finding — K3 was a question label in the session's own brief; 016's two claim rows from this branch are **renumbered C49/C50**, because E03-D14's C47/C48 landed on `main` in parallel and the later filing yields; and 016's 042 cell reads **v1.5.0**. One test timeout is raised (recovery-code re-enrollment, 23.7 s against a 30 s ceiling). | Invariant re-verification at `55dabd6`; `longbox-security-tenancy-builder` (E03-D11) |
| **1.1.1** | **2026-09-05** | **PATCH — eight statements of fact repaired after the gate re-audit at `55dabd6`, no ruling moved and none reversed.** Every ruling R-A…R-E was verified as recorded and built, §2 byte-identical, the 048/042 amendments clean; what failed was paperwork. **§1's heading still cited `70abeed`** while §0 had been corrected to `0fe33b3`, and §0 called that commit *"the `main` this branch is rebased onto"* when it is the MERGE-BASE (`main` is `d01219f`). **§9 R6 and §12's item 7 routed the N:1 decision row to E03-D15 as OPEN** — it is CLOSED at `689498f`, and 059 v1.1.1 ruled the N:1 **CORRECT** rather than tolerated, so R6 is restated as a closed ruling and §12's item is struck with its reason rather than renumbered around. **§7's count said "all twelve" are database-proved**: it is ELEVEN of FOURTEEN — P11 is the architecture gate, P12 and P14 are unit-level — and "all" claimed database evidence three invariants do not have. **§0 said the gate suite gains five cases**; it gains SEVEN. **§9's inputs cited 054 at v1.1.2 and 019 at v1.4.0**, both since passed. **And every duration in §4.4a and R4 is now labelled a CONSTANT and a PROVISIONAL floor** (042 A3, 021 B16) — the argument is that each act OUTLIVES the session, which holds whatever the constants are. Outside this record: 016 lost a RATIFIED append in the rebase (058's cannon + gate-audit row) and it is restored verbatim; 055 §6's middle cell had been EDITED in place on a ratified record and is restored verbatim with the pin APPENDED; 006's headline said PROPOSED v1.0.0 against its own v1.1.0 body. | Gate re-audit at `55dabd6`; `longbox-security-tenancy-builder` (E03-D11) |
| **1.1.0** | **2026-09-05** | **MINOR — the cannon is dispatched, both lenses return ACCEPT-WITH-CHANGES, and TWO findings add ENFORCEMENT rather than prose. One ruling is reversed, which is what makes this a minor and not a patch.** **(1) The security lens's F1 (HIGH) is upheld and its two "optional" fixes are REQUIRED in this PR.** v1.0.0 offered the privileged session's expiry as the compensating control for a bearer credential; the lens showed that the expiry bounds the SESSION and not one of the ACTS — a copied cookie mints a 24-hour owner invitation and a 15-minute enrollment code, and leaves a PERMANENT owner membership and a 30-day device credential standing. So **§4.4a** makes signing in again EVICT the person's other privileged chains at that shop (nothing did before: a second sign-in simply added a chain, leaving an owner who suspected a copy with no act at all), and **§4.4b** makes naming a second OWNER re-present the second factor in the request. **§9 R4 is REWRITTEN and its claim REVERSED**: the expiry is no longer offered as a bound on the acts, the acts are named with their own lives, and **the reuse detector is DROPPED from the bounds because 048 v1.1.0 R4 struck it as an overclaim** — v1.0.0 cited as a control the very thing 048 had already refused to call one. **(2) F2 is upheld and a sentence is STRUCK.** §4.5's *"holds on the clock as well as in the body"* is false and was measured false — 5.7 ms against 449 ms — so **§4.5a** records the strike, restates 048 v1.2.0's residual as **§9 R10 with the possession-bound clause removed and the channel named**, and takes the optional fix: the sign-in gets its OWN PROVISIONAL per-identifier rate rather than a shop's 120/min, so a known and an unknown address start refusing fast at the same attempt count — **without hashing while blocked**, which 048 §9.3 refuses. **(3) F3/F4 is upheld as a change of ADVERSARY and CHANNEL on a ratified trade**: §8 and **§9 R11** record that a stranger with an owner's email can hold a rolling delay over that owner's three factors, which 048 §9.1 argued about a coworker at a counter. **(4) F5**: `public/app.js`'s `must_reenroll` copy promised a button that does not exist and now names the out-of-band step. **(5) The consistency lens's K2 and K1** land as v1.0.1 already folded them, and **K6** adds a migration-number collision lint as the structural safeguard the lens framed it as. **(6) The invariant review's PASS-WITH-NOTES** adds the fifth lock position's own negative fixture and makes `FIXTURE_SEED` snapshot-aware so `031`'s tightened CHECK is validated against sessions that were ALREADY THERE — it was validating over zero rows. **(7) 055 → v1.1.0** takes §4.7's branch-(b) ruling as an amend-by-a-row (§13 item 3). **Nothing was declined.** | dispatched cannon + invariant review + gate audit → `longbox-security-tenancy-builder` ⚠ **v1.1.2 CORRECTS THE SECOND HALF OF THIS ROW**: the tighter bucket NARROWS that oracle and does not close it — the bucket's window is ONE MINUTE and `LOCKOUT_WINDOW_MS` is FIFTEEN, so a warmed known address falls out of the bucket and back into its lockout fourteen times over, measured at 6–16 ms against about 600 ms in minute two. See §4.5a and §9 R10. |
| **1.0.1** | **2026-09-05** | **PATCH — three statements of fact repaired and one claim NARROWED, no ruling reversed and none moved.** It is a patch and not a minor under 006's third clause, which 050 is the worked example for: *"a record whose ratification section is NOT YET SIGNED is being CORRECTED, not amended — so a pre-ratification NARROWING of a ruling is a PATCH, provided no ruling is reversed."* §14 is unsigned and the ruling in §4.5 — one shared budget, five lock positions, both credential anchors in the sign-in's transaction — is untouched. **(1) §4.5's claim was OVER-SCOPED and is narrowed to the ROUTE.** v1.0.0 wrote that the budget is serialised because *"the only path that takes just one of [the anchors] is a path that does not exist"*; it exists and is `pnpm redeem-recovery-code`, which holds `user_authenticator` alone. The exception is now DECLARED with what substitutes for the missing anchor (schema-owner URL plus shell access, the same substitution the CLI already makes for the password it cannot verify), the unenrolled-person case is named beside it, and **§7 P3 and P9 now say which surface they are about** rather than reading as claims about the system. **(2) A residual this record did not have: `setPassword` has NO PRODUCTION CALLER** — no route and no CLI, only two test files — so the first factor cannot be provisioned in a running deployment and the two issuance routes this bead un-pends are **unreachable in production** until that closes. New row **R2a**, sharper than R2 and routed to the same bead. **(3) Three residuals become R8, R9 and R2a**, and the three PROPOSED aliases shift by one — E03-D23 is claimed by E03-D14's proposal — to **E03-D24 `longbox-e5b.3.34`**, **E03-D25 `longbox-e5b.3.35`** and **E03-D26 `longbox-e5b.3.36`**. | early cannon relay (`martin-kleppmann-reviewer`) via the parent session → `longbox-security-tenancy-builder` |
| 1.0.0 | 2026-09-05 | Initial record. Status PROPOSED; §2's lens positions are builder-drafted and labelled; §14 unsigned. | `longbox-security-tenancy-builder` (E03-D11) |

---

## 0. Evidence posture

Per 018 A1/A3, and with 029 v1.0.0's gate-audit blocker B1 as the governing lesson (a "today" claim asserted at REPRODUCED on the strength of having read a file, later found false):

- **§1's claims are REPRODUCED against `0fe33b3`**, an ANCESTOR of the `main` this branch is rebased onto (`0fe33b3` is the merge-base; `main` is `d01219f`) — not a branch commit, because a branch SHA is not an address a reader who never saw the branch can resolve (053 v1.0.4 B8). *(v1.0.0 wrote `70abeed`, which was the base when the work started and not the base it landed on; the FACTS in §1 are unchanged — every one of them was re-read against `0fe33b3` — and only the address is corrected. The invariant review caught it.)* The merge SHA replaces it at close.
- **§3–§8 are TESTED**, not asserted. The unit half is `tests/first-factor.test.ts` (21 cases) and `tests/privileged-api.test.ts` (**19** at v1.1.0, five added for §4.4a's eviction and §4.4b's fresh factor); the database half is `tests/integration/privileged-session.test.ts` (18) and `tests/integration/authenticator-reseal.test.ts` (6), plus **six** cases added to `tests/integration/totp-replay.test.ts` and five to `tests/integration/append-only.test.ts` for the two triggers, and one to `tests/integration/prior-snapshot-upgrade.test.ts` that validates `031`'s tightened CHECK against sessions the snapshot already held. `tests/contract/architecture-gate.test.ts` gains SEVEN: the fifth lock position's own negative fixture and its positive twin, plus five for the two new tree rules — K3 twice (a column is refused; NAMING it in prose is not, in either dialect) and K6 three times (a duplicate number is refused and both files are named; a GAP is not, which is what keeps `027` legal; and the real `migrations/` directory has one file per number). Where a claim is about the DATABASE rather than the tree — a trigger refusing a rollback, a policy refusing a write — it is proved by execution against `postgres:16` and never by reading the DDL.
- **Ratification will not move anything up the ladder.** §9's residuals are what remains true after this bead. The largest of them is not a gap in the implementation: it is that **one lost value stops every sign-in in every shop at once**, and that is a property of the custody design 055 already ruled on, restated here because 048 §12.4 row 3 left it with no owner and this record is where it lands.

---

## 1. What exists today (REPRODUCED against `0fe33b3`)

| # | Fact | Evidence |
|---|---|---|
| **E1** | **The FIRST factor does not exist.** 048 §4.1 makes `owner`, `manager` and `support_break_glass` sign in with *"email + password"*, and §10.1's M3 lists `user_credential` — but §10.2's implementing-bead table assigns it to **no bead**, and no migration creates it. | `grep -rl user_credential migrations/` → nothing; 048 §10.2's four rows name E03-B02, E03-D09, E03-D06, E03-D07 and E03-D08, none of which claims it |
| **E2** | **The SECOND factor exists and is reachable from nowhere.** `migrations/025` lands `user_authenticator` and its recovery set; `verifyTotp`, `enrollAuthenticator` and `redeemRecoveryCode` are complete and tested. Their only callers are three CLIs running as the SCHEMA OWNER. | `scripts/{enroll-authenticator,retire-authenticator,redeem-recovery-code}.ts`; `AUTH_ALLOWLIST` carries no row for any of them |
| **E3** | **Both ratified session kinds are bound to an enrolled phone.** `app_session.kind` is `CHECK (kind IN ('device','operator'))`, `device_id`/`device_credential_id`/`location_id` are all `NOT NULL`, and `app_session_kind_shape` requires an operator row to name a parent. There is no row shape for a person on their own laptop. | `migrations/020` |
| **E4** | **Two issuance routes are DECLARED and not registered**, each `pending: true` with E03-D11 named — `POST /api/v1/invitations` and `POST /api/v1/device-enrollment-codes`, carrying the permissions E03-B03 decided for them so this bead would inherit an answer rather than choose one. | `src/contracts/v1/routes.ts`; `tests/contract/route-table-scoping.test.ts` asserts both paths are ABSENT |
| **E5** | **The replay guard is enforced by ONE statement and by no constraint.** The app role holds `GRANT UPDATE (last_used_step, updated_at)` on `user_authenticator`, and 048 R19's monotonicity lives only in the service's `WHERE last_used_step < $2`. An actor with the app connection can roll the step back and replay a code inside the ±1 window. | The bead's own note, added 2026-09-04 from PR #82's re-review; `src/db/appendOnlyTables.ts`'s `updateColumns` row |
| **E6** | **Key rotation has a step nobody can take.** `.env.example` documents the additive rotation and names step 2 — *"re-encrypt the V1 rows"* — as *"named work and is not built yet"*. Removing a key before it takes every second factor still sealed under it. | `.env.example`, the `LONGBOX_AUTHENTICATOR_KEY_V1` block |
| **E7** | **Recovery codes are peppered by INHERITANCE, not by decision.** `hashRecoveryCode` is a one-line delegation to `hashWithPepper`, the PIN helper. So 048 §8's fallback dies with the pepper, and no record ever decided that it should. | 055 §2 E4, reproduced at `src/services/auth/secrets.ts` |
| **E8** | **The pepper's backup obligation is ORPHANED, and `.env.example` states a falsehood about it.** 048 §12.4 row 3 hands the pepper's custody to E03-D06 → E03-B05; 050 is RATIFIED and closed and does not mention it. The file tells a reader that *"the way back in is 048 §8's recovery codes"*, which is true for a key removed in a botched rotation and **false for a file loss**, because E7. | 055 §2 E5, §9 item 4b |

**What E1 and E3 mean together, and it is the finding that produced this bead.** 048 §4.1 places the second factor *"inside a session established by password + TOTP within a freshness window"*. Neither half of that sentence existed: there was no password, and there was no session kind that could hold one. E03-D06 shipped the factor with **no route** and said so rather than inventing one — which is why the two most privileged acts in the system reached production as schema-owner CLIs, and why 054 had to record that *"a rule keyed on routes recorded the two most privileged acts in the system nowhere."*

---

## 2. The two-lens cannon — **DISPATCHED**

The parent session convened both lenses against PR #94 at `d0f58cb`, and both
reproduced their findings against a live `postgres:16` rather than reading the
diff — the security lens by exercising the two triggers as the schema owner and
by MEASURING the sign-in's two answers, the consistency lens by tracing the
recovery-code CLI's own transaction. **Their statements are reproduced verbatim
and unedited. v1.0.0's builder-drafted positions are SUPERSEDED rather than kept
beside them**, on 054 §0's precedent and 056 §2's: a draft of what a reviewer
might say is not a review, and leaving both in the record would invite a later
reader to average them.

### 2.1 The security lens (`security-auditor`) — ACCEPT-WITH-CHANGES

> The construction is sound where it is load-bearing and I have verified the two things this bead was built to close: the replay guard is now enforced by the database — as the schema owner I could not roll a step back, hold it still, return it to NULL, edit a sealed column or delete the row, and the app role additionally cannot disable the trigger, cannot set `session_replication_role` and holds no grant on anything but the two mutable columns — and the re-seal carries `last_used_step` forward in every ordering of a concurrent verify I could contrive, with the AAD bound to the row id and a ring missing its old key failing closed rather than writing garbage. What I will not sign is the record's account of what a stolen privileged cookie costs. The thirty-minute expiry is presented as the compensating control for a bearer credential that is deliberately not device-bound, and it is not one: inside that window the cookie mints an owner invitation good for twenty-four hours and an enrollment code good for fifteen minutes, both of which are redeemed anonymously or from the attacker's own newly enrolled phone, and what is left standing afterwards is a permanent owner membership and a thirty-day device credential — so the expiry bounds the session and not a single one of the acts the session exists to perform, and nothing in the product lets an owner evict a copy, because signing in again revokes nothing and the reuse detector 057 R4 lists as a bound is the same detector 048 R4 struck as an overclaim. Second, 057 §4.5 asserts that the sign-in's constant answer "holds on the clock as well as in the body"; it does not, and the measurement is not subtle — a known address inside its lockout delay answers in 5.7 ms where an unknown address costs 449 ms, an eighty-fold single-observation oracle for enumerating who works at which shop, on an anonymous internet-facing route. I endorse 048 v1.2.0's refusal to hash while blocked and I am not asking for that; I am asking that the sentence be struck and that 048's bound — "one bit about a pair the caller already named, on a channel that is already possession-bound" — not be silently inherited by a route where the channel is the open internet and the caller holds nothing. Third and last, the shared per-person budget across three factors is the right call and it is only real because the sign-in takes both anchors in one transaction, which the lint now pins; but it hands a stranger who knows an owner's email a five-minute rolling lockout on that owner's password, TOTP and recovery code alike, for the cost of one request every five minutes, and 048's accepted DoS trade was argued about a coworker holding the counter phone. That is a change of adversary and of channel on a ratified trade, and it belongs in section 8 as a cost this bead incurred rather than one it inherited. Fix the three sentences and this ships.

### 2.2 The consistency lens (`martin-kleppmann-reviewer`) — ACCEPT-WITH-CHANGES

> The schema is right where it matters most — one anchor row per credential, a total composite FK on every rotation chain, database-enforced immutability rather than a grant alone, and pepper versioning landed as columns ahead of the ring that will use them, which is the correct order to build a rotation you can't rehearse yet. What I will not sign is the claim, as currently worded, that the shared three-factor budget is closed by construction: it is closed for the one path this bead added, and a narrower, already-shipped standalone path (the recovery-code CLI) still writes the same counter through a single anchor, protected in practice only by the fact that reaching it requires the same access that would make the budget moot anyway — that is an acceptable residual, but it needs to be named as one, and the comment asserting a now-false precondition needs to be fixed in the same commit that makes it false. With those corrections, and a migration-number collision guard as a structural safeguard rather than a response to this specific PR, I sign.

### 2.3 What both lenses signed without change, recorded because it is evidence

Neither statement is a list of complaints and reading them as one would lose the
half that is load-bearing. **The security lens verified by execution** that the
replay guard is now the database's — as the schema owner it could not roll a step
back, hold it still, return it to NULL, edit a sealed column or delete the row —
that the app role additionally cannot disable the trigger or set
`session_replication_role`, and that the re-seal carries `last_used_step` forward
**in every ordering of a concurrent verify it could contrive**, with a ring
missing its old key failing closed rather than writing garbage. **The consistency
lens signed the schema** — one anchor row per credential, a total composite FK on
every rotation chain, immutability enforced by a trigger rather than by a grant,
and `pepper_version` landed as columns **ahead of the ring that will use them**,
which it calls the correct order to build a rotation you cannot rehearse yet.

Those are the two things this bead was built to close and the one thing §5 defers,
and all three were checked rather than taken on the record's word.

### 2.4 Where each finding landed

| Finding | Ruling | Where |
|---|---|---|
| **Security F1** (HIGH) — the expiry bounds the SESSION and not the ACTS; nothing lets an owner evict a copy; R4 cites a detector 048 R4 struck | **UPHELD, and both "optional" fixes are REQUIRED in this PR.** Signing in again now revokes the person's other privileged chains at that shop (§4.4a), and naming a second OWNER re-presents the second factor (§4.4b). R4 is rewritten: the expiry bounds the session, the ACTS are named with their own lives, and the reuse detector is **dropped from the bounds** with 048 R4's strike cited | §4.4a, §4.4b, §9 R4 |
| **Security F2** — *"holds on the clock as well as in the body"* is false, measured 5.7 ms against 449 ms | **UPHELD; the sentence is STRUCK, not softened.** 048 v1.2.0's residual is restated in §9 R10 **with the possession-bound clause removed and the channel named**, and the optional fix is taken: the sign-in gets its own tighter per-identifier budget, which **cuts the oracle's observation RATE (about 120/min to about 5/min) and does NOT close the class** — the bucket's window is ONE MINUTE and `LOCKOUT_WINDOW_MS` is FIFTEEN, so a warmed known address falls out of the bucket and back into its lockout fourteen times over, so a warmed known address still answers in single-digit milliseconds. Closing it would require hashing while blocked, which 048 §9.3 refuses and this record does not reopen | §4.5a, §9 R10 |
| **Security F3/F4** — a stranger with an owner's email holds a rolling lockout over that owner's password, TOTP and recovery code alike; 048's accepted DoS trade was argued about a coworker at a counter | **UPHELD as a change of ADVERSARY and of CHANNEL on a ratified trade.** It is a cost this bead INCURS and not one it inherits, and it is written into §8 as such, with §9 R11 carrying the residual. The sign-in's own rate constant is part of the answer and is not the whole of it | §8, §9 R11 |
| **Security F5** — the `must_reenroll` copy promises a button that does not exist | **UPHELD.** `public/app.js` names the out-of-band step instead | §9 R2 |
| **Consistency K1** — the recovery-code CLI's header asserts a now-false precondition | **UPHELD**, and fixed in the same commit that makes it false, which is what the lens asked for | `scripts/redeem-recovery-code.ts` |
| **Consistency K2** — the shared-budget claim is closed for ONE path, not by construction | **UPHELD.** §4.5 is scoped to `openPrivilegedSession`; the CLI is a named single-anchor exception; P3 and P9 say which surface they are about | §4.5, §7, §9 R8/R9 |
| **Consistency K6** — a migration-number collision guard, *"as a structural safeguard rather than a response to this specific PR"* | **UPHELD, and built as the lens framed it**: a lint over the directory with a negative fixture, not a check on this branch's own numbering | `scripts/migrationDiscipline.ts`, `pnpm arch` |

**Nothing was declined.** Two things the lenses did not ask for are added beside
their findings and are marked as this record's own: §9 **R2a** (the first factor
has no production caller at all, found while fixing K1's stale sentence) and
§4.5's third part (a person with no live authenticator locks nothing).

---

---

## 3. Decision A — the FIRST factor is `user_credential`, one row per person, hashed under the ONE pepper

> **A password is stored as argon2id over `password ‖ pepper`, in a `user_credential` row that is UNIQUE per person, with a `pepper_version` beside it. The pepper is the SAME value the PIN and the recovery codes use. The row is CONFIG — changed in place — and the three columns a change may move are enforced by an `ENABLE ALWAYS` trigger as well as by a column-scoped grant.**

**One row per person, because the row is an ANCHOR.** 048 §9.1's construction is *"count and verify in one transaction under `SELECT … FOR UPDATE` on an anchor row, because every reader of the count is a writer of the row it is a count about"* — `operator_pin` for a PIN, `user_authenticator` for a code, and this row for a password. `UNIQUE (app_user_id)` is what makes the anchor exist: one row per person, so there is exactly one thing to lock. A schema that allowed two credentials per person would have made the lockout derivation a read of a count nobody held still.

**CONFIG and not append-only, and the reason is 048 §10.1's own.** *"A password is changed in place; versioning the hash would keep every old password's hash forever, which is a liability rather than an audit trail."* What HAPPENED to the row is recorded elsewhere and deliberately: a failed verification is an `auth_attempt` row (§9.1), and a successful one is recorded **nowhere at all** (R16 — a per-person log of when each person signed in is the surface 022 P3 forbids).

**But config is not "anything goes", and this is where the bead's own residual is closed.** The exemption licenses three columns — `password_hash`, `pepper_version`, `updated_at` — and E5's finding one table over is what makes the licence a mechanism rather than a sentence: a column-scoped GRANT with no matching trigger is a rule that a `GRANT` statement in a future migration silently removes. So `migrations/031` ships the grant **and** the trigger in the same file, and the trigger also refuses the `DELETE` a grant layer alone would permit.

### 3.1 ONE pepper, and the name that is now narrower than the job

> **`LONGBOX_PIN_PEPPER` is mixed into every operator PIN, every recovery code and — from this bead — every password. There is no second pepper.**

048 §9.2 already rules one value for the two factors it names; 055 §9 item 11 hands the confirmation here. **Two peppers were considered and refused**, and the argument is not "one is simpler": it is that the separation buys nothing. Every path back in after a pepper loss is authenticated by something under the lost value (055 §2 E4/E6), so splitting the value splits the blast radius of **nothing** while doubling the custody obligation, the number of things to lose and the number of rotations to run.

**The variable keeps its name, and the decision is stated because the name is now misleading.** `LONGBOX_PIN_PEPPER` reads as though rotating it would only affect PINs; it would invalidate every PIN, every password and every recovery code, at once, for every shop. Renaming a boot-required secret is a deploy-coordination step with a real outage window and no security gain, so the correction lands where a reader actually looks — `.env.example`, the constant's own comment, and `PepperConfigError`'s message — and **the rename rides the versioned ring** 055 §9 item 5 asks for (§9 residual R3). A rename now and a ring later would be two coordinated deploys for one variable.

---

## 4. Decision B — the THIRD session kind, and every absence on its row

> **`app_session.kind` gains `privileged`. The row names a SHOP and a PERSON; it names no device, no device credential and no parent, and it MAY name a location. It is not device-bound. Its absolute expiry IS 048 §4.1's freshness window.**

### 4.1 Why it widens `app_session` rather than taking its own table

A separate `privileged_session` table would need its own liveness predicate, its own revocation table, its own rotation, its own reuse detector and its own cookie plumbing — five mechanisms re-derived, four of which are security properties, and every one of them a second place for 048 §3.3's *"liveness is derived"* to be got wrong. 048 §12.4 row 3a already anticipates the alternative and prices it in the schema's own terms.

**One honest divergence from that row, recorded rather than absorbed.** It says *"dropping two `NOT NULL`s"*. It is **three**: `location_id` is as unavailable to a person at a desk as `device_id` is, and the row counted the two device columns without it. The shape CHECK is widened by one disjunct and **TIGHTENED on the other two** — the device and operator disjuncts now assert all three columns explicitly, because they were implied by the `NOT NULL`s a moment ago and are not any more, and a device session with a null `device_id` would be a phone session that names no phone.

### 4.2 The third composite foreign key is not belt-and-braces

041 R1 / 048 K5 makes one FK mandatory: `(rotated_from, app_user_id, device_id)`, so a rotation cannot change WHO the session is for or WHICH device it is on. Under the default MATCH SIMPLE **a composite FK is not checked at all when any referencing column is NULL** — which is why `020` had to add `(rotated_from, device_id)` for the device chain, where `app_user_id` is NULL. A privileged row has a NULL `device_id`, so K5's own constraint is inert on it and `020`'s sibling is inert too. The mirror image closes it:

> **`FOREIGN KEY (rotated_from, app_user_id) REFERENCES app_session (id, app_user_id)`**, with the redundant `UNIQUE (id, app_user_id)` that makes it expressible.

Every chain is then covered by at least one TOTAL check: device chains by the device pair, operator chains by all three, privileged chains by the person pair. Without it, a hostile write could chain one owner's privileged session onto another's and **every liveness predicate in 048 §3.3 would accept it** — a live row, an unrevoked chain, no successor.

**One consequence found on the rebase, recorded because it changed a test rather than the schema.** An operator successor that names a stranger AND keeps the device now violates BOTH the K5 constraint and this one, and PostgreSQL reports whichever referential trigger fires first. That order is the triggers' NAME order — `RI_ConstraintTrigger_c_<oid>`, compared as TEXT — so an OID that gains a digit sorts before a smaller one, and the reported constraint is an artifact of the sequence a particular database was built with. It differed between a local run and CI **on the same commit**. `tests/integration/session-lifecycle.test.ts` case (xi) therefore accepts either name and separately asserts that BOTH constraints exist in `pg_constraint`, because an alternation over two names would otherwise pass while one of them had been dropped.

**And the type system carries the same rule at the other end.** Widening `SessionRow` for the third kind made `device_id` nullable for every reader, and the tempting answer — a `!` at each of the dozen sites that read it — is how a privileged token presented in the `__Host-lb_device` cookie slot becomes a "device session" whose device is NULL, with the tenant resolving, the rate bucket keying on `undefined`, and every downstream fact carrying a device that does not exist. **The narrowing happens ONCE**, in `asDeviceBound`, which checks the KIND and the three columns and returns a refusal rather than a cast.

### 4.3 The freshness window is the absolute expiry, and there is no second column

048 §4.1 requires a privileged action to sit in *"a session established by password + TOTP within a freshness window"*. The obvious build is an `mfa_verified_at` column and a comparison against it. **It is not built.** The absolute expiry is carried unchanged across every rotation — `sessions.ts`'s *"the ceiling belongs to the CHAIN"* — so it already IS the elapsed time since both factors were presented, and a second column holding the same fact is a second thing that can disagree with the first: the shape 040 A8, 042 I5 and 047 §5.1 each refused in turn.

**The consistency lens's draft is right that this rests on a property of `insertSession`**, and the answer is that the property is asserted rather than remembered: `tests/first-factor.test.ts` pins all three lifetimes against the INSERT's own parameters, and `tests/integration/session-lifecycle.test.ts` already pins the carry-across-rotation for the two existing kinds.

### 4.4 It is NOT device-bound, and it MAY name a location

**Not device-bound**, because 048 §4.1 places it on *"any device"* and the device it will actually be on is an owner's laptop this system has never enrolled and never will. Binding it to an enrolled phone would mean the only place an owner could invite somebody is the counter phone — which §4.1 refuses in its own words, reached by making the refusal impossible to obey.

**What stands in for the device binding, stated as a list rather than implied:** a short absolute expiry that is also the freshness window (§4.3); `Sec-Fetch-Site: same-origin` on every mutating request, checked in the hook before anything is read (048 §5.1); a `__Host-` prefixed, `HttpOnly`, `SameSite=Strict` cookie no sibling subdomain can set; revocation by one row; and the reuse detector, which fires here exactly as it does on the other two chains. **That is one control and four properties of the cookie, and the record says so rather than counting to five.**

**The optional location is the one place a value from the request becomes part of the session**, and it is bounded on both sides. `device.enrollment.issue` is LOCATION-scoped (054 §3), and a privileged session stands nowhere — so `authorize()` refuses a location-scoped grant against it, and a location-scoped manager could reach a location-scoped act from a desk **not at all**. So the sign-in accepts an optional `location_id`, checked at issuance against the shop AND against the person's own live grants, and stored on the row. It is a fact about an ISSUANCE and never a value read at act time, which is the property 048 §3.5 protects; a person who names none holds a session that reaches shop-scoped acts only, which is fail-closed.

**The consequence for 042's `requires: null` rule, stated because it is a change.** That field's documentation said null *"ONLY for a route outside the tenant prefix"*, and the GROUND it gave is the real rule: those are the routes for which **no role has been resolved yet**. A privileged session resolves its shop at SIGN-IN, so the two issuance routes sit outside the prefix WITH a resolved role — and the prefix-keyed rule would have exempted the two most privileged acts in the system from the one enforcement site 054 §3 built. **The rule is restated as its own ground:** a route whose caller has a resolved role declares the permission it requires; a route that has no role yet declares null. The hook's privileged branch fails closed on anything else, with **one declared exception** — a `selfService: true` row, whose sole member is signing yourself out.

### 4.4a Signing in again EVICTS a copy, and before this it evicted nothing

> **A privileged sign-in revokes every other live privileged chain that person
> holds at that shop, in the issuance transaction, before the new row exists.**

**This is the security lens's F1 and it is the sharpest thing in the review.** A
privileged session is deliberately not device-bound (§4.4), which the lens
accepts — and v1.0.0 then offered the expiry — `PRIVILEGED_ABSOLUTE_MS`, a CONSTANT and a PROVISIONAL
floor, never a duration this record quotes as a property — as the compensating
control for a bearer credential. **It is not one, and the lens's demonstration is
what settles it**: inside that window a copied cookie mints an owner invitation
good for `INVITATION_TTL_MS` and an enrollment code good for `ENROLLMENT_TTL_MS`
— 24 hours and 15 minutes as the constants stand today, each a PROVISIONAL floor
and not a promise — both redeemed anonymously or from the attacker's own newly
enrolled phone, and what is left standing afterwards is **a permanent owner
membership and a device credential good for `DEVICE_ABSOLUTE_MS`** (30 days on
the same footing). The expiry bounds the SESSION. It bounds not one of the ACTS
the session exists to perform.

**And the remedy an owner would reach for did not work.** Signing in again simply
added a second live chain; nothing in the product ended the first. So a person
who suspected a copy had no act available to them at all — which is worse than an
unbounded window, because it is an unbounded window they cannot close.

Now the ordinary thing is the thing that works: `revokePrivilegedChainsOf` runs
inside the issuance transaction, before the INSERT, so it cannot revoke the chain
it is making room for and a rollback leaves both the old sessions and the absence
of a new one. The revocation carries its own reason, `privileged_superseded`,
rather than `signed_out` — **it is the row somebody points at when they say "I
evicted whatever had my session", and `signed_out` would make that
indistinguishable from clicking a button.**

**AT THAT SHOP, and the scope is a decision rather than a limitation.** A
privileged session names one shop and the revocation is written under that shop's
tenant context, so evicting a chain at another shop would need a cross-tenant
WRITE scope — a widening of 056 §5's closed union, which is a tenancy decision
this bead does not get to take on its own. The property the lens asked for holds
without it: an owner evicts the copy of the session for the shop they are signing
in to, which is the session that copy can spend.

**The eviction is SHOP-SCOPED, and saying so plainly is better than leaving it
in the ruling's preposition.** *"At that shop"* means exactly that: a person
holding privileged sessions at two shops who signs in at one keeps the other. The
narrow scope is deliberate — a person-global sweep would read and write sessions
across tenants, which is a widening of 056 §5's cross-tenant scope union that
this bead did not argue and should not take on the side. The consequence an owner
must be told: **evicting a copy is a per-shop act.**

### 4.4b Naming a second OWNER re-presents the second factor

> **`POST /api/v1/invitations` with `role: "owner"` requires a fresh TOTP code IN
> THE REQUEST. Without it, or with one that does not verify, it is refused —
> and it is the only act on the surface that asks.**

048 §4.1 already puts every privileged act inside a session established by
password + TOTP *"within a freshness window"*, and §4.3 makes that window the
chain's absolute expiry. **That is the right bound for an act whose damage the
expiry bounds, and naming a second owner is not such an act**: the membership is
PERMANENT and carries the power to grant itself again, so a copied cookie spent
here outlives every session in the system and §4.4a's eviction cannot reach it.
So this one act re-presents the factor rather than inheriting it, which turns the
one irreversible thing a stolen cookie can do into something it cannot do without
the owner's phone.

**Only this act, and the narrowness is 022 P2's.** An override must stay cheap; a
ceremony on every invitation would be a tax paid by the ordinary case to defend
the rare one, and an operator membership is revoked by one row. The gate is where
the irreversibility is.

**The freshness check runs BEFORE the rank check, and that order is deliberate.**
A manager asking to invite an owner is asked for a code and only then refused. The
other order is cheaper for them and worse for everybody: deciding *"your role may
not do this"* before asking for the factor turns the route into an oracle for
which roles may name an owner, probeable at no cost. A manager who tries spends
one code; that is the right side to spend it on.

**NOTE the bound this ruling does NOT reach, because it is the price of choosing
owner-only.** A copied MANAGER cookie still mints **permanent managers and
operators** without ever presenting a factor: the step-up is keyed on the role
being NAMED, and only `owner` names it. What bounds the rest is rank, not
freshness — `mayGrantRole` caps every invitation at the caller's own rank (054
§5), so a copied manager cookie can create peers and subordinates and never a
superior. That is a real bound and a smaller one than the step-up, and the choice
is deliberate: asking for a code on every invitation would put the phone in the
loop of ordinary hiring, which §4.4 exists to avoid. **A reader must not take
§4.4b as "a copied cookie cannot create memberships".** It cannot create OWNERS.

**And the audit trail records an ALLOWANCE for an owner attempt that dies at the
freshness gate**, because `authorize()` runs before `requireFreshSecondFactor`
and the decision row is written outside the request transaction (054 §4.3). An
auditor reading `authorization_decision` therefore sees a permitted act that
produced no membership — the same N:1 shape 054 already accepts between decisions
and effects, and consistent with it rather than a new defect. It is stated here
so nobody reads that row as a successful invitation.

**Two mechanical points, both of which a build could get wrong quietly.** The
verification runs in its OWN transaction that COMMITS whatever the verdict,
because the `auth_attempt` row is what 048 §9.1's delay is derived from and
throwing from inside `runIdempotent` would roll the failure back. And
`replayIfSettled` runs FIRST, so a genuine retry replays instead of being asked
for a second fresh code it cannot produce — 048 R19 spends a step exactly once.
Because the two transactions never overlap, no deadlock is constructible between
them and 042 §5.3(b)'s order does not govern the pair; the check is its own
function so `pnpm arch` reads that truthfully rather than seeing one handler.

### 4.5 ONE budget for three factors, and the two anchors that make it real

048 §4.3 rules that TOTP and recovery-code attempts share ONE per-person budget, *"because two forms of one factor with two budgets is one budget an attacker doubles by alternating."* **The first factor is a third form of the same thing** — a value an attacker submits against one named person — so it joins the same budget, and the count lives in one function both files call rather than in two queries that can drift apart.

> **A shared budget across two ANCHORS is the write-skew 048 §9.1 exists to close, and the sign-in closes it for the ROUTE by taking BOTH in one transaction, in a fixed order.**

That order is 042 §5.3(b)'s, extended for the second time:

> **`request_idempotency` INSERT → `app_session` (`FOR NO KEY UPDATE`) → `user_credential` (`FOR UPDATE`) → `user_authenticator` (`FOR UPDATE`) → `scan_session` anchor (`FOR UPDATE`).**

Five positions: the request's IDENTITY, the session that says who is asking, the first factor and then the second saying they are still who they claim, and only then the domain subject. First factor before second is the order the FLOW has anyway — a code presented without a password must not consume a step (R19) — so the lint pins the order the code already wants rather than imposing one on it. `pnpm arch` polices all five over every PAIR, so a handler taking only two of them is still policed.

**⚠ "FOR THE ROUTE" IS THE WHOLE OF THE CLAIM, AND v1.0.0 OVER-SCOPED IT.** That version said the budget was serialised because *"the only path that takes just one of [the anchors] is a path that does not exist"*. **It exists, in this repository, and it is `pnpm redeem-recovery-code`**: `redeemRecoveryCode` takes `lockLiveAuthenticator` and then reads and appends the same per-person counter, holding the SECOND factor's anchor and never the first's. So the honest statement is narrower and is made in three parts:

  1. **Two anchors, and a path serialises only against paths that share one.** Every path testing the FIRST factor holds `user_credential`; every path testing the SECOND holds `user_authenticator`. The ROUTE holds both in the declared order, so it serialises against either class — which is what makes the route's own budget exact.
  2. **`pnpm redeem-recovery-code` is a DECLARED SINGLE-ANCHOR EXCEPTION, and what substitutes for the missing one is not a check but an access requirement.** It runs as the SCHEMA OWNER through `resolveMigrateUrl`, so reaching it needs the owner's database URL **and shell access on the host** — which is the same substitution the CLI's own header already argues for 048 R20's first half, the password it cannot verify. It therefore cannot be raced by a network caller at all; the only race it can lose is an operator racing themselves, and the cost of that race is one extra attempt against a budget the same operator could reset by hand.
  3. **A person with NO live authenticator locks nothing on the second-factor path**, because `lockLiveAuthenticator` returns nothing to lock. That is bounded by there being no factor to verify: `verifyTotp` refuses such a person after paying the decoy's cost (048 §9.3), and no sign-in can succeed through it.

**Neither the exception nor the unenrolled case is a hole in the ROUTE's budget**, which is the budget an attacker can reach; both are recorded because a claim about a shared counter that is true of one path and asserted of all of them is exactly the kind of sentence 048 §9.1 exists to stop being believed. §9 R8 carries the residual and §7 P3 says which path it proves.

**The asymmetry that is left, stated rather than discovered:** an UNKNOWN address consumes no PER-PERSON budget and can consume none — there is no row to anchor on and no person to key a count on. What bounds it instead is §4.5a's per-identifier bucket, which is keyed on what was SUBMITTED precisely so that it does not care whether the address resolves.

### 4.5a The constant answer does NOT hold on the clock, and v1.0.0 said it did

> **v1.0.0 wrote that the branch *"still pays the decoy's argon2id cost, so 048
> §9.3's constant answer holds on the clock as well as in the body"*. THAT
> SENTENCE IS STRUCK. It is false, and the security lens measured it: a known
> address inside its lockout delay answers in 5.7 ms where an unknown address
> costs 449 ms — an eighty-fold, single-observation oracle for enumerating who
> works at which shop, on an anonymous internet-facing route.**

The mechanism is not a bug and is not being changed. 048 §9.1 refuses to run
argon2id while a person is inside their delay, because hashing on demand is a
denial-of-service surface whose rate the attacker sets; 048 §9.3 records the
timing residual that follows and this record does not reopen either. **What was
wrong was the claim, and one thing beneath it.**

048 §9.3 bounds its own residual as *"one bit about a pair the caller already
named, on a channel that is already possession-bound"* — and that bound was
written about a PIN on an enrolled phone behind a counter. **It does not transfer
to this route, and inheriting it silently is the error this section exists to
undo**: here the channel is the open internet and the caller holds nothing at all.
§9 R10 restates the residual with the possession-bound clause removed and the
channel named.

**And the optional fix is taken — but it NARROWS the oracle and does not close
it, which v1.1.0 claimed and v1.1.1 measured false.** §4.5's per-identifier bucket
now carries its own PROVISIONAL floor — five per identifier per minute — instead
of inheriting a shop's 120/min ordinary rate. That cuts the observation RATE the
oracle yields from about 120 to about 5 per minute. **It does not make the two
answers indistinguishable, and the reason is a WINDOW MISMATCH nobody costed**:
the bucket refills every MINUTE while `LOCKOUT_WINDOW_MS` is FIFTEEN, so a
warmed known address drops out of the bucket and back onto its lockout roughly
fourteen times an hour. The invariant reviewer measured minute two directly — a
known address answered **6–16 ms on four of five attempts** while an unknown one
paid **about 600 ms on all five**. The class is intact; only its bandwidth moved.

Recording it that way is the point of this subsection. The direction is still the
one 048 §9.3 permits — both answers cheap rather than one expensive — and no
argon2id runs while blocked. **Closing the class would require hashing while
blocked, which 048 §9.3 refuses and this record does not reopen**, so what stands
is a narrowed residual with its own row (§9 R10) and not a fixed defect.

### 4.6 Key rotation's second step: a re-seal is a NEW ROW that supersedes

048 §4.2 makes rotation additive and calls step 2 *"a later FACT-producing job"*. `pnpm reencrypt-authenticators` is that job, and its shape is decided here:

> **A re-seal RETIRES the predecessor `replaced` and INSERTS a successor sealed under the current key version, in ONE transaction, carrying `last_used_step` forward. It does not edit the sealed column.**

**It writes a new row because the AAD is the row's id** (048 R18). A ciphertext re-computed in place is possible, but the column is declared immutable by `migrations/031`'s trigger — and it is declared immutable because *"a sealed secret is written once"* is the sentence that makes a MOVED ciphertext fail to authenticate rather than decrypt to a working factor. A rotation that carved an exception into that sentence would remove the guarantee for every row, permanently, to save one INSERT.

**`last_used_step` is carried forward, and this is the one thing a re-seal can get silently wrong.** The successor is a new row with a NULL replay guard unless the value is copied, and a NULL guard means the code the owner used thirty seconds ago is valid again — 048 R19's replay, reintroduced by a maintenance job. `tests/integration/authenticator-reseal.test.ts` presents exactly that code.

**A re-seal and a concurrent verification do not fight, and this was PROBED
rather than reasoned.** The invariant reviewer ran a verification against a
person whose row was being re-sealed: the verify BLOCKED on the re-seal's lock
and SUCCEEDED after it committed, because both paths reach the row through the
same accessor and therefore the same anchor. **There is no spurious refusal, and
this record never claimed one** — the result is recorded because §0 says this
section is TESTED and not asserted, and a probe that finds nothing is still the
evidence.

**The secret does not change, so nobody re-scans anything.** `.env.example`'s step 2 said *"a retirement and a fresh enrollment per person"*, which reads as a forced re-enrollment; it is corrected in the same commit. And the recovery set is deliberately NOT reissued: recovery codes are argon2id digests under the pepper and are not sealed under this ring at all, so a key rotation does not reach them and reissuing would invalidate the slip in the owner's drawer for a reason the owner cannot see.

### 4.7 Recovery codes keep the pepper — branch (b), against the cannon's recommendation

055 §9 item 4a RECOMMENDS branch (a): 128-bit recovery codes hashed **without** the pepper, so 048 §8's fallback survives a pepper loss. **Branch (b) is taken — keep the pepper, keep ten characters — and the ground is 048 R20, which the recommendation predates in effect.**

> **A recovery code substitutes for the SECOND factor only. It is never accepted without the password, never on its own, and never in place of the password.** The password is hashed with the same pepper (§3.1, and 048 §9.2 says so). **So a pepper loss takes the FIRST factor whatever `hashRecoveryCode` does**, and branch (a) buys no pepper-loss survivability at all — while trading away the ergonomics 048 §8.1 ratified: *"a 26-character string on a slip in a drawer is a string that gets photographed instead."*

**What the cannon's finding WAS right about, and it is the half this record keeps:** the dependency was inherited by function delegation rather than decided. It is decided now, with its argument on the function, and **055's own condition for branch (b) is met in terms**: *"recovery codes are NOT a fallback for a custody loss, only for a lost phone"* is written into 048 §8, into `.env.example` and into `hashRecoveryCode`'s own comment.

**The residual this leaves is 055's, not this record's**, and it is not softened: a pepper loss is a total authentication outage with no in-band exit. §5 is where it is written down.

### 4.8 The shown-once code travels OUTSIDE the stored response body

The two issuance routes write an `invitation` and a `device_enrollment_code` — rows that outlive the response and are not cookies — so 042 §5.1's authentication-act class does not reach them and each takes a real `request_idempotency` row. **But the response body §5.3 STORES must not contain the code.** `invitation` holds `sha256(code)` and nothing else; storing the plaintext in a jsonb column would put a live credential in the database on the one route whose entire custody story is *"shown once, stored nowhere"*.

> **The code is part of the RESPONSE and not part of the STORED response, exactly as a `Set-Cookie` is.** The idempotent closure returns the body without it; the code is spliced on afterwards. A retry after a lost response therefore gets a truthful `201` with the invitation's id, its expiry and **no code** — and the owner issues another and lets the first expire, which is what `scripts/issue-invitation.ts` already tells them to do.

This does **not** widen 042 §5.1's exemption class: the routes take the row like any other mutating route. It clarifies what §5.3 stores, and 042 gets an amend-by-a-row saying so (v1.5.0), because a response that differs from its own replay is a contract somebody will otherwise "fix".

---

## 5. The pepper's custody, backup and rotation — 048 §12.4 row 3's orphan, re-homed

055 §2 E5 found this obligation handed to a bead whose record never mentions it. It lands here. Four questions, answered in terms.

**What is lost if the pepper is lost.** Every operator PIN, every password and every recovery code becomes unverifiable **in the same instant, in every shop**. There is no in-band path back: 048 §8's recovery codes are hashed with it (§4.7), the password they substitute a factor for is hashed with it, and 048 §8.2's Longbox-operated break-glass is held by a role whose own second factor sits behind a password hashed with it. **No artifact may describe this as recoverable**, and 055 RULING 6 fixes the sentence a shop is owed in its own terms.

**Who holds it, and where the escrow is.** 055 RULING 1 adopts escrow for all three loss-bearing secrets, with its own `path_regex` block, an exhaustive and TESTED recipient list, and the VPS host key excluded. **055 RULING 4 records that the escrow DOES NOT EXIST YET** and that the deployed posture is Option B — the accepted-risk interim — bounded by a cohort limit that stops at Pilot A. **This record changes none of that and adds one row to it:** the pepper's blast radius is now larger than 055 measured, because `user_credential` exists and did not before. 055 §6's table already says *"and (once E03-D11 lands) every password"*; that clause is now true.

**The rotation shape, decided here and built later.** 048 §9.2 fixes it — *"peppering is versioned, and a rotation re-peppers each credential at its next successful verification rather than by a mass rewrite of a table nobody can decrypt"* — and the column is in the schema (`operator_pin.pepper_version` since `020`, `user_credential.pepper_version` from `031`). The shape it will take is 050 §4's, borrowed rather than invented, the same one the authenticator ring already uses:

> **`LONGBOX_CREDENTIAL_PEPPER_V<n>`. Every version present in the environment can VERIFY; the HIGHEST present is what a new hash is written under. A successful verification against an older version re-hashes under the highest and moves `pepper_version` in the same transaction — which is legitimate precisely because these three tables are CONFIG and their `updateColumns` already name the two columns it moves. `LONGBOX_PIN_PEPPER` is accepted as V1 for compatibility, and the contract step that removes it is the rename §3.1 defers.**

**It is NOT built in this bead**, and the deferral is stated rather than discovered: the ring changes the signature of every hashing and verifying call site and their tests, in a bead that already lands a migration, a session kind, four routes, two triggers and a CLI — and the rotation it enables cannot be REHEARSED until 055's escrow exists, because a rotation drill with no second copy of the old value is a drill that can only fail. §9 residual R3 names it.

---

## 6. What this record does NOT decide

- **The FIRST factor's issuance surface.** There is no route that sets a password. `pnpm register-shop` and the invitation redemption create people; a password is set out of band today. **Enrolling a second factor is likewise still `pnpm enroll-authenticator`** — so a person whose recovery code forced a re-enrollment (§7's `MFA_REENROLLMENT_REQUIRED`) completes it from a CLI. §9 residual R2 names the bead.
- **Passkeys.** 048 §4.2 defers them on the recovery ground, and `user_authenticator.kind` remains a CHECK enum with one member.
- **The screens.** Every view this record implies is E05's, under 022 P6's WCAG 2.2 AA obligation. `public/app.js` carries a copy string for each new code because 042 §4.2's declaration is only meaningful if a client honours it, and **those strings are not the registered ones** — 021's T26 pre-send is where those are decided.
- **The transactional delivery of an invitation.** 048 §7.2 refuses to invent a mailer and this record does not either. A code is read off a screen and handed over in person.
- **`auth_attempt`'s retention window**, which 048 §12.4 row 4b gives E03-B09 and which this bead makes slightly larger by adding a third method to it.
- **Whether operator attribution became non-repudiable.** It did not, and the third principal does not change it: 048 §3.5's RULE is extended to the privileged session by a row on that record (§13 item 1), because a password and a code prove possession of two secrets and not the presence of a person — a shoulder-surfed code and a written-down password are the same class of fact as a watched PIN. **No artifact may describe a privileged act as proof of who performed it.**
- **Any locked decision.** 2, 4 and 5 outrank this record. §3.1's pepper comes nearest to locked decision 2 and does not touch it: that rule governs PROVIDER credentials named by `key_ref`, and a pepper is a process-environment value that is never in the database at all.

---

## 7. Invariants

Each is falsifiable and names the test that decides it.

| # | Invariant | Test |
|---|---|---|
| **P1** *(048 §4.1, I11)* | **A privileged surface is unreachable from an operator session, even for an owner.** A session established by PIN on the counter phone is refused `PRIVILEGED_SESSION_REQUIRED` on both issuance routes, and the refusal is structural: a privileged route reads `__Host-lb_priv` and never the other two cookies. | `tests/integration/privileged-session.test.ts` |
| **P2** *(048 §9.3)* | **Every sign-in refusal is ONE code with no diagnosis.** A wrong password, a wrong code, an unknown address, a shop the person holds nothing at, a role that is not privileged and a person inside their delay all answer `SESSION_REQUIRED`, byte-identical after the correlation id. | same |
| **P3** *(048 §9.1, §4.3, 057 §4.5)* | **One budget, three factors, ON THE ROUTE.** Four wrong PASSWORDS make a correct password-plus-code sign-in wait; the count names all three methods; the sign-in holds both anchors in one transaction, first factor first. **It does NOT assert that every path holds both** — `pnpm redeem-recovery-code` holds one, by §4.5's declared exception — and the test is written about the route because the route is the surface an attacker can reach. | `tests/first-factor.test.ts`, `tests/privileged-api.test.ts`, `tests/integration/privileged-session.test.ts` |
| **P4** *(019 T24, non-waivable)* | **A location-scope refusal is byte-identical to an absent shop.** A location-scoped manager who did not name their storefront gets `404 SHOP_NOT_FOUND` from the enrollment-code route — the same answer a caller with no membership at all receives — and gets `201` after naming it. | `tests/integration/privileged-session.test.ts` |
| **P5** *(048 R19; the PR #82 residual)* | **The replay guard is enforced by the DATABASE.** A step that moves backward, stands still or returns to NULL is refused by an `ENABLE ALWAYS` trigger, as the SCHEMA OWNER, with the row unchanged; so is any edit to the sealed secret, its nonce, its key version or its owner; so is a DELETE. | `tests/integration/totp-replay.test.ts` |
| **P6** *(048 §10.1)* | **The first factor is config for three columns and immutable for the rest**, enforced by a trigger as well as by a column-scoped grant, with `UNIQUE (app_user_id)` making the anchor one row. | `tests/integration/append-only.test.ts`, `tests/app-role-grants.test.ts` |
| **P7** *(048 §4.2, R18; 057 §4.6)* | **A re-seal moves the key version and nothing else.** The successor opens under a ring holding ONLY the new key, the predecessor is retired `replaced` in the same transaction, `last_used_step` is carried forward and the code that spent it is still refused, and a ring that cannot open the old row throws rather than writing garbage. | `tests/integration/authenticator-reseal.test.ts` |
| **P8** *(019 T31, non-waivable; 057 §4.8)* | **The shown-once code is never in the stored response body**, and the email is never in the request hash. Asserted over every `request_idempotency` statement the route issues, and over the stored row itself. | `tests/privileged-api.test.ts`, `tests/integration/privileged-session.test.ts` |
| **P9** *(048 R20, I15's first two cases)* | **A recovery code is a second factor and never a first — ON THE ROUTE, and the scoping is deliberate.** Without the password it is refused; in place of the password it is refused; with the password it succeeds, retires the factor in the same transaction, and yields a session that reaches only its own sign-out. **`pnpm redeem-recovery-code` verifies no password and never will**: 048 R20's first half is unenforceable from a shell tool, and what stands in for it is that running one needs the schema owner's database URL and access to the host (§4.5, and the CLI's own header). So P9 is a property of the HTTP surface, not of the system, and §9 R9 says so where somebody quoting it will see it. | `tests/integration/privileged-session.test.ts` |
| **P10** *(054 §3, §4.3)* | **Every privileged act is decided at ONE site and recorded once.** `enforcePermission` has exactly two callers — the hook's tenant branch and its privileged branch — a privileged route with no `requires` and no `selfService` row is REFUSED, and the service writes no second decision for an act the hook already allowed. | `tests/contract/permission-enforcement.test.ts`, `tests/privileged-api.test.ts`, `tests/integration/privileged-session.test.ts` |
| **P11** *(042 §5.3(b), I22)* | **Five lock positions, policed over every pair.** | `tests/contract/architecture-gate.test.ts` |
| **P13** *(057 §4.4a; the security lens's F1)* | **Signing in again EVICTS a copy.** A second privileged sign-in revokes every other live privileged chain that person holds at that shop, in the issuance transaction and BEFORE the new row, with reason `privileged_superseded`; the evicted cookie is refused on its next request. | `tests/privileged-api.test.ts`, `tests/integration/privileged-session.test.ts` |
| **P14** *(057 §4.4b; the security lens's F1)* | **Naming a second OWNER re-presents the second factor.** `role: "owner"` with no fresh code is refused and writes nothing; one that does not verify is refused with the SAME code; `manager` and `operator` are not asked at all; the verification commits in its own transaction before the idempotent one, on a different held connection. | `tests/privileged-api.test.ts` |
| **P12** *(057 §4.2)* | **The cookie slot is not the kind.** A privileged row presented in a device-bound slot is refused, and so is a row of the right kind whose columns are null. | `tests/first-factor.test.ts` |

**One refusal on these routes is deliberately untested, and the absence is
reasoned rather than overlooked.** The hook's `PERMISSION_DENIED` on the two
issuance routes is reachable only by a person whose live role holds neither
`membership.invite` nor `device.enrollment.issue` — and among the roles that can
hold a privileged session at all (048 §4.1's three), that is exactly
`support_break_glass`, whose grant list 054 §3 makes EMPTY on purpose. A test
would therefore assert that an empty list grants nothing, which
`tests/auth-permissions.test.ts` already pins character by character and
`rbac-matrix` already exercises per route. **No test is owed; the reachability is
recorded here so a later reader does not read the gap as an oversight.**

**Two of the fourteen are SURFACE-SCOPED and say so on their own rows** — P3's shared budget and P9's "never a first factor" are properties of the HTTP surface, because `pnpm redeem-recovery-code` is a declared exception to both (§4.5, §9 R8/R9). **And ELEVEN OF THE FOURTEEN are proved against a database the suite seeds itself** — the other three are proved where they live and nowhere else: **P11** is the lock order, which is a property of the SOURCE and is asserted by `pnpm arch`'s contract suite, and **P12** and **P14** are unit-level, over the resolver's cookie-slot refusal and the fresh-factor gate. Saying "all" would have claimed database evidence for three invariants that have none, because §9 R2a means no other kind exists yet: a shop cannot reach any of these routes until something provisions a password. The invariants are not weaker for it — they are about what the code does when it is reached — but a reader counting them as evidence that the flow is LIVE would be counting the wrong thing.

---

## 8. What it costs, stated rather than argued away

- **A third cookie and a third chain.** 048 §3.6 argued two cookies rather than one because the principals have different lifetimes; a third repeats that argument and adds a third thing a client can hold. The pairing rule does NOT extend to it — a privileged session sits on nothing, so there is no pair to mismatch — which is one fewer check and one more shape a reader has to know about.
- **A privileged session standing nowhere cannot reach a location-scoped act.** §4.4's optional location is the answer, and it is an extra field on a sign-in form that most people will never fill in and that a location-scoped manager must.
- **`user_credential` is a fourth table under the ONE pepper**, so §5's blast radius grew in this bead and 055's interim posture now covers more.
- **A privileged request costs one extra read.** `mfaState` runs on every privileged request rather than only at sign-in, which is stronger than 048 §8.1 asks for — a factor retired from another surface puts the session in that state too — and it is a read the operator flow does not pay.
- **The re-encryption job holds a row lock per person.** One transaction per person rather than one for the table, so a second-factor verification anywhere blocks behind at most one row rather than behind the whole estate.
- **A sign-in refusal now writes an `auth_attempt` row against the shop the caller NAMED**, once both factors have passed. That is reachable only by somebody who has already authenticated, which is why it is acceptable; it is stated because it is a shop's audit substrate growing on a value a caller supplied.
- **⚠ THE SHARED BUDGET HANDS A STRANGER A LOCKOUT OVER SOMEBODY ELSE'S SIGN-IN, AND THIS BEAD INCURS THAT COST RATHER THAN INHERITING IT** (the security lens's F3/F4). 048 §9.1 accepts a denial-of-service trade in explicit terms — *"a coworker can slow another operator down by mistyping their PIN"* — and the argument that made it acceptable is the channel: a shared counter phone, behind a counter, in a shop. **The adversary here is different and so is the channel.** A stranger who knows an owner's email address, over the open internet, can hold a rolling delay across that owner's password, TOTP and recovery code alike, for the cost of one request every few minutes — and the delay is shared precisely because §4.5 made it shared. **That is a change of adversary and of channel on a ratified trade, and it is this record's to own.** What bounds it is 048 R5's shape, unchanged and load-bearing: the lockout **degrades to a growing delay and never to a door that closes**, so the worst outcome available is a wait, and the owner's own next correct attempt still succeeds after it. §4.5a's tighter per-identifier bucket bounds how fast a stranger can drive it; nothing prevents it, and §9 R11 says so.
- **The sign-in carries its own rate constant**, which is one more PROVISIONAL floor for somebody to tune and one more number that must never be quoted as a security property (042 A3, 021 B16).
- **Inviting an owner costs a code.** 022 P2 makes friction a design defect, and this is friction — deliberately, on the one act §4.4b argues cannot be bounded any other way, and on no other act.

---

## 9. Residual risk — what this bead does NOT close

| # | Residual | Owner |
|---|---|---|
| **R1** | **A pepper loss is a total authentication outage with no in-band exit**, and the escrow that 055 RULING 1 adopts DOES NOT EXIST. This bead makes the blast radius larger by adding the password to it. The live posture is 055 RULING 4's bounded interim. | **E03-D12 `longbox-e5b.3.22`** (the escrow, CLOSED as a DECISION; its BUILD is 055 §8's contract table and does not exist). ⚠ **E13-D01 is CLOSED at `77000dd` and is therefore NOT an owner** — v1.0.0 routed the transitive reach to a bead that had already landed. What remains open is **intent-os `spine-u1a.2.3`** (the estate's restore-only age key, which `KEY-CUSTODY.md` row 13 records as not existing) and **055 §8 I9's FILE half**, which cannot be tested until the escrow file exists |
| **R2** | **There is no route that sets a password and none that enrols a second factor**, so a person forced to re-enrol by a recovery code completes it from a schema-owner CLI. The `MFA_REENROLLMENT_REQUIRED` refusal is therefore honest about a state the wire cannot leave. | **PROPOSED `E03-D24` (`longbox-e5b.3.34`)** — *build the credential self-service surface: set a password, enrol a second factor, and reissue a recovery set, all inside a privileged session*. Not created by this bead; the session files it |
| **R2a** | **⚠ THE FIRST FACTOR CANNOT BE PROVISIONED IN A RUNNING DEPLOYMENT, AND THIS IS SHARPER THAN R2.** `setPassword` is exported through the module's door and has **NO production caller** — no route, and no CLI either; its only callers are two test files. So a deployed system has no way to give anybody a password, `POST /api/v1/privileged-sessions` cannot succeed for any real person, and **the two issuance routes this bead un-pends are unreachable in production until a provisioning surface exists** — the CLIs remain the only working path, exactly as they were. **What this bead therefore delivers is the SHAPE and the enforcement, tested end to end, and not a usable sign-in**, and no artifact may describe the issuance routes as available to a shop until R2a closes. It is stated as its own row rather than folded into R2 because R2 is about a state a person can get INTO and this is about a state nobody can get OUT of. | **PROPOSED E03-D24 `longbox-e5b.3.34`** — the same bead as R2, whose scope grows to include provisioning the first factor at all |
| **R8** | **The shared per-person budget has TWO anchors, and one path holds only one of them** (§4.5). `pnpm redeem-recovery-code` writes and reads the counter through `user_authenticator` alone, so it does not serialise against a concurrent password attempt. It is an accepted single-anchor exception because reaching it needs the schema owner's database URL and shell access on the host, which is the same substitution the CLI already makes for the password it cannot verify — a network caller cannot race it. **The route's budget, which is the one an attacker can reach, is exact.** | Accepted; it would close by giving the recovery flow a route, which is **E03-D24 `longbox-e5b.3.34`** |
| **R9** | **P9 is ROUTE-SCOPED: "a recovery code is never a first factor" is true of the HTTP surface and not of the system.** `pnpm redeem-recovery-code` verifies no password, by design and by necessity (048 R20's first half is unenforceable from a shell tool), and substitutes operator-shell access. Anybody quoting P9 — a C-row, a partner sentence, a support answer — must carry the scope with it. | Stated here and on P9; 021 owns the enforcement at the T26 pre-send, as it does for 048 §3.5's RULE |
| **R3** | **The pepper does not rotate.** `pepper_version` is a column nothing moves, and §5's ring is decided and unbuilt. 055 §9 item 5 assigns the build here; this record discharges the DECISION half and defers the build with its reason. | **PROPOSED `E03-D25` (`longbox-e5b.3.35`)** — *build the versioned credential-pepper ring and re-pepper at next successful verification*. Not created by this bead |
| **R4** | **A privileged session is bearer material with no device binding, and its expiry (`PRIVILEGED_ABSOLUTE_MS`, a PROVISIONAL floor) bounds THE SESSION AND NOT THE ACTS.** ⚠ **v1.0.0 got this wrong in two ways and both are corrected here.** It offered the expiry as the compensating control, and the security lens showed what the window actually buys an attacker: **an owner invitation good for `INVITATION_TTL_MS`**, **an enrollment code good for `ENROLLMENT_TTL_MS`**, each redeemed anonymously or from the attacker's own phone — and what is left afterwards is **a PERMANENT owner membership and a device credential good for `DEVICE_ABSOLUTE_MS`**. **Every number in that chain is a CONSTANT and a PROVISIONAL floor** (24 hours, 15 minutes, 30 days as they stand): they are named as constants because the argument is that each act OUTLIVES the session, which is true whatever the constants are, and quoting them as durations would state a property nobody measured (042 A3, 021 B16). Every one of those outlives the session that minted it. **And v1.0.0 listed the reuse detector among the bounds, which 048 v1.1.0 R4 STRUCK as an overclaim in its own words** — it fires only when the legitimate client subsequently rotates, so it is a later signal that a theft happened and never a barrier. What is TRUE after §4.4a and §4.4b: an owner can now EVICT a copy by signing in, and the one act whose damage nothing else bounds — naming a second owner — needs the phone. The rest stands as accepted, on 048 §7.4's terms one principal up. | Stated here; the end state is 048 §4.2's passkeys, deferred on the recovery ground |
| **R10** | **The sign-in's refusals are constant in the BODY and not on the CLOCK** (§4.5a). A known address inside its delay is refused before any hashing; an unknown one pays the decoy. 048 §9.3 accepted that residual and bounded it as *"one bit about a pair the caller already named, on a channel that is already possession-bound"* — **and that bound does NOT transfer here**: this channel is the open internet and the caller holds nothing. §4.5a's tighter bucket **narrows the window rather than closing the class**, and v1.1.2 states the size of that narrowing rather than leaving it to a reader: the observation RATE falls from about 120/min to about 5/min, and nothing else moves, because the bucket's window is ONE MINUTE and `LOCKOUT_WINDOW_MS` is FIFTEEN, so a warmed known address falls out of the bucket and back into its lockout fourteen times over — measured at 6–16 ms against about 600 ms in minute two. **No artifact may repeat 048's possession-bound clause about this route.** | Accepted; hashing while blocked is REFUSED (048 §9.3) and this record does not reopen it |
| **R11** | **A stranger with an owner's email can hold a rolling delay over that owner's password, TOTP and recovery code together** (§8). It is the cost of §4.5's shared budget and it is a change of adversary and channel on 048 §9.1's accepted trade. 048 R5's shape is what keeps it survivable: the lockout is a delay that grows and never a door that closes. | Accepted and owned by this bead, not inherited; §4.5a's per-identifier floor bounds the rate |
| **R5** | **`scripts/register-shop.ts` still has its own two `INSERT INTO app_user` statements.** `upsertPerson` folded the two that were the same act; the bootstrap ones were left alone because a merge would drag that script's first-transaction semantics into the ordinary path. | **PROPOSED `E03-D26` (`longbox-e5b.3.36`)** — *fold the shop-registration person INSERTs into `upsertPerson` or record why they differ*. Not created by this bead |
| **R6** | **NOT A RESIDUAL — RULED CORRECT.** An `authorization_decision` row is written per REQUEST rather than per EFFECT, so a client retrying an issuance under the same `Idempotency-Key` writes a second decision for one act. v1.0.0 filed that as an open residual against E03-D15; **059 v1.1.1 ruled the N:1 CORRECT rather than tolerated** and REFUSED the dedup key, and E03-D15 is **CLOSED at `689498f`**. The row stays in this table because a reader who met the property here in v1.0.0 would otherwise be left looking for a fix that is not coming. | **CLOSED — 059 v1.1.1, E03-D15 `longbox-e5b.3.25`** |
| **R7** | **`user_credential` carries no tenant policy** and is a declared RLS exemption, on `app_user`'s reasoning: a password belongs to a person who may hold memberships at several shops. 056 §11 R9's residual therefore covers one more table. | **E03-D21 `longbox-e5b.3.31`** (OPEN) |

---

## 10. Alternatives considered

**A1 — A separate `privileged_session` table.** *Rejected*; §4.1. Five mechanisms re-derived, four of them security properties.
**A2 — A `mfa_verified_at` column for the freshness window.** *Rejected*; §4.3. A second thing that can disagree with the first.
**A3 — Bind the privileged session to an enrolled device.** *Rejected*; §4.4. It makes 048 §4.1's own refusal impossible to obey.
**A4 — A second pepper for the password.** *Rejected*; §3.1. It splits the blast radius of nothing and doubles the custody obligation.
**A5 — 128-bit unpeppered recovery codes (055's recommendation).** *Rejected*; §4.7. Under R20 it buys no pepper-loss survivability and costs the ergonomics 048 §8.1 ratified.
**A6 — Store the shown-once code in the idempotency response body.** *Rejected*; §4.8. A live credential in a jsonb column on the one route whose custody story is "stored nowhere".
**A7 — Let a privileged route with no `requires` through.** *Rejected*; §4.4. It is the fail-open 054 §3 removed from the tenant branch, arriving one principal over.
**A8 — Re-encrypt the sealed column in place.** *Rejected*; §4.6. It carves an exception into the sentence that makes a moved ciphertext fail to authenticate.
**A9 — A shop-scoped `location_id` taken from the request at ACT time rather than at issuance.** *Rejected*; §4.4. 048 §3.5's rule is that the location is a property of the session, and a value read at act time is a value a caller chooses per request.
**A10 — Hash while blocked, to make the sign-in's two answers cost the same.** *Rejected*; §4.5a. It hands an attacker a way to make the server spend argon2id at a rate they choose, which 048 §9.3 refuses for the session token and refuses harder here. The budget is tightened instead, so both answers become cheap rather than one becoming expensive.
**A11 — Bind the privileged session to a device after all, to close R4.** *Rejected*; §4.4's ground is unchanged and the lens accepted it. The answer to a copied cookie is §4.4a's eviction and §4.4b's re-presented factor, not a binding that makes the owner's own laptop unusable.
**A12 — Require a fresh code on EVERY privileged act.** *Rejected*; §4.4b. 022 P2 makes an override cheap by design, and a ceremony on every invitation taxes the ordinary case to defend the rare one. The gate is where the irreversibility is.
**A13 — Evict a person's privileged chains at EVERY shop on sign-in.** *Rejected for now*; §4.4a. It would need a cross-tenant write scope — a widening of 056 §5's closed union — which is a tenancy decision this bead does not get to take alone, and the property the lens asked for holds without it.
**A14 — Give the recovery-code CLI a password prompt so P9 holds system-wide.** *Rejected*; §4.7 and §9 R9. A shell tool has no session and no way to hold a verification open across an operator's decision, so the check's whole strength would be that somebody typed into a terminal they were already trusted with. The access requirement is the honest substitute and is named as one.

---

## 11. Consequences

**What gets better.**
- **048 §12.4 rows 3 and 3a are discharged**, and with them the last two `pending: true` rows E03-D11 owned. The two most privileged acts in the system are **expressible on a surface that enforces privilege**, rather than only on a CLI whose sole control is who can run it. ⚠ **Expressible and not yet usable**: §9 R2a records that nothing provisions a first factor in a running deployment, so the routes are reachable in tests and in a seeded database and not by a shop. That is a smaller claim than the one this bullet would otherwise make, and it is the true one.
- **The replay guard becomes a database guarantee.** E5's finding is closed by a constraint rather than by a statement, which is 048 R19's own standard: *"the database decides, not the application."*
- **Key rotation has a second step**, so removing an old key stops being an act nobody can safely take.
- **`.env.example` stops telling a reader a falsehood** about what survives a custody loss (055 §9 item 4b, applied verbatim).
- **The permission rule stops being keyed on a proxy.** "Outside the prefix" was a correct stand-in for "no role yet" while every role came from a URL; naming the ground makes the rule survive the next principal.

**What gets worse, stated plainly.**
- **Three session kinds, three cookies, two resolvers.** The identity module is now the largest thing in `src/services/`, and 048 §12.1's line stands: one engineer maintains an authentication system, and the subsystem that has to keep being right just grew.
- **The pepper's blast radius grew** (§5, §9 R1) in a bead that could not close the escrow.
- **A privileged session is a bearer credential whose life is `PRIVILEGED_ABSOLUTE_MS`, a PROVISIONAL floor** (§9 R4) — never quoted as a duration in any artifact, because a floor quoted as a property is a measurement nobody took (042 A3, 021 B16).
- **The record defers two builds it decided** (§9 R2, R3), and a decided-but-unbuilt rotation is a rotation nobody has rehearsed.
- **The bead ships a sign-in nobody can use yet** (§9 R2a). `setPassword` has no production caller, so the surface this record spends nine sections on is proved end to end and reaches no shop until E03-D24 lands. Stating it as a consequence rather than as a footnote is the point: a reader who takes *"the issuance routes are un-pended"* as *"an owner can invite somebody over HTTP today"* would be wrong.

---

## 12. What this record hands to other beads

| # | Artifact | Owner |
|---|---|---|
| 1 | The credential self-service surface — set a password, enrol a factor, reissue a recovery set **and, per R2a, PROVISION THE FIRST FACTOR AT ALL** | **PROPOSED E03-D24 `longbox-e5b.3.34`** |
| 2 | The versioned pepper ring and the re-pepper-on-verify job (055 §9 item 5's build half) | **PROPOSED E03-D25 `longbox-e5b.3.35`** |
| 3 | The shop-registration person INSERTs | **PROPOSED E03-D26 `longbox-e5b.3.36`** |
| 4 | The registered operator copy for the four new error codes | **021** at the T26 pre-send; **E05** builds the screens |
| 5 | `auth_attempt`'s retention window, now covering a third method | **E03-B09** |
| 6 | The escrow that makes §5's custody statement a posture rather than an interim | **E03-D12 → 055 §8's contracts.** ⚠ **NOT E13-D01** — v1.0.0 named it here for the transitive reach and it was already CLOSED at `77000dd` (§9 R1 rules on it). What is actually open is intent-os **`spine-u1a.2.3`** — the estate's restore-only age key, which `KEY-CUSTODY.md` row 13 records as not existing — and **055 §8 I9's FILE half** |
| 7 | A tenant policy for the person-scoped tables, now one table larger | **E03-D21** |

_(v1.0.0 listed an eighth item here — the idempotency-keyed decision row, routed to E03-D15. It is struck rather than renumbered around: 059 v1.1.1 ruled the N:1 CORRECT and REFUSED the key, so there is nothing to hand over. See §9 R6.)_

---

## 13. Amendments this record performs on ratified records

Each is an **amend-by-a-row**: the original text is left verbatim and the amendment is appended with its version, per the idiom 048 §7.4, 042 §5.1 and 053 already use.

1. **048 → v1.6.0.** §4.1, §4.2, §8.1, §9.2, §10.1, §10.2 and §12.4 rows 3/3a gain RULED-at-v1.6.0 paragraphs recording what this bead built and what it decided; I11 and I15's first two cases are marked TESTED; §12.4 rows 3 and 3a are marked DISCHARGED.
2. **042 → v1.5.0.** §5.1 records the shown-once code's position (§4.8) and adds the privileged sign-in and its sign-out to class one's members; §5.3(b) records the fifth lock position (§4.5).
3. **055 → v1.1.0.** §9 item 4a asked E03-D11 to implement *"whichever is ruled"* and left both branches open; §4.7 rules **branch (b)**, so 055 takes an amend-by-a-row recording the ruling and **pinning §6's middle row CONDITIONAL** — which item 4a itself named as the consequence of that branch. A minor rather than a patch, because a decision 055 delegated has been made and 055's own table changes meaning.
4. **No 019 threshold and no 022 principle is amended.** Per `019:202`, a 022/019 conflict halts and escalates by a 006 row rather than being reconciled by a build agent; none arose.

---

## 14. Ratification

**RATIFIED at v1.1.3, 2026-09-05.** Signed by the acting head at close of E03-D11 with the merge SHA `bd563e46325854a45acd8a8cf6a264693e0085ec` (PR #94, 8/8 required checks; 1711 unit / 785+1 integration; coverage 81.59 over an 80 floor). The signature authenticates §3–§8 as decided (one credential row per person; ONE pepper; a third, non-device-bound privileged chain evicting its siblings at sign-in; owner-role invitations behind a fresh second factor; five lock positions; the database-enforced replay guard; re-seal as a superseding row; recovery codes keep the pepper — branch (b), 055 v1.1.0), §2 as the lenses' own words, and §9's residuals — R4 (bearer material; the expiry bounds the session, not the acts), R10 (the enumeration oracle is NARROWED, not closed) and R11 (a stranger-held rolling lockout) — as the honest residue no artifact may soften. Filed against real beads: E03-D24 `longbox-e5b.3.34`, E03-D25 `.3.35`, E03-D26 `.3.36`. The paragraph below is the PROPOSED-era text, kept as history.

**UNSIGNED (as written at v1.1.2).** The acting head signs at close of E03-D11, after `longbox-gate-auditor` on this record and `longbox-invariant-reviewer` on the code, and after the two-lens cannon §2 names. The signature will record the merge SHA the bead is closed against.

> _Signed:_ ______________________  _Date:_ __________


---

## 16. Amendment — E03-D24 `longbox-e5b.3.34` (2026-09-06), appended at v1.1.4

Per the amend-by-a-row idiom this record already uses on 048, 042 and 055: **every sentence above is kept
verbatim** and what follows is appended.

**§9 R2 — DISCHARGED.** `POST /api/v1/authenticators/offers` and `POST /api/v1/authenticators` are reachable
from a `must_reenroll` privileged session, and enrolling lifts the gate BY PREDICATE (`mfaState` reads the new
row). `MFA_REENROLLMENT_REQUIRED`'s registry entry and the client's copy both stop describing a state the wire
cannot leave. **The CLI is not deleted**: it is demoted to break-glass in its own header, and it remains the
only path for a FIRST enrolment (063 §5 R1).

**§9 R2a — DISCHARGED.** `POST /api/v1/credentials` gives `setPassword` its production caller. The principal is
`device+operator`, which is forced rather than chosen — a privileged session is what a password is FOR, and a
device session alone names no person — and the route PROVISIONS and never REPLACES, because 048 §3.5 rules that
an operator session is not non-repudiable. **The qualifier this record attached to every description of the
issuance routes may now be dropped**: an owner can invite somebody over HTTP, having first set a password on
the counter phone and enrolled a second factor out of band.

**§9 R8 — NARROWED, not closed.** §4.5's claim was that the shared budget is serialised FOR THE ROUTE because
the sign-in takes both anchors, and that `pnpm redeem-recovery-code` is a declared single-anchor exception.
`enrolOwnAuthenticator` is now a SECOND routed path holding both, in the declared order, so the recovery flow a
network caller can reach serialises too. The CLI is unchanged and the exception stands in its own terms.

**§4.4 — the escape hatch MOVED, and its rule is NARROWED.** The `selfService: true` flag on
`AuthAllowlistRow` is replaced by `requires: "self_service"` in the route table (063 §3.2), because a privileged
route's authority living in two tables meant a reviewer had to read both. The fail-closed default is unchanged
and now has two literal sites. §4.4's list of things that are *not* self-service — a membership, a device, a
shop's configuration — is unchanged; **a credential leaves it**, on the ground §4.4 itself gives: those are a
SHOP's or a THIRD PARTY's, and a password is the caller's own and tenant-free.

**§4.4b — the ruling is unchanged and its RULE now names a class.** Naming a second owner still re-presents the
factor. So do replacing a password and replacing a live authenticator, on §4.4b's own sentence: the damage
OUTLIVES the session, and the freshness window bounds sessions rather than acts.
