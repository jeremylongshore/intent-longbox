# Decision Record — G0 Truth Lock: sign-off and baseline snapshot

**Version:** 1.0.0
**Status:** SIGNED 2026-09-03 — by the acting head of board (Claude, parent session) under Jeremy Longshore's delegation of 2026-09-03 ("this is an autonomous build without human"); Jeremy may revise by a 006 decision-log row
**Bead:** E00-B08 `longbox-9ad` (epic E00 `longbox-6om`, gate G0) — see 000-docs/014 §8 row E00-B08 and §5 (G0 = "Product success contract, evidence rules, claims policy, pain register")
**Audited:** `longbox-gate-auditor` + `longbox-invariant-reviewer` before close (bead metadata)
**Sensitivity:** Restricted internal (014 §10)

## 1. Decision

G0 Truth Lock is **passed**. The governance baseline below is approved as the truth every later doc, bead, claim and pilot analysis is measured against (018 §6). This authorizes **decomposition and Phase 1 work (E01 discovery, E02 domain) — not production deployment, not a live item** (014 E00-B08 note; 019 §3.0 prerequisites and the eight safety controls still gate the first live item).

## 2. What G0 required, and where it is met

| G0 criterion (014 §5) | Artifact (version at `g0-truth-lock`; 016 becomes 1.0.8 when this record lands) | State |
|---|---|---|
| Source register | 016 v1.0.7 (E00-B01, closed) | VERIFIED |
| Pain / outcome register | 017 v1.0.1 (E00-B02, closed) | VERIFIED |
| Evidence rules | 018 v1.1.0 RATIFIED (E00-B03, closed) | RATIFIED |
| Product success contract | 019 v1.2.0 RATIFIED + 020 council record (E00-B04, closed) | RATIFIED; 35 thresholds, 10 non-waivable |
| Claims policy | 021 v1.1.1 (E00-B05, closed) | gate-audited READY |
| People principles | 022 v1.1.1 RATIFIED + 025 council record (E00-B06, closed) | RATIFIED |
| Work governance | 023 v1.0.1 + 8 formulas (E00-B07, closed) | gate-audited READY |

All seven predecessor beads are CLOSED with `bd-sync close` evidence quoting their audit verdicts (bead notes; 023 §5 close rule).

## 3. Restorable baseline manifest

| Component | Identifier |
|---|---|
| Git tag | `g0-truth-lock` → `935c4f4cad714e070b3bb240fdd3bb82e18e4531` (main; squash-merge of PR #22), pushed to `origin` |
| Dolt backup | `bd backup sync` 2026-09-04T00:30:23Z, Dolt commit `iesd0g53aeavhtaka8e0ei5d38rsjcvk`, destination `.beads/backup/` (restore: 023 §6 drill) |
| Bead graph at the tag | 228 records (1 master, 20 epics, 202 blueprint leaves, 4 discovered, 1 pre-blueprint); 7 closed (E00-B01…B07); JSONL sha256 `56d08eb405f9` (`git show g0-truth-lock:.beads/issues.jsonl`) |
| Doc hashes at the tag (sha256, first 12) | 015 `2ca5ac184a8a` · 016 `63798ff51ee0` · 017 `201e40758d64` · 018 `078ecba433dd` · 019 `7e7c03a3aeab` · 020 `b79c45ddcdfd` · 021 `a3b5c6c68470` · 022 `052047addfb6` · 023 `96092e7ccbcb` · 024 `26adecea12e4` · 025 `3fc43f9a9b2e` |
| Code baseline | application code unchanged since `1ed9ffb` (v0.3.x); every "today" cell in 024 and 016 §5 refers to it |

Restore procedure: `git checkout g0-truth-lock` for docs; for the work graph, 023 §6 (`bd init --prefix longbox` in a fresh clone, `bd backup restore <backup dir> --force`), or `bd import .beads/issues.jsonl` from the tag as the portable fallback.

## 4. What G0 does not assert

- No threshold in 019 is met; every value is a signed decision (019 §3 header). Nothing is PILOT-MEASURED.
- Two discovered beads block the first live batch: `longbox-e5b.2.11` (schema slots) and `longbox-e5b.5.11` (UI percentages). The public `uploads/` mount and the seven other safety controls (019 §3.0) are open.
- Owner actions outstanding (006): Plane project + DoltHub remote; CI secrets/variables; branch protection.

## 5. Sign-off

| Field | Value |
|---|---|
| Decision | G0 Truth Lock PASSED; baseline snapshot per §3 |
| Signed by | Claude, acting head of board, under Jeremy Longshore's 2026-09-03 delegation |
| Date | 2026-09-03 |
| Unblocks | E01 (`longbox-e5b.1`) discovery and E02 (`longbox-e5b.2`) domain work; first E02 work is `longbox-e5b.2.11` |
| Jeremy's revision right | standing; a 006 row may reopen G0 |
| Recorded in | 006 status ("G0 passed") and decision log; bead `longbox-9ad` close reason quotes this block; epic `longbox-6om` closes on it |
