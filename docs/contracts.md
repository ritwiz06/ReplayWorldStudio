# Contracts: units, frames, provenance and the schema pipeline

Contract version **0.1.0** (`SCHEMA_VERSION`). Source: [`packages/contracts/python/replay_world_contracts/models.py`](../packages/contracts/python/replay_world_contracts/models.py).

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
| Positive dimensions, ID pattern, enums, schema version | yes | yes |
| Known vs unknown parameter shape | yes | yes (`oneOf` on `state`) |
| Unique object / parameter / source IDs | yes | **no** - JSON Schema cannot express it |
| Value inside its uncertainty bounds; bounds ordered | yes | **no** |

The browser only renders data that passed Ajv, and opens a local file only after the API accepted it. Python's `json.loads` accepts a bare `NaN` token, so the API's finite-number rule is what rejects `fixtures/invalid/nonfinite-coordinate.json`.

## Units and frames

- Internal units: metres (`_m`), seconds, kilograms, radians (`_rad`). `ParameterUnit` admits `m`, `s`, `kg`, `rad`, `m/s` and `1` (dimensionless).
- World: right-handed, +Y up, floor in X-Z. This equals Three.js's convention, so the renderer applies positions and rotations unchanged.
- `EulerRotation` uses order `XYZ` with Three.js semantics: R = Rx(x) · Ry(y) · Rz(z).
- `Transform.position_m` is the **bottom-centre** of the object's bounding box, so floor-standing objects have `y = 0`. The renderer places a group at that point and offsets the box mesh by half its height in local space.
- `Dimensions` are physical extents along the object's local X (width), Y (height) and Z (depth). There is no visual scale factor in the contract.

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
- `Dimensions` carry **one** origin for the whole box. When axes differ (a measured footprint with an assumed height, for example), record the least certain origin and explain it in `source_ref`. Per-axis provenance is a candidate change for WRL-01.

## Rendering tolerance

The contract is float64, but Three.js geometry buffers are float32 (about 1e-7 relative precision). Renderer placement tests therefore use a 1 µm tolerance. Never read numeric results back from rendered geometry.
