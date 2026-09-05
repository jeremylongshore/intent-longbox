# Decision Record — The Loss-Bearing Secrets: Escrow Them, or Record Ring Loss as an Accepted Availability Risk

**Version:** 1.0.0
**Status:** PROPOSED — the two lens positions in §3 are **DRAFTED IN-BAND BY THE AUTHOR AND LABELLED AS SUCH**; the parent session convenes `security-auditor` and `joe-armstrong-reviewer` afterwards, and `longbox-gate-auditor` before the bead closes. Not citable as settled until §10 is signed.
**Bead:** E03-D12 `longbox-e5b.3.22` — *Escrow the connector key ring or record ring loss as an accepted availability risk* (epic LBOX-E03 `longbox-e5b.3`, gate G2)
**Filed:** 2026-09-04 · **Author:** `longbox-security-tenancy-builder` · **Owner:** parent session (acting head of board)
**Sensitivity:** Restricted internal (014 §10). It names every loss-bearing secret this system holds, the variables that carry them, the hosts they are rendered on, and the recipients an escrow would be encrypted to. **It contains no secret value of any kind and never will**, and it reproduces no age recipient string — recipients are named by the file that already carries them, per 016 §0's point-at-never-copy rule.
**Scope of this commit:** **DOCS ONLY.** No `src/`, `migrations/`, `scripts/`, `tests/*.ts`, `public/` or `.github/` change lands with it. §8's contracts are obligations on named beads, and every one of them is untested today.
**Governed by:** 018 (evidence), 019 T22/T35, 021 B16, 022 P3/P7/P8, 041 §8.3, 042 §8.4, 046 §8.1, 048, 050, 053 (PROPOSED, PR #87).

---

## Change log

**Version convention** (006 `:6`): a **minor** bump means the content of a decision changed; a **patch** means a statement of fact was repaired with no decision changing.

| Version | Date | What changed | Authority |
| --- | --- | --- | --- |
| 1.0.0 | 2026-09-04 | Initial record. One ruling with a sequence: **escrow is adopted (Option A) for all THREE loss-bearing secrets rather than for the two rings the bead names**, because they share one custody path and therefore one loss event; **the buzz precedent is adapted and not copied**, because its recipient rule inverts for an application that runs on the shared VPS; and **Option B's posture is the honest INTERIM** until the escrow exists, recorded as an accepted availability risk with E01-B05 informed. Eight contracts (§8), seven open items (§9). Nothing is built. | §3's in-band lenses → acting head, §10 |

---

## 0. Evidence posture

018 governs. Every claim about the tree in §2 is **REPRODUCED** — a command and its output, at a named commit — and every claim about behaviour is marked TESTED or ASSERTED. **Every cadence figure in this record is PROVISIONAL in 042 §8.4's class and is explicitly NON-EVIDENTIARY**: it supports no claim of fact, is never quoted as recoverability, availability, durability or a security property at any class (021 B16), and moves when somebody measures something rather than when somebody prefers a different number. **No statute is cited anywhere in this record**, deliberately — the question of what any external obligation requires of key custody is routed to the E01-B05 counsel batch in §9, not answered here.

**Two commits are read, and they are different trees.** `main` at **`dca5da0`** is the tree this record lands on. `feat/e03-b06-connector-oauth` at **`16f17ef`** is PR #87, which is where the connector ring and doc 053 live and which has not merged. **053 is cited throughout as "053 (PROPOSED, PR #87)"** and nothing here treats it as settled; if PR #87 changes §3.2 or §14, this record's E5 row and §8 I2 are the two places to re-read.

**Doc number.** `000-docs/` on `main` at `dca5da0` ends at **052**. **053** is claimed on `feat/e03-b06-connector-oauth`; **054** is claimed by **E03-B03** on its own unmerged branch. This record takes **055** and says which tree the gap was read against, because 052 §0's lesson stands: a register whose numbers are allocated on branches has to name the tree or the next reader files a collision.

---

## 1. The question, stated so it cannot be answered by half

The bead asks whether to escrow **the connector key ring**. That question cannot be answered honestly at the size it is asked, for a reason §2 reproduces rather than asserts: **this system holds three secrets whose loss is unrecoverable from inside the system, they are destined for one SOPS file rendered onto one host, and the worst of the three is not a ring.** Answering for one and leaving the others to a later bead would repeat the exact failure E5 records — an obligation handed to a bead that closed without discharging it, discovered a week later by somebody reading an `.env.example` comment.

So the question this record answers is: **for each secret whose loss ends a capability the system cannot rebuild from its own database, is there an escrowed copy, where does it live, who can open it, and how is that proven?**

---

## 2. What exists today, REPRODUCED

| # | Finding | Command and output |
| --- | --- | --- |
| **E1** | **There are THREE loss-bearing secrets, not two.** `LONGBOX_PIN_PEPPER` (048 §9.2), `LONGBOX_AUTHENTICATOR_KEY_V<n>` (048 §4.2) and `LONGBOX_CONNECTOR_KEY_V<n>` (053 §3, PROPOSED). The first two are on `main`; the third is on PR #87. | `grep -n 'LONGBOX_PIN_PEPPER\|LONGBOX_AUTHENTICATOR_KEY' .env.example` → `230,243,245,262,268,274` at `dca5da0`; `git show 16f17ef:.env.example \| grep -n CONNECTOR_KEY` → `153,154` |
| **E2** | **Two of the three already refuse to boot when absent, in one place.** `loadConfig` calls `requirePinPepper()` and `requireAuthenticatorKey()` unconditionally. | `src/config.ts:243`, `src/config.ts:247` at `dca5da0` |
| **E3** | **The SOPS file that 050 §3 calls "the only copy of record" DOES NOT EXIST in this repository.** There is no `.sops.yaml`, no `.env.sops`, no encrypted secrets file of any kind. 050 §3's custody ruling is a **rule that has not been deployed**, and an escrow of a file that does not exist is a forward obligation rather than a copy. | `git ls-files \| grep -c -i sops` → `0` at `dca5da0` |
| **E4** | **A recovery code is hashed with the PEPPER.** So 048 §8's recovery codes — the documented way back in after an authenticator-ring loss — are not independent of the pepper: they die with it. | `src/services/auth/authenticator.ts:298` → `await hashRecoveryCode(code, args.pepper),` |
| **E5** | **The pepper's backup obligation is ORPHANED.** 048 §12.4 row 3 hands *"the PIN/password pepper's custody, backup and rotation"* to **E03-D06 → E03-B05**. E03-B05's record is **050**, which is RATIFIED and closed, and **050 does not contain the word "pepper" once**. `.env.example:241-242` still points a reader at that discharged hand-off. | `grep -c -i pepper 000-docs/050-…md` → `0`; `.env.example:241-242` → *"That makes it a backup and custody obligation (048 §12.4 row 3, E03-B05)"* |
| **E6** | **The break-glass path is under the ring it is supposed to rescue.** 048 §8.2's residual path is a `support_break_glass` membership; 048 §4.2 requires TOTP for `owner`, `manager` **and** `support_break_glass`; every TOTP secret in the system is a row in one `user_authenticator` table sealed under one ring, regardless of role. A total ring loss therefore disables the operator who is supposed to perform the recovery. | 048 §4.2 (*"the required second factor for `owner`, `manager` and `support_break_glass`"*), 048 §8.2, `src/services/auth/aead.ts:104` |
| **E7** | **The estate's escrow precedent exists, is proven, and carries an explicit recipient RULE.** The buzz borg repokey and passphrase are escrowed to a SOPS file in the ops tree, *"encrypted to the estate key + shared-VPS host key ONLY — NOT the dedicated buzz host key, since escrow readable only from the host it insures is no escrow"*, with a restore drill that destroys the key in a repo COPY and recovers from escrow alone. | `intent-os ops/backup/offsite-backup.config.json:105-107,199`; `intent-os ops/buzz/scripts/escrow-restore-drill.sh` |
| **E8** | **That escrow file has exactly two recipients, and one of them is the `intentsolutions` host key.** Which is safe for buzz — buzz runs on a different host — and is **exactly wrong for Longbox**, which runs on `intentsolutions`. | `grep -c 'recipient:' intent-os/ops/buzz/secrets/buzz.borg-escrow.sops.yaml` → `2`; the two recipient prefixes are `age1me3vkell…` (the estate key) and `age1csyjrdez…` (the VPS host key named in the estate host-secret table) |
| **E9** | **The VPS archive already carries the age key and the database dump together**, so anything encrypted to the VPS host key and anything sealed by these rings travel in one archive to an Object-Locked offsite copy. This is E13-D01's finding, filed by the same cannon that filed this bead, and it is **the constraint that shapes §5** rather than background. | bead `longbox-e5b.13.11`; `intent-os ops/backup/IMPLEMENTATION-MAP.md:23-27` |
| **E10** | **The estate key's own custody has no immutable offsite copy.** The B2 leg covers the VPS repo; *"the dev box's own data — beads/Dolt, crypto custody, host config — has no immutable copy anywhere"*. The estate age private key lives on that box. | `intent-os ops/backup/README.md:24-25`, `:93` |
| **E11** | **019 T22 does not reach this class of loss.** T22 is *"RPO / RTO ≤24 h / ≤4 h"* with a v1.3.0 scope note stating the figures *"describe DATABASE recovery"*. A restore that returns every row and no key returns a database nobody can read a credential out of, and T22 would still pass. | `019:109` |

**What E4, E5 and E6 mean together, and it is the finding that decides the record.** The documented fallbacks compose badly. A ring loss is survivable *because recovery codes exist*; recovery codes are peppered, so a pepper loss takes them; a pepper loss is survivable *because an owner resets PINs in a privileged session*; a privileged session needs a second factor that is under the ring; and the Longbox-operated break-glass that backstops all of it is held by a role whose own second factor is under the same ring. **Each fallback is real in isolation and every one of them is inside the blast radius of a single lost file** — because all three secrets are destined for one SOPS file rendered onto one host through one `ExecStartPre`. The system's recovery story is written as though these were three independent failures, and the custody design makes them one.

---

## 3. The two lenses, DRAFTED IN-BAND

> ⚠ **HOW THESE POSITIONS WERE PRODUCED, STATED PLAINLY.** §3.1 and §3.2 are **written by the author of this record**, in the manner of the two lenses named, and are **NOT** returns from the `security-auditor` and `joe-armstrong-reviewer` agents. This is 050 §14's in-band practice and 053 §2's header, adopted verbatim and for the same reason: a record that implies a review it did not receive is worse than one that had none. **The parent session convenes both agents on this record before §10 is signed**, and their returns amend §4 or overturn it. **E03-B10's independent security review is required regardless of what either lens says** — a record cannot audit itself.

### 3.1 Lens S — the application-security position

*"Start with what an escrow IS, because the word does most of the damage. An escrow is a second copy of a secret, created deliberately, kept somewhere the first copy's loss does not reach. Every argument for it is an availability argument and every argument against it is a confidentiality argument, and pretending otherwise is how this decision gets made on vibes.*

*So the confidentiality cost, stated first and not buried: **a second copy is a second thing to steal.** Today the pepper exists in one SOPS file and one tmpfs render. Escrowed, it exists in a third place, with a third recipient set, in a repository with its own history and its own backups, and every future revision of that file still holds it — 050 §5(b)'s residual, arriving a second time for a value 050 never named. That is not a reason to refuse; it is the price, and it has to be in the record beside the benefit.*

*Now the benefit, and it is not the one the bead names. The bead frames ring loss as an **availability** risk — every shop re-installs, every owner re-enrols. For the connector ring that framing is exactly right and the cost is bounded: a merchant clicks install, Longbox holds no draft hostage, nothing in the catalog is lost. **For the pepper it is wrong.** A pepper loss does not degrade an operator's access, it ends it, simultaneously for every operator, every recovery code, and — once E03-D11 lands `user_credential` — every password. There is no in-band path back in, because every path back in is authenticated by something under the value that was lost. That is not availability. That is a shop's staff standing at a counter phone that will never accept a PIN again, and the only remedy is Longbox rebuilding their identity substrate by hand from outside the system.*

*And the reason I will not accept `.env.example`'s comfort sentence — *"the way back in is 048 §8's recovery codes"* — is E4. **The codes are peppered.** That sentence is true for a ring-only loss and false for the loss anyone actually has, which is *the SOPS file went with the host*. The comment is not wrong about the mechanism; it is wrong about the correlation, and a recovery story that assumes independent failures of three values that live in one file is not a recovery story.*

*One more thing, and it is the reason the buzz precedent cannot be copied. E8: buzz's escrow is encrypted to the shared-VPS host key, and that is sound **because buzz does not run there**. Longbox does. Encrypting a Longbox escrow to `age1csyjrdez…` puts the escrow's plaintext one `sudo cat /etc/intentsolutions/age.key` away from the process it insures — and E9 says that key and the ciphertext it opens already ride one borg archive to an Object-Locked bucket. **An escrow readable from the host it insures is no escrow** is the precedent's own sentence, and applying it honestly here means excluding the recipient buzz included. If we copy the file shape and keep the recipient list, we will have built a second copy with all of the confidentiality cost and none of the availability benefit, which is the worst of the four outcomes.*

*My position: **escrow, all three, estate recipient set that excludes the deploy host, and a drill that proves an actual open rather than the existence of a file.** And write down that we are buying availability with confidentiality, at a price, deliberately."*

### 3.2 Lens A — the availability-and-failure position

*"I want to argue about what happens at 09:00 on a Tuesday, because that is when this gets tested and nobody will be reading a decision record.*

*First, the shape of the failure matters more than its probability, and we keep discussing probability. A lost key is not a degraded system. It is a system that comes up **healthy** — the process starts, the port answers, the database restores inside T22 — and refuses every credential it holds. There is no partial mode. There is no queue that drains later. The five-minute detector goes green. **The monitoring cannot see it**, because nothing in the heartbeat set opens a sealed row, and E11 says the one threshold that sounds like it covers this explicitly does not. A failure the instruments report as health is the failure class I care about most, and this one is in it.*

*Second — and this is where I part company with the bead's framing — **"every shop re-installs" is not a Longbox act, and that is what makes it expensive rather than what makes it cheap.** Longbox cannot perform it, cannot schedule it, cannot batch it and cannot verify it happened. It is N merchant conversations, each of which is Longbox telling a shop that Longbox lost something. In a pilot of one shop that is a phone call. At the fleet size 014 plans for it is a company-shaped event, and it arrives all at once because the cause is one file.*

*Third, on Option B, because I do not want it dismissed: **accepting a risk is a legitimate engineering answer and it is sometimes the right one.** The condition is that the acceptance is (a) explicit, (b) sized, (c) held by somebody who can bear it, and (d) told to the people it lands on. For the connector ring, B genuinely passes all four — the failure is bounded, the remedy exists, and the pilot shop can be told in one sentence in the charter. **For the pepper, B fails (b) and (d): it is not sized, because nobody has written down what "rebuild every operator identity by hand" costs, and it cannot be told honestly to a shop in a charter sentence, because the honest sentence is "if we lose one file, your staff cannot sign in and we cannot let them back in."** A risk you cannot describe to the party bearing it is not accepted; it is concealed.*

*Fourth, the thing I insist on regardless of which option wins: **an escrow that has never been opened is a belief, not a backup.** The buzz drill (E7) is the right shape precisely because it destroys the key in a copy first, and its own header records the lesson that a careless drill re-pinned host state and would have silently broken the nightly timer. Copy the drill's discipline, not just its existence. And the acceptance test is not "the file decrypts" — it is **"a real sealed row opened and a real PIN verified using only escrow-derived material"**. Anything less proves we can read a file.*

*Fifth: E10 says the estate key's own box has no immutable offsite copy. So a single-recipient escrow moves the single point of failure rather than removing it. I will take that trade — it is strictly better than today — but it is not a resolved custody story and the record should not call it one.*

*My position: **escrow the pepper and the authenticator ring on the strength of the failure SHAPE, not its probability; the connector ring is a genuine Option-B candidate and I would still escrow it, because it rides in the same file and a per-secret decision buys nothing operationally.** And the drill is not optional — an escrow with no drill is one more file we will discover is empty during the incident."*

---

## 4. Ruling — the acting head's, under Jeremy's standing delegation

> **RULING 1 — OPTION A, ESCROW, AND IT COVERS ALL THREE SECRETS AND NOT THE TWO RINGS THE BEAD NAMES.** The bead asks about `LONGBOX_CONNECTOR_KEY_V<n>` and `LONGBOX_AUTHENTICATOR_KEY_V<n>` and invites deciding both rings in one record. **The record decides three**, adding `LONGBOX_PIN_PEPPER`, on E4/E5/E6's ground: the pepper's loss is the worst of the three, its backup obligation is already orphaned once, and it is the value that makes the other two survivable. Deciding two rings and leaving the pepper to a bead would be the same hand-off that produced E5.
>
> **RULING 2 — THE UNIT OF ESCROW IS THE CUSTODY PATH, NOT THE SECRET.** The three values reach the process through one SOPS file, one `ExecStartPre`, one tmpfs render, on one host. Their loss is therefore **one event with three consequences**, not three events, and a per-secret decision would be a decision about a correlation that does not exist. One escrow file, one recipient set, one drill.
>
> **RULING 3 — THE BUZZ PRECEDENT IS ADAPTED, NOT COPIED, AND THE ADAPTATION IS THE RECIPIENT SET.** The mechanism transfers whole: a SOPS-encrypted file under the estate ops tree, committed to git, holding the escrowed values, with a restore drill that destroys the primary in a copy and recovers from escrow alone. **The recipient list inverts.** Buzz excludes the buzz host key and includes the `intentsolutions` host key; **Longbox must exclude the `intentsolutions` host key**, because Longbox runs there (E8) and because that host's age key and this system's ciphertext already share one archive bound for an Object-Locked bucket (E9). The precedent's own sentence is the rule: *escrow readable only from the host it insures is no escrow.*
>
> **RULING 4 — THE ESCROW DOES NOT EXIST YET, AND OPTION B IS THE HONEST INTERIM POSTURE UNTIL IT DOES.** E3: there is no SOPS file in this repository to escrow FROM, and E9's separation is E13-D01's unfinished work. Until both land, **the deployed posture is Option B and this record says so rather than describing a control nobody built**: ring or pepper loss means every shop re-installs, every owner re-enrols, and every operator PIN is re-set — an accepted availability risk, held by the acting head, with **E01-B05 informed** per RULING 6. A decision record that described §5 in the present tense would be asserting a control that does not exist, which is the defect 013 catalogues and 052 §0 refuses.
>
> **RULING 5 — THE ACCEPTANCE TEST IS AN OPEN, NEVER A DECRYPT.** An escrow is proven when escrow-derived material alone opens a real sealed `user_authenticator` row and verifies a real `operator_pin`, in an isolated environment, against a copy. "The file decrypts" is not the test, for Lens A's reason: it proves we can read a file.
>
> **RULING 6 — THE PILOT IS TOLD, AND TOLD THE TRUE SENTENCE.** Under 022 P3 and P8 the shop is told what a Longbox failure costs them in their own terms. The charter fill-in item handed to **E01-B05** is not *"we escrow our keys"* — during the interim that is false — it is: **if Longbox loses its key material, the shop's staff sign-ins stop working and restoring them requires the shop to re-set every PIN and the owner to re-enrol their second factor, and reconnecting the store requires the owner to re-install the app.** No artifact may state it more softly, and **no registered claim, C-row or partner-facing sentence may describe key custody, escrow or recoverability as a property of this system at any class** until §5 exists and RULING 5's drill has passed (021 B16; the T26 pre-send is where this binds).
>
> **RULING 7 — THE THREE VALUES MUST DIFFER, AND NOTHING CHECKS THAT TODAY.** 053's `.env.example` argues at length that the connector ring is *"deliberately a different variable"* from the authenticator ring, because one key for two subsystems makes one compromise two and makes the one destruction Longbox can perform take an owner's second factor with it. **That argument is about VALUES and the mechanism is a VARIABLE**, so an operator who pastes the same 32 bytes into both satisfies every check in the tree and defeats the reasoning entirely. §8 I7 closes it.

**What is NOT ruled, deliberately.** Nothing here says a cadence is a control, nothing here says an escrow makes a loss unlikely, and nothing here converts an availability risk into a durability claim. The escrow changes **who can restore**, not **how often the file survives**.

---

## 5. Decision A, as built — the escrow's shape

**5.1 The artifact.** One SOPS-encrypted file in the estate ops tree, committed to git, in the buzz file's own idiom and beside it in structure: a `secrets/` file under this application's ops directory, holding the escrowed values keyed by their environment-variable NAMES so an operator restoring under pressure does not have to guess which blob is which. **It is not in this repository**, for two reasons that are one reason: this repository's SOPS file (once E3 is closed) is the OPERATIONAL source, and an escrow committed next to the thing it insures is a copy with the same custody path, the same clone, the same backup and the same loss event.

**5.2 The recipients, and the exclusion that is the whole point.**

| Recipient | In the escrow? | Why |
| --- | --- | --- |
| The estate age recipient — the key held on the dev box at `~/.config/sops/age/keys.txt`, the one every `.sops.yaml` under `~/000-projects/` already carries | **YES** | It is the only recipient today whose holder is a person rather than a host, and it is off the deploy host |
| The `intentsolutions` VPS host key (the recipient named in the estate host-secret table) | **NO — EXCLUDED, and this is the adaptation** | Longbox runs on that host. Including it makes the escrow readable from the machine whose loss it insures (E8), and puts the escrow's opener in the same borg archive as the ciphertext it opens (E9) |
| A second, non-VPS recipient — the home server is the obvious candidate | **OWED, NOT ASSERTED** | E10: a single-recipient escrow whose one recipient sits on a box with no immutable offsite copy has moved the single point of failure rather than removed it. **Whether that key exists and who holds it is NOT reproduced here and is therefore not claimed** — §9 item 1 |

**5.3 Who holds the recipients.** The estate recipient's private half is held by Jeremy on the dev box. **That is a one-person custody story and this record calls it that** rather than describing it as an organizational control. The second recipient exists precisely to make it not one person, and until §9 item 1 closes, it is one person.

**5.4 The drill, and its cadence, which is PROVISIONAL and non-evidentiary.**

The drill follows the buzz script's discipline, including the lesson its own header records — **redirect every piece of tool state into a throwaway directory, because a drill that re-pins host state silently breaks the live path it was meant to protect**. Shape:

1. Take a COPY of the database (never the live one) and a throwaway environment.
2. Render the escrow to tmpfs, from the escrow file alone, using no material reachable from the deploy host.
3. **Open a real row**: decrypt one `user_authenticator` ciphertext under the escrowed ring and verify one `operator_pin` under the escrowed pepper.
4. Assert the drill can see no live environment file and writes nothing outside its temp directory.
5. Record a PASS/FAIL and the commit, with **no value and no digest of a value** in the log.

> **The cadence figures are PROVISIONAL FLOORS in 042 §8.4's class and are declared NON-EVIDENTIARY**: they are scheduling defaults chosen for review, not measurements, and they support no claim about recoverability at any class (021 B16). **Once before G3**, and thereafter on **046 §8.1's trigger rule** — when a loss-bearing secret is added or removed, when the recipient set changes, when the deploy host changes, or when the rendering mechanism changes — with a **PROVISIONAL 90-day** floor so a trigger-only rule cannot silently mean never. Neither figure may be quoted as a recovery-time property, and neither belongs in T22, which is about database recovery (E11).

---

## 6. Decision B, as it would have been recorded — and why it is the interim rather than the answer

B is not dismissed, because B is what is true today (RULING 4) and because Lens A's four conditions are the right test. Applied per secret:

| Secret | Failure if lost | Remedy | Can B's four conditions be met? |
| --- | --- | --- | --- |
| `LONGBOX_CONNECTOR_KEY_V<n>` | Every shop's connector token is unopenable; drafting refuses (053 §4's zero-live-versions rule) | Every shop re-installs the app — a merchant act Longbox cannot perform | **YES.** Explicit, sized (N install conversations), bearable, and statable to a shop in one sentence. **A genuine Option-B candidate** — and it is escrowed anyway, under RULING 2, because it rides in the same file and a separate posture for it buys nothing |
| `LONGBOX_AUTHENTICATOR_KEY_V<n>` | Every second factor is unopenable for `owner`, `manager` and `support_break_glass` | Recovery codes — **if and only if the pepper survives** (E4) | **CONDITIONALLY.** True for a ring-only loss, false for the loss that actually happens, which is the file |
| `LONGBOX_PIN_PEPPER` | Every operator PIN, every recovery code and (once E03-D11 lands) every password is unverifiable, simultaneously | None from inside the system. Every in-band path is authenticated by something under the lost value (E4, E6) | **NO.** Fails "sized" — nobody has costed a hand rebuild of a shop's identity substrate — and fails "told", because the honest sentence to a shop is one no charter should have to carry as a permanent posture |

**The residual under B, stated because B is the live posture:** today, a loss of the deployment's secret material means the shop's staff cannot sign in, the owner cannot pass a second factor, no recovery code redeems, the Longbox break-glass operator's own factor is unopenable (E6), and the connector is dead — and the database restores perfectly throughout, inside T22, with the heartbeat green (E11). **That is the accepted risk. It is held by the acting head, it is recorded here, and E01-B05 carries it to the shop in RULING 6's words.**

**The residual under A, stated because escrow is not free:** a second copy of three secrets exists in a second repository with its own history and its own backups; every future revision of that file still holds the values (050 §5(b)'s residual, reaching a value 050 never named); the recipient set is a one-person custody story until §9 item 1 closes; and **the escrow defends a lost file, not a compromised process** — a process that holds the ring holds it whether or not a copy exists elsewhere. 053 §14's sentence transfers unchanged: this defends a stolen or lost backup and does not defend a compromised process.

---

## 7. What this record does NOT change

It changes no ratified record, amends no invariant, moves no threshold, files no migration, adds no route, and closes no 046 row. **048's §12.4 row 3 is not rewritten** — the orphaned hand-off is recorded in E5 and re-homed by §9 item 3 rather than edited into a different bead's name, because 016's own rule is that rows are not edited and the correction is the record. **053 is not amended**; if PR #87 lands with §14 unchanged, the sentence *"the way back is a new install"* is correct and this record supplies the escrow it presumes. **019 T22 is not extended here** — §8 I6 states the contract and E13-B07 owns the threshold's instrument (019 §9's change control is E00-B03's, not this record's).

---

## 8. Contracts the code half must satisfy

Every row is an obligation on a named bead. **None is tested today**, and this record ships no test.

| # | Invariant | Test it will get | Owner |
| --- | --- | --- | --- |
| **I1** | **The loss-bearing secrets are ONE exported list, not three scattered `require*` calls**, and every member is checked at boot. Adding a fourth secret without adding it to the list fails the build | `tests/config-fail-closed.test.ts` — a case asserting the list is exactly the set of variables whose absence throws from `loadConfig`, walked from the list rather than named | **E13-B02** |
| **I2** | **Every member of that list has an escrow-inventory row**, in a committed artifact naming the secret and its escrow location as a `sops://` reference **with no value**, and a member without a row fails the build. This is the mechanism that makes E5 unrepeatable | `tests/contract/secret-surfaces.test.ts` — a new case joining the boot-required list to the inventory and asserting the symmetric difference is empty | **E13-D01**, with **E13-B02** |
| **I3** | **No escrow artifact, inventory, drill log or receipt contains a secret value, a prefix, a last-four or any digest offered as a hint** (053 §3.3's rule, extended from tokens to escrow artifacts) | `pnpm exec audit-harness escape-scan` over the inventory path, plus a `tests/contract/secret-surfaces.test.ts` case asserting the inventory's values are `sops://` references and nothing else | **E13-D01** |
| **I4** | **The restore drill proves an OPEN, not a decrypt**: escrow-derived material alone decrypts one real `user_authenticator` row and verifies one real `operator_pin`, against a database COPY | The drill's own acceptance run, recorded as evidence with its commit; integration-lane fixture for the open path under `tests/integration/` | **E13-B07**, with **E03-B05**'s successor |
| **I5** | **The drill writes nothing outside its temp directory and cannot reach the live rendered environment file** — the buzz script's host-state lesson, generalised | An assertion inside the drill that the live `EnvironmentFile` path is unreadable in its context, and that its temp directory is the only write target | **E13-B07** |
| **I6** | **The restore drill asserts key availability, not only database restore.** A drill that returns every row and no key must FAIL, and must not be reportable against T22 | The drill's acceptance criteria; a 019 §9.3 amendment row is **proposed to E00-B03 and deliberately not written here** (048/041/043's precedent: supply the text, refuse to write it) | **E13-B07** → **E00-B03** |
| **I7** | **The three loss-bearing values are distinct**, and a deployment that sets two of them to the same value refuses to boot | `tests/config-fail-closed.test.ts` — a case setting the connector ring and the authenticator ring to one value and asserting `loadConfig` throws; and the negative case asserting distinct values boot | **E13-B02**, with **E03-D13** |
| **I8** | **No registered claim, C-row or partner-facing sentence describes key custody, escrow or recoverability as a property of this system** until §5 exists and I4 has passed | The **T26 pre-send check** against 021; a `tests/contract/server-emits-no-operator-copy.test.ts` case is NOT the instrument here — this one is a registry rule, and it is stated as such rather than dressed as a unit test | **021** at T26 |

---

## 9. Not decided here

1. **The identity and holder of the escrow's SECOND recipient.** §5.2 rules that the `intentsolutions` host key is excluded and that a single-recipient escrow is insufficient (E10); it does **not** assert that a suitable second key exists, because that was not reproduced. **E13-D01**, with the recipient enumerated against the estate's own key inventory rather than assumed.
2. **Where the deployment's OPERATIONAL SOPS file lives** — this repository, or the ops tree. 050 §3 says *"the SOPS file in the repository"* without saying which repository, and E3 says neither exists. The escrow's location depends on that answer only in that the two must not be the same file. **E13-D01**, with the unit file.
3. **Re-homing 048 §12.4 row 3's orphaned pepper obligation.** E5 records that it was handed to a bead that closed without discharging it. This record supplies the decision; the row's re-homing is a **bd note on E03-D11**, not an edit to 048.
4. **Whether the pepper rotates on a cadence, and how.** 048 §9.2 specifies `pepper_version` and re-peppering at next successful verification; nobody has built it and no cadence is set. **E03-D11.** A cadence with no measurement behind it is a number pretending to be a policy (050 §13 item 4's wording, adopted a second time).
5. **The reseal job that makes ring retirement real for either ring.** **E03-D13** `longbox-e5b.3.23`, which already owns it and which §4 RULING 7 touches only at the value-distinctness edge.
6. **Whether `user_credential`'s password hash uses the same pepper value**, which decides whether a pepper loss also ends the first factor. 048 §9.2 says it does; the table does not exist. **E03-D11.**
7. **Whether any external obligation constrains key custody or escrow for this system.** **No statute is cited in this record.** Routed to the **E01-B05 stage-2 counsel batch** with the technical context attached (041 §8.7(d)'s practice), alongside 053 §15 item 3.
8. **Whether escrow should later be replaced by a hosted key service.** E03-B05 is closed and 050 rejected the column, not the question. A move to a managed key custodian is a new decision with its own record and its own bead, and the condition under which it should be reopened is stated so it can be tested rather than re-argued: **if the second recipient in §5.2 cannot be resolved to a holder who is not Jeremy, the one-person custody story is the reason to reopen it.**

---

## 10. Ratification

**PROPOSED at v1.0.0.** §3's two lens positions are **drafted in-band by the author and labelled as such in §3's own header**; the parent session convenes `security-auditor` and `joe-armstrong-reviewer` on this record, then `longbox-gate-auditor` on the record half, and only then does the acting head sign under Jeremy's standing delegation. **E03-B10's independent security review is required regardless, and closing G2 does not follow from this signature.**

**Nothing in this record is built.** No escrow file exists, no drill has run, no invariant in §8 is tested, and the deployed posture is Option B with the residual §6 states. **The signature would authenticate a decision and a sequence, not a control.**

**Standing review.** Redrawn on 046 §8.1's trigger rule: when a loss-bearing secret is added or removed, when the recipient set changes, when the deploy host changes, when the rendering mechanism changes, or when a fallback this record relies on (recovery codes, in-person PIN reset, break-glass) is altered by another record. **Not on a calendar** — and the 90-day figure in §5.4 is a drill floor, not a review cadence.
