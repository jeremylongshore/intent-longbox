# TEST_AUDIT — intent-longbox

**Date:** 2026-09-02 (post-v0.3.0 dual pricing, post-blueprint graph) · **Branch:** beads/longbox-blueprint-graph @ 4f79fa7
**Grade: B+ (84/100)** — down from A- (90) on 2026-09-01, not because anything regressed (coverage 99.56 → 99.67, tests 92 → 118, integration 14/14 green on real Postgres) but because this pass applies the service/api layer matrix strictly: L5-security scanning and L4-contract are ✅ required for a service and are absent, so they grade as P0 instead of the P2 the last audit gave them. Engineer can waive either in `tests/TESTING.md` if that is the intended v0 posture.
**Classification:** service + api (`audit-harness classify` → `service` detected; also `skill` from `.agents/skills/beads/SKILL.md` — that is the vendored beads skill, not a product surface; treat as resolved noise)
**Harness:** @intentsolutions/audit-harness@1.3.1 (latest 1.3.1, no drift); `verify` OK; escape-scan `origin/main..HEAD` REFUSE=0 CHALLENGE=0 FLAG=0

## Per-layer state

| Layer | State | Evidence |
|---|---|---|
| L0 harness | INSTALLED | verify exit 0; conform/audit/scan emit gate-result/v1 (advisory) |
| L1 hooks & CI | PARTIAL | husky pre-commit chain (lint-staged → typecheck → unit → escape-scan → verify) works locally; CI jobs lint/typecheck/test/integration are blocking *jobs* but **`main` has no branch protection** (`gh api …/protection` → 404), so nothing is required server-side; harness jobs `continue-on-error`; Actions on floating `@v4` tags |
| L2 static | PARTIAL | eslint 10 flat + prettier 3 + tsc, CI-enforced. **No secret/SAST/dependency scanning**; `.github/dependabot.yml` declares `github-actions` + `pip` — no `npm` ecosystem, so the pnpm tree gets no Dependabot security PRs |
| L3 unit | ENFORCED | 118 tests / 17 files; 99.67% lines, 89.75% branches, 100% funcs; floor 80 lines on src/services + src/providers enforced in CI. Bias grade LOW (3 patterns, 318 assertions). CRAP **unmeasured** (`complexity-report` not installed). No mutation, property-based, or architecture rules |
| L4 integration + migration | INSTALLED | 14/14 green vs postgres:16 this run (migrations idempotent, append-only triggers on all 7 event tables, scan-session flow). **Skip-not-fail risk:** `probeDb()` false → `describe.skipIf`, so an unreachable DB in CI yields a green job with 0 tests |
| L4 contract | ABSENT (P0 by matrix) | Shopify Admin GraphQL, PriceCharting, eBay Browse + OAuth, Anthropic/OpenAI-compat are exercised only against hand-written stubs/fakes; no recorded-fixture request/response contract tests |
| L5 security | ABSENT (P0 by matrix) | no gitleaks / `pnpm audit` / osv / CodeQL / Semgrep anywhere |
| L5 perf, chaos | WAIVED | per TESTING.md |
| L6 smoke | INSTALLED | fastify-inject full chain register → … → drafted; only the all-stub → `policy_floor` pricing branch is hit at HTTP level (FMV → live-ask precedence is unit-only) |
| L6 BDD | PARTIAL (P2) | `features/scan-session.feature` hash-pinned, 4 scenarios, gherkin-lint clean; no runner/step defs |
| L7 UAT | WAIVED | pilot is the UAT (doc 008); RTM/PERSONAS/JOURNEYS rebuilt this pass |

## Gaps

**P0**
1. **No security scanning lane** — add gitleaks + `pnpm audit --prod` (or osv-scanner) + CodeQL `javascript-typescript`; fix dependabot ecosystem `pip` → `npm`. (Blueprint: E15-B04.)
2. **No contract tests for the four external seams** — recorded-fixture tests asserting request shape (`productSet` with `status: DRAFT`; eBay OAuth + Browse query; PriceCharting lookup) and response parsing. (Blueprint: E14-B05, E10-B01.) *Or* waive in TESTING.md as pilot-verified.
3. **R19 MUST uncovered** — static ground-truth eval regression set + CI job (RTM). Feature build, not test hygiene; beads E07-B01 `longbox-e5b.7.1`, E14-B07 `longbox-e5b.14.7`. Journey "correcting-a-wrong-call" step 4 is the same gap.

**P1**
4. `main` unprotected — no required checks; pre-commit bypassable with `--no-verify`. Admin action (Jeremy). (E15-B01.)
5. Actions floating tags (`actions/checkout@v4`, `actions/setup-node@v4`, 11 uses) — SHA-pin. (E15-B04.)
6. Integration/smoke skip-not-fail in CI — make `probeDb()` throw when `CI=true`. (E14-B03.)
7. Harness `verify` + `escape-scan` advisory in CI — promote those two (deterministic, low FP); keep `conform` advisory. (E15-B03.)
8. `release.yml` "Verify readiness" runs `npm test || true` (repo-dress template; also `make`/`pytest`/`cargo`/`go` lines) — can never fail; drop `|| true` or the step.
9. RTM SHOULD uncovered: R3 session-resume UI, R20 corpus snapshots (unbuilt features). Owner persona 1/3 flows (33% < 60%): Shopify-side draft review + weekly correction rollup — structural in v0.
10. Journey advisories: `POST /photos` multipart route has no HTTP test (R2); dual-source pricing precedence not exercised at HTTP level (R11/R12).

**P2**
11. Mutation testing (Stryker) — engineer-deferred post-pilot. 12. Coverage floor is `lines` only. 13. No dependency-cruiser architecture rules despite the deliberate providers/services/routes layering. 14. No property-based tests (`bands`, `pricing` rounding, `barcode` UPC+supplement are natural fast-check targets). 15. BDD runner absent. 16. No commitlint despite conventional-commit-driven release bumps. 17. CRAP unmeasured — install `complexity-report` or accept unmeasured.

## RTM summary

MUST 16: 12 covered · 1 partial (R5) · 2 pilot-manual (R2, R15) · 1 uncovered (R19 → beads E07-B01 / E14-B07). SHOULD 2: 0 covered (R3, R20). WON'T 1 (R16 Whatnot CSV) excluded. Orphaned tests: 0 (this pass traced `tests/providers-shared.test.ts` to R7/R18 — the 2026-09-01 RTM had it unmapped while claiming 0 orphans).

## Personas / journeys

shop-employee 3/3 flows · owner 1/3 (under 60% default threshold; no `personas.flow_coverage_min` declared). Journeys (all Critical): scanning-a-long-box 6/7 · reviewing-drafts 2/3 · correcting-a-wrong-call 3/4 — 0 fully covered; only build-closable P0 is R19, the rest are L7 pilot-manual steps.

## Escape-scan

`--range origin/main..HEAD`: clean. No policy floor lowered; `.feature` unchanged; hash manifest intact.

## Handoff → implement-tests

Autonomous (feature branch). install_order: `L2-dependabot-npm-fix` → `L5-sec-scan-job` → `L1-action-sha-pin` → `L4-ci-skip-hardening` → `L1-promote-harness-verify-escape-scan` → `L1-release-test-step-fix` → `L4-contract-fixtures` (or engineer waiver) → `L3-crap-tool` · deferred: R19 eval set (feature bead), branch protection (admin), mutation/arch/pbt/BDD runner (P2).
