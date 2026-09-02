# CLAUDE.md: intent-longbox

## What this is

Photo-to-listing pipeline for comic shops: a shop employee photographs a back-issue comic on a phone browser, the system identifies title/issue/variant (barcode first, then LLM re-rank with an evidence gate), the employee confirms, condition (grade range + defects) and pricing (PriceCharting comps + shop policy) are captured, and a DRAFT product lands in Shopify for owner review. Nothing publishes without a human.

- **Repo:** `intent-solutions-io/intent-longbox` (PRIVATE, deliberately)
- **Stack:** TypeScript/Node + Postgres, deployed on the `intentsolutions` VPS behind Caddy per intent-os ops deploy contracts
- **First shop:** Gotham City Limit (Jacksonville), the first shop to roll out

## Locked decisions (do not relitigate without Jeremy)

1. **Private repo.** Stays private.
2. **BYOK model policy, Claude default.** Providers are per-shop config; Anthropic is the default and reference provider; OpenAI-compatible adapters supported; `LLM_BASE_URL`/`LLM_API_KEY` gateway override supported. Raw keys never in the database (`shop_credentials` holds key refs).
3. **Channels: Shopify v0, Whatnot roadmap.** Admin GraphQL `productSet` with `status: DRAFT`, per-store Dev Dashboard app for the pilot, unlisted public app as end-state. Whatnot = bulk-CSV export in Phase 4 (Seller API is closed preview; apply early). Whop is irrelevant.
4. **The Hickey data model is non-negotiable (P0).** `scan_session` is an identity; `candidate_set` / `llm_rerank` / `human_confirmation` / `condition_assessment` / `pricing_snapshot` / `shopify_draft` are immutable timestamped records appended to it, never edited in place. Config split: `shop` / `shop_credentials` / `shop_pricing_policy`. Corpus = immutable versioned snapshots. `shop_id` FK on every shop-scoped table even though v0 is single-tenant.
5. **Condition is NEVER numeric.** Grade range + defect callouts, in schema, API, prompts, and UI copy. No numeric grade anywhere.
6. **No similarity index before the pilot proves need.** v0 ships Claude vision + barcode + human pick. If the pilot shows real misses: buy (e.g. Ximilar) before build; a self-built cover index carries unresolved fair-use risk (top risk #1).
7. **Evidence-contradiction gate.** LLM re-rank must emit structured evidence cross-validated against candidate metadata; contradiction forces human review. Three confidence bands (high one-tap / medium forced pick / low manual search) with telemetry. Per-call cost logging from day one.

## Doc map

All docs in `000-docs/` per /doc-filing; index at `000-docs/000-INDEX.md`.

| Doc | What |
|-----|------|
| 002-PP-PRD | Requirements R1 to R20, MoSCoW-tagged |
| 003-AT-ARCH | Architecture: pipeline, Hickey model, deterministic/probabilistic boundary, retrieval gate |
| 004-PP-UJRN | Employee, owner, and correction journeys in retailer language |
| 005-AT-SPEC | v0 spec: schema sketch, API surface, adapter shape, Shopify wiring, eval/cost hooks |
| 006-OD-STAT | Live status: phase state, blockers, decision log (update this as things move) |

## Governance

- **Doc filing:** every doc follows `NNN-CC-ABCD-description.ext` in flat `000-docs/`; keep `000-INDEX.md` current; each doc carries a `**Version:**` line and gets bumped on substantive edits.
- **Task tracking:** beads with plain-English titles under a parent epic, mirrored three-layer via `bd-sync` (bead ↔ GitHub issue per cluster ↔ Plane issue in the Longbox project, NOT CCE). All notes via `bd-sync note`, all closes via `bd-sync close` with evidence; never raw `bd close` for mirrored beads. Epic + Plane project creation is a Phase 1 open item (see 006).
- **Testing SOP:** `/audit-tests` + in-repo `@intentsolutions/audit-harness` install is PENDING (Phase 1 item). Until installed, the minimum gate is: migrations apply clean, static eval set green, end-to-end smoke (photo in → DRAFT visible in Shopify admin).
- **Secrets:** SOPS + age, estate standard. No plaintext `.env` committed; decrypt in-process only.
- **Commits/PRs:** estate commit-branch-PR standard; feature branches, never main; commit signature is automatic.
- **Pilot data:** no shop's data appears in anything public without that shop's written consent.

## Build & test

No product code yet (Phase 1). When Phase 2 starts: pnpm scripts for build/test/migrate will be documented here; CI runs the static eval regression set on PRs.
