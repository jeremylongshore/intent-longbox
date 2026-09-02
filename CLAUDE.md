# CLAUDE.md

## Project Overview

**intent-longbox** — Photo-to-listing pipeline for comic shops: snap a cover, identify the book, price it, draft the Shopify listing

- **Language**: node
- **Repo**: https://github.com/intent-solutions-io/intent-longbox
- **License**: Apache-2.0

## Task Tracking with Beads (bd)

**Beads provides post-compaction recovery.** Run `/beads` at session start.

**Workflow:** `bd update <id> --status in_progress` → work → `bd close <id> --reason "evidence"`

Key commands: `bd prime` (LLM context), `bd ready`, `bd list --status in_progress`, `bd doctor`

## Build & Test

<!-- Add project-specific build commands here -->

## Project Structure

```
intent-longbox/
├── 000-docs/           # Enterprise documentation (doc-filing v4)
├── .github/            # CI/CD, issue templates, PR template
├── CLAUDE.md           # This file
├── CONTRIBUTING.md     # Contribution guidelines
├── SECURITY.md         # Security policy
└── README.md           # Project overview
```

## Conventions

- Commit messages: `<type>(<scope>): <subject>`
- Branch naming: `feature/`, `fix/`, `docs/`
- PR workflow: feature branch → PR → review → merge
- Doc filing: `000-docs/` with v4 naming convention
