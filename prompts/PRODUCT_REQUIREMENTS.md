# Product requirements

A production-area review that ends in a decision

| Step | User experience | Required evidence |
| --- | --- | --- |
| 1. Import | Upload a DXF or use a drawing as a reference. Confirm scale and orientation. | Source file, units, two or more independent dimensions where available. |
| 2. Reconstruct | Review walls, columns, doors and machine footprints; choose catalog models. | Drawing entity IDs; actual asset dimensions or visible provisional status. |
| 3. Define operation | Connect stations and enter cycle times, buffer sizes, routes and schedules. | User-confirmed process graph and parameter sources. |
| 4. Inspect | Walk through the area; open service envelopes and route overlays. | Geometric checks with rule values, tolerances and highlighted objects. |
| 5. Run | Start a shift simulation; inspect queues, movement and machine states. | Run ID, fixed input revision, seed, engine version and event log. |
| 6. Compare | Create a variant, move equipment, rerun, inspect changes and export. | Baseline and candidate results with comparable operating assumptions. |

## Flagship demonstration

Use a small packaging area: infeed, processing station, inspection, packing, buffer, and outfeed. Add a column, a service door, a worker route, and a marked transport lane. Start with a deliberate maintenance-access conflict and a deliberately slow packing station.

A user asks: "Move the packing station so its service area is clear, then compare an eight-hour shift." The system proposes an edit, identifies any missing operating inputs, runs the scenario, and shows whether spatial access and output changed. No improvement is pre-scripted or guaranteed.

> The demonstration must visibly distinguish an operational queue from a graphical animation. Products are rendered from simulation events; decorative motion cannot create production output.


## Functional release requirements

Observable behaviours and clear completion criteria

| ID | Requirement | Acceptance evidence |
| --- | --- | --- |
| R01 | Preserve source scale and coordinate transforms. | Known drawing lengths survive import, edits, export and reload within declared numerical tolerance. |
| R02 | Support inspectable 3D equipment. | Select an object and see identity, dimensions, footprint, source, model status and behaviour. |
| R03 | Edit reliably. | Move/rotate and numeric edits agree; undo restores state; saved variants do not alter their baseline. |
| R04 | Check spatial constraints. | Report footprint intersections, service-envelope conflicts and specified route obstructions against labeled fixtures. |
| R05 | Run a defined production process. | Station states, queues and output agree with analytical fixtures and conservation checks. |
| R06 | Compare reproducible scenarios. | Same inputs and pinned engine reproduce results; changed inputs create a new run revision. |
| R07 | Use AI without inventing measurements. | Supported actions validate; uncertain requests ask for the missing information; result claims link to recorded values. |
| R08 | Export an understandable review. | Bundle model, assumptions, sources, versions, findings, metrics and screenshots. |
| R09 | Remain useful without AI. | Import review, editing, checks, runs and exports work when model services are unavailable. |

## Workflow details that matter

Every result is attached to a scene revision. Changing equipment dimensions or process parameters marks old results as outdated. "Not evaluated", "input missing", "check passed", and "check failed" are different states.

A generic model can support footprint planning when its footprint is confirmed. It cannot support robot reach, internal motion, load capacity, or maintenance access unless those properties are explicitly modeled. User-entered clearance rules are project requirements, not automatic regulatory compliance.
