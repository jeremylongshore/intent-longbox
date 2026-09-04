# Longbox Beads Configuration, Routing and Evidence Closure

**Version:** 1.0.1
**Bead:** E00-B07 `longbox-5ev` (epic E00 `longbox-6om`, gate G0) — see 000-docs/014 §8
**Filed:** 2026-09-03 · **Owner:** parent session · **Audited:** `longbox-gate-auditor` before close
**Sensitivity:** Restricted internal (014 §10) — tooling detail; nothing here is a claim about the product.
**Governed by:** CLAUDE.md §Governance (task tracking), 014 §11.3 (routing), 014 §13 (Definition of Done), 018 (evidence rules), 016 (register), ~/.claude/skills/beads (bd conventions), estate bead-naming rule (plain English, alias never in the title).

## 0. What this standard fixes

The work system has to be as trustworthy as the product it tracks. This document is the one place that says how a Longbox bead is named, aliased, typed, labeled, routed, worked through a formula, closed with evidence, backed up and restored. Everything below is VERIFIED against the working tree on 2026-09-03 (`bd` 1.1.2, embedded Dolt) unless marked otherwise.

## 1. Store, hooks and configuration (verified)

| Item | Value | How verified |
|---|---|---|
| Store | embedded Dolt at `.beads/embeddeddolt/`, `dolt.local-only: true`, one writer (the parent session) | `.beads/config.yaml`; `bd config get dolt.auto-commit` = `on` |
| JSONL mirror | `.beads/issues.jsonl`, `export.interval: 1s`; **an explicit `bd export -o .beads/issues.jsonl` follows every state-changing write** (rapid-write rule in ~/.claude/skills/beads) | config + session practice |
| Git hooks | pre-commit, post-merge, pre-push, post-checkout, prepare-commit-msg — all installed via `core.hooksPath=.beads/hooks` (local config, re-run `bd hooks install` in any fresh clone) | `bd hooks list` |
| Backup | filesystem Dolt backup at `.beads/backup/`, `bd backup sync` every 15 min (enabled=true); last backup and Dolt commit visible in `bd backup status` | `bd backup status` |
| `bd doctor` | **not supported in embedded mode** (bd 1.1.2 prints the embedded-mode troubleshooting note); health = `bd hooks list` + `bd backup status` + `bd stats` | run 2026-09-03 |
| Sync remote | `sync.remote` in `config.yaml` is corrected to `git+https://github.com/jeremylongshore/intent-longbox.git` (was the pre-transfer org, 016 C18); unused while `dolt.local-only: true` | this bead |

## 2. Identity: title, alias, metadata

- **Title** = one plain-English imperative sentence (estate rule since 2026-05-22). The blueprint alias (`E05-B04`) and the system ID (`longbox-e5b.5.4`) **never appear in the title**.
- **Alias** lives in metadata `lbox.alias` and on the description's first line (`Alias: E05-B04 under LBOX-E05`). `000-docs/015` is the alias ↔ ID map (CSV, one row per bead; **227 rows** after this bead: 225 blueprint-era rows (incl. `E03-B07-D1`, `E13-B04-D1`) + `E05-D01` + `E02-D01`).
- **Discovered work** (found by a cannon, council, audit or pilot) gets a `-D` alias under the epic it belongs to (`E02-D01`) or under the bead it refines (`E03-B07-D1`), a `Discovered from <alias/bead>` line in the description, and a 015 row with the annotation `discovered-from …`. Blueprint numbering (`-B`) is never reused for discovered work.
- **Metadata keys** (every blueprint and discovered bead): `lbox.alias`, `lbox.epic` (`LBOX-E00`…), `lbox.evidence` (014 §13 class: `DOC` / `DECISION` / `TEST` / `PILOT`), `lbox.agent.build` and `lbox.agent.audit` (014 §22; agents in `.claude/agents/`), plus `blueprint_doc` / `blueprint_version` on materialized rows.
- **Types:** `epic` for E00–E19 and the master; `feature` for a cluster with its own GH issue; `task` for a bead; `bug` for a discovered defect; **`decision` for a DEC row** (bd 1.1.2 supports it — 39 such beads, e.g. `longbox-cu1` E00-B06), always carrying `lbox.evidence=DECISION` and delivering an `NNN-AT-DECR` record ratified per the council process (019/020, 022/025 are the precedents). 015's type column reconciles: 165 task / 39 decision / 21 epic / 2 bug.
- **Labels:** the gate (`G0`…`G5`), the phase (`P0-govern`…), the layer (`delivery`, `domain`, `mobile`, …) and `lbox`. No `epic:N` / `type:X` labels.
- **Pre-blueprint beads** (`longbox-adk.1`) keep their original titles and carry no alias; do not retrofit.

## 3. Routing (014 §11.3) — what mirrors where

| Layer | Holds | Rule |
|---|---|---|
| **Beads** (source of truth) | every unit of work, every note, every close with evidence | all writes; `bd-sync note` / `bd-sync close` for anything mirrored |
| **GitHub** (`jeremylongshore/intent-longbox`, private) | code, PRs, CI; **one issue per logical cluster** (an epic or a feature), never one per task bead; selected gate beads | `bd-sync link <bead> --gh jeremylongshore/intent-longbox#N`; PRs say `Refs #N` while children remain, `Closes #N` only on the PR retiring the last child |
| **Plane** (project **Longbox**, not CCE) | portfolio-level epics only (E00–E19 + the master) | `bd-sync link … --plane LONGBOX-N`; created when the Plane project exists (006 open item) |

Do **not** fan every bead into GitHub or Plane. A task bead's audit trail is its bead notes; the cluster issue carries the roll-up via `bd-sync note` on close.

## 4. Formulas (`.beads/formulas/*.formula.toml`, `bd formula list` shows 8)

| Formula | Pour when | Steps |
|---|---|---|
| `longbox-feature` | any blueprint bead is started | orient → design → implement (as the 014 §22 builder) → cross-reference → invariant review → close |
| `longbox-provider` | a provider is onboarded or certified (E04-B07/B10) | terms → manifest → fixtures → certify → review |
| `longbox-vertical-pack` | a new collectible vertical (gated by E19-B06) | gate → identity schema / capture recipe / condition schema → eval pack → register |
| `longbox-migration` | any schema change | expand → backfill → verify → rollback rehearsal → contract |
| `longbox-release` | a version ships | checks → staging journey → progressive rollout → rollback drill → record |
| `longbox-pilot-batch` | Pilot A / B / C | manifest → prerequisites (019 §3.0, T33) → run → report (N + Wilson bounds) → triage → gate audit |
| `longbox-partner-onboarding` | a partner | mode → disclosure (021) → terms → adapter → metering → gate |
| `longbox-offboarding` | a shop or partner leaves | export → revoke → delete (tombstone + `media_deletion`) → evidence |

Usage: `bd mol pour longbox-feature --var bead_alias=E05-B04 --var builder=longbox-mobile-builder`. Each poured molecule's steps are child beads of the target bead; they inherit its labels; the parent closes only after the `close` step. Formulas are versioned in the TOML (`version = 1`); bump on any step change and note it here.

## 5. Evidence closure (014 §13 + 018)

A Longbox bead closes only via **`bd-sync close <id> -r "<evidence>"`** (never raw `bd close` for a mirrored bead; raw `bd close` is acceptable only for unmirrored task beads and is still followed by `bd export`). The close reason must name, in this order:

1. **The artifact**: doc number + version (`022 v1.1.0`), or commit SHA + test run for code, or the batch id for pilot evidence.
2. **The rung reached** (018 A1): ASSERTED / SOURCED / REPRODUCED / TESTED / PILOT-MEASURED — never above what the artifact supports.
3. **The audit verdict**, quoted: `longbox-gate-auditor` for gate/decision beads, `longbox-invariant-reviewer` for code beads (`READY` / `PASS`; a `NOT-READY` is fixed before close, never closed over).
4. **Where it is cross-referenced**: 000-INDEX row, 016 row, 006 status/decision-log row, 015 row for new beads.

Mid-flight milestones and decisions go in as `bd-sync note` at the time they happen — a silent-open-silent-close bead is an audit hole. Discovered work is filed as a bead with `Discovered from` before the parent closes.

## 6. Backup, restore and `bd ready` — validated 2026-09-03

| Check | Result |
|---|---|
| `bd backup sync` | ok; `.beads/backup/` holds Dolt `.darc` archives; status reports the last backup and Dolt commit |
| Restore drill | fresh scratch dir → `git init` → `bd init --prefix longbox` → `bd backup restore <repo>/.beads/backup --force` → **"Restore complete"**, 228 issues listed (matching the live DB at drill time; a restore run between backup syncs can list fewer), `bd show longbox-cu1` resolves, `bd ready` works. The drill directory is discarded; it never touches the live DB |
| `bd ready` | returns the two ready epics (E00 and the master) with 219 blocked behind the 722-edge `blocks` graph (plus 227 parent-child edges), as designed |
| 015 reconciliation | 015 rows = JSONL rows carrying `lbox.alias` (227 = 227; JSONL total 228); the one unaliased bead is the pre-blueprint `longbox-adk.1` (§2) |
| Off-machine copy | the Dolt history lives only on this box (embedded, git-ignored); the JSONL mirror is in git. A DoltHub remote (`bd dolt push`) is the estate route for cross-machine history and is **not configured** — 006 open item, not a G0 blocker |

## 7. Per-environment checklist (fresh clone)

`bd hooks install` → `bd hooks list` (5 installed) → `bd config get dolt.auto-commit` (= on) → `bd config get export.interval` (= 1s) → `bd formula list` (8) → `bd backup status`. After any `git reset --hard`: `bd import .beads/issues.jsonl` then verify counts.

## 8. Maintenance

**Change log:** 1.0.1 (2026-09-03) — gate audit: `decision` is a real bd type (B1); restore/blocked/edge counts refreshed (B2).

### 8.1 Rules

Bump this doc on any change to formulas, routing, metadata keys or the close rule; the E00-B08 G0 snapshot records the Dolt backup id and git tag this standard was validated against.
