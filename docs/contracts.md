# Contracts: units, frames, provenance and the schema pipeline

Contract version **0.9.0** (`SCHEMA_VERSION`; 0.1.0 → 0.2.0 in WRL-01, 0.2.0 → 0.3.0 in WRL-02, 0.3.0 → 0.4.0 in WRL-03, 0.4.0 → 0.5.0 in GEN-01, all 2026-10-10; 0.5.0 → 0.6.0 in IMG-01, 2026-10-14; 0.6.0 → 0.7.0 in GEN-02, 2026-10-15; 0.7.0 → 0.8.0 in IMG-02, 2026-10-16; 0.8.0 → 0.9.0 in ONB-01/IMP-01, 2026-10-16). Source: [`packages/contracts/python/replay_world_contracts/models.py`](../packages/contracts/python/replay_world_contracts/models.py).

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
| Edit-record shapes (`object_edited` / `object_added` / `object_removed` / `asset_revised`), revision ≥ 1 | yes | yes |
| Edit log describes the scene: increasing revisions ≤ scene revision, real changes only, edited axes `user_supplied`, removed IDs not reused, latest recorded values equal the scene's | yes | **no** (the browser's command engine produces consistent logs; the API checks every opened file) |
| Photo source shape: a `photo` has a file name, sha256, `image` and `photo_import` and no `source_to_world`; other kinds the reverse; the stored path is named by the sha256; a floor rectangle has a `user_supplied` side; an accepted observation names its object and a rejected one none; linked objects exist or were removed | yes | **no** |
| Source photo exists in the source library and has the recorded sha256 | API (on open; a missing file may be allowed with `missing_sources=allow`) | **no** |
| Asset revisions: `revises` names a generated asset in the catalog and `version` is one above its version; `asset_revised` names catalog assets, and each object's asset reference, followed through `object_added` and `asset_revised` records, equals the scene's | yes | **no** (the browser's `revise_asset` command produces consistent records) |
| An `assumed` scale size is not `confirmed` | yes | **no** |

The browser only renders data that passed Ajv, and opens a local file only after the API accepted it. Python's `json.loads` accepts a bare `NaN` token, so the API's finite-number rule is what rejects `fixtures/invalid/nonfinite-coordinate.json`.

## Units and frames

- Internal units: metres (`_m`), seconds, kilograms, radians (`_rad`). `ParameterUnit` admits `m`, `s`, `kg`, `rad`, `m/s` and `1` (dimensionless).
- World: right-handed, +Y up, floor in X-Z. This equals Three.js's convention, so the renderer applies positions and rotations unchanged.
- `EulerRotation` uses order `XYZ` with Three.js semantics: R = Rx(x) · Ry(y) · Rz(z).
- `Transform.position_m` is the **bottom-centre** of the object's bounding box, so floor-standing objects have `y = 0`. The renderer places a group at that point and offsets the box mesh by half its height in local space.
- `Dimensions` are physical extents along the object's local X (`width`), Y (`height`) and Z (`depth`). Each is a `Length` with its own evidence (see below). There is no visual scale factor in the contract.

## Source-to-world transform

`SourceToWorldTransform` maps a 2D plan point (u, v), in source units, to world metres. Drawings and plans need one; a `photo` source has `source_to_world: null`, because a perspective photo maps to the floor only through its calibration (see [Photo sources](#photo-sources-060-img-01)):

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
- **A display default is never verified (0.9.0, ADR-050).** A `default` length cannot be `confirmed`; the real value is entered instead, which makes it `user_supplied`. A check that needs a verified value relies only on `measured`, `supplier` or `user_supplied` evidence (`VERIFIED_ORIGINS`, `is_verified`). An `inferred` value is an estimate and a `default` a display placeholder: such a check reports the value as needed (for a height, "height needed") and never uses it. The editor draws a standing object whose height is a default see-through and labels it "height assumed".

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
- `POST /api/v1/projects/validate` answers a document of an older version (0.1.0–0.8.0) with a single 422 issue at `/schema_version` that points to the editor's upgrade review and the migrate command, instead of a cascade of field errors.
- 0.3.0 → 0.4.0 adds an empty `scene.edit_log` and changes nothing else. A 0.3.0 document that already has an `edit_log` is refused as malformed.
- 0.4.0 → 0.5.0 adds `generation: null` to every catalog asset and changes nothing else. A 0.4.0 document whose assets already have `generation` is refused as malformed.
- 0.5.0 → 0.6.0 adds `image: null` and `photo_import: null` to every source and changes nothing else: every existing source keeps its `source_to_world`. Its note reads `schema_version 0.5.0 -> 0.6.0 (adds 'image: null' and 'photo_import: null' to N source(s); no values or evidence changed)`. A 0.5.0 document whose sources already have either field is refused as malformed.
- 0.6.0 → 0.7.0 adds `revision: null` to every generated asset and `size_basis: "not_stated"` to every photo scale reference (0.6.0 did not ask whether the size was measured or assumed, so neither is claimed). Its note reads `schema_version 0.6.0 -> 0.7.0 (adds 'revision: null' to N generated asset(s) and 'size_basis: not_stated' to M photo scale reference(s); no values or evidence changed)`. A 0.6.0 document that already has either field is refused as malformed.
- 0.8.0 → 0.9.0 adds `drawing: null` to every source (DXF drawings were not read before 0.9.0) and changes nothing else. Its note reads `schema_version 0.8.0 -> 0.9.0 (adds 'drawing: null' to N source(s); no values or evidence changed)`. A 0.8.0 document whose sources already have `drawing` is refused as malformed. 0.9.0 also refuses a `default` length marked `confirmed`; no earlier editor could write one, and such a document is reported after the upgrade, never silently changed.
- 0.7.0 → 0.8.0 adds `visibility: "not_recorded"`, `derived_from: null`, `replaced_by: null` and `corrections: []` to every photo observation (0.7.0 did not record how much of an object the photo showed, and could not split or merge observations, so none is claimed). Its note reads `schema_version 0.7.0 -> 0.8.0 (adds 'visibility: not_recorded' and empty corrections to N photo observation(s); no values or evidence changed)`. A 0.7.0 document that already has any of these fields is refused as malformed. Rebuilding missing generated models (`POST /api/v1/catalog/generated-models/restore`) accepts an older document and upgrades it first; upgrades never change a recorded specification, so the rebuilt files keep their recorded hashes.
- `fixtures/legacy/foundation-scene-0.1.0.json` is the exact 0.1.0 fixture, kept to test this path.
- **In the editor (WRL-03).** Opening a file whose `schema_version` is any other string sends it to `POST /api/v1/projects/upgrade`. That endpoint runs the same `upgrade_document`, validates the result (contract and model files), and returns an `UpgradeReport` (`from_version`, `to_version`, `notes`, `project`, `validation`) without storing anything. The browser shows the notes and offers **Open upgraded project**, **Download upgraded file** (`<name>-0.9.0.json`) or **Cancel**; nothing is replaced or written before that choice. An unknown version gets one 422 issue at `/schema_version`, a malformed legacy file one issue at the document level, and errors after a successful upgrade are located in the upgraded document. In each case the current scene stays.

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

## Generated objects (0.5.0, GEN-01)

A **generated asset** is an original, provisional model that the project's own generator builds from a bounded, data-only **geometry specification**. A language model may *propose* the specification; it never writes code that runs, and the API refuses anything outside the specification's rules.

**Geometry specification** (`GeometrySpec`, format `rws-geometry/1`):

- `envelope_m`: the overall width (X), height (Y) and depth (Z), 0.02–30 m each.
- `parts`: 1–40 solids. Each has an `id`, a short `label`, an approved `shape` (`box`, `rounded_box`, `cylinder` with an `axis`, upright `frustum` with `taper` and `narrow_end`, `sphere`), an approved `material` (30 physically based appearances such as `paint_blue`, `stainless_steel`, `hmi_screen`; appearance only, never chemistry), `center_m` and `size_m` in the object frame (metres, +Y up, front +Z, origin at the bottom-centre), and a `basis` (`stated`, `inferred` or `entered`).
- Every part is axis-aligned and fills its own box. The union of the parts equals the envelope within 0.1 mm, which is the same tolerance as a glTF model's origin. `GeometryDraft` is the same record without that last rule, and is what an editor sends. `POST /api/v1/catalog/generated-models[/preview]` fits a draft (scaling parts per axis onto the envelope, snapped to a micron grid) and returns the strict specification, the model record and any fit notes.

**Generator** (`services/api/src/replay_world_api/objects/`, `rws-object-generator/1`): pure Python, standard library only. It meshes each part (a rounded box ported from three.js, 32-segment cylinders and frustums, a UV sphere), merges per material, and writes a deterministic GLB 2.0 with linear-space PBR materials and no textures, extensions or node transforms. An independent reader then checks the bytes (layout, no external buffers or images, triangles only, min/max recomputed from the vertex data) and that the bounds equal the envelope with a bottom-centre origin. The same specification always gives the same bytes. Limits: 200,000 triangles and 8 MB.

**Storage and verification**: models are stored content-addressed at `generated/<sha256>.glb` inside the catalog library (`assets/catalog/generated/`, git-ignored). The record is an ordinary `GltfVisual`, so every existing rule applies: the API checks the file and its hash on validate, and the browser re-hashes and re-measures it before drawing.

**`CatalogAsset.generation`** (`AssetGeneration`, null for every other asset): `method` (`described` or `builder`), the user's `description` and the exact `language_model` (service, base URL, model ID) for described objects, the `generator` version, the `spec`, `stated_facts`, `inferred_facts`, `not_modelled` (things mentioned but not represented, such as a mass or a rate), and `unknown_properties`, which always lists **mass, strength, chemical_composition and operating_behaviour** as unknown. `source.kind` is `generated` exactly when `generation` is present. The visual must live under `generated/`, and the nominal dimensions must equal the specification envelope.

**Dimension evidence** (set by the API in `generated_assets.py`):

| How the size was settled | `origin` | `review_status` | `source_ref` |
| --- | --- | --- | --- |
| Stated in the description, and found there by the API | `user_supplied` | `confirmed` | `Stated in the description: “<the user's words>”` |
| Estimated by the model and confirmed by the user | `inferred` | `confirmed` | `Estimated by <service> <model> from the description; confirmed by the user before placement` |
| Typed by the user while reviewing, or built in the builder | `user_supplied` | `confirmed` | `Entered by the user while reviewing the generated object` |

An unconfirmed estimate is refused (422), so nothing is created until every estimated dimension has been confirmed.

**Placement and undo**: the browser places a new generated asset with the `add_generated_instance` command. It adds the asset to the catalog and one instance to the scene as one reversible change, recorded as `object_added`; one undo removes both. Later instances use `add_instance`.

**Missing models**: a project that names a generated model absent from the library is refused at `/catalog/<i>/visual/uri`, like any missing model. `POST /api/v1/catalog/generated-models/restore` rebuilds such files from their recorded specifications and keeps a file **only if its sha256 equals the recorded one**. Otherwise it reports `mismatch` and writes nothing, for example after a generator change. The editor offers this as **Rebuild generated models and open** on the rejection panel, and **Rebuild generated models** on the model notice.

## Language proposals (GEN-01)

`ObjectProposalResult` and `EditProposalResult` are API responses, not project records. Each carries an `outcome` (`proposal`, `clarification` or `unsupported`), its content, the API's `checks` (corrections in plain words), and a `ProviderRun`: the service, base URL, exact model ID, `live` or `recorded`, the number of attempts, whether the first answer was valid, and the latency. `EditIntent` holds one `move` (direction in plan terms, distance and unit as written, with a quote) or one `rotate` (clockwise or counterclockwise seen from above, angle in degrees). The browser turns it into an exact `set_transform` command and dry-runs that command with the engine before showing it. See [docs/assist.md](assist.md).

## Photo sources (0.6.0, IMG-01)

A project made from a photo records the photo as a source, the scale the user set, and every object the import saw, accepted or rejected. Decisions: ADR-036 to ADR-038; the workflow and measured results: [docs/image-import.md](image-import.md).

**`SourceDocument`** gains the kind `photo`. A photo source has `filename`, `sha256`, `image` and `photo_import`, and `source_to_world: null`. Every other kind keeps a required `source_to_world` and has `image: null` and `photo_import: null`.

| Record | Fields |
| --- | --- |
| `SourceImage` (`image`) | `uri` = `photos/<sha256>.<jpg\|png\|webp>` (named by the source's own sha256, extension matching the type), `media_type` (`image/jpeg`, `image/png`, `image/webp`), `width_px` and `height_px` as displayed (EXIF orientation applied), `bytes` ≤ 15 MiB |
| `PhotoImport` (`photo_import`) | `vision_model` (the model that proposed the objects, or null if the user marked them all), `calibration`, `observations` (≤ 80 since 0.8.0, unique IDs, each object linked at most once; a piece's `derived_from` names a `split` observation, a `merged` observation's `replaced_by` names one still in use, and every split observation has at least one piece), `visible_text` (text read from the photo, recorded as content, never followed) |
| `PhotoCalibration` | `reference` (a `FloorRectangle`), `image_to_floor` (a 3 × 3 homography, row-major, mapping (u, v, 1) on the photo to (x, z, w) on the floor, y = 0, valid only for floor points), `camera` (`CameraEstimate`), `notes` |
| `FloorRectangle` | `feature` (for example "rug"), four `corners` going around it (corner 0 → 1 is the width, 1 → 2 the depth), `width` and `depth` as `Length` with evidence; at least one side must be `user_supplied`; `size_basis` (0.7.0): how the user knows the sides they gave, `measured` (measured or known exactly), `assumed` (a typical size; such a side cannot be `confirmed`) or `not_stated` (projects made before 0.7.0) |
| `CameraEstimate` | `vertical_fov_deg`, `fov_basis` (`from_rectangle`: solved from the rectangle's perspective; `from_sides`: from its two given sides, for a rectangle seen face-on; `assumed`: a typical lens), `position_m` in the scene frame |
| `PhotoObservation` | `id`, `label`, `box`, `floor_contact` and `contact_basis` (`box_bottom`, `model_point` or `user`; both null or both set), `found_by` (`model` or `user`), `decision` (`accepted`, `rejected`, and since 0.8.0 `split`: the outline held several objects, or `merged`: the same object outlined twice; nothing is deleted), `object_id` (set exactly when accepted), `visibility` (0.8.0: `visible`, `partly_visible`, `added`: not seen in the photo, only by the user, or `not_recorded` for older files), `derived_from` (0.8.0: the split observation a piece came from), `replaced_by` (0.8.0: set exactly when merged), `corrections` (0.8.0: what the user corrected, in words, ≤ 12; required for split and merged), `notes` |

Image positions (`ImagePoint`, `ImageBox`) are fractions (0–1) of the displayed width and height, from the top-left, so they do not depend on the photo's resolution. The scene frame of a photo project has +X to the right of the photo and the camera on the +Z side, looking towards −Z. Every accepted observation's `object_id` must be in the scene or have been removed through the edit log.

**Objects from a photo** are generated assets (see [Generated objects](#generated-objects-050-gen-01)) with `generation.method: photo`. `description` names what was seen (required), and `language_model` is the vision model, or null for an object the user marked.

**Dimension evidence** for photo objects (set in `apps/web/src/photo/world.ts` and `generated_assets.py`):

| How the size was settled | `origin` | `review_status` | `source_ref` |
| --- | --- | --- | --- |
| Visible width or depth, measured from the outline with the user's floor rectangle (`ReviewedLength.basis: photo`) | `inferred` | `unreviewed` | `From photo <file> (<observation id>): the visible front (or side) projected onto the floor with the <feature> as scale reference (approximate)` |
| Height, from the outline and the reconstructed camera (`basis: photo`) | `inferred` | `unreviewed` | `From photo <file> (<observation id>): estimated from the photo with the reconstructed camera (approximate)` |
| Hidden side, from the label's typical proportions (`basis: photo`) | `inferred` | `unreviewed` | `From photo <file> (<observation id>): hidden in the photo; estimated from the typical proportions of a <label> (approximate)` |
| Visible side or height of a partly visible object (IMG-02; `basis: photo`) | `inferred` | `unreviewed` | `… partly hidden in the photo; the visible front projected … (an estimate: it may be larger)` or `… estimated from what shows with the reconstructed camera (an estimate: it may be taller)` |
| Any size of an object the user added, not seen in the photo (IMG-02; `basis: photo`) | `inferred` | `unreviewed` | `From photo <file> (<observation id>): not seen in the photo; added by the user, size estimated from the outline they drew (an estimate, not observed)` |
| Typed by the user while reviewing (`basis: entered`) | `user_supplied` | `confirmed` | `Entered by the user while reviewing the generated object` |

`ReviewedLength.source_ref` is required exactly when `basis` is `photo`. The scale reference is drawn as a `reference` object: a side the user measured is `user_supplied`/`confirmed` (`Measured by the user: the <feature>'s <side>`); a side they assumed is `user_supplied`/`unreviewed` (`Assumed by the user: a typical <side> for the <feature>, not measured`); and a depth they did not give is `inferred`/`unreviewed` (`Derived from the photo's perspective (approximate)`). Before 0.7.0 every given side was recorded as measured; see the [Update to ADR-037](../prompts/DECISIONS.md). The floor slab is a `default` placeholder sized around the objects, not the real room. One measured length never makes heights, hidden sides or derived depths exact.

**Source photo storage and reopening (ADR-038).** The original bytes are stored unchanged at `photos/<sha256>.<ext>` in the source library `RWS_SOURCES_DIR` (default `data/sources`, git-ignored). They are uploaded with `POST /api/v1/sources/photos?filename=…[&expected_sha256=…]` (streamed, 15 MB cap, format by content, idempotent; returns a `StoredPhoto`) and served at `GET /api/v1/sources/files/photos/<sha256>.<ext>`. The project JSON never embeds the photo.

- `POST /api/v1/projects/validate` checks every photo source. A missing file is refused at `/sources/<i>/image/uri`; a file with different bytes at `/sources/<i>/sha256`.
- With `?missing_sources=allow` a missing photo is not an error; it is listed in the report instead. A file with the wrong hash is always refused.
- Re-attaching uploads the chosen file with `expected_sha256`; a different file gets 409 and nothing is written. Nothing is ever substituted.

**`ValidationReport`** gains `photo_file_count` (source photos found with the recorded sha256) and `missing_source_files` (photos absent from the library, listed only when the caller allowed opening without them).

**Image analysis messages** (API requests and responses, not project records): `ImageAnalysisRequest` (the browser's metadata-free, downscaled copy: media type, base64 data, pixel size, and the original's sha256, which selects recorded answers in offline tests and is never sent to the model) and `ImageProposalResult` (`outcome` `proposal` or `unsupported`, the proposed objects, suggested floor rectangles and visible text, the API's `checks`, and the `ProviderRun`). `AssistStatus` gains `vision_model`.

## Revised generated objects (0.7.0, GEN-02)

A placed generated object (method `described`, `builder` or `photo`) can be corrected after placement with **Improve model…**. Every accepted correction is a **new, immutable catalog asset**; the previous asset, its model file and its record stay in the project. Decisions: ADR-039 to ADR-041; the proposal path and live results: [docs/assist.md](assist.md#improving-a-placed-generated-model-gen-02).

**`AssetGeneration.revision`** (`AssetRevision`, null for an original):

| Field | Meaning |
| --- | --- |
| `revises` | The ID of the asset this one corrects. It must be a generated asset in the same catalog. |
| `version` | 2 or more: one above the revised asset's version (an original is version 1 and records `revision: null`). |
| `instruction` | The user's words (3–300 characters), or null when the change was made by hand. |
| `language_model` | The model that proposed the specification change, or null when the user changed it by hand. A model requires an instruction. |
| `changes` | What changed, in plain words (1–40 lines), as the dialog listed them. |
| `not_represented` | Requested features the generator cannot depict (≤ 20); they are listed, never imitated. |

The other generation fields are copied from the revised asset unchanged: `method`, `description`, the original `language_model` (the drafting or vision model), `stated_facts` and `inferred_facts`. A revised photo object therefore still says what the photo showed; the correction is only in `revision`. The new `spec` is the revised specification. The new asset's ID is `asset-gen-<slug>-<first 8 hex of its sha256>`, its name is "<base> (vN)", and its model is a new content-addressed `generated/<sha256>.glb`; no existing file is overwritten.

**`asset_revised` edit record** (`AssetRevised`): `revision`, `asset_before`, `asset_after`, `objects`: [{`object_id`, `dimensions`: [`AxisChange` {axis, before, after}]}]. One record switches one or several objects in one step. An axis is listed only when its value or evidence changed. Unlike `object_edited`, `after` is not forced to `user_supplied`: an axis that follows the revised asset copies that asset's nominal evidence, which may be `inferred`.

- **Consistency (API).** Both assets are in the catalog; `asset_before` ≠ `asset_after`; objects and their axes are unique; every listed axis changes. The scene validator follows each object's asset reference from its `object_added` record through every `asset_revised` record (each must start from the asset the object referenced) and requires the result to equal the object's `asset_id`. The latest recorded axis values must equal the scene's, as for `object_edited`.
- **Command (browser).** `revise_asset` {`asset`, `previousAssetId`, `objects`: [{`objectId`, `dimensions`}]} checks every object before changing any: an object that no longer uses `previousAssetId` is a conflict, a stale base revision is a conflict, and in both cases nothing changes. It adds the new asset to the catalog (unless the identical asset is already there) and switches the objects; one undo restores the exact asset references, dimensions and catalog.
- **Per-instance sizes.** An object's axis whose value and evidence equal the old asset's nominal follows the new nominal (value and evidence copied). An axis the object has its own value or evidence for (edited or measured) is kept and the model is stretched to it, unless the user chooses the new size for that object and axis. The dialog lists this per object before Apply.

**Dimension evidence of a revised asset** (set by the API in `generated_assets.py`, per overall dimension):

| Basis (`RevisedLength.basis`) | When | `origin` | `review_status` | `source_ref` |
| --- | --- | --- | --- | --- |
| `kept` | The dimension did not change (within 1 µm) | copied | copied | copied: the previous value and evidence carry over exactly, so a colour or part change never turns an estimate or a photo-inferred size into a measurement |
| `entered` | The user typed a new overall size | `user_supplied` | `confirmed` | `Entered by the user while improving the model (previously X m, <origin>)` |
| `proposed` | The language model's proposal changed it and the user confirmed it | `inferred` | `confirmed` | `Proposed by <service> <model> from the instruction “…”; confirmed by the user (previously X m, <origin>)` |

The API refuses (422, nothing stored) `kept` for a changed dimension, `proposed` for an unchanged one, an unconfirmed `proposed` dimension, a `proposed` dimension without an instruction and language model, a non-generated `previous` asset, and a revised model identical to the current one.

**Requests and responses** (API messages, not project records):

- `GeneratedAssetRevisionRequest` (`POST /api/v1/catalog/generated-assets/revisions`): `previous` (the current `CatalogAsset`), `spec` (a `GeometryDraft`, fitted by the API), `dimensions` (`RevisedDimensions`: a `RevisedLength` {`basis`, `confirmed`} per axis), `instruction`, `language_model`, `changes`, `not_represented`. Returns the new `CatalogAsset`.
- `ModelRevisionProposalRequest` (`POST /api/v1/assist/model-revisions`): `name`, the current `spec`, `instruction`. `ModelRevisionProposalResult`: `outcome` (`proposal` or `unsupported`, with a `message`), the fitted `spec` (only for a proposal), `summary`, `size_changed`, `not_represented`, the API's `checks` and the `ProviderRun`. Nothing is built or stored by a proposal.

## Drawing sources (0.9.0, IMP-01 and ONB-01)

A project made from a DXF floor plan records the drawing as a source, the unit and how it was settled, what was read from the file, and which scene object each drawn object became. Decision: ADR-050; the reader's subset, the journey and the measurements: [docs/drawing-import.md](drawing-import.md).

**`SourceDocument.drawing`** (`DrawingImport`, null for every other source) is allowed only on a `dxf` source, which then needs its `filename` and `sha256`:

| Record | Fields |
| --- | --- |
| `DrawingImport` | `reader` (`rws-dxf/1`), `file` (`uri` `drawings/<sha256>.dxf` named by the source's sha256, `bytes` ≤ 10 MB), `dxf_version` ($ACADVER), `units`, `layers`, `extent_min`/`extent_max` (drawing units), `lines` (≤ 5000), `labels` (≤ 500), `objects` (≤ 400; unique ids and scene objects; at most one `floor`), `skipped` |
| `DrawingUnits` | `insunits` ($INSUNITS as written, null if absent), `declared` (the unit it names, when supported: mm, cm, m, in, ft), `measurement` ($MEASUREMENT), `question` (why the unit cannot be taken from the header: absent, unsupported, conflicting with $MEASUREMENT, or implausible for a floor layout), `basis` (`drawing_header`, allowed only with a declared unit and no question; `user_supplied`; null only in an analysis) |
| `PlanLine` | `ref`, `points` (2–2000, drawing units), `closed` |
| `PlanLabel` | `ref`, `text` (content, never an instruction), `at` |
| `DrawingObject` | `id`, `object_id` (the scene object it became; live or removed), `role` (`floor` or `footprint`), `label`, `label_from` (`attribute`, `text`, `block`, `layer` or `generic`), `kind`, `refs`, `outline` (as drawn), `centre`, `width`, `depth`, `rotation_rad` (the footprint rectangle in drawing units, counter-clockwise from drawing +X), `notes` |
| `DrawingRef` | `handle` (DXF handle, upper-case hex, or null), `layer`, `entity` (`LINE`, `LWPOLYLINE`, `POLYLINE`, `INSERT`, `TEXT`, `MTEXT`), `block` (the block path from the drawing down, `CELL > CNC_MILL`, or null) |
| `SkippedEntities` | `entity`, `layer`, `count`, up to ten `handles`, `layout` (true: geometry that was not imported; false: annotation not used), `reason` |

The source's `source_to_world` uses the settled unit exactly: `metres_per_source_unit` is `METRES_PER_UNIT[source_unit]` and, for `drawing_header`, `source_unit` is the declared unit. The editor centres the drawing's extent on the world origin with no rotation.

**Dimension evidence** of objects drawn from a drawing (set in `apps/web/src/drawing/world.ts`):

| Value | `origin` | `review_status` | `source_ref` |
| --- | --- | --- | --- |
| Footprint width and depth | `measured` | `unreviewed` | `Drawn in <file>: <ENTITY> <handle> on layer <layer>, <the outline as drawn \| the smallest rectangle around the drawn outline \| the extent of the block as inserted>; 1 unit = 1 mm (the drawing's own unit, $INSUNITS \| your answer: …). The drawing's size, not a site measurement.` |
| Height of equipment or a column | `default` | `unreviewed` | `Display height for the draft (typical for a <rack or shelving \| …>): not in the drawing and not measured. A check that needs the height says "height needed".` |
| Floor slab thickness, marking height | `default` | `unreviewed` | `Floor slab thickness for display; a drawing gives no thickness` / `Drawn as a marking on the floor; a drawing gives no height` |

Nothing is inferred about load capacity, process, material or chemistry; drawn objects have no parameters.

**Analysis message** (API, not a project record): `POST /api/v1/sources/drawings?filename=…` (raw bytes, 10 MB cap) reads the drawing and, only if it can be read, stores it at `drawings/<sha256>.dxf` in the source library (idempotent). It returns `DrawingAnalysis` (`filename`, `sha256`, `drawing` with `units.basis: null`, `warnings`). A DWG, binary DXF, non-DXF, truncated, empty or too-complex file is refused (415, 413 or 422) with the reason and never stored. No language model is called.

**Opening a project with a drawing.** `POST /api/v1/projects/validate` checks each stored drawing against its sha256. An altered file is refused (`source_hash_mismatch`); a missing one does not block opening, because the reading the scene was built from is in the project, and is listed in `missing_source_files`.

