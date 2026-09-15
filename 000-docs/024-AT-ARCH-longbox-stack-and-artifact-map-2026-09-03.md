# Stack and Artifact Map — where every Longbox artifact lives, who backs it up, what the phone runs

**Version:** 1.0.1
**Status:** MAPPED, NOT BUILT — this is the topology as it exists at main `1ed9ffb` and as the blueprint plans it; every "planned" cell names the bead that builds it. Written on 2026-09-03 in answer to Jeremy's question "do we have the software stack in place — where photos are hosted for backup, what iPhone app for pics, I use Immich, is this mapped?" It pulls the E13-B01 topology ADR forward as a map so the gaps are on paper before E00 closes.
**Beads:** E13-B01 `longbox-e5b.13.1` (topology ADR — this map is its first draft), E05-B03 `longbox-e5b.5.3` (PWA vs native), E13-B06 `longbox-e5b.13.6` (object storage), E13-B07 `longbox-e5b.13.7` (backup/PITR)
**Sensitivity:** Restricted internal when written, public since 2026-09-15 (014 §10) — infrastructure detail.
**Evidence state (018):** "Today" cells are VERIFIED at `1ed9ffb` (file:line cited); "Planned" cells are ASSERTED (blueprint) unless a bead has closed.

## 1. The short answer

| Question | Today | Planned | Owning bead |
|---|---|---|---|
| What does the employee use to take the photo? | A **phone web page** (`public/index.html`, `public/app.js`) with a file/camera input — no native iPhone/Android app, no PWA manifest, no offline queue | **PWA first** (installable, camera + offline queue), native shell only if the E05-B03 capability tests fail on supported iOS/Android | E05-B03, E05-B08 |
| Where does the photo go? | `POST /api/shops/:shopId/scan-sessions/:id/photos` → Fastify multipart → **VPS local disk** `uploads/<session>/` (`src/routes/scanSessions.ts:114-117`) | Private object storage with signed URLs; originals + derivatives with lifecycle (E13-B06); EXIF stripped and content-hashed on the way in (E05-B07) | E05-B07, E13-B06 |
| Who can read it? | **Anyone with the URL** — `uploads/` is mounted as a public static directory (`src/app.ts:18-21`); this is 016 C3 and one of the eight safety controls in 019 §3.0 | Signed, scoped URLs; no public mount | E03-B07, E05-B07 |
| Where else does it go? | To the LLM provider for identification (Anthropic or OpenAI-compatible, `src/providers/*`) and to Shopify by public URL at draft time (`src/services/shopify.ts:37`) | Same, under processor terms (E01-B06) and Shopify staged uploads instead of public URLs (E10-B04) | E01-B06, E10-B04 |
| Is it backed up? | **Not specifically.** The VPS is inside the estate borg → dev-box replica → Backblaze B2 (Object Lock) fabric, but `uploads/` for this app is not named in any backup manifest and no restore has been exercised | Working copies on VPS disk, **archival copy on Backblaze B2** (011 §Storage decision 3; no S3), restore drill to an isolated environment meeting RPO ≤24 h / RTO ≤4 h (019 T22) | E13-B06, E13-B07 |
| Is Immich part of this? | No — not mentioned in any doc, bead or config | No — see §4 | — |

## 2. Artifact map

| Artifact | Created by | Lives today | Backup today | Planned home | Planned backup / restore | Retention (019 T32; 022 P7 draft) | Bead |
|---|---|---|---|---|---|---|---|
| Photo original (cover, back, barcode, slab) | phone browser upload | `uploads/<session>/` on the VPS, public static | estate borg (implicit, unverified for this path) | private object store (B2 bucket or VPS private dir behind auth at Pilot A) | B2 Object Lock archival; restore drill | 90 days originals (draft, council Q6) | E05-B07, E13-B06 |
| Photo derivative (resized for LLM / listing) | none yet (originals sent as-is) | — | — | same store, derivative tier | same | life of the listing | E05-B07 |
| `scan_photo` row (path, `storage_key` + `content_hash`, mime) | route | Postgres on the VPS | estate borg; **no PITR** | Postgres (same) | PITR + nightly logical dump; restore drill | append-only, purge by designed path (E02-B07) | E13-B07 |
| Scan-session events (`candidate_set`, `llm_rerank`, `human_confirmation`, `condition_assessment`, `pricing_snapshot`, `shopify_draft`) | services | Postgres, append-only triggers (`migrations/001_init.sql:179`) | as above | same | same | forever (Hickey) | E13-B07 |
| Cost ledger (`cost_log`) | providers | Postgres | as above | same + category column | same | forever | E12-B01 |
| Corpus / catalog snapshots | not built | — | — | versioned snapshots (locked decision 4), source registry with rights (E04-B05) | B2 | forever, versioned | E04-B11 |
| Eval set (200 covers) + labels | not built (E07-B01) | — | — | private store + label table | B2 | forever, access-controlled | E07-B01 |
| Shopify draft product + images | `productSet` | Shopify (their store) | Shopify's | same via staged uploads | n/a (external platform, reconciled by webhooks) | Shopify policy | E10-B04, E10-B08 |
| Bead graph | bd/Dolt | `.beads/embeddeddolt/` on the dev box; JSONL mirror in git | Dolt auto-backup (15 min); git | same | same | forever | E00-B07 |
| Docs (`000-docs/`) | sessions | git (`jeremylongshore/intent-longbox`) | GitHub + dev-box borg | same | same | forever, versioned | — |
| Secrets | SOPS + age | `.env.sops` (planned; today `.env.example` names only) | git (encrypted) | vault-backed refs (E03-B05) | key rotation runbook | rotate per policy | E03-B05 |

## 3. Runtime topology

| Tier | Today (`1ed9ffb`) | Planned | Bead |
|---|---|---|---|
| Client | phone browser (any modern mobile browser; iOS Safari or Android Chrome); desktop = Shopify admin | PWA (installable, offline queue, camera/scanner APIs) for employees; Longbox desktop dashboard for owners | E05-B03, E11 |
| Ingress | Caddy on `intentsolutions` VPS (estate deploy contracts) | same; signed-URL routes for media | E13-B01 |
| App | Node 22 + Fastify (`src/app.ts`), single process, `pnpm start` | same modular monolith + workers for outbox/jobs (E02-B09, E13-B03) | E02-B02, E13-B03 |
| DB | Postgres (`DATABASE_URL`), migrations via `scripts/migrate.ts` | same, with RLS (E03-B04), PITR (E13-B07) | E03-B04, E13-B07 |
| Media | local disk, public | private object store (B2) + signed delivery | E13-B06 |
| Providers | Anthropic (default) / OpenAI-compatible via `LLM_BASE_URL`; PriceCharting + eBay (stubs until tokens); Shopify Admin GraphQL (stub until token) | same behind the capability SDK (E04-B07) with processor terms | E04-B07, E09, E10 |
| Observability | `/healthz` always OK (016 C1); no traces | truthful readiness, structured logs, traces, Slack-only alerting per estate | E13-B04, E13-B05 |
| Backup fabric | estate: VPS → dev box replica (03:30) → B2 Object Lock (04:00); home-server snapshots every 6 h | app-specific manifest naming `uploads/`/object store + DB dumps; restore drill | E13-B07 |

## 4. Immich — where it does and does not fit

Immich is a self-hosted personal photo library (single-user model, no tenant boundary, no consent/retention/rights fields, no append-only provenance, no signed-URL contract for a third-party app). It cannot be the production photo store without violating T24 (tenant isolation), T25 (rights traceability), T32 (retention/egress) and T33 (consent) — all non-waivable in 019.

Where it is useful: as Jeremy's own capture tool for the **seed and evaluation photos** (E07-B01's 200 covers) — shoot in-store on the phone, let Immich sync them, then export a labeled batch into the eval store. That is a one-bead convenience, documented in E07-B01 when it runs, not a stack component. Any Immich instance holding shop photos must sit on Jeremy's own devices/servers, never on the shop's, and the photos must be deleted from it once labeled (P7).

## 5. Gaps this map makes visible (all already owned by beads; listed so nobody rediscovers them)

1. Public `uploads/` mount — safety control, G2 (E03-B07, E05-B07).
2. No app-level backup manifest or restore drill for photos or DB — G3 (E13-B06, E13-B07).
3. No PWA/offline — the shop-floor Wi-Fi assumption in 004 is unmet (E05-B03, E05-B08).
4. Shopify receives images by public URL — replaced by staged uploads (E10-B04).
5. No retention or deletion path — T32/T33 detectors (E03-B09, E01-B06).
6. Provider egress has no processor terms on file (E01-B06).

## 6. Maintenance

Any bead that moves an artifact updates the matching §2 row and logs the change in §7.

E13-B01 replaces this map with the topology ADR (diagram, trust boundaries, cost, extraction triggers); until then, any bead that moves an artifact updates the matching row here and bumps the Version.

## 7. Row updates

Changes to the §2 artifact map since v1.0.0. One line per change, newest last.

| Date | §2 row | Change | Bead |
|---|---|---|---|
| 2026-09-03 | `scan_photo` row (path, `storage_key` + `content_hash`, mime) | Storage key + content hash **reserved** by `migrations/003_reserve_principle_slots.sql`: `scan_photo.storage_key` and `scan_photo.content_hash` are nullable columns (legacy rows have neither and are never backfilled) under a CHECK that a key never exists without a hash, plus an index on the key. The row's Retention cell is now backed by real slots — `media_deletion` tombstones the object while the row survives, and `retention_policy` / `retention_hold` / `retention_hold_release` hold the 022 P7 Q6 windows and holds. The **object** still lives in the public `uploads/` mount (§2 row unchanged on that point; E05-B07 + E13-B06 own the move to private storage). | `longbox-e5b.2.11` (E02-D01) |
