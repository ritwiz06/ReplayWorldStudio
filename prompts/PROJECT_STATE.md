# Project state

## How to use this file

This is the canonical live project state. It was reconciled against the actual repository on 2026-10-09; keep it current at the end of every session. Source code and recorded checks establish what exists. This file indexes that evidence and does not prove it.

If a maintained project-status file is later created elsewhere, put its exact relative path here and make that file canonical; do not duplicate changing progress in both places.

## Canonical memory locations

- Live project state: this file.
- Decisions: prompts/DECISIONS.md.
- Session history: prompts/SESSION_LOG.md.
- Backlog status: prompts/BACKLOG.md.
- Environment and toolchain record: docs/environment.md.
- Contract conventions: docs/contracts.md. Learning notes: docs/learning/.

## Stable context

- Product: AI-assisted platform for realistic, editable worlds from drawings, photos, videos and specifications.
- First application: factory production-area planning (one small area, ~5-20 equipment instances, one process family).
- Broad platform scope (photo/video, physics, engineering, aging, teams) remains on the roadmap; see EXPANSION_ROADMAP.md.
- Previous HTML concept and planning PDF: not present in this repository; not required.

## Current state (last verified 2026-10-09, America/Phoenix)

| Field | Value |
| --- | --- |
| Active milestone | M0 complete (local evidence). Next: M1, starting with WRL-01. |
| Git / branch / commit | **No Git repository exists.** The directory had no `.git`; `git init` was not run (ADR-012). No branch, commits or remotes. |
| Implemented capabilities | Contracts v0.1.0 (Pydantic source → JSON Schema → TS types + Ajv); FastAPI `/health`, `/api/v1/fixtures/foundation`, `/api/v1/projects/validate` (loopback, CORS allow-list); React/Vite editor shell with R3F orbit viewport, object list, evidence inspector, API health, scene-file check; synthetic foundation fixture plus three invalid samples. |
| Not implemented | Catalog assets, realistic scene, walk/top cameras, editing, undo, persistence, DXF/PDF import, spatial checks, simulation, AI. |
| Latest passing checks | 2026-10-09: `pnpm check` exit 0 (contracts up to date; ESLint and Ruff clean; tsc and mypy strict clean; Vitest 19 passed; pytest 48 passed; build OK); `pnpm test:e2e` 4 passed. Repeated in a clean copy installed with `uv sync --locked` and `pnpm install --frozen-lockfile` (local caches reused). |
| Not yet run | The GitHub Actions workflow has never executed: there is no repository or remote. |
| Run commands | Repo root: `uv sync --locked`, `pnpm install --frozen-lockfile`, `pnpm dev:api`, `pnpm dev:web`, `pnpm check`, `pnpm test:e2e:install` (once), `pnpm test:e2e`. See README.md. |
| Known blockers | None for M1 local work. Committing, CI and history need the user to create or choose a Git repository. |
| Known limitations | Web bundle 1.34 MB (372 kB gzip), unprofiled. R3F 9.8.1 triggers a `THREE.Clock` deprecation warning. One provenance origin per dimension box, not per axis. Ajv cannot check unique IDs or uncertainty ordering; the API does. |
| Next issue | WRL-01 - define world and asset records (catalog asset reference, asset provenance/license, per-axis dimension provenance decision, stable-ID round-trip). Decide the Git repository question first if possible. |

## Milestone status

| Gate | Status | Evidence |
| --- | --- | --- |
| M0 | Complete (local) | SET-01/02/03 evidence in BACKLOG.md; session 2026-10-09 in SESSION_LOG.md. CI defined but not yet executed remotely. |
| M1 | Not started | - |
| M2 | Not started | - |
| M3 | Not started | - |
| M4 | Not started | - |
| M5 | Not started | - |
| M6 | Not started | - |

## Information still to confirm when relevant

- **Git repository:** initialise locally or clone an existing remote? (Needed before commits and CI.)
- Available weekly time; permissioned sample drawing; machine dimensions and operating data; model provider and data-routing preference; repository license and visibility; engineering reviewer.
- Reference workstation recorded in docs/environment.md (Apple M3 Pro, 18 GiB, macOS 26.6.2). Graphics performance has not been measured yet (WRL-04).

## End-of-session update

Record active gate, completed issue IDs, remaining items, exact verification evidence, changed decisions, reproduction commands and the next executable action. An unchecked assumption must remain explicit.
