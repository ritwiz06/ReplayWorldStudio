# Fixtures

All files here are **synthetic**, created for this repository. They contain no customer drawings or real equipment data. Values marked `user_supplied` were entered by the developer for testing and are not engineering data.

| File | Purpose |
| --- | --- |
| `scenes/foundation-scene.json` | The M0 foundation fixture served by `GET /api/v1/fixtures/foundation`. Six placeholder objects exercise measured, inferred, default, user-supplied and unknown evidence. The `supplier` origin is not used. |
| `invalid/negative-dimension.json` | Packing-station width −1.2 m. Rejected by Pydantic and Ajv at `/scene/objects/4/dimensions/width_m`. |
| `invalid/nonfinite-coordinate.json` | Contains a bare `NaN` token (not valid JSON). The API rejects it as non-finite; the browser cannot parse it. |
| `invalid/duplicate-object-id.json` | Two objects share an ID. Only the API detects this (a cross-field rule JSON Schema cannot express). |

Each invalid file differs from the valid fixture only in its project `id` and one intended defect. pytest asserts that the API models reject each file at the intended location. Vitest and Playwright cover the browser-side behaviour; [docs/contracts.md](../docs/contracts.md) lists which layer catches what. Keep the files minimal when the contract changes.
