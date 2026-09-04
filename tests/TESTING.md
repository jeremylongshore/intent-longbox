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
L1: husky@9 + lint-staged (pre-commit: conflict-marker refusal → lint-staged → typecheck → unit tests → escape-scan → verify; beads hooks chained). The conflict-marker step is the REPO'S OWN (`scripts/conflictMarkers.ts`, first lint-staged entry, refusing `<<<<<<< / ||||||| / ======= / >>>>>>>` at line start in staged .ts/.md/.sql/.json/.js) rather than a pattern added to the harness's escape-scan, because the harness's policy files are hash-pinned and this repository does not edit them. It exists because the class already escaped once: a three-way rebase left all four diff3 markers inside `000-docs/000-INDEX.md` and the commit was made — prettier reformats markdown without parsing it, eslint and tsc do not read `.md`, and no test asserted about a file nobody had changed. `tests/conflict-markers.test.ts` proves the refusal against a fixture and proves the near-misses (`=====`, `---`, `>>>`) are not flagged.
L2: eslint@10 flat config (typescript-eslint) + prettier@3 (pnpm lint / pnpm format:check, CI-enforced)
L3: vitest@3 + @vitest/coverage-v8, line-80 floor on src/services + src/providers + src/consumers (pnpm test:coverage, CI-enforced)
L4-integration: docker-compose.test.yml (postgres:16) + vitest.integration.config.ts — migration runner, append-only triggers, role separation, scan-session event flow (pnpm test:integration; skips cleanly without a DB; CI runs a postgres service container)
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

## Operational notes (observational)

### The coverage include gained `src/consumers/**` (E02-D07, 2026-09-04)

The floor is unchanged at 80. What changed is its SCOPE: `src/consumers/` now
counts alongside `src/services/` and `src/providers/`.

It is not glue, which is the test the original scope comment applies. A job
handler in that directory holds the fail-closed listing guard (043 §4.3, A3 —
the most costly amendment in that record) and the draft-composition rules that
019 T7 and locked decision 5 bind, and both are pure decisions a unit test
reaches without a database. Leaving the directory outside the include would have
meant the one function whose POLARITY the cannon inverted contributed nothing to
the number anyone looks at.

Measured after the change: **91.46% lines**, against the 80 floor.

⚠ ONE STALE PHRASE IS DELIBERATELY NOT EDITED HERE. The policy line above still
reads `coverage.line: 80 # scoped to src/services + src/providers`, and that
comment is now one directory short. The value is the policy and it did not
change; the scope phrase is a statement of fact that belongs to whoever owns the
hash-pinned policy block, so it is flagged rather than quietly corrected by a
build agent. Next `audit-tests` rebuild should pick it up.

### Running the integration lane locally with two database roles (E02-D06)

The lane now needs the two roles the server and the migration runner use in
production, because the properties it asserts are properties OF those roles: an
app role that could disable a trigger would pass every append-only test and still
leave locked decision 4 unenforced.

```bash
docker compose -f docker-compose.test.yml up -d   # provisions longbox_migrate + longbox_app
pnpm test:integration
docker compose -f docker-compose.test.yml down -v  # -v matters: roles are created on FIRST init only
```

`docker/postgres-init/00-roles.sql` creates both roles; the compose file mounts it
into `/docker-entrypoint-initdb.d`, and CI pipes the same file through `psql`
(a service container cannot mount it). **If the lane fails with `role
"longbox_migrate" does not exist`, the volume predates this change — `down -v`
and bring it back up.** The passwords in that file are throwaway values for a
loopback-bound container and are not secrets; production roles come from the
deploy contract with values in SOPS.

Which role each suite uses, and why:

| Connection              | Used by                                                       | Why                                                                                                                     |
| ----------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| superuser (`ADMIN_URL`) | `createFreshDb`, the `session_replication_role` bypass probes | only a superuser can reach replica role now, so the ENABLE ALWAYS proof runs against the strongest attacker             |
| `longbox_migrate`       | `runMigrations`, seeding, owner-side trigger assertions       | owns the schema; the trigger's own refusal is only observable here                                                      |
| `longbox_app`           | `role-separation.test.ts`, the HTTP smoke pass                | the least-privileged connection the server actually uses — the smoke pass doubles as proof the grant plan is sufficient |

Two properties `longbox_app` must hold in **every** environment, local and production, because the boot assertion enforces exactly these:

- it must be **NOSUPERUSER** — a superuser can `SET session_replication_role` and bypass even an `ENABLE ALWAYS` trigger;
- it must hold **no membership in `longbox_migrate` in any form — inheriting or not.** `GRANT longbox_migrate TO longbox_app WITH INHERIT FALSE` leaves the app able to `SET ROLE longbox_migrate` and then `DISABLE TRIGGER`; the check uses `pg_has_role(..., 'MEMBER')` rather than `'USAGE'` precisely so a non-inheriting grant cannot hide, and `role-separation.test.ts` reproduces that grant against a real cluster.

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
