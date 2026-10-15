import { validateGeometryDraft, type ObjectProposalResult } from "@replay-world/contracts";
import { describe, expect, it } from "vitest";
import { canPlace, confirmAll, confirmDimension, draftFromProposal, draftFromTemplate, newPart, setDimension, setParts, toAssetRequest, unconfirmed } from "./objectDraft";
import { TEMPLATES } from "./templates";

const conveyor = TEMPLATES.find((t) => t.key === "conveyor")!;

function proposal(): ObjectProposalResult {
  const stated = { value_m: 2.2, basis: "stated" as const, quote: "about 2.2 m long", needs_confirmation: false };
  const inferred = (value_m: number) => ({ value_m, basis: "inferred" as const, quote: null, needs_confirmation: true });
  return {
    outcome: "proposal",
    question: null,
    message: null,
    checks: [],
    provider: { service: "ASU Voyager", base_url: "https://openai.rc.asu.edu/v1", model: "qwen3-235b-a22b-instruct-2507", mode: "recorded", attempts: 1, first_attempt_valid: true, latency_ms: 0 },
    proposal: {
      name: "Guarded conveyor",
      category: "conveyor",
      appearance: "An aluminium conveyor with guards.",
      dimensions: { width: stated, height: inferred(1.1), depth: inferred(0.8) },
      spec: { ...conveyor.spec, envelope_m: { x: 2.2, y: 1.1, z: 0.8 } },
      stated_facts: ["About 2.2 m long"],
      inferred_facts: ["Height assumed"],
      not_modelled: [],
      unknown_properties: [],
    },
  };
}

describe("object drafts", () => {
  it("keep a stated size as the user's and wait for confirmation of every estimate", () => {
    const draft = draftFromProposal("a guarded conveyor about 2.2 m long", proposal())!;
    expect(draft.dimensions.width).toEqual({ basis: "stated", quote: "about 2.2 m long", confirmed: true });
    expect(unconfirmed(draft)).toEqual(["height", "depth"]);
    expect(canPlace(draft)).toBe(false);
    expect(canPlace(confirmDimension(draft, "height"))).toBe(false);
    expect(canPlace(confirmAll(draft))).toBe(true);
  });

  it("record a typed size as entered by the user (and confirmed)", () => {
    const draft = setDimension(draftFromProposal("x", proposal())!, "depth", 0.95);
    expect(draft.spec.envelope_m.z).toBe(0.95);
    expect(draft.dimensions.depth).toEqual({ basis: "entered", quote: null, confirmed: true });
    expect(unconfirmed(draft)).toEqual(["height"]);
  });

  it("send the reviewed decisions, the description and the model that drafted it", () => {
    const request = toAssetRequest(confirmAll(draftFromProposal("a guarded conveyor about 2.2 m long", proposal())!));
    expect(request).toMatchObject({
      name: "Guarded conveyor",
      kind: "equipment",
      method: "described",
      description: "a guarded conveyor about 2.2 m long",
      language_model: { service: "ASU Voyager", model: "qwen3-235b-a22b-instruct-2507" },
      dimensions: { width: { basis: "stated", confirmed: true }, height: { basis: "inferred", confirmed: true } },
    });
  });

  it("builder edits re-centre the parts so the overall size follows them", () => {
    const draft = draftFromTemplate("Box", "box", TEMPLATES[0]!.spec);
    const added = newPart(draft.spec.parts, draft.spec.envelope_m, "cylinder");
    const moved = { ...added, center_m: { ...added.center_m, x: 1 } }; // sticks out to the right
    const next = setParts(draft, [...draft.spec.parts, moved]);
    const [body, post] = next.spec.parts;
    const lo = Math.min(body!.center_m.x - body!.size_m.x / 2, post!.center_m.x - post!.size_m.x / 2);
    const hi = Math.max(body!.center_m.x + body!.size_m.x / 2, post!.center_m.x + post!.size_m.x / 2);
    expect(lo + hi).toBeCloseTo(0, 5); // centred on X again (to the micron grid)
    expect(next.spec.envelope_m.x).toBeCloseTo(hi - lo, 5);
    expect(next.dimensions.width.basis).toBe("entered");
    expect(toAssetRequest(next)).toMatchObject({ method: "builder", description: null, language_model: null });
  });

  it("every builder template is a valid geometry draft", () => {
    for (const template of TEMPLATES) {
      expect(validateGeometryDraft(template.spec), template.key).toMatchObject({ ok: true });
    }
  });
});
