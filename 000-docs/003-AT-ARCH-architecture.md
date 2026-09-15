# Architecture: intent-longbox

**Version:** 1.0.1

> Photo-to-listing pipeline for comic shops: snap a cover, identify the book, price it, draft the Shopify listing

**Author:** Jeremy Longshore
**Date:** 2026-09-01
**Status:** Approved 2026-09-01 (panel-hardened: Linus, Chip Huyen, Hickey seats)

## System Context

A TypeScript/Node web app, usable from a phone browser, backed by Postgres. The first shop runs it on that shop's own system. External surfaces: the shop employee's phone browser, the configured LLM provider (Claude default, BYOK), PriceCharting, the reference-corpus sources (GCD dump + Metron), and Shopify Admin GraphQL.

## Pipeline

```
photo(s) in
  │
  ▼
[1] barcode decode ──(UPC + 5-digit supplement, deterministic)──┐
  │ no/unreadable barcode                                       │
  ▼                                                             │
[2] candidate retrieval  (LLM vision v0; Ximilar or built       │
     index only if the pilot proves need: build-vs-buy gate)    │
  │                                                             │
  ▼                                                             │
[3] LLM re-rank  (structured evidence; contradiction gate) ◄────┘
  │
  ▼
[4] human confirm  (confidence-band UX: high/medium/low)
  │
  ▼
[5] condition (grade range + defects) + pricing (PriceCharting comps + shop policy)
  │
  ▼
[6] Shopify draft  (productSet, status: DRAFT)
```

Stages 1 and 2 produce the deterministic `candidate_set`. Stage 3 is probabilistic and only annotates. Stage 4 is the human gate; nothing reaches Shopify without it. Stages 5 and 6 are deterministic given the confirmed identity and the shop's policy.

## The deterministic vs. probabilistic boundary

This is the load-bearing architectural line:

- **Deterministic:** barcode decode, candidate retrieval against a pinned corpus version, pricing-policy math, Shopify mutation. These are reproducible: same inputs plus same corpus version yields the same outputs.
- **Probabilistic:** the LLM re-rank (and LLM-vision candidate generation in v0). Probabilistic output is stored as a value (provider, model, prompt hash, response, confidence) and never mutates deterministic records. The Chip Huyen guard applies: re-rank must emit structured evidence (issue number read, price-box text, logo era) that is cross-validated against candidate metadata; any contradiction forces human review.
- **Human:** confirmation is an appended fact and doubles as the eval set. No ML feedback machinery sits between confirmations and the model.

## Data model (Hickey, P0, non-negotiable)

`scan_session` is an identity. Everything that happens to it is a separate immutable timestamped record FK'd to the session. Records are values: appended, never edited in place.

Event records (per session):

- `candidate_set`: deterministic output (barcode decode and/or retrieval k-NN), FK'd to `corpus_version`.
- `llm_rerank`: probabilistic value: provider, model, prompt hash, response, confidence. Annotates a candidate_set, never mutates it.
- `human_confirmation`: the appended human fact. This IS the growing eval set.
- `condition_assessment`: grade range + defect callouts. Never a numeric grade. Independent value.
- `pricing_snapshot`: PriceCharting comps as of scan time. Independent value; repricing appends a new snapshot.
- `shopify_draft`: product GID + status.

Configuration split (all shop-scoped, `shop_id` FK everywhere):

- `shop`: identity and settings.
- `shop_credentials`: key references only (env/SOPS-resolved), never raw keys.
- `shop_pricing_policy`: how comps become asking prices.

Reference corpus: immutable versioned snapshots (`corpus_version`) built from the GCD dump + Metron sync. Freshness SLA ~14 days; index age surfaced at query time. A candidate set always names the corpus version it was computed against, so historical sessions stay interpretable after corpus updates.

Why this shape: corrections, re-pricing, provider swaps, and corpus refreshes all become new facts instead of destructive edits. The pilot's audit trail, the eval set, and the accuracy reporting fall out of the schema for free.

## Tenancy

v0 is single-tenant (Gotham City Limit) selected by env config, but the schema is multi-shop from day one. Multi-shop is a config and onboarding change (Phase 4), not a rewrite. This was the Linus adjustment: don't build the multi-tenant machinery, do build the multi-tenant schema.

## Provider seam (BYOK)

Vision calls are small inline provider code: an Anthropic adapter plus an OpenAI-compatible adapter behind one shape, reusing the registry SHAPE from `@intentsolutions/refiner` (not the package: refiner is text-only today and v0 does not block on widening it). Config via env keys per provider, with the `LLM_BASE_URL`/`LLM_API_KEY` gateway override from the jrig Transport lore. Claude is the default and the reference provider for eval baselines. Upstreaming a vision widening to refiner happens later, with real requirements from this repo.

## Eval and cost (Chip Huyen guards, P0)

- Two-track eval: (a) static GCD-ground-truth regression set run in CI; (b) rolling human-confirmed shop-photo sample from the pilot. Accuracy tracked per provider, separately.
- Confidence bands (high / medium / low) with band telemetry on every scan; band thresholds are tunable during the pilot.
- Cost-per-scan model with per-call cost logging from day one. Even with BYOK, embedding/vector infrastructure (if the retrieval gate ever picks "build") is our cost, so the unit economics are instrumented before they matter.

## Build-vs-buy retrieval gate (open)

LLM-vision-only ID is not proven viable for issue/variant-exact identification at incumbent quality; every working incumbent uses image similarity against a reference cover corpus. v0 deliberately ships without a similarity index (Claude vision + barcode + human pick) and measures accuracy organically from the shop owner's confirmations. If the pilot shows real misses, the options in order are: (a) buy Ximilar's commercial comics visual-search API (quote requested 2026-09-01, pending); (b) build a pHash/CLIP index over GCD+Metron, accepting the fair-use legal posture (top risk #1), only if Ximilar is bad value. This gate is recorded as a decision when it closes.

## Stack and deployment

- TypeScript/Node: matches the estate and the Shopify tooling ecosystem.
- Postgres: the Hickey model is plain relational, no exotic storage.
- Runs on the shop's own system; this repository ships no hosted deployment.
- Phone-browser web app; no native app in v0.
- Secrets: SOPS + age per the estate standard; `shop_credentials` stores refs, resolution happens in-process.
