// GEO-01: does this layout fit? Footprint overlaps between equipment and structures, objects
// standing in keep-clear zones, and objects reaching past the floor's edge, on the current
// (edited) positions, sizes and turns. A 2D design-layout check on the reviewed drawing, with
// an explicit 1 mm tolerance: touching is not a conflict. It never certifies the site as built.
import type { Project } from "@replay-world/contracts";
import { type CheckState } from "../drawing/readiness";
import { bounds as box, inside, overlapDepth, overlapRegion, outsideBy, polygonGap, type Vec } from "./geometry";
import { checkInputs, type Shape, TOLERANCE_M } from "./inputs";

export type FindingState = "conflict" | "not_accurate" | "cannot_determine";

export interface Finding {
  kind: "overlap" | "zone" | "floor_edge" | "zone_uncertain";
  state: FindingState;
  objectIds: string[];
  /** Overlap depth or reach in metres (for an uncertain zone: 0). */
  metres: number;
  message: string;
  /** What to correct, for a finding that is not a plain conflict. */
  fix: string | null;
  /** The area to highlight on the plan and floor. */
  region: Vec[];
}

export interface LayoutResult {
  outcome: Exclude<CheckState, "height_needed">;
  summary: string;
  findings: Finding[];
  /** Why the check could not be made, or what keeps it from saying "fits". */
  blockers: string[];
  closest: { names: [string, string]; gapM: number } | null;
  tested: string[];
}

const m = (v: number) => `${v.toFixed(2)} m`;

function accuracy(a: Shape, b: Shape): { state: FindingState; problem: string | null; fix: string | null } {
  const problems = [a, b].map((s) => s.evidence).filter((e) => !e.exact);
  if (problems.length === 0) return { state: "conflict", problem: null, fix: null };
  if (problems.every((e) => e.encloses)) {
    return { state: "not_accurate", problem: problems.map((e) => e.problem).join("; "), fix: problems.map((e) => e.problem!.split(": ")[1] ?? "").filter(Boolean)[0] ?? null };
  }
  const blocking = problems.find((e) => !e.encloses)!;
  return { state: "cannot_determine", problem: blocking.problem, fix: blocking.problem?.includes("not reviewed") ? "check it in the review" : null };
}

export function checkLayout(project: Project): LayoutResult | null {
  const inputs = checkInputs(project);
  if (!inputs) return null;
  const tested = [`footprints as they are now, with a ${TOLERANCE_M * 1000} mm tolerance (touching is not a conflict)`];
  if (inputs.blockers.length > 0) {
    return { outcome: "cannot_determine", summary: `Cannot determine yet: ${inputs.blockers.join("; ")}.`, findings: [], blockers: inputs.blockers, closest: null, tested };
  }
  const findings: Finding[] = [];
  const { obstacles, zones, floor } = inputs;
  let closest: LayoutResult["closest"] = null;

  for (let i = 0; i < obstacles.length; i++) {
    const a = obstacles[i]!;
    const ba = box(a.poly);
    for (let j = i + 1; j < obstacles.length; j++) {
      const b = obstacles[j]!;
      const bb = box(b.poly);
      const apart = ba.maxX < bb.minX - TOLERANCE_M || bb.maxX < ba.minX - TOLERANCE_M || ba.maxZ < bb.minZ - TOLERANCE_M || bb.maxZ < ba.minZ - TOLERANCE_M;
      const depth = apart ? 0 : overlapDepth(a.poly, b.poly);
      if (depth > TOLERANCE_M) {
        const { state, problem, fix } = accuracy(a, b);
        const message =
          state === "conflict"
            ? `${a.name} and ${b.name} overlap by ${m(depth)}.`
            : state === "not_accurate"
              ? `Not evaluated accurately: the boxes of ${a.name} and ${b.name} overlap by up to ${m(depth)}, but ${problem}.`
              : `${a.name} and ${b.name} may overlap (${m(depth)} between their boxes): ${problem}.`;
        findings.push({ kind: "overlap", state, objectIds: [a.id, b.id], metres: depth, message, fix, region: overlapRegion(a.poly, b.poly) });
      } else if (a.evidence.exact && b.evidence.exact) {
        const gap = polygonGap(a.poly, b.poly);
        if (!closest || gap < closest.gapM) closest = { names: [a.name, b.name], gapM: gap };
      }
    }
  }

  for (const zone of zones) {
    if (!zone.evidence.exact) {
      findings.push({ kind: "zone_uncertain", state: "cannot_determine", objectIds: [zone.id], metres: 0, message: `${zone.name} cannot be checked: ${zone.evidence.problem}.`, fix: null, region: zone.poly });
      continue;
    }
    for (const o of obstacles) {
      const depth = overlapDepth(o.poly, zone.poly);
      if (depth <= TOLERANCE_M) continue;
      const { state, problem, fix } = accuracy(o, zone);
      const message =
        state === "conflict"
          ? `${o.name} stands ${m(depth)} into ${zone.name}.`
          : state === "not_accurate"
            ? `Not evaluated accurately: ${o.name}'s box reaches up to ${m(depth)} into ${zone.name}, but ${problem}.`
            : `${o.name} may stand in ${zone.name}: ${problem}.`;
      findings.push({ kind: "zone", state, objectIds: [o.id, zone.id], metres: depth, message, fix, region: overlapRegion(o.poly, zone.poly) });
    }
    // Geometry the drawing leaves uncertain inside the zone could be an obstacle in it.
    for (const u of inputs.uncertain) {
      const touches = u.points.some((p) => inside(p, zone.poly)) || polygonGap(u.closed ? u.points : thicken(u.points), zone.poly) <= TOLERANCE_M;
      if (!touches) continue;
      findings.push({
        kind: "zone_uncertain",
        state: "cannot_determine",
        objectIds: [zone.id],
        metres: 0,
        message: `${zone.name} contains ${u.label}, which is not an object: if it is something standing there, the zone is not clear.`,
        fix: "make it an object in the drawing (a closed outline) and upload it again, or check on site",
        region: zone.poly,
      });
    }
  }

  if (floor) {
    for (const o of obstacles) {
      const reach = outsideBy(o.poly, floor.poly);
      if (reach <= TOLERANCE_M) continue;
      const exact = o.evidence.exact;
      findings.push({
        kind: "floor_edge",
        state: exact ? "conflict" : o.evidence.encloses ? "not_accurate" : "cannot_determine",
        objectIds: [o.id],
        metres: reach,
        message: exact ? `${o.name} reaches ${m(reach)} past the floor's edge.` : `${o.name}'s box reaches up to ${m(reach)} past the floor's edge, but ${o.evidence.problem}.`,
        fix: null,
        region: o.poly,
      });
    }
  }

  const blockers: string[] = [];
  const unreviewed = obstacles.filter((o) => o.evidence.problem?.includes("not reviewed")).length;
  if (unreviewed > 0) blockers.push(`${unreviewed} object${unreviewed === 1 ? " is" : "s are"} not reviewed yet`);
  if (!floor) blockers.push("the floor is only for display, so nothing is checked against its edge");
  if (zones.length > 0 && inputs.unplaced.length > 0) blockers.push(`keep-clear zones cannot be confirmed clear: ${inputs.unplaced.join("; ")} could be anywhere`);

  const conflicts = findings.filter((f) => f.state === "conflict");
  const open = findings.filter((f) => f.state !== "conflict");
  const outcome = conflicts.length > 0 ? "conflict" : open.length > 0 || blockers.length > 0 ? "cannot_determine" : "fits";
  const summary =
    outcome === "conflict"
      ? `${conflicts.length} conflict${conflicts.length === 1 ? "" : "s"}: ${conflicts
          .slice(0, 2)
          .map((f) => f.message.replace(/\.$/, ""))
          .join("; ")}${conflicts.length > 2 ? "; …" : ""}.`
      : outcome === "fits"
        ? `No overlaps, no object in a keep-clear zone and nothing past the floor's edge.${closest ? ` Closest: ${closest.names[0]} and ${closest.names[1]}, ${m(closest.gapM)} apart.` : ""}`
        : `Cannot determine yet: ${[...open.map((f) => f.message.replace(/\.$/, "")), ...blockers].slice(0, 2).join("; ")}.`;
  if (floor) tested.push(`objects against ${floor.words}`);
  tested.push(`${obstacles.length} equipment and structure footprints, ${zones.length} keep-clear zone${zones.length === 1 ? "" : "s"}`);
  return { outcome, summary, findings, blockers, closest, tested };
}

/** An open line as a thin closed polygon, so it can be tested against an area. */
function thicken(points: readonly Vec[]): Vec[] {
  return [...points, ...[...points].reverse()];
}
