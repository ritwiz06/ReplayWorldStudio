# Learning note - M0: how one browser request becomes a trusted scene

**Question.** How does a value such as "packing station width = 1.20 m" travel from a file on disk to a box on screen without its unit, frame or evidence being lost, and how does a clean machine reproduce that?

**Model.**

```
fixtures/scenes/foundation-scene.json
  → FastAPI GET /api/v1/fixtures/foundation       Project.model_validate_json (strict, finite, closed)
  → HTTP response (JSON)                         CORS: only http://127.0.0.1:5173 etc. may read it
  → browser fetch → response.json()              network / HTTP / parse failures classified
  → Ajv validateProject (generated schema)       contract failures listed by JSON Pointer
  → React state → R3F <group position rotation>  bottom-centre + local half-height offset
```

Reproducibility comes from three pins: runtime versions (`.node-version`, `.python-version`, `packageManager`), lockfiles (`pnpm-lock.yaml`, `uv.lock`, installed with `--frozen-lockfile` / `--locked`), and generated contracts that CI compares against their Pydantic source.

**Important assumptions.** The world frame equals Three.js's (right-handed, +Y up), so no axis conversion happens in the renderer. Drawings use plan +Y → world −Z. Object origins are bottom-centres. Unknown values have no number at all.

**Worked example.** Packing station: `width_m` 1.2, `depth_m` 1.0, rotated π/2 about +Y, at (2.5, 0, 0). A quarter turn swaps the footprint, so the world bounds are x ∈ [2.0, 3.0] and z ∈ [−0.6, 0.6], with height y ∈ [0, 1.4]. `apps/web/src/scene/placement.test.ts` builds the same Three.js objects the viewport builds and checks these numbers.

**Implementation boundary.** M0 proves transport, units, frames and evidence display. It does not import drawings, edit objects, check clearances or simulate anything. Boxes are placeholders, not catalog models.

**Validation method.** pytest checks contract invariants and API behaviour (including CORS and 422 rejection paths). Vitest checks that the generated schema accepts and rejects the same fixtures as Pydantic, plus the client's failure classification and renderer placement. Playwright drives the real API and web servers through load, contract failure, API outage and file rejection.

**Failure case.** The first placement test failed: the expected value was 3.8 and the measured value was 3.7999999970. The renderer stores geometry as float32, so world-space bounds read back from Three.js are only accurate to about 1e-7 relative. The fix was to state a 1 µm rendering tolerance. The lesson: calculations must use the float64 contract values, never numbers read back from rendered geometry.
