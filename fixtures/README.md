# Fixtures

All files here are **synthetic**, created for this repository. They contain no customer drawings or real equipment data. Values marked `user_supplied` were entered by the developer for testing and are not engineering data.

| File | Purpose |
| --- | --- |
| `scenes/foundation-scene.json` | Contract 0.2.0 foundation fixture served by `GET /api/v1/fixtures/foundation`. Six placeholder objects and three synthetic catalog assets (license `NOASSERTION`) exercise per-axis measured, inferred, default and user-supplied evidence, plus unknown parameters. The `supplier` origin is not used. |
| `scenes/industrial-demo.json` | Contract 0.3.0 synthetic demonstration of a packaging line, served by `GET /api/v1/fixtures/industrial-demo` and loaded by default. It has 15 objects: floor, wall, 2 columns, 3 conveyors, 2 machine cells, 2 cabinets, 2 pallets (one rotated 90°), a walkway and a keep-clear zone. Its catalog references the 4 glTF models in `assets/catalog/models` by path and sha256. **Generated** by `pnpm fixtures:build`; do not hand-edit. All values are illustrative and labelled as such. |
| `invalid/negative-dimension.json` | Packing-station width −1.2 m. Rejected by Pydantic and Ajv at `/scene/objects/4/dimensions/width/value_m`. |
| `invalid/nonfinite-coordinate.json` | Contains a bare `NaN` token (not valid JSON). The API rejects it as non-finite; the browser cannot parse it. |
| `invalid/duplicate-object-id.json` | Two objects share an ID. Only the API detects this (a cross-field rule JSON Schema cannot express). |
| `invalid/dangling-asset-reference.json` | The processing station references `asset-not-in-catalog`. Only the API detects this. |
| `legacy/foundation-scene-0.1.0.json` | The exact 0.1.0 fixture. Used to test the explicit migration and the API's "older contract" rejection. Not an invalid sample - an old one. |

Each invalid file differs from the valid fixture only in its project `id` and one intended defect; `test_invalid_samples_differ_from_the_fixture_only_by_their_defect` enforces this. pytest also asserts that the API models reject each file at the intended location. Vitest and Playwright cover the browser-side behaviour; [docs/contracts.md](../docs/contracts.md) lists which layer catches what. Keep the files minimal when the contract changes.
