# 000-docs Index: intent-longbox

**Version:** 1.9.0
**Last Updated:** 2026-09-03

| # | Doc | Hook |
|---|-----|------|
| 002 | [002-PP-PRD-product-requirements.md](002-PP-PRD-product-requirements.md) | Numbered requirements (R1 to R20, MoSCoW-tagged): scan-session flow, barcode-first, evidence gate, confidence bands, condition-never-numeric, DRAFT-only Shopify. |
| 003 | [003-AT-ARCH-architecture.md](003-AT-ARCH-architecture.md) | Panel-hardened architecture: the pipeline, the Hickey immutable data model, the deterministic vs. probabilistic boundary, and the open build-vs-buy retrieval gate. |
| 004 | [004-PP-UJRN-user-journey.md](004-PP-UJRN-user-journey.md) | The three journeys in plain retail language: employee at the long box, owner reviewing drafts, and what happens when a call is wrong. |
| 005 | [005-AT-SPEC-technical-spec.md](005-AT-SPEC-technical-spec.md) | Concrete v0 spec: Postgres schema sketch, API surface, provider adapter shape (BYOK), Shopify productSet integration, eval and cost hooks, Whatnot CSV roadmap. |
| 006 | [006-OD-STAT-status.md](006-OD-STAT-status.md) | Where things stand: plan approved 2026-09-01, Phase 0 item states, Phase 1 in progress. |
| 018 | [018-AT-DECR-longbox-evidence-rules-2026-09-03.md](018-AT-DECR-longbox-evidence-rules-2026-09-03.md) | Decision record (E00-B03, RATIFIED 2026-09-03): the evidence ladder and register states, source precedence (inspected code outranks status prose; measurements outrank marketing), contradiction and supersession rules, and change control for locked decisions, thresholds, registers, test policy and external claims. Restricted internal. |
| 022 | [022-AT-DECR-longbox-human-authority-and-workplace-principles-2026-09-03.md](022-AT-DECR-longbox-human-authority-and-workplace-principles-2026-09-03.md) | Human-authority, labor, accessibility, privacy and non-surveillance principles P1–P9 (E00-B06, RATIFIED 2026-09-03 via council): enforcement class per principle, Q1–Q7 decided, T35 origin, binding minority constraints absorbed. Restricted internal until the one-pager ships. |
| 023 | [023-OD-STND-longbox-beads-configuration-routing-and-evidence-closure.md](023-OD-STND-longbox-beads-configuration-routing-and-evidence-closure.md) | Beads configuration, routing and evidence-closure standard (E00-B07): store/hooks/backup facts, alias + metadata rules, 014 §11.3 routing, the eight formulas, the close-with-evidence rule, restore drill, per-environment checklist. Restricted internal. |
| 024 | [024-AT-ARCH-longbox-stack-and-artifact-map-2026-09-03.md](024-AT-ARCH-longbox-stack-and-artifact-map-2026-09-03.md) | Stack and artifact map (first draft of the E13-B01 topology ADR): where every artifact lives today vs planned, backup/retention per artifact, runtime topology, why Immich is not a stack component, six gaps with owning beads. MAPPED, NOT BUILT. Restricted internal. |
| 026 | [026-AT-DECR-longbox-g0-truth-lock-sign-off-2026-09-03.md](026-AT-DECR-longbox-g0-truth-lock-sign-off-2026-09-03.md) | G0 Truth Lock sign-off (E00-B08): the dated decision, the G0 criteria ↔ artifacts table, the restorable baseline manifest (git tag `g0-truth-lock`, Dolt backup commit, doc hashes), what G0 does not assert. Restricted internal. |
