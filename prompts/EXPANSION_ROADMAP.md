# One platform, several applications

The original vision remains intact

| Capability | First factory release | Expansion after validation |
| --- | --- | --- |
| World creation | Manual scene + DXF geometry + reviewed equipment mapping; PNG/PDF reference with manual calibration. | Automatic interpretation of scanned drawings, multi-view photos, and videos. |
| Realistic appearance | Detailed reusable machine assets, physical scale, PBR materials, lighting, shadows, walk and orbit views. | Captured textures, reconstructed scenes, scanned equipment, richer environments. |
| Editing | Move, rotate, dimension, duplicate, delete, undo, save, branch a scenario. | Broader object classes, articulated assemblies, material changes, scene completion. |
| Simulation | Clearances, footprint overlap, specified routes, queues, processing, buffers, shifts and planned outages. | Rigid-body experiments, detailed robotics, selected structural/thermal models, degradation. |
| AI | Structured scene queries, proposed edits, bounded experiments, explanations tied to results. | Richer perception, asset retrieval, parameter identification, guided measurement. |
| Team work | Exportable project package, saved variants, comparison report and annotated findings. | Authenticated shared projects, roles, comments, history and live collaboration. |

## Shared foundation

Every application uses the same concepts: source evidence, objects, dimensions, relationships, behaviours, scenarios, observations, and results. Factory-specific process logic stays in a module so rooms, streets, individual objects, and other systems can reuse the world editor.

## The release boundary

The first release does not claim arbitrary photo-to-physics conversion, automatic internal machine reconstruction, safety certification, universal chemistry, or perfect real-world prediction. These capabilities require their own data, models, and evaluations.

> Expanding the supported world is a product goal. Keeping each experiment scientifically meaningful is a release condition.


## Expansion modules

Future modules remain in the product; each needs its own proof

| Module | First bounded result | Gate before broader release |
| --- | --- | --- |
| E1. Object interaction | Add a dimensioned object, give it mass and an impulse, replay its motion and contacts. | Known contact, friction and energy-behaviour fixtures; fixed-step replay; limits on coupling to process flow. |
| E2. Photo / video capture | Reconstruct a small static area from multiple views; confirm scale; separate a few editable objects. | Held-out geometry and scale measurements, object completeness, occlusion labels and manual correction time. |
| E3. Living environments | Recreate a small street or room; move people/vehicles/objects and run defined behaviours. | Route and interaction tests; explicit behavioural assumptions; no claim to predict an individual person. |
| E4. Engineering analysis | Select one supported part and perform a specific structural or thermal experiment. | Suitable mesh, materials, loads/supports and solver; analytical and measured validation for the intended use. |
| E5. Aging / chemical effects | Model one mechanism on one material under defined exposure conditions. | Calibration data, uncertainty, sensitivity and validation; no universal "years later" prediction. |
| E6. Team deployment | Shared projects, comments, immutable runs and role-based access. | Authorization, revision conflicts, backups, restore and explicit external data routing. |

## Dependencies

E1 and E6 follow the first release independently. E2 reuses import review and object contracts; E3 needs usable captured or authored scenes plus agent behaviours. E4 can start from verified CAD without waiting for photo reconstruction. E5 requires a domain model and evidence, not merely completion of E4.

## How to scope the next module

Before committing to an expansion, timebox a feasibility investigation, select one reference case, identify data rights and compute needs, and write acceptance evidence. Estimate the implementation only after that investigation. The initial 17-25 week envelope excludes E1-E6.

> The long-term experience remains: import a source, enter its world, change something, advance a supported process, and inspect the consequences. Each new adapter expands which consequences can be meaningfully evaluated.


## Risks and decision triggers

A risk becomes a milestone decision, not a hidden assumption

| Risk | Trigger / evidence | Response |
| --- | --- | --- |
| Wrong drawing scale | Independent dimensions disagree or block units are ambiguous. | Keep affected geometry provisional; request a known measurement; rerun all dependent checks. |
| Misleading machine model | Visual asset lacks verified bounds, service area or behaviour. | Limit eligible checks and obtain supplier/user metadata. |
| Unknown operations | Flow exists visually but timing/routing is unsupported. | Require a reviewed process graph and expose defaults. |
| AI errors | Wrong target, fabricated value or unsupported action. | Validate typed proposals, preserve undo, benchmark failures and fall back to manual tools. |
| Slow or poor graphics | Reference scene misses the quality/performance gate. | Improve assets and lighting; simplify rendering; profile before adding effects. |
| Scope growth | New domains arrive before current gates pass. | Keep them in the expansion backlog with separate data and validity requirements. |

## Expansion gates

Photo/video worlds require scale, camera estimation, occlusion handling, object separation and editable geometry. A photorealistic reconstruction alone is not a simulation-ready scene. PhysTwin provides relevant research on selected deformable objects; it does not establish arbitrary-scene engineering accuracy. [S13]

Rigid-body experiments require validated mass, contact and collision assumptions. Structural or thermal analysis requires a suitable solver, material/support data and reference cases. Chemical aging requires one defined mechanism, exposure conditions and calibration data. Do not implement these as cosmetic effects labeled as predictions.

Real-world operations integration, PLC/robot control, autonomous deployment and enterprise collaboration are separate programs after the planning simulator is useful. Use dedicated decision records before expanding into each area.


Source IDs refer to [SOURCES.md](SOURCES.md). Expansion modules are not automatically authorized by completing an earlier gate.
