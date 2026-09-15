# Technical Specification: intent-longbox

**Version:** 1.1.1

> Photo-to-listing pipeline for comic shops: snap a cover, identify the book, price it, draft the Shopify listing

**Author:** Jeremy Longshore
**Date:** 2026-09-01
**Status:** Approved 2026-09-01; implementation detail may evolve, the Hickey model may not

## Tech Stack

- TypeScript / Node (LTS), single web service.
- Postgres with migrations checked into the repo.
- Runs on the shop's own system; this repository ships no hosted deployment.
- Phone-browser web UI (server-rendered or light SPA; decided at build time, not load-bearing).
- Secrets via SOPS + age (estate standard); runtime resolution in-process, never decrypted to disk.

## Postgres schema sketch (Hickey model)

Append-only discipline: event tables get INSERTs only; application code has no UPDATE path for them. Naming and columns are a sketch; migrations are the source of truth once they exist.

### Config (mutable, shop-scoped)

```
shop                  id PK, name, slug, shopify_domain, created_at
shop_credentials      id PK, shop_id FK, kind (anthropic|openai_compat|shopify|pricecharting|ebay),
                      key_ref (env/SOPS reference, NEVER a raw key), base_url NULL, created_at
shop_pricing_policy   id PK, shop_id FK, comp_percent, floor_cents, rounding_rule,
                      effective_from  (new row per policy change, old rows kept)
```

### Corpus (immutable snapshots)

```
corpus_version        id PK, source_set (gcd_dump_date, metron_sync_date), built_at, notes
comic_issue           id PK, corpus_version_id FK, gcd_id NULL, metron_id NULL, title, issue_no,
                      variant_of_id NULL, publisher, cover_date, upc NULL, cover_image_url NULL
```

### Scan events (immutable, all FK scan_session)

```
scan_session          id PK, shop_id FK, created_by, created_at, status
scan_photo            id PK, scan_session_id FK, kind (cover|barcode|defect), storage_url, taken_at
candidate_set         id PK, scan_session_id FK, corpus_version_id FK,
                      method (barcode|llm_vision|ximilar|index), candidates JSONB
                      (ranked issue refs + scores), barcode_raw NULL, created_at
llm_rerank            id PK, candidate_set_id FK, provider, model, prompt_hash,
                      response JSONB (incl. structured evidence: issue_read, price_box_text,
                      logo_era), confidence, band (high|medium|low),
                      contradiction BOOL, tokens_in, tokens_out, cost_usd, created_at
human_confirmation    id PK, scan_session_id FK, confirmed_issue_id FK, source
                      (one_tap|grid_pick|manual_search|owner_review), confirmed_by, created_at
condition_assessment  id PK, scan_session_id FK, grade_range_low, grade_range_high
                      (label enums e.g. GD/VG/FN/VF/NM, never numeric), defects TEXT[],
                      notes, created_at
pricing_snapshot      id PK, scan_session_id FK, source (pricecharting|ebay), query, comps JSONB,
                      ONE ROW PER SOURCE per pricing call, fetched_at,
                      suggested_cents (policy applied), override_cents NULL,
                      policy_id FK, created_at
shopify_draft         id PK, scan_session_id FK, product_gid, status (draft|published|failed),
                      created_at
```

Notes: `band` and `contradiction` on `llm_rerank` drive the confirm UX and the telemetry (R7/R8). `human_confirmation` joined against `llm_rerank` is the rolling eval set (R9/R19). Nothing stores a numeric grade anywhere (R10).

## API surface (web app)

Session-cookie auth for shop users; all routes shop-scoped (shop resolved from env config in v0).

```
POST /api/scan-sessions                       start a session
POST /api/scan-sessions/:id/photos            upload photo (multipart), kind=cover|barcode|defect
POST /api/scan-sessions/:id/identify          run barcode decode + retrieval + re-rank;
                                              returns candidates, band, contradiction flag
POST /api/scan-sessions/:id/confirm           { issue_id, source }  → appends human_confirmation
POST /api/scan-sessions/:id/condition         { grade_range_low, grade_range_high, defects[] }
POST /api/scan-sessions/:id/price             runs ALL configured pricing providers
                                              (eBay live asks + PriceCharting historical
                                              FMV); one pricing_snapshot per source;
                                              returns per-source summaries + suggestion
                                              (body may carry override_cents)
POST /api/scan-sessions/:id/draft             creates the Shopify DRAFT; returns product GID
GET  /api/scan-sessions?status=in_progress    resumable session list
GET  /api/reports/accuracy?provider=...       eval report (confirmations vs. model pick, per provider)
GET  /api/reports/costs?window=...            per-scan / per-provider cost report
GET  /healthz
```

Each POST appends event rows; re-running a step appends a new record (new pricing_snapshot, new candidate_set), never overwrites.

## Provider adapter shape (BYOK)

One interface, two v0 implementations, registry-shape config borrowed from `@intentsolutions/refiner` (the shape, not the package: refiner is text-only today).

```ts
interface VisionProvider {
  id: string;                      // "anthropic" | "openai-compat"
  identify(req: {
    images: ImageRef[];           // cover (+ barcode crop)
    candidates?: CandidateMeta[]; // present for re-rank; absent for vision-candidate mode
  }): Promise<{
    ranked: RankedCandidate[];
    evidence: { issueRead?: string; priceBoxText?: string; logoEra?: string };
    confidence: number;
    raw: unknown;                  // stored verbatim in llm_rerank.response
    usage: { tokensIn: number; tokensOut: number };
  }>;
}
```

- **Anthropic adapter** (default): `ANTHROPIC_API_KEY`; current Claude vision-capable model, pinned in config.
- **OpenAI-compatible adapter**: `OPENAI_API_KEY` + model name; also serves any OpenAI-compatible endpoint.
- **Gateway override** (jrig Transport lore): `LLM_BASE_URL` + `LLM_API_KEY` redirect either adapter through a proxy/gateway. Reliability lore carried over: reasoning models need max_tokens ≥ 2048; strip `<think>` blocks before parsing.
- Provider selection per shop via `shop_credentials`; env config picks the pilot default. Adding a provider = one adapter file + config, no schema change.

## Pricing providers (dual-source, plug-and-play)

One `PricingProvider` seam, two v0 implementations, so shops compare LIVE eBay asking prices against PriceCharting HISTORICAL fair-market values:

```ts
interface PricingProvider {
  source: string;                            // "ebay" | "pricecharting"
  kind: "live_asks" | "historical_fmv";
  getComps(query: { title; issue?; variant?; grade?; upc? }, shopCtx?): Promise<{
    source; kind; comps: Comp[];
    summary: { low_cents; median_cents; high_cents; currency };
    fetched_at: Date;
    stub: boolean;                           // true when no creds → clearly-flagged empty result
  }>;
}
```

- **eBay Browse adapter** (`kind: live_asks`): OAuth2 client-credentials flow (`EBAY_CLIENT_ID`/`EBAY_CLIENT_SECRET`; per-shop override via `shop_credentials.kind = 'ebay'` — key_ref names the client-ID env var, secret at `${key_ref}_SECRET`). App token cached until near expiry. `item_summary/search` with the comics category + a query built from title/issue/variant, returning current asking prices.
- **PriceCharting adapter** (`kind: historical_fmv`): `PRICECHARTING_TOKEN` (per-shop override supported), ungraded + graded values when present. Stub until the Premium token exists; the real endpoint shape stays behind the interface (TODO noted in code).
- **Multi-source run:** the price step runs ALL configured providers via `Promise.allSettled` — a failing or stubbed source never blocks the other; failures are reported in the response, not snapshotted. One immutable `pricing_snapshot` row per fetched source.
- **Suggested price precedence:** `shop_pricing_policy` applied to the real historical-FMV comps when present, else the live-ask median, else empty comps (policy floor wins). Every snapshot row of the pricing event carries the same overall suggested_cents (the price of record); per-source medians live in each row's comps.
- Adding a pricing source = one adapter file + credential resolution, no schema change.

## Shopify integration

- **App model (v0):** per-store app created in the Shopify Dev Dashboard on the shop owner's store; Admin API access token held as a SOPS-managed secret (`shop_credentials.kind = shopify`). Unlisted public app is the Phase 4 end-state.
- **Scopes:** minimum for product + media writes (`write_products` and media upload scopes).
- **Mutation:** Admin GraphQL `productSet` with `status: DRAFT`; media attached by public URL (photos served from our app or object storage with a public URL at draft time). Store returned product GID + status in `shopify_draft`.
- **Pinned API version** in config; bump deliberately with a changelog entry.
- Failures append `shopify_draft` with `status = failed` plus the error payload; retry appends a new row.

## Eval and cost hooks

- **Static track (CI):** a GCD-ground-truth regression set (image + correct issue id) run against each configured provider; job fails on regression below the recorded baseline. Lives in-repo; runs on PR.
- **Rolling track (production):** `human_confirmation` vs. `llm_rerank` top pick, reported per provider and per band via `/api/reports/accuracy`. Weekly pilot review reads this.
- **Cost logging:** every adapter call computes cost from usage + a pinned price table and writes it on `llm_rerank`; `/api/reports/costs` aggregates per scan, per provider, per week. In place from the first model call (R13).
- **Band telemetry:** band distribution over time; a drift in band mix is the early-warning signal for corpus staleness or provider drift.

## Roadmap: Whatnot CSV export (Phase 4, not built in v0)

Confirmed listings exported as a Whatnot bulk-upload CSV (their published seller template: title, description, category, condition wording, price, image URLs). No API dependency: the Seller API is closed Developer Preview (application to be filed early). The export reads the same event records the Shopify draft reads, so it is a formatter, not a pipeline change.

## Testing posture

`/audit-tests` + `@intentsolutions/audit-harness` install in-repo was a Phase 1 governance item (since installed; see `tests/TESTING.md`). Before it landed: migrations + the static eval set + an end-to-end smoke (photo in → DRAFT visible) are the minimum gate for Phase 2 exit.
