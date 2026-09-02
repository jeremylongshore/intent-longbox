# TEST_AUDIT — intent-longbox

**Date:** 2026-09-01 (re-audit after 7-layer install) · **Branch:** feat/phase-2-core-pipeline
**Grade: A- (90/100)** — up from C (64/100) pre-install
**Classification:** service + api + frontend-lite
**Harness:** @intentsolutions/audit-harness@1.3.1 installed; `verify` OK; hash manifest pins 6 policy files

## Per-layer state

| Layer | State | Evidence |
|---|---|---|
| L0 harness | INSTALLED | verify exit 0; advisory CI gates emit gate-result/v1 |
| L1 hooks & CI | INSTALLED | husky pre-commit (lint-staged → typecheck → tests → escape-scan → verify), beads hooks chained; CI pnpm via corepack: lint / typecheck / coverage / integration jobs — all green on PR #4 |
| L2 static | INSTALLED | eslint flat + prettier, green in CI |
| L3 unit | ENFORCED | 92 tests; coverage 99.56% lines (floor 80 scoped to src/services + src/providers, enforced in CI) |
| L4 integration | INSTALLED | 14 tests vs postgres:16 in CI (migrations idempotent, append-only triggers reject UPDATE/DELETE on all 7 event tables); clean skip path without Docker |
| L5 system | PARTIAL (P2) | harness scan advisory in CI; no mutation testing yet (deferred v0) |
| L6 E2E/BDD | INSTALLED | HTTP smoke of full scan flow green; features/scan-session.feature template awaiting engineer refinement + re-pin |
| L7 acceptance | WAIVED | pilot-is-UAT per plan doc 008 |

## Remaining gaps

- **P1: R19** — static ground-truth eval regression set in CI (the one MUST with zero coverage). Bead filed under the v0 epic.
- **P1 (engineer action):** refine features/scan-session.feature, then `pnpm exec audit-harness init` to re-pin — clears the advisory escape-scan finding.
- **P2:** mutation testing (Stryker) not installed — revisit post-pilot.
- **P2:** harness CI gates advisory; promote to required after FP soak per gate-promotion policy.

## RTM summary

MUST 16: 13 covered · 1 partial (R5 corpus wiring) · 2 pilot-manual (R2, R15) · 1 uncovered (R19, bead filed). SHOULD 2: uncovered (features unbuilt). WON'T: R16 excluded.

## Escape-scan

One advisory finding (first-install .feature pre-pin) — expected, clears on engineer re-pin. No policy floors were lowered anywhere.
