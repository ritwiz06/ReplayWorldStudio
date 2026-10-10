# Language assistance and generated objects (GEN-01)

What the description assistant and language edits do, how the key and data are handled, what was verified against the live provider, and what generated models can and cannot represent. Decisions: ADR-031 to ADR-035 in [prompts/DECISIONS.md](../prompts/DECISIONS.md). Contract details: [docs/contracts.md](contracts.md#generated-objects-050-gen-01).

## The path from words to a placed object

```mermaid
flowchart LR
  U["User's words"] --> API["Local API"]
  API -->|"description only"| V["ASU Voyager\n(qwen3-235b-a22b-instruct-2507)"]
  V -->|"JSON (schema-guided)"| API
  API -->|"schema check, retry once;\nstated values found in the words;\nestimates follow the parts;\nunknowns added"| P["Typed proposal"]
  P --> B["Browser review:\nconfirm estimated sizes"]
  B -->|"reviewed specification"| G["API generator\n(data only, deterministic)"]
  G -->|"generated/<sha256>.glb"| L["Catalog library"]
  B -->|"add_generated_instance\n(one undo step)"| W["Project"]
  L -->|"hash + bounds verified"| W
```

An edit request follows the same shape. The API returns a typed **intent** (move or turn one object, with direction, distance and unit as written). The browser turns it into an exact `set_transform` command and dry-runs it with the command engine against the request's revision. The user sees the before and after values, and **Apply** runs the same command.

## Setup and data handling

- **Key:** `VOYAGER_API_KEY` in the git-ignored `.env` at the repository root, or in the API process's environment. Only the API reads it (`services/api/src/replay_world_api/settings.py` takes only `RWS_*`/`VOYAGER_*` names from `.env`). It is held in a field excluded from `repr`, sent only as an `Authorization: Bearer` header to `VOYAGER_BASE_URL`, and never logged or returned (`GET /api/v1/assist/status` names the service and model, never the key). Vite exposes only `VITE_*` names to the browser. Checked on 2026-10-10: a production build and every tracked or new file in the repository were searched for the key value and none contained it, and `.env` is not tracked.
- **Model:** `VOYAGER_MODEL` (default `qwen3-235b-a22b-instruct-2507`, the exact ID); endpoint `VOYAGER_BASE_URL` (default `https://openai.rc.asu.edu/v1`).
- **What is sent:**
  - for a description, the description text and fixed instructions;
  - for an edit, the request plus each object's ID, name, kind, position, yaw and size, and the selected ID.

  Nothing else from the project is sent. The UI says where the text goes before you send it.
- **No key:** `GET /api/v1/assist/status` reports `off`. Describing and language edits are disabled with that message, and the **object builder** and the whole editor keep working.
- **Offline tests:** `RWS_ASSIST_PROVIDER=recorded` replays real answers saved in `fixtures/assist/recorded/`. Everything it produces is labelled `recorded` ("recorded offline test answer (not live AI)") and it never calls the network. The browser test suite and pytest use it; CI never calls Voyager.

## Trust rules

| Rule | Where | Why |
| --- | --- | --- |
| The model proposes **data** (a bounded geometry specification), never code. Our generator builds the model. | `assist/answers.py`, `objects/` | Model text cannot execute anything; the same specification always gives the same bytes. |
| Every answer must match the schema exactly (unknown fields refused), with one retry that lists the problems; otherwise an error, never a guess. | `assist/proposals.py`, `assist/edits.py` | A malformed answer is not repaired by guessing. |
| A dimension marked **stated** must appear in the user's words with its unit (`2.2 m`, `2200 mm`, `7 ft`, `1.2 x 0.8 m`, `half a metre`); otherwise it becomes an estimate to confirm. | `assist/lengths.py` | The model may claim the user said something they did not. |
| An **estimated** dimension follows the extent of the model's own parts. | `assist/proposals.py` | Avoids stretching the parts to a second, inconsistent guess. |
| Every estimate must be confirmed (or replaced) before placement; the API refuses an unconfirmed one. | `generated_assets.py`, UI | The user decides the sizes that matter. |
| Mass, strength, chemical composition and operating behaviour are **always unknown**; mentioned masses or rates are listed as *not modelled*. | contract `AssetGeneration` | A picture establishes none of them. |
| Edits: the target must be in the scene; "the selected …" must fit the selection; words that fit several objects get a question; the distance (with unit), angle and direction must appear in the request. | `assist/edits.py` | Ask instead of guessing. |
| Every edit is resolved and dry-run by the existing command engine (revision, limits, contract) before it is shown; a refusal leaves the project unchanged. | `apps/web/src/assist/editIntent.ts` | One validation path for every edit (ADR-023). |

## What generated models can and cannot represent

**Can:**

- recognisable equipment and furniture made of up to 40 axis-aligned solids: boxes and rounded boxes, cylinders along X/Y/Z (elliptical when needed), upright frustums and cones, and spheres or ellipsoids;
- 30 PBR appearances (paints, metals, plastics, glass, rubber, wood, concrete, screens, signal lamps);
- exact metre-scale bounds equal to the confirmed size, with a bottom-centre origin and front +Z;
- deterministic GLB files of a few hundred to a few thousand triangles, pinned by sha256, which a project can rebuild from its own record.

**Cannot:**

- slanted, rotated or curved parts other than the shapes above (no tilted screens, chutes, arcs or fillets beyond a small edge rounding);
- hollow shells or openings (a "guard" is a solid panel, which can be translucent);
- textures, labels or text;
- articulated or moving parts;
- interior mechanisms;
- vendor accuracy.

Its appearance depends on the language model's spatial layout (see the results below). It carries **no** mass, strength, material composition, temperature, speed or behaviour, and it is never a basis for a load, clearance-compliance or operating claim. It is labelled *generated, provisional* in the catalog and inspector.

## What was verified against the live provider (2026-10-10)

All requests were synthetic and nonsensitive. They went to `https://openai.rc.asu.edu/v1` with the key from the local `.env`, which is never printed.

**Authentication and catalog.** `GET /v1/models` returned 53 models, including `qwen3-235b-a22b-instruct-2507` and `qwen3-vl-32b-instruct` (the IMG-01 candidate, not yet tested on images). The response's `system_fingerprint` shows a vLLM 0.26.0 server.

**Structured-output modes**, probed with a tiny "a table 1.5 m wide" prompt and a two-field schema:

| Mode | Latency | Result |
| --- | --- | --- |
| No `response_format` | 0.9 s | JSON, but with its own field names and the width as the string "1.5 m" |
| `json_object` | 2.9 s | JSON, its own field names (`width`, not `width_m`) |
| `json_schema` (strict) | 1.0 s | exactly the schema |
| Forced tool call | 1.7 s | exactly the schema, in `tool_calls` |

**Cost of guidance on a real proposal** (one conveyor description, about 1,500 output tokens): no `response_format` 71.7 s, `json_object` 81.1 s, `json_schema` 82.8 s, all valid. Latency comes from output length, at about 18–21 tokens/s, not from schema guidance.

**Evaluation runs** (`scripts/evaluate_assist.py`, temperature 0). The cases are 7 descriptions and 9 edit requests:

- **descriptions:** conveyor, tank, workbench, pallet rack, a press with a mass and a rate, one vague and one hostile;
- **edit requests:** a selected move, an ambiguous name, a selection mismatch, a named move in mm, a turn, a missing distance, a colour change, 2 km, and a hostile instruction.

Reports are in [docs/assist-evaluation/](assist-evaluation/); the answers recorded for offline tests are in `fixtures/assist/recorded/`.

| Prompt | Variant | Objects as expected | Objects first answer valid | Object latency (median) | Edits as expected | Edits first answer valid | Edit latency (median) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| gen-01.2 | guided | 7/7 | 7/7 | 59.2 s | 8/9 ¹ | 9/9 | 6.1 s |
| gen-01.3 | guided | 6/7 ² | 6/6 answered | 64.2 s | 9/9 | 9/9 | 6.1 s |
| gen-01.3 | **unguided** | 7/7 | 7/7 | 59.8 s | **0/9** ³ | **0/9** | - |
| gen-01.5 (shipped) | guided | 7/7 | 7/7 | 59.5 s (max 84.9 s) | 9/9 | 9/9 | 8.8 s |

1. "2 km": the unit list had no `km`, so the model answered `2` `m` and quoted "2 km". The grounding check found no "2 m" in the request and asked how far instead. `km` was then added; the editor now refuses the 2 km move itself (±1000 m limit).
2. The press proposal took longer than the 90 s timeout; the timeout is now 150 s.
3. Without schema guidance, every edit answer invented its own field names, and the retry did not fix them. Object answers stayed valid because the object prompt contains a complete example. **Valid structure came from schema-guided decoding plus our validation, not from a capability badge.**

The changes between prompt versions were made because of what these runs showed:

- an estimated size now follows the model's own parts (one proposal's depth disagreed with its parts by 35 %);
- "selected" in the words refers to the selection;
- equipment sits at a typical working height on legs or a frame (one conveyor came back 0.3 m tall);
- every part must give an axis (cylinders came back without one);
- a stated *length* on the depth axis is turned to run along X.

**Run-to-run variation.** Answers are not reproducible even at temperature 0. Three repeats of the conveyor description gave heights of 0.875–1.0 m, depths of 0.70–0.86 m and 5–6 parts. The timed runs below produced different conveyors again, one with an opaque guard enclosing the belt. The deterministic checks keep each answer honest: the stated length is kept, estimates are marked, and stretching is reported. They cannot make the layout good. **Generated objects are provisional, and the user is asked to check every estimate.**

**Edit outcomes with `gen-01.5`.** All edit outcomes were as expected:

- "move the selected cabinet 1 metre left" became left, 1 m, on `obj-cabinet-1`;
- "move the cabinet 1 m left" asked which of Control cabinet 1, Control cabinet 2 or the cabinet access zone was meant;
- the selected-conveyor case asked, naming the selection;
- "500 mm forward" and "90 degrees clockwise" were understood as written;
- "move it left a bit" asked how far;
- colours and the hostile instruction were refused;
- "2 km" was understood as 2 km, and the editor then refused it with "Position X must be within ±1000 m", leaving the project unchanged.

## Timed tasks (observations, not a usability study)

`apps/web/scripts/assist/tasks.ts` drives the real app (local dev servers, live Voyager, headless Chromium at 1440 × 900) the way a first-time user would, with no time spent reading or deciding. Every click, typed entry or key press counts as one step. Final run, prompt `gen-01.5`:

| Task | Steps | Total | Of which waiting for the model |
| --- | --- | --- | --- |
| First visit → describe "a guarded conveyor about 2.2 m long with a control screen" → confirm estimates → place | 6 | 75.2 s | 71.5 s |
| First visit → describe a water tank → correct the estimated width → confirm → place | 8 | 65.2 s | 58.1 s |
| First visit → describe a workbench → confirm → place | 6 | 75.2 s | 67.8 s |
| Select a cabinet → "move the selected cabinet 1 metre left" → review → apply | 4 | 7.5 s | 6.5 s |
| "move the cabinet 1 m left" → question shown | 2 | 12.0 s | 8.5 s |
| Build a cabinet by hand → change its height → place (no model) | 6 | 6.8 s | 0 s |

An earlier full run with prompt `gen-01.4` took 59.2 / 67.2 / 68.9 / 12.6 / 6.4 / 6.9 s for the same tasks. Almost all of the time is the language model's answer. The rest is reading time a script does not have. These numbers describe this software on one machine. They say nothing about how quickly people complete the task, and there is **no claim of an advantage over Revit or any other tool**; that needs a study with real users (QA-01).

## Screenshots

From the final timed run (`docs/gen-01/`, downscaled):

| | |
| --- | --- |
| ![Start panel](gen-01/start-panel.jpg) Guided start: three working choices, image import shown as coming next | ![Conveyor proposal](gen-01/conveyor-review.jpg) The conveyor proposal: the stated length is quoted; the estimated height and depth wait for confirmation |
| ![Tank proposal](gen-01/tank-review.jpg) A tank from "1.5 m tall …": a different shape, different materials | ![Workbench proposal](gen-01/workbench-review.jpg) A workbench with the drawer unit and monitor the user mentioned highlighted |
| ![Conveyor placed](gen-01/conveyor-placed.jpg) Placed: the inspector shows provisional status and per-axis evidence | ![Language move](gen-01/language-move-proposal.jpg) A language edit shows the exact change before Apply |
| ![Ambiguous](gen-01/language-ambiguous.jpg) An ambiguous request becomes a question | ![Builder](gen-01/builder.jpg) The object builder, without any language model |

## Offline and CI testing

- **pytest:**
  - `test_assist.py`: a scripted provider covers every grounding, retry, clarification and evidence rule and the HTTP boundary, including restoring a missing model;
  - `test_assist_recorded.py`: the recorded live answers are replayed through the whole pipeline (three descriptions → three different, valid models; vague and hostile inputs are refused; all edit outcomes), and **pinned sha256 values** show that the generator builds the same bytes on macOS and Linux;
  - `test_object_generator.py`: the generator itself.
- **Vitest:** edit resolution, the review state, templates and the `add_generated_instance` command.
- **Playwright** (`e2e/creation.spec.ts`, using the recorded provider): the full first-visit journey with undo, save, reopen, deleting the model and rebuilding it; the other start choices; the builder with the assistant off; language edits including ambiguity and refusal.
- **CI never calls Voyager.**

## Limits and next steps

- A proposal takes about 50–85 s with this model. A smaller model (for example `qwen3-30b-a3b-instruct-2507`) may be much faster; GEN-03 should compare models on a larger held-out set.
- Layout quality varies from run to run. GEN-02 (correcting a placed generated object) and GEN-03 (evaluation with human review of visual plausibility) address this.
- Only move and turn edits are supported, one object at a time. Directions are plan axes, not relative to the camera.
- IMG-01 (one image to an editable world) is next. `qwen3-vl-32b-instruct` is the candidate, to be tested on real images first. Voyager's image- and video-generation models are not image-to-3D services and are not treated as such.
