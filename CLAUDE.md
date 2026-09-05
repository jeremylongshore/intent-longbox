# CLAUDE.md: intent-longbox

## What this is

Photo-to-listing pipeline for comic shops: a shop employee photographs a back-issue comic on a phone browser, the system identifies title/issue/variant (barcode first, then LLM re-rank with an evidence gate), the employee confirms, condition (grade range + defects) and pricing (dual sources: PriceCharting historical FMV + eBay live asks, filtered through shop policy) are captured, and a DRAFT product lands in Shopify for owner review. Nothing publishes without a human.

- **Repo:** `jeremylongshore/intent-longbox` (PRIVATE, deliberately; transferred from the old org. In-repo prose and URLs were repaired under E02-B01 — see 000-docs/027 §8. What still carries the old org: four bead records in `.beads/issues.jsonl` (seven occurrences), GitHub issue bodies #3/#6, the 016/021 register rows that deliberately record the transfer as history, and lines in 006/008/013/014 queued in 027 §7. Remaining cleanup is blueprint bead E15-B01)
- **Stack:** TypeScript/Node + Postgres, deployed on the `intentsolutions` VPS behind Caddy per intent-os ops deploy contracts
- **First shop:** Gotham City Limit (Jacksonville), the first shop to roll out

## Locked decisions (do not relitigate without Jeremy)

1. **Private repo.** Stays private.
2. **BYOK model policy, Claude default.** Providers are per-shop config; Anthropic is the default and reference provider; OpenAI-compatible adapters supported; `LLM_BASE_URL`/`LLM_API_KEY` gateway override supported. Raw keys never in the database (`shop_credentials` holds key refs).
3. **Channels: Shopify v0, Whatnot roadmap.** Admin GraphQL `productSet` with `status: DRAFT`, per-store Dev Dashboard app for the pilot, unlisted public app as end-state. Whatnot = bulk-CSV export in Phase 4 (Seller API is closed preview; apply early). Whop is irrelevant.
4. **The Hickey data model is non-negotiable (P0).** `scan_session` is an identity; `candidate_set` / `llm_rerank` / `human_confirmation` / `condition_assessment` / `pricing_snapshot` / `shopify_draft` are immutable timestamped records appended to it, never edited in place. Config split: `shop` / `shop_credentials` / `shop_pricing_policy`. Corpus = immutable versioned snapshots. `shop_id` FK on every shop-scoped table even though v0 is single-tenant.
5. **Condition is NEVER numeric.** Grade range + defect callouts, in schema, API, prompts, and UI copy. No numeric grade anywhere.
6. **No similarity index before the pilot proves need.** v0 ships Claude vision + barcode + human pick. If the pilot shows real misses: buy (e.g. Ximilar) before build; a self-built cover index carries unresolved fair-use risk (top risk #1).
7. **Evidence-contradiction gate.** LLM re-rank must emit structured evidence cross-validated against candidate metadata; contradiction forces human review. Three confidence bands (high one-tap / medium forced pick / low manual search) with telemetry. Per-call cost logging from day one.

## Doc map

All docs in `000-docs/` per /doc-filing; index at `000-docs/000-INDEX.md`.

| Doc          | What                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 002-PP-PRD   | Requirements R1 to R20, MoSCoW-tagged                                                                                                                                                                                                                                                                                                                                                                           |
| 003-AT-ARCH  | Architecture: pipeline, Hickey model, deterministic/probabilistic boundary, retrieval gate                                                                                                                                                                                                                                                                                                                      |
| 004-PP-UJRN  | Employee, owner, and correction journeys in retailer language                                                                                                                                                                                                                                                                                                                                                   |
| 005-AT-SPEC  | v0 spec: schema sketch, API surface, adapter shape, Shopify wiring, eval/cost hooks                                                                                                                                                                                                                                                                                                                             |
| 006-OD-STAT  | Live status: phase state, blockers, decision log (update this as things move)                                                                                                                                                                                                                                                                                                                                   |
| 022 / 025    | Workplace principles P1–P9 (RATIFIED) — bind E05/E08/E11 design                                                                                                                                                                                                                                                                                                      |
| 023-OD-STND  | Beads config, routing and evidence-closure standard; the 8 formulas in `.beads/formulas/`                                                                                                                                                                                                                                                                                                                       |
| 045-AT-DIAG  | Photo-to-listing workflow swimlane (ASCII + Mermaid; rendered `.arch/…html`; live at demos.intentsolutions.io/longbox/)                                                                                                                                                                                                                                                                                         |
| 024-AT-ARCH  | Stack/artifact map (where photos live, backup, PWA plan, Immich) — MAPPED, NOT BUILT                                                                                                                                                                                                                                                                                                                            |
| 029–044      | Ratified decision records (029 modules · 040 state machine · 041 append-only/purge · 042 API contracts · 043 outbox/saga; 044 is the migration-discipline STANDARD): module boundaries · collectible + vertical-pack contracts · tenancy · pilot cohort · physical item and copy · condition policy · pilot charter · workflow state machine · append-only observations · API/idempotency/concurrency contracts |
| 044-OD-STND  | Migration discipline: the expand/contract lint, the ledger checksum, prior-snapshot upgrade tests, compatible rollback, and the architecture gate — a STANDARD that cites the records above rather than re-arguing them                                                                                                                                                                                         |

**Bead graph (materialized 2026-09-02 from doc 014):** master `longbox-e5b`; E00 `longbox-6om`; E01–E15 `longbox-e5b.1`–`.15`; E16 = `longbox-adk` (reused); E17–E19 `longbox-e5b.16`–`.18`. Every bead's description carries `Alias: E##-B##` and a `Docs:` line; `bd show <id>` → read the cited doc rows before working it. Work the graph via `bd ready`; pour the matching formula (`bd formula list` → `bd mol pour longbox-feature --var bead_alias=E05-B04 --var builder=<agent>`; migrations/providers/releases/pilot batches/partners/offboarding have their own). Leaf beads are NOT mirrored to GitHub/Plane (014 §11.3) — only epics/gates get `bd-sync link`. Discovered work gets a `-D` alias (`E02-D01`) and a 015 row. Close rule, restore drill and per-clone checklist: doc 023.

**Project subagents (`.claude/agents/`, assignment table in 014 §22):** every bead carries `lbox.agent.build` + `lbox.agent.audit` metadata. Builders — `longbox-domain-builder` (E02/E04), `longbox-security-tenancy-builder` (E03), `longbox-mobile-builder` (E05), `longbox-resolution-ai-builder` (E06/E07), `longbox-valuation-commerce-builder` (E08–E11), `longbox-platform-delivery-builder` (E12–E15). Auditors (read-only) — `longbox-invariant-reviewer` before closing any code/test bead, `longbox-gate-auditor` before closing any decision/contract bead or gate. Builders and auditors never close beads; the session closes via `bd-sync close` after the audit verdict. Advisory PR review is the MiniMax workflow (`.github/workflows/minimax-review.yml`, dormant until `ENABLE_MINIMAX_REVIEW=true` + `MINIMAX_API_KEY`).

## Governance

- **Doc filing:** every doc follows `NNN-CC-ABCD-description.ext` in flat `000-docs/`; keep `000-INDEX.md` current; each doc carries a `**Version:**` line and gets bumped on substantive edits.
- **Task tracking:** beads with plain-English titles under a parent epic, mirrored three-layer via `bd-sync` (beads = all work; GitHub = one issue per logical cluster, never per task bead; Plane = portfolio epics only, in the Longbox project, NOT CCE — 014 §11.3, doc 023 §3). All notes via `bd-sync note`, all closes via `bd-sync close` with evidence; never raw `bd close` for mirrored beads. Epic + Plane project creation is a Phase 1 open item (see 006).
- **Testing SOP:** INSTALLED. `@intentsolutions/audit-harness` is an in-repo devDep with hash manifest (`.harness-hash`); husky pre-commit runs lint-staged → typecheck → unit tests → escape-scan → verify. Policy, thresholds (line-coverage 80 on `src/services` + `src/providers`), and waived layers live in `tests/TESTING.md` — read it before changing test posture. RTM/personas/journeys traceability: `tests/{RTM,PERSONAS,JOURNEYS}.md`. CI static eval regression set is still a pending Phase 2 exit item.
- **Secrets:** SOPS + age, estate standard. No plaintext `.env` committed; decrypt in-process only.
- **Paperwork commits straight to main (Jeremy, 2026-09-04):** changes touching only `000-docs/`, the `tests/{RTM,PERSONAS,JOURNEYS}.md` prose, or `.beads/*.jsonl` are committed on `main` directly (pull `--ff-only`, commit, push) — no PR, no CI wait; the gate audit / invariant review still runs as close evidence and the commit SHA is still cited in `bd-sync close`. Anything under `src/`, `migrations/`, `scripts/`, `tests/*.ts`, `public/`, `.github/` or `package.json` still goes through a feature branch + PR. Mixed changes are split.
- **Commits/PRs:** estate commit-branch-PR standard (`~/000-projects/bobs-big-brain-umbrella/000-docs/013-OD-STND-commit-branch-pr-conventions.md`); feature branches, never main (except the paperwork rule above); commit signature is automatic. `.github/pull_request_template.md` carries the full-lane headings; docs-only PRs use the lightweight lane (013 §4.1).
- **Bead ↔ PR linkage:** every PR body carries `Bead: longbox-… (E##-B##) — <title>` within its first five lines (the template's first line) — the CI job **PR names its bead** fails a PR without that line. PRs say `Refs <cluster/epic GitHub issue>` while children remain open; `Closes` only on the PR retiring a cluster's last child (023 §3). Beads stay the work truth; the PR is the code evidence attached at close (023 §5). Branch protection on `main`: **8** required checks (incl. **PR names its bead** and, from E02-B10, **Architecture gate** — `pnpm depcruise` for 029 §3.3's module boundaries plus `pnpm arch` for the rules an import graph cannot see: 042 I5's no-`SELECT *`, 042 I22's lock-order lint, 040 §8.2's writer inventory, the `cost_log` single-writer rule; see 000-docs/044 §6/§8), strict (branch must be up to date), linear history, no force-push, no deletion, **no review requirement, `enforce_admins` off (the owner can bypass — a deliberate solo-founder posture)** — this is a single-author autonomous build; `.github/CODEOWNERS` documents ownership and routes review requests so a second engineer is one line away.
  - Bead notes that quote old-org (`intent-solutions-io`) GitHub URLs are **not** rewritten: they are Dolt history and the record of the transfer (023 §2, 027 §8, Hickey append-only). Current references live in the repo files and issue bodies.
- **Pilot data:** no shop's data appears in anything public without that shop's written consent.

## Build & test

Phase 2 core is in. Node 22 + pnpm, TypeScript strict ESM, Fastify + pg + Zod.

```bash
pnpm install
# TWO roles, two URLs (E02-D06): MIGRATE_DATABASE_URL owns the schema and runs
# migrations; DATABASE_URL is the app role, which owns nothing and therefore
# cannot disable an append-only trigger. The server refuses to boot on a
# connection whose role owns any append-only table or is a superuser.
pnpm migrate            # applies migrations/*.sql, then re-applies the app-role grants (MIGRATE_DATABASE_URL)
pnpm grant-app-role     # re-apply those grants alone (idempotent, corrective)
pnpm register-shop --name "Gotham City Limit" --slug gotham --no-recovery-contact   # one-command shop onboarding (also MIGRATE_DATABASE_URL — it seeds config rows as the schema owner)
# E03-D06: exactly ONE recovery-nomination flag is REQUIRED (048 §8.2) — the ask is
# mandatory, the nomination is not: --second-owner-email + --second-owner-name (the
# strictly better answer), --recovery-contact "<name>" [--recovery-note "<...>"], or
# --no-recovery-contact for a RECORDED decline. Silence is refused; a decline is not.
# …and now an organization, a location, an owner `app_user` and their bootstrap
# membership (034 §4.5). LOCAL ONLY: set LONGBOX_BOOTSTRAP_PIN to a six-digit PIN
# and the same run enrols ONE phone and gives the owner that PIN, printing the
# device secret once — without it a fresh database cannot run the scan flow at
# all, because every shop-scoped route is behind a device session (048 I1).
# Refused when NODE_ENV=production: the real enrollment flow is E03-D07's, below.
#
# E03-D07 — adding a person and a phone, out of band (048 §7). Both print their
# code ONCE and store it nowhere; both run as the schema owner. They are CLIs and
# not routes because issuance needs 048 §4.1's privileged session, which arrives
# with E03-D11 (`longbox-e5b.3.21`) and NOT with E03-D06: that bead landed the
# SECOND factor and found the first one assigned to nobody (048 §12.4 row 3a), so
# the routes stay declared `pending: true` on the auth allowlist.
pnpm issue-invitation --shop <uuid> --by <owner-uuid> --email <addr> --name "<name>"
pnpm issue-enrollment-code --shop <uuid> --location <uuid> --by <owner-uuid> --label "counter phone"
#
# E03-D06 — the SECOND FACTOR (048 §4, §8). CLIs for the same reason, one layer
# deeper: 048 §4.1 puts TOTP inside a session established by password + TOTP, and
# the FIRST factor has no bead (048 §12.4 row 3a). Each prints its secret ONCE.
pnpm enroll-authenticator --user <app-user-uuid>      # otpauth URI + a confirming code, then 8 recovery codes
pnpm retire-authenticator --user <uuid> --reason lost_authenticator
pnpm redeem-recovery-code --user <uuid>               # substitutes for the SECOND factor only; forces re-enrollment
pnpm dev                # tsx watch src/server.ts
pnpm typecheck          # tsc --noEmit over src/scripts/tests (tsconfig.check.json)
pnpm build              # tsc → dist/
pnpm test               # vitest unit tests (pure logic, no DB)
pnpm vitest run tests/pricing.test.ts        # single test file
pnpm test:coverage      # v8 coverage; line-80 floor on src/services + src/providers
docker compose -f docker-compose.test.yml up -d   # postgres:16 for integration lane
pnpm test:integration   # INTEGRATION=1 vitest — migrations, append-only triggers, scan-session flow, HTTP smoke; skips cleanly without a DB
pnpm lint / pnpm format:check                # eslint flat config + prettier (CI-enforced)
pnpm migrate --dry-run  # print the plan + run the expand/contract lint; WRITES NOTHING, not even its own ledger table
pnpm depcruise && pnpm arch                  # the two halves of the Architecture gate (000-docs/044 §6)
pnpm contracts:emit     # regenerate contracts/openapi.v1.json from the Zod contract (042 §2.5; I15 gates it)
pnpm fixture:schema --upto 006 --out tests/fixtures/schema/after-006.sql   # regenerate a prior-schema fixture
```

**API contract (E02-D08, doc 042):** the surface is **`/api/v1`**, registered as ONE Fastify plugin at `/api/v1/shops/:shopId` — a shop-scoped route cannot be added without the prefix. `src/contracts/v1/` is the SOURCE OF TRUTH (Zod request schemas + response DTOs + the error-code registry + the route table); `contracts/openapi.v1.json` is GENERATED from it by `pnpm contracts:emit` and a contract test fails when the committed file differs. Every mutating route requires an **`Idempotency-Key`** (serialised by `UNIQUE (shop_id, idempotency_key)` inside the request transaction, idempotency INSERT before the anchor lock, always) and accepts **`against: {table,id}`**, refused with `409 STALE_WORLD_VIEW` when the referenced record is no longer current. Every non-2xx response is ONE envelope — `{error:{code,message,details,correlation_id,retryable}}` — and **`message` comes from the keyed `MESSAGES` map, never from a throw site** — developer English that no client renders: operator copy is selected from `code`, which is why no response DTO declares a confidence, provider, model, cost, operator identifier or `storage_url`. The unversioned paths answer **308** with `Deprecation` until E02-D10 (`longbox-e5b.2.20`) removes them. Read 042 §2–§6 before changing any of it.

Layout: `migrations/` (SQL, append-only triggers enforce the Hickey model in the DB itself), `src/catalog/` (E04-D01: the LCID — one parser, the mint, the three lifecycle facts, the crosswalk writes, `resolve(lcid, asOf)` with a MANDATORY as-of and five total outcomes, and the survivor projection's rebuild; its only public surface is `index.ts`, enforced by the `catalog-public-surface-only` and `catalog-is-a-leaf` rules in `.dependency-cruiser.cjs`), `src/contracts/v1/` (the wire contract), `src/http/` (the error envelope + correlation id), `src/providers/` (VisionProvider seam: anthropic + openai-compat + per-shop registry), `src/services/` (barcode, bands, identify, rerank contradiction gate, condition, pricing + pricingService + ebay, shopify, scanSession, costLog, outbox, **media** — E03-B07's upload guard: type by magic bytes, a closed container walk that refuses polyglots, header-only pixel ceilings, EXIF/XMP/text stripping on the way in, and the per-session/per-shop quota; every ceiling a PROVISIONAL floor in `.env.example`), `src/services/auth/` (E03-D09: the two session chains, the PIN under its lockout anchor, the membership-first tenant resolver and the authentication hook — reached through `index.ts` only, because `verifyOperatorPin` is correct ONLY inside the transaction that holds its anchor lock), `src/events/` (the AUTHORED event catalogue — nine names, never generated), `src/consumers/` (commerce's job handlers + the registry composition root; `consumers-provider-scope` confines them to the credential registry), `src/routes/` (the thin HTTP edge: validate, call one service, send — no `db.query`, no `pg` import, no provider import), `public/` (minimal phone UI). Multi-shop is real: shops are rows, keys resolve per shop via `shop_credentials.key_ref` → env var name with global-env fallback; `LLM_BASE_URL`/`LLM_API_KEY` gateway override wins. All external clients (PriceCharting, eBay, Shopify) degrade to stubs when creds are empty — the pipeline never blocks on a missing token; `.env.example` documents every variable name (values live in SOPS).

**Outbox seam (E02-D07, doc 043):** the Shopify draft is a JOB, not a call the request waits on. `POST …/draft` runs its gates, appends `longbox.commerce.draft_requested` to `outbox` **inside the request transaction**, and returns **202** with the outbox row's id; a poller (`startOutboxPoller`, one per process, unref'd `setInterval`, started in `src/server.ts` after the role and append-only checks) claims the row with `SELECT … FOR UPDATE … SKIP LOCKED` and dispatches through a registry keyed on the event name (`src/consumers/`). **There is no status column and no reaper** — terminal / in-flight / due are predicates over `outbox_attempt` (`src/services/outbox.ts` exports all three), so a crashed worker's row becomes claimable again when its `started` row ages past `attempt_visibility`. The claim and its `started` INSERT are ONE transaction on ONE connection; splitting them is the bug the design exists to prevent. `productSet` carries `identifier: { customId }` so a retry UPSERTS instead of duplicating, and the draft consumer's guard **FAILS CLOSED**: a retry against an existing draft with ZERO `listing_status_observation` rows is REFUSED and dead-lettered, because unknown means do not touch. Dead letters are a VIEW over the attempt log (`outbox_dead_letter`), with `guard_refusal` separating a guard working from a provider failing. `outbox.session_seq` is assigned by `assignSessionSeq` under the anchor lock — 043 §3.2's within-session delivery order is only real because that column is populated. The four retry parameters are PROVISIONAL floors, never quoted as reliability. Read 043 §2–§9 before changing any of it; each is a ratified decision, not a preference.

**Pricing seam (v0.3.0):** every configured `PricingProvider` runs via `Promise.allSettled` (one bad source never blocks another), each writes its own immutable `pricing_snapshot` row, and the suggested price follows fixed precedence: real PriceCharting historical FMV → real eBay live-ask median → policy floor (`pickDrivingResult` in `src/services/pricingService.ts`). eBay uses OAuth2 client-credentials with a cached app token; its shop credential is a PAIR (key_ref names the client-ID var, secret at `${key_ref}_SECRET`).

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:6cd5cc61 -->

**Identity seam (E03-D09, doc 048):** every request carries a name. **Two principals, two `__Host-` cookies**: a long-lived DEVICE session (the enrolled phone, which pins the shop and the location) and a short OPERATOR session on top of it (the person, established by tapping a name and entering a six-digit PIN). Both are **append-only issuance facts with no status column** — a session is live iff its row exists, no revocation names its `chain_id`, no successor supersedes it, and now is before both its expiries — and **idle expiry is enforced by ROTATION, not by a mutable `last_seen_at`**, which is what keeps the security-critical row out of every transaction's write set. The authentication hook runs `Sec-Fetch-Site` → `Idempotency-Key` → session read → membership-first tenant, in that order and **before `@fastify/multipart`**, so a refused request touches no disk and no database; `shop_id` comes from the session and the URL is a value checked against it, with a wrong tenant answered exactly as an absent one (`SHOP_NOT_FOUND`, no details). The session lock joins 042 §5.3(b)'s order at a fixed position — **idempotency INSERT → `app_session` FOR NO KEY UPDATE → `scan_session` anchor** — policed by `pnpm arch`. Every write stamps `operator_id` + `actor_verified` from the session and never from a body. **`LONGBOX_PIN_PEPPER` is required and the server refuses to boot without it**; losing it invalidates every PIN. **Operator attribution is an attribution of record and is NOT non-repudiable** (048 §3.5's RULE): a coworker who watches a PIN can act as that person on that phone, and no artifact, 021 C-row or partner-facing sentence may say otherwise. Read 048 §3, §5, §6 and §9 before changing any of it.

**Second factor (E03-D06, doc 048 §4/§8, migration 025):** a privileged person's TOTP secret lives in `user_authenticator`, sealed **AES-256-GCM with a per-row nonce, the row's `id` as additional authenticated data, and a `key_version` from day one** — so a ciphertext moved between rows fails to authenticate instead of decrypting to a working factor. The key is `LONGBOX_AUTHENTICATOR_KEY_V<n>` (base64, exactly 32 bytes) and **the server refuses to boot without one**; rotation is additive — every version present decrypts, the highest present encrypts — so a V2 is a variable and a restart, and re-encrypting V1 rows is a later fact-producing job. **A step is consumed exactly once BY THE DATABASE**: `UPDATE … WHERE last_used_step < $2`, whose affected-row count is the authorization (048 R19), under a lockout anchor **mirrored** from 048 §9.1 with `user_authenticator` as the anchor and ONE per-person budget shared with recovery codes. Recovery codes are issued at enrollment, hashed argon2id + the same pepper, single-use by `UNIQUE (code_id)`, and **using one retires the authenticator in the same transaction**, so re-enrollment is forced by a predicate (`mfaState` → `must_reenroll`) rather than by a prompt; re-enrolling supersedes the old batch. **There is NO route and the two `pending: true` issuance rows stay pending**: 048 §4.1 puts the second factor inside a session established by password + TOTP, the FIRST factor (`user_credential`) is assigned to no bead by 048 §10.2, and `app_session`'s two kinds are both device-bound — so it is reached from CLIs (which run as the SCHEMA OWNER via `resolveMigrateUrl`, a residual E03-D11 discharges when the routes land), and 048 §12.4 row 3a names that bead: **E03-D11 `longbox-e5b.3.21`**. `user_authenticator` is a DECLARED append-only exemption because `last_used_step` is a replay guard rather than a fact; everything else the bead adds is append-only. **A recovery code substitutes for the SECOND factor only** — never for the password, never on its own (048 R20) — and every artifact must keep saying so.

**Joining a shop (E03-D07, doc 048 §7, migration 024):** a person and a phone arrive as **append-only single-use facts**, and single use is a CONSTRAINT rather than a status column — `invitation_use` carries `UNIQUE (invitation_id)`, `device_enrollment_code_use` carries `UNIQUE (code_id)`, expiry is a predicate over `expires_at`, and neither issuance table has a `status`, a `used` or a `redeemed_at`. **An invitation is redeemable ONLY on a phone already holding a live device session at the shop the token names** (048 R15; a cross-shop attempt answers `INVITATION_INVALID` byte-identically to an unknown code — 019 T24), which is why its code may be **short** (8 Crockford-base32 characters) with the per-shop ceilings enforced. **An enrollment code is 128 bits and the difference is not a preference**: the caller of an enrollment is the phone being enrolled, so the device binding is unsatisfiable and a wrong guess names no shop for the per-shop ceiling to key on — the entropy is the bound. Redeeming an enrollment mints the device credential, hashes it and **discards the secret**; the phone holds only the rotating session. **A membership revocation retires the person's PIN rows as a FACT** (`operator_pin_retirement`, `UNIQUE (operator_pin_id, retired_pin_updated_at)`) and never as an `UPDATE`, because `operator_pin` is the lockout anchor — `revokeMembership` does the revocation, the session revocations and the retirement in one transaction. Issuance is `pnpm issue-invitation` / `pnpm issue-enrollment-code` until **E03-D11** (`longbox-e5b.3.21`) lands the first factor and the privileged session — E03-D06 landed the second factor and could not (048 §12.4 row 3a). Idempotency splits by 042 §5.1's widened class: the invitation redemption takes the `request_idempotency` row (it writes a membership), the enrollment redemption does not (its exactly-once comes from the UNIQUE, and a stored replay would return a 201 with no cookie).

## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md for details and anti-patterns.

## Agent Context Profiles

The managed Beads block is task-tracking guidance, not permission to override repository, user, or orchestrator instructions.

- **Conservative (default)**: Use `bd` for task tracking. Do not run git commits, git pushes, or Dolt remote sync unless explicitly asked. At handoff, report changed files, validation, and suggested next commands.
- **Minimal**: Keep tool instruction files as pointers to `bd prime`; use the same conservative git policy unless active instructions say otherwise.
- **Team-maintainer**: Only when the repository explicitly opts in, agents may close beads, run quality gates, commit, and push as part of session close. A current "do not commit" or "do not push" instruction still wins.

## Session Completion

This protocol applies when ending a Beads implementation workflow. It is subordinate to explicit user, repository, and orchestrator instructions.

1. **File issues for remaining work** - Create beads for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **Handle git/sync by active profile**:
   ```bash
   # Conservative/minimal/default: report status and proposed commands; wait for approval.
   git status

   # Team-maintainer opt-in only, unless current instructions forbid it:
   git pull --rebase
   git push
   git status
   ```
5. **Hand off** - Summarize changes, validation, issue status, and any blocked sync/commit/push step

**Critical rules:**

- Explicit user or orchestrator instructions override this Beads block.
- Do not commit or push without clear authority from the active profile or the current user request.
- If a required sync or push is blocked, stop and report the exact command and error.

<!-- END BEADS INTEGRATION -->
