# Product requirements

## Product direction (locked 2026-10-16, ADR-049)

**"Upload a plan. Walk through it. Change it. See what happens."**

A manager uploads a DWG, floor plan, PDF or rough drawing. The system builds a first 3D layout
with recognisable, provisional machines. They can walk through it, move equipment, add something
by describing it, and compare layouts. An orchestrating agent handles file interpretation and
keeps track of what is known.

Existing factory products already connect 2D layouts with 3D assets and simulation
([S01](SOURCES.md), [S14](SOURCES.md)). The distinction here is a **simple, progressively
enriched review experience**, not a claim that 2D-to-3D is new.

### One world, progressively enriched

| What the user supplies | What improves in the same world |
| --- | --- |
| One floor plan or rough drawing | Floor, equipment footprints, approximate 3D models, walk and top views. Height and appearance are provisional when absent. |
| A machine photo or 3D model | The matching placeholder gains a better appearance and, where the file supports it, checked geometry. Placement and edits stay intact. |
| A supplier drawing or specification | Confirmed dimensions, door swing, access area and other documented values replace estimates. |
| Process information | Cycle times, routes and capacities unlock a production scenario. |
| Engineering data | Specific load or motion analyses become possible only when their required inputs and validated models exist. |

**Evidence rule:**

- A plausible value never becomes a verified one.
- A clearly marked provisional height may be used to make the first world viewable, and is
  replaced when better evidence arrives.
- An engineering check that depends on it requests confirmation or returns **"height needed"**.

### A small interaction

- **Three actions on the main screen:** **Upload**, **Change something**, **Play or compare**.
- **Show the emerging plan at once** after upload, while the 3D scene builds.
- **Ask a question only when its answer changes what the user is trying to do.** For example:
  one scale measurement for a unitless drawing, or a machine's height before an
  overhead-clearance check. No long forms.
- **One orchestrating agent with bounded tools.** It identifies files, extracts layout
  candidates, matches equipment, builds a draft world and proposes changes.
- **Geometry calculations and checks stay deterministic.**
- **The user sees a simple result.** The source and uncertainty of every value stay available to
  an engineer.

### Flagship journey (to build towards)

1. Upload `Packaging-Line.dwg`: get a walkable draft with named equipment and provisional models.
2. Move the filling cell and ask "Does the pallet route still fit?": see the route and the exact
   dimensions used.
3. Add `Filling-Cell.step`: the existing cell becomes more detailed without resetting its
   position or edits.
4. Add its specification: the height and service area become sourced values, and the checks
   rerun.

### "Play" levels: separate capabilities

| Level | Needs | Gives |
| --- | --- | --- |
| Immediately | the uploaded world | Explore, move objects, compare layouts, and geometric conflicts based on the dimensions available. |
| With process data | cycle times, routes, capacities | Material flow, queues and throughput (M6). |
| With engineering data and validated models | the required inputs and a validated model | Defined motion, loads or other physical effects (M7, ENG-01). |

A visually realistic world is valuable for review. It does not by itself establish real machine
behaviour. Validation and uncertainty are part of credibility ([S09](SOURCES.md)).

### First release and growth loop

- **The first polished use case is one production area from one drawing.**
  - Rough images are accepted through a review path that shows lower confidence.
  - Richer files are supported incrementally; not every format and simulation is a launch
    prerequisite.
- **The shareable result is a private, interactive before/after scenario.**
  - A manager sends a view-only layout to an engineer, who can identify the missing
    measurements needed for a decision. This is the adoption loop to test.
  - Company drawings are never shared publicly or automatically.
- **Product targets to measure, not to claim as current performance:**
  - onboarding from one file;
  - a useful first view without a long form;
  - a non-CAD user able to make and share a layout change within minutes.
- **IMG-03's six measured photos are a research evaluation requirement**, not something a
  customer must upload to start.

## The review flow in detail

A production-area review that ends in a decision. The steps happen in one world that gets better as evidence arrives; they are not a form to complete in order.

| Step | User experience | Required evidence |
| --- | --- | --- |
| 1. Upload | Upload one drawing (DXF first; DWG through a chosen conversion route; PDF or rough image through the review path, with lower confidence). The emerging plan appears at once; one scale question only for a unitless drawing. | Source file and hash, units, two or more independent dimensions where available; provisional values marked. |
| 2. Reconstruct | Review walls, columns, doors and machine footprints; choose catalog models. | Drawing entity IDs; actual asset dimensions or visible provisional status. |
| 3. Define operation | Connect stations and enter cycle times, buffer sizes, routes and schedules. | User-confirmed process graph and parameter sources. |
| 4. Inspect | Walk through the area; open service envelopes and route overlays. | Geometric checks with rule values, tolerances and highlighted objects. |
| 5. Run | Start a shift simulation; inspect queues, movement and machine states. | Run ID, fixed input revision, seed, engine version and event log. |
| 6. Compare | Create a variant, move equipment, rerun, inspect changes and export. | Baseline and candidate results with comparable operating assumptions. |

## Flagship demonstration with process data ("Play", second level)

This is the demonstration once process information exists (M6). The first release stops at the journey above.

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
| R10 | Enrich without resetting. | Adding a photo, 3D model or specification to an existing object keeps its placement, edits and links; replaced values cite their new source; the previous version is kept. |
| R11 | Never promote a provisional value. | Provisional heights and appearances are marked; a check that needs one returns "height needed" (or the missing value) or asks for confirmation, and never passes on an estimate. |
| R12 | Keep the interaction small. | The main screen offers Upload, Change something and Play or compare. A first view needs no long form, and a question is asked only when its answer changes what the user can do. |
| R13 | Share privately. | A before/after scenario can be shared view-only with a named person. Nothing is published or shared automatically. |
| R14 | Measure the product targets. | One-file onboarding, a useful first view without a long form, and a non-CAD user making and sharing a change within minutes are measured with people (UX-02) before any claim. |

## Workflow details that matter

Every result is attached to a scene revision. Changing equipment dimensions or process parameters marks old results as outdated. "Not evaluated", "input missing", "height needed" (or another named value needed), "check passed", and "check failed" are different states.

A generic model can support footprint planning when its footprint is confirmed. It cannot support robot reach, internal motion, load capacity, or maintenance access unless those properties are explicitly modeled. User-entered clearance rules are project requirements, not automatic regulatory compliance.
