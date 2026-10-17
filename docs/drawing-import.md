# Drawing import (IMP-01) and the first world from one file (ONB-01)

**Upload a plan. Walk through it. Change it. See what happens.** One DXF floor layout becomes a 3D draft that a first-time user can walk through, change and compare with the drawing. The draft is built by deterministic code: no language model is called, so the first view never waits for one. Decision: ADR-050 (with ADR-049); contract: [contracts.md, Drawing sources](contracts.md#drawing-sources-090-imp-01-and-onb-01).

## The journey

1. **Upload** (the first of the three main actions, also the first card of the start panel). The person chooses a `.dxf`. The API reads it and stores the original by its sha256; the plan appears at once with its names, what was found, and what was left out. The 3D draft is built and checked against the contract in the background.
2. **One question, only when needed.** If the drawing does not settle its unit, the person picks it from five, each shown with the size it implies ("millimetres → 12 m × 8 m"). Nothing gets a real size before that, and the answer is recorded as theirs.
3. **Open the 3D draft.** The open project is replaced only through the editor's usual unsaved-change check. The draft has the floor, named footprints, provisional display forms, and the drawing's lines on the 3D floor. Orbit, top and walk views work at once.
4. **Change something.** Objects are moved, turned, resized or removed with the existing editor (handles or fields), with undo and redo.
5. **Play or compare.** The drawing panel's Compare view shows the layout *as drawn* beside the layout *now*: a moved object is drawn where it is, with a dashed outline where the drawing has it, and every change is listed ("Press 1 moved 2.00 m"). **Walk through it** enters the walk view. The panel says plainly that route, process and physical checks are not available yet, so nothing is animated and no clearance result is shown.
6. **Save and reopen.** The project file holds the drawing's reading and every link; reopening checks the stored DXF against its sha256.

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
| `LWPOLYLINE`, 2D `POLYLINE` with straight segments | A plan line; a closed one is a candidate object (or the floor). |
| `INSERT` of a block | One object per top-level insert. Insertion point, base point, X/Y scale (negative scale mirrors), rotation, extrusion +Z or -Z (mirrored), nested inserts up to 8 deep. Its footprint is the block's extent as inserted. |
| `TEXT`, `MTEXT`, `ATTRIB` | Names only: a block's `NAME`/`LABEL`/`TAG`/`ID`/`EQUIPMENT`/`DESCRIPTION`/`TITLE` attribute, or the text nearest the centre inside an outline. Recorded as content, never followed. |
| Header `$INSUNITS`, `$MEASUREMENT`, `$ACADVER`; each block's insertion units | Units (below). |

Every entity keeps its handle, layer, type and block path (`CELL > CNC_MILL`).

**Not imported, always listed with the reason** (layout geometry, flagged in amber in the upload view): `ARC`, `CIRCLE` (a round column or tank is *not* imported), `ELLIPSE`, `SPLINE`, `HATCH`, `SOLID`, `TRACE`, 3D entities (`3DFACE`, `3DSOLID`, `BODY`, `MESH`, `REGION`, `SURFACE`), `XLINE`, `RAY`, images and underlays, polylines with arc segments (bulges), curve-fitted, 3D or mesh polylines, array inserts (`MINSERT`), external references, inserts of undefined blocks, anything with a tilted extrusion, and any other entity type. **Not used** (annotation): dimensions, leaders, tolerances, points, viewports, tables, attribute definitions, and everything in paper space. Open lines stay on the plan and the 3D floor but are not built as objects, and the upload view says how many and on which layers.

**Refused, nothing stored:** DWG (recognised by its `AC10xx` signature or a `.dwg` name, with the route: *Save As (or Export) > DXF, AutoCAD 2000 or later, ASCII*), binary DXF, files that are not DXF, truncated files (no `EOF`), empty files, files over 10 MB, more than 5000 lines once blocks are expanded, more than 400 objects, blocks nested more than 8 deep or containing themselves.

## Units

The unit comes from the header only when it settles it: `$INSUNITS` is inches, feet, millimetres, centimetres or metres, `$MEASUREMENT` (if present) agrees (metric or imperial), and the layout is between 1 m and 2 km across in that unit. Otherwise the person is asked, and the reason is shown:

- no `$INSUNITS`, or `$INSUNITS 0` (unitless);
- another unit (for example yards);
- `$INSUNITS` and `$MEASUREMENT` disagree;
- the declared unit makes an implausible floor (a millimetre-sized hall, a 24 km room).

A block whose own insertion units differ from the drawing's is flagged ("check their size"); its instances are read at the scale they are inserted with. An arbitrary drawing scale (a scanned or scaled plan) is not supported here; that is IMP-02/IMP-03.

## How the draft is built

- **Floor:** the largest closed outline covering at least 40 % of the drawing's extent (not on a walkway or keep-clear layer) becomes the floor slab. Without one, the floor is sized around the objects.
- **Objects:** every other closed outline and every top-level block insert. Kind from the layer and block names: walkway, keep-clear zone, column or wall (structure), otherwise equipment. Names: block attribute, text inside, block name, then the layer with a number ("Column 1").
- **Footprint:** a drawn rectangle exactly; any other outline as its smallest enclosing rectangle (said so); a block as its extent as inserted. Each scene object's id is `obj-dxf-<handle>`, and the drawing records which object it became, so the link survives moves, undo, redo, save and reopen.
- **Placement:** the drawing's extent is centred on the world origin; drawing +X is world +X and drawing +Y is world −Z.

## What a beginner sees about assumed values

- **The upload view** says it before anything opens: "Heights: a floor plan has none. Each object gets a height assumed for display, marked as such, until you enter a real one. A check that needs a height will say *height needed*."
- **The 3D draft** draws every object whose height is assumed as see-through. A rack, table or bench, or conveyor (by its name) gets a simple stand-in shape inside its recorded box; anything else is a box. The selected object's label adds "(height assumed)", and the object list shows a **Height assumed** badge instead of an evidence mix.
- **The inspector** says where the object came from ("From the drawing hall-mm.dxf: LWPOLYLINE 104 on layer EQUIPMENT, named by the text inside it") and why its height is not real ("Height assumed for display (2.20 m): a floor plan has no heights … Type the real height under Size (H) to use it").
- **The contract** keeps the distinction: footprints are `measured` from the drawing, heights `default`, which can never be `confirmed`. An entered height becomes `user_supplied`.
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

## Gaps

- **IMP-02 (review):**
  - wall lines are shown but not built as wall solids (a single line has no thickness or height);
  - a scaled or unitless drawing can only be given one of five units, not a measured length;
  - a mistaken object can be moved, resized or removed, but not split, merged or re-kinded in place;
  - circles (round columns, tanks) and arcs are listed, not drawn.
- **GEO-01/02:**
  - there is no clearance, route or overhead check yet;
  - the panel only explains what each would need;
  - "height needed" is computed but no check consumes it.
- **AGT-01:**
  - the orchestrator reads, settles the unit, builds and checks;
  - it does not yet match equipment to catalog or generated models, or propose changes;
  - no model step exists, so naming by Voyager and its cancellation are not built.
- **UX-01:** the three actions lead the screen, but the editor's panels (object list, catalog, inspector) are always shown rather than contextual.
