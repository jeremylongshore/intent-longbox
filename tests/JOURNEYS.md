# User Journeys — intent-longbox

<!-- Managed by journey-mapper-agent (audit-tests). Seeded from 000-docs/004-PP-UJRN-user-journey.md. -->

## Journey: scanning-a-long-box

Personas: shop-employee
Trigger: employee opens the phone browser at the long box and taps "New scan"
Critical: true
Linked RTM: R1, R2, R4, R7, R8, R9, R10, R11, R12, R14

| #   | Step                                       | Layer | Test file                                     | Status |
| --- | ------------------------------------------ | ----- | --------------------------------------------- | ------ |
| 1   | Create scan session                        | L6    | tests/integration/smoke.http.test.ts          | ✓      |
| 2   | Snap cover/barcode photos (phone camera)   | L7    | (pilot-manual, R2)                            | ⚠      |
| 3   | Identify: barcode-first + vision + band    | L3    | tests/barcode.test.ts, tests/identify.test.ts | ✓      |
| 4   | Confirm per band (one-tap / grid / search) | L3+L6 | tests/bands.test.ts, smoke confirm step       | ✓      |
| 5   | Call the condition (range + defects)       | L6    | tests/integration/smoke.http.test.ts          | ✓      |
| 6   | See the price (comps + policy)             | L6    | tests/integration/smoke.http.test.ts          | ✓      |
| 7   | Draft lands in Shopify as DRAFT            | L6    | tests/integration/smoke.http.test.ts          | ✓      |

Coverage: 6/7 steps (86%)

## Journey: reviewing-drafts

Personas: owner
Trigger: owner opens Shopify admin after a scanning shift
Critical: true
Linked RTM: R12, R14, R15

| #   | Step                                                | Layer | Test file                                                   | Status |
| --- | --------------------------------------------------- | ----- | ----------------------------------------------------------- | ------ |
| 1   | Drafts sit unpublished (DRAFT status only)          | L3+L6 | tests/shopify.test.ts, tests/integration/smoke.http.test.ts | ✓      |
| 2   | Skim identification/condition/price copy            | L7    | (Shopify-side, pilot-manual)                                | ⚠      |
| 3   | Publish is a normal Shopify action, never the app's | L3    | tests/shopify.test.ts (no publish path exists)              | ✓      |

Coverage: 2/3 steps (67%)

## Journey: correcting-a-wrong-call

Personas: shop-employee → owner
Trigger: the model's pick doesn't match the book in hand
Critical: true
Linked RTM: R1, R7, R9

| #   | Step                                                               | Layer | Test file                                                                          | Status |
| --- | ------------------------------------------------------------------ | ----- | ---------------------------------------------------------------------------------- | ------ |
| 1   | Contradiction/low band never one-taps                              | L3    | tests/identify.test.ts, tests/rerank.test.ts                                       | ✓      |
| 2   | Employee's pick recorded as truth; wrong candidate kept as history | L4    | tests/integration/scan-session-flow.test.ts, tests/integration/append-only.test.ts | ✓      |
| 3   | Nothing about a correction edits history                           | L4    | tests/integration/append-only.test.ts                                              | ✓      |
| 4   | Corrections feed accuracy reporting                                | —     | (reporting queries not built, R19)                                                 | ✗      |

Coverage: 3/4 steps (75%)
