# Repository Truth Audit — Addendum to 013 (appaudit EXISTS/TARGET re-check at a pinned HEAD)

**Version:** 1.0.2
**Bead:** E02-B01 `longbox-e5b.2.1` (epic LBOX-E02 `longbox-e5b.2`, gate G2, evidence class CODE) — see 000-docs/014 §8
**Filed:** 2026-09-03 · **Owner:** Jeremy Longshore · **Author:** parent session via `longbox-domain-builder` · **Audit pending:** `longbox-gate-auditor`
**Sensitivity:** Restricted internal (014 §10) — cites file:line and identifiers only, never file contents beyond single lines already public inside the repo.
**Supersedes:** nothing. **Amends:** 013 v1.0 (does not rewrite it — 018 §4 C2 forbids in-place rewriting of prior text). **Inputs:** 013, 005, 006, 014 §2.2, 016, 018, TEST_AUDIT.md, tests/TESTING.md, the repository at the pinned commit.

---

## 0. Method, pin, and what "at HEAD" means

### 0.1 Pinned commit

| Field | Value |
|---|---|
| Audited commit | `46d9910fda95bbd2c01802e480a4d84d58deadbe` — `docs(e01): prepare the pilot authority confirmation and discovery-call script (028) (#26)` |
| Branch | `main` at `origin/main`, 2026-09-03 |
| `version.txt` / `package.json` version | `0.3.11` |
| Blueprint audit baseline (the commit 014 §2.2 audited) | `569fa7d` (v0.3.0) |
| 013's own audit baseline | `89a6fdd` (the PR #5 merge; `569fa7d` is only its release-version bump) |
| Audit branch | `feat/e02-b01-repository-truth-audit` |

An earlier pass of this audit began at `5bc7741` (v0.3.9). `main` advanced twice during the work (v0.3.10, v0.3.11 plus doc 028); the branch was reset onto `origin/main` and **every finding below was re-run at `46d9910`**. Nothing in this document is carried forward from the earlier pin without re-verification.

### 0.2 What changed in code between `569fa7d` (v0.3.0) and HEAD

This is the load-bearing fact of the whole audit:

```
git diff --stat 569fa7d 46d9910 -- src migrations scripts public
→ (empty)
```

**`src/`, `migrations/`, `scripts/` and `public/` are byte-identical at `89a6fdd`, `569fa7d` and HEAD.** Not one line of product code, schema, migration script or phone UI has changed since the commit the blueprint audited. Every 013 `[EXISTS: src/…]`, `[EXISTS: migrations/…]`, `[EXISTS: scripts/…]` and `[EXISTS: public/…]` citation therefore points at the same bytes today that it pointed at when written, and this audit could verify each one directly at HEAD.

Everything that moved between `569fa7d` and HEAD moved in four places:

| Area | Change | Consequence for prior claims |
|---|---|---|
| `.github/workflows/` | `ci.yml` rewritten (security job, SHA pins, harness promotion), `minimax-review.yml` added, `release.yml` hardened | 013's CI claims and TEST_AUDIT's P1 gap list are stale (§2 A08–A12, §5 G08) |
| `tests/` | 4 contract test files + `photos.multipart.test.ts` added; RTM/PERSONAS/JOURNEYS/TESTING rewritten; `helpers.ts` CI-fail-closed | 013's test-count and RTM line citations drifted (§2 A13–A17) |
| `000-docs/` | docs 009–028 added; 000-INDEX, 001, 006, 007, 008, 016 revised | 016 §1 version column and 000-INDEX hooks drifted (§6) |
| `.beads/` | JSONL mirror went 2 records → 228; 8 formulas + 8 agents added | 013's "two beads" finding is closed (§2 A18) |

### 0.3 States used

Per 018 §2 A2, unchanged: `VERIFIED` · `CONTRADICTED` · `OPEN` · `REPORTED` · `SOURCED` · `HYPOTHESIS`. Per 018 §3, **inspected code outranks status prose** — where a doc and the artifact disagree, the artifact is recorded and the doc is listed in §7 for correction.

A distinction used throughout, because it accounts for most findings:

- **CONTRADICTED (substance)** — the claim itself is false at HEAD.
- **CONTRADICTED (citation)** — the claim is still true but the `file:line` no longer resolves to the evidence it names, because the cited file was edited after 013 was written. Under 018 §2 A1 a REPRODUCED-rung claim is only as good as its citation, so a drifted citation demotes the claim until repaired.

### 0.4 Mechanical sweep performed

All 176 distinct `file:line` citations inside `[EXISTS: …]` tags in 013 were extracted and resolved against the working tree at HEAD. Result: **176 of 176 resolve to an existing file**; 174 carry a line number and every one is within the file's length. The two non-resolving strings (`ci.yml`, `release.yml` at 013:58 and 013:660) are prose mentions inside a directory-listing claim, not path citations. Line **content** was then read back for all 176 and compared with the surrounding claim — that comparison is what produced §2.

---

## 1. Contradictions found — summary

**23 headline contradictions** in 013/005/006 (of which **11 are substance** and **12 are citation-only**), plus further CONTRADICTED rows in the blueprint table (A15, A17, B03, B04, B15, B18, C07, C10, G08) and **11 register/index drift rows in §6** — the 23 is the curated headline, not the total. None invalidates a locked decision (CLAUDE.md §Locked decisions 1–7 all survive: see §2 A24–A28). Two contradictions are internal to a single document (006 contradicts itself twice).

| # | Contradiction | Class | Row |
|---|---|---|---|
| 1 | 013 reports the in-repo test grade as "A- at 90/100" citing `TEST_AUDIT.md:4`; that line reads **B+ (84/100)** | substance | A03 |
| 2 | 013: "92 unit tests at 99.56 percent line coverage" — HEAD runs **162 tests in 21 files** | substance | A04 |
| 3 | 013: "Four required jobs plus two advisory harness jobs" — HEAD has **6 blocking jobs and 1 advisory** | substance | A08 |
| 4 | 013: "Escape-scan … advisory for now" — `harness-verify` carries no `continue-on-error` | substance | A09 |
| 5 | 013: `.github/workflows/` "contains only `ci.yml` and `release.yml`" — `minimax-review.yml` is a third | substance | A10 |
| 6 | 013: "Only two beads exist in the tracked mirror" — the mirror holds **228 issue records** | substance | A18 |
| 7 | 013 §Reference: repository is `intent-solutions-io/intent-longbox` `[EXISTS: git remote]` — the remote is **`jeremylongshore/intent-longbox`** | substance | A19 |
| 8 | 013: `src/routes/scanSessions.ts` has "8 routes" — the file registers **9** | substance | A21 |
| 9 | 005 §API surface routes are unscoped `/api/scan-sessions/…` — shipped routes are **`/api/shops/:shopId/scan-sessions/…`** | substance | B02 |
| 10 | 005 §API surface: "Session-cookie auth for shop users" — **no authentication exists anywhere** | substance | B01 |
| 11 | 005 §Schema: `human_confirmation … confirmed_issue_id FK` — shipped column is **`confirmed_issue jsonb`, no FK** | substance | B06 |
| 12 | 013 `TEST_AUDIT.md:4` cited for the grade — line moved content | citation | A03 |
| 13 | 013 `.github/workflows/ci.yml:86` cited for the CI database export — line is now `node-version:` | citation | A11 |
| 14 | 013 `.github/workflows/ci.yml:106` cited for the harness gates — line is now inside the `security` job | citation | A09 |
| 15 | 013 `tests/RTM.md:28` cited for R19 — line 28 is **R17**; R19 moved to line 30 | citation | A13 |
| 16 | 013 `tests/RTM.md:12` cited for R3 — line 12 is **R1**; R3 is at line 14 | citation | A14 |
| 17 | 013 `TEST_AUDIT.md:23` cited for the R19 gap — line 23 is blank; the gap is at line 29 | citation | A15 |
| 18 | 013 `TEST_AUDIT.md:25` cited for mutation/advisory gates — line 25 is blank; gap 11 is at line 41 | citation | A16 |
| 19 | 013 header pins `package.json:3` as `v0.2.1` — that line now reads `0.3.11` | citation | A01 |
| 20 | 013 §Files that matter: "Line 23 hardcodes DRAFT" in `shopify.ts` — line 23 opens the function; the literal is at line 28 | citation | A22 |
| 21 | 006:32 records the repo as `intent-solutions-io/intent-longbox` | substance | C01 |
| 22 | 006:41 "Phases 2 to 4 — Not started" vs 006:11 "v0 core pipeline SHIPPED 2026-09-02" | substance (internal) | C04 |
| 23 | 006:36–37 unchecked Phase 1 boxes for the harness install and the bead graph, both of which shipped | substance (internal) | C02, C03 |

Contradiction 21 is one instance of a repository-wide stale-identity defect; §8 records the fix landed with this audit.

---

## 2. Doc 013 — every EXISTS/TARGET tag re-checked at HEAD

013 tags are re-checked in place. Rows are grouped; `013:N` is the line carrying the claim.

### 2.1 Version, scores and framing

| # | Claim (013) | Source line | State at HEAD | Evidence | Action |
|---|---|---|---|---|---|
| A01 | "Repo version audited: v0.2.1 (`package.json:3`), HEAD `89a6fdd`" | 013:5 | **CONTRADICTED (citation)** | `package.json:3` = `"version": "0.3.11",`. The *pin* is sound — `git log -1 89a6fdd` is the PR #5 merge and `package.json` there did read 0.2.1 (the bump lands in the following release commit `569fa7d`) | none — historical pin. §7 adds a "read as of 89a6fdd" note |
| A02 | "84 / 100 as designed" and "**Today as built: 38 / 100**" | 013:87 and §2 close | **REPORTED** (unchanged from 016 C19) | No measurement, cohort, denominator or rubric is attached to either number; they are author judgment, rank 4 under 018 §3. Re-inspection at HEAD found no scoring artifact anywhere in the repo | none in 013 (append-only); **000-INDEX row 013 restates both numbers as bare facts and must be qualified** — §7 |
| A03 | "an excellent test suite … (A- at 90/100 on the in-repo test audit) `[EXISTS: TEST_AUDIT.md:4]`" | 013:87 | **CONTRADICTED (substance + citation)** | `TEST_AUDIT.md:4` reads `**Grade: B+ (84/100)** — down from A- (90) on 2026-09-01`. The cited line asserts the opposite grade. TEST_AUDIT was rewritten in `3260fc7` — the *same commit that filed 013* — so this citation was stale on arrival | correct at next 013 edit (§7); no bead — TEST_AUDIT itself is accurate |
| A04 | "92 unit tests at 99.56 percent line coverage … 14 integration tests, four required CI jobs plus two advisory harness jobs, and a full requirements traceability matrix" `[TEST_AUDIT.md:4, tests/RTM.md:31, .github/workflows/ci.yml]` | 013:654 | **CONTRADICTED (substance)** | `pnpm test` at HEAD: **`Test Files 21 passed (21) / Tests 162 passed (162)`**. `TEST_AUDIT.md:4` records 118 at its own date. CI job count → A08. `tests/RTM.md:31` still carries the R20 row, so the RTM half is VERIFIED | correct at next edit (§7) |

### 2.2 Architecture, pipeline and data model — all VERIFIED

Every one of these citations resolves to unchanged bytes (§0.2) and the line content matches the claim.

| # | Claim (013) | Source line | State at HEAD | Evidence |
|---|---|---|---|---|
| A05 | Barcode-first deterministic path `[src/services/barcode.ts:1, src/services/identify.ts:50]` | 013:32 | **VERIFIED** | `barcode.ts:1` `// UPC-A + 5-digit supplement parse (deterministic, pure — R4).`; `identify.ts:50` `// 1. Deterministic: barcode first (R4).` |
| A06 | Evidence-contradiction gate forces a human choice `[src/services/rerank.ts:18, src/services/bands.ts:18]` | 013:32, :177, :224 | **VERIFIED** | `rerank.ts:18` `export function checkEvidenceContradiction(`; `bands.ts:18` `export function applyContradiction(band: Band, contradiction: boolean): Band {`; `tests/rerank.test.ts` 6 green, `tests/identify.test.ts` asserts high→medium |
| A07 | "184 lines … Line 13 defines `forbid_mutation`; lines 170 to 182 attach it to **nine** tables" | 013:345 | **VERIFIED exactly** | `wc -l migrations/001_init.sql` → **184**; `:13` `CREATE OR REPLACE FUNCTION forbid_mutation()`; `:171-182` a `DO $$` loop over the 9-element array `corpus_version, scan_photo, candidate_set, llm_rerank, human_confirmation, condition_assessment, pricing_snapshot, shopify_draft, cost_log` |
| A20 | "1,930 lines of TypeScript total" `[EXISTS: verified against the working tree]` | 013:339 | **VERIFIED exactly** | `find src -name '*.ts' \| xargs wc -l` → **1930** |
| A21 | "`src/routes/scanSessions.ts` … 346 lines, **8 routes**" | 013:346 | **VERIFIED (lines) / CONTRADICTED (route count)** | `wc -l` → 346 ✓. `grep -c 'app\.\(get\|post\)('` → **9**: `/api/shops` (`:73`) plus 8 under `base`. 013's own §Reference route table at 013:739–747 correctly lists **all nine** — the prose undercounts by excluding the shop-list route | 
| A22 | "`src/services/shopify.ts` — Line 23 hardcodes DRAFT" | 013:350 | **VERIFIED (substance) / CONTRADICTED (citation)** | `:23` opens `buildProductSetInput`; the literal `status: "DRAFT",` is at **`:28`** (with `:20` documenting it). DRAFT is genuinely hardcoded and unconditional |
| A23 | "`src/config.ts` — Lines 39 to 42 are the pinned per-million-token prices; line 46 returns zero for any model not in the table" | 013:351 | **VERIFIED exactly** | `config.ts:39-42` `PRICE_TABLE_PER_MTOK` with `claude-sonnet-5` and `gpt-4o`; `:46` `if (!p) return 0;` |
| A29 | "only three indexes total" in the initial schema | 013:954 | **VERIFIED exactly** | `grep -c 'CREATE INDEX' migrations/001_init.sql` → **3** |
| A30 | "`scripts/migrate.ts` — No advisory lock, so two concurrent deploys can race" | 013:352, :947 | **VERIFIED** | `scripts/migrate.ts:23` `const applied = new Set(`; no `pg_advisory_lock` anywhere in the file |
| A31 | Registry defaults to `claude-sonnet-5` | 013:614 | **VERIFIED** | `src/providers/registry.ts:62` `const cfg: ProviderConfig = { apiKey: key, model: envOr("ANTHROPIC_MODEL") ?? "claude-sonnet-5" };` |
| A32 | Stub Shopify client returns success with a `stub-` GID | 013:410, :1037 | **VERIFIED** | `src/services/shopify.ts:93` `return { ok: true, status: 200, productGid: \`gid://shopify/Product/stub-${Date.now()}\` };` |
| A33 | `/healthz` returns OK unconditionally | 013:191, :440, :530, :730, :793 | **VERIFIED** | `src/app.ts:25` `app.get("/healthz", async () => ({ ok: true }));` — no dependency probe. Duplicate of 016 C1 |
| A34 | No vendor credentials — `.env.example` `:35`, `:38`, `:48` all blank | 013:663 | **VERIFIED** | `.env.example:35` `PRICECHARTING_TOKEN=`, `:38` `EBAY_CLIENT_ID=`, `:48` `SHOPIFY_ADMIN_TOKEN=` — all empty right-hand sides |
| A35 | Shopify API version pinned in config | 013:77 | **VERIFIED** | `.env.example:49` `SHOPIFY_API_VERSION=2025-07` |
| A36 | eBay OAuth app-token cache; per-shop credential pair | 013:502, :516, :808 | **VERIFIED** | `src/services/ebay.ts:64` `let cached: { token: string; expiresAt: number } \| undefined;`; `migrations/002_ebay_credential_kind.sql:9` adds the `ebay` kind constraint; `src/providers/registry.ts:105` `loadShopCredential(db, shopId, "ebay")`; `scripts/register-shop.ts:36` prints the ref pair |
| A37 | PriceCharting field mapping unverified, carries its own TODO | 013:800, :985 | **VERIFIED** | `src/services/pricing.ts:105` `// TODO(pricecharting): the Premium token doesn't exist yet — this mapping` |
| A38 | Phone UI implements high one-tap / medium grid / low manual | 013:103, :387, :655 | **VERIFIED** | `public/app.js:115` `if (data.band === "high" …)` one-tap; `:127` `else if (data.band === "medium" …)` grid; `:145` low → manual search; `:125`/`:143`/`:166` post `one_tap` / `grid_pick` / `manual_search` |
| A39 | No authentication anywhere | 013:566, :659, :171 | **VERIFIED** | No auth hook, cookie plugin, or bearer check in `src/app.ts` or `src/routes/scanSessions.ts`; the only `authorization` strings in `src/` are the log redaction at `app.ts:13` and outbound eBay headers (`ebay.ts:72`, `:91`) |
| A40 | No deploy path (no Dockerfile, service unit, Caddy snippet or deploy workflow) | 013:58, :660, :728, :786 | **VERIFIED (substance)** — see A10 for the citation | No `Dockerfile`, no `deploy.yml`; the three workflows are `ci.yml`, `release.yml`, `minimax-review.yml` (none deploys) |
| A41 | No reporting endpoints (`/api/reports/*`), no session-list endpoint | 013:668, :877 | **VERIFIED (substance)** — see A14 for the citation | `rg 'reports\|accuracy\|costs' src/routes src/app.ts` → no match; the only `GET`s are `/healthz`, `/api/shops`, `${base}/:id` |

### 2.3 CI, tests and traceability — where 013 has gone stale

| # | Claim (013) | Source line | State at HEAD | Evidence | Action |
|---|---|---|---|---|---|
| A08 | "`.github/workflows/ci.yml` — The only enforced quality gate. **Four required jobs plus two advisory harness jobs**" | 013:353 | **CONTRADICTED (substance)** | `ci.yml` at HEAD defines 7 jobs: `lint`, `typecheck`, `test`, `integration`, `security` (gitleaks + osv-scanner), `harness-verify` (verify + escape-scan) — **6 with no `continue-on-error`** — and `harness-conform` (`continue-on-error: true`, `ci.yml:152`), the **only** advisory job | correct at next 013 edit (§7); no bead |
| A09 | "Escape-scan and hash-pinned policy artifacts run in CI, **advisory for now**. `[.github/workflows/ci.yml:106]`" | 013:586 | **CONTRADICTED (substance + citation)** | The `harness-verify` job (`ci.yml:130`, steps `:142` Verify hash-pinned artifacts, `:144` Escape-scan the branch range) carries no `continue-on-error`. `ci.yml:106` is now a `with:` key inside the `security` job. Same finding as 016 C26, here traced to 013 as well as TESTING.md | correct at next edit (§7) |
| A10 | "`.github/workflows/` contains only `ci.yml` and `release.yml`" | 013:58, :660 | **CONTRADICTED (substance)** | Three workflows at HEAD: `ci.yml`, `minimax-review.yml`, `release.yml`. The *conclusion* ("no deploy path") is unaffected and stays VERIFIED (A40) | correct at next edit (§7) |
| A11 | "Start the compose file and export `TEST_DATABASE_ADMIN_URL` as CI does `[.github/workflows/ci.yml:86]`" | 013:407 | **CONTRADICTED (citation)** | `ci.yml:86` is `node-version: ${{ env.NODE_VERSION }}` inside the `integration` job. CI does still provision Postgres and set the admin URL (job `integration`, `ci.yml:65`, step `:89`), so the substance holds | repair citation at next edit (§7) |
| A12 | "Integration tests skip silently … the lane is designed to skip cleanly `[vitest.integration.config.ts:4]`" | 013:407 | **VERIFIED locally / CONTRADICTED for CI** | `vitest.integration.config.ts:4` still documents the skip. But `tests/integration/helpers.ts:36-39` now **throws** when `process.env.CI` is set: `` `[integration] CI=true but no Postgres reachable at ${where} …; refusing to skip the lane in CI` ``. The skip-not-fail hole 013 flagged is closed in CI and open only locally | none — closed by design |
| A13 | "R19 … is the one MUST requirement with zero coverage `[tests/RTM.md:28, TEST_AUDIT.md:23]`" | 013:661, :821 | **VERIFIED (substance) / CONTRADICTED (both citations)** | R19 is still the single uncovered MUST — `tests/RTM.md:30` `R19 … ✗ Uncovered — open MUST`, and `tests/RTM.md:48` tallies MUST 16 / 12 covered / 1 uncovered (R19). But **line 28 is now R17** and `TEST_AUDIT.md:23` is a blank line (the R19 gap is `TEST_AUDIT.md:29`) | repair citations at next edit (§7); the gap itself is owned by **E07-B01** `longbox-e5b.7.1` + **E14-B07** `longbox-e5b.14.7` |
| A14 | "No session list endpoint, so R3 (resumable sessions) has no implementation `[tests/RTM.md:12]`" | 013:668, :877 | **VERIFIED (substance) / CONTRADICTED (citation)** | No list route exists (A41). But `tests/RTM.md:12` is the **R1** row; R3 is at `tests/RTM.md:14` (`⚠ Uncovered`, "session-list UI not built yet") | repair citation (§7); gap owned by **E05-B01…B10** |
| A15 | R14 "Not built, correctly marked WON'T for v0 `[tests/RTM.md:25]`" | 013:919 | **CONTRADICTED (substance)** | `tests/RTM.md:25` is the **R14** row and reads `✓ Covered (stub-client smoke; real-store E2E is the pilot)`, MoSCoW **MUST** — not WON'T. The WON'T requirement is R16 (Whatnot CSV), per `tests/RTM.md:48` and `TEST_AUDIT.md:45`. The citation is right and the sentence is wrong | correct at next edit (§7) |
| A16 | "No mutation testing, harness gates still advisory `[TEST_AUDIT.md:25]`" | 013:671 | **half VERIFIED / half CONTRADICTED** | Mutation testing genuinely absent (`tests/TESTING.md:22` `<!-- mutation testing not installed in v0 … -->`; `TEST_AUDIT.md:41` gap 11, engineer-deferred) → VERIFIED. "Harness gates still advisory" → CONTRADICTED, see A09. `TEST_AUDIT.md:25` is a blank line | correct at next edit (§7) |
| A17 | "the integration lane asserts the rejection on **all seven** event tables `[migrations/001_init.sql:170, tests/integration/append-only.test.ts, TEST_AUDIT.md:16]`" | 013:649 | **VERIFIED (nine tables) / the "seven" figure is inherited drift** | The migration attaches triggers to **nine** relations (A07). `TEST_AUDIT.md:16` still says "append-only triggers on all 7 event tables". 013's own lead sentence says "Nine tables carry triggers" and then says the lane asserts seven — both figures in one line. This is the same undercount 016 C7 recorded against CLAUDE.md | correct in 013 and `TEST_AUDIT.md` at next edit (§7) |
| A18 | "Only **two** beads exist in the tracked mirror `[.beads/issues.jsonl, 2 records]`" | 013:669, :987 | **CONTRADICTED (substance) — closed** | `.beads/issues.jsonl` at HEAD holds **228 issue records** (227 carrying `lbox.alias`; the one without is the pre-blueprint `longbox-adk.1`), statuses 216 open / 9 closed / 3 in progress. Four discovered beads carry `-D` aliases: `E02-D01` `longbox-e5b.2.11`, `E05-D01` `longbox-e5b.5.11`, `E03-B07-D1` `longbox-e5b.3.7.1`, `E13-B04-D1` `longbox-e5b.13.4.1` | none — closed by E00-B07 |

### 2.4 Identity and references

| # | Claim (013) | Source line | State at HEAD | Evidence | Action |
|---|---|---|---|---|---|
| A19 | "Repository \| `https://github.com/intent-solutions-io/intent-longbox` (private) `[EXISTS: git remote]`" | 013:727 | **CONTRADICTED (substance)** | `git remote -v` → `origin https://github.com/jeremylongshore/intent-longbox.git (fetch/push)`. The tag claims the git remote as its evidence and the git remote says otherwise | correct at next 013 edit (§7); repo-wide fix landed with this audit (§8), remaining scope owned by **E15-B01** `longbox-e5b.15.1` |
| A19b | `git clone https://github.com/intent-solutions-io/intent-longbox.git` in the onboarding block | 013:372 | **CONTRADICTED (substance)** | Same evidence. GitHub redirects transferred repos, so the command still works — the identity is wrong, not the instruction | correct at next edit (§7) |

### 2.5 Locked decisions re-checked against code at HEAD

The five locked decisions with a code surface, re-verified independently of 016.

| # | Locked decision (CLAUDE.md) | State at HEAD | Evidence |
|---|---|---|---|
| A24 | 2 — BYOK; raw keys never in the database; `key_ref` names an env var | **VERIFIED** | `migrations/001_init.sql:34` `-- key_ref is the NAME of an env/SOPS reference. NEVER a raw key.`; `src/providers/registry.ts:33` `resolveKeyRef`; `:78` global `ANTHROPIC_API_KEY` fallback |
| A25 | 3 — Shopify `productSet` with `status: DRAFT` | **VERIFIED** | `src/services/shopify.ts:20` comment, `:28` `status: "DRAFT",`; `tests/contract/shopify-productset.contract.test.ts` asserts DRAFT on every path |
| A26 | 4 — Hickey model; `shop_id` FK on every shop-scoped table | **VERIFIED (as schema) / unenforced (as boundary)** | Triggers per A07; `shop_id uuid NOT NULL REFERENCES shop(id)` on `scan_session:66`, `scan_photo`, `candidate_set`, `llm_rerank`, `human_confirmation`, `condition_assessment`, `pricing_snapshot`, `shopify_draft`, `cost_log`. `grep -cE 'ROW LEVEL SECURITY\|CREATE POLICY' migrations/*.sql` → 0, so it is a convention, not an enforced boundary (016 C6, C23) |
| A27 | 5 — Condition is never numeric | **VERIFIED** | `src/services/condition.ts:2-3` `// the type enforces it: labels only, low <= high, no numeric field exists.` / `GRADE_LABELS = ["PR","FR","GD","VG","FN","VF","NM"]`; `migrations/001_init.sql:126` CHECK constraint on the same label set; `src/routes/scanSessions.ts:190,197` validate the range. No numeric grade column anywhere |
| A28 | 7 — Contradiction gate + three bands + per-call cost logging | **VERIFIED** | Gate per A06; bands `src/services/bands.ts:7` `assignBand`, thresholds `src/config.ts:31-32`; cost logging `src/services/identify.ts:120` `appendCostLog` writing both `llm_rerank` cost columns (`001_init.sql:93`) and `cost_log` (`:158`) |

**A42 — a locked-decision gap worth naming.** Locked decision 7 requires "telemetry" on the bands; the UI renders the *raw confidence percentage* to the operator at `public/app.js:103` (`(data.confidence * 100).toFixed(0)}%`) and `:113`. That is forbidden by 022 P6 / 019 §2 and is already owned by **E05-D01** `longbox-e5b.5.11` — this audit **VERIFIES the bug at file:line** rather than discovering it.

**A43 — the schema-slot gap.** `scan_photo` (`migrations/001_init.sql:73-80`) carries `storage_url` only: no `storage_key`, no `content_hash`, and the append-only trigger forbids DELETE (`:15`, `:171-182`). The 022 P7 deletion mechanism therefore cannot be executed on the shipped schema. Owned by **E02-D01** `longbox-e5b.2.11`; **VERIFIED at file:line** here.

---

## 3. Doc 005 (technical spec) — design claims against shipped code

005 is a design spec; most of it is legitimately forward-looking. The rows below are only the claims that assert a shape the code was expected to have.

| # | Claim (005) | Source line | State at HEAD | Evidence | Action |
|---|---|---|---|---|---|
| B01 | "Session-cookie auth for shop users; all routes shop-scoped (shop resolved from env config in v0)" | 005:70 | **CONTRADICTED (auth) / VERIFIED (shop-scoping)** | No cookie plugin, session store or auth hook exists (A39). Shop scoping *is* real but comes from the **path**, not env config: `src/routes/scanSessions.ts:70` `const base = "/api/shops/:shopId/scan-sessions"`, `:37` `z.object({ shopId: z.string().uuid() })`, `:42` `requireShop` | **E03-B02/B03** own auth; correct the sentence in 005 at next edit (§7) |
| B02 | API surface listed as `POST /api/scan-sessions`, `/:id/photos`, `/:id/identify`, `/:id/confirm`, `/:id/condition`, `/:id/price`, `/:id/draft` | 005:73-84 | **CONTRADICTED (paths) / VERIFIED (verbs and semantics)** | Every one of those seven exists but under `/api/shops/:shopId/scan-sessions` (`scanSessions.ts:78, 101, 128, 161, 183, 215, 276`). A `GET ${base}/:id` (`:91`) and `GET /api/shops` (`:73`) exist and are not in 005 | correct 005's path prefix at next edit (§7) |
| B03 | `GET /api/scan-sessions?status=in_progress` — resumable session list | 005:85 | **CONTRADICTED — not built** | No list route; R3 uncovered (`tests/RTM.md:14`) | **E05-B01…B10** |
| B04 | `GET /api/reports/accuracy` and `GET /api/reports/costs` | 005:86-87 | **CONTRADICTED — not built** | `rg 'reports' src/` → no match. The underlying data exists (`llm_rerank`, `human_confirmation`, `cost_log`) — only the endpoints are missing | **E11** reporting surfaces |
| B05 | `GET /healthz` | 005:88 | **VERIFIED (exists) / weak** | `src/app.ts:25`, unconditional (A33) | **E13-B04** |
| B06 | `human_confirmation … confirmed_issue_id FK` | 005:53 | **CONTRADICTED (substance)** | Shipped column is `confirmed_issue jsonb NOT NULL` with the in-file comment `-- issue ref (candidate payload or manual entry); corpus FK when corpus lands` (`migrations/001_init.sql:111-119`). There is no FK because there is no corpus table to point at | correct 005 at next edit (§7); FK lands with **E04** |
| B07 | Corpus tables `corpus_version` and `comic_issue` | 005:36-38 | **VERIFIED (`corpus_version`) / OPEN (`comic_issue`)** | `corpus_version` exists (`001_init.sql:54`) and `candidate_set.corpus_version_id` references it (`:86`). **`comic_issue` does not exist** in any migration — `grep 'CREATE TABLE' migrations/*.sql` lists 13 tables, none of them `comic_issue` | **E04** catalog epic |
| B08 | `scan_photo … storage_url, taken_at` | 005:45 | **VERIFIED as specified** | `001_init.sql:73-80` matches exactly. What the spec never asked for is the gap: no `storage_key`, no `content_hash` (A43) | **E02-D01** |
| B09 | `pricing_snapshot … ONE ROW PER SOURCE per pricing call … policy_id FK` | 005:58-61 | **VERIFIED** | `001_init.sql:133-145` carries `source`, `comps`, `suggested_cents`, `override_cents`, `policy_id uuid REFERENCES shop_pricing_policy(id)`, `fetched_at`; `src/services/pricingService.ts:97` `// One immutable snapshot row per fetched source.` |
| B10 | `shop_pricing_policy … effective_from (new row per policy change, old rows kept)` | 005:29-30 | **VERIFIED (columns) / OPEN (enforcement)** | `001_init.sql:41-52` has `comp_percent`, `floor_cents`, `rounding_rule`, `effective_from`. **`shop_pricing_policy` is NOT in the append-only trigger array** (A07) — it is config, deliberately mutable, so "old rows kept" is an application convention with no DB guarantee | note in 005 at next edit (§7); **E02-B03…B10** |
| B11 | `VisionProvider` interface shape (ranked, evidence, confidence, raw, usage) | 005:98-110 | **VERIFIED** | `src/providers/types.ts:24` `/** REQUIRED structured evidence — the contradiction gate's raw material (R7). */`; `src/providers/shared.ts:19` `identifyPayloadSchema`, `:30` `toIdentifyResult` |
| B12 | `PricingProvider` interface with `stub: boolean` and `Promise.allSettled` multi-source run | 005:123-137 | **VERIFIED** | `src/services/pricing.ts:49` `export interface PricingProvider {`; `src/services/pricingService.ts:62` `const settled = await Promise.allSettled(args.providers.map((p) => p.getComps(args.query, shopCtx)));`; `pricing.ts:134` / `ebay.ts:118` / `shopify.ts:90` stub factories |
| B13 | "Suggested price precedence: … real historical-FMV comps when present, else the live-ask median, else … policy floor wins" | 005:138 | **VERIFIED** | `src/services/pricingService.ts:40` `pickDrivingResult`; `:125` `driven_by: driving?.source ?? "policy_floor"`; `tests/pricing-service.test.ts` 8 green |
| B14 | Anthropic default adapter + OpenAI-compatible adapter + `LLM_BASE_URL`/`LLM_API_KEY` gateway override | 005:113-116 | **VERIFIED** | `src/providers/anthropic.ts:23` `/v1/messages`, `:27` `x-api-key`; `src/providers/openaiCompat.ts:24` `/chat/completions`, `:28` `Bearer`; `src/providers/registry.ts:43-92` resolution order with gateway override |
| B15 | "**Static track (CI):** a GCD-ground-truth regression set … job fails on regression below the recorded baseline. Lives in-repo; runs on PR." | 005:151 | **CONTRADICTED — not built** | No eval-set directory, no CI job. This is R19, the single uncovered MUST (A13) | **E07-B01** + **E14-B07** |
| B16 | "**Cost logging:** every adapter call computes cost from usage + a pinned price table and writes it **on `llm_rerank`**" | 005:153 | **VERIFIED with extension** | Both: `llm_rerank` carries `tokens_in/tokens_out/cost_usd` (`001_init.sql:93+`) **and** a separate `cost_log` table exists (`:158`), written by `src/services/identify.ts:120`. 005 does not mention `cost_log` | note the second table in 005 at next edit (§7) |
| B17 | "Deployed on the `intentsolutions` VPS behind Caddy per intent-os ops deploy contracts" | 005:15 | **OPEN — not deployed** | No deploy workflow, Dockerfile, unit file or Caddy snippet (A40). Nothing contradicts the *intent*; it is simply unbuilt | **E13** |
| B18 | "**Testing posture:** `/audit-tests` + `@intentsolutions/audit-harness` install in-repo is a Phase 1 governance item (**pending**, see doc 006)" | 005:162 | **CONTRADICTED — closed** | Installed: `package.json:46` `"@intentsolutions/audit-harness": "^1.3.1"`, `.harness-hash` present, husky pre-commit chain, `harness-verify` blocking in CI. `tests/TESTING.md` and `TEST_AUDIT.md` are the live policy record | correct 005 at next edit (§7) |
| B19 | "migrations + the static eval set + an end-to-end smoke (photo in → DRAFT visible) are the minimum gate for Phase 2 exit" | 005:162 | **OPEN — one of three unmet** | Migrations lane ✓ (`tests/integration/migrations.test.ts`), smoke ✓ (`tests/integration/smoke.http.test.ts`), **static eval set ✗** (B15). Phase 2 exit is therefore not met on 005's own terms | **E07-B01** |
| B20 | Whatnot CSV export "Phase 4, not built in v0" | 005:156-158 | **VERIFIED as stated** | Nothing in `src/`; RTM marks R16 **WON'T** (`tests/RTM.md:48`) — the doc and the artifact agree |

---

## 4. Doc 006 (status) — status prose against artifacts

018 §3 puts 006's narrative at rank 4. These rows apply the "inspected code outranks status prose" rule.

| # | Claim (006) | Source line | State at HEAD | Evidence | Action |
|---|---|---|---|---|---|
| C01 | "Repo created via /repo-dress: `intent-solutions-io/intent-longbox`, private, governance file set + CI scaffold" | 006:32 | **CONTRADICTED (identity)** | `git remote -v` → `jeremylongshore/intent-longbox`. The *event* (repo created under that org) is true history; the line reads as current state | rewrite as history at next edit (§7) |
| C02 | Phase 1 checklist: "`[ ]` /audit-tests + audit-harness install" | 006:37 | **CONTRADICTED — done** | Harness installed (B18); 006's own decision log at `006:81` records the 2026-09-02 re-audit at B+ (84). The checkbox contradicts a row 44 lines below it | tick the box at next edit (§7) |
| C03 | Phase 1 checklist: "`[ ]` Beads epic (plain-English titles) + GH issues per cluster + new Plane project; bd-sync link everything" | 006:36 | **CONTRADICTED in part** | Beads: **done** — 228 records, plain-English titles, `Docs:` lines (A18). GH issues per cluster: partial (#3, #6 exist; 014 §11.3 deliberately forbids leaf fan-out). Plane project **Longbox**: still **OPEN**, and 006 says so itself at `006:53` — which contradicts `006:11` "Plane project LBOX created" | split the checkbox into its three parts at next edit (§7); Plane creation stays a Jeremy action |
| C04 | "### Phases 2 to 4 — **Not started.** Phase 2 (core pipeline v0) begins after Phase 1 governance closes …" | 006:39-41 | **CONTRADICTED (internal)** | `006:11` in the same document says "**v0 core pipeline SHIPPED 2026-09-02 (v0.2.0, PR #4)**", and the code confirms it (§2.2). The heading is a fossil from before Phase 2 landed | rewrite at next edit (§7) |
| C05 | "G0 Truth Lock PASSED (2026-09-03, doc 026) … baseline tag `g0-truth-lock` (935c4f4)" | 006:15 | **VERIFIED** | `git rev-list -n1 g0-truth-lock` → `935c4f4cad714e070b3bb240fdd3bb82e18e4531`; `000-docs/026-…` exists at v1.0.0 |
| C06 | "202 children, 720 blocking edges, 0 cycles … master `longbox-e5b`, 20 epics (E00 `longbox-6om`, E01–E15 `longbox-e5b.1`–`.15`, E16 = `longbox-adk`, E17–E19 `longbox-e5b.16`–`.18`)" | 006:19 | **VERIFIED as of 2026-09-02 / superseded by count** | The graph shape verifies against `.beads/issues.jsonl` and `000-docs/015` (227 aliased rows). The record count has since grown to 228 (A18) as four discovered beads were filed. Edge count not re-counted here — see §9 OPEN-2 | none; count statements are dated |
| C07 | "E00-B01 … doc 016 (**v1.0.0**) … E00-B04 … doc 019 **v1.1.0**" | 006:19 | **CONTRADICTED (stale versions)** | 016 is at **1.0.9**, 019 at **1.2.0** at HEAD. 006's own later decision-log rows (`006:84`) do record the 019 v1.2.0 amendment, so the narrative paragraph is the stale half | correct at next edit (§7) |
| C08 | Phase 0: "200-cover benchmark DROPPED"; "PriceCharting … PENDING Jeremy action"; "GCD dump license CONFIRMED CC BY-SA 4.0" | 006:25-28 | **REPORTED** (unchanged from 016 C21) | All four are off-repo facts (a founder decision, two mailboxes, a licence page). Nothing in the repository can raise or lower them. The *code-side* consequence is verified: PriceCharting runs stubbed (`src/services/pricing.ts:150` `stub = !cfg.token`) | none; E01/E07/E09 consume |
| C09 | "Two discovered beads block the first live batch: `longbox-e5b.2.11` … and `longbox-e5b.5.11` (the phone UI renders confidence percentages)" | 006:17 | **VERIFIED at file:line** | Both beads exist in the mirror with `-D` aliases (A18); the schema gap is A43 and the percentage rendering is A42 |
| C10 | "Test posture re-audited B+ (84): security lane (gitleaks + pnpm audit), SHA-pinned actions, harness verify/escape-scan promoted to blocking, CI integration fail-closed, 44 contract tests" | 006:81 | **VERIFIED, with one substitution** | Security job present and blocking; all `uses:` in `ci.yml` and `release.yml` are 40-hex SHA-pinned; harness promoted (A09); integration fail-closed (A12); 4 contract test files present. **`pnpm audit` was replaced by `osv-scanner`** — `ci.yml:114-115` says so in a comment dated 2026-09-03 (npm registry audit endpoint timeouts) | update the tool name at next edit (§7) |
| C11 | "MiniMax advisory review workflow added (dormant until secret + variable set)" | 006:81 | **VERIFIED as of that date / superseded** | `.github/workflows/minimax-review.yml` exists. A later commit on main (`bd07321`, "record that MiniMax advisory review is live on the repo") reports it now live — that is a REPORTED owner action, not re-verified here | none |

---

## 5. Doc 014 §2.2 — the audited repository gap map at v0.3.0

Nine rows. Because the code tree is unchanged (§0.2), every "current evidence" cell was re-checked directly.

| # | 014 §2.2 "current evidence" cell | State at HEAD | Evidence | Closure bead(s) as written |
|---|---|---|---|---|
| G01 | "Fastify app, multipart up to 25 MB, static `public/` and `uploads/`; `/healthz` returns OK unconditionally" | **VERIFIED**, with the known handling defect | `src/app.ts:17` `fileSize: 25 * 1024 * 1024, files: 1`; `:19` `fastifyStatic`; `:25` unconditional healthz. The oversize-handling contradiction (a 25 MiB+1 upload returns 201 and writes a truncated file) is 016 C2, now covered by `tests/integration/photos.multipart.test.ts` as an `it.fails` | E03-B07, E05-B07, E13-B04/B06 — all still open |
| G02 | "Routes trust path `shopId`; shop listing is broad; `created_by`/`confirmed_by` come from the client" | **VERIFIED** | `scanSessions.ts:37` validates `shopId` as a UUID and nothing more; `:73` `app.get("/api/shops", …)` unauthenticated; `created_by` / `confirmed_by` are body fields defaulting to `'employee'` (`001_init.sql:117` `confirmed_by text NOT NULL DEFAULT 'employee'`) | E02-B03, E03-B02–B04 — open |
| G03 | "Initial schema has shop/session/event/pricing concepts and append-only triggers" (gap: no org/location/user/RBAC/RLS, no stable physical copy, no idempotency/outbox, no full lifecycle) | **VERIFIED both halves** | 13 tables, 9 with triggers (A07). `grep -cE 'ROW LEVEL SECURITY\|CREATE POLICY' migrations/*.sql` → **0**. No `organization`, `location`, `user`, `role`, `physical_item`, `outbox` or `idempotency` table exists | E02-B03–B10, E03-B04, E10-B03/B06–B09 — open |
| G04 | "Mobile web flow supports photo, high one-tap, medium candidate grid and low manual path" | **VERIFIED** | `public/app.js:115` / `:127` / `:145` (A38). Gap half also verified: no login, no offline queue, no batch assignment, no service worker — `public/` is 298 JS + 186 HTML lines with no auth or storage API use | E05-B01–B10 — open; plus **E05-D01** (A42) |
| G05 | "Vision provider returns structured candidates/evidence" (gap: model can propose arbitrary candidates; confidence model-reported; no catalog constraint/calibration) | **VERIFIED** | Evidence contract `src/providers/types.ts:24`; confidence is a pass-through `z.number()` (`src/providers/shared.ts:19`); bands are static env thresholds (`src/config.ts:31-32`); no candidate set is constrained to a catalog because no catalog exists (B07) | E06-B05–B08, E07-B04–B12 — open |
| G06 | "Pricing seam prefers PriceCharting, then eBay asks, then floor; snapshots are append-only" (gap: PriceCharting live fields/token remain TODO) | **VERIFIED** | Precedence B13; `pricing_snapshot` in the trigger array (A07); TODO A37; stub gate `pricing.ts:150` | E09-B01–B10 — open |
| G07 | "Shopify `productSet` DRAFT path exists and fake-success fallback exists" | **VERIFIED** | A25 and A32. The fake-success hazard is real: the stub returns HTTP-200-shaped success with `ok: true` and is selected purely by credential absence | E10-B01–B12, E13-B02 — open |
| G08 | "CI has lint/type/unit/coverage/Postgres integration/smoke" (gap: "**Audit harnesses are advisory**; no browser/mobile E2E, provider certification, security/fuzz, ML drift, load/chaos/cost, restore or delivery gate") | **VERIFIED at 569fa7d / partly CONTRADICTED at HEAD** | Closed since: harness verify + escape-scan blocking (A09); a security job with gitleaks + osv-scanner (A08); contract tests for all four external seams (`tests/contract/`, 4 files); SHA-pinned actions; integration fail-closed (A12). **Still absent**: browser/mobile E2E, fuzz, ML-drift, load/chaos/cost, restore drill, delivery gate, mutation testing | E14-B01–B12, E15-B01–B10 — partly closed, the rest open |
| G09 | "Main `.beads/issues.jsonl` exposes only `longbox-adk`; commit prose suggests additional work; **docs point to an old org**" | **beads half CONTRADICTED (closed); org half VERIFIED (now fixed by this change)** | Beads: 228 records (A18) — closed by E00-B07. Org: at the start of this audit `rg -n "intent-solutions-io"` found **19 occurrences across 6 tracked files outside `000-docs/`** — README ×3, CONTRIBUTING ×7, SUPPORT ×4, CHANGELOG ×2, `.github/FUNDING.yml` ×1, `.github/ISSUE_TEMPLATE/config.yml` ×2. See §8 | E00-B07 (closed), E02-B01 (this bead), E15-B01 |

---

## 6. Register and index drift found while auditing

Not part of 013, but found by the same sweep and covered by the same acceptance criterion ("reconciling the transferred 000-INDEX").

### 6.1 016 §1 version column vs the actual `**Version:**` line at HEAD

| Row | 016 §1 says | Actual at HEAD | State |
|---|---|---|---|
| 000 | 1.4.0 | **1.10.0** | CONTRADICTED (stale) |
| 001 | 1.1.0 | **1.2.0** | CONTRADICTED (stale) |
| 006 | 1.4.0 | **1.11.0** | CONTRADICTED (stale) |
| 007 | "(no Version line)" | **1.1.0** — added 2026-09-03 per 018 C2 | CONTRADICTED (closed defect, register not updated) |
| 008 | "(no Version line)" | still none | **VERIFIED** — the 018 C2 defect is genuinely still open for 008 |
| 014 | 2.0.3 | **2.0.5** | CONTRADICTED (stale) |
| 016 (self) | 1.0.1 | **1.0.9** | CONTRADICTED (stale) |
| 005, 013, 017, 018, 019, 020, 021, 022, 023, 024, 025, 026, 028 | as listed | match | VERIFIED |
| 015 | "227 rows" | CSV has **227 data rows** (228 lines incl. header) | VERIFIED exactly |

016 §1's own preamble anticipates this: rows are pinned "at main `38ff473`". The register is not wrong so much as un-refreshed — but under 018 §2 A1 a stale hash/version column cannot support a REPRODUCED rung, so the rows above are recorded as CONTRADICTED and listed in §7.

### 6.2 000-INDEX (v1.10.0)

| Row | Hook says | Actual at HEAD | State |
|---|---|---|---|
| 013 | "84/100 as designed vs 38/100 today" stated flat | Both numbers are **REPORTED**, not measured (A02) | CONTRADICTED (rung) — the index asserts at a higher rung than the artifact earns, which 018 §6 forbids for docs |
| 013 | "plus … **the first 10 beads to cut**" | Superseded by the 202-bead graph (016 C19) | CONTRADICTED (stale) |
| 014 | "The nationwide execution blueprint (**v2.0.3**)" | 014 is at **2.0.5** | CONTRADICTED (stale) |
| 019 | "**34** signed thresholds" | 019 v1.2.0 added **T35** as non-waivable (019 §9.1; 006:84) — 35 | CONTRADICTED (stale) |
| 015 | "227 rows incl. the discovered bug" | 227 data rows | VERIFIED |
| all others | — | — | VERIFIED |

---

## 7. Docs to correct at the next edit

Nothing below is edited by this addendum: 013 is append-versioned and 018 §4 C2 forbids rewriting prior text. This is the queue for whoever next opens each file.

**013** (all in one revision, bump to v1.1):

1. Header: qualify the pin — "`package.json:3` read `0.2.1` **at 89a6fdd**" (A01).
2. 013:87 — the in-repo grade at the time of filing was **B+ (84/100)**, not A- (90) (A03).
3. 013:346 — "**9** routes" (A21).
4. 013:350 — the DRAFT literal is at `shopify.ts:28` (A22).
5. 013:353 and 013:654 — "**6 blocking jobs plus 1 advisory harness job**" (A08).
6. 013:586 — harness verify + escape-scan are **blocking**; drop "advisory for now" (A09).
7. 013:58, :660 — three workflows, none of them a deploy (A10).
8. 013:407 — repoint the CI citation from `ci.yml:86` to the `integration` job block (A11).
9. 013:649 — the lane asserts on the **nine** triggered relations, not seven (A17).
10. 013:654 — **162 unit tests / 21 files** at the next re-audit's own pin (A04).
11. 013:661, :821 — R19 is `tests/RTM.md:30`; the TEST_AUDIT gap is `TEST_AUDIT.md:29` (A13).
12. 013:668, :877 — R3 is `tests/RTM.md:14` (A14).
13. 013:919 — R14 is a **covered MUST**; the WON'T requirement is R16 (A15).
14. 013:669, :987 — the mirror holds **228** records (A18).
15. 013:671 — mutation testing still absent; harness gates no longer advisory (A16).
16. 013:372, :727 — repository is `jeremylongshore/intent-longbox` (A19, A19b).

**005** (bump to v1.2.0): B01 (drop "session-cookie auth", state that no auth exists and name E03), B02 (path prefix `/api/shops/:shopId/…` and add the two `GET`s), B06 (`confirmed_issue jsonb`, FK deferred to E04), B10 (note `shop_pricing_policy` is deliberately outside the trigger set), B16 (name `cost_log`), B18 (harness is **installed**; TESTING.md is the live policy).

**006** (bump to v1.12.0): C01 (rewrite the repo line as history and name the current remote), C02 (tick the harness box), C03 (split the tri-part checkbox; Plane project stays open and reconcile with 006:11), C04 (rewrite "Phases 2 to 4 — Not started"), C07 (016 → 1.0.9, 019 → 1.2.0), C10 (`osv-scanner`, not `pnpm audit`).

**016** (bump): refresh the §1 version column for rows 000, 001, 006, 007, 014, 016 and re-pin the hash baseline (§6.1). Row 008 stays as-is — the missing `Version:` line is real.

**000-INDEX** (bumped by this change to v1.11.0 for the 027 row): the four drifted hooks in §6.2 are queued for the same pass — 013's scores need an "author-assessed, unmeasured" qualifier, 014 → v2.0.5, 019 → 35 thresholds, and the "first 10 beads" phrase retires.

**TEST_AUDIT.md**: line 16's "all 7 event tables" should read nine (A17); the gap list at lines 27–38 predates PR #9 and should be marked closed for gaps 1, 2, 5, 6, 7, 8 and 10.

**tests/TESTING.md**: line 11's applicable-layers list omits L4-contract and L5-security, both now installed; line 50's `p1_gaps` still names four gaps closed in the same commit range; line 52's `measured: unit 118/118` is now 162/162. This file is hash-pinned — any edit must be followed by `pnpm exec audit-harness init` (018 §5).

---

## 8. Identity repair landed with this audit

`rg -n "intent-solutions-io"` at the pinned commit found 19 occurrences in tracked files outside `000-docs/`. All are plain prose or URLs and were corrected to `jeremylongshore` in this change:

| File | Occurrences | What |
|---|---|---|
| `README.md` | 3 | CI badge, Release badge (`:6`, `:7`), author link (`:54`) |
| `CONTRIBUTING.md` | 7 | clone URL, issue/PR/discussion links |
| `SUPPORT.md` | 4 | issue and discussion links |
| `CHANGELOG.md` | 2 | `[Unreleased]` and `[0.1.0]` compare/tag link refs |
| `.github/FUNDING.yml` | 1 | `custom:` URL — was `https://intent-solutions-io.com/support`, a domain that has never existed (the real one is `intentsolutions.io`) |
| `.github/ISSUE_TEMPLATE/config.yml` | 2 | SECURITY.md and Discussions links |

**Deliberately not touched:**

- `000-docs/016` §1 row 064 and §5 C18, and `000-docs/021` §row 095 — these **record** the old org as a finding. Editing them would erase the audit trail (018 §4 C1).
- `000-docs/006:32`, `000-docs/008:14`, `:104`, `000-docs/013:372`, `:727`, `000-docs/014:266` — historical statements or claims this addendum has now formally contradicted; they are queued in §7 for their owning doc's next revision, not rewritten here.
- `CLAUDE.md:7` — already correct; it names the current repo and explains the transfer.
- `.beads/issues.jsonl` — the bead mirror. Four bead records quote GitHub issue URLs under the old org — seven occurrences across `longbox-adk`, `longbox-adk.1`, `longbox-e5b.15.1` and this audit's own bead `longbox-e5b.2.1` (corrected in v1.0.1; v1.0.0 said three). Rewriting them would be a `bd` write outside this bead's scope and would rewrite Dolt history; **E15-B01** `longbox-e5b.15.1` owns the bead-note and GitHub-issue-body half of the cleanup.
- GitHub issue bodies #3 and #6 — out of scope by instruction; **E15-B01**.
- `.beads/config.yaml` — already corrected under E00-B07 (023 §6).

E15-B01's remaining scope after this change is therefore: bead notes, GitHub issue bodies #3/#6, CODEOWNERS, branch protection, and the bead↔PR linkage rule.

---

## 9. What this audit could not verify — OPEN items

| # | Item | Why it is OPEN | Who closes it |
|---|---|---|---|
| OPEN-1 | The integration lane (`pnpm test:integration`) was **not run** | Not run because the diff is docs and identity strings only and `src/migrations/scripts/public` are byte-identical to the last CI-tested commit; Postgres was available (`docker-compose.test.yml`) and simply not started — a choice, not an impossibility (v1.0.1 correction); the lane skips cleanly without one (`tests/integration/helpers.ts:23`). Migration idempotency, trigger rejection and the scan-session flow are therefore **TESTED per the last CI run, not re-TESTED here**. `pnpm lint`, `pnpm typecheck` and `pnpm test` (162/162) were run and are green at HEAD | any run of the E14 lane |
| ~~OPEN-2~~ CONTRADICTED (v1.0.1) | 014 §0's "**720 blocking edges**, 0 dangling targets, 0 cycles" | Recomputed from the JSONL `dependencies` key at HEAD: **722 blocking edges**, 227 parent-child, 0 dangling, 0 cycles — 014 §0 is stale by the four discovered beads (benign) | 014 §0 at next edit |
| ~~OPEN-3~~ VERIFIED absent (v1.0.1) → **RESOLVED (v1.0.2)** | Branch protection on `main` | `gh api repos/jeremylongshore/intent-longbox/branches/main/protection` → 404 "Branch not protected" — confirmed absent, not unknowable. **Resolution line, appended 2026-09-03 (029 PR, E02-B02): branch protection on main set 2026-09-03 (6 required checks, linear history).** The 404 finding above stands as the state at audit time `46d9910` and is not rewritten; this line records the later change. | E15-B01 |
| OPEN-4 | Plane project **Longbox**, and the GitHub issue bodies for #3/#6 | Off-repo surfaces; 006:53 lists both as pending | Jeremy; **E15-B01** |
| ~~OPEN-5~~ VERIFIED (v1.0.1) | Dependabot PRs #10–#17 (016 §4) | `gh pr list` → all eight still open; `.github/dependabot.yml` declares `github-actions` **and** `npm` (the `pip` misconfiguration TEST_AUDIT gap 1 named is fixed) | **E15-B03/B04** |
| ~~OPEN-6~~ VERIFIED (v1.0.1) | Whether the MiniMax advisory review is actually live | `gh variable list` → `ENABLE_MINIMAX_REVIEW=true`; `gh secret list` → `MINIMAX_API_KEY` set; both review lanes posted on PRs #25–#28 | — |
| OPEN-7 | Live behaviour of PriceCharting, eBay, Shopify and the LLM providers | Every external client degrades to a stub when credentials are empty, and all credentials are empty (A34). **Stub success is never evidence** (018 §2 A3) — the contract tests assert request/response *shape* against fixtures, not the live services | E09-B03, E10-B02, E14-B05 |

---

## 10. Rows added to 016 §5

This audit appends **C27–C36** to the 016 source register (append-only; no existing row is edited). They are the code-anchored subset of the findings above — the register keeps the claims, this addendum keeps the reasoning.

---

## 11. Verification of this change

| Gate | Command | Result |
|---|---|---|
| Lint | `pnpm lint` | pass (eslint, exit 0) |
| Types | `pnpm typecheck` | pass (`tsc --noEmit -p tsconfig.check.json`) |
| Unit | `pnpm test` | **162 passed / 162, 21 files** |
| Integration | not run | OPEN-1 |

This change touches documentation and repository-identity prose only — no file under `src/`, `migrations/`, `scripts/`, `public/` or `tests/` was modified, so the three gates above prove non-regression rather than new behaviour.

**Change log:** 1.0.1 (2026-09-03) — gate audit: §1 reworded (23 = headline, not total); §8 bead-mirror count 3→4 records / 7 occurrences; §9 OPEN-1 reason corrected, OPEN-2/3/5/6 resolved with commands (722 edges; main unprotected; #10–#17 open; MiniMax live).
