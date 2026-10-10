# Execute Phase 0 - repository foundation

You are working in my existing initialized Git repository in VS Code. Build only Phase 0 of Replay World Studio using the Markdown context in prompts/. Factory planning is the first complete use case of a broader platform for editable simulated worlds from drawings, photos and videos.

Read existing repository instructions and the latest user request first. Inspect the branch, git status, remotes, current code and documentation. Preserve existing changes. Do not rerun git init, replace remotes, overwrite a working application, delete unrelated files, push, publish, deploy or create GitHub resources. If this is an existing application, integrate a compatible isolated module rather than scaffolding over it. Do not claim unavailable checks passed.

Read the self-contained context files in this repository:
- prompts/PROJECT_CONTEXT.md
- prompts/DEVELOPMENT_RULES.md
- prompts/PROJECT_STATE.md and any canonical live state file it selects
- prompts/ARCHITECTURE.md
- prompts/MILESTONES.md
- prompts/BACKLOG.md
- prompts/VALIDATION.md

Use the current repository as evidence of implementation. If a verified foundation already exists, do not recreate it: complete only missing M0 criteria. If M0 is already complete, report its evidence and follow START_HERE.md to select the next gate unless the user specifically requested a Phase 0 review. The earlier PDF and planning kit are optional references, not required inputs.

Scope for this session: SET-01, SET-02, SET-03. Continue autonomously until Phase 0 is concrete and verified, then stop at that gate.

1. Record environment and integration decisions.
- Inspect OS, architecture, Node/package manager, Python/environment manager and available GPU information using ordinary local tools.
- Record the existing repository structure and any compatibility issues. Do not require a GPU for Phase 0.
- Select supported stable dependencies, verify official setup documentation if needed, and commit reproducible lockfiles to the proposed changes. Do not leave package versions floating.
- Prefer pnpm and uv when available. Use compatible existing project tooling if that avoids unnecessary disruption. Do not install system-wide tooling or download large models without a concrete need.

2. Establish project documents.
- Preserve the broader platform scope; factory layout is the first application.
- Add or merge README and setup instructions. Select canonical state, decisions, backlog and session log locations using prompts/PROJECT_STATE.md; preserve existing live records and avoid duplicate progress histories.
- State what is implemented versus planned. Keep all backlog items planned until their acceptance evidence exists.
- Record proposed working directories: apps/web, services/api, packages/contracts, assets/catalog, fixtures, scripts, docs and .github/workflows. Adapt these to the existing repo when appropriate.
- Add appropriate ignore rules for credentials, model weights, local project data, customer drawings, run outputs and generated caches. Add .env.example containing names/defaults only, with no real secrets.
- Do not add a public license by assumption or change repository visibility.

3. Build the smallest real application foundation.
- Web: React + TypeScript + Vite unless the existing application already supplies a suitable equivalent. Establish a clean, restrained editor shell with a large workspace, project name, scene-loading status and a backend health indicator.
- 3D: Add React Three Fiber / Three.js and a minimal dimensioned scene fixture. The fixture may use basic geometry to prove coordinate and schema correctness, but label it as a foundation fixture. Do not present it as the final realistic factory UI or finished product.
- Backend: FastAPI + Pydantic, with GET /health and a schema-validated fixture endpoint or equivalent. Bind locally by default and keep CORS limited to intended development origins.
- Contracts: define a minimal versioned Project/Scene/Object/Parameter model with stable IDs, metres/seconds/kilograms/radians, a right-handed Y-up world, explicit source-to-world transform and property provenance. Unknown values stay unknown. Reject invalid dimensions and non-finite coordinates.
- Choose one schema source of truth and generate frontend types or validate against generated JSON Schema. Avoid manually duplicated incompatible interfaces.
- The browser loads the fixture from the backend and shows its units and evidence status. Keep network and parsing errors visible and recoverable.

4. Establish reproducible commands and verification.
- Provide documented commands for dependency install, web dev server, API dev server, build, type checks and meaningful tests. Record exact working directories and supported runtime versions.
- Add one schema/round-trip check and one API validation check because incorrect units and types are central project risks.
- Add a browser smoke path verifying application load, backend health and fixture display if a browser runner is available; otherwise record the missing capability and an exact manual check.
- Add a CI workflow that installs locked dependencies and runs build/type/schema/API checks. Keep it minimal. Do not modify remote repository settings.
- Avoid implementing tests that only mirror styling or internal code. Verify actual behaviours and error cases.

5. Complete the handoff.
- Run the available checks and inspect the app visually if possible.
- Update the canonical project state and session log selected in prompts/PROJECT_STATE.md with actual outcomes, changed decisions, limitations and the next issue. Preserve any newer records.
- Report changed files, exact run commands, verification outcomes, any remaining blockers and the M1 starting task.
- Do not implement full CAD ingestion, production simulation, autonomous layout optimization, AI integration, advanced physics, cloud authentication, or enterprise collaboration in Phase 0.
- Do not hide a mock as a real AI/model integration. No model service is required in this phase.

Phase 0 is complete only when a fresh documented setup can run the typed web/API foundation, load a valid dimensioned fixture, reject invalid input, pass the available required checks, and accurately record unfinished work. The goal is a stable starting point for the visually realistic world editor, not a premature claim of a working factory simulator.
