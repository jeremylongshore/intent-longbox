# Decision Record — Secret and BYOK Custody, Rotation as Facts, Deletion that Means Something, and Who Pays for a Call

**Version:** 1.0.1
**Status:** **DRAFT — pending `longbox-gate-auditor` verdict.** Nothing here is ratified; nothing here may be cited as settled by another record until the gate audit returns and §14 is signed.
**Bead:** E03-B05 `longbox-e5b.3.5` — *Build secret, BYOK and service-account vaulting, rotation, deletion and spend ownership* (epic LBOX-E03 `longbox-e5b.3`, gate G2) — see 000-docs/014 §8 row E03-B05 (`014:397`)
**Filed:** 2026-09-04 · **Author:** `longbox-security-tenancy-builder` · **Owner:** parent session (acting head of board) · **Ratifier:** the two-lens cannon in §2, then §14
**Sensitivity:** Restricted internal (014 §10). It names variables, tables and hosts; it contains no value of any kind and never will.
**Scope of this commit:** **the RECORD HALF ONLY.** No `src/`, `migrations/`, `scripts/` or `tests/*.ts` change lands with it. The identity substrate this record's actor model rests on — `app_user`, `membership`, `device`, `app_session` and its rotation chains, `operator_pin` — is landing under **E03-D09** (`longbox-e5b.3.16`), the implementing bead filed by doc 048 (RATIFIED v1.1.0), in a separate PR that owns migrations `019+`. **E03-B02 is that decision record and is closed; it never owned a migration**, and this record says so because v1.0.0 got the attribution wrong. **This record cites that substrate; it does not create it, and the code half of E03-B05 is a follow-on commit on this same bead.**

**Governed by:** CLAUDE.md **locked decision 2** (BYOK, Claude default, *raw keys never in the database*, `shop_credentials` holds key refs) and **locked decision 4** (the Hickey model) · 019 **T31** (non-waivable), **T32**, **T13a**, **T15**, **T34**, **T35** · 021 (external-claims registry; B16, §2 retirement list) · 022 **P1, P3, P5, P7, P8** · 034 (tenancy) · 041 (append-only, correction, purge) · 042 (envelope, codes, idempotency, §8.4's PROVISIONAL-floor class) · 043 (outbox) · 044 (migration discipline) · 046 (threat model; §5 A7/A14/A15, §6 G-9/G-10/G-16/G-25, §7 the secret inventory, §9.2's obligation on this bead) · 047/048 (identity; 048 §3.5's **RULE** on attribution) · the estate SOPS + age secrets standard · the intent-os ops deploy contract.

## Change log

| Version | Date | Change | Ratified by |
|---|---|---|---|
| 1.0.1 | 2026-09-04 | **Two acting-head amendments before the gate audit; no ruling reversed.** **(1) The `EnvironmentFile` moves to tmpfs.** v1.0.0's Q1 ruling said "root-owned, mode-600 `EnvironmentFile`" and did not say *where*, which reads as a persistent path under `/etc` or `/var` — a plaintext copy on persistent disk, which the estate secrets standard forbids by name (its anti-pattern list: *"Decrypting SOPS files to disk — the wrapper uses `/dev/shm` tmpfs"*). Amended in §2 Q1, §3, §5 and §13: the file lives on tmpfs (`/run/intentsolutions/longbox.env` under a `RuntimeDirectory=`, mode 0600 root, or `/dev/shm`), is written by `ExecStartPre=` running `sops -d` at every start, and never exists under `/etc` or `/var`. **A fourth ground against any persistent form is added** — the borg fabric excludes `/run` and `/dev/shm` by construction, so tmpfs is the only form that cannot reach a backup. The deletion path collapses from four steps to three, because the restart now *re-derives* from the SOPS source rather than merely re-reading a file somebody else updated. **The security lens's dissent on A2 is unchanged** — it was about the flat environment, not about the file's location, and the amendment neither answers it nor weakens it. **(2) Migrations `019+` are attributed to their real owner:** **E03-D09** (`longbox-e5b.3.16`, the identity substrate). E03-B02 is the ratified decision record and is closed; it never owned a migration. Corrected in the header, §2 Q5 and §10. **No invariant, no floor and no rejection changes**, and §14 is still unsigned. | acting head, pre-audit |
| 1.0.0 | 2026-09-04 | First filing. The record half of E03-B05: six questions put to the two-lens cannon (§2), five decisions (§3–§7), the 046 rows this closes and the ones it does not (§8), eleven invariants the code half must satisfy (§9), the migrations it will need by name (§10), and what is deliberately not decided (§13). **DRAFT pending gate audit.** | — |

## 0. Evidence posture

Every claim about the running system in §1 is **REPRODUCED at `ffaa225`** with a `file:line`. Every claim about a ratified decision cites the record and section. **No number in this record is a measurement**, and the two numbers it does set (§6.4) are declared PROVISIONAL floors in 042 §8.4's sense — safety floors, non-evidentiary, never quoted as capacity, cost or reliability in any artifact at any class (021 B16).

**No statute is cited here.** Where a question is legal — whether a retired credential's *name* is regulated data, what a shop must be told when its key is destroyed — it goes to the E01-B05 counsel batch by name (§13), on 041 §8.7(d)'s practice.

**Two words this record does not use about itself.** It does not call the result a *vault* in any external sentence and it does not call anything *secure*: 021 §2 retires "secure" until E03-B10's independent review, and 021 B16 makes every `control` and `contract` line a commitment rather than an achievement. Internally, "vaulting" is the bead's own title and is used as such.

## 1. What exists today, REPRODUCED at `ffaa225`

| # | Fact | Evidence |
|---|---|---|
| **E1** | A `key_ref` is **exact membership in a closed, per-shop set** — `LONGBOX_<SLUG>_` + one of six suffixes — checked *before* `process.env` is read, and the check takes the shop | `src/providers/credentialPolicy.ts:50-57` (the closed suffix set), `:80-81` (`KEY_REF_PATTERN`), `:199-205` (`resolveKeyRef(keyRef, shopSlug)`) |
| **E2** | The same shape is a CHECK the app role cannot switch off, plus a Zod contract for a write surface that does not exist yet | `migrations/014_credential_namespace_and_host_allowlist.sql`; `credentialPolicy.ts:224-246` |
| **E3** | A refusal is a **structured event carrying a shop, a name and a reason, and no value** — 019 T31's second predicate (`019:114`, v1.3.0 A5) has its instrument | `credentialPolicy.ts:153-184` |
| **E4** | The **silent global-env fallback is gone for a shop that has rows**; the global vars remain the default only for a shop that has declared none | `src/providers/registry.ts:14-24` (the comment stating it), `:176`/`:180` (`envOr("ANTHROPIC_API_KEY")` / `OPENAI_API_KEY`, reached only after no row resolved) |
| **E5** | The eBay pair's second half is a **named member** of the closed set, not a `${key_ref}_SECRET` derivation | `credentialPolicy.ts:45-48`, `:56`; `registry.ts:212` passes the `"_SECRET"` suffix through the same `resolveKeyRef` |
| **E6** | The gateway override `LLM_BASE_URL` + `LLM_API_KEY` **outranks every per-shop credential** and is host-checked at boot, unconditionally | `registry.ts:1-8`; `.env.example:174-179` |
| **E7** | `cost_log` records provider, model, tokens and an estimated dollar figure — and **nothing about which credential paid** | `migrations/001_init.sql:158-168`; `src/services/costLog.ts:15-51` |
| **E8** | `appendCostLog` is the **single writer** of `cost_log`, and that is a checked rule, not a convention | `src/services/costLog.ts`; the `cost_log` single-writer rule in `scripts/architectureRules.ts`, run by `pnpm arch` (044 §6) |
| **E9** | `cost_log` is **append-only by trigger** and `ENABLE ALWAYS` | `migrations/001_init.sql:176`; `migrations/006_append_only_enable_always.sql:67`; declared at `src/db/appendOnlyTables.ts:168-169` |
| **E10** | There is **no rotation record of any kind**. `shop_credentials` holds one row per `(shop_id, kind)` and the resolver reads `ORDER BY created_at DESC LIMIT 1` — so a second row is not a *version*, it is a shadow the system silently ignores | `registry.ts` `loadShopCredential`'s query |
| **E11** | There is **no deletion path for a credential**. Nothing retires a row, nothing unsets a variable, nothing restarts a process, and offboarding has no receipt | absence; `/usr/bin/grep -rn "retire\|revoke" src/providers` → zero lines at `ffaa225` |
| **E12** | A shop with **no credential row spends the estate's key silently** — no row, no flag, no report says whose money bought the call | `registry.ts:176-180` reached with no announcement; `cost_log` has no owner column (E7) |
| **E13** | 019 T31 names **six surfaces and two cadences**; CI covers **the repository and one cadence**. The other five surfaces — DB columns, logs, error payloads, LLM prompts, bead notes and 006 rows — and the **nightly** cadence have no instrument | 046 §7.3 (`046:409-419`), unchanged at `ffaa225` |

**What E1–E6 amount to, stated plainly so this record does not take credit for them:** the *addressing* problem is solved. E03-D01 (`longbox-e5b.3.11`) closed 046 G-10 and discharged its K-2 and K-3 amendments — a credential row can no longer name another shop's variable or an unregistered host, and the gateway pair is scope-checked at boot. **What is left is everything about the key's life: where its value lives, how it changes, how it dies, and who pays for the calls it makes.** That is this bead.

## 2. The cannon — two lenses, six questions, and the acting head's rulings

The two lenses are stated as positions, not as summaries, and both are preserved whether or not they won. **Lens S** is the application-security position (blast radius, revocability, the insider and the backup as adversaries). **Lens D** is the durable-state and operations position (what a fact is, what a mirror proves, what an operator can actually run at 09:00 on a Tuesday).

### Q1 — Where does a shop's BYOK key live at rest: an environment variable per `key_ref` (today), a SOPS-encrypted per-shop file the process decrypts in memory, or an encrypted column with a KMS-less envelope key?

**Lens S.** *"The environment is a flat, process-wide namespace: every variable is readable by every line of code in the process, by anything that can read `/proc/<pid>/environ` as the user, and by any crash reporter or `console.log(process.env)` that ever ships. A per-shop SOPS file decrypted in memory is strictly smaller: the process opens one shop's material when it needs it, the plaintext lives in one variable in one function's scope, and destroying the key is destroying a file rather than editing a unit and hoping somebody restarts. The column is the worst of the three and it is not close."*

**Lens D.** *"An in-process SOPS decrypt introduces a second custody path with no operator behind it. The estate already has one: the age private key at `/etc/intentsolutions/age.key` (640 root:adm), the SOPS file in the repo, the decrypt at deploy time, and the value delivered to the unit as a mandatory `EnvironmentFile=` with no leading `-` so systemd refuses to start without it. That path is drilled, monitored and understood. A second path that only Longbox uses is a second path only Longbox debugs — at 02:00, on a shop's key, with no runbook. And the security gain is smaller than it looks: a process that can decrypt on demand holds the age key for the life of the process, so the thing an attacker steals is the decryptor rather than the plaintext, which is a lateral move, not a reduction."*

> **RULING (acting head). The environment variable per `key_ref` STAYS as the process-visible form. Its ONLY legitimate source is a SOPS-encrypted file decrypted into an `EnvironmentFile` that the unit declares mandatorily — and that file lives on TMPFS, never on persistent disk. The process never decrypts, never reads a SOPS file, and never writes one. The encrypted database column is REJECTED outright and this record closes the question.**
>
> **AMENDED at v1.0.1, and the amendment is a correction rather than a refinement.** v1.0.0 said *"decrypted at DEPLOY time into a root-owned, mode-600 `EnvironmentFile`"* and did not say **where**, which reads as `/etc/…` or `/var/…` — **a plaintext key on persistent disk, which the estate secrets standard forbids in its anti-pattern list by name**: *"Decrypting SOPS files to disk — the wrapper uses `/dev/shm` tmpfs."* A mode-600 root-owned file is still a file, and the property that matters is not its mode; it is that it survives a reboot, a snapshot and a backup pass.
>
> **The corrected mechanism, precisely.** The unit declares `RuntimeDirectory=intentsolutions` and `EnvironmentFile=/run/intentsolutions/longbox.env` — **no leading `-`**, so systemd refuses to start without it (the fail-closed property Lens D argued for, unchanged) — mode **0600**, owner root. An **`ExecStartPre=`** step runs `sops -d` and writes that file **at every (re)start**. `/dev/shm` is the acceptable alternative where a `RuntimeDirectory=` is unavailable. **A path under `/etc` or `/var` is forbidden**, and so is any deploy step that writes the plaintext somewhere first and moves it.

**Four grounds for tmpfs, and the fourth is the one that is structural rather than procedural.** (i) The estate standard forbids the persistent copy outright. (ii) A reboot leaves no plaintext anywhere, so the window in which a stolen disk image yields a shop's key is the machine's uptime rather than forever. (iii) The deletion path in §2 Q3 gets shorter and more honest: because `ExecStartPre` re-derives the file from the SOPS source, a **restart is a re-derivation**, so removing the line from the SOPS file and restarting is sufficient — there is no separate step in which somebody must remember to edit a file on the host, and therefore no step that can be skipped. (iv) **The borg fabric excludes `/run` and `/dev/shm` by construction** — they are tmpfs, they are not in the backup set, and no exclude rule has to be maintained for them. Every persistent form, by contrast, is a form whose exclusion is a line in a configuration file that somebody could remove; and a plaintext key that reaches the borg repository reaches the VPS replica and then Backblaze B2 under Object Lock, which is the same 30-day-undeletable trap that condemns the database column. **The column and the persistent `EnvironmentFile` fail for the same reason, and it is worth writing down that they are one failure and not two.**

**Why the column is rejected, in the terms the locked decisions already fix.** Locked decision 2 says *raw keys never in the database*, and an envelope-encrypted column is a raw key one function call away — the envelope key would live in the same process that holds the ciphertext, so the encryption defends against an adversary who can read the database but not the process, and no such adversary exists in 046 §2.3's matrix. Worse, and this is the argument that would hold even if the crypto were perfect: **the database is backed up.** The estate's fabric pushes to Backblaze B2 under **Object Lock, governance mode, 30 days** — so a key written to a column on Monday is in an immutable offsite copy that cannot be deleted until 30 days after the shop revoked it. A credential store whose deletions take 30 days to become true is not a credential store. Add locked decision 4: a row cannot be edited, so a rotated column value is either an UPDATE the trigger refuses or a second row that leaves the first ciphertext in the table forever.

**And the honest cost of the ruling, which Lens S is right about.** The environment is flat, and nothing in this system prevents `console.log(process.env)`. That is not answered by a custody design; it is answered by a detector, and §9 I1 is that detector. **The ruling adopts Lens D's mechanism and Lens S's instrumentation, and it is only defensible with both.**

**The corollary that makes this a decision rather than a description of today.** A variable is legitimate only if a SOPS file is its source. A key typed into a shell, exported by hand, or added to a unit file directly is a key with no custody record — and there is no way for the process to tell the difference. So the check is at the *deploy* boundary, not the process boundary: **the unit fails to start when the rendered `/run/…` file contains a `LONGBOX_*` name the SOPS file does not declare**, which under the amended mechanism is nearly free — the same `ExecStartPre` that writes the file is the only thing that ever writes it, so a name it did not put there is an anomaly with exactly one explanation. That is E13's to build; it is named here so it is not discovered as a gap (§13).

### Q2 — What is the rotation model, given append-only?

**Lens D.** *"`retired_at` on the version row is the obvious design and it is illegal here. Setting it is an UPDATE, and `forbid_mutation()` refuses it — correctly. Retirement is a separate fact, exactly as 041 §8 makes a deletion a `media_deletion` row and a hold's release a `retention_hold_release` row. Two tables, and the second one is the interesting one: it is the receipt."*

**Lens S.** *"Then be careful what 'live' means, because a resolver that reads 'newest introduced' is one missing retirement row away from serving a rotated-out key forever, and that is worse than no rotation: the shop believes it rotated. Liveness has to be a predicate over both tables, computed at read time, with no cached copy and no status column — the same construction 043 uses for the outbox, and for the same reason."*

> **RULING. Rotation is two append-only tables and no status column.** `shop_credential_version` records an introduction — `(id, shop_id, kind, key_ref, version_no, introduced_at, authored_by, envelope)`. `shop_credential_retirement` records a retirement — `(id, shop_id, credential_version_id, reason_code, retired_at, authored_by, envelope)`, `UNIQUE (credential_version_id)` so a second retirement of one version fails loudly rather than writing a duplicate, which is `003:149`'s move applied to a credential.
>
> **Liveness is a predicate, never a column:** a version is live when it has an introduction and **no** retirement. The resolver takes the **newest live version** for `(shop_id, kind)`. **Zero live versions for a shop that has any version row at all is a `CredentialRefusedError`, never a fall-through to the global environment** — E4's rule, extended from "has a row" to "has a version".
>
> **The overlap window is real and is bounded by a PROVISIONAL floor, not by an automatic action.** Introducing version N+1 does not retire version N; a person or an offboarding does. An overlap older than **PROVISIONAL 7 days** is a **006 row and a report line**, never an auto-retirement — auto-retiring a credential is how a shop stops working at 09:00 on a Tuesday with nobody watching, and the whole point of an overlap is that the old key keeps working while the new one is proven.

**What the request records, and what it must never record.** `cost_log` gains `credential_version_id` — a **reference**, which is 041 §8.4's whole move: the log holds references, not values. It does not gain the `key_ref`, and it certainly does not gain the key. **The single-writer rule is what makes this cheap and what makes it enforceable**: `appendCostLog` (E8) is the only writer of `cost_log` and `pnpm arch` fails a second one, so the column is populated in one function and cannot be half-populated by a caller that forgot.

**And a subtlety worth writing down, because it will be got wrong.** `authored_by` on a version row is an **attribution of record** and nothing stronger. 048 §3.5's **RULE** binds here without amendment: no artifact, dissent, registered claim or partner sentence may describe it as non-repudiable or as proof of who rotated a key. A person who watched a PIN can introduce a credential version, and the row will say it was theirs.

### Q3 — What does deletion mean, per storage form, and what is the receipt?

**Lens S.** *"'Deleted' has to mean the process cannot obtain the value. For a variable that is two steps — remove the line from the SOPS file, redeploy — plus a third that everybody forgets: **restart the process**, because a running process's `process.env` is a copy taken at exec, and removing the variable from the unit changes nothing until the unit restarts. A design that ships the first two steps and calls it deletion is a design that lies in a receipt."*

**Lens D.** *"And say the part nobody wants in the record: for a BYOK key, Longbox cannot delete anything. The key is the shop's, held by the provider, and it stays valid at Anthropic whether or not this repository ever mentions it again. Every historical version of the SOPS file still contains it, in git and in every backup. So the only complete deletion is **revocation at the provider**, and that is the shop's act, not ours. A receipt that implies otherwise is the false statement 041 §8.2 spends a section preventing."*

> **RULING. "Unreachable" is defined per form, the definition is written into the receipt, and the receipt never claims the provider-side half.**
>
> | Form | What "unreachable" requires | What it does NOT achieve |
> |---|---|---|
> | **Environment variable on a tmpfs `EnvironmentFile`** (the ruling in Q1, as amended) | (a) the `LONGBOX_*` line removed from the SOPS file and the file re-encrypted; (b) **restart**, which re-derives `/run/intentsolutions/longbox.env` from the SOPS source through `ExecStartPre` and therefore both drops the variable and destroys the previous plaintext; (c) the retirement row from Q2. **THREE steps at v1.0.1, not four** — the amendment removed the one that was a person editing a file on a host | The value remains in every prior SOPS revision in git and in every backup of the repository. Nothing here reaches the provider |
> | **A persistent `EnvironmentFile` under `/etc` or `/var`** (v1.0.0's unstated reading, forbidden at v1.0.1) | the same, **plus** an edit or deletion on the host that a redeploy might not perform, **plus** every backup generation that already copied it | it does not achieve unreachability either: the plaintext is in the borg repository, the VPS replica and B2 under Object Lock. **Same failure as the column** |
> | **SOPS file decrypted in memory** (rejected in Q1, stated for completeness) | (a) and (c), minus the restart only if the process re-reads per call | identical residual |
> | **Encrypted column** (rejected) | an UPDATE the append-only trigger refuses, or a DELETE locked decision 4 forbids — and the ciphertext survives in an Object-Lock backup for the lock window regardless | it does not achieve unreachability at all, which is the third reason it is rejected |
>
> **The receipt is the retirement row plus a 006 entry, and it is minimal in 041 §8.7(c)'s sense** — it says *what was made unreachable and by which of the four steps*, and it says **nothing about the key**. It carries one further field and it is the honest one: `provider_revocation_instructed_at` — the moment the shop was **told to revoke at the provider**, which is a fact about Longbox's act. **There is no field asserting that the shop revoked**, because that is a claim about somebody else's system that this system cannot check, and 018's rung rules forbid recording an unverified third-party act as a fact.
>
> **Offboarding (041 §8, the offboarding formula in `.beads/formulas/`) runs all three steps or it is not an offboarding**, and its evidence is the retirement row plus the restart's deploy receipt. A retirement row without a restart is the false statement §8.2 forbids, and §9 I7 makes it impossible in the direction that matters: **after a retirement row, resolution refuses even while the variable is still set** — so the code half stops serving the key one commit before the operations half stops holding it.

### Q4 — Who pays, may a shop without a key use the service account at all, and what happens at the ceiling?

**Lens D.** *"BYOK spend is the shop's and the service account is Longbox's — that is not in dispute. The dispute is E12: today a shop with no row spends the estate's key and **no row anywhere says so**. 019 T13a is cost per verified draft and T15 is the variable-cost line; both read `cost_log`; and `cost_log` cannot currently distinguish a call the shop paid for from one Longbox did. That is not a reporting gap, it is a ledger that mixes two people's money."*

**Lens S.** *"And it is a security property, not only an accounting one. A shop that can reach the service account is a shop that can spend an unbounded amount of somebody else's money by looping — which 042 §8.4 already recognised as a circuit-breaker case. Locked decision 2's 'no global fallback for shops with rows' closes the confusion case; it does not close the abuse case for shops with none."*

> **RULING, in four parts.**
>
> **(a) Every `cost_log` row is attributed to exactly one owner.** `spend_owner` is `NOT NULL` and takes exactly two values, `shop` and `longbox`. It is **derived, never declared**: it is `shop` when a live per-shop credential version resolved the call and `longbox` when the global environment or the gateway override did. There is no third value and no `unknown` — a call whose owner cannot be determined is a call that should not have been made.
>
> **(b) A shop with no credential may use the service account, and the affordance has an expiry.** Locked decision 2's rule is about shops *with* rows and stays exactly as it is. A shop with none continues to resolve the global key — **because the pilot cohort is one shop and forcing BYOK before E01-B06's paperwork exists would block the pilot on a procurement step nobody has run** (§13, Q5). But it stops being silent: the call is attributed `longbox`, the owner's weekly report says so in words, and **the service account is a pilot affordance, not an architecture** — after G3 a shop without a live credential version is a configuration error, not a supported deployment. That transition is E01-B07's and E12-B08's; it is named here so it is not rediscovered as a surprise when the second shop arrives.
>
> **(c) The ceiling is a PROVISIONAL floor in 042 §8.4's class, and it is per owner.** 042 already fixes `shop_metered_budget` at **PROVISIONAL 500 paid identify calls/shop/day** for a shop spending its own money. **A shop on the service account gets a separate, lower floor: PROVISIONAL 150 paid identify calls/shop/day** — still six times Pilot A's entire 25-item batch in one day (`019:148`), so it cannot bind on work, and it fires on a loop in minutes. **Neither number is a measurement**, neither is ever quoted as capacity, cost or throughput at any class (021 B16), and 018 C3's red line applies unchanged: a floor may be raised freely; lowering one after seeing a result it would change requires a 006 row saying so in those words. Every throttle event is counted from day one and a throttle that fires during normal pilot work is itself a 006 finding.
>
> **(d) At the ceiling the system degrades to the MANUAL PATH and never to a stub answer.** The paid call stops; the operator does not. The identify route answers with a registry error code, **no `llm_rerank` row is written**, and the session drops to the manual-search route the low band already uses — which exists precisely because 022 P1 puts the human in authority over identity. **What must never happen is a fabricated or stubbed identification presented as a result**: 022 P8 (honesty about what the machine did) and 021 §2's retirement of "verified" both forbid it, and a stub answer at a spend ceiling would be the first time this system lied to an operator to stay inside a budget.

### Q5 — How does an owner supply and rotate a key without the value crossing a Longbox API?

**Lens S.** *"Both candidate designs can be built safely and only one of them can be built **now**. A one-time write endpoint that stores to the SOPS file and never reads back is the right end state — write-only, no echo, no read route, the value never reaching a log, an error body, `cost_log` or the database. But it is 046 §5 A15's exfiltration primitive with a door added, and A15 is currently held shut by the accident that nothing writes that table over HTTP. Building the door before authentication, RBAC and RLS exist is building the thing the threat model is waiting for."*

**Lens D.** *"And the deploy path has a hole nobody has named: 019 T31's contract clause says **BYOK onboarding never transits keys by email or chat**, and the realistic version of 'the founder puts it on the host' is the owner emailing it. That would be a T31 violation performed by the onboarding process itself — non-waivable, `any → K1` — committed on day one by the people who wrote the rule."*

> **RULING. The key never enters a Longbox request path in either design, and for v1 there is no write endpoint at all.**
>
> **For the pilot: the deploy path, with the channel named in writing before the first BYOK shop.** The key reaches the host through the deploy contract — SOPS file in the repository, `ExecStartPre` decrypt, mandatory `EnvironmentFile` on tmpfs (§2 Q1 as amended). **The channel by which the owner's key value reaches the person who encrypts it is an open requirement on E01-B06, not on this record**, and it has a hard constraint: it is neither email nor chat (019 T31). **Until E01-B06 names one, a pilot shop runs on the service account and E01-B06 says so in writing** — which is a legitimate outcome under Q4(b) and is the reason (b) exists.
>
> **The one-time write endpoint is the end state and is pre-constrained here so it cannot be built wrong later.** When it is built (after **E03-D09** lands the identity substrate 048 decided and so gives it an owner identity, E03-B03 an authorization, E03-B04 RLS, and E03-B06 a connector lifecycle), it satisfies, without exception: write-only with **no read route and no echo of the value in any response**; the response carries only the `key_ref` **name** and the new `credential_version` id; an `Idempotency-Key` like every other mutating route (042); the value written to the SOPS file and to nothing else — **never** a column, a log, an error body, a prompt, an outbox payload or `cost_log`; and a request body that is excluded from `request_idempotency.response_body` by construction, because 041 §8.5 makes that table an operational cache and A9 in 046 §5 already flags it as a second copy nobody sweeps.
>
> **Which is chosen, argued rather than asserted:** the deploy path wins for v1 on a single ground — **it is the only one of the two that does not require the four unbuilt security beads to be correct.** A key that never crosses HTTP cannot be exfiltrated by an HTTP defect, and every argument for the endpoint is an argument about *convenience at the fiftieth shop*, which is a problem this project would be fortunate to have.

### Q6 — Which 046 rows does this close, and which remain?

**Both lenses agreed and the disagreement was about naming**, so it is recorded rather than resolved: 046's threat rows are **A-rows** (abuse cases, §5.2) and **G-rows** (the ranked gap list, §6.2); its **K-rows** are the ratification amendments from the `martin-kleppmann-reviewer` lens (§9.2), which are *obligations on beads* rather than threats. The bead brief asked for "the K-rows this closes"; **§8 answers in all three vocabularies rather than picking one**, because a record that quietly renames another record's rows is how a citation stops resolving.

## 3. Decision A — Custody: the variable is the form, SOPS is the source, the column is refused

Restated as a rule the code half can be tested against:

> **A key value exists in exactly one place inside this system: a process environment variable whose name is a legal `key_ref` for exactly one shop. Its only legitimate source is a SOPS-encrypted file decrypted by an `ExecStartPre` step into a mode-0600 root-owned `EnvironmentFile` ON TMPFS — `/run/intentsolutions/longbox.env` under a `RuntimeDirectory=`, or `/dev/shm` — which the unit declares mandatorily and which must never live under `/etc` or `/var`. The process never decrypts a SOPS file, never writes one, and never persists a key value to disk, to a column, to a log or to a response.**

**And one prohibition stated rather than left to inference, because it is the mistake a well-meaning operator makes.** That rendered file **is not a backup and is never treated as one**: it is not copied, archived, snapshotted, `scp`'d to a second host, committed, attached to a ticket, or kept "just in case" a deploy fails. **The SOPS file in the repository is the only copy of record**, and the rendered file is a derivation with the lifetime of a process. An operator who needs the value again re-runs the decrypt; an operator who copies it has created a second, uncontrolled custody path with none of the four grounds behind it.

Three consequences that are not restatements:

1. **The `age` private key is a host secret, not an application secret.** It stays at `/etc/intentsolutions/age.key` under the estate's posture and the application never reads it. An application that could decrypt could also be made to print.
2. **A SOPS decrypt never lands on disk.** The estate standard's anti-pattern list is adopted verbatim, including the `eval "$(sops -d … | sed 's/^/export /')"` leak — the anchored form is the only permitted one. Longbox adds nothing to that standard; it inherits it.
3. **`.env.example` remains the complete list of variable NAMES and never holds a value.** It already carries the six per-shop names and the gateway pair (`.env.example:148-179`). A new credential kind adds a name there, a suffix to `CREDENTIAL_SUFFIXES`, and a row to 046 §7.2's inventory — three edits, in one PR, or the inventory is stale by construction (046 §8.1's standing-review rule applies to this record too).

## 4. Decision B — Rotation is two facts, and liveness is a predicate

The tables, stated as shapes rather than as SQL (the SQL is the code half's, §10):

**`shop_credential_version`** — an introduction. `id`, `shop_id`, `kind`, `key_ref`, `version_no`, `introduced_at`, plus 041 §2's envelope (`authored_by`, and `session_seq` **not** applicable — a credential rotation is not session-scoped). `UNIQUE (shop_id, kind, version_no)`. Append-only by trigger, declared in `src/db/appendOnlyTables.ts`, `ENABLE ALWAYS`, on the declared list the five-minute detector reads (019 T34).

**`shop_credential_retirement`** — a retirement. `id`, `shop_id`, `credential_version_id`, `reason_code`, `retired_at`, `provider_revocation_instructed_at` (nullable), the envelope. `UNIQUE (credential_version_id)`. Append-only, same posture. `reason_code` is an open-world registry term in `003:134-143`'s style — `rotation`, `compromise_suspected`, `offboarding`, `provider_change` — and it says *why*, never *what*.

**The resolution rule**, which is the only place these tables are read:

```
live(v)      := exists introduction(v) ∧ ¬exists retirement(v)
resolve(s,k) := the live version of (s,k) with the greatest version_no
```

- Exactly one live version → resolve its `key_ref` through `resolveKeyRef(key_ref, shopSlug)` unchanged. The E1–E5 machinery is untouched by this bead; it gains a caller, not a rewrite.
- **Zero live versions, but the shop has ≥1 version row** → `CredentialRefusedError`. **Never the global environment.** This is E4's rule with "row" replaced by "live version", and it is the half that makes §5's deletion real.
- **No version rows at all** → the service account path (§6), attributed `longbox`.
- **More than one live version** → the newest wins and the overlap is *reported*. It is not an error: it is the window rotation exists to have.

**`shop_credentials` is not dropped and not edited.** 034 §2.13's reasoning for `created_by` applies here unchanged: the existing rows are the record of what the pre-rotation system was configured with. The table is **deprecated by comment in the expand migration**, stops being *read* when the version tables land, and is dropped in a later contract step under 044's `-- contract: retires <file>; 006 row: <entry>` header — never in this bead.

## 5. Decision C — Deletion, and the sentence a receipt may not contain

The three steps and their receipt are ruled in §2 Q3 (four at v1.0.0; the tmpfs amendment removed the one that was a person editing a file on a host, and a step removed is a step that cannot be skipped). Two additions the code half owns:

**(a) The refusal is what makes it true.** §9 I7 requires that a retired version refuse **at the resolver**, while the environment variable is still set. That is deliberate and it inverts the usual order: the software stops being able to use the key *before* the operations work removes it. An offboarding whose SOPS edit slips a day is then a shop that cannot make calls — visible, loud, fixable — rather than a shop whose key is quietly still live.

**(b) The residual is stated rather than mitigated.** Every prior revision of the SOPS file, in git and in every backup of this repository, still contains the value. Nothing in this design changes that and no honest receipt implies otherwise. **The only complete revocation is at the provider and it is the shop's act** (§2 Q3). 041 §8.3's keyed-digest construction — retention made revocable by destroying a key that was never in the database — is the right pattern for *photograph* re-identification and **does not transfer to a BYOK credential**, because the thing that must be destroyed is held by a third party who never gave us the ability to destroy it.

**What may be said about any of this externally:** nothing new. 021's registry governs, B15 already forbids unqualified deletion claims, and a sentence about credential handling is a **`control`/`contract`** line — a commitment, never an achievement (021 B16) — until E03-B10's independent review. The wording a shop receives at offboarding is a **candidate C-row for 021** drafted with the pilot paperwork, exactly as 041 §8.7(e) routes the data-subject wording. It is not written here.

## 6. Decision D — Spend ownership

**6.1 The column.** `cost_log` gains `spend_owner text NOT NULL` (`shop` | `longbox`, CHECK-constrained) and `credential_version_id uuid NULL REFERENCES shop_credential_version(id)`. `ADD COLUMN` is DDL, so the append-only trigger neither refuses it nor needs disabling — migration `012` already established that precedent for `cost_log.outbox_id` (`migrations/012_cost_log_outbox_id.sql:35`).

**6.2 Derived, never declared.** The owner is computed inside `appendCostLog` from which resolution path produced the provider, and `appendCostLog` is the enforced single writer (E8). A caller cannot pass an owner in, because a caller that can pass an owner in is a caller that can attribute a Longbox call to a shop.

**6.3 The gateway override is `longbox`.** `LLM_BASE_URL`/`LLM_API_KEY` is deliberate operator configuration outranking every per-shop credential (E6, 046 §7.3). A shop cannot set it, so a shop cannot own its spend.

**6.4 The floors.** As ruled in §2 Q4(c): **PROVISIONAL 500** paid identify calls/shop/day for `shop`-owned spend (unchanged from 042 §8.4), **PROVISIONAL 150** for `longbox`-owned. Both are floors, both are non-evidentiary, neither is a capacity, a cost or a reliability figure, and neither appears in any external artifact.

**6.5 What the owner is told.** 022 P5 requires benefit sharing to be *stated, not assumed*, and BYOK is the same shape in reverse: it moves model spend from Longbox to the shop. So the shop-facing weekly report says, in plain language, **whose key paid for the work** — one sentence, no figures beyond what 019 §5 already puts in that report, and **no "AI" in it** (021 B19 and the condition-surface rule; the sentence is about a provider account, not about a technology). E11-B06 owns the rendering; this record fixes only that the fact is reportable, which it is not today (E12).

**6.6 What it must never become.** `cost_log` gains a *credential* dimension and never an *operator* one. 019 T35 is non-waivable and 022 P3 forbids the surface, not the signal: a per-operator cost figure is per-operator telemetry with a dollar sign on it. §9 I8 asserts the negative.

## 7. Decision E — The operator-facing surface

Ruled in §2 Q5. Restated as the two obligations that leave this record:

1. **On E01-B06:** name the channel by which a shop's key value reaches the person who encrypts it, before the first BYOK shop. It is neither email nor chat (019 T31's contract clause). Until it is named, the pilot shop runs on the service account and the paperwork says so.
2. **On whoever builds the write endpoint (not this bead):** the seven constraints in §2 Q5 are pre-conditions, not review comments. A write endpoint that reads back, echoes, logs, or stores to a column is refused at review regardless of what else it does well.

## 8. The 046 rows this closes, and the ones it does not

**Closed by this record (design) together with its code half:**

| 046 row | What it was | How it closes |
|---|---|---|
| **G-25** (rank 3) | *"Per-credential spend ownership"*, owner **E03-B05** | §6 — `spend_owner` + `credential_version_id`, derived in the single writer |
| **§5 A15** | credential exfiltration through `shop_credentials`, *"low today / high on the day a write surface exists"* | §2 Q5 + §7 — the write surface is refused for v1 and pre-constrained for later; the *value* never crosses HTTP in either design |
| **§7.3 / G-9 (the E03-B05 half)** | T31's **five uncovered surfaces** and the **nightly cadence** — DB columns, logs, error payloads, LLM prompts, bead notes, 006 rows | §9 I1 + I9 — a planted-canary detector across all five plus the nightly run with a T34 heartbeat. *(G-9's other half — the gitleaks bounds and the fixture generator — already landed under E03-D04)* |
| **§9.2's obligation on E03-B05** | *"Also brings T31's five uncovered surfaces under a detector"* | the same two invariants |
| **§5 A14** (partial) | a secret or a person's prose leaking through a log or an error body | I1 covers the secret half. **The prose half is E13's structured logging and is NOT closed here** |
| **K-2** (Kleppmann, §9.2) | *"Constrain the function, not only the row it reads from"* | **already discharged by E03-D01** at `ffaa225` (E1–E3); this record inherits it and adds the version dimension |
| **K-3** (Kleppmann, §9.2) | the gateway check is on the HOST, not on presence | **already discharged by E03-D01** (E6); §6.3 adds its spend consequence |

**Explicitly NOT closed, with the owner named:**

| Row | Owner | Why not here |
|---|---|---|
| **G-16 / §5 A12 / K-4** — the purge-epoch key's custody, `purge_digest`, and restore-consistency | **E03-B09 + E13-B01/B07** | This record fixes the *pattern* (a key that lives outside the database is the one thing an append-only store can destroy) and takes no position on the epoch key's rotation cadence or its restore semantics |
| **G-13 / §5 A13** — the webhook signing secret | **E03-B08** | The secret does not exist; when it does it is an environment variable under §3's rule, and that is the whole of this record's involvement |
| **G-14** — the static Shopify admin token, no OAuth lifecycle | **E03-B06** | A connector token has a *provider-side* lifecycle this record deliberately does not model; §4's version tables are the substrate it will use |
| **A14's prose half**, structured logging | **E13** | I1 catches a secret; it does not catch a person's name in a log line |
| **G-1/G-2/G-3** — authentication, RBAC, RLS | **E03-B02/B03/B04** as 046 §6.2 names them; the substrate E03-B02 decided is **implemented by E03-D09** (`longbox-e5b.3.16`) | The actor model this record's `authored_by` depends on. **This record cites doc 048's substrate and creates none of it.** 046's owner cell is quoted as written rather than rewritten — the implementing bead is named beside it instead |

## 9. Contracts the code half must satisfy

Each is falsifiable and names its test. **None exists at `ffaa225`** (018: nothing here is TESTED). Unit tests flat in `tests/`, DB-backed in `tests/integration/`, contract tests in `tests/contract/`.

| # | Invariant | Test |
|---|---|---|
| **I1** | **No secret value reaches any of T31's six surfaces.** A canary planted in a legal `key_ref` variable appears in no log line, no error envelope, no `cost_log` row, no `outbox` payload, no prompt built by `buildUserText`, and no response body, across a full identify → confirm → condition → price → draft run. The assertion is on the canary's *value*, never on a redaction rule, because a redaction rule tests itself | `tests/contract/secret-surfaces.test.ts` |
| **I2** | **A version is introduced by an INSERT and retired by a SECOND row.** `UPDATE shop_credential_version` and `UPDATE shop_credential_retirement` are both refused by the append-only trigger; a second retirement of one version violates `UNIQUE (credential_version_id)` | `tests/integration/credential-rotation.test.ts` |
| **I3** | **Liveness is a predicate and the newest live version wins.** Four cases: one live → it resolves; two live (an overlap) → the greater `version_no` resolves and the overlap is reported; **zero live with ≥1 version row → `CredentialRefusedError`, and `process.env` is not read**; no version rows → the service-account path | `tests/credential-liveness.test.ts` + the integration file |
| **I4** | **Every `cost_log` row carries a non-null `spend_owner`,** and a per-shop-credential call also carries `credential_version_id`. `appendCostLog` remains the **single writer** — a second writer fails `pnpm arch` | `tests/costLog.test.ts` + the existing architecture gate |
| **I5** | **Attribution is derived, not declared.** A shop with a live version yields `shop`; a shop with none yields `longbox`; the gateway override yields `longbox` even for a shop with a live version. `appendCostLog`'s signature accepts no caller-supplied owner | `tests/costLog.test.ts` |
| **I6** | **At the ceiling the system degrades to the manual path, never to a stub.** Exceeding the owner's floor answers a registry error code, writes **no `llm_rerank` row**, leaves the session workable on the manual route, and counts a throttle event. Assert no fabricated candidate or confidence is returned | `tests/integration/spend-ceiling.test.ts` |
| **I7** | **A retirement makes the key unreachable to the process while the variable is still set.** After a retirement row, resolution for that `(shop, kind)` refuses — and the refusal names the retirement, not the environment | `tests/integration/credential-rotation.test.ts` |
| **I8** | **No wire surface declares a credential or a spend fact.** Over the generated `contracts/openapi.v1.json`: no response DTO, path, parameter or error-envelope field declares a `key_ref`, a credential value, a `credential_version_id`, a `spend_owner` or a dollar figure — and **no route accepts an operator identifier as a filter, sort or grouping parameter on any of them** (019 T35, extending 042 I7) | `tests/contract/state-routes-t35.test.ts` (extended) |
| **I9** | **The nightly scan covers the five non-repository surfaces and emits a T34 heartbeat.** A canary planted in each of the five is found by the job; a run that does not report is a stale detector and therefore a K1 by T34's existing rule. **No new K rule is created here** — 019's K1 list is closed and this record has no standing to open it | the nightly job + `tests/contract/secret-surfaces.test.ts` |
| **I10** | **Offboarding produces a receipt that names what was made unreachable and does not claim what it cannot know.** A retirement row with `reason_code='offboarding'` exists; the receipt text names the three steps of §2 Q3 **including the restart, and names the tmpfs path as the thing the restart re-derived**; and **no field or sentence asserts that the provider-side credential was revoked** | `tests/integration/offboarding-receipt.test.ts` |
| **I11** | **A refusal event carries a shop, a name and a reason, and never a value.** Extends the existing refusal-sink coverage: the emitted event serialised to JSON contains no substring of the planted canary, for every refusal reason including the new `retired` one | `tests/credentialPolicy.test.ts` (extended) |

## 10. Migrations the code half will need

**Names only. Numbers are assigned when the file is written, never reserved in advance** — 044's ledger keys on the filename and **E03-D09**'s PR (`longbox-e5b.3.16`, the identity substrate) owns `019+`. Every one is an **expand** step under 044 §2; none carries a `-- contract:` header.

| Name (number TBD) | What |
|---|---|
| `NNN_shop_credential_version.sql` | the introduction table, its `UNIQUE (shop_id, kind, version_no)`, its append-only trigger, and its row in the declared table list |
| `NNN_shop_credential_retirement.sql` | the retirement fact, `UNIQUE (credential_version_id)`, `reason_code`, `provider_revocation_instructed_at`, append-only trigger and declaration |
| `NNN_cost_log_spend_owner.sql` | `spend_owner` (NOT NULL, CHECK) and `credential_version_id` on `cost_log` — `ADD COLUMN` only, per `012`'s precedent |
| *(a later contract step, not this bead)* | retiring `shop_credentials` once nothing reads it — requires the `-- contract: retires <file>; 006 row: <entry>` header and its own 006 entry |

**Also required and not a migration:** the app-role grant plan (`pnpm grant-app-role`) must cover the two new tables, and the boot check that refuses a connection whose role owns an append-only table must see them — a new append-only table that the app role owns is E02-D06's failure mode re-entering through a side door.

## 11. Alternatives considered

**A1 — An encrypted column with a KMS-less envelope key.** *Rejected*, §2 Q1: it contradicts locked decision 2, defends against an adversary who does not exist in 046 §2.3's matrix, cannot be deleted under locked decision 4, and lands the ciphertext in a 30-day Object-Lock backup where a revocation cannot reach it.

**A2 — In-process SOPS decrypt.** *Rejected*, §2 Q1 — on operational grounds rather than security ones, and Lens S's dissent is preserved. The gain is real but small (the process holds the decryptor instead of the plaintext), and the cost is a second custody path with no drill, no runbook and one operator.

**A3 — `retired_at` as a nullable column on the version row.** *Rejected*, §2 Q2: it is an UPDATE, and the append-only trigger is the enforcement mechanism of locked decision 4. The two-table form is 041 §8's shape and is why liveness can be a predicate rather than a status.

**A4 — Auto-retire the previous version when a new one is introduced.** *Rejected*, §2 Q2. It makes rotation an atomic cutover, which is the thing an overlap window exists to avoid, and it removes the operator's ability to prove the new key works before the old one stops.

**A5 — Forbid the service account entirely; a shop with no key cannot scan.** *Rejected*, §2 Q4(b), and it is the alternative a strict reading of locked decision 2 reaches for. It blocks the pilot on a procurement step nobody has run, and 019 T33/T16 already put enough G1 blockers in front of the first item. **It is adopted as the post-G3 posture**, with the affordance's expiry stated rather than left implicit.

**A6 — Set a dollar ceiling rather than a call-count ceiling.** *Rejected.* A dollar figure derived from `estimateUsd` is an estimate of an estimate, and 042 §8.4's distinction holds: a number that *protects* the system may be provisional; a number that *describes* it may not. Calls are counted; dollars are estimated.

**A7 — Build the one-time write endpoint now, behind a feature flag.** *Rejected*, §2 Q5. A flag defaults to something, the something is read from configuration, and 046 §5 A15 is a primitive held shut by the absence of the route rather than by the value of a flag.

## 12. Consequences

**What gets better.** A rotation becomes a fact with a time and an author instead of an edit nobody can see (E10). A deletion becomes a refusal the code enforces before the operations work catches up (§5(a)). A ledger that mixed two people's money starts naming the owner of every row (E12 → §6). And five of T31's six surfaces get an instrument for the first time (E13 → I1/I9).

**What gets worse, stated plainly.** There are now **two more append-only tables** on the declared list, which means two more tables the five-minute trigger detector must cover and two more that a restore must bring back with their triggers at `'A'`. The read path for a provider gains a join, on the request path, for a value that changes perhaps twice a year — that is a real cost and the mitigation (a per-process cache) is deliberately **not** taken, because a cached credential is a retired credential still working, which is the exact failure §5(a) exists to prevent. And the record adds a **second** rotation vocabulary to a system that already has supersession chains (041 §3.3) and session rotation chains (048 R2): three things called rotation, none of them the same thing.

**The residual, stated because it is not mitigated.** Longbox cannot revoke a BYOK key. Every version of the SOPS file that ever held it still holds it, in git and in backups, and the key stays valid at the provider until the shop revokes it there. **This is a design that makes a credential unreachable to Longbox and calls exactly that much true.**

## 13. Not decided here

1. **The purge-epoch key's custody, rotation cadence and epoch boundary** — 041 §8.3 fixes only that it exists and lives outside the database. **E03-B09 + E13-B01.**
2. **The webhook signing secret** and its rotation — **E03-B08**.
3. **The Shopify connector token's OAuth lifecycle, scopes, consent and uninstall** — **E03-B06**, which depends on this bead and not the reverse.
4. **The rotation cadence** — how often a credential *should* be rotated. This record makes rotation possible and takes no position on frequency; a cadence with no measurement behind it is a number pretending to be a policy.
5. **The real spend ceilings.** The two floors in §6.4 close from the counters, segmented by shop shape as 042 §8.4 requires. **E12-B01/B08.**
6. **The channel by which a shop's key value reaches the person who encrypts it** — **E01-B06**, with 019 T31's not-email-not-chat constraint. Until it is named, §2 Q4(b) applies.
7. **The unit itself** — the `RuntimeDirectory=`, the `ExecStartPre=` decrypt, the mandatory tmpfs `EnvironmentFile=` and the boundary check that every `LONGBOX_*` name in the rendered file is declared in the SOPS file — is **E13**'s, named in §2 Q1 so it is not discovered as a gap. **This record fixes the property (no plaintext on persistent disk, re-derived at every start); it does not write the unit file.**
8. **Whether a shop may bring its own gateway** (a per-shop `base_url` + `key_ref` pair pointed at a self-hosted endpoint). Today's allowlist answers "only a registered host"; whether a *shop* may register one is a product question, not a security one.
9. **Whether a retired credential's `key_ref` — a variable NAME — is itself regulated data**, and **what a shop must be told when its credential is destroyed**. Both **NEEDS COUNSEL**, routed to the **E01-B05 stage-2 batch** with their technical context attached (041 §8.7(d)'s practice). The shop-facing wording is a candidate C-row for 021 under the T26 pre-send step.

## 14. Ratification

**Not ratified.** This record is DRAFT pending a `longbox-gate-auditor` verdict on the decision half and a `longbox-invariant-reviewer` verdict on the code half when it lands. The cannon in §2 is a two-lens deliberation recorded in-band; the acting head's rulings are stated there and the parent session ratifies. **Both lenses' positions are preserved above whether or not they prevailed** — Lens S's dissent on A2 and Lens D's dissent on the deploy-channel gap (§2 Q5) are the two that survived the rulings and are the two to re-read if this record is ever reopened.

**Standing review.** This record is redrawn on the same trigger-based rule 046 §8.1 states: when a credential kind is added or removed, when a new secret enters 046 §7.2's inventory, when a resolution path changes which owner pays, or when the write endpoint is built. **Not on a calendar.**
