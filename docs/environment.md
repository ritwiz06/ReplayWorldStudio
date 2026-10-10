# Environment and repository record (SET-01)

Recorded 2026-10-09 (America/Phoenix) by the M0 session. Re-record when the reference workstation or toolchain changes.

## Repository state found

| Item | Observed |
| --- | --- |
| Directory | `ReplayWorldStudio/` containing only `prompts/` (18 Markdown context files) and a `.DS_Store` |
| Git | At the M0 session (2026-10-09) this was **not a Git repository**, and `git init` was deliberately not run (ADR-012). The user then created the repository: branch `main`, remote `origin` = https://github.com/ritwiz06/ReplayWorldStudio. |
| Existing application code, dependency files, docs, CI | None |
| Earlier HTML concept / planning PDF | Not present (optional references; not needed) |

## Reference workstation

| Item | Value |
| --- | --- |
| OS | macOS 26.6.2 (build 25G83), Darwin 25.6.0 |
| CPU / architecture | Apple M3 Pro, arm64 |
| Memory | 18 GiB |
| GPU | Apple M3 Pro integrated, 18 cores, Metal 4 (unified memory; no separate VRAM) |
| Display | 3024 × 1964 Retina |
| Browsers installed | Google Chrome, Firefox, Safari, Brave; Playwright headless Chromium build 1248 (installed this session) |

## Toolchain

| Tool | Version | Source |
| --- | --- | --- |
| Node.js | 22.23.1 | pinned in `.node-version` |
| pnpm | 11.11.0 (pinned); 11.12.0 installed globally | pinned in `package.json` `packageManager`; the global pnpm switches to the pin automatically |
| uv | 0.12.18 | `pyproject.toml` requires ≥ 0.12 |
| Python | 3.14.7 (Homebrew) | `.python-version` = 3.14 |
| Docker | 29.8.0 | available, not used |
| git / gh | 2.55.0 / 2.100.0 | available; no repository or remote configured |

## Locked dependencies (direct)

Full trees are locked in `pnpm-lock.yaml` and `uv.lock`. Direct versions are exact in each manifest.

| Area | Packages |
| --- | --- |
| Web runtime | react 19.3.0, react-dom 19.3.0, three 0.186.1, @react-three/fiber 9.8.1, @react-three/drei 10.7.9, ajv 8.20.0 |
| Web tooling | vite 8.3.4, @vitejs/plugin-react 6.1.2, typescript 6.0.3, vitest 5.0.3, @playwright/test 1.64.0, eslint 10.12.0, typescript-eslint 8.71.1, json-schema-to-typescript 16.0.0 |
| Python runtime | pydantic 2.14.0, fastapi 0.143.0, uvicorn 0.54.0 (starlette 1.7.0 transitively) |
| Python tooling | pytest 9.1.1, httpx2 2.13.1, ruff 0.17.0, mypy 2.4.0 |
| CI actions | actions/checkout@v7, pnpm/action-setup@v6, actions/setup-node@v7, astral-sh/setup-uv@v10 |

## Compatibility notes

- **pnpm 11.12.0 is a broken upstream release** (`ERR_PNPM_BROKEN_PNPM_RELEASE`: its `@pnpm/exe` build shipped without a binary; npm marks it deprecated). `pnpm/action-setup` refused to install it in CI, so the project pins **11.11.0**. Upstream recommends 11.13.1 or newer; moving forward is a separate, deliberate bump.
- **`astral-sh/setup-uv` publishes no floating major tag**: `@v10` cannot be resolved; the workflow pins `@v10.3.0`.

- **TypeScript 7.0.2** (the native compiler) was the newest release, but typescript-eslint 8.71.1 supports `typescript >=4.8.4 <6.1.0`. TypeScript is pinned to **6.0.3** (ADR-011).
- **Starlette 1.7** deprecates `httpx` for its test client in favour of `httpx2`; the dev group uses `httpx2`.
- **Ajv** rejects Pydantic's OpenAPI-style `discriminator.mapping` and wants `type: "object"` beside `discriminator`; the schema exporter normalises this (see docs/contracts.md).
- **Three.js 0.186** logs a deprecation for `THREE.Clock`, which React Three Fiber 9.8.1 still uses internally. Harmless; revisit when R3F updates.
- **Bundle size:** the production web bundle is 1.34 MB (372 kB gzip), dominated by three/drei/R3F. Vite warns above 500 kB. Not addressed in M0; profile under WRL-04.
