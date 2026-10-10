// Test helpers: repository fixtures, deep-frozen so any in-place mutation throws.
import { readFileSync } from "node:fs";
import type { CatalogAsset, Project } from "@replay-world/contracts";

export function fixture(path: string): Project {
  const text = readFileSync(new URL(`../../../../fixtures/${path}`, import.meta.url), "utf8");
  return deepFreeze(JSON.parse(text) as Project);
}

export function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export const objectOf = (project: Project, id: string) => {
  const found = project.scene.objects.find((o) => o.id === id);
  if (!found) throw new Error(`no object ${id}`);
  return found;
};

const length = (value_m: number, origin: "user_supplied" | "inferred", source_ref: string) => ({
  value_m,
  origin,
  source_ref,
  review_status: "confirmed" as const,
  uncertainty_m: null,
});

/** A generated catalog asset as the API returns it (structurally; the model file is not real). */
export function generatedAsset(id = "asset-gen-guarded-conveyor-0a1b2c3d"): CatalogAsset {
  const sha = "0a1b2c3d".padEnd(64, "0");
  return deepFreeze({
    id,
    name: "Guarded conveyor",
    kind: "equipment",
    visual: {
      type: "gltf",
      uri: `generated/${sha}.glb`,
      sha256: sha,
      metres_per_model_unit: 1,
      up_axis: "+Y",
      front_axis: "+Z",
      origin: "bottom_centre",
      model_bounds_m: { min: { x: -1.1, y: 0, z: -0.35 }, max: { x: 1.1, y: 1.2, z: 0.35 } },
      fit: "scale_to_dimensions",
      max_fit_distortion: 0.05,
    },
    nominal_dimensions: {
      width: length(2.2, "user_supplied", "Stated in the description: “about 2.2 m long”"),
      height: length(1.2, "inferred", "Estimated; confirmed by the user before placement"),
      depth: length(0.7, "inferred", "Estimated; confirmed by the user before placement"),
    },
    source: { kind: "generated", author: "Replay World Studio object generator (rws-object-generator/1)", reference: "Described by the user" },
    rights: { license: "NOASSERTION", redistribution: "unknown", attribution: null, terms_ref: "Original provisional model" },
    generation: {
      method: "described",
      description: "a guarded conveyor about 2.2 m long with a control screen",
      language_model: { service: "ASU Voyager", base_url: "https://openai.rc.asu.edu/v1", model: "qwen3-235b-a22b-instruct-2507" },
      generator: "rws-object-generator/1",
      spec: {
        format: "rws-geometry/1",
        envelope_m: { x: 2.2, y: 1.2, z: 0.7 },
        parts: [
          {
            id: "body",
            label: "conveyor body",
            shape: "box",
            material: "aluminium",
            center_m: { x: 0, y: 0.6, z: 0 },
            size_m: { x: 2.2, y: 1.2, z: 0.7 },
            axis: null,
            taper: null,
            narrow_end: null,
            basis: "stated",
          },
        ],
      },
      stated_facts: ["About 2.2 m long"],
      inferred_facts: ["Height 1.2 m assumed"],
      not_modelled: [],
      unknown_properties: (["mass", "strength", "chemical_composition", "operating_behaviour"] as const).map((property) => ({
        property,
        reason: "Not established.",
      })),
    },
  } satisfies CatalogAsset);
}
