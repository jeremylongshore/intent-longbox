# Decision Record — Connector OAuth: Where a Provider-Minted Token Lives, What Authority It Carries, and What an Uninstall Actually Ends

**Version:** 1.0.6
**Status:** **RATIFIED 2026-09-04 (v1.0.5)** by the acting head under Jeremy's standing delegation — `security-auditor` and `rich-hickey-reviewer` were DISPATCHED on the §2 Q1 ruling (both ACCEPT-WITH-CHANGES; verdicts and dissents in §14.1 are the reopening triggers); `longbox-invariant-reviewer` BLOCK at `16f17ef` → PASS-WITH-NOTES at `843652c`; `longbox-gate-auditor` NOT-READY ×2 on statements of fact → v1.0.4; landed as PR #87 squash `f4a03b6`. The custody ruling (AEAD column with its own ring; the three-way rule; a credential's death must be observable) may be cited as settled from this version; the scope claim is a stolen database dump IN ISOLATION until E13-D01 separates the archive. **v1.0.6 (2026-09-05): E13-D01's separation is REPRODUCED IN TEST and is NOT applied on the hosts, so the scope claim is UNCHANGED — see the change log and §14 item 2.**
**Bead:** E03-B06 `longbox-e5b.3.6` — *Implement connector OAuth, least scopes, token lifecycle, consent and uninstall/revocation* (epic LBOX-E03 `longbox-e5b.3`, gate G2) — see 000-docs/014 §8 row E03-B06
**Filed:** 2026-09-04 · **Author:** `longbox-security-tenancy-builder` · **Owner:** parent session (acting head of board)
**Sensitivity:** Restricted internal (014 §10). It names variables, tables, scopes and hosts; it contains no value of any kind and never will.
**Scope of this commit:** the RECORD and its CODE HALF land together on one branch in two commits — the code first, this record second — because the ruling in §3 is a ruling ABOUT a mechanism that had to be built to be argued honestly. Migration `026`; `src/services/connectors/shopify/`; two routes; two CLIs.

---

## Change log

**Version convention** (006 `:6`): a **minor** bump means the content of a decision changed; a **patch** means a statement of fact was repaired with no decision changing.

| Version | Date | What changed | Authority |
| --- | --- | --- | --- |
| **1.0.6** | **2026-09-05** | **Patch — a statement of fact about the backup, from E13-D01 `longbox-e5b.13.11`. No ruling moves and THE SCOPE CLAIM DOES NOT CHANGE.** §14 item 2 said the estate's borg include set carries `/etc` and the database dump in one archive, and named E13-D01 as the bead that separates them. That separation is now **REPRODUCED IN TEST** — intent-os PR #576, squash SHA E13D01_SQUASH_SHA excludes `/etc/intentsolutions/age.key`, the host SOPS files and the home/root `.config/sops/age` paths from the archive that carries `/var/backups/db-dumps`, adds a preflight that REFUSES the run when the exclusion is missing, and proves it with 30 cases under real borg including a negative control. **It is NOT applied on either host**: the live timers still run the deployed copies, so today's archives still carry the key, and archives already in Backblaze keep their contents for their Object-Lock life. **Therefore the honest scope of this encryption is still *a stolen database dump in isolation*** — a test proves a script, and only a deploy changes what an archive holds. When the deploy happens it is recorded as a decision-log row in **006**, and only then may this item be read as closed. | acting head, on E13-D01 |
| **1.0.5** | **2026-09-04** | **Ratified.** Status and §16 signed after PR #87 merged (`f4a03b6`); nothing else changed. | acting head |
| **1.0.4** | **2026-09-04** | **Patch — one BLOCK the REBASE exposed, and three pointers. No decision moves.** **(B8) §1 was pinned to a commit that is on NO BRANCH.** v1.0.0–v1.0.3 cited `8e86490`, the head of `feat/e03-d06-totp` when this branch was cut; that branch squash-merged into `ec9b465`, so the hash stopped resolving — `git branch -a --contains 8e86490` returns nothing. **A citation to an unreachable commit is not a weak citation, it is an unverifiable one**, and 018's REPRODUCED rung means precisely that somebody else can run the command. §1's header, its six command cells and §11's *"none existed at"* now name **`ec9b465`**, the MERGED EQUIVALENT — the same tree, on `main` — and the gate re-audit re-ran all six and got identical output, which is what makes this a RE-PIN rather than a re-derivation. **The generalisation is written into §1 rather than left in this row:** a hash from a branch that will be squashed is a PERISHABLE citation, and the durable form is the merge commit it becomes. **(P7)** §5.5 said the open-world `reason_code` citation is carried by "§5.4 below"; the carrier is **§2 Q4**. **(P8)** 016's three E03-B06 appends were stamped `v1.18.0` and the file is `1.19.0` — main's four E03-D12 appends are left alone, because they were correct when written and are not this bead's to re-tag. **(P9)** 016's 053 row led with `1.0.2`. | gate re-audit of `734e0ed` → acting head |
| **1.0.3** | **2026-09-04** | **Patch — one note from the invariant RE-VERIFICATION of `843652c` (PASS-WITH-NOTES; every BLOCK and WARN closed and independently reproduced). No decision moves.** The finding-6 fix used `logLevel: "silent"` on both connector routes. That is a ROUTE option and it suppresses everything, including `setErrorHandler`'s `req.log.error` — so an unhandled 500 on the one route a merchant reaches mid-install would have left **no server line at all**, and 042 I14's correlation id exists to be joined to exactly that line. **Silencing a logger to redact a field is a redaction that deletes the evidence**, and it was the wrong tool twice: `disableRequestLogging` is what removes the URL line, and in this Fastify version it is a SERVER option, so the per-route form is a predicate — now DERIVED from the auth allowlist's `provider-callback` rows (via `logController`, since the top-level option warns `FSTDEP023` on every boot) and reading only the path before `?`. `setErrorHandler` additionally puts `correlation_id` on the error line, which every route in the repository gains. I17 now asserts BOTH directions, and both were proved able to fail: the redaction by disabling the predicate, and the error line by the original `silent`. | invariant re-verification of `843652c` → acting head |
| **1.0.2** | **2026-09-04** | **Patch — STATEMENTS OF FACT ONLY, from the `longbox-gate-auditor`'s NOT-READY on `843652c`. No decision moves, no ruling is reversed, and the cannon is NOT re-run.** **Seven blocking repairs.** **(B1/B2)** the INDEX row and 021's candidate-row cell still carried v1.0.0's WITHDRAWN sentence — that this defends *"a database and a backup"* — and B1 additionally mislabelled it as Lens S's narrowing when it is the claim Lens S narrowed AWAY; both now read *a stolen database dump in isolation*. **(B3)** §3.0a cited **046 §5 A16** twice for the adversary row this branch added, which is **A18** (`046:308`); A16 is storefront HTML injection, and a citation that resolves to the wrong threat is worse than one that resolves to nothing because it reads as checked. **(B4)** six 046 line cites moved by this branch's own amend and are re-pinned (`046:355`, `:107` — and that one is §2's ASSET row A14, not §7.2 — `:65`, `:302`, `:354`). **(B5)** §5.5 cited `003:134-143` for the open-world `reason_code` idiom; 003 is 97 lines, and the reason lives in 050 §4, which §5.4 already cites. **(B6)** §3's rule was restated as *"IF AND ONLY IF … BOTH predicates"*, contradicting §2 Q1's own three-way ruling and §3.0's clause three — **the ruling did not move; the restatement did**, and it now reads as the disjunction §2 decided. **(B7)** the provenance was told three different ways: the status line and the change log said §2 "no longer" records in-band while §2 itself honestly said it DID and that the dispatch came afterwards. All four places now carry **one sentence**: the deliberation TEXT is the session's composition; the VERDICTS and DISSENTS in §14.1 are the dispatched lenses' and are the reopening triggers. **Six smaller repairs**: 046's ratification counts annotated to eighteen (P1); the fold-in count replaced by an enumeration (P2); 021 §5 → §4a with C-CANDIDATE-E03B06-2 named in §9 (P3); H4's re-attemptability cross-referenced from §8.3's class-two table and from 042 §5.1's (P4); `v1.5.1` → `v1.5.2` in six code and test comments (P5); and 016's first append clause marked SUPERSEDED rather than deleted (P6). **A patch and not a minor**: every change repairs a statement about the tree, another record, or this record's own wording. | gate audit of `843652c` → acting head |
| **1.0.1** | **2026-09-04** | **Minor — the cannon was CONVENED and both lenses returned ACCEPT-WITH-CHANGES; the §3 ruling STANDS and every finding is folded in — **S1, S2, S3, S4, S5, S6 (escrow and re-sealing), H1, H3, H4 and H5**.** §2's header said "no longer records the cannon in-band" — CORRECTED at v1.0.2 (B7), because §2's own note honestly says it WAS composed in-band and that the dispatch came afterwards. **The provenance is one sentence and it is the same one everywhere it appears:** the deliberation TEXT in §2 is the session's own composition; the VERDICTS and DISSENTS in §14.1 are the dispatched lenses' and are what §16 makes the reopening triggers. Both verdicts are quoted and both dissents are preserved verbatim in §14.1. **The consequential changes are three.** **(S1)** §3 and §14 claimed this encryption "defends a stolen backup" and had not shown it — the estate's borg include set carries `/etc` (the age key) and the database dump in the SAME archive, so one archive can hold the ciphertext, the ring's SOPS source and the key that opens it for the Object-Lock window. The honest scope is **a stolen database dump IN ISOLATION**; separating them is **E13-D01 `longbox-e5b.13.11`**, and 050 §2 Q3's counterweight is stated rather than used as a rebuttal. **(S2)** predicate (ii) was over-claimed and a receipt sentence was FALSE: `RETIREMENT_MEANING.revocation` said *"only the merchant can end it there"*, which is 050's true sentence about a BYOK key transplanted onto a credential it does not describe. §7.3a adds the provider-side revoke, its two observation columns, and the four rendered outcomes — and signs the endpoint's existence at the pinned API version **OPEN** in 043 A11's idiom rather than asserting it. **(H1)** §2 Q1's test had no cell for **(i)-true/(ii)-false** — machine-minted and silently revocable, which is most vendor OAuth — so the table now has four cells and a THIRD implicit predicate is stated. Plus S3 (the pilot's human-path Dev-Dashboard token), S4 (a row↔shop binding on `openTokenValue`), S5 (the justifying adversary added to 046 by amend-by-a-row), S6 (ring escrow → **E03-D12 `longbox-e5b.3.22`**; re-sealing → **E03-D13 `longbox-e5b.3.23`**), H4 (a failed exchange leaves the state re-attemptable, deliberately) and H5 (042's and 048's change-log TABLES verified to carry rows citing this record). | §2's cannon → acting head, §16 |
| 1.0.0 | 2026-09-04 | Initial record. Five decisions: custody of a provider-minted token (§3); the lifecycle as append-only facts with liveness as a predicate (§4, §7); the schema (§5); the scope list as a pinned, argued, two-sidedly-checked constant (§6); authenticity, and the two CSRF/idempotency mechanism substitutions the inbound surface requires (§8). Two amend-by-a-row obligations discharged in the same PR: **042 → v1.4.3** (a SECOND §5.1 exemption class) and **048 → v1.5.2** (I6(d) restated). | §2's cannon → acting head, §16 |

---

## 0. Evidence posture

018 governs. Every claim about the tree in §1 is **REPRODUCED** — a command and its output, at a named commit — and every claim about behaviour is **TESTED** or is marked as an assumption. Every number that is not a measurement is declared **PROVISIONAL** in 042 §8.4's class and is never quoted as capacity, reliability or a security property at any class (021 B16). **No statute is cited anywhere in this record**, deliberately: the compliance questions this bead touches are routed to counsel in §15 rather than answered here.

**One posture statement is worth making before §1**, because it governs the whole record: this bead adds the FIRST inbound surface in the system. Everything before it was outbound or client-driven. 046 §5 A13 says the receiver "ships with its detector or it is a waiver by omission", and §11's invariants are that detector.

---

## 1. What exists today, REPRODUCED at `ec9b465` (E03-D06's squash on `main`)

⚠ **THIS SECTION WAS PINNED TO A COMMIT THAT IS ON NO BRANCH, and the rebase is what exposed it (v1.0.4, the gate re-audit of `734e0ed`).** v1.0.0 through v1.0.3 cited `8e86490` — the head of `feat/e03-d06-totp` at the moment this branch was cut. That branch **squash-merged into `ec9b465`**, so the hash it named stopped being reachable from anything: `git branch -a --contains 8e86490` returns nothing. **A citation to an unreachable commit is not a weak citation, it is an unverifiable one** — a reader cannot check it, and 018's whole evidence chain rests on REPRODUCED meaning somebody else can run the command.

`ec9b465` is the MERGED EQUIVALENT of that head — the same tree, on `main` — and **every command below was re-run against it by the gate re-audit and returned identical output**, which is why this is a re-pin rather than a re-derivation. The lesson generalises past this record: **a hash from a branch that will be squashed is a perishable citation**, and the durable form is the merge commit it becomes.

| # | Finding | Command and output |
| --- | --- | --- |
| **E1** | **A shop's Shopify authority is a STATIC token named by `shop_credentials.key_ref`, with a global fallback.** There is no lifecycle: no issuance fact, no scope record, no ending, and nothing that changes when a merchant removes the app. | `git show ec9b465:src/consumers/index.ts \| grep -n SHOPIFY_ADMIN_TOKEN` → `37:  const adminToken = await resolveShopToken(pool, shopId, "shopify", "SHOPIFY_ADMIN_TOKEN");` |
| **E2** | **There is NO inbound Shopify surface of any kind.** The single `x-shopify` occurrence in `src/` is the OUTBOUND access-token header on the Admin GraphQL call. No callback, no webhook, no signature verification against a Shopify secret. | `git grep -nE "X-Shopify\|x-shopify" ec9b465 -- src public` → one line, `src/services/shopify.ts:150: "x-shopify-access-token": cfg.adminToken,` |
| **E3** | **No connector table exists.** The declared append-only set names none. | `git show ec9b465:src/db/appendOnlyTables.ts \| grep -c connector` → `0` |
| **E4** | **046 §6.2 books the defect here by name.** G-14: *"Static Shopify admin token; no OAuth lifecycle, no revocation"*, owner **E03-B06**. | `046:355` |
| **E5** | **050 hands the question here explicitly and models none of it.** §8's G-14 row: *"A connector token has a **provider-side** lifecycle this record deliberately does not model; §4's version tables are the substrate it will use."* §13 item 3: *"The Shopify connector token's OAuth lifecycle, scopes, consent and uninstall — **E03-B06**, which depends on this bead and not the reverse."* | `050 §8`, `050 §13` |
| **E6** | **048 §12.4 row 3a records that privileged sessions do not exist**, and E03-D06 and E03-D07 both answered that by building a service and reaching it from a CLI, with the route DECLARED `pending: true` on the auth allowlist. | `src/contracts/v1/routes.ts`, the two `pending: true` rows |
| **E7** | **The rotation idiom this record borrows is already built and ratified.** 050 §4's two tables, liveness as a predicate, the resolver's refusal on "has versions, none live". | `src/providers/credentialVersions.ts`, `migrations/021`/`022` |

**What E1 and E2 mean together, and it is the whole shape of the bead.** The system holds a bearer credential for a merchant's store that (a) nobody issued through a recorded act, (b) carries an authority nobody wrote down, and (c) **survives the merchant removing the app**, because nothing tells Longbox they did and nothing would change if something did. The three are one defect with three faces, and closing it needs an issuance, a scope record and an ending — which is what §4 through §8 build.

---

## 2. The cannon — two lenses, five questions, and the acting head's rulings

The two lenses are stated as positions, not summaries, and both are preserved whether or not they won. **Lens S** is the application-security position (blast radius, revocability, the insider and the backup as adversaries). **Lens D** is the durable-state and operations position (what a fact is, what a constraint proves, what an operator can actually run).

> **HOW THIS CANNON WAS RUN.** The session **DISPATCHED both lenses** on the §3 ruling and both returned **ACCEPT-WITH-CHANGES** — `security-auditor` with six findings (S1–S6) and `rich-hickey-reviewer` with the (i)-true/(ii)-false gap and two smaller ones (H1, H4, H5). **The acting head's ruling STANDS**; v1.0.1 folds every finding in and preserves both dissents verbatim in §14.
>
> ⚠ **THE PROVENANCE, IN ONE SENTENCE, AND IT IS THE SAME SENTENCE IN THE STATUS LINE AND IN §16.** **§2's deliberation text is the session's own composition; the lens VERDICTS and DISSENTS quoted in §14.1 are dispatched and are the reopening triggers.** v1.0.0 composed §2 in-band and said so; the dispatch happened AFTERWARDS, against the BUILT mechanism rather than against a proposal — which is why the findings reach the code as well as the wording. A reader deciding how much weight §2 carries needs both halves and neither on its own. **E03-B10's independent security review is required regardless**: a record cannot audit itself, and neither can lenses that reviewed a mechanism this record also describes.

### Q1 — Where does a shop's CONNECTOR access token live at rest?

050 §2 Q1 asked this about a BYOK provider key and answered *"the environment variable, and the encrypted database column is REJECTED outright and this record closes the question."* **The question here is a different one, and 050 §8's G-14 row is what makes that so rather than a convenience.**

**Lens D.** *"Start from what the value IS, because that is what 050's answer depends on. A BYOK key is a value a PERSON holds: an owner obtains it from a provider's dashboard and someone encrypts it into SOPS. The whole custody design — SOPS is the source, a tmpfs `EnvironmentFile` is the form, a restart is a re-derivation — is a design for a value with a human in its path. A connector access token has no human in its path at any point. It exists first inside an HTTP response that arrives in the middle of a redirect the merchant is still waiting on. To put it in an environment variable, somebody has to READ IT OFF A SCREEN — which means printing a bearer credential to a browser, or logging it for an operator to copy. Both are worse than any column. The alternative is that the install cannot complete, which is not an alternative."*

**Lens S.** *"Agreed on the mechanism and not on the framing, and the difference matters for what may be SAID about this afterwards. An AEAD column with the ring in the process environment defends against exactly one adversary: somebody who can read the database or a backup and cannot read the process. It does nothing against a compromised process, which holds both halves — and 046 §2.3's matrix does not currently contain a database-only adversary as a distinct actor, which was one of 050's four grounds for refusing the column. So this is adopted for a NARROWER reason than 'encryption', and the record must say so: the reason is the BACKUP, and specifically that a backup is a copy nobody can reach into and revoke."*

**Lens S, continuing, on the ground that actually moved.** *"050's decisive argument was not cryptographic. It was that the estate pushes to Backblaze B2 under **Object Lock, governance mode, 30 days**, so a credential written to a column on Monday is in an immutable offsite copy that cannot be deleted until 30 days after the shop revoked it — and *'a credential store whose deletions take 30 days to become true is not a credential store'*. That argument is sound and it does not reach this value, because of a property a BYOK key does not have: **an uninstall kills a Shopify offline token AT SHOPIFY, by the merchant's act, with no Longbox involvement.** 050 says the exact opposite of the BYOK key in its own words — *'the only complete revocation is at the provider and it is the shop's act'*, and Longbox cannot perform it. Here the provider performs it and TELLS US. So the ciphertext in the 30-day immutable copy is a ciphertext of a credential that is already dead, and the trap 050 identified is not a trap."*

**Lens D, on the third of 050's grounds.** *"050's other structural objection was locked decision 4: a rotated column value is either an UPDATE the trigger refuses, or a second row that leaves the first ciphertext in the table forever. The first half is answered by never doing it — §4's model is 050 §4's own, two append-only facts and liveness as a predicate, so a rotation IS a second row and never an edit. The second half is not answered and should be stated rather than argued away: yes, every prior ciphertext stays in the table forever. That is what an append-only store is."*

> **RULING (acting head). The connector access token is stored as AEAD ciphertext in `connector_token_version`, under 048 R18's envelope, in its own key ring. 050 §2 Q1's ruling STANDS UNCHANGED for a BYOK provider key, and is not reopened.**
>
> **The distinction is not "connector versus BYOK". It is TWO PREDICATES, stated so a future credential can be tested against them rather than compared to this one:**
>
> **(i) The value is MINTED BY THE MACHINE.** No human is in its custody path, so the SOPS→tmpfs→environment form cannot carry it without someone reading a bearer credential off a screen. A value a person types satisfies this predicate's negation and stays under 050 §3.
>
> **(ii) It is REVOCABLE AT ITS ISSUER WITHOUT A LONGBOX ACT, and Longbox is TOLD when that happens.** This is the predicate that defuses the Object-Lock ground, and both halves are required: revocability alone would not help if nothing ever told this system it had occurred, because the resolver would keep serving a dead token and the shop would keep believing it was connected.
>
> ⚠ **(ii) IS NARROWER THAN v1.0.0 MADE IT SOUND, AND S2 IS WHY THIS PARAGRAPH EXISTS.** The revocation in (ii) is **the MERCHANT's act**, and it happens when the relationship ends. Until it does, an offline token in the wrong hands works for as long as nobody looks — **so (ii) describes what is available at the END of a relationship and is NOT a kill switch Longbox holds during one.** §7.3a builds the nearest thing to one (an app-initiated revoke, whose existence at the pinned API version is signed OPEN), and what it produces is an OBSERVATION rather than a fact about Shopify's state. **The security lens's plain-words version, adopted: a leaked token's life is bounded by the merchant's attention span, and §7.3a's call is an attempt to shorten it rather than a guarantee that it did.**
>
> **THE FOUR CELLS, AND THE THIRD IMPLICIT PREDICATE (H1, v1.0.1).** A two-predicate test with two named outcomes is a test with two silent ones, and the Hickey lens stopped the signature for the missing cell. E17 reads this rule next, so it is written as a table rather than as a sentence:
>
> | | **(ii) revocable at the issuer AND the issuer tells us** | **(ii) FALSE — not revocable, or revoked silently** |
> |---|---|---|
> | **(i) minted by the machine** | **The column** (this record's case: a Shopify offline token) | **NEITHER, and this is the cell that needed writing.** Most vendor OAuth lives here: the machine mints it and nothing tells this system when it dies. A column would hold a credential whose death is invisible, so the resolver would serve a dead token indefinitely and a shop would believe it was connected. **Such a credential needs a BOUNDED LIFETIME or a RECONCILIATION story — a short-lived token with a forced re-auth cadence, or a periodic liveness probe whose failure is a fact — and NEVER a silent column.** Which of the two is a decision for the bead that meets it |
> | **(i) FALSE — a human is in the custody path** | 050 §3's environment variable, plus §3.0's clause three below | **050 §3's environment variable**, unconditionally (the BYOK key's cell) |
>
> **So the rule has a third predicate that was implicit and is now stated: (iii) THE DEATH OF THE CREDENTIAL IS OBSERVABLE TO THIS SYSTEM.** For a Shopify connector, (ii) supplies it — the uninstall webhook is the observation. Where (ii) is false, (iii) must be supplied some other way or the credential does not get a column, whatever else is true of it.
>
> **A credential satisfies (i) AND (ii) — or (i) AND a story for (iii) — or it is an environment variable.** A BYOK provider key satisfies none: a person pastes it, and no provider tells Longbox when a shop revokes it. A TOTP secret satisfies (i) and is 048 §4.2's own precedent for the same envelope, which is why this record borrows the mechanism rather than inventing one.
>
> **AND THE HONEST COST, NARROWED AT v1.0.1 BECAUSE v1.0.0 OVERSTATED IT (S1).** v1.0.0 said this defends "a database or backup reader". **The backup half was not shown and is not true of the estate as it stands.** The VPS borg include set carries `/etc` — where `age.key` lives — and the database dump **in the same archive** (`intent-os` `ops/backup/IMPLEMENTATION-MAP.md:23-27`, cited by the security lens; ⚠ **not re-read by this record**, so it is that lens's REPRODUCED claim and not this one's, and E13-D01 confirms or corrects it). One archive can therefore hold the ciphertext, the SOPS source of the ring and the key that opens it, for the Object-Lock window. **The honest scope of this encryption is a stolen DATABASE DUMP IN ISOLATION. The estate's backup fabric as it stands is NOT defended**, and the separation is booked as **E13-D01 `longbox-e5b.13.11`** (which also discharges 050 §13 item 10).
>
> **The counterweight, stated because it is real and because it is not a rebuttal.** 050 §2 Q3 concedes that a BYOK key sits in every prior revision of the SOPS file, in git and in every backup of it. So on BACKUP EXPOSURE the column loses nothing relative to the variable — both are in the archive — and it **gains a destruction primitive the variable does not have**: destroying a key version makes every ciphertext under it permanently unopenable (§3.2), which is 041 §8.3's pattern and which no amount of editing a SOPS file achieves for the revisions already taken. **That is an argument for the column and not for the sentence v1.0.0 wrote**, and the two are kept apart here on purpose.
>
> **And the cost that survives both.** The process holds the ring and the ciphertext, so nothing here defends against process compromise. **The sentence "the connector token is encrypted" is never allowed to mean more than this paragraph says**, at any class (021 B15/B16), and §11 I1's canary is the instrument rather than the adjective.

**The corollary that keeps the ruling narrow.** The ring is `LONGBOX_CONNECTOR_KEY_V<n>` and is **deliberately not the authenticator's**. One key for two subsystems means one compromise is two — and it would make the one destruction this system can actually perform (destroying a key version so a stored ciphertext can never be opened again, which is 041 §8.3's pattern) an act that also takes every owner's second factor with it. Two rings, two variables, two blast radii.

### Q2 — Is this a sixth `shop_credentials` kind, or its own tables?

**Lens D.** *"`shop_credential_version` exists so a rotation is two facts and liveness is a predicate, and its whole discipline is that it holds a NAME and never a value — `credentialVersions.ts` says so in its header and means it: 'THIS MODULE NEVER SEES A KEY VALUE.' Adding a nullable ciphertext column would put a value in the one table built to hold none, and would make every reader of every row ask which of two shapes it is. That is Hickey's complaint about a map with optional keys, arriving as a schema."*

**Lens S.** *"And a security consequence Lens D is understating. `resolveKeyRef` refuses a name outside the shop's namespace BEFORE reading `process.env` — that is 046 §5 A7's control and it is a control over NAMES. A row whose payload is a value has no namespace to be checked against, so a single table would have two rows with two different security models and one code path, which is how a control gets applied to the wrong half."*

> **RULING. Its own tables.** Five of them (§5), sharing 050 §4's SHAPE and none of its columns. The two subsystems stay separate in code as well: `src/providers/` continues to resolve names, `src/services/connectors/shopify/` resolves authority, and `shop_credentials`' Shopify row keeps working for a shop with no connector install (§7.4).

### Q3 — Which scopes, and how is "least" made checkable?

**Lens S.** *"'Least privilege' asserted in a comment is worth nothing; it is a property of a constant a build refuses to let anyone change quietly. Two mechanisms: a PINNED test over the list, so widening it is an edit somebody must justify in a PR, and a two-sided check at install time — refuse a grant that is INSUFFICIENT, and refuse one that is EXCESSIVE. The second is the one people skip and it is the one that matters: a token carrying authority nobody argued for is a token whose blast radius is undocumented, and it arrives through an app configuration drifting rather than through an attack."*

**Lens D.** *"With one warning about a subtlety that will bite. Shopify's grant model treats a write scope as carrying its own read, so a naive set-equality check refuses a perfectly good install the first time the provider returns only `write_products`. The implication has to be applied, and in ONE direction only — a write implies its read, never the reverse — or `read_products` alone would satisfy `write_products` and the check would be decorative."*

> **RULING. `write_products` and `read_products`, both argued, pinned by a test, and checked two-sidedly with the write⇒read implication applied one way** (§6). **And the strongest line in the list is a scope that is ABSENT**: 019 T19 signs auto-publish at ZERO and marks it non-waivable, so the app does not hold `write_publications`. Hardcoding `status: "DRAFT"` is a code review away from being wrong; not holding the capability is not.

### Q4 — Where does an uninstall come from, and what does it end?

**Lens D.** *"From a webhook, and there is no alternative worth discussing — polling for 'am I still installed' means asking with the credential whose validity is the question. So the ending is caused by a message from another system, which makes it 041 §2.5's external observation, and the fact has to carry its evidence: a retirement claiming an uninstall with no signed message behind it is a claim about somebody else's system with nothing under it, which is what 018's rung rules forbid."*

**Lens S.** *"Then constrain it at the schema, not in a service, because the service is where somebody adds a convenience path. And end EVERY live version, not the newest: an overlap window is legal while a rotation is proven (050 §2 Q2), and an uninstall kills all of them at Shopify simultaneously. Retiring only the newest would leave a version this system believed it could use and Shopify had already invalidated — which is the failure 050 §5(a) inverts the ordering to avoid, arriving from the other direction."*

> **RULING. `app/uninstalled` writes the receipt and retires EVERY live version, with `reason_code = 'uninstall'`, and a CHECK requires that reason to cite the `connector_webhook_receipt` that caused it.** The three reason codes are a CLOSED set — `uninstall`, `rotation`, `revocation` — unlike `shop_credential_retirement`'s open-world one, because each says something DIFFERENT about the provider side and a fourth would be a fourth meaning (§7.3). **And the refusal is what makes it true**: the resolver refuses on the next read, while the ciphertext is still in the row.

### Q5 — What must the inbound surface give up, and what replaces it?

**Lens S.** *"This is the question I want in the record, because it is the one where a build agent would quietly do the wrong thing. Two of this server's controls CANNOT apply to a caller that is not our client: `Sec-Fetch-Site` is a browser header a server-to-server POST does not have, and `Idempotency-Key` is a Longbox convention Shopify has never heard of. The wrong answers are both available and both look reasonable — demand them and the receiver is unreachable (so somebody makes it unsigned instead), or drop them silently and the exemption spreads to the next awkward route. The right answer is to REPLACE each with something stronger and to DECLARE the replacement per route."*

**Lens D.** *"And the replacements really are stronger, which is why this is a substitution and not a waiver. A cross-site HTML form cannot produce a valid HMAC over the body — that is a strictly stronger statement than 'this request claims to be same-origin'. And a NAMED UNIQUE on the act is a stronger exactly-once guarantee than a header the caller chose, taken by the database, on the act itself — which is 042 §5.1's own (b2) argument, arriving for a second class of route. It must be NAMED, though: §5.1 already rules that 'a UNIQUE constraint' alone is not a test, because every table here has a surrogate primary key."*

> **RULING. A new AUTH-allowlist kind, `provider-callback`, bounded by a row and an argument per route** (§8). It licenses exactly two substitutions and nothing else, and each route names the UNIQUE index that carries its exactly-once guarantee, which a contract test reads out of `migrations/`. **Two ratified invariants are amended rather than dodged**, and both amendments land in the same PR: 042 §5.1 gains a second exemption class (**042 → v1.4.3**), and 048 I6(d) is restated (**048 → v1.5.2**) as *no GET mutates on the strength of an AMBIENT CREDENTIAL* — its own stated ground, in §5.3, is that a cross-site GET carries the browser's cookie, and this route reads none.

---

## 3. Decision A — Custody

Restated as a rule the code is tested against:

> **A credential this system holds lives as AEAD ciphertext in a column ONLY IF it satisfies (i) — it is minted by the machine, with no human in its custody path — AND ITS DEATH IS OBSERVABLE TO THIS SYSTEM. Predicate (ii) is the ordinary way (iii) is supplied and is not the only one: a credential in §2 Q1's (i)-true/(ii)-false cell needs a bounded lifetime or a reconciliation story instead, and never a silent column. Clause three (§3.0) admits a credential that fails (i) to the SAME lifecycle where the uniformity is argued and the human-path variant is named. Everything else is an environment variable under 050 §3, and 050 §2 Q1's refusal of the column for a BYOK provider key stands unchanged.**
>
> ⚠ **v1.0.1 STATED THIS AS "IF AND ONLY IF … BOTH PREDICATES", AND THAT CONTRADICTED ITS OWN RULING TWICE OVER** (the gate audit of `843652c`, B6). §2 Q1's ruling is three-way — *"(i) AND (ii) — or (i) AND a story for (iii)"* — and §3.0's clause three admits a credential that fails (i) outright. A rule stated as a biconditional in the section that restates it, while the section that decides it states a disjunction, is the kind of drift that gets resolved by whichever sentence a later reader happens to find first. **The ruling did not move; the restatement did.**

**3.0 THE THIRD CLAUSE, AND IT IS ABOUT THE PILOT'S OWN TOKEN (S3, v1.0.1).** The rule as stated above fails on a case this repository already contains, and the security lens found it: **the pilot's per-store Dev Dashboard token has a human in its custody path.** An operator copies it out of Shopify's admin, so it fails predicate (i) outright — and §5.3's `install_state_id` is nullable precisely so §7.2's CLI can introduce that token under the same lifecycle as a machine-minted one.

> **CLAUSE THREE. A credential that fails (i) may share the custody of one that satisfies it WHEN it is held under the SAME lifecycle — the same version table, the same liveness predicate, the same ending, the same resolver refusal — AND the human-path variant is NAMED as such rather than absorbed silently.**

**Three grounds, and the second is the one that makes this a rule rather than an accommodation.** (a) The alternative is two custody mechanisms for one credential kind, which means two code paths, two failure modes and a reader who must ask which shape a row is — the exact objection §2 Q2 uses to refuse a nullable ciphertext column on `shop_credential_version`. (b) **Uniformity is itself a security property here**: a Dev-Dashboard token held in an environment variable would be OUTSIDE the ending this bead built — no retirement row, no resolver refusal, no receipt — so the pilot's own credential would be the one credential an uninstall could not end. (c) The human-path variant is **visible in the data**, not just in prose: `install_state_id IS NULL` is exactly "no merchant consented to this through a grant", which §5.3 already says is a distinction worth keeping rather than papering over.

**What clause three does NOT license.** It is not "a human-held credential may go in a column". It is "a credential may join a lifecycle that already exists for its kind". A BYOK provider key has no such lifecycle to join — `shop_credential_version` holds NAMES — so 050 §3 governs it, unchanged.

**3.0a THE ADVERSARY THIS RULING IS FOR, NAMED IN THE THREAT MODEL (S5, v1.0.1).** The security lens's sharpest procedural finding: the actor this encryption defends against — **someone who obtains an offline copy of the database WITHOUT process access** — appears in neither 046 §2.3's principal matrix nor 050's. **A control whose adversary is not in the threat model is a control nobody can audit**, and it is how an encryption survives review on the strength of the word rather than the property. 046 gains that abuse case by amend-by-a-row, with its detector, and this section cites it rather than restating it: **046 §5.2 A18** (`046:308`; see 046 v1.2.0's change log). ⚠ v1.0.1 wrote **A16** twice, which is 046's STOREFRONT HTML INJECTION row — a citation that resolves to the wrong threat is worse than one that resolves to nothing, because it reads as checked. Its detector is §11 I1's canary extended to the dump surface, and its unresolved half is exactly S1's: until **E13-D01** separates the key material from the database archive, the estate's own backup does not satisfy A18's "without process access" clause, because the archive carries both.

**3.1 The envelope is 048 R18's, clause for clause, and each clause is here because its absence is a known failure.** AES-256-GCM (an unauthenticated ciphertext in a database is malleable by anyone who can write to it, and the failure is silent); a fresh random nonce per row in its own column (GCM nonce reuse under one key is catastrophic rather than degrading); **the row's `id` as additional authenticated data**, which is why `connector_token_version.id` has NO DEFAULT — the AAD must be known before the ciphertext is computed, so the application mints the uuid; and `key_version smallint NOT NULL` from day one, because a rotation with no version column is a rotation that has to guess, per row.

**The AAD binding is a TENANCY control and not only an integrity one.** A ciphertext lifted from one shop's row and pasted into another must FAIL TO AUTHENTICATE rather than decrypt to a working token — 019 T24's cross-tenant line enforced by cryptography rather than by a WHERE clause. §11 I4 is the assertion.

**3.2 Rotation is additive and destruction is real.** Every key version present in the environment DECRYPTS; the highest present ENCRYPTS. So introducing `..._V2` is a variable and a restart with no row touched, and **removing `..._V1` is the retirement** — enforced by the rows themselves, since a version still at `key_version = 1` stops opening the moment the variable leaves. That is 041 §8.3's pattern (a key that lives outside the database is the one thing an append-only store can destroy) reaching a credential for the first time in this repository. **The failure mode is stated rather than discovered**: a key removed before its rows are re-sealed takes those installs with it, and the way back is a NEW INSTALL — a connector token has no recovery code.

**3.3 What the code never does.** It never logs a token, never returns one in an error, never puts one in a receipt, and never derives anything printable from one — no prefix, no last-four, no digest offered as a "hint", each of which is a reduced-keyspace copy of a credential sitting beside its own digest (`024`'s header, adopted verbatim).

**3.4 The APP's own credentials are a DIFFERENT object and stay under 050 §3.** `SHOPIFY_APP_CLIENT_ID` and `SHOPIFY_APP_CLIENT_SECRET` are one pair for the deployment, obtained by a PERSON from a dashboard and typed into SOPS — so they satisfy predicate (i)'s negation and are environment variables, never columns. **The distinction is the whole of why §2 Q1's ruling is narrow**: within one connector, one credential is a column and the other is a variable, and the predicate is what tells them apart.

**3.5 A verifier with no key accepts nothing.** `resolveAppCredentials` returns `undefined` when the deployment has no connector app, and every entry point refuses outright rather than proceeding with an empty secret. **The routes still EXIST when unconfigured**, and that is deliberate: a 404 would tell an unauthenticated caller which deployments have a connector configured, and an absent route is a route somebody wires up later without the verifier.

---

## 4. Decision B — The lifecycle is append-only facts, and liveness is a predicate

050 §4's model, one connector over, with the shapes in §5:

```
live(v)      := exists introduction(v) ∧ ¬exists retirement(v)
resolve(s,c) := the live version of (s,c) with the greatest version_no
```

- Exactly one live version → its sealed token authorises the call.
- **Zero live versions, but the shop has ≥1 version row → REFUSED. Never the static admin token.** This is 050 §4's rule with "credential" replaced by "connector", and it is the half that makes an uninstall real: without it, a shop whose app was removed would silently resume drafting through `SHOPIFY_ADMIN_TOKEN`, and the "deletion" would have made the system keep working.
- **No version rows at all → the legacy static path** (§7.4), which still degrades to the stub. 046 G-14 closes by giving the defect a successor, not by breaking the pilot the week the successor lands.
- **More than one live version → the newest wins and the overlap is legal.** Introducing N+1 does not retire N; a person or an uninstall does.

**There is no cache, and that is a decision rather than an oversight.** The read path gains a join for a value that changes rarely. The obvious mitigation is deliberately not taken, for `credentialVersions.ts`'s reason arriving a third time: **a cached credential is a retired credential still working**, which is the exact failure the ending exists to prevent.

---

## 5. Decision C — The schema (`migrations/026`)

Five tables, all append-only, all `ENABLE ALWAYS`, all declared in `src/db/appendOnlyTables.ts`. **No exemption and no mutable column anywhere in the subsystem** — `025` needed one for 048 R19's replay guard and this needs none, because every guard here is a UNIQUE index instead.

**5.1 `connector_install_state`** — the OAuth `state`, which is the CSRF token of the authorization-code grant. `state_digest` holds `sha256(state)` and nothing else. `requested_scopes` is recorded at issuance so the callback can compare what was ASKED with what was GRANTED — a comparison that is impossible if the request is not written down. `shop_domain` is on the row so a state minted for one store and redeemed against another is refusable. `expires_at` is an issuance fact; "expired" is a predicate over it (041 §2.4) and nothing marks a state expired.

**Why a row and not a signed cookie.** The browser that starts the install and the browser that returns are not guaranteed to be the same one, and a single-use guarantee wants a UNIQUE index, which a cookie cannot have.

**5.2 `connector_install_state_use`** — `UNIQUE (state_id)`. **The whole mechanism**: a replayed callback is a failed INSERT the database decides. `connector_token_version_id` is NOT NULL, so "the state was spent and no token exists" is not a state this schema can hold.

> **A FAILED TOKEN EXCHANGE LEAVES THE STATE RE-ATTEMPTABLE, AND THAT IS INTENTIONAL (H4, v1.0.1).** The use row is written INSIDE the transaction that introduces the token version, so a callback that fails at the exchange, at the scope check, or anywhere before it spends nothing: the merchant can be sent back through and the same state still works, until it expires or Shopify's own authorization-code window closes — whichever comes first, and the second is usually shorter. **Do not "fix" this by spending the state before the exchange.** The obvious tidy — mark it used the moment it is presented — turns every transient network failure into a dead install the merchant must restart, and buys nothing: the replay it would prevent is already prevented by the UNIQUE on the same row, and a state that is spent but produced no token is precisely the half-state `connector_token_version_id NOT NULL` exists to make unrepresentable.

**5.3 `connector_token_version`** — the introduction, with the value sealed. `id` has no default (§3.1). `UNIQUE (shop_id, connector, version_no)` makes a concurrent double-introduction fail loudly. `install_state_id` is NULLABLE, because not every introduction comes from an OAuth grant: the pilot's per-store Dev Dashboard app produces a token an operator holds, and §7.2's CLI introduces it under the same lifecycle. **A version with no state is a version nobody can claim a merchant consented to** — a distinction worth keeping visible rather than papering over with a synthetic state row.

**5.4 `connector_token_retirement`** — the ending. `UNIQUE (connector_token_version_id)`: at most one per token, because a replacement is a new version rather than a second ending. `reason_code` is a CLOSED set of three (§2 Q4), and a CHECK requires `uninstall` to cite its `webhook_receipt_id`.

**5.5 `connector_webhook_receipt`** — WHICH signed message arrived, and nothing it said. `UNIQUE (connector, webhook_id)` on Shopify's own id is the dedupe key. `payload_digest` is `sha256(raw body)`: the receipt proves which bytes arrived and carries none of them, because a `customers/…` payload is personal data by construction and 041 §8.4's rule is that the log holds references and not values. `topic` is OPEN-WORLD on 050 §4's stated reason for `shop_credential_retirement.reason_code` (§2 Q4 carries the citation) — a CHECK would turn an authentic message this build has not heard of into a 500 and a retry storm, which is how an app gets its webhooks disabled by the provider.

> **THE TENANT IS RESOLVED FROM THE INSTALL'S OWN ROWS, NOT FROM `shop.shopify_domain` (v1.0.1, the invariant review of `16f17ef`).** The first implementation read `SELECT id FROM shop WHERE shopify_domain = $1`, and **nothing sets that column** — it is nullable, `register-shop` writes NULL, and `connector-install` never compares its `--domain` to it. On a shop registered the ordinary way, a validly signed `app/uninstalled` therefore resolved no shop, **retired ZERO tokens**, and left §7.4's refusal — the half that makes an ending mean something — unreachable. **A control that cannot be reached is not a control.**
>
> The key is now the one an authenticated grant actually wrote: the signed store header is matched against **`connector_token_version.shop_domain`**, and every live version for that STORE is retired under its own `shop_id`, whichever Longbox shop holds it. The receipt's `shop_id` is set when exactly ONE shop matches and stays NULL otherwise — naming an arbitrary one of several would be the same defect in a different query.
>
> **It was also a 019 T24 exposure on its own**: `shop.shopify_domain` carried no UNIQUE and the query took `rows[0]` with no `ORDER BY`. `026` now adds a **partial unique index** on it. That is belt-and-braces on a column this path no longer reads, and it is worth the row for a reason this repository keeps rediscovering: **removing the READER makes a bug unreachable; the CONSTRAINT makes the STATE unrepresentable**, so the next reader of that column cannot reintroduce it. The index can fail to apply on a database already holding two shops with one domain — which is the intended behaviour, because that is exactly the state that would have ended the wrong shop's authority.
>
> **`shop_id` IS NULLABLE ON THE RECEIPT, ALONE IN THIS FILE, AND THE REASON IS RECORDED RATHER THAN INFERRED.** Locked decision 4 puts a `shop_id` FK on every shop-scoped table and every table here carries one. On the receipt it is nullable because the receipt is an OBSERVATION OF ANOTHER SYSTEM'S ACT whose tenancy is the HMAC-verified `shop_domain`, not a Longbox id — and the commonest `shop/redact` arrives for a shop that has already been offboarded. The choices are to record the fact with a null resolution or to record nothing. **Recording nothing is the worse answer**: E03-B09 needs the fact, and a privacy webhook this system silently discarded is the failure that reads as compliance until somebody asks. Inventing a `shop_id` would be worse still. `shop_domain` is NOT NULL, because it is always known — it is inside the bytes the signature covers.

---

## 6. Decision D — The scopes, argued one at a time

**`SHOPIFY_REQUIRED_SCOPES = ["write_products", "read_products"]`**, `SHOPIFY_SCOPE_LIST_VERSION = 1`.

- **`write_products`** — `productSet` is a product write, and a DRAFT product is the single outward act this system performs. It is the only scope whose absence makes the system pointless rather than merely degraded.
- **`read_products`** — required by the FAIL-CLOSED GUARD, not by convenience. 043 A3 makes the draft consumer refuse a retry against an existing draft with ZERO `listing_status_observation` rows, because unknown means do not touch; those rows are populated by reading the product back from Shopify (E10-B05's watcher). **A connector with no read scope can never obtain the positive evidence the guard demands**, so every retry dead-letters and the guard degrades from a safety property into an outage.

**Never requested, each with the line it would breach** (the full list and its arguments are in `policy.ts`, and a test asserts every entry carries one): `write_publications` and `write_product_listings` — 019 T19 (auto-publish = 0, NON-WAIVABLE) and 033 B3; `read_orders` / `write_orders` — Longbox never sees a sale, and an order carries the buyer; `read_customers` / `write_customers` — protected customer data, and 041 §8.4's rule is cheapest to keep true by never being able to read one; `read_inventory` / `write_inventory` — a DRAFT carries no inventory quantity, and 036 §2.1 makes `physical_item` the inventory identity inside Longbox.

**The scope-list VERSION is not Shopify's API version.** It is this repository's count of how many times the authority it asks a merchant for has changed, and it exists because **a scope change is a CONSENT change**: a token minted under list 1 was authorised against list 1, and `granted_scopes` is recorded per row, so a list bump is a visible difference between two live rows rather than a silent widening.

**The check is two-sided and the implication runs one way.** A grant is accepted when it covers every required scope under write⇒read, and REFUSED when it carries anything outside the declared maximum. Widening the maximum is a PR with an argument, never a runtime accommodation.

---

## 7. Decision E — The three acts, and who may perform them

**7.1 Liveness and resolution** — §4, in `custody.ts`, with `isLive` as the one definition.

**7.2 Starting an install is a CLI, on the E03-D06/E03-D07 precedent.** 048 §7.3 puts owner acts in a privileged session; 048 §12.4 row 3a records that privileged sessions do not exist; so `mintInstallState` is a real service with a real state row, reached from `pnpm connector-install`. The merchant-facing landing an unlisted public app needs (Shopify's `app_url`) is **DECLARED `pending: true`** on the auth allowlist with **E10-B02** named, so its principal is a decision somebody already made rather than one inferred by whoever adds the handler. **OFFLINE access is requested**, because an online token expires with the merchant's browser session and 043's job model assumes the authority outlives the request that created it.

**7.3 Ending it.** An `app/uninstalled` webhook retires every live version and produces a receipt per version. `pnpm connector-retire-token` offers `rotation` and `revocation` and **deliberately does not offer `uninstall`** — a human typing that would be recording a third party's act with no evidence, which the schema CHECK also refuses. **The receipt says what each ending achieved and what it did not**, per reason, because the three differ exactly there: an `uninstall` means the token is dead at Shopify by the merchant's act; a `rotation` or a `revocation` means only that this system will never present it again.

**7.3a The provider-side revoke, and the sentence it replaced (S2, v1.0.1).**

`RETIREMENT_MEANING.revocation` used to read *"only the merchant can end it there, by uninstalling the app"*. **That is 050's true sentence about a BYOK key, transplanted onto a credential it does not describe** — an app holding an offline token can call Shopify's own app-uninstall endpoint WITH THAT TOKEN — and it sat in the one artifact 041 §8.2 forbids untrue statements in. The security lens found it, and this section is the repair.

**What was built.** `revokeAtProvider` (`api.ts`) DELETEs the app's own installation using the token, and `pnpm connector-retire-token --reason revocation` calls it for every live version before the retirement is appended. `connector_token_retirement` gains two columns — `provider_revocation_attempted_at` (a fact about a LONGBOX act, exactly as 050's `instructed_at` is) and `provider_revocation_http_status` (041 §2.5's external observation: what this system OBSERVED in reply). **There is still no column asserting the token is dead at Shopify**, and there will not be: a 200 is evidence a request succeeded, not a fact about another system's present state, and 018's rung rules forbid recording an unverified third-party state as a fact.

**The ordering is 041 §8.2's, applied to a credential.** The call happens BEFORE the transaction — *"where an operation spans a transactional store and a non-transactional one, the non-transactional side goes first and the transactional side is the record of it"*. Append first and the call fails, and the row is a permanent false statement the trigger forbids repairing; call first and the append fails, and the operator re-runs. **And the retirement is NOT contingent on the call succeeding**: this system stopping is not something a provider gets a vote on, so a 4xx, a 5xx or a transport failure still ends the token here and the receipt says what happened.

> ⚠ **THE ENDPOINT'S EXISTENCE AT THE PINNED API VERSION IS AN ASSUMPTION SIGNED OPEN, in 043 A11's idiom.** No call to Shopify's documentation or to a store was made while writing this, and 018 makes an unverified third-party interface an assumption rather than a fact. **Its closing evidence is 043 A11's: one call against the ISOLATED DEV STORE named in `.env.example`, before this path serves a real shop.**
>
> **What is NOT contingent on it** is everything a wrong guess would otherwise hide. The two columns record what was CALLED and what came BACK; `revocationOutcome` renders FOUR cases including *no attempt was made*; and a 404 or a 405 reports *"treat the token as still usable at Shopify"*. **So a wrong guess about the endpoint degrades to a truthful receipt rather than to a false one**, which is the property that let this ship with the assumption open.

**7.4 The client's precedence, and the pilot.** `resolveShopifyClientForShop` resolves a live connector token first; refuses when versions exist and none is live; and falls through to the legacy static path only for a shop with no connector version at all. **The pilot keeps working** — the per-store Dev Dashboard token is the "no versions" case — and the cutover is E16-B02's.

---

## 8. Decision F — Authenticity, and the two mechanism substitutions

**8.1 The store domain is checked before it is used for anything.** `isShopifyShopDomain` is an ANCHORED whole-string match against a conservative alphabet, and it is an **SSRF control rather than a validation nicety**: the next thing an install does with the `shop` parameter is build `https://<shop>/admin/oauth/access_token` and POST **this app's client secret** to it. A permissive check turns this server into a courier that delivers its own secret to whoever asked. It is checked twice on that path, and the redundancy is not worth removing.

**8.2 Two signature shapes, one secret, both timing-safe.** The callback's HMAC is over the sorted query with `hmac` and `signature` excluded, hex; **a duplicated parameter is REFUSED outright** rather than resolved first-or-last, because an attacker who can add a second `shop=` and have the verifier sign one value while the application reads the other has a parameter-smuggling primitive and there is no safe convention. The webhook's HMAC is over the **RAW BODY**, base64 — never over a re-serialisation of the parsed JSON, which changes key order and whitespace and can be made to accept wrong messages by anyone who understands it. **Both verify BEFORE any row is read or written**, so a forged message costs one HMAC and leaves no trace; §11 I2 asserts that as row counts.

**8.3 The two substitutions, declared per route.** `AUTH_ALLOWLIST` gains `kind: "provider-callback"`, and `RouteSpec` gains `idempotency: { exemptionClass, uniqueOn, reason }`. A row of that kind is `principal: "none"` (asserted), skips the `Sec-Fetch-Site` check and the `Idempotency-Key` requirement, and names the constraint that replaces the second one:

| Route | Replaces `Sec-Fetch-Site` with | Replaces `Idempotency-Key` with |
| --- | --- | --- |
| `GET /api/v1/connectors/shopify/callback` | the query HMAC under the app secret, plus a single-use state Longbox minted | `connector_install_state_use (state_id)` — and note the ASYMMETRY §5.2 argues (H4): the use row is written inside the transaction that introduces the token, so a callback failing at the exchange or the scope check spends NOTHING and the same state stays re-attemptable until Shopify's own authorization-code window closes. **Exactly-once is not the same property as spend-on-presentation**, and the second one must not be added |
| `POST /api/v1/connectors/shopify/webhooks` | the body HMAC under the app secret | `connector_webhook_receipt (connector, webhook_id)` |

**Every refusal on the callback is ONE code** (`CONNECTOR_CALLBACK_REFUSED`, 400) with empty `details`, on 048 §9.3's constant-answer reasoning: a caller who could tell `unknown_state` from `state_expired` from `domain_mismatch` would hold an oracle over which install states exist. `rate_limited` is the one exception and must be — 042 §4.4 makes `retryable` a fact the server states, and a throttle discloses nothing. A webhook that fails authentication is **401** (`WEBHOOK_SIGNATURE_INVALID`), which is also Shopify's own expectation on the compliance topics; a throttled one is **429**, because Shopify retries a 429 and does not retry a 401, and collapsing the two would mean a shop that tripped a provisional floor lost the message permanently.

**8.4 Rate classes.** Both routes declare `ordinary`. The hook takes the per-ROUTE aggregate bucket (there is no tenant yet), and the per-SHOP bucket is taken in the service **after the signature verifies** — so an unsigned flood is refused more cheaply than a signed one, and no unauthenticated caller can choose which shop's budget to exhaust.

---

## 9. What is shop-facing, and is NOT written here

**The install and consent SURFACE is E10-B02's, and its copy is a candidate C-row for 021 under the T26 pre-send.** The callback answers JSON, not a page, because 042 §4.3 rules that the server emits no operator prose — so this bead does not need the words and does not write them. 050 §5 routes the offboarding wording the same way and this record does the same for the connector's: **it is not written here.**

**TWO** candidate rows are filed in 021 §4a with their context, unsettled, exactly as 041 §8.7(e) and 050 §5 route theirs: **C-CANDIDATE-E03B06-1**, the install-and-consent screen (E10-B02's), and **C-CANDIDATE-E03B06-2**, what a shop is told when its connector authority ENDS (E03-B09's, with the pilot paperwork). The second carries a constraint worth repeating: **the three endings are not the same sentence** — an uninstall means the token is dead at Shopify by the merchant's own act, while a rotation or a revocation may imply nothing about the provider side beyond what §7.3a actually observed.

**The three compliance webhooks are acknowledged, recorded and ROUTED.** What a shop or a person is entitled to, on what clock, and what they are told is 041 §8.7(d)/(e)'s NEEDS-COUNSEL material and **E03-B09's** bead. What this bead owes is that the message is authenticated, is recorded as a fact with a digest and no payload, and cannot be lost — because a privacy request this system silently discarded is the failure that reads as compliance.

---

## 10. The 046 rows this closes, and the ones it does not

**Closed by this record together with its code half:**

| 046 row | What it was | How it closes |
| --- | --- | --- |
| **G-14** (`046:355`) | *"Static Shopify admin token; no OAuth lifecycle, no revocation"*, owner **E03-B06** | §4–§8 — an issuance fact, a scope record, an ending caused by a signed message, and a resolver that refuses rather than falling back |
| **§2's asset row A14** (`046:107`) | *"A static admin token has no revocation story of its own"* | §7.3 — it has one now, and the receipt states its limits per reason |

**Partially closed, with the remainder named:**

| Row | What closes | What does not |
| --- | --- | --- |
| **§1 E24** (`046:65`) | *"There is no inbound webhook of any kind and no signature verification"* — there is one now, HMAC-verified before any write, replay-safe by a named UNIQUE | E24's subject is E03-B08's GENERIC signed-webhook design (a signing secret, a replay window, an ordering rule for a SCHEME this repository owns). This bead verifies **SHOPIFY's** signature with **Shopify's app secret** — a scheme the provider owns — and takes no position on the generic one |
| **§5 A13** (`046:302`) | *"A forged webhook — someone posts a fabricated listing-status event"*: for the Shopify connector's surface, a forged message is refused before any row and a replay is a no-op | A13 is booked to **E03-B08 with E10-B08**, and the LISTING-STATUS receiver those beads own does not exist. This record closes the abuse case on the surface it built and leaves theirs open |

**Explicitly NOT closed, with the owner named:**

| Row | Owner | Why not here |
| --- | --- | --- |
| **G-13** — no signed webhooks, no replay defence, no privacy WORKFLOWS | **E03-B08**, with **E10-B08** (`046:354`) | The workflows are E03-B09's; this bead records the request and performs none |
| **G-21 / E28** — Shopify receives relative image URLs | **E10-B04** staged uploads, with E03-B07 | Untouched: this bead changes the AUTHORITY the draft call carries, not the payload |
| **A11 (043)** — the `customId` upsert-consistency assumption, signed OPEN | E10-B03 / the dev-store measurement | Unchanged |

---

## 11. Contracts the code half satisfies

Each is falsifiable and names its test. **None existed at `ec9b465`.** *(Twelve at v1.0.0; **I13–I18 added at v1.0.1** — S4, S2 and S1 from the cannon, and findings 1, 2, 4, 5 and 6 from the invariant review of `16f17ef`.)*

| # | Invariant | Test |
| --- | --- | --- |
| **I1** | **No connector token's plaintext reaches any of 019 T31's surfaces.** A canary planted in a real token, sealed by the real function, appears in no column, no error, no key-ring message and no receipt — and the assertion is on the VALUE, never on a redaction rule | `tests/contract/secret-surfaces.test.ts` |
| **I2** | **A forged webhook and a tampered callback write NOTHING.** Row counts across all five tables are identical before and after — the ordering assertion, not the status code | `tests/integration/connector-oauth.test.ts` |
| **I3** | **A replayed callback is refused by `UNIQUE (state_id)` and writes no second token version**; a redelivered webhook writes no second retirement | same file |
| **I4** | **A ciphertext moved between rows fails to authenticate** — 019 T24 enforced by the AAD binding rather than by a WHERE clause | same file |
| **I5** | **The scope list is pinned, and every forbidden scope carries an argument.** Changing the list fails a test rather than passing a review | `tests/connector-oauth.test.ts` |
| **I6** | **A grant that is insufficient OR excessive is refused**, with the write⇒read implication applied in one direction only | `tests/connector-oauth.test.ts`, `tests/integration/connector-oauth.test.ts` |
| **I7** | **The store domain check refuses every smuggling shape** — fragment, query, userinfo, port, path, scheme, subdomain, newline, wrong suffix | `tests/connector-oauth.test.ts` |
| **I8** | **An uninstall retires EVERY live version, cites its receipt, and the client then REFUSES** while the ciphertext is still in the row | `tests/integration/connector-oauth.test.ts`, `tests/consumers-registry.test.ts` |
| **I9** | **Every member of 042 §5.1's class two NAMES a UNIQUE index that exists in `migrations/`** — the string is read and the SQL is searched, because "a UNIQUE constraint" alone is not a test | `tests/contract/api-contract.test.ts` |
| **I10** | **A GET may mutate only as a declared `provider-callback` whose principal is `none`**, asserted as set equality in both directions so neither the carve-out nor a stale row can drift | `tests/contract/csrf-mechanisms.test.ts` |
| **I11** | **Both routes' declared rate classes are ENFORCED at a named, reachable site**, and the per-shop bucket is taken after the signature | `tests/contract/rate-class-enforcement.test.ts` |
| **I12** | **All five tables refuse UPDATE and DELETE**, an `uninstall` with no receipt is refused by CHECK, and a second retirement by UNIQUE | `tests/integration/append-only.test.ts`, `tests/integration/connector-oauth.test.ts` |
| **I13** *(v1.0.1)* | **`openTokenValue` refuses another shop's version id.** The AAD binding defends a ciphertext against being MOVED between rows and says nothing about a caller asking for the WRONG row; `shop_id` is in the `WHERE`, and a wrong shop is a zero-row read answered exactly as an absent version | `tests/integration/connector-oauth.test.ts` |
| **I14** *(v1.0.1)* | **A provider-side revoke is attempted, and what was CALLED and what came BACK are recorded — with no column claiming the token is dead at Shopify.** Four rendered outcomes including *no attempt was made*; a status with no attempt is refused by CHECK | `tests/integration/connector-oauth.test.ts`, `tests/connector-oauth.test.ts` |
| **I15** *(v1.0.1)* | **No receipt sentence claims what this system cannot know** — not about the backup, and not about the provider. Two FALSE sentences are asserted ABSENT rather than merely fixed: *"only the merchant can end it there"*, and any residual implying a backup copy is a defended copy | `tests/connector-oauth.test.ts` |
| **I16** *(v1.0.1)* | **The uninstall resolves its tenant WITHOUT `shop.shopify_domain`**, on a shop whose column is NULL — the shape `register-shop` produces — and two shops sharing one store domain are unrepresentable | `tests/integration/connector-oauth.test.ts` |
| **I17** *(v1.0.1; strengthened at v1.0.2)* | **Neither route logs its request line, AND an unhandled 500 still emits one carrying the correlation id.** The two are asserted together because they are opposites and the first attempt satisfied one by destroying the other: `logLevel: "silent"` on the routes removed the URL line and every ERROR line with it, so a 500 mid-install would have left no server line for 042 I14's id to be joined to. **Silencing a logger to redact a field is a redaction that deletes the evidence.** The suppression now lives in `src/app.ts` as a `logController` predicate DERIVED from the `provider-callback` allowlist rows, and reads only the path before `?`. Also here: a correctly signed webhook answers 200 through the real server, which is the only place the encapsulated raw-body parser is exercised | `tests/integration/connector-http.test.ts` |
| **I18** *(v1.0.1)* | **Sealing and opening a connector token write nothing to any stream** — every `console` method plus `process.stdout`/`stderr`, with a sink probe proving the capture is live. The gate was proved able to fail by planting the leak it was written for | `tests/contract/secret-surfaces.test.ts` |

---

## 12. Migrations

`026_connector_oauth.sql` — the five tables of §5, their UNIQUE indexes, their append-only triggers created `ENABLE ALWAYS` in the same breath, and their rows in `src/db/appendOnlyTables.ts`. **Expand only; no `-- contract:` header**, because nothing here retires anything: `shop_credentials`' Shopify row keeps working for a shop with no install, and its retirement is a later contract step with its own 006 row.

**Also required and not a migration:** the app-role grant plan covers the five automatically, because it is driven by the declared list — and every one classifies append-only, so the grant is `SELECT, INSERT` and nothing more. **None of the five carries a mutable column**, so none needs the `updateColumns` grant class E03-D06 added.

---

## 13. Alternatives considered

**A1 — The environment-variable path for the access token** (`LONGBOX_<SLUG>_SHOPIFY_KEY`, written by an operator step). *Rejected*, §2 Q1: it requires a human in the custody path of a value only the callback ever sees, which means printing a bearer credential to a browser or logging it for somebody to copy. The variant where the CLI prints it does not exist, because the CLI is not where the token arrives.

**A2 — A sixth `shop_credentials` kind with a nullable ciphertext column.** *Rejected*, §2 Q2: it puts a value in the one table built to hold none, and gives two rows with two security models one code path.

**A3 — A `revoked` or `uninstalled_at` column instead of a retirement row.** *Rejected*, and for 050 §2 Q2's reason verbatim: it is an UPDATE the append-only trigger refuses, and a status column is a column two concurrent uninstalls can both read as live.

**A4 — Retire only the newest version on uninstall.** *Rejected*, §2 Q4: an overlap window is legal, and leaving a version this system believes it can use while Shopify has invalidated it is the failure the ending exists to prevent.

**A5 — Poll Shopify for install status instead of receiving a webhook.** *Rejected*: polling means asking with the credential whose validity is the question, it is slower than the thing it is checking, and it turns an uninstall into an outage window whose length is a poll interval.

**A6 — Declare the callback `mutating: false` to keep 048 I6(d) unamended.** *Rejected*, and it is worth recording because it was the cheap option. The route writes two rows; declaring otherwise would put a lie in the route table and therefore in the generated contract, which 042 §3.3 property 3 refuses. **Amending an invariant honestly is cheaper than a false artifact.**

**A7 — A bounce page in `public/` that turns the GET callback into a same-origin POST**, preserving I6(d) exactly. *Rejected on two grounds.* It introduces a novel mechanism whose failure modes (JavaScript disabled, referrer leakage, a cached page) are less understood than the standard OAuth callback it replaces; and the page would carry **shop-facing copy**, which §9 routes to 021 and E10-B02 and which this bead may not settle.

**A8 — One route per webhook topic.** *Rejected*: the authentication, the dedupe and the receipt are identical and only the effect differs, so four routes would be four places to get the verification wrong.

---

## 14. Consequences

**What gets better.** A merchant's authority becomes an issuance with a time, a scope list and an author instead of a variable somebody set. An uninstall becomes a refusal the code enforces on the next read. The system stops being able to ask for a capability it is signed at zero for (019 T19), because it does not hold the scope. And the first inbound surface in the system arrives with its signature verification, its replay defence and its detector in the same commit — which is what 046 §5 A13 asked for in the words *"the receiver ships with its detector or it is a waiver by omission"*.

**What gets worse, stated plainly.** There are now **five more append-only tables** on the declared list, which the five-minute detector must cover and a restore must bring back with their triggers at `'A'`. There is a **second AEAD key ring** and therefore a second variable an operator can lose — with a worse failure than losing the first, because a connector token has no recovery code and the way back is a new install. The read path for a draft gains a join and a decryption for a value that changes rarely, and the per-process cache is deliberately not taken. And the repository now has a **third thing called rotation** beside supersession chains, session rotation and credential versions — four, if the connector's is counted separately, which it should be, because the four are not the same thing.

**The residual, stated because it is not mitigated — and NARROWED at v1.0.1 because v1.0.0 overstated it.**

1. **The process holds the ring and the ciphertext**, so nothing here defends against process compromise.
2. **The backup is NOT defended, and v1.0.0 said it was (S1).** The estate's borg include set carries `/etc` — where the age key lives — and the database dump in the same archive, so the honest scope is **a stolen database dump in isolation**. **E13-D01 `longbox-e5b.13.11`** separates them; until it lands, no artifact may say this defends a backup. The counterweight in §2 Q1 is real and is not a rebuttal. **AMENDED 2026-09-05 (v1.0.6): the separation is REPRODUCED IN TEST at intent-os PR #576, squash SHA E13D01_SQUASH_SHA** — the two borg runners now exclude the age keys and the host SOPS files from the archive that carries the dumps, refuse to run when that exclusion is missing, and are proven by 30 hermetic cases under real borg plus a negative control. **It is NOT applied on the hosts**, which is the only thing that would change what an archive holds; live application is a deploy action and will be recorded in **006** when it is done. **Until then this sentence stands exactly as written**: the honest scope is a stolen database dump in isolation, and no artifact may say otherwise.
3. **A leaked token's life is the merchant's attention span (S2).** §7.3a's call is an attempt to shorten it and not a guarantee, its endpoint is signed OPEN, and predicate (ii) is about the END of a relationship rather than a kill switch held during one.
4. **RING LOSS IS AN ACCEPTED AVAILABILITY RISK, stated rather than discovered (S6).** There is no escrow. If `LONGBOX_CONNECTOR_KEY_V1` is lost, **every shop re-installs** — a connector token has no recovery code and no second factor, and the way back is a new OAuth grant per shop. That is worse than the authenticator ring's failure mode, where 048 §8's recovery codes exist for exactly this. **Whether to escrow it (the estate's borg-key precedent is the model) or to keep the risk accepted is E03-D12 `longbox-e5b.3.22`**, and either answer is better than the current state, which is that nobody had written the question down.
5. **§3.2's destruction primitive is not yet a usable act.** Destroying a key version makes every ciphertext under it permanently unopenable — that is the argument for the column — but nothing re-seals the rows that should survive, so the primitive today is all-or-nothing. **E03-D13 `longbox-e5b.3.23`** builds `connector-reseal`; until it does, "the column gains a destruction primitive" is a property of the design and not a button an operator can press.
6. **Every prior ciphertext stays in the table forever**, which is what an append-only store is.

### 14.1 The two dissents, preserved VERBATIM

Both lenses returned ACCEPT-WITH-CHANGES and the ruling stands. Neither dissent was withdrawn by the changes, and both are reproduced exactly as written — not summarised — because a summarised dissent is a dissent the next reader cannot weigh.

> **`security-auditor`:** *"This record is adopted for the backup and has not shown that the backup is defended. The ring's SOPS source and the age key that opens it are in the same borg include set as the database dump, so until that is separated or reproduced otherwise, the honest scope of this encryption is a stolen database dump in isolation — not a stolen backup, and not the estate's fabric as it stands. And predicate (ii) is the merchant's diligence wearing a security control's clothes."*

> **`rich-hickey-reviewer`:** *"when it is reopened, reopen it for the (i)-true/(ii)-false cell's reason too, not only Lens S's residual-scope caveat — the two are related but not the same gap."*

**Both are acted on and neither is closed.** S1's half is booked to **E13-D01** and the scope sentence is narrowed everywhere it appeared (§2 Q1, §3, §14, `custody.ts`'s header, `connectorResidual`). S2's half is answered as far as an app can answer it (§7.3a) and the plain-words limit is written into §14 item 3. H1's cell is in §2 Q1's table with the third predicate stated. **The instruction in the Hickey dissent binds §16's standing-review rule: this record is reopened for EITHER reason, and the two are not the same trigger.**

---

## 15. Not decided here

1. **The generic signed-webhook scheme** — a Longbox-owned signing secret, its rotation, a replay window and an ordering rule. **E03-B08**, with **E10-B08**. This bead verifies a provider's signature with a provider's secret and takes no position on ours.
2. **The listing-status receiver.** **E10-B08.**
3. **What a data subject or a shop is entitled to on a `shop/redact`, `customers/data_request` or `customers/redact`, and the clock it runs on.** **E03-B09**, with counsel — routed to the **E01-B05 stage-2 batch** with its technical context attached (041 §8.7(d)'s practice). **No statute is cited here.**
4. **The merchant-facing install and consent surface, and its copy.** **E10-B02**, with a candidate C-row in 021 under T26.
5. **The Shopify API-version policy and its bump cadence.** **E10-B02** (014 §8 row E10-B02 names it). This bead pins `SHOPIFY_API_VERSION` and takes no position on when it moves.
6. **When the static admin token is retired.** The contract step needs a 006 row and a shop with no legacy path left; the pilot cutover is **E16-B02**'s.
7. **Whether a connector token's `key_version` should be rotated on a cadence.** This record makes rotation possible and takes no position on frequency; a cadence with no measurement behind it is a number pretending to be a policy (050 §13 item 4's wording, adopted).
8. **Whether the app-initiated revoke endpoint exists at the pinned API version** (§7.3a's OPEN assumption). Closes by ONE call against the isolated dev store, 043 A11's own closing evidence.
9. **Whether the connector ring is escrowed or its loss is an accepted availability risk** — **E03-D12 `longbox-e5b.3.22`** (§14 item 4).
10. **The re-sealing tool that makes §3.2's destruction primitive a usable act** — **E03-D13 `longbox-e5b.3.23`** (§14 item 5).
11. **Separating the ring's key material from the database archive**, without which §2 Q1's scope stays "a database dump in isolation" — **E13-D01 `longbox-e5b.13.11`**, which also discharges 050 §13 item 10.
12. **Whether more than one connector may exist per shop simultaneously.** The schema permits it (`UNIQUE (shop_id, connector, version_no)` is per connector) and nothing tests it, because there is one connector. **E17-B02** when a partner arrives.

---

## 16. Ratification

**RATIFIED at v1.0.5 by the acting head (2026-09-04), under Jeremy's standing delegation, after PR #87 merged as `f4a03b6` with the invariant review at PASS and the gate audit's last cells (B8 re-pin, P7–P9) applied at v1.0.4.** Signed: the ruling set, §3's rule, §7.3a's revoke shape, and the contract table. Not signed away: §14.1's two dissents remain reopening triggers (the transitive backup chain → E13-D01; the (i)-true/(ii)-false cell → E17's first connector). Prior status text follows for the record: **Both lenses were DISPATCHED**: `security-auditor` ACCEPT-WITH-CHANGES (S1–S6) and `rich-hickey-reviewer` ACCEPT-WITH-CHANGES (H1, H3, H4, H5). **The acting head's ruling — the column with its own ring — STANDS**, folded in at v1.0.1, with the gate audit's statement-of-fact repairs at v1.0.2 the invariant re-verification's one note at v1.0.3, and the gate re-audit's unreachable-commit re-pin at v1.0.4. **§2's deliberation text is the session's own composition; the lens VERDICTS and DISSENTS quoted in §14.1 are dispatched and are the reopening triggers.** Awaiting the `longbox-gate-auditor` verdict on the record half and the `longbox-invariant-reviewer` verdict on the code half, then the acting head's signature under Jeremy's standing delegation. **Both dissents are preserved verbatim in §14.1** and neither is closed by the changes that answer them.

**E03-B10's independent security review is required regardless**, and closing G2 does not follow from this signature.

**Standing review.** This record is redrawn on the same trigger-based rule 046 §8.1 states: **when a connector is added or removed, when the scope list changes, when a new webhook topic gains an effect, when a credential is proposed for the column that §3's predicates were written to test, when E13-D01 changes what the backup archive contains, or when a credential lands in §2 Q1's (i)-true/(ii)-false cell.** Not on a calendar.

**Two triggers, not one, and the Hickey dissent asks for that in as many words.** The last two are related and are NOT the same gap: the first is about how much this encryption defends, the second about which credentials the rule admits. A reopening for either must read §14.1's dissents before it reads §2's rulings.
