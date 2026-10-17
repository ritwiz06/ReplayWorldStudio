// Small, pure summaries of the evidence carried by contract records, for display only.
import type { CatalogAsset, Dimensions, SceneObject, UsageRights } from "@replay-world/contracts";

export type Axis = keyof Dimensions;
export type Origin = Dimensions["width"]["origin"];

export const AXES: readonly { axis: Axis; label: string }[] = [
  { axis: "width", label: "Width (X)" },
  { axis: "height", label: "Height (Y)" },
  { axis: "depth", label: "Depth (Z)" },
];

/** The single origin shared by all three axes, or "mixed" when they differ. */
export function dimensionEvidence(d: Dimensions): Origin | "mixed" {
  const origins = new Set(AXES.map(({ axis }) => d[axis].origin));
  const [only] = origins;
  return origins.size === 1 && only ? only : "mixed";
}

const SAME_LENGTH_TOLERANCE_M = 1e-9;

/** Axes on which a placed instance differs from its catalog asset's nominal size. */
export function axesDifferingFromNominal(instance: Dimensions, asset: CatalogAsset): Axis[] {
  return AXES.map(({ axis }) => axis).filter(
    (axis) =>
      Math.abs(instance[axis].value_m - asset.nominal_dimensions[axis].value_m) >
      SAME_LENGTH_TOLERANCE_M,
  );
}

export function licenseLabel(rights: UsageRights): string {
  return rights.license === "NOASSERTION" ? "Not asserted (NOASSERTION)" : rights.license;
}

const REDISTRIBUTION_LABEL: Record<UsageRights["redistribution"], string> = {
  allowed: "Redistribution allowed",
  restricted: "Redistribution restricted",
  unknown: "Redistribution unknown",
};

export function redistributionLabel(rights: UsageRights): string {
  return REDISTRIBUTION_LABEL[rights.redistribution];
}

/** A standing object whose height is only a display default (for example drawn from a floor
 * plan): it is drawn see-through and labelled "height assumed", so it never looks measured. */
export function heightAssumed(o: SceneObject): boolean {
  if (o.dimensions.height.origin !== "default") return false;
  if (o.kind === "equipment") return true;
  // A structure that rises above the floor (a column, not the floor slab).
  return o.kind === "structure" && o.transform.position_m.y + o.dimensions.height.value_m > 0.05;
}
