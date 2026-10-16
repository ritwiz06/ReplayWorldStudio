# One platform, several applications

The original vision remains intact. Revised 2026-10-10 (ADR-030): factory planning is the first example of a general editable-world platform, and the next priorities are guided object creation, then general image import.

| Capability | Current plan (M2-M9) | Expansion after validation |
| --- | --- | --- |
| Object creation | **M2 (next):** describe a missing object in ordinary language; review a typed proposal (parts, appearance, dimensions, stated versus inferred facts, unknowns); generate an original provisional model from a bounded geometry specification; manual builder without AI. | Articulated or parametric objects, vendor model retrieval, richer materials and textures, reviewed object libraries shared across projects. |
| World creation | **M3:** one image to a reviewed, editable world. **M4 (reframed 2026-10-16, ADR-049):** first world from one file → review → enrich the existing world. Upload one drawing (DXF first) and get a walkable draft with provisional models; review it in place; enrich objects from a machine photo, 3D model or specification without resetting them; share a private view-only before/after. DWG, PDF and rough images follow incrementally. All feed the same world model. | Automatic interpretation of scanned drawings, multi-view photos and video (CAP-01). |
| Realistic appearance | Detailed reusable machine assets, physical scale, PBR materials, lighting, shadows, walk and orbit views; generated objects use the same conventions and are labelled provisional. | Captured textures, reconstructed scenes, scanned equipment, richer environments. |
| Editing | Move, rotate, dimension, duplicate, delete, undo, save; **one bounded language edit** (M2), broader language commands (M8); scenario variants (M6). | Broader object classes, articulated assemblies, material changes, scene completion. |
| Simulation | Explicit supported models, each with its own inputs and limits: **production events** (M6: queues, processing, buffers, shifts, planned outages) and **rigid-body interactions** (M7: bounded contacts and motion). Spatial checks (M5) are geometry, not simulation. | **Validated structural** (ENG-01) and **chemical / aging** (CHEM-01) cases, one defined case at a time; detailed robotics. |
| AI | Typed object proposals and one edit through a server-side provider (M2, ASU Voyager); image proposals (M3); **one orchestrating agent with bounded tools** for file interpretation and draft worlds (M4, AGT-01); command coverage, grounded explanations and bounded experiments (M8). | Richer perception, asset retrieval, parameter identification, guided measurement. |
| Team work | Exportable project package, saved variants, comparison report and annotated findings. | Authenticated shared projects, roles, comments, history and live collaboration. |

## Shared foundation

Every application uses the same concepts: source evidence, objects, dimensions, relationships, behaviours, scenarios, observations, and results. An object can come from the catalog, a description, an image or a drawing; it is always reviewed the same way and changed through the same command path. Factory-specific process logic stays in a module so rooms, streets, individual objects, and other systems can reuse the world editor.

## The release boundary

The first release does not claim arbitrary photo-to-physics conversion, automatic internal machine reconstruction, safety certification, universal chemistry, or perfect real-world prediction. A generated model is an original, provisional picture at the stated size: it carries no verified mass, strength, chemistry or operating behaviour. These capabilities require their own data, models, and evaluations.

> Expanding the supported world is a product goal. Keeping each experiment scientifically meaningful is a release condition.


## Supported simulation models

Simulation is split into explicit models. Each declares the question it answers, its required inputs and its limits, and none is evidence for another.

| Model | Planned gate | Answers | Does not answer |
| --- | --- | --- | --- |
| Production events | M6 (SIM-01..04) | Throughput, queues, utilisation, blocking and starvation for a reviewed process graph. | Motion, contact, forces, structural capacity. |
| Rigid-body interactions | M7 (PHY-01..02) | Motion and contacts of rigid objects with stated mass, friction and restitution, at a fixed step. | Deformation, stress, failure, production output. |
| Structural / thermal | Later (ENG-01) | One defined part, load case and material, compared with analytical and measured references. | Anything outside the validated case. |
| Chemical / aging | Later (CHEM-01) | One mechanism on one material under defined exposure, with calibration data and uncertainty. | Universal "years later" prediction. |


## Expansion modules

Future modules remain in the product; each needs its own proof

| Module | First bounded result | Gate before broader release |
| --- | --- | --- |
| E1. Object interaction | Now planned as M7: add a dimensioned object, give it a stated mass and an impulse, replay its motion and contacts. | Known contact, friction and energy-behaviour fixtures; fixed-step replay; limits on coupling to process flow. |
| E2. Photo / video capture | Now started as M3 with **one image** to a reviewed, editable world; multi-view reconstruction stays CAP-01. | Held-out geometry and scale measurements, object completeness, occlusion labels and manual correction time. |
| E3. Living environments | Recreate a small street or room; move people/vehicles/objects and run defined behaviours. | Route and interaction tests; explicit behavioural assumptions; no claim to predict an individual person. |
| E4. Engineering analysis | Select one supported part and perform a specific structural or thermal experiment (ENG-01). | Suitable mesh, materials, loads/supports and solver; analytical and measured validation for the intended use. |
| E5. Aging / chemical effects | Model one mechanism on one material under defined exposure conditions (CHEM-01). | Calibration data, uncertainty, sensitivity and validation; no universal "years later" prediction. |
| E6. Team deployment | Shared projects, comments, immutable runs and role-based access. | Authorization, revision conflicts, backups, restore and explicit external data routing. |

## Dependencies

GEN-01 provides the object proposal, review and generation path that IMG-01 and IMP-02 reuse. E1 (M7) needs reviewed mass and contact inputs, which generated objects deliberately leave unknown. E2 reuses import review and object contracts; E3 needs usable captured or authored scenes plus agent behaviours. E4 can start from verified CAD without waiting for photo reconstruction. E5 requires a domain model and evidence, not merely completion of E4.

## Model and provider notes

- **Text proposals (M2):** ASU Voyager, an OpenAI-compatible service at `https://openai.rc.asu.edu/v1`, called only from the local API. The first model is `qwen3-235b-a22b-instruct-2507`; the model ID is configurable and its output is validated, never trusted (ADR-032).
- **Images (M3):** `qwen3-vl-32b-instruct` is a candidate because the user's Voyager catalog lists it with vision. It must be tested on actual image inputs when IMG-01 begins. Voyager's text-to-image and video-generation models are **not** image-to-3D services and are not treated as such.

## How to scope the next module

Before committing to an expansion, timebox a feasibility investigation, select one reference case, identify data rights and compute needs, and write acceptance evidence. Estimate the implementation only after that investigation. The M2-M9 estimate in MILESTONES.md excludes the Later modules.

> The long-term experience remains: import a source, enter its world, change something, advance a supported process, and inspect the consequences. Each new adapter expands which consequences can be meaningfully evaluated.


## Risks and decision triggers

A risk becomes a milestone decision, not a hidden assumption

| Risk | Trigger / evidence | Response |
| --- | --- | --- |
| Wrong drawing scale | Independent dimensions disagree or block units are ambiguous. | Keep affected geometry provisional; request a known measurement; rerun all dependent checks. |
| Misleading machine model | Visual asset lacks verified bounds, service area or behaviour. | Limit eligible checks and obtain supplier/user metadata. |
| Generated object taken as real | A provisional model is read as a vendor product or as having verified properties. | Label generated objects provisional everywhere; keep mass, strength, chemistry and behaviour unknown; record the description and model that produced it. |
| Unknown operations | Flow exists visually but timing/routing is unsupported. | Require a reviewed process graph and expose defaults. |
| AI errors | Wrong target, fabricated value, invalid output or unsupported action. | Validate typed proposals, check stated values against the user's words, preserve undo, benchmark failures and fall back to manual tools. |
| Provider unavailable or changed | Missing key, outage, model retired or behaviour drift. | Manual builder and editor keep working; the model ID is configurable; re-run the evaluation set after any model change. |
| Slow or poor graphics | Reference scene misses the quality/performance gate. | Improve assets and lighting; simplify rendering; profile before adding effects. |
| Scope growth | New domains arrive before current gates pass. | Keep them in the expansion backlog with separate data and validity requirements. |

## Expansion gates

Photo/video worlds require scale, camera estimation, occlusion handling, object separation and editable geometry. A photorealistic reconstruction alone is not a simulation-ready scene. PhysTwin provides relevant research on selected deformable objects; it does not establish arbitrary-scene engineering accuracy. [S13]

Rigid-body experiments require validated mass, contact and collision assumptions. Structural or thermal analysis requires a suitable solver, material/support data and reference cases. Chemical aging requires one defined mechanism, exposure conditions and calibration data. Do not implement these as cosmetic effects labeled as predictions.

Real-world operations integration, PLC/robot control, autonomous deployment and enterprise collaboration are separate programs after the planning simulator is useful. Use dedicated decision records before expanding into each area.


Source IDs refer to [SOURCES.md](SOURCES.md). Expansion modules are not automatically authorized by completing an earlier gate.
