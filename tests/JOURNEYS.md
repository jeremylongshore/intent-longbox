# User Journeys — intent-longbox

<!-- Managed by journey-mapper-agent (audit-tests). Seeded from 000-docs/004-PP-UJRN-user-journey.md. -->

## Journey: scanning-a-long-box

Personas: shop-employee
Trigger: employee opens the phone browser at the long box and taps "New scan"
Critical: true
Linked RTM: R1, R2, R4, R7, R8, R9, R10, R11, R12, R14

| #   | Step                                       | Layer | Test file                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Status |
| --- | ------------------------------------------ | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1   | Create scan session                        | L6    | tests/integration/smoke.http.test.ts (POST create → 201, in_progress), tests/integration/scan-session-flow.test.ts, tests/scan-session-service.test.ts                                                                                                                                                                                                                                                                                                                                        | ✓      |
| 2   | Snap cover/barcode photos (phone camera)   | L7    | (pilot-manual, R2 — device capture untestable in-repo; photo persistence only: tests/integration/scan-session-flow.test.ts addScanPhoto cover+barcode, tests/scan-session-service.test.ts; the multipart POST /photos route has no HTTP test)                                                                                                                                                                                                                                                 | ⚠      |
| 3   | Identify: barcode-first + vision + band    | L3    | tests/barcode.test.ts, tests/identify.test.ts (barcode candidate_set first R4; band + rerank + cost R6/R8/R13), tests/rerank.test.ts                                                                                                                                                                                                                                                                                                                                                          | ✓      |
| 4   | Confirm per band (one-tap / grid / search) | L3+L6 | tests/bands.test.ts (assignBand + applyContradiction), tests/identify.test.ts, tests/integration/smoke.http.test.ts (grid_pick confirm → 201; human_confirmation row), features/scan-session.feature (happy path; no runner wired)                                                                                                                                                                                                                                                            | ✓      |
| 5   | Call the condition (range + defects)       | L6    | tests/condition.test.ts (range never numeric, defect vocab R10), tests/pricing.test.ts (validGradeRange), tests/integration/smoke.http.test.ts (FN–VF + defects → 201)                                                                                                                                                                                                                                                                                                                        | ✓      |
| 6   | See the price (comps + policy)             | L6    | v0.3.0 dual-source: tests/pricing-service.test.ts (one pricing_snapshot per source, FMV → live-ask → policy-floor precedence via pickDrivingResult, failure isolation, stub never drives, override per row), tests/pricing.test.ts (policy math + floor), tests/pricing-provider.test.ts, tests/pricing-client.test.ts, tests/ebay-adapter.test.ts, tests/integration/smoke.http.test.ts (snapshot_count 2, sources [ebay, pricecharting], driven_by policy_floor, 2 pricing_snapshot events) | ✓      |
| 7   | Draft lands in Shopify as DRAFT            | L6    | tests/shopify.test.ts (always DRAFT), tests/shopify-client.test.ts (productSet + stub GID), tests/integration/smoke.http.test.ts (draft 201, status draft, product_set_input.input.status DRAFT, session drafted; 409 without confirmation)                                                                                                                                                                                                                                                   | ✓      |

Coverage: 6/7 steps (86%) — meets 85% floor, FAILS the 100% critical-journey bar (step 2 is pilot-manual). Step 6 precedence (FMV/live-ask) is unit-level only; the HTTP smoke exercises only the all-stub → policy_floor branch.

## Journey: reviewing-drafts

Personas: owner
Trigger: owner opens Shopify admin after a scanning shift
Critical: true
Linked RTM: R12, R14, R15

| #   | Step                                                | Layer | Test file                                                                                                                                                                                     | Status |
| --- | --------------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1   | Drafts sit unpublished (DRAFT status only)          | L3+L6 | tests/shopify.test.ts (always DRAFT), tests/shopify-client.test.ts (productSet mutation, userErrors, stub GID), tests/integration/smoke.http.test.ts (draft.status draft, input.status DRAFT) | ✓      |
| 2   | Skim identification/condition/price copy            | L7    | (Shopify-side, pilot-manual — R14/R15; stub Shopify client only, no real-store contract test; listing copy content not asserted anywhere)                                                     | ⚠      |
| 3   | Publish is a normal Shopify action, never the app's | L3    | tests/shopify.test.ts (no publish path exists; status pinned DRAFT), tests/integration/smoke.http.test.ts (product_set_input.input.status === "DRAFT")                                        | ✓      |

Coverage: 2/3 steps (67%) — below the 85% floor and the 100% critical bar; the only gap is the Shopify-admin-side review, which is pilot-manual by nature (R15).

## Journey: correcting-a-wrong-call

Personas: shop-employee → owner
Trigger: the model's pick doesn't match the book in hand
Critical: true
Linked RTM: R1, R7, R9

| #   | Step                                                               | Layer | Test file                                                                                                                                                                                                                                                                                                                                                            | Status |
| --- | ------------------------------------------------------------------ | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1   | Contradiction/low band never one-taps                              | L3    | tests/rerank.test.ts (checkEvidenceContradiction: issue #, price-box era, logo era), tests/bands.test.ts (high → medium on contradiction), tests/identify.test.ts (R7 downgrade through runIdentify), features/scan-session.feature "Evidence contradiction forces human review" (no runner)                                                                         | ✓      |
| 2   | Employee's pick recorded as truth; wrong candidate kept as history | L4    | tests/integration/scan-session-flow.test.ts (human_confirmation appended, read back), tests/integration/append-only.test.ts (candidate_set + human_confirmation reject UPDATE/DELETE), tests/integration/smoke.http.test.ts (grid_pick confirm). No test seeds a candidate_set whose top pick differs from the confirmation — covered piecewise, not as one scenario | ✓      |
| 3   | Nothing about a correction edits history                           | L4    | tests/integration/append-only.test.ts (all event tables trigger-rejected; only scan_session.status mutable), tests/integration/migrations.test.ts                                                                                                                                                                                                                    | ✓      |
| 4   | Corrections feed accuracy reporting                                | —     | (reporting queries not built, R19 MUST — static eval set + rolling human-confirmed sample; no test file)                                                                                                                                                                                                                                                             | ✗      |

Coverage: 3/4 steps (75%) — below the 85% floor and the 100% critical bar; step 4 is a MUST build gap (R19), P0.
