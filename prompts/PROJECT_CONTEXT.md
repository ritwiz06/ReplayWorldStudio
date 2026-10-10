# Project context

## Product vision

Build an AI-assisted platform that turns drawings, photos, videos and specifications into realistic, editable worlds. A user can enter a scene, select or add objects, rearrange a design, advance a supported simulation, and inspect the consequences of a change.

The long-term vision includes complete environments, object interactions, forces, selected material effects and degradation. Factory planning is the first application of this platform; it does not replace the wider vision.

## First application: factory project planning

A manufacturing project engineer or system integrator uploads a layout drawing. The platform helps reconstruct the space, add prototype machine models, verify dimensions, inspect access, define the production process and simulate operation. The engineer can change a layout, ask AI to run an experiment, and compare alternatives before a physical change.

The initial supported scale is one small production area with roughly 5-20 equipment instances and one process family. This is a planning scope, not a demonstrated capability or runtime limit.

## Flagship user journey

1. Import a DXF, or use a calibrated PDF/PNG as a reference.
2. Review the space, source scale and machine footprints.
3. Match equipment to detailed reusable models or clearly identified provisional assets.
4. Confirm process order, cycle times, buffers, routes, schedules and downtime behaviour.
5. Walk through a realistic 3D scene and inspect spatial conflicts.
6. Run a shift; inspect queues, machine states and product movement.
7. Move a machine or change a parameter, rerun, and compare the evidence.
8. Export the scenario, assumptions, results and annotated findings.

Example request: "Move the packing station so its service area is clear, then compare an eight-hour shift." The result must come from the modeled scenario; do not script a guaranteed improvement.

## What the user cares about

- A visually compelling, realistic world that is useful to explore and modify.
- Clear practical decisions: what fits, what obstructs access, where production queues, and how alternatives differ.
- Simple, contextual controls. The earlier concept felt basic and complicated to use; a generic dashboard or a toy physics scene will not satisfy the product direction.
- Professional, structured execution with working checkpoints and retained project memory.
- Understanding the concepts and reasoning behind the implementation, from foundations to advanced topics.
- A reusable world platform whose factory-specific behaviour stays modular.

## Trust boundary

A drawing may establish geometry; it does not automatically establish cycle times, mass, material strength, friction, maintenance envelopes or hidden mechanisms. Preserve unknowns. Distinguish measured, supplier-provided, user-supplied, inferred and default inputs.

Photorealistic graphics do not prove physical accuracy. Generated movement is not an operational simulation. Load capacity, chemical reactions and aging require suitable models and validation. Do not market the prototype as testing everything perfectly.

## Current known context

The user intends to work in VS Code with an already initialized Git repository. A product plan exists and an earlier HTML concept may be available as reference. This prompt package has not inspected the user's target repository and does not know its current implementation status. Inspect before choosing the active milestone.

Do not require the prior HTML prototype or rebuild its limitations. Do not assume the project has a deployment, a selected AI model, industrially validated predictions or an approved cloud budget.
