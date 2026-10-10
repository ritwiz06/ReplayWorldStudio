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
| Active milestone | M0 complete, including CI. M1 active; next issue WRL-01. |
| Git / branch / commit | Branch `main`, tracking `origin` = https://github.com/ritwiz06/ReplayWorldStudio (created by the user after the M0 session). M0 CI gate closed at commit `28ebce7`. |
| Implemented capabilities | Contracts v0.1.0 (Pydantic source → JSON Schema → TS types + Ajv); FastAPI `/health`, `/api/v1/fixtures/foundation`, `/api/v1/projects/validate` (loopback, CORS allow-list); React/Vite editor shell with R3F orbit viewport, object list, evidence inspector, API health, scene-file check; synthetic foundation fixture plus three invalid samples. |
| Not implemented | Catalog assets, realistic scene, walk/top cameras, editing, undo, persistence, DXF/PDF import, spatial checks, simulation, AI. |
| Latest passing checks | GitHub Actions run 38022453114 on `28ebce7` (2026-10-10 UTC): success. Ubuntu 24.04, pnpm 11.11.0, Python 3.14.7; contracts up to date, lint, types, Vitest 7 + 12, pytest 48, build. Local: `pnpm check` exit 0 and `pnpm test:e2e` 4 passed (2026-10-09). |
| CI history | Run 38021553918 (`511b04e`) failed: `astral-sh/setup-uv@v10` has no floating major tag (fixed by the user in `f173510`). Run 38022020880 (`f173510`) failed: pnpm 11.12.0 is a broken upstream release. Run 38022453114 (`28ebce7`, pnpm pinned to 11.11.0) passed. |
| Run commands | Repo root: `uv sync --locked`, `pnpm install --frozen-lockfile`, `pnpm dev:api`, `pnpm dev:web`, `pnpm check`, `pnpm test:e2e:install` (once), `pnpm test:e2e`. See README.md. |
| Known blockers | None. |
| Known limitations | Web bundle 1.34 MB (372 kB gzip), unprofiled. R3F 9.8.1 triggers a `THREE.Clock` deprecation warning. One provenance origin per dimension box, not per axis. Ajv cannot check unique IDs or uncertainty ordering; the API does. |
| Next issue | WRL-01 - define world and asset records (catalog asset reference, asset provenance/license, per-axis dimension provenance, stable-ID round-trip). |

## Milestone status

| Gate | Status | Evidence |
| --- | --- | --- |
| M0 | Complete | SET-01/02/03 evidence in BACKLOG.md. CI run https://github.com/ritwiz06/ReplayWorldStudio/actions/runs/38022453114 passed on `28ebce7`. |
| M1 | Not started | - |
| M2 | Not started | - |
| M3 | Not started | - |
| M4 | Not started | - |
| M5 | Not started | - |
| M6 | Not started | - |

## Information still to confirm when relevant

- Available weekly time; permissioned sample drawing; machine dimensions and operating data; model provider and data-routing preference; repository license and visibility; engineering reviewer.
- Reference workstation recorded in docs/environment.md (Apple M3 Pro, 18 GiB, macOS 26.6.2). Graphics performance has not been measured yet (WRL-04).

## End-of-session update

Record active gate, completed issue IDs, remaining items, exact verification evidence, changed decisions, reproduction commands and the next executable action. An unchecked assumption must remain explicit.
