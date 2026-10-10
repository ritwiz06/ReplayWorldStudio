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
| Active milestone | M1 in progress: WRL-01 done (2026-10-10); next issue WRL-02. |
| Git / branch / commit | Branch `main`, tracking `origin` = https://github.com/ritwiz06/ReplayWorldStudio. M0 CI gate closed at `28ebce7`; WRL-01 implemented in `a3b1328`. |
| Implemented capabilities | Contracts **v0.2.0** (Pydantic source → JSON Schema → TS types + Ajv): per-axis dimension evidence, catalog assets with explicit source and rights, validated asset references, explicit 0.1.0 → 0.2.0 migration and CLI. FastAPI `/health`, `/api/v1/fixtures/foundation`, `/api/v1/projects/validate` (one actionable message for older schema versions; loopback; CORS allow-list). React/Vite editor shell with R3F orbit viewport, object list, inspector showing per-axis evidence and asset identity and rights, API health, scene-file check. Synthetic fixture plus four invalid samples and one legacy 0.1.0 sample. |
| Not implemented | glTF/catalog visuals and a realistic scene, walk/top cameras (WRL-02), editing and undo, persistence (WRL-03), performance profiling (WRL-04), DXF/PDF import, spatial checks, simulation, AI. |
| Latest passing checks | GitHub Actions run https://github.com/ritwiz06/ReplayWorldStudio/actions/runs/38023211602 on `a3b1328` (2026-10-10 UTC): success (contracts up to date, lint, types, Vitest 10 + 17, pytest 97, build). Local on the same tree: `pnpm check` exit 0; `pnpm test:e2e` 4 passed (Playwright is not part of CI). |
| CI history | Run 38021553918 (`511b04e`) failed: `astral-sh/setup-uv@v10` has no floating major tag (fixed by the user in `f173510`). Run 38022020880 (`f173510`) failed: pnpm 11.12.0 is a broken upstream release. Run 38022453114 (`28ebce7`, pnpm pinned to 11.11.0) passed. Runs 38022707956 (`d26f00f`, records) and 38023211602 (`a3b1328`, WRL-01) passed. |
| Run commands | Repo root: `uv sync --locked`, `pnpm install --frozen-lockfile`, `pnpm dev:api`, `pnpm dev:web`, `pnpm check`, `pnpm test:e2e:install` (once), `pnpm test:e2e`; upgrade an old file with `uv run python -m replay_world_contracts.migrate OLD.json -o NEW.json`. See README.md. |
| Known blockers | None. |
| Known limitations | Placeholder boxes only, with no glTF visual type yet. Dimensions are always known values (unknown axes deferred to M2, ADR-015). The license check covers SPDX identifier *syntax*, not membership of the SPDX list. The browser (Ajv) cannot check unique IDs, reference resolution or cross-field rules; the API does. Web bundle 1.34 MB (372 kB gzip), unprofiled. R3F logs a `THREE.Clock` deprecation. CI does not run Playwright. `ubuntu-latest` moves to Ubuntu 26 from 2026-10-19. |
| Next issue | WRL-02 - build the industrial scene and cameras: walk, top and orbit views and coherent lighting with dimensioned catalog assets. This includes adding the glTF visual type to the contract alongside a loader that actually renders it. |

## Milestone status

| Gate | Status | Evidence |
| --- | --- | --- |
| M0 | Complete | SET-01/02/03 evidence in BACKLOG.md. CI run https://github.com/ritwiz06/ReplayWorldStudio/actions/runs/38022453114 passed on `28ebce7`. |
| M1 | In progress | WRL-01 done (`a3b1328`, CI https://github.com/ritwiz06/ReplayWorldStudio/actions/runs/38023211602). WRL-02, WRL-03 and WRL-04 remain. |
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
