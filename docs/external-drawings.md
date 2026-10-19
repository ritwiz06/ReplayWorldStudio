# External drawings: what real files do in the app (2026-10-18)

**Scope.** Five small files downloaded into the git-ignored `data/external/`, plus three copies made from them. None is committed, and no screenshot of them is published here. The checks are reproducible with the local-only browser tests in `apps/web/e2e/external/`, which skip when the files are absent:

```bash
pnpm --filter @replay-world/web test:e2e:external
```

> **What this shows.** Testing real drawings validates the import and review workflow. It does **not** validate any prediction of real output: none of these drawings carries staffing, cycle times or operating behaviour, and nothing was observed on site. Every number in a run below comes from values typed for the exercise or illustrative assumptions accepted for it.

## Files

| File | Source and rights | Bytes · SHA-256 | Site or authored | Result |
| --- | --- | --- | --- | --- |
| `floor_UG1.dxf` | [Hilti × Trimble × Oxford 2026 dataset](https://huggingface.co/datasets/Hilti-Research/hilti-trimble-slam-challenge-2026), `floorplans/dxf_format/`. CC BY-NC-SA 3.0. Maintainers: the plans are "not officially registered" and "show the intended state of the building at the end of construction" (about 1 cm accuracy, with as-built deviations). | 352,733 · `208631946e4d…16e4bf5b5` | Real site, as planned | **Imported and reviewed** (details below) |
| `floor_UG1.png` | Same dataset, `floorplans/png_format/` (SHA-256 matches its LFS id) | 8,727,771 · `0c11cd526b91…1209322a` | Real site, as planned | **Rejected:** 11,890 × 8,411 px (100 MP); the limit is 50 MP |
| ↳ `floor_UG1-8000.png` | Copy: macOS `sips -Z 8000` (uniform downscale) | 9,620,314 · `982586c45b75…71bae4c66` | — | **Imported as a picture**, held at "no scale yet": the picture states no pixel size, so no length was marked |
| `garage-and-workshop-72-m2.dxf` | [InnerScene](https://www.innerscene.com/tools/library/drawings/garage-and-workshop-72-m2-dc7d743c), original model, CC0-1.0 (SHA-256 matches the one published) | 40,547 · `845563c0149c…1440f61c` | Authored example; nominally 9 × 8 m in mm | **Imported, reviewed, full guided Run a day journey** |
| `innerscene-studio-floor-plan.dwg` | [InnerScene](https://www.innerscene.com/tools/library/drawings/studio-floor-plan-193f4ec8). Licence field CC0-1.0, but its description says "License: Innerscene" (discrepancy noted). SHA-256 matches. | 26,224 · `e2dd2e3b9b88…53a4897ce` | Authored example | **Rejected with the export instruction; conversion required.** No installed tool exports DXF (no ODA or LibreDWG; LibreOffice cannot export DXF). The source site's browser viewer offers an export; it was not used. |
| `houston-white-sheet-00002a.tif` | [Library of Congress, HAER DE-6](https://www.loc.gov/pictures/resource/hhh.de0211.sheet.00002a/), sheet 2 of 5: first floor plan, Houston-White Company Mill & Basket Factory, Millsboro DE. Delineator Deborah Ann Campbell, 1975. Rights: "No known restrictions on images made by the U.S. Government; images copied from other sources may be restricted". The HTML page sat behind a bot check, so the JSON API and the master TIFF URL were used. | 532,232 · `26aa4b21e41f…a9fc91b5d` | Real building (1905), measured drawing | Converted (below) |
| ↳ `…-00002a.png` | macOS `sips -s format png`: 1-bit, the same 14,432 × 9,632 pixels | 806,044 · `326d7450c640…902cf9ee` | — | **Rejected:** 139 MP; the limit is 50 MP |
| ↳ `…-00002a-8000.png` | `sips -Z 8000` of that PNG | 249,244 · `46e0ccc8887b…5a410471` | — | **Imported as a picture, scaled, one room traced** |

In every rejection the app says why, the open project is kept, and nothing is imported.

## What each real drawing provides

- **Hilti `floor_UG1.dxf`** (read in 0.16 s; AC1021, written by dxfrw 0.6.3; unit metres from the header; 61.4 × 71.8 m):
  - **36 objects**, all named from layer names (5 stairs, 27 columns, 1 outer wall, 3 inner walls). All are typed "equipment" until the review corrects them; 8 outlines only *enclose* their shapes.
  - **Shown but not built:** 1,416 open lines (628 on doors, 258 on stairs, 204 outer and 211 inner walls, 44 partitions, 71 on the ramp).
  - **Not imported:** 10 shapes (5 hatches, 5 empty blocks).
  - **No closed floor outline,** so the floor is display-only and routes cannot be checked until the reviewer traces it. Tracing a floor on a DXF is new in this change.
  - **No production stations:** it is a construction plan of walls, columns and stairs. Run a day correctly asks for stations; nothing is suggested from the drawing.
- **Workshop DXF:**
  - **24 objects:** 15 wall pieces, 7 "Fixtures 1–7" (two cars and their cabins, a bench, a cabinet, store shelving), and 2 title-block shapes.
  - **35 open lines** (doors, windows, dimensions); 16 hatches skipped.
  - **No floor outline.** Each wall-fill hatch's box covers whole rooms, and every doorway holds door-swing lines.
  - **Before this change, every route was "cannot determine".** It became checkable once the reviewer:
    - traced the floor on the wall corners;
    - marked the title-block shapes "not an object";
    - marked the DOORS, WINDOWS, WALLS, DIMENSIONS and TITLE_BLOCK layers as drawing symbols.

    The route to the vehicle bays stays honestly **blocked**: a drawn car leaves 0.39 m beside the store door.
- **Houston-White Mill (8000 px copy):**
  - The sheet's printed metric scale bar (0–10 m) gives **1 px = 1.419 cm**, each point within about 32 cm at the default zoom. The full image's bar spans 1,265 px for 10 m.
  - The Machine Shop was traced as one object: 9.18 × 10.13 m, traced to within 63 cm.
  - The floor is still the picture's edge, so no check or route is available until the building outline is traced.
  - The drawing documents the 1905 building, not its workers, machine cycles or operation.

## The guided journey on the workshop

Times below were measured by a script, not by people using the app.

| | |
| --- | --- |
| **Stations** | Store shelving (Fixtures 7, material) → Workbench (Fixtures 5) → Kit cabinet (Fixtures 6). The drawing names all three "Fixtures n", so each had to be renamed first. |
| **Typed** | "kit"; workbench 6 min per kit |
| **Accepted as illustrative** | Cabinet 2 min per kit, 2 people, attended the whole time. Queues 2, carrying 0.6 m + 0.1 m each side at 1.0 m/s with 10 s handling, walking 1.2 m/s through 0.8 m, worker sides chosen clear on the plan. Shift 06:00–14:00 with breaks at 09:00 (15 min) and 12:00 (30 min). |
| **Routes** | Store shelving ↔ Workbench 6.5 m; Workbench ↔ Kit cabinet 4.2 m |
| **Run** | **66 kits** completed, 2 unfinished; workbench 83 % busy (it sets the pace). Fingerprint `01a894ac49ba38`. |
| **Workbench moved 1.5 m east** | Store ↔ Workbench 5.0 m, but **Workbench ↔ Kit cabinet blocked**: the cabinet's worker spot is now 0.20 m from the bench. **0 kits**, and the comparison names the route and why. |
| **Workbench moved 1.0 m east** | Routes 5.5 m and 3.3 m (about 1 s less each way at the entered speed). **Output the same, 66 kits:** the workbench sets the pace, so shorter walks only change how the people's time is spent. |
| **Undo, save, reopen** | The same fingerprint `01a894ac49ba38` each time |
| **Scripted effort** | 42 clicks, 43 characters typed. Upload 3.6 s, review 1.0 s, guided setup 1.0 s, move-run-compare 2.6 s, undo-save-reopen-replay 4.4 s (headless Chromium, software WebGL). |

## Friction found

- **Pictures over 50 MP are refused.** Real scans exceed this: the Hilti PNG is 100 MP and the HAER sheet 139 MP. The message says to export a smaller copy; a built-in downscale would remove that step.
- **CAD files often have no closed floor outline:** both DXFs here. The floor must be traced in the review before routes can be checked; Run a day says so.
- **Door swings and wall hatches make routes "cannot determine"** until the reviewer marks those layers as drawing symbols. The decision is now available, per layer, in the review.
- **Layer-derived names** ("Fixtures 5", "020 Stützen 12") must be renamed before they can be stations. Every Hilti object is typed "equipment".
- **Moving an object by an exact amount** needs Details (the position field). The simple screen offers dragging only.
- **DWG** still needs an external export to DXF.
