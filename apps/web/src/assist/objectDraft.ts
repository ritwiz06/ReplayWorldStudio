// The object a user is reviewing before it is placed: a proposal from a description, or a
// starting shape in the builder. Both are the same bounded geometry specification plus a record
// of how each dimension was settled. The API builds the model; this module only keeps the
// user's decisions and turns them into the request that creates the catalog asset.
import type {
  Extent3,
  GeneratedAssetRequest,
  GeometryDraft,
  GeometryPart,
  LanguageModelRef,
  ObjectProposalResult,
} from "@replay-world/contracts";

export type DimensionKey = "width" | "height" | "depth";
export const DIMENSIONS: readonly DimensionKey[] = ["width", "height", "depth"];
export const AXIS_OF: Record<DimensionKey, "x" | "y" | "z"> = { width: "x", height: "y", depth: "z" };

export interface DimensionReview {
  /** stated: in the description; inferred: estimated by the model; entered: typed by the user. */
  basis: "stated" | "inferred" | "entered";
  quote: string | null;
  confirmed: boolean;
}

export interface ObjectDraft {
  method: "described" | "builder";
  description: string | null;
  languageModel: LanguageModelRef | null;
  name: string;
  category: string;
  appearance: string | null;
  spec: GeometryDraft;
  dimensions: Record<DimensionKey, DimensionReview>;
  statedFacts: string[];
  inferredFacts: string[];
  notModelled: string[];
}

/** Smallest and largest overall size the API accepts on each axis (metres). */
export const ENVELOPE_LIMITS = { min: 0.02, max: 30 } as const;

const micro = (v: number) => Math.round(v * 1e6) / 1e6 + 0;

type Parts = GeometryDraft["parts"];

/** The contract requires at least one part; the builder never removes the last one. */
export function nonEmpty(parts: GeometryPart[]): Parts {
  const [first, ...rest] = parts;
  if (!first) throw new Error("An object needs at least one part.");
  return [first, ...rest];
}

export function draftFromProposal(description: string, result: ObjectProposalResult): ObjectDraft | null {
  const proposal = result.proposal;
  if (!proposal) return null;
  const review = (key: DimensionKey): DimensionReview => {
    const d = proposal.dimensions[key];
    // A stated value is the user's own; an estimate waits for their confirmation.
    return { basis: d.basis, quote: d.quote, confirmed: !d.needs_confirmation };
  };
  return {
    method: "described",
    description,
    languageModel: { service: result.provider.service, base_url: result.provider.base_url, model: result.provider.model },
    name: proposal.name,
    category: proposal.category,
    appearance: proposal.appearance,
    spec: structuredClone(proposal.spec),
    dimensions: { width: review("width"), height: review("height"), depth: review("depth") },
    statedFacts: [...proposal.stated_facts],
    inferredFacts: [...proposal.inferred_facts],
    notModelled: [...proposal.not_modelled],
  };
}

export function draftFromTemplate(name: string, category: string, spec: GeometryDraft): ObjectDraft {
  const entered = (): DimensionReview => ({ basis: "entered", quote: null, confirmed: true });
  return {
    method: "builder",
    description: null,
    languageModel: null,
    name,
    category,
    appearance: null,
    spec: structuredClone(spec),
    dimensions: { width: entered(), height: entered(), depth: entered() },
    statedFacts: [],
    inferredFacts: [],
    notModelled: [],
  };
}

export function sizeOf(draft: ObjectDraft): Record<DimensionKey, number> {
  const e = draft.spec.envelope_m;
  return { width: e.x, height: e.y, depth: e.z };
}

/**
 * Set one overall dimension. The parts are scaled to the new size by the API's fit (so a
 * conveyor stays a conveyor); the value now comes from the user.
 */
export function setDimension(draft: ObjectDraft, key: DimensionKey, value: number): ObjectDraft {
  return {
    ...draft,
    spec: { ...draft.spec, envelope_m: { ...draft.spec.envelope_m, [AXIS_OF[key]]: value } },
    dimensions: { ...draft.dimensions, [key]: { basis: "entered", quote: null, confirmed: true } },
  };
}

export function confirmDimension(draft: ObjectDraft, key: DimensionKey): ObjectDraft {
  return { ...draft, dimensions: { ...draft.dimensions, [key]: { ...draft.dimensions[key], confirmed: true } } };
}

export function confirmAll(draft: ObjectDraft): ObjectDraft {
  return DIMENSIONS.reduce(confirmDimension, draft);
}

/** Estimated dimensions the user has not confirmed yet. Placement waits for these. */
export function unconfirmed(draft: ObjectDraft): DimensionKey[] {
  return DIMENSIONS.filter((key) => !draft.dimensions[key].confirmed);
}

export function canPlace(draft: ObjectDraft): boolean {
  return unconfirmed(draft).length === 0 && draft.name.trim().length > 0;
}

/** Replace the specification with the API's fitted version (after a preview). */
export function withFittedSpec(draft: ObjectDraft, spec: GeometryDraft): ObjectDraft {
  return { ...draft, spec: structuredClone(spec) };
}

/**
 * Builder edits: change the parts and let the overall size follow them. The parts are
 * re-centred (centred on X and Z, standing on the floor), so editing one part never stretches
 * the others. A changed overall size becomes a value the user entered.
 */
export function setParts(draft: ObjectDraft, parts: GeometryPart[]): ObjectDraft {
  const lo = { x: Infinity, y: Infinity, z: Infinity };
  const hi = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const p of parts) {
    for (const a of ["x", "y", "z"] as const) {
      lo[a] = Math.min(lo[a], p.center_m[a] - p.size_m[a] / 2);
      hi[a] = Math.max(hi[a], p.center_m[a] + p.size_m[a] / 2);
    }
  }
  const shift = { x: -(lo.x + hi.x) / 2, y: -lo.y, z: -(lo.z + hi.z) / 2 };
  const centred = parts.map((p) => ({
    ...p,
    center_m: { x: micro(p.center_m.x + shift.x), y: micro(p.center_m.y + shift.y), z: micro(p.center_m.z + shift.z) },
  }));
  const envelope = {
    x: Math.max(ENVELOPE_LIMITS.min, micro(hi.x - lo.x)),
    y: Math.max(ENVELOPE_LIMITS.min, micro(hi.y - lo.y)),
    z: Math.max(ENVELOPE_LIMITS.min, micro(hi.z - lo.z)),
  };
  const dimensions = { ...draft.dimensions };
  for (const key of DIMENSIONS) {
    if (envelope[AXIS_OF[key]] !== draft.spec.envelope_m[AXIS_OF[key]]) dimensions[key] = { basis: "entered", quote: null, confirmed: true };
  }
  return { ...draft, spec: { ...draft.spec, envelope_m: envelope, parts: nonEmpty(centred) }, dimensions };
}

let partCounter = 0;

/** A new part on top of the object's current centre, to be adjusted by the user. */
export function newPart(parts: readonly GeometryPart[], envelope: Extent3, shape: GeometryPart["shape"]): GeometryPart {
  const e = envelope;
  const used = new Set(parts.map((p) => p.id));
  let id = `part-${++partCounter}`;
  while (used.has(id)) id = `part-${++partCounter}`;
  const size = Math.max(0.05, micro(Math.min(e.x, e.z) / 3));
  return {
    id,
    label: shape === "cylinder" ? "post" : "new part",
    shape,
    material: "paint_light_grey",
    center_m: { x: 0, y: micro(e.y - size / 2), z: 0 },
    size_m: { x: size, y: size, z: size },
    axis: shape === "cylinder" ? "y" : null,
    taper: shape === "frustum" ? 0.5 : null,
    narrow_end: shape === "frustum" ? "bottom" : null,
    basis: "entered",
  };
}

export function toAssetRequest(draft: ObjectDraft): GeneratedAssetRequest {
  const review = (key: DimensionKey) => ({ ...draft.dimensions[key], source_ref: null });
  return {
    name: draft.name.trim(),
    kind: "equipment",
    method: draft.method,
    description: draft.method === "described" ? draft.description : null,
    language_model: draft.method === "described" ? draft.languageModel : null,
    spec: draft.spec,
    dimensions: { width: review("width"), height: review("height"), depth: review("depth") },
    stated_facts: draft.statedFacts,
    inferred_facts: draft.inferredFacts,
    not_modelled: draft.notModelled,
  };
}
