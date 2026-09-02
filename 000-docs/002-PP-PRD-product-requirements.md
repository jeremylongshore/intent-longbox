# Product Requirements: intent-longbox

**Version:** 1.0.0

> Photo-to-listing pipeline for comic shops: snap a cover, identify the book, price it, draft the Shopify listing

**Author:** Jeremy Longshore
**Date:** 2026-09-01
**Status:** Approved (per doc 008)

## Goals

1. A shop employee with a phone can go from photographing a back-issue to a confirmed, priced DRAFT listing in the shop owner's Shopify admin, with a human decision at every publish-affecting step.
2. Every scan, model call, and human confirmation is recorded immutably so the pilot itself produces the eval data that measures and improves accuracy.
3. The system is BYOK and model-agnostic in architecture, with Claude as the default and reference provider.

## Non-Goals (v0)

- No auto-publish: everything lands in Shopify as DRAFT.
- No numeric condition grade, ever (see R10).
- No native mobile app: phone browser only.
- No multi-shop onboarding UI: single tenant via env config (schema is multi-shop ready).
- No self-built image-similarity index unless the pilot proves misses and the buy option (Ximilar) is bad value.
- No Whatnot integration in v0 (CSV export is roadmap; Seller API is closed preview).
- No ML feedback machinery: human confirmations ARE the eval set, nothing retrains automatically.

## Requirements

MoSCoW tags: M = Must, S = Should, C = Could, W = Won't (this version).

### Scan session flow

| ID | Requirement | Acceptance criteria | MoSCoW |
|----|-------------|--------------------|--------|
| R1 | Every intake starts a `scan_session` identity; all downstream events (candidates, re-rank, confirmation, condition, pricing, draft) are immutable timestamped records FK'd to it, never edited in place. | Postgres schema enforces append-only event tables; no UPDATE path in application code for event records. | M |
| R2 | Phone-browser capture: employee photographs cover (and barcode area) from a mobile browser; no app install. | Photo upload works on a current iPhone/Android browser against the deployed app. | M |
| R3 | Session state is resumable: an interrupted scan (dropped connection, closed tab) can be picked back up from the session list. | Reopening the app shows in-progress sessions with their last completed stage. | S |

### Identification

| ID | Requirement | Acceptance criteria | MoSCoW |
|----|-------------|--------------------|--------|
| R4 | Barcode first: when a post-1990 UPC with 5-digit supplement is readable, decode issue/cover/printing deterministically before any model call. | Barcode decode result stored in the `candidate_set` with method = barcode; supplement digits mapped to issue/cover/printing. | M |
| R5 | Candidate retrieval produces a `candidate_set` FK'd to a `corpus_version`; retrieval method (barcode, LLM vision, or purchased similarity API) is recorded per set. | Candidate sets are reproducible against their recorded corpus version. | M |
| R6 | LLM re-rank annotates (never mutates) the candidate set, recording provider, model, prompt hash, response, and confidence. | `llm_rerank` rows carry all five fields; candidate_set rows are untouched by re-rank. | M |
| R7 | Evidence-contradiction gate: the re-rank must emit structured evidence (issue number read, price-box text, logo era) cross-validated against candidate metadata; any contradiction forces human review regardless of confidence. | A seeded contradiction case routes to the manual/forced-review path in an integration test. | M |
| R8 | Three confidence bands drive the confirm UX: high = one-tap confirm, medium = candidate grid with forced pick, low = manual search. Band assignment is telemetered per scan. | Band thresholds configurable; band recorded on every session; UX renders the matching flow. | M |
| R9 | Human confirmation is an appended fact (`human_confirmation`) and is the growing eval set; no separate feedback pipeline. | Confirmations queryable as ground truth against the model's pick for accuracy reporting. | M |

### Condition and pricing

| ID | Requirement | Acceptance criteria | MoSCoW |
|----|-------------|--------------------|--------|
| R10 | Condition is expressed as a grade RANGE plus defect callouts (spine ticks, corner wear, foxing, etc.). The system never emits a numeric grade. | No numeric grade field exists in schema, API, prompts, or UI copy; assessment stores range bounds + defect list. | M |
| R11 | Pricing comps come from PriceCharting at scan time and are stored as an immutable `pricing_snapshot` (comps as-of that moment). | Snapshot rows carry source, query, raw comps, and timestamp; re-scanning creates a new snapshot, never an overwrite. | M |
| R12 | The suggested price applies the shop's `shop_pricing_policy` (e.g. percent of comp, floors, rounding) on top of comps; the employee can override before draft. | Policy applied server-side; override captured on the session; both visible in the draft. | M |
| R13 | Per-call cost logging from day one: every model call records token usage and computed cost; cost-per-scan is reportable. | Cost report per session and per provider available from the database. | M |

### Listing

| ID | Requirement | Acceptance criteria | MoSCoW |
|----|-------------|--------------------|--------|
| R14 | Shopify draft via Admin GraphQL `productSet` with `status: DRAFT`, media attached via public URL; product GID and status stored in `shopify_draft`. | End-to-end smoke: photo in, DRAFT product visible in the shop owner's Shopify admin. | M |
| R15 | v0 runs as a per-store Dev Dashboard app on the shop owner's store; unlisted public app is the end-state (Phase 4). | Dev app installed on Gotham City Limit's store with the minimum product/media scopes. | M |
| R16 | Whatnot bulk-CSV export of confirmed listings. | Deferred to Phase 4. | W |

### Tenancy, providers, governance

| ID | Requirement | Acceptance criteria | MoSCoW |
|----|-------------|--------------------|--------|
| R17 | Single-tenant v0 on a multi-shop schema: `shop_id` FK on every shop-scoped table; the pilot shop is selected by env config; multi-shop is a config change, not a rewrite. | Schema review confirms no shop-scoped table lacks `shop_id`; no code path assumes exactly one shop except the env-config entry point. | M |
| R18 | BYOK model policy: providers are configured per shop; Claude (Anthropic) is the default; OpenAI-compatible vision providers are supported via the same adapter shape; `LLM_BASE_URL`/`LLM_API_KEY` gateway override supported. Raw keys never in the database (`shop_credentials` stores key refs). | Switching provider is config only; grep confirms no raw key columns. | M |
| R19 | Two-track eval: a static ground-truth regression set (GCD-derived) plus the rolling human-confirmed shop-photo sample, with per-provider accuracy tracked separately; static track runs in CI. | CI job runs the static set; accuracy report splits by provider. | M |
| R20 | Reference corpus (GCD dump + Metron sync) is stored as immutable versioned snapshots with a ~14 day freshness SLA; index age is surfaced at query time. | Candidate sets show their corpus version and age; stale corpus raises a visible warning, not a hard failure. | S |

## Success Metrics (pilot, Phase 3)

| Metric | Target | How measured |
|--------|--------|-------------|
| Books listed per week | Trend up vs. the shop owner's manual baseline | shopify_draft rows per week |
| Correction rate | Trend down over pilot weeks | human_confirmation disagrees with model top pick |
| Minutes per book | Materially under manual entry | Session timestamps, employee report |
| High-band precision | High band confirmations rarely corrected | Band telemetry vs. confirmations |

## Dependencies

- PriceCharting API (Premium subscription, Jeremy action pending).
- Shopify Admin GraphQL API + Dev Dashboard app on the shop owner's store.
- Anthropic API (default provider); optional OpenAI-compatible endpoints.
- GCD bi-weekly MySQL dump (CC BY-SA 4.0, free account needed) + Metron API (CC BY-SA, ~30 req/min) for the corpus.
