# Drawing import (IMP-01), the first world from one file (ONB-01) and its review (IMP-02)

**Upload a plan. Walk through it. Change it. See what happens.** One DXF floor layout becomes a 3D draft that a first-time user can walk through, change and compare with the drawing. The draft is built by deterministic code: no language model is called, so the first view never waits for one. Decisions: ADR-050, ADR-051 and ADR-052 (with ADR-049). Contract: [contracts.md, Drawing sources](contracts.md#drawing-sources-090-imp-01-and-onb-01) and [Drawing review](contracts.md#drawing-review-0100-imp-02).

## The journey

1. **Upload** (the first of the three main actions, also the first card of the start panel). The person chooses a `.dxf`. The API reads it and stores the original by its sha256; the plan appears at once with its names, what was found, and what was left out. The 3D draft is built and checked against the contract in the background.
2. **One question, only when needed.** If the drawing does not settle its unit, the person picks it from five, each shown with the size it implies ("millimetres → 12 m × 8 m"). Nothing gets a real size before that, and the answer is recorded as theirs.
3. **Open the 3D draft.** The open project is replaced only through the editor's usual unsaved-change check. The draft has the floor, named footprints, provisional display forms, and the drawing's lines on the 3D floor. Orbit, top and walk views work at once.
4. **Check the draft (IMP-02).** The drawing panel opens on **Review**, four plain questions with the plan above them:
   - **Is this the floor?** The proposed outline is highlighted. Answers: *Looks right*; *Use another outline* (click it on the plan); or *Size it around the objects*. The 40 % rule only proposes.
   - **Is this the right scale?** Shows the floor's size at the current unit. Answers: *Looks right*; another unit (each choice shows the size it gives); or *Measure a known length*: click two points on the plan (they snap to corners and centres) and type the real distance. If that disagrees with the drawing's or the chosen unit by more than 2 %, both floor sizes are shown and the person chooses. The header and the measurement are both kept.
   - **Are these the right objects?** Click an outline on the plan or an object in 3D. The card shows its name, its kind (equipment, structure, walkway or keep-clear marking) and *Not an object*. Objects not checked yet are listed, and *Accept the remaining N as drawn* finishes the step.
   - **What the drawing leaves out:** heights, shapes not imported, open lines. The person accepts them with *I understand*.

   A status line says what a later check could claim. Every answer is one undoable edit.
5. **Change something.** Objects are moved, turned or resized with the existing editor's handles. *Size, position and evidence…* on the selection card opens **Details** (object list, catalog, inspector).
6. **Play or compare.** The drawing panel's Compare view shows the layout *as drawn* beside the layout *now*: a moved object is drawn where it is, with a dashed outline where the drawing has it, and every change is listed ("Press 1 moved 2.00 m"). **Walk through it** enters the walk view. The panel says plainly that route, process and physical checks are not available yet, so nothing is animated and no clearance result is shown.
7. **Save and reopen.** The project file holds the drawing's reading, the review and every link; reopening checks the stored DXF against its sha256.

**The simple screen (UX-01).** A first visit shows:
- the three actions;
- a selection card that names the selected object, says where its size comes from, and offers *Check it*, *Move it* and *Size, position and evidence…*;
- the drawing panel.

The object list, catalog, inspector, the assistant's change bar, the scene picker and the engineering status line are behind **Details** in the top bar, and the choice is remembered. *Go to the full editor* on the start panel opens them.

IMP-02 screens at 1440 × 900 and 1280 × 800 are in [docs/imp-02/](imp-02/) (`SCREENS_OUT=../../docs/imp-02 pnpm exec playwright test e2e/imp02-screens.spec.ts`).

Screenshots (1440 × 900, `SCREENS_OUT=../../docs/onb-01 pnpm exec playwright test e2e/onb01-screens.spec.ts`), in [docs/onb-01/](onb-01/):

| | |
| --- | --- |
| Start panel | `1-start.jpg` |
| Upload: plan, unit, what was found | `2-upload-plan.jpg` |
| Draft world | `3-draft-world.jpg` |
| An object's origin and assumed height | `4-selected-provisional.jpg` |
| Before/after compare | `5-compare-before-after.jpg`, `5b-height-needed.jpg`, `6-top-view-moved.jpg` |
| Walk | `7-walk.jpg` |
| Unknown units | `8-unit-question.jpg` |
| Not imported, DWG | `9-not-imported.jpg`, `10-dwg.jpg` |

## The supported DXF subset (`rws-dxf/1`)

Read from ASCII DXF, in model space and inside block definitions:

| Supported | How it is used |
| --- | --- |
| `LINE` | A plan line. |
| `LWPOLYLINE`, 2D `POLYLINE` | A plan line; a closed one is a candidate object (or the floor). Arc segments (bulges) are drawn as straight segments of at most 10°, and the footprint is then `enclosing`. |
| `CIRCLE` | A 32-sided closed outline; its footprint is the square around it, marked `enclosing` (approximate). |
| `ARC` | An open line of 10° segments, on the plan only. |
| `INSERT` of a block | One object per top-level insert. Insertion point, base point, X/Y scale (negative scale mirrors), rotation, extrusion +Z or -Z (mirrored), nested inserts up to 8 deep. Its footprint is the block's extent as inserted. |
| `TEXT`, `MTEXT`, `ATTRIB` | Names only: a block's `NAME`/`LABEL`/`TAG`/`ID`/`EQUIPMENT`/`DESCRIPTION`/`TITLE` attribute, or the text nearest the centre inside an outline. Recorded as content, never followed. |
| Header `$INSUNITS`, `$MEASUREMENT`, `$ACADVER`; each block's insertion units | Units (below). |

Every entity keeps its handle, layer, type and block path (`CELL > CNC_MILL`).

**Not imported, always listed with the reason** (layout geometry, flagged in amber in the upload view): `ELLIPSE`, `SPLINE`, `HATCH`, `SOLID`, `TRACE`, 3D entities (`3DFACE`, `3DSOLID`, `BODY`, `MESH`, `REGION`, `SURFACE`), `XLINE`, `RAY`, images and underlays, curve-fitted, 3D or mesh polylines, array inserts (`MINSERT`), external references, inserts of undefined blocks, anything with a tilted extrusion, and any other entity type. **Not used** (annotation): dimensions, leaders, tolerances, points, viewports, tables, attribute definitions, and everything in paper space. Open lines stay on the plan and the 3D floor but are not built as objects, and the upload view says how many and on which layers.

**Refused, nothing stored:** DWG (recognised by its `AC10xx` signature or a `.dwg` name, with the route: *Save As (or Export) > DXF, AutoCAD 2000 or later, ASCII*), binary DXF, files that are not DXF, truncated files (no `EOF`), empty files, files over 10 MB, more than 5000 lines once blocks are expanded, more than 400 objects, blocks nested more than 8 deep or containing themselves.

## Units

The unit comes from the header only when it settles it: `$INSUNITS` is inches, feet, millimetres, centimetres or metres, `$MEASUREMENT` (if present) agrees (metric or imperial), and the layout is between 1 m and 2 km across in that unit. Otherwise the person is asked, and the reason is shown:

- no `$INSUNITS`, or `$INSUNITS 0` (unitless);
- another unit (for example yards);
- `$INSUNITS` and `$MEASUREMENT` disagree;
- the declared unit makes an implausible floor (a millimetre-sized hall, a 24 km room).

A block whose own insertion units differ from the drawing's is flagged ("check their size"); its instances are read at the scale they are inserted with. An arbitrary drawing scale (a scanned or scaled plan) is not supported here; that is IMP-02/IMP-03.

## How the draft is built

- **Floor:** the largest closed outline covering at least 40 % of the drawing's extent (not on a walkway or keep-clear layer) is *proposed* as the floor slab; the review decides (IMP-02). Without one, the floor is sized around the objects, for display only.
- **Objects:** every other closed outline and every top-level block insert. Kind from the layer and block names: walkway, keep-clear zone, column or wall (structure), otherwise equipment. Names: block attribute, text inside, block name, then the layer with a number ("Column 1"). A text names only the smallest outline holding it, and never an outline that holds other objects; so a note inside a building is not the building's name.
- **Footprint:** a drawn rectangle exactly; any other outline as its smallest enclosing rectangle (said so); a block as its extent as inserted. Each scene object's id is `obj-dxf-<handle>`, and the drawing records which object it became, so the link survives moves, undo, redo, save and reopen.
- **Placement:** the drawing's extent is centred on the world origin; drawing +X is world +X and drawing +Y is world −Z.

## What a beginner sees about assumed values

- **The upload view** says it before anything opens: "Heights: a floor plan has none. Each object gets a height assumed for display, marked as such, until you enter a real one. A check that needs a height will say *height needed*."
- **The 3D draft** draws every object whose height is assumed as see-through. A rack, table or bench, or conveyor (by its name) gets a simple stand-in shape inside its recorded box; anything else is a box. The selected object's label adds "(height assumed)", and the object list shows a **Height assumed** badge instead of an evidence mix.
- **The inspector** says where the object came from ("From the drawing hall-mm.dxf: LWPOLYLINE 104 on layer EQUIPMENT, named by the text inside it") and why its height is not real ("Height assumed for display (2.20 m): a floor plan has no heights … Type the real height under Size (H) to use it").
- **The contract** keeps the distinction:
  - footprints are `drawn`: a design drawing's size, not a site measurement (0.10.0; `measured` in 0.9.0, weakened on upgrade);
  - heights are `default`, which can never be `confirmed`;
  - an entered height becomes `user_supplied`.
- **Asking about an overhead check** answers **Height needed** and lists the objects. Clearance, throughput and floor-load questions name the missing input (route widths and access zones; cycle times and sequence; masses and floor rating). Nothing is inferred about load capacity, process, material or chemistry.

## Measured times

The first browser journey (`e2e/drawing.spec.ts`, `hall-mm.dxf`, 4.5 KB, 12 objects) was run 5 times with `ONB_TIMINGS` set. Setup: local API and Vite dev server, Playwright 1.64 headless Chromium, Apple M3 Pro, macOS 26.6.2. Raw rows: [onb-01/timings.jsonl](onb-01/timings.jsonl).

| Measurement | Median | Range |
| --- | --- | --- |
| File chosen → plan painted (in the page) | 32 ms | 23–36 ms |
| File chosen → draft built and checked by the API (in the page) | 24 ms | 22–26 ms |
| *Open the 3D draft* → walk view drawn (two clicks, no pause) | 523 ms | 514–551 ms |
| **First walkable draft** (draft ready + open to walk) | **546 ms** | 537–577 ms |

These are scripted timings on one machine, not onboarding measurements with people (UX-02). The reader alone takes 71 ms on a synthetic 700 KB drawing with 4,900 lines (the limit is 5,000).

## Tests

- **Contract:** `packages/contracts/tests/test_drawing_sources.py`:
  - drawn objects resolve to scene objects;
  - the unit is settled and used exactly;
  - the file is named by its hash;
  - a default is never confirmed or verified;
  - the 0.8.0 migration.
- **API boundary:** `services/api/tests/test_drawings.py`, on the synthetic fixtures in `fixtures/drawings/` (written by `scripts/build_dxf_fixtures.py`, checked by `pnpm fixtures:check`):
  - geometry and names of the dimensioned hall (mm);
  - transformed, mirrored and nested blocks (m), and the inch-block warning;
  - absent, unsupported, conflicting and implausible units;
  - every unsupported entity's reason;
  - DWG, binary, non-DXF, truncated and empty files refused and not stored;
  - a self-containing block;
  - text as content;
  - storage, idempotence, and the hash check on reopen.
- **Web units:** `src/drawing/world.test.ts` (world mapping, evidence text, compare, check answers) and `src/scene/displayForms.test.ts`.
- **Browser** (`e2e/drawing.spec.ts`):
  - import → walk → move → compare → undo/redo → save → reopen (`@smoke`, so it runs in CI);
  - the unit question;
  - a DWG, unsupported geometry, a cancelled upload and unsaved changes, each leaving the current scene as it was.

## Does this layout fit? (GEO-01/02, ADR-052)

A 2D check of the **reviewed design**: footprints on the floor plan, with the positions, sizes and turns as they are now. It is not a physical simulation, it never certifies the site as built, and it knows nothing about heights, loads, throughput or chemistry.

**Where it is.** On the simple screen, **Check layout** sits under "Play or compare". It opens the drawing panel's Check view:
- one sentence for footprints and keep-clear zones, and one for the route if one is asked;
- a small table: the drawing's own arrangement ("As drawn") against the edited one ("Now"), each with its own results; choosing a column shows that arrangement on the plan;
- the plan, with conflicts in red, approximations in amber, the route, its narrowest place and the points A and B;
- each finding, with buttons that select its objects;
- "Can an item get from A to B?": pick A and B on the plan, enter the item's width and, optionally, an allowance kept clear on each side;
- **Measurements and limits** (closed by default): every number to the millimetre, the tolerance, the grid resolution, what was tested and what is not checked.

While the Check view is open, the 3D view outlines the same objects and areas and draws the route. Every edit, undo, redo, review correction and scale change recomputes the answers. The route's points and width are kept while the app is open, not saved in the project.

**Three outcomes**, each naming its source (the drawing and how its scale was settled):

| Outcome | When |
| --- | --- |
| **Fits in the reviewed design** | Exact footprints, a reviewed drawing, and no conflict; for a route, a corridor of the needed width avoids everything, including anything uncertain |
| **Conflict found** / **Blockage found** | Two exact footprints overlap by more than 1 mm, one stands in a keep-clear zone or past the floor's edge; or the widest possible way is narrower than the item needs, by more than the grid's resolution |
| **Cannot determine yet** | The drawing is not reviewed; an object used is unreviewed, estimated or sized for display; the only routes pass uncertain geometry; a shape the drawing left out could be anywhere; or a blockage is within the grid's resolution of the need. The answer says which. "Not evaluated accurately" marks boxes that overlap where one only encloses its shape (a tank, a curved outline, a block) |

Overhead clearance answers **height needed** while a height is only for display.

**Footprints (GEO-01).**
- Overlap depth: the smallest push that separates the two turned rectangles (separating axes). Shortest gap: the exact distance between them. Tolerance: 1 mm; touching is not a conflict.
- Keep-clear zones are objects of kind keep-clear (as read, or corrected in the review). An object in one is a conflict; an open line or a left-out shape inside one means the zone cannot be confirmed clear.
- An object reaching past the reviewed floor outline is reported.
- A box that only encloses its shape is never reported as an exact collision. Clear boxes are clear, since the shape is inside its box.

**Routes (GEO-02).** The item needs a corridor of its width plus the allowance on each side. Nothing is assumed: no cart size, door opening or operating rule.
1. A distance field on a grid over the floor (2 cm cells, coarser for a floor larger than 64 m²) finds a route with A* that keeps half the corridor plus one cell clear.
2. The route is straightened, then checked exactly against every polygon at a quarter of a cell. Its narrowest passage is measured exactly with rays across it.
3. The search runs first avoiding everything, then avoiding only exactly known geometry, then for the widest possible way. Only the first can give "fits". The second gives "cannot determine yet" and names the uncertain shapes the route passes. The third gives a blockage, highlighted where it is narrowest, with the objects either side.
4. Every answer says **"Width-only route; turning not evaluated."** A long pallet, a turning forklift or an articulated vehicle may need more room at the turns.

**What the drawing leaves out (contract 0.11.0).** The reader now records where each left-out layout shape lies (its extent in drawing units), so it affects only answers near it. A shape that cannot be placed (inside a block, an insert, an infinite line, a picture, a curve that can bulge past its points) could be anywhere, so keep-clear zones and routes are not confirmed. A drawing read before 0.11.0 has no positions: upload it again. Accepting the omissions in the review never turns missing geometry into proof of a clear route.

**Fixture outcomes** (`fixtures/drawings/layout-checks-mm.dxf`, 20 m × 10 m in millimetres; each worked out by hand in `scripts/build_dxf_fixtures.py`):

| Case | Answer |
| --- | --- |
| Not reviewed | Cannot determine yet: the scale is not checked yet; the floor is only proposed; what the drawing leaves out is not yet accepted |
| As drawn, reviewed | Conflict: the mixer, turned 45°, overlaps the control panel by 0.231 m (8000 + 800√2 − 8900 mm); closest other pair: mixer and Rack A, 0.469 m |
| Mixer turned square | Fits; closest: mixer and control panel, 0.100 m |
| Machine B moved 1.2 m west | Conflict: 0.40 m into Keep-clear zone 1 |
| Packing table beside the round tank | Not evaluated accurately: the boxes overlap by 0.05 m, but the tank's box only encloses a round shape (the table's corner is 0.541 m from the tank's centre, outside its 0.5 m radius) |
| Control panel reclassified as keep-clear | Conflict: the mixer stands 0.23 m into it |
| Scale corrected to centimetres | Conflict: overlap 2.31 m |
| Keep-clear zone moved over the left-out spline | Cannot determine: the zone contains an omitted SPLINE |
| 1.20 m item, 0.10 m each side, along the aisle | Fits: narrowest passage 2.00 m between the racks |
| The same item through the partition's doorway | Blockage: 0.80 m between the partition's two halves; it needs 1.40 m |
| A 0.60 m item through the doorway | Cannot determine: the only route passes the omitted SPLINE 117 just beyond it |
| Machine B moved into the aisle | Blockage: 0.50 m between Machine B and a rack; as drawn, the route still fits |
| Rack B made 2.4 m deep | Blockage at the start: 1.30 m left of the aisle |
| Positions of left-out shapes unknown (a 0.10.0 file) | Cannot determine: they could be anywhere |

**Time.** On this machine (Node, Apple silicon), the footprint check takes under 3 ms and a route 30–65 ms when it fits, 90–115 ms when it is blocked (three searches) on the 20 m × 10 m fixture (about 155,000 cells).

**Tests.**
- `apps/web/src/checks/checks.test.ts`: each fixture outcome above.
- `services/api/tests/test_drawings.py`: where left-out shapes lie, and that an extent is never smaller than its shape.
- `packages/contracts/tests/`: the 0.11.0 record and migration.
- `e2e/layout-checks.spec.ts` (`@smoke`, simple screen): review → conflict → turn → fits → route fits → move → blocked → before and after → undo and redo → Compare → save → reopen → the doorway question.
- `e2e/geo-screens.spec.ts`: screenshots at 1440 × 900 and 1280 × 800 in [docs/geo-01/](geo-01/).

**Limits a manager will see.**
- Only the reviewed design: if the site differs from the drawing, so will the answer.
- Width only: no turning, no vehicle length, no reversing, no people passing.
- Heights are not checked: overhead questions answer "height needed" while heights are only for display.
- Working room around a machine is checked only where a keep-clear zone is drawn or marked in the review.
- A route is answered for the two points picked; other routes are not implied.
- Strength, floor loading, throughput, process chemistry and movement over time are not checked.

## Gaps

- **IMP-02 (still open):**
  - split and merge of drawn objects;
  - mapping equipment to catalog or generated models;
  - wall solids from wall lines (a single line has no thickness or height, so none is claimed);
  - closing an open shape into an object;
  - more than one known length, rotation or non-uniform scale.
- **UX-01:** done for the beginner-facing screen (see BACKLOG). Measuring it with people is UX-02.
- **GEO-01/02:** see [Does this layout fit?](#does-this-layout-fit-geo-0102-adr-052) for the limits. Not built: swept paths for vehicles with length and turning, overhead clearance with entered heights, per-machine service zones from supplier data, saving the route question in the project.
- **AGT-01:**
  - the orchestrator reads, settles the unit, builds and checks;
  - it does not match equipment to catalog or generated models, or propose changes;
  - it has no model step.
