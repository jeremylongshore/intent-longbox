# Personas — intent-longbox

<!-- Managed by persona-coverage-agent (audit-tests). Seeded from 000-docs/004-PP-UJRN-user-journey.md. -->

## shop-employee (the scanner)

Tier: internal (shop floor)
Permissions: create sessions, upload photos, confirm identification, record condition, request price, request draft
Key flows: scan-to-draft, confirm-with-band-ux, correct-a-wrong-call
Test coverage:

- scan-to-draft: tests/integration/smoke.http.test.ts ✓
- confirm-with-band-ux: tests/bands.test.ts, tests/identify.test.ts (band logic; UI render pilot-manual) ✓
- correct-a-wrong-call: tests/integration/scan-session-flow.test.ts (confirmation appended, history kept) ✓
  Coverage: 3/3 flows (100%)

## owner (the shop owner — reviews and publishes)

Tier: internal (admin)
Permissions: pricing policy, draft review, publish (in Shopify, never via this app)
Key flows: policy-shapes-suggested-price, review-drafts-in-shopify, weekly-correction-review
Test coverage:

- policy-shapes-suggested-price: tests/pricing.test.ts, tests/integration/smoke.http.test.ts ✓
- review-drafts-in-shopify: (none — happens inside Shopify admin; the app's contract is DRAFT-only, asserted in tests/shopify.test.ts + smoke) ✗
- weekly-correction-review: (none — reporting queries not built; human_confirmation ground truth persisted per tests/integration/scan-session-flow.test.ts) ✗
  Coverage: 1/3 flows (33%) — under threshold; both gaps are Shopify-side/manual in the pilot
