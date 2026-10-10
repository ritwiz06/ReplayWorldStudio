# Contracts: units, frames, provenance and the schema pipeline

Contract version **0.4.0** (`SCHEMA_VERSION`; 0.1.0 → 0.2.0 in WRL-01, 0.2.0 → 0.3.0 in WRL-02, 0.3.0 → 0.4.0 in WRL-03, all 2026-10-10). Source: [`packages/contracts/python/replay_world_contracts/models.py`](../packages/contracts/python/replay_world_contracts/models.py).

## One source of truth

```
Pydantic models (Python)
   │  python -m replay_world_contracts.schema
   ▼
packages/contracts/schema/contracts.schema.json   (JSON Schema 2020-12 bundle, committed)
   │  json-schema-to-typescript (scripts/contracts.mjs)
   ▼
packages/contracts/ts/generated/contracts.ts       (TypeScript types, committed)
   +  packages/contracts/ts/index.ts compiles the same schema with Ajv for runtime checks
```

- `pnpm contracts:generate` rewrites both generated files; `pnpm contracts:check` (run in CI) fails if they are stale.
- Every field is required (nullable where a value may be absent), so the validation and serialization schemas are identical. A test enforces this.
- Two export adjustments, both tested: field titles are omitted (they would create one TS alias per property), and `discriminator` is reduced to `{propertyName}` with `type: "object"` because Ajv does not support `mapping`. Fields that reference another model must not carry `Field(description=...)`: a sibling keyword next to `$ref` makes the TS generator duplicate the interface (guarded by `test_refs_have_no_sibling_keywords`).

## Who validates what

| Rule | Pydantic (API) | Ajv (browser) |
| --- | --- | --- |
| Types, required fields, closed objects (`extra="forbid"`) | yes | yes |
| Strict numbers (no `"20"` for 20) | yes (`strict=True`) | yes |
| Finite numbers | yes (`allow_inf_nan=False`) | JSON cannot encode NaN/Infinity, so `JSON.parse` rejects them first |
| Positive lengths, ID pattern, enums, schema version | yes | yes |
| Evidence required on every dimension axis | yes | yes |
| Known vs unknown parameter shape | yes | yes (`oneOf` on `state`) |
| License identifier *syntax* (SPDX id, `LicenseRef-…` or `NOASSERTION`) | yes | yes |
| Unique object / parameter / source / catalog-asset IDs | yes | **no** - JSON Schema cannot express it |
| `asset_id` resolves to a catalog entry of the same `kind` | yes | **no** |
| `NOASSERTION` license ⇒ redistribution `unknown`; vendor/third-party source cites a reference | yes | **no** |
| Value inside its uncertainty bounds; bounds ordered; length bounds above 0 | yes | **no** |
| Older schema version → one actionable "upgrade with the migrate command" message | API only | rejects at `/schema_version` |
| glTF path pattern, sha256 format, declared axes/origin/fit, distortion range | yes | yes |
| Model bounds have their origin at the bottom-centre; nominal size equals model extents | yes | **no** |
| Model file exists in the catalog library, stays inside it and has the recorded sha256 | API (on open) | browser re-checks the downloaded bytes |
| Edit-record shapes (`object_edited` / `object_added` / `object_removed`), revision ≥ 1 | yes | yes |
| Edit log describes the scene: increasing revisions ≤ scene revision, real changes only, edited axes `user_supplied`, removed IDs not reused, latest recorded values equal the scene's | yes | **no** (the browser's command engine produces consistent logs; the API checks every opened file) |

The browser only renders data that passed Ajv, and opens a local file only after the API accepted it. Python's `json.loads` accepts a bare `NaN` token, so the API's finite-number rule is what rejects `fixtures/invalid/nonfinite-coordinate.json`.

## Units and frames

- Internal units: metres (`_m`), seconds, kilograms, radians (`_rad`). `ParameterUnit` admits `m`, `s`, `kg`, `rad`, `m/s` and `1` (dimensionless).
- World: right-handed, +Y up, floor in X-Z. This equals Three.js's convention, so the renderer applies positions and rotations unchanged.
- `EulerRotation` uses order `XYZ` with Three.js semantics: R = Rx(x) · Ry(y) · Rz(z).
- `Transform.position_m` is the **bottom-centre** of the object's bounding box, so floor-standing objects have `y = 0`. The renderer places a group at that point and offsets the box mesh by half its height in local space.
- `Dimensions` are physical extents along the object's local X (`width`), Y (`height`) and Z (`depth`). Each is a `Length` with its own evidence (see below). There is no visual scale factor in the contract.

## Source-to-world transform

`SourceToWorldTransform` maps a 2D plan point (u, v), in source units, to world metres:

1. scale by `metres_per_source_unit` (for example 0.001 for millimetres);
2. convention `plan_xy_to_world_x_neg_z`: plan +X → world +X, plan +Y (up the sheet) → world −Z;
3. rotate about world +Y by `rotation_about_world_y_rad` (right-hand rule: +X turns toward −Z);
4. translate by `translation_m`; its `y` is the plan's floor elevation.

Worked example (foundation fixture): the plan is in mm with translation (−10, 0, 6) m. Column C1 at plan (14000, 9000) mm → scale (14, 9) m → axes (14, −9) → translate (4, 0, −3) m, which is exactly the column's `position_m`. `test_fixture_column_plan_point_lands_at_its_world_position` checks this.

## Provenance and unknowns

- Known values carry `origin` (`measured`, `user_supplied`, `supplier`, `inferred`, `default`), `review_status` (`unreviewed`, `confirmed`), an optional `source_ref` and optional inclusive `uncertainty` bounds. Bounds are not a calibrated probability.
- Unknown values are `{"state": "unknown", "id", "label", "unit", "reason"}` and cannot carry `value`.
- **Per-axis dimension evidence (0.2.0).** `width`, `height` and `depth` are each a `Length`: `value_m` (> 0), `origin`, `source_ref`, `review_status` and optional inclusive `uncertainty_m`, whose lower bound must be above 0 and which must contain the value. A footprint measured from a plan and a height inferred from a catalog entry are therefore recorded honestly, axis by axis. The fixture's packing station is the worked example: Measured ±10 mm / Inferred / Measured.
- **Dimensions are required, never unknown.** Placement, rendering and later clearance checks need extents. An axis nobody has established uses origin `default` with an explanation in `source_ref`; the UI labels it "Default placeholder - not real data". Parameters such as cycle time or mass *can* be unknown. Unknown axes (for footprint-only imports) were considered and deferred to M2 (ADR-015).

## Catalog assets and references

- `Project.catalog` holds `CatalogAsset` records: stable `id`, `name`, `kind`, `visual`, `nominal_dimensions` (per-axis evidence), `source` and `rights`. Assets live inside the project, so a project file is self-contained.
- `source.kind` is `synthetic`, `in_house`, `vendor` or `third_party`; vendor and third-party sources must give a `reference` (URL, catalogue number or document).
- `rights.license` is a single SPDX identifier (e.g. `CC0-1.0`), a `LicenseRef-…` identifier for custom terms, or `NOASSERTION` when the license is not known. Only the identifier *syntax* is checked, not membership of the SPDX list. With `NOASSERTION`, `redistribution` must be `unknown`. `attribution` and `terms_ref` are explicit, nullable fields.
- `visual` is either `{"type": "placeholder_box"}` (provisional) or a glTF visual (0.3.0, below).
- `SceneObject.asset_id` is a catalog `id` or `null` for scene geometry (floors, columns, references). Every non-null reference must resolve to a catalog entry of the same `kind`. Unused catalog entries are allowed.
- An instance keeps its own `dimensions`, because an installed item may be measured differently from its catalog entry. The inspector compares instance and nominal size and names any differing axis rather than averaging them.
- The fixture's three assets are synthetic placeholders with `license: NOASSERTION` because no project license has been chosen.

## Schema versions and older files

- `Project` accepts **only** the current `schema_version`. There are no silent defaults for missing fields.
- Older documents are upgraded explicitly by `replay_world_contracts.migrations.upgrade_document`, or from the command line:
  `uv run python -m replay_world_contracts.migrate OLD.json -o NEW.json`. The command validates the result, writes notes describing every change to stderr, and never modifies the input.
- 0.1.0 → 0.2.0 is lossless and never strengthens evidence. The single box origin, source and review status are copied to all three axes; `representation: placeholder_box` becomes `asset_id: null`; an empty `catalog` is added. Unknown or newer versions are refused.
- 0.2.0 → 0.3.0 changes only `schema_version`, because 0.3.0 is additive. Steps run in sequence, so a 0.1.0 file passes through every version and the notes list each step.
- `POST /api/v1/projects/validate` answers a 0.1.0, 0.2.0 or 0.3.0 document with a single 422 issue at `/schema_version` that points to the editor's upgrade review and the migrate command, instead of a cascade of field errors.
- 0.3.0 → 0.4.0 adds an empty `scene.edit_log` and changes nothing else. A 0.3.0 document that already has an `edit_log` is refused as malformed.
- `fixtures/legacy/foundation-scene-0.1.0.json` is the exact 0.1.0 fixture, kept to test this path.
- **In the editor (WRL-03).** Opening a file whose `schema_version` is any other string sends it to `POST /api/v1/projects/upgrade`. That endpoint runs the same `upgrade_document`, validates the result (contract and model files), and returns an `UpgradeReport` (`from_version`, `to_version`, `notes`, `project`, `validation`) without storing anything. The browser shows the notes and offers **Open upgraded project**, **Download upgraded file** (`<name>-0.4.0.json`) or **Cancel**; nothing is replaced or written before that choice. An unknown version gets one 422 issue at `/schema_version`, a malformed legacy file one issue at the document level, and errors after a successful upgrade are located in the upgraded document. In each case the current scene stays.

## Edits, revisions and the edit log (0.4.0)

Every change the editor makes goes through one typed command engine (`apps/web/src/editing/commands.ts`): `set_transform`, `set_dimensions`, `add_instance`, `duplicate_object`, `remove_object`. Numeric fields, handles, catalog placement and duplication all produce these commands.

- **Revisions.** `scene.revision` advances by exactly one for every accepted command, **undo and redo**. Each command, undo and redo states the revision it was prepared against; a mismatch is refused as a conflict and nothing changes. The revision therefore counts transitions, not distinct states: after an edit and its undo the objects are back where they were, but the revision is 2.
- **All or nothing.** A command is checked completely before anything is built (finite values; |coordinate| ≤ 1000 m; |angle| ≤ 360°; lengths 1 mm – 1000 m; new IDs match the ID pattern, are unique and were never used before in the project, including in its edit log). A multi-axis resize with one bad axis changes no axis. The resulting project must also pass the contract schema. These editor limits are stricter than the contract, which only requires finite values and positive lengths.
- **Units.** The UI shows metres (1 mm resolution) and degrees (0.1°); the contract stores metres and radians. Fields refuse more decimals than their resolution rather than rounding. Handles snap to 10 mm and 15° (1 mm and 1° with snap off). Both paths use the same conversion functions (`apps/web/src/editing/units.ts`), so a handle stopped at 2.35 m stores exactly the double that typing `2.35` stores. Width and depth handles resize symmetrically about the vertical axis and height grows upwards, so the bottom-centre position is unchanged, which is exactly what typing a new size does.
- **`scene.edit_log`** lists, oldest first, the edits in effect:
  - `object_edited` records the transform `{before, after}` and/or each changed axis `{axis, before, after}`, where `before` is the complete previous `Length` with its origin, source, review status and uncertainty;
  - `object_added` records `asset_id` and `duplicate_of`;
  - `object_removed` keeps the removed object, evidence included.

  An undone edit leaves the log (so record revisions can have gaps) and redo puts it back at the new revision. The undo history itself lives only in the browser session and is not saved.
- **Evidence of edited values.** An edited axis becomes `origin: user_supplied`, `review_status: unreviewed`, `uncertainty_m: null`, `source_ref: "Entered in the editor; the previous value and its evidence are in the scene edit log"`. Untouched axes keep their evidence. A new catalog instance starts with the asset's nominal dimensions and their evidence; a duplicate copies its source's dimensions, evidence, asset and parameters. Transforms have no evidence fields; their history is the `transform` part of the records.
- **Consistency (API).** The log must describe the scene:
  - revisions strictly increase and do not exceed the scene revision;
  - every record changes something;
  - an edited axis is `user_supplied`;
  - removed IDs do not reappear;
  - an added instance keeps its asset, and that asset is in the catalog;
  - an edited or added object either exists or was removed later;
  - the latest recorded transform and axis values equal the scene's.

  A value changed outside the editor without a record therefore makes the file invalid.
- **Not checked.** Edits are not checked for overlap, clearance, collisions or physical feasibility (M3). An edited layout is labelled "Edited layout - not checked for clearance or feasibility", and development fixtures keep their `fixture` label through every edit and save.
- **Worked example.** `fixtures/edited/foundation-edited.json` is the foundation fixture after nine transitions: move, resize (measured ±10 mm width → user-supplied 1.35 m), rotate, add, duplicate, remove, **undo** of that removal, resize and remove. Its log holds revisions 1–5, 8 and 9. The browser engine regenerates it byte-for-byte (`sample.test.ts`), and pytest validates it with the Pydantic models.

## Saved project files

- **Save** downloads the complete project as pretty-printed JSON named `<project-id>-r<revision>.json`. Reopening goes through the normal file check (API validation including model files, then the browser's schema check). The reopened project has the same model, IDs, transforms, dimensions, evidence and edit log, and saving it again produces identical text.
- Numbers are written in JavaScript's shortest round-trip form (`-6` rather than Python's `-6.0`; the values are equal). JSON cannot represent `-0`, so the editor normalises `-0` to `0` before storing it.
- A project is **unsaved** whenever its revision differs from the revision last loaded or saved, including after undoing back to the loaded state, and an opened upgrade is unsaved until saved. Loading a fixture or opening another valid file while unsaved first asks: save then continue, discard, or cancel.

## glTF visuals (0.3.0)

A `GltfVisual` names a binary glTF file and states exactly how it is authored, so the renderer never has to guess.

| Field | Meaning |
| --- | --- |
| `uri` | Path relative to the catalog library root, for example `models/belt-conveyor-3m.glb`. Lowercase segments, at most five directories, `.glb` only. No `..`, absolute paths, URL schemes, backslashes, query strings or hidden files. `.gltf` is excluded because it can reference further files by arbitrary URI. |
| `sha256` | SHA-256 of the exact file bytes. The file is the one with this hash, not merely the one at this path. |
| `metres_per_model_unit` | File coordinates × this factor = metres (1.0 for normal glTF). |
| `up_axis` / `front_axis` | Always `+Y` and `+Z`, following the glTF convention: the equipment's front (operator side, HMI) faces +Z. |
| `origin` | Always `bottom_centre`: the model's bounding-box bottom-centre is at (0, 0, 0). Checked against `model_bounds_m` to 0.1 mm. |
| `model_bounds_m` | Axis-aligned bounds in metres. The asset's `nominal_dimensions` must equal these extents to within 1 mm. |
| `fit` | Always `scale_to_dimensions` (below). |
| `max_fit_distortion` | Largest per-axis scale departure from 1 (0 – 0.5) still shown as faithful; the demo uses 0.05. |

**How a model relates to an instance's physical dimensions.** The recorded `dimensions` are the truth, and the model is only a picture of them. The renderer scales the model on each axis by `dimension / model extent` (after the unit factor) and places it at the instance's bottom-centre with its rotation. Because the authored origin is the bottom-centre, the scaled model stands on the instance's floor level and covers exactly its recorded footprint. Physical dimensions are never derived from a model. If an instance's dimensions require a per-axis scale beyond `max_fit_distortion`, the inspector says the model is stretched and that its proportions may mislead. Tests check that every demo instance's drawn bounds equal its recorded box to within 0.1 mm, including the rotated pallet and a deliberately stretched conveyor.

## Model files: resolution, verification and failure

- **Library.** The API serves models from one catalog library directory, `RWS_CATALOG_DIR`, by default `<repo>/assets/catalog`, at `GET /api/v1/catalog/files/{uri}`. A reference resolves only if it matches the path pattern **and**, after following symbolic links, lands on a regular file inside the library. Otherwise the API returns 400 (unsafe) or 404 (missing, with a rebuild hint). Nothing else is served in its place.
- **Opening a project file.** `POST /api/v1/projects/validate` checks every glTF reference: the file must exist in the library and its bytes must have the recorded sha256. A missing file or a hash mismatch rejects the whole document with a located issue (`/catalog/{i}/visual/uri` or `/catalog/{i}/visual/sha256`), and the current scene is kept.
- **Loading in the browser.** The browser downloads each model through the API, recomputes its sha256, parses it as GLB and measures its bounds against `model_bounds_m` (to 1 mm) before drawing. Each failure is classified: not found, unsafe path, network, HTTP error, hash mismatch, invalid glTF or bounds mismatch. The affected instances are drawn as an orange box at the recorded size labelled "Model unavailable", and a notice names the asset, gives the reason and the remedy, and offers a retry. Other models still load.
- **Portability limits.** A project JSON is not self-contained when it uses glTF visuals: it names files by library path and hash, not by content. Opening it elsewhere requires a catalog library with byte-identical files at the same paths. If the files are absent, the API rejects the file on open, and the stated dimensions and evidence in the JSON remain intact. Changing three.js, the generator or a model's geometry changes the bytes and so the hash; regenerate with `pnpm assets:build` and `pnpm fixtures:build`. A future export bundle (REL-01) should package the model files with the project.

## Floor markings (0.3.0)

`walkway` (circulation space) and `keep_clear` (area that must stay unobstructed, such as electrical-panel access) are object kinds. They are drawn as paint at their recorded footprint (green with yellow edges, or yellow and black hatching), are walkable in walk mode, and carry no catalog asset. They state intent for later spatial checks (M3); nothing checks them yet.

## Rendering tolerance

The contract is float64, but Three.js geometry buffers are float32 (about 1e-7 relative precision). Renderer placement tests therefore use a 1 µm tolerance. Never read numeric results back from rendered geometry.
