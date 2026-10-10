import { readFileSync } from "node:fs";
import type { Project } from "@replay-world/contracts";
import { describe, expect, it } from "vitest";
import { axesDifferingFromNominal, dimensionEvidence, licenseLabel } from "./evidence";

const project = JSON.parse(
  readFileSync(new URL("../../../fixtures/scenes/foundation-scene.json", import.meta.url), "utf8"),
) as Project;
const object = (id: string) => project.scene.objects.find((o) => o.id === id)!;
const asset = (id: string) => project.catalog.find((a) => a.id === id)!;

describe("dimension evidence summary", () => {
  it("reports a single origin only when every axis shares it", () => {
    expect(dimensionEvidence(object("obj-reference-cube").dimensions)).toBe("user_supplied");
    expect(dimensionEvidence(object("obj-infeed-conveyor").dimensions)).toBe("default");
  });

  it("reports mixed evidence for a measured footprint with an inferred height", () => {
    expect(dimensionEvidence(object("obj-packing-station").dimensions)).toBe("mixed");
  });
});

describe("instance versus catalog nominal size", () => {
  it("finds no difference when the instance uses the nominal size", () => {
    const packing = object("obj-packing-station");
    expect(axesDifferingFromNominal(packing.dimensions, asset(packing.asset_id!))).toEqual([]);
  });

  it("names the axes that differ instead of hiding the conflict", () => {
    const packing = structuredClone(object("obj-packing-station"));
    packing.dimensions.width.value_m = 1.25;
    packing.dimensions.depth.value_m = 0.98;
    expect(axesDifferingFromNominal(packing.dimensions, asset(packing.asset_id!))).toEqual([
      "width",
      "depth",
    ]);
  });
});

describe("license label", () => {
  it("states plainly when no license is asserted", () => {
    expect(licenseLabel(asset("asset-generic-packing-station").rights)).toBe(
      "Not asserted (NOASSERTION)",
    );
  });
});
