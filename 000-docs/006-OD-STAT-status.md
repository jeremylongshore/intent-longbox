# Status: intent-longbox

**Version:** 2.0.0

**Last Updated:** 2026-09-15

This document restarted at 2.0.0 when the repository became public. Versions up to 1.85.1, and their decision-log rows, are retained privately. The architecture gate (`scripts/architectureRules.ts`, `DECISION_LOG_FILE`) requires a PR that edits both identity functions to add a row to the decision log below.

## Current state

- **Rollout:** Longbox is rolled out at its first shop, Gotham City Limit in Jacksonville, Florida. It runs on that shop's own system.
- **Repository:** public since 2026-09-15. Its history was cleaned of commercial and pilot-relationship material before publication.
- **Code:** package version 0.4.0, latest tag v0.5.0, schema migrations through `038`.

## Epic state, as the code and ratified records show it

| Epic | Area | State |
| --- | --- | --- |
| E00 | Truth lock and evidence rules | G0 signed (026); evidence rules ratified (018) |
| E02 | Domain contracts | Decision records 029 to 043 ratified; migration discipline standard 044 enforced by `pnpm arch` and `pnpm depcruise` in CI |
| E03 | Security and tenancy | Row-level security (056), sessions and second factor (048, 057), permissions (054), secret vaulting (050), connector OAuth (053), self-service credentials (063), webhook replay and privacy workflows (064) ratified and implemented |
| E04 | Catalog identity | LCID namespace (047), card and comic identity schemas (049, 052), vertical pack manifest (051) ratified and implemented |

Work on the remaining epics is tracked in beads, not summarized here.

## Decision Log

| Date | Decision | Rationale |
| --- | --- | --- |
| 2026-09-15 | Make the repository public, with history cleaned of commercial and pilot-relationship material. Supersedes locked decision 1 ("Private repo. Stays private."). | Owner decision. |
| 2026-09-15 | Keep bead data (`.beads/issues.jsonl`, `.beads/interactions.jsonl`) out of the repository and stop chaining the beads pre-commit hook from husky. | The hook re-exports the bead data on every commit; the Dolt store stays the record. |
| 2026-09-15 | Restart this status document at 2.0.0 and retain earlier versions privately. | Earlier versions carried pilot-relationship material. |
