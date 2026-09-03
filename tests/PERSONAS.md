# Personas — intent-longbox

<!-- Managed by persona-coverage-agent (audit-tests). Seeded from 000-docs/004-PP-UJRN-user-journey.md. -->

## shop-employee (the scanner)

Tier: internal (shop floor)
Permissions: create sessions, upload photos, confirm identification, record condition, request price, request draft
Key flows: scan-to-draft, confirm-with-band-ux, correct-a-wrong-call
Test coverage:

- scan-to-draft: tests/integration/smoke.http.test.ts (register → session → confirm → condition → price → draft → drafted; edge guards), tests/identify.test.ts (barcode-first candidate_set, no-photo/transport failures), tests/pricing-service.test.ts (employee price override persisted on every snapshot row), tests/scan-session-service.test.ts ✓
- confirm-with-band-ux: tests/bands.test.ts, tests/rerank.test.ts (contradiction detection), tests/identify.test.ts (high band on clean identify; high→medium downgrade on contradiction, R7) — UI render remains pilot-manual ✓
- correct-a-wrong-call: tests/integration/scan-session-flow.test.ts (confirmation appended, full trail read back), tests/integration/append-only.test.ts (UPDATE/DELETE rejected on every event table — history cannot be edited) ✓
  Coverage: 3/3 flows (100%) — threshold 60% (TESTING.md declares no personas.flow_coverage_min; default applied); last audit 2026-09-02 (v0.3.0 tests folded in)

## owner (the shop owner — reviews and publishes)

Tier: internal (admin)
Permissions: pricing policy, draft review, publish (in Shopify, never via this app)
Key flows: policy-shapes-suggested-price, review-drafts-in-shopify, weekly-correction-review
Test coverage:

- policy-shapes-suggested-price: tests/pricing.test.ts (comp percent, floor, rounding), tests/pricing-service.test.ts (historical FMV > live asks > policy floor precedence; stub sources never drive the price), tests/pricing-provider.test.ts + tests/ebay-adapter.test.ts (comp sources feeding the policy), tests/integration/smoke.http.test.ts (driven_by policy_floor end-to-end) ✓
- review-drafts-in-shopify: (none — happens inside Shopify admin; the app's contract is DRAFT-only, asserted in tests/shopify.test.ts "always DRAFT status" + tests/shopify-client.test.ts productSet/userErrors + smoke) ✗
- weekly-correction-review: (none — reporting/correction-rollup queries not built; human_confirmation ground truth persisted per tests/integration/scan-session-flow.test.ts and immutable per tests/integration/append-only.test.ts) ✗
  Coverage: 1/3 flows (33%) — UNDER threshold 60% (default; no personas.flow_coverage_min in TESTING.md); both gaps are Shopify-side/manual in the pilot; not Critical, so P1 tracking not P0; last audit 2026-09-02
