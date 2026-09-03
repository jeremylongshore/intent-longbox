<!-- TESTING.md schema v1 (see audit-tests/references/testing-md-spec.md) -->

# Testing Context — intent-longbox

<!-- Managed by audit-tests + implement-tests. Policy sections engineer-owned. -->

## Classification (policy)

Repo type: service + api (Fastify HTTP API over Postgres, static phone UI)
Primary language(s): typescript
Applicable layers: L1, L2, L3, L4-integration, L6-smoke
Waived layers: L5-perf (v0 pilot, no SLO yet), L5-chaos (single-node v0), L7-UAT (the Gotham City Limit pilot IS the UAT, per 000-docs/008)
Compliance overlay: none

## Thresholds (policy, hash-pinned)

<!-- DEFAULTS set by implement-tests 2026-09-01 — engineer review requested.
     coverage.line 80 is the handoff-specified floor; re-pin after any edit. -->

coverage.line: 80 # scoped to src/services + src/providers (routes/db glue → L4 lane)
flaky.tolerance: 0/3runs
<!-- mutation testing not installed in v0 (no mutation.kill_rate threshold); revisit post-pilot -->

## Installed gates (observational)

L0: @intentsolutions/audit-harness@1.3.1 (devDep, hash manifest initialized)
L1: husky@9 + lint-staged (pre-commit: lint-staged → typecheck → unit tests → escape-scan → verify; beads hooks chained)
L2: eslint@10 flat config (typescript-eslint) + prettier@3 (pnpm lint / pnpm format:check, CI-enforced)
L3: vitest@3 + @vitest/coverage-v8, line-80 floor on src/services + src/providers (pnpm test:coverage, CI-enforced)
L4-integration: docker-compose.test.yml (postgres:16) + vitest.integration.config.ts — migration runner, append-only triggers, scan-session event flow (pnpm test:integration; skips cleanly without a DB; CI runs a postgres service container)
L6-smoke: fastify-inject HTTP smoke (tests/integration/smoke.http.test.ts): register shop → session → confirm → condition → price (dual sources: stub PriceCharting + stub eBay, one snapshot per source) → draft → drafted, stub Shopify client
L6-bdd: features/scan-session.feature (engineer-owned template; no runner wired yet)
CI harness gates: verify + escape-scan BLOCKING (`harness-verify` job, promoted 2026-09-02 PR #9); conform advisory (`harness-conform`, continue-on-error, per gate-promotion policy)

## Frameworks (observational)

unit: vitest 3.2.x
coverage: @vitest/coverage-v8 3.2.x
integration: vitest 3.2.x + pg against postgres:16 (docker compose / CI service container)
e2e-smoke: fastify inject (no browser layer in v0)
lint: eslint 10.x (typescript-eslint 8.x) + prettier 3.x
hooks: husky 9.x + lint-staged 17.x

## Last audit (observational)

date: 2026-09-02
grade: B+ (84/100) — strict service/api matrix applied; see TEST_AUDIT.md
auditor: audit-tests (handed off to implement-tests same day)
p0_gaps: 3 (L5-sec scanning absent; L4-contract absent; R19 MUST uncovered → beads longbox-e5b.7.1 / .14.7)
p1_gaps: 7 (main unprotected; Actions floating tags; integration skip-not-fail in CI; harness verify/escape-scan advisory; release.yml `npm test || true`; R3/R20 SHOULD; owner persona 33%)
p2_gaps: 7 (mutation, branches floor, arch rules, property tests, BDD runner, commitlint, CRAP unmeasured)
measured: unit 118/118, 99.67% lines / 89.75% branches; integration 14/14 vs postgres:16; bias LOW; gherkin-lint clean; escape-scan clean

## Traceability (observational, updated by audit-tests)

rtm.total_requirements: 20
rtm.by_moscow:
must: 16 (12 covered, 1 partial R5, 2 pilot-manual R2/R15, 1 uncovered R19 → beads longbox-e5b.7.1 eval set + longbox-e5b.14.7 CI regression)
should: 2 (0 covered — R3 resumable UI, R20 corpus freshness not built yet)
could: 0
wont: 1 (R16 Whatnot CSV, excluded)
rtm.orphaned_tests: 0 (providers-shared.test.ts traced to R7/R18 on 2026-09-02)
personas.declared: 2
personas.under_threshold: 1 (owner 1/3 — draft review is Shopify-side; weekly correction rollup not built)
journeys.declared: 3
journeys.fully_covered: 0
journeys.partial: 3 (scanning 6/7, reviewing-drafts 2/3, correcting 3/4; only build-closable P0 is R19)

## Hash manifest

version: 2
last_init: 2026-09-01 by implement-tests (engineer re-pin requested after threshold review)
protected_files: # actual manifest: .harness-hash (+ repo patterns in .harness-hash-extra-patterns)

- features/scan-session.feature
- tests/TESTING.md
- eslint.config.js
- .prettierrc.json
- vitest.config.ts
- vitest.integration.config.ts
