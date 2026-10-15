# Execution through working checkpoints

Effort ranges are estimates, not delivery guarantees.

## Revision 2026-10-10: guided creation first

After M1 the user approved a broader product direction. Factory planning is the **first example** of a general editable-world platform, and the next priority is a beginner-friendly way to create and change objects without CAD skills. The sequence after M1 is therefore:

1. **Guided creation and described custom objects** (new M2, GEN issues).
2. **General image-to-editable-world import** (new M3, IMG issues).
3. **Drawing import** (M4). IMP-01 DXF import stays planned and feeds the same world model.
4. Spatial checks, then simulation split into **explicit supported models**: production events, rigid-body interactions, and later validated structural and chemical cases.

The earlier M2 ("Drawing import", 32-48 h) and the old total (208-312 h for M0-M6) no longer describe the plan, because the scope changed. They are kept in the history below only as the original baseline. Issue IDs are unchanged; new work has new IDs (GEN, IMG, PHY-02, CHEM-01). See ADR-030.

## Gates

| Gate | Focus | Status / estimate | Exit evidence |
| --- | --- | --- | --- |
| M0 | Foundation | **Complete** (2026-10-09/10; SET-01..03) | Existing repo inspected; reproducible web/API baseline; docs, lockfiles and CI; no remote changes. |
| M1 | World and assets | **Complete** (2026-10-10; WRL-01..04) | One coherent industrial scene; catalog metadata; reliable editing, save/reload and graphic benchmark. |
| M2 | Guided creation and described objects | 48-72 h | A first-time user can describe a missing object in ordinary language, review a typed proposal that separates stated facts from inferences, confirm the dimensions that matter, see an original provisional model, place it through the command path, and change it with one bounded language request; a manual builder works without the AI provider; an evaluated description and edit set (GEN-01..03). |
| M3 | Image to editable world | 60-100 h (feasibility first) | One image becomes a reviewed, editable scene: a vision model proposes objects, the user sets scale from a known dimension and accepts, corrects or rejects each object; held-out precision, scale error and correction time are reported (IMG-01..03). |
| M4 | Drawing import | 32-48 h | Supported DXF ingestion, scale review, layer/block mapping and correction workflow; PDF/PNG reference; imported equipment lands in the same world model and review flow as described and image objects (IMP-01..03). |
| M5 | Spatial checks | 28-40 h | Footprint, service-envelope and defined route checks with seeded fixtures and highlighted evidence (GEO-01..02). |
| M6 | Production-event simulation and comparison | 40-60 h | Defined process templates, reproducible shift runs, event replay and baseline/candidate metrics (SIM-01..04). |
| M7 | Rigid-body interactions | 32-56 h | A bounded, fixed-step rigid-body adapter with documented contact and friction fixtures, inputs with evidence (no mass inferred from appearance), and replay kept separate from production events (PHY-01..02). |
| M8 | AI assistance across the workflow | 28-48 h | Language requests cover the supported commands, scenario runs and grounded explanations, evaluated on held-out requests (AI-01..03). GEN-01 already provides the provider boundary for object proposals and one edit. |
| M9 | Evaluation and release | 28-44 h | Held-out evaluation, usable export, limitations, recorded demo and release checklist (QA-01, REL-01). |
| Later | Validated structural and chemical cases; team use; multi-view capture | Estimate after a feasibility study | ENG-01 (one structural or thermal effect), CHEM-01 (one chemical or aging mechanism), TEAM-01, CAP-01. Each needs its own data, model and validation; none is implied by an earlier gate. |

Remaining estimate (M2-M9): 296-468 focused hours. Add 20 % contingency: about 355-560 hours. At 15 hours per week (an unconfirmed assumption), that is about 24-37 weeks. M3 carries the most uncertainty because image understanding is a research problem; its range will be revised after the IMG-01 feasibility timebox. Actual hours for M0 and M1 were not tracked, so these ranges are not yet calibrated against observed pace.

**Scope note (2026-10-14, IMG-01).** The feasibility check bounded IMG-01 to **one indoor photo with a visible floor and a floor rectangle the user measures** (docs/image-import.md, ADR-036, ADR-037). The vision model finds and names objects well but its floor geometry and sizes are unreliable, so the scale comes from the user's rectangle. The broader M3 goal stays in IMG-02/03: outdoor scenes, photos without a usable rectangle, several photos of one place, walls and room boundaries, and held-out evaluation against measured references. IMG-01 is done; M3 is in progress. M2 is still open (GEN-02, GEN-03). The M3 estimate is not revised, because hours were not tracked.

**Scope note (2026-10-15, GEN-02).** GEN-02 is done: a placed generated object (described, builder or photo) can be corrected in words or by hand and saved as a new version, applied to one or all instances in one undoable step (ADR-039..041). M2 stays **in progress** until GEN-03; GEN-03's held-out set now also includes model-revision instructions. The bounded generator still cannot show openings within one part, slanted or curved surfaces beyond its shapes, rotated or moving parts, or textures, so a correction can make an object more recognisable but not exact. The M2 estimate is not revised, because hours were not tracked.

### Original baseline (superseded 2026-10-10)

The original plan listed M2 "Drawing import" (32-48 h), M3 spatial checks (28-40 h), M4 production and comparison (40-60 h), M5 AI assistance (36-56 h) and M6 evaluation (28-44 h), for 208-312 hours in total (250-375 with contingency). It is kept for traceability only.

## Earlier visible outcomes

M1 provides an editable, visually coherent industrial world. M2 lets a first-time user add a missing object by describing it, and change it with words, without CAD skills. M3 turns a picture into a reviewed scene. M4 adds drawing-accurate geometry to the same world model. M6 delivers the first end-to-end operational workflow without requiring AI. These milestones are demonstrable releases, not hidden infrastructure work.

## Dependencies and feedback

Use the sequence above as the critical path. GEN-01 creates the object proposal, model generation and provider boundary that IMG-01 and IMP-02 reuse: an object proposed from words, an image or a drawing is reviewed the same way and placed through the same command path. Asset preparation, fixture annotation and documentation can overlap after their contracts stabilize; do not assume overlap reduces a solo developer's total effort. Re-estimate after GEN-01 (described objects), after the IMG-01 feasibility timebox, and after M4 import evaluation.

> Expansion features beyond the listed gates are outside this estimate. A complete platform spanning factories, arbitrary image and video worlds, structural engineering and chemistry is a multi-stage research and engineering program.


## First-month baseline

The original first-month plan (weeks 1-4: foundation, world contracts, editing, profiling) is complete: M0 and M1 closed on 2026-10-10. The next block of work is GEN-01, then GEN-02/03 and the IMG-01 feasibility timebox.

| Block | Work | Visible checkpoint |
| --- | --- | --- |
| 1 | GEN-01: guided entry, described object proposal, bounded geometry generator, provider integration, one language edit. | A first-time user describes a conveyor, confirms its size, places it, moves it with words, saves and reopens. |
| 2 | GEN-02/03: correct generated objects after placement; evaluate descriptions and edits on a held-out set. | Measured schema adherence, grounding and correction effort; known failure cases. |
| 3 | IMG-01 feasibility: test a vision model on real photos; decide the supported image case. | A written go/no-go with examples, before committing to the IMG estimate. |

## A productive work session

- Read current project status and the active milestone. Select one issue with an observable result.
- State the input, intended change and acceptance check. Implement the smallest complete vertical slice.
- Run checks relevant to the changed contracts or behaviour. Demonstrate the user-facing result.
- Record actual time, evidence, limitations and next action. Commit a coherent change when appropriate; do not hide unfinished work behind a success label.

## Weekly review

Review the demonstration, failures, manual effort and remaining risk. Update backlog estimates and architectural decisions. If proposal quality, import accuracy or graphics performance misses its gate, narrow the supported case before adding more AI or effects.

> The guided path makes object creation approachable. It does not make a generated model a verified product model, and it does not replace measurement.


## Learning checkpoints

Each milestone includes an explanation you should be able to give

| Milestone | Concepts | Learning checkpoint |
| --- | --- | --- |
| M0 | Git workflow, client/server boundary, types, schemas, dependency locks and CI. | Explain how one browser request reaches the API and how a clean machine reproduces the environment. |
| M1 | Coordinates, transforms, cameras, meshes, materials, scene graphs and rendering budgets. | Explain why visual scale, physical dimensions and collision geometry are distinct. |
| M2 | Structured model output, schema-guided decoding, grounding, bounded generation, provenance and review. | Show why a valid JSON proposal can still be wrong, and how stated facts, inferences and unknowns stay separate. |
| M3 | Camera geometry, scale from a known length, object detection versus segmentation, occlusion and uncertainty. | Explain what one image can and cannot establish about size and hidden parts. |
| M4 | CAD entities, units, nested blocks, coordinate mapping, annotations and uncertainty. | Trace one machine from its source entity through a reviewed 3D placement. |
| M5 | Polygons, distance, intersections, tolerances, path envelopes and dimensional limits. | Explain what a clearance check proves and what it leaves untested. |
| M6 | Discrete-event simulation, resources, queues, utilization, seeds and confidence intervals. | Derive one known-answer case and explain a bottleneck using an event trace. |
| M7 | Rigid bodies, contacts, friction, fixed time steps and determinism. | Show a contact fixture against its expected result and name what the model ignores. |
| M8 | Tool boundaries, retrieval, evaluation and grounding across commands. | Show an ambiguous request, a correct clarification and an evidence-backed result. |
| M9 | Experimental design, baselines, held-out data, usability and validity. | Present the contribution, measured evidence, failure cases and next research question. |

## A repeatable learning note

For each milestone, write a short explanation containing the question, the model, the important assumptions, one worked example, the implementation boundary, the validation method and one failure case. Keep it in docs/learning with links to code and evidence after implementation starts.

Use official documentation for API details. Treat AI-generated explanations as drafts to verify through small examples and observed outputs. No need to train an LLM from scratch to learn or demonstrate the core contribution.

> The goal is to explain and defend each system decision, not merely to operate a generated codebase.
