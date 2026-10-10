# Execution through working checkpoints

Effort ranges are estimates, not delivery guarantees

| Gate | Focus | Hours | Exit evidence |
| --- | --- | --- | --- |
| M0 | Foundation | 16-24 | Existing repo inspected; reproducible web/API baseline; docs, lockfiles and CI; no remote changes. |
| M1 | World and assets | 28-40 | One coherent industrial scene; catalog metadata; reliable editing, save/reload and graphic benchmark. |
| M2 | Drawing import | 32-48 | Supported DXF ingestion, scale review, layer/block mapping and correction workflow; PDF/PNG reference. |
| M3 | Spatial checks | 28-40 | Footprint, service-envelope and defined route checks with seeded fixtures and highlighted evidence. |
| M4 | Production and comparison | 40-60 | Defined process templates, reproducible shift runs, event replay and baseline/candidate metrics. |
| M5 | AI assistance | 36-56 | Real provider passes supported-command evaluation; edits and result explanations are traceable. |
| M6 | Evaluation and demo | 28-44 | Held-out evaluation, usable export, limitations, recorded demo and release checklist. |

Total implementation estimate: 208-312 focused hours. Add 20% contingency: approximately 250-375 hours. At 15 hours per week, plan approximately 17-25 weeks for the evaluated first release. Learning, unfamiliar tooling or unavailable data may extend this envelope.

## Earlier visible outcomes

M1 provides an editable, visually coherent industrial world. M3 provides a useful drawing-to-layout review. M4 delivers the first end-to-end operational workflow without requiring AI. M5 adds evaluated language-driven assistance. These milestones are demonstrable releases, not hidden infrastructure work.

## Dependencies and feedback

Use the sequence M0 to M6 as the critical path. Asset preparation, fixture annotation and documentation can overlap after their contracts stabilize; do not assume overlap reduces a solo developer's total effort. Re-estimate after M1 graphics profiling and M2 import evaluation.

> Expansion features are outside this effort estimate. A complete platform spanning factories, arbitrary video worlds, structural engineering and chemistry is a multi-stage research and engineering program.


## First-month baseline

A concrete start at the assumed 15 hours per week

| Week | Work | Visible checkpoint |
| --- | --- | --- |
| 1 | Inspect existing repo and environment; record scope decisions; establish typed web/API baseline, scripts and CI. | Clean setup documented; browser can show backend health and load a tiny valid scene fixture. |
| 2 | Finish M0 issues; establish world coordinates, catalog contract, selection and camera controls. | A scene with dimensioned objects loads predictably and survives save/reload. |
| 3 | Improve industrial asset quality, lighting, object transforms, numeric properties and undo. | A short walkthrough demonstrates the visual and editing direction. |
| 4 | Profile the scene, close M1 gaps, begin DXF importer fixtures and scale review when M1 passes. | A coherent editable industrial scene; drawing import is an early experiment, not a completed promise. |

## A productive work session

- Read current project status and the active milestone. Select one issue with an observable result.
- State the input, intended change and acceptance check. Implement the smallest complete vertical slice.
- Run checks relevant to the changed contracts or behaviour. Demonstrate the user-facing result.
- Record actual time, evidence, limitations and next action. Commit a coherent change when appropriate; do not hide unfinished work behind a success label.

## Weekly review

Review the demonstration, failures, manual effort and remaining risk. Update backlog estimates and architectural decisions. If import accuracy or graphics performance misses its gate, narrow the supported case before adding more AI or effects.

> The first month establishes a strong foundation and a credible world editor. It does not promise an arbitrary-drawing, fully autonomous factory simulator.


## Learning checkpoints

Each milestone includes an explanation you should be able to give

| Milestone | Concepts | Learning checkpoint |
| --- | --- | --- |
| M0 | Git workflow, client/server boundary, types, schemas, dependency locks and CI. | Explain how one browser request reaches the API and how a clean machine reproduces the environment. |
| M1 | Coordinates, transforms, cameras, meshes, materials, scene graphs and rendering budgets. | Explain why visual scale, physical dimensions and collision geometry are distinct. |
| M2 | CAD entities, units, nested blocks, coordinate mapping, annotations and uncertainty. | Trace one machine from its source entity through a reviewed 3D placement. |
| M3 | Polygons, distance, intersections, tolerances, path envelopes and dimensional limits. | Explain what a clearance check proves and what it leaves untested. |
| M4 | Discrete-event simulation, resources, queues, utilization, seeds and confidence intervals. | Derive one known-answer case and explain a bottleneck using an event trace. |
| M5 | Structured model outputs, retrieval, tool boundaries, model evaluation and grounding. | Show an ambiguous request, a correct clarification and an evidence-backed result. |
| M6 | Experimental design, baselines, held-out data, usability and validity. | Present the contribution, measured evidence, failure cases and next research question. |

## A repeatable learning note

For each milestone, write a short explanation containing the question, the model, the important assumptions, one worked example, the implementation boundary, the validation method and one failure case. Keep it in docs/learning with links to code and evidence after implementation starts.

Use official documentation for API details. Treat AI-generated explanations as drafts to verify through small examples and observed outputs. No need to train an LLM from scratch to learn or demonstrate the core contribution.

> The goal is to explain and defend each system decision, not merely to operate a generated codebase.
