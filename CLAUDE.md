# CLAUDE.md: intent-longbox

## What this is

Photo-to-listing pipeline for comic shops: a shop employee photographs a back-issue comic on a phone browser, the system identifies title/issue/variant (barcode first, then LLM re-rank with an evidence gate), the employee confirms, condition (grade range + defects) and pricing (dual sources: PriceCharting historical FMV + eBay live asks, filtered through shop policy) are captured, and a DRAFT product lands in Shopify for owner review. Nothing publishes without a human.

- **Repo:** `jeremylongshore/intent-longbox` (PRIVATE, deliberately; transferred from `intent-solutions-io` — README badges and other docs still carry the old org, tracked as blueprint bead E15-B01)
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

| Doc          | What                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------ |
| 002-PP-PRD   | Requirements R1 to R20, MoSCoW-tagged                                                      |
| 003-AT-ARCH  | Architecture: pipeline, Hickey model, deterministic/probabilistic boundary, retrieval gate |
| 004-PP-UJRN  | Employee, owner, and correction journeys in retailer language                              |
| 005-AT-SPEC  | v0 spec: schema sketch, API surface, adapter shape, Shopify wiring, eval/cost hooks        |
| 006-OD-STAT  | Live status: phase state, blockers, decision log (update this as things move)              |

## Governance

- **Doc filing:** every doc follows `NNN-CC-ABCD-description.ext` in flat `000-docs/`; keep `000-INDEX.md` current; each doc carries a `**Version:**` line and gets bumped on substantive edits.
- **Task tracking:** beads with plain-English titles under a parent epic, mirrored three-layer via `bd-sync` (bead ↔ GitHub issue per cluster ↔ Plane issue in the Longbox project, NOT CCE). All notes via `bd-sync note`, all closes via `bd-sync close` with evidence; never raw `bd close` for mirrored beads. Epic + Plane project creation is a Phase 1 open item (see 006).
- **Testing SOP:** INSTALLED. `@intentsolutions/audit-harness` is an in-repo devDep with hash manifest (`.harness-hash`); husky pre-commit runs lint-staged → typecheck → unit tests → escape-scan → verify. Policy, thresholds (line-coverage 80 on `src/services` + `src/providers`), and waived layers live in `tests/TESTING.md` — read it before changing test posture. RTM/personas/journeys traceability: `tests/{RTM,PERSONAS,JOURNEYS}.md`. CI static eval regression set is still a pending Phase 2 exit item.
- **Secrets:** SOPS + age, estate standard. No plaintext `.env` committed; decrypt in-process only.
- **Commits/PRs:** estate commit-branch-PR standard; feature branches, never main; commit signature is automatic.
- **Pilot data:** no shop's data appears in anything public without that shop's written consent.

## Build & test

Phase 2 core is in. Node 22 + pnpm, TypeScript strict ESM, Fastify + pg + Zod.

```bash
pnpm install
pnpm migrate            # applies migrations/*.sql (needs DATABASE_URL)
pnpm register-shop --name "Gotham City Limit" --slug gotham   # one-command shop onboarding
pnpm dev                # tsx watch src/server.ts
pnpm typecheck          # tsc --noEmit over src/scripts/tests (tsconfig.check.json)
pnpm build              # tsc → dist/
pnpm test               # vitest unit tests (pure logic, no DB)
pnpm vitest run tests/pricing.test.ts        # single test file
pnpm test:coverage      # v8 coverage; line-80 floor on src/services + src/providers
docker compose -f docker-compose.test.yml up -d   # postgres:16 for integration lane
pnpm test:integration   # INTEGRATION=1 vitest — migrations, append-only triggers, scan-session flow, HTTP smoke; skips cleanly without a DB
pnpm lint / pnpm format:check                # eslint flat config + prettier (CI-enforced)
```

Layout: `migrations/` (SQL, append-only triggers enforce the Hickey model in the DB itself), `src/providers/` (VisionProvider seam: anthropic + openai-compat + per-shop registry), `src/services/` (barcode, bands, identify, rerank contradiction gate, condition, pricing + pricingService + ebay, shopify, scanSession, costLog), `src/routes/` (shop-scoped API under `/api/shops/:shopId/...`), `public/` (minimal phone UI). Multi-shop is real: shops are rows, keys resolve per shop via `shop_credentials.key_ref` → env var name with global-env fallback; `LLM_BASE_URL`/`LLM_API_KEY` gateway override wins. All external clients (PriceCharting, eBay, Shopify) degrade to stubs when creds are empty — the pipeline never blocks on a missing token; `.env.example` documents every variable name (values live in SOPS).

**Pricing seam (v0.3.0):** every configured `PricingProvider` runs via `Promise.allSettled` (one bad source never blocks another), each writes its own immutable `pricing_snapshot` row, and the suggested price follows fixed precedence: real PriceCharting historical FMV → real eBay live-ask median → policy floor (`pickDrivingResult` in `src/services/pricingService.ts`). eBay uses OAuth2 client-credentials with a cached app token; its shop credential is a PAIR (key_ref names the client-ID var, secret at `${key_ref}_SECRET`).

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:6cd5cc61 -->

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
