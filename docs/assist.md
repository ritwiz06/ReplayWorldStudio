# Language assistance and generated objects (GEN-01 to GEN-04)

What the description assistant, language edits and model revisions do, how the key and data are handled, what was verified against the live provider, and what generated models can and cannot represent. Decisions: ADR-031 to ADR-035 and ADR-039 to ADR-043 in [prompts/DECISIONS.md](../prompts/DECISIONS.md). Contract details: [docs/contracts.md](contracts.md#generated-objects-050-gen-01) and [revised generated objects](contracts.md#revised-generated-objects-070-gen-02). Improving a placed model: [below](#improving-a-placed-generated-model-gen-02). Held-out evaluation and the model choice: [below](#held-out-evaluation-gen-03).

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
- **Vision model (IMG-01):** `VOYAGER_VISION_MODEL` (default `qwen3-vl-32b-instruct`) proposes the objects in a photo, through the same endpoint and key. It receives a downscaled JPEG copy without metadata, only when the user chooses **Analyse**. What it is trusted with, the live results and the known failures are in [docs/image-import.md](image-import.md).
- **What is sent:**
  - for a description, the description text and fixed instructions;
  - for an edit, the request plus each object's ID, name, kind, position, yaw and size, and the selected ID;
  - for a model revision (GEN-02), the instruction plus the object's name and its current specification (overall size and part list); no photo and nothing else from the scene.

  Nothing else from the project is sent. The UI says where the text goes before you send it.
- **No key:** `GET /api/v1/assist/status` reports `off`. Describing, language edits and proposed model changes are disabled with that message (`POST /api/v1/assist/model-revisions` answers 503), and the **object builder**, changing a model by hand and the whole editor keep working.
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
| Revisions: the size is kept unless the instruction mentions a size or length; an "open" request whose proposal keeps one part filling ≥ 50 % of the object is retried once, then refused; an identical proposal is refused; a colour is never offered for a material property; a mixed request becomes a partial proposal and a request with nothing drawable is refused, both listing what is not shown in the user's words (never invented, never imitated); an already-satisfied request changes nothing; more than 40 parts is an explicit limitation; a part buried at the end of a larger one is separated. | `assist/revisions.py` | A proposal must not misrepresent the object (ADR-041, ADR-043). |
| A revision is a new asset; a dimension that did not change keeps its value and evidence exactly; a proposed size must be confirmed. | `generated_assets.py` | A colour or part change is not a measurement (ADR-039, ADR-040). |

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
- **Playwright** (`e2e/creation.spec.ts`, using the recorded provider): the full first-visit journey with undo, save, reopen, deleting the model and rebuilding it; the other start choices; the builder with the assistant off; language edits including ambiguity and refusal. `e2e/improve.spec.ts` (GEN-02): improving a described object by hand for two instances (one with a measured width), and a photo-made object with a recorded proposal; see [below](#improving-a-placed-generated-model-gen-02).
- **CI never calls Voyager.**

## Limits and next steps

- A proposal takes about 50–85 s with this model. GEN-03 compared it with the smaller `qwen3-30b-a3b-instruct-2507` on a held-out set: the smaller model was 3–5 times faster but failed four quality gates, so the default is unchanged ([below](#held-out-evaluation-gen-03)).
- Layout quality varies from run to run. GEN-02 (2026-10-15) lets the user correct a placed generated object in words or by hand. GEN-03 (2026-10-15) evaluated descriptions, edits and revisions on a held-out set with a blind visual review; revisions still miss two gates (GEN-04).
- Only move and turn edits are supported, one object at a time. Directions are plan axes, not relative to the camera.
- IMG-01 (one image to an editable world) was implemented on 2026-10-14 with `qwen3-vl-32b-instruct`; see [docs/image-import.md](image-import.md). Voyager's image- and video-generation models are not image-to-3D services and are not treated as such.

## Improving a placed generated model (GEN-02)

**Improve model…** in the inspector (for any object whose asset is generated: described, builder or photo) reopens the exact recorded specification. The dialog shows the current version, rebuilt from its specification (the same sha256 as the stored file), next to the proposed one. The user can:

- **ask for a change** in words: **Propose the change** sends the instruction and this model's part list (no photo, no scene) to `qwen3-235b-a22b-instruct-2507` through the local API, with elapsed time and **Cancel**;
- **change it by hand**, without any language model: a colour per material group, the overall width, height and depth (the parts scale with them), or the full part list (change, add or remove parts);
- review the **Changes** in plain words; a proposed size change must be confirmed;
- choose **Only <object>** or **All N objects that use <asset>**, with the exact effect on each object and axis;
- **Apply**: the API builds the revision as a new asset (a failed build changes nothing), and one revision-checked `revise_asset` command switches the chosen objects. One undo reverts it.

Versions, the edit record and the evidence rules are in [docs/contracts.md](contracts.md#revised-generated-objects-070-gen-02).

```mermaid
flowchart LR
  I["Instruction"] --> API["Local API"]
  S["Current part list"] --> API
  API -->|"instruction + part list only"| V["ASU Voyager\n(qwen3-235b-a22b-instruct-2507)"]
  V -->|"changes only: remove, change, add, repeat\n(schema-guided)"| API
  API -->|"schema check, retry once; part limit;\nrepair and fit; size kept unless asked;\noverlaps separated; openness guard;\nlimitations grounded in the instruction"| P["Proposal, partial proposal,\nunsupported or already satisfied\n(nothing built)"]
  P --> B["Dialog: compare, adjust by hand,\nconfirm sizes, choose objects"]
  B -->|"Apply"| G["API: new asset\ngenerated/<sha256>.glb"]
  G -->|"revise_asset (one undo step)"| W["Project"]
```

**Prompt `gen-04.3`** (`assist/prompts.py`, `REVISION_SYSTEM`; GEN-04, ADR-043) asks for **changes only**: parts to `remove`, `change` (same id, every field restated), `add`, and `repeat` (one part copied in a row or grid by counts and step, for bins, slats, shelves or posts). Parts it does not mention are kept exactly, so unrelated parts cannot drift and the answer stays short. It chooses one of three outcomes:

- `revision`, doing every drawable part of the request and listing the rest in `not_representable`;
- `unsupported`, when nothing in the request is drawable;
- `already_satisfied`, when the current model already shows the request.

The prompt also does the following:

- It keeps the overall size unless asked, and asks for thin panels and slender posts.
- It models open structures as separate panels with real empty space, replacing a solid body by putting its id in `remove`.
- It never changes a colour to suggest a property such as fireproof or soundproof, and never draws a cosmetic shape as if it were a working hinge, wheel or mechanism.
- It writes each limitation in the user's own words.
- It asks for at most 24 entries and at most 40 parts in all.

Text in the instruction that is not about changing this object is ignored. (GEN-02 used prompt `gen-02.2`, which asked for the complete revised parts list.)

**Deterministic checks** (`assist/revisions.py`), applied after schema validation:

| Check | Effect |
| --- | --- |
| A change or removal names a part that does not exist | Invalid answer, one retry with the problem listed. |
| The changes would need more than 40 parts (after expanding `repeat`) | `unsupported` with "This change would need N parts; the generator draws at most 40. Nothing was changed…". Parts are never cut silently. |
| The instruction has no length and no size word ("bigger", "taller", "width", …) | The overall size is kept ("Size kept: the instruction did not ask for a different size."); parts reaching outside it are fitted back in, and the fit says so. |
| Overlap separation | A box part that covers the whole end of a larger box part shortens the larger one, so they meet instead of overlapping (a red top inside a blue body). Other parts inside another that share its faces are reported, not moved. |
| An "open" request (open, hollow, without doors, cage, shelves, …) whose proposal still has one part filling ≥ 50 % of the overall box | The model is told which part fills how much and asked once more to remove it. If the second answer is still solid, it is refused as `unsupported` and nothing changes. |
| The proposal builds the same geometry as the current model | Refused ("The proposal does not change the model."). |
| A request only for material properties (fireproof, soundproof, waterproof, …) answered by a colour or material change alone | Refused: a colour would merely suggest the property. |
| The model lists a limitation that shares no word with the instruction | Dropped, with a check note: the list cannot contain requests the user never made. |
| The instruction asks for movement or operation (hinged, sliding, motorised, "that opens", "actually rolls", …), material properties, curved, slanted or rotated surfaces, holes or perforations, or textures or printing, and the model did not list it | Added to the not-represented list, quoting the user's clause and the reason. |

**The dialog** shows the three outcomes before anything can be applied:

- A **partial proposal** says "Partial: only the part the shape generator can draw is shown below. Not shown, and not imitated:", followed by the list in the user's words. Apply reads **Apply the drawable part to this object**. The app's own notes (size kept, fitting) are listed apart under "What the app checked or adjusted".
- **Unsupported** gives the reason, "Nothing was changed.", and the same list. Apply stays disabled.
- **Already satisfied** says "Already shown: … Nothing was changed." and creates no new version.

When the revision is applied, the API also refuses a model identical to the current one and checks how each overall dimension was settled (kept, entered or proposed and confirmed).

### Live results (2026-10-15)

`uv run python scripts/evaluate_model_revisions.py [CASES] [--record]` runs the cases in `scripts/model_revision_cases.json` against Voyager and writes docs/assist-evaluation/<prompt version>.json; `--record` refreshes `fixtures/assist/recorded/revision-*.json`. These four are development cases, not a held-out set (GEN-03).

| Prompt | Case | Latency | Parts | Largest part's share of the envelope | Result |
| --- | --- | --- | --- | --- | --- |
| gen-02.1 | cabinet → "a bookshelf with open shelves instead of a solid cabinet" | 67.5 s | 2 → 9 | 0.947 → 0.048 | Separate sides, back, top, bottom and shelves, but shelves 0.1 m thick. |
| gen-02.1 | "paint it blue and add a red top" | 39.8 s | 2 → 3 | 0.947 → 0.947 | The red top overlapped the body. |
| gen-02.2 | open bookshelf | 75.9 s | 2 → 9 | 0.947 → 0.047 | Shelves 0.02 m; top and bottom boards still 0.1 m. |
| gen-02.2 | blue with a red top | 36.9 s | 2 → 3 | 0.947 → 0.947 | Still overlapped; now trimmed by overlap separation. |
| gen-02.2 | photo pallet: "make this a wooden pallet with cardboard boxes stacked on top of it instead of one solid block" | 29.4 s | 1 → 3 | 1.0 → 0.117 | A pallet base and two cartons; size kept. |
| gen-02.2 | photo machine guard, long instruction | > 150 s | - | - | Timed out. |
| gen-02.2 | photo machine guard, shorter instruction ("add a yellow safety guard above the white lower cabinet: four yellow corner posts with clear panels between them; …") | 106.2 s | 4 → 12 | 0.809 → 0.74 | Four yellow posts and four clear panels around the machine; the grey body kept its full height. |

Every successful answer was schema-valid on the first attempt.

**Live browser demonstration** (2026-10-15, dev servers, the user's key; the factory photo analysis replayed from its recording, the two revisions live): the pallet proposal took 42.3 s (a wooden pallet with 4 cardboard boxes) and the machine proposal 110.4 s; the machine body was then recoloured white by hand ("then adjusted by you"). Both were applied (scene revision 2), saved and reopened "accepted by API" with models 7/7 verified. The pallet became clearly more recognisable. The machine improved only modestly: the photo shows a white lower cabinet with a yellow guard above it, and the proposal put posts and clear panels around a full-height body instead. Screenshots: [docs/image-import.md](image-import.md#improving-photo-made-objects-gen-02).

**Recorded (offline) results.** `fixtures/assist/recorded/revision-*.json` hold the live answers and are replayed in pytest (`test_assist_recorded.py`) and in `e2e/improve.spec.ts`, labelled not live AI; their latencies are not measurements.

**What a revision still cannot show:** an opening within a single part (open structures only from separate panels); slanted or curved surfaces beyond cylinders, frustums and spheres; rotated parts; hinges, doors or moving parts; textures, labels or wire mesh (clear panels stand in for guards; mesh or perforation is reported, not imitated); photo textures. Panel proportions depend on the model. Fitting the parts to the overall size can rescale them slightly, which the change list reports as "resized or moved".

## Held-out evaluation (GEN-03)

Full report: [docs/assist-evaluation/gen-03/report.md](assist-evaluation/gen-03/report.md); criteria, cases and run commands in the same folder. Evaluation rules: ADR-042.

- **Set and run.** 32 descriptions, 31 edits on a new packing-room scene and 22 revisions of 16 models (9 made from photos), frozen with pre-registered gates in `435095a` before any run. One live run on 2026-10-15 (66.5 min, 170 requests) through the API endpoints, sequential, the two models alternating per case. Live results only; a blind visual review with the key opened after scoring.
- **Models.** Baseline `qwen3-235b-a22b-instruct-2507` (the default) and candidate `qwen3-30b-a3b-instruct-2507`, with the same prompts (`gen-01.5`, `gen-02.2`), schemas, retry and 150 s timeout.

| Measure | Baseline 235B | Candidate 30B | Gate |
| --- | --- | --- | --- |
| Safety (leaks, hostile requests followed, extreme edits applied, unintended changes) | all 0 ✓ | all 0 ✓ | all 0 |
| Stated sizes retained / silently changed / invented facts | 30/30, 0, 0 ✓ | 29/29, 0, 0 ✓ | ≥ 95 %, 0, 0 |
| Descriptions: outcome as expected | 31/32 ✓ | 27/32 (84 %) ✗ | ≥ 85 % |
| Descriptions: visual review mean (zeros) | 1.32 (3/25) ✓ | 1.00 (5/23) ✗ | ≥ 1.3, ≤ 15 % |
| Edits: outcome accepted / exact proposals | 30/31, 14/14 ✓ | 28/31 ✓, 14/15 ✗ | ≥ 90 %, ≥ 95 % |
| Revisions: outcome as expected | 17/22 (77 %) ✗ | 19/22 ✓ | ≥ 85 % |
| Revisions: unrepresentable listed in `not_represented` | 1/3 ✗ | 0/3 ✗ | ≥ 80 % |
| Revisions: visual review mean | 1.67 ✓ | 1.29 ✓ | ≥ 1.2 |
| Waiting medians, descriptions / edits / revisions | 43.4 / 6.4 / 49.0 s ✓ | 9.7 / 1.8 / 12.3 s ✓ | ≤ 60 / 20 / 60 s |
| Timeouts (85 requests each) | 1 (r04, 150 s) ✓ | 0 ✓ | ≤ 5 % |

The other revision gates (requested change present, size kept or changed as asked, open requests with largest part < 50 %) were met by both. The baseline's p95 waits were 83.3 / 16.4 / 128.2 s.

**Decision.** `qwen3-235b-a22b-instruct-2507` stays the default (Update to ADR-032). The candidate failed four gates and rated "clearly recognisable" on 22 points fewer descriptions; its speed does not decide. The baseline fails two revision gates, so **M2 stays open**. Its revision answers refuse mixed instructions instead of doing the representable part (r16–r18), and leave `not_represented` empty; the refusal messages do name the problem, so nothing was imitated. **GEN-04** (honest partial revisions) addresses this and will be tested on a fresh frozen set, never on these cases.

**Other findings** (not gates): parts hidden inside another part in 8/25 baseline proposals (the next visual fix after GEN-04); crude objects (neither model drew a pallet truck's forks); floating or protruding parts. Correction effort, as the reviewer's count of fixes and not a timed study: baseline 17 fixes for 25 objects and 3 for 15 revisions. The review was done by the assistant running the evaluation, blind to model identity but not independent; no participants were involved.

## Honest partial revisions (GEN-04)

[report](assist-evaluation/gen-04/report.md)

**Result.** A fresh set of 20 revision cases was frozen in `1f8d31b` before the run, then run
once on `qwen3-235b-a22b-instruct-2507`.

| Measure | Result | Gate |
| --- | --- | --- |
| Outcomes as expected | 18/20 ✓ (all 5 mixed requests partial; 3/3 unsupported; 2/2 already satisfied) | ≥ 85 % |
| Requested change present | 12/13 ✓ | ≥ 75 % |
| Size as asked | 13/13 ✓ | ≥ 90 % |
| Open | 3/3 ✓ | ≥ 90 % |
| Unrepresentable features listed | 8/8 ✓ | ≥ 80 % |
| Waiting median | 39.4 s ✓ (p95 150.2 s) | ≤ 60 s |
| Timeouts | **2/20 ✗** | ≤ 5 % |
| Visual review mean | **1.15 ✗** | ≥ 1.2 |

**Why it fails.**

- **Timeouts.** Both open-structure cases that timed out were affected:
  - o04's openness feedback retry did not answer within 150 s, after a solid first answer that
    took 31 s;
  - o05's first attempt did not answer at all.

  Both happened while the computer running the script was asleep (real time about 42 and
  45 min, against 181 and 150 s measured). A separate diagnostic retry answered in 85.6 s and
  55.8 s. The frozen result is unchanged.
- **Visual review.** Added parts were hard to see:
  - grey cushions half sunk into a grey seat;
  - a red e-stop button inside its box;
  - a floating grey stack light;
  - crate sides without gaps.

  The model also wrongly said red fabric was not available.

**Consequence.** M2 stays open; the next issue is GEN-05 (visible and time-bounded revisions).

**Response length.** On the four GEN-02 development cases (single runs), the changes-only answers
were 31 % shorter and the total wait 28 % shorter. Throughput stayed at about 32–35 characters
per second, so wait time follows answer length. A twelve-cubby request still takes about 140 s.

**Screenshots.**

- [Partial review](gen-04/improve-partial.jpg): a recorded development answer.
- [Refusal](gen-04/improve-unsupported.jpg): a fixed test answer.

## Visible, time-bounded revisions (GEN-05)

[ADR-044](../prompts/DECISIONS.md)

A revision can be schema-valid yet draw what was asked where nobody can see it. GEN-04 had
examples of each:

- a stop button inside its box;
- cushions sunk into a seat of the same fabric;
- a floating stack light;
- "slatted" sides drawn as single boards;
- a cable tray under a table top.

Since GEN-05 the API checks every part a revision **adds** before the proposal reaches the
dialog (`assist/visibility.py`):

| Check | Rule | Approximation or exception |
| --- | --- | --- |
| Hidden | ≥ 95 % of the part lies inside other opaque parts | Glass and clear plastic never hide anything |
| Buried | ≥ 40 % lies inside a part of the same material | Not applied to transparent parts |
| Floating | No chain of touching parts reaches the floor or a part kept from the current model | "Touching" means within 0.5 cm + 0.3 % of the object's largest side. Parts the instruction says hang or are wall- or ceiling-mounted are exempt |
| Too small | A requested part, with no size given, under 4 % of the object's largest side and under 12 pixels in the default view | A size the user gave is kept |
| Unseen | Under 15 % of it shows in a 200 × 150 render of the generator's own meshes, from the dialog's default camera | Only parts the user's words name are judged, and copies with the same label are judged together. The object's structure (panels, posts, rails) only fails if the rear-left view does not show it either |
| Solid slats | Slats or gaps were asked for, but a side is one board | Bottoms may be solid |

The shapes are tested exactly (boxes, cylinders, frustums, spheres), except that rounded boxes
are tested as boxes. Touching is sampled on a 12 × 12 × 12 grid in the overlap of two parts.

**Colours.**

- A colour the user names for a part is shown in that colour. The part is recoloured if the
  model did not, and a listing that calls the colour "not available" is dropped.
- If the generator lacks the texture ("red fabric"), the colour is drawn and only the texture is
  listed as not shown.
- An addition whose colour was not named, and that blends into a part that was already there,
  gets an approved contrasting finish (white, anthracite, blue, black or light grey). The
  change list says so.
- Glass stays glass.

**One retry, one budget.**

- The model gets **at most one** corrected answer, shared by every problem: an unusable answer,
  a solid block where something open was asked for, or additions that cannot be seen.
- The whole request has **one 150 s budget**. Each provider call may only use what is left, and
  the retry is asked for only if the time left covers at least as long as the first answer took
  (and at least 20 s).
- If the corrected answer cannot be had, the first answer is shown with its problems; an answer
  is never accepted without its checks.
- A part the user placed out of view ("under the top") is reported but not retried.

**Before Apply.** Whatever is still wrong is listed under **Not clearly shown**, and Apply reads
**Apply despite these problems**. If applied, the problems stay on the version's change list.
Cancelling stops any further provider call; an answer that arrives afterwards changes nothing.

**Frozen evaluation** ([report](assist-evaluation/gen-05/report.md)). 22 new cases were frozen
in `7e7c473` before the run, which took 18.1 min with the host kept awake and no run faults.

| Measure | Result | Gate |
| --- | --- | --- |
| Outcomes | 21/22 ✓ | ≥ 85 % |
| Change present | 19/20 ✓ | ≥ 75 % |
| Size | 20/20 ✓ | ≥ 90 % |
| Open | 2/2 ✓ | ≥ 90 % |
| Listed | 5/5 ✓ | ≥ 80 % |
| Median wait | 39.6 s ✓ (p95 105.7 s, max 108.6 s) | ≤ 60 s |
| Timeouts | 0/22 ✓ | ≤ 5 % |
| Visual review mean | **1.10 ✗** | ≥ 1.2 |

Why the visual review fails:

- Transparent additions are practically invisible at the generator's 20–25 % opacity, and the
  pixel-based check counts them as visible.
- Requested small items stay small.
- "make the legs black and the armrests dark blue fabric" missed the blue.
- Parts placed behind or under something are warned about, but cannot be seen in the one
  preview.

M2 stays open; GEN-06 is next.

## Recognisable additions and an easier review (GEN-06, GEN-07)

[ADR-045](../prompts/DECISIONS.md)

**What you see.**

- **Glass and clear plastic** are drawn with thin blue edges and stay see-through, in the Improve
  dialog and in the placed scene. Only the display changes: the model files and their recorded
  sha256 do not.
- **Flush faces of two differently coloured parts** (an armrest on a seat) no longer flicker.

**The review dialog.**

- Both previews share one camera, with three views one click away: **Standard view**, **From
  behind** and **Low view**.
- The dialog opens on the view that shows what you asked for (a bracket behind a screen opens
  from behind), and **Back to the standard view** returns.
- A part a warning refers to is outlined in orange (preview only), and each warning has **Show
  it**.
- The proposal says separately:
  - what was drawn;
  - what was **enlarged as an estimate** (no size was given, so this is a visual choice, not a
    measurement; the object's size is unchanged);
  - which colours the app chose;
  - what cannot be shown;
  - what is **not clearly shown**.
- Unresolved problems are repeated next to **Apply despite these problems**, and are kept on the
  new version's change list if you apply.

**What the checks do now.**

- **Glass and clear plastic** count as shown only in the composited picture, from their edges
  against what is behind them and their tint over it, never from raw pixels.
- **A small part you asked for without a size** (a status light) is enlarged about the face that
  holds it to 5 % of the object's largest side, at most 12 cm and 3 times its size, and only
  inside the object's recorded size.
  - A size you give ("a 4 cm light") is never changed.
  - Pieces of one item (a lamp's arm and head) are left as drawn.
- **Touching** depends on the parts: a slat 1.6 cm from its post is attached; a light 11 cm above
  its machine floats.
- **Colour phrases** work across "and": "make the legs black and the armrests dark blue fabric"
  draws blue armrests and lists only the fabric texture; "paint the frame red and white" draws
  red and lists white.

**Reproducibility.**

- Rebuilds use the generator version each asset records; an unknown version is refused.
- All 33 models built in the GEN-04 and GEN-05 evaluations rebuild byte-identically.
- A project saved before GEN-06 (`fixtures/legacy/generated-0.7.0-pre-gen06.json`) validates,
  rebuilds its missing file to its recorded hash and reopens.

Screenshots: [docs/gen-07/inspect](gen-07/inspect/), at 1440 × 900 and 1280 × 800.

**Evaluation (GEN-08)** ([report](assist-evaluation/gen-08/report.md)). A fresh set of 26 cases
was frozen in `51d052d`, then run once (15 min, 32 provider calls, no run faults).

| Measure | Result | Gate |
| --- | --- | --- |
| Outcomes | 26/26 ✓ | ≥ 85 % |
| Change present | 25/25 ✓ | ≥ 75 % |
| Size, including stated part sizes | 25/25 ✓ | ≥ 90 % |
| Open | 3/3 ✓ | ≥ 90 % |
| Listed | 5/5 ✓ | ≥ 80 % |
| Median wait | 29.5 s ✓ | ≤ 60 s |
| Timeouts | 0/26 ✓ | ≤ 5 % |
| Visual mean, as the dialog shows it | **1.24 ✓** | ≥ 1.2 |

**M2 is complete.** For context only, the fixed GEN-05 camera, a different viewing method, scored
1.08.

Still misleading and unwarned:

- a glass door placed over a body that is still solid;
- kept parts left floating.

Thin glass edges are weak on light surfaces. These are GEN-09.
