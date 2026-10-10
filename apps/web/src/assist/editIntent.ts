// Language edits: what the model is told about the scene, and how its typed intent becomes one
// exact command. The model never computes coordinates. This module turns "1 metre left" into a
// new position, then runs the command engine as a dry run against the revision the request
// was made for, so the user sees exactly the change the engine would apply - or why it would
// not apply - before anything happens.
import type { EditContext, EditIntent, Project, Transform } from "@replay-world/contracts";
import { applyCommand, type EditCommand } from "../editing/commands";
import { degToRad, formatFixed, quantizeDegrees, quantizeMetres, radToDeg, wrapDegrees } from "../editing/units";

export const METRES_PER_UNIT = { km: 1000, m: 1, cm: 0.01, mm: 0.001, ft: 0.3048, in: 0.0254 } as const;

type Direction = NonNullable<EditIntent["move"]>["direction"];

/** World axis and sign of each plan direction (the top view: -Z up the screen, +X right). */
export const DIRECTIONS: Record<Direction, { axis: "x" | "y" | "z"; sign: 1 | -1; label: string }> = {
  left: { axis: "x", sign: -1, label: "left (−X)" },
  right: { axis: "x", sign: 1, label: "right (+X)" },
  back: { axis: "z", sign: -1, label: "back (−Z, up the screen in the top view)" },
  forward: { axis: "z", sign: 1, label: "forward (+Z, down the screen in the top view)" },
  up: { axis: "y", sign: 1, label: "up (+Y)" },
  down: { axis: "y", sign: -1, label: "down (−Y)" },
};

/** The scene as the model sees it: ids, names, kinds, placements and sizes. Nothing else. */
export function buildEditContext(project: Project, selectedId: string | null): EditContext {
  return {
    revision: project.scene.revision,
    selected_object_id: selectedId,
    objects: project.scene.objects.slice(0, 500).map((o) => ({
      id: o.id,
      name: o.name,
      kind: o.kind,
      position_m: { ...o.transform.position_m },
      rotation_y_rad: o.transform.rotation_rad.y,
      size_m: { x: o.dimensions.width.value_m, y: o.dimensions.height.value_m, z: o.dimensions.depth.value_m },
    })),
  };
}

export interface ResolvedEdit {
  command: EditCommand;
  baseRevision: number;
  objectName: string;
  /** One line, e.g. "Move Control cabinet 1 by 1.000 m left (−X)". */
  summary: string;
  /** Exact values before and after, e.g. ["x  −2.000 → −3.000 m"]. */
  changes: string[];
}

export type Resolution = { ok: true; edit: ResolvedEdit } | { ok: false; message: string };

const m3 = (v: number) => formatFixed(v, 3);

/**
 * Turn an intent into the exact command and check it with the engine (nothing is applied).
 * `baseRevision` is the revision the request was made against; if the scene has moved on since,
 * the engine reports a conflict instead of applying the change to a different state.
 */
export function resolveIntent(project: Project, intent: EditIntent, baseRevision: number): Resolution {
  const id = intent.target.object_ids[0];
  const object = project.scene.objects.find((o) => o.id === id);
  if (!object) return { ok: false, message: `The object '${id}' is no longer in the scene.` };
  const before = object.transform;
  let transform: Transform;
  let summary: string;
  const changes: string[] = [];

  if (intent.action === "move" && intent.move) {
    const { direction, distance, unit } = intent.move;
    const metres = distance * METRES_PER_UNIT[unit];
    const { axis, sign, label } = DIRECTIONS[direction];
    const position = { ...before.position_m };
    position[axis] = quantizeMetres(position[axis] + sign * metres, 1);
    transform = { position_m: position, rotation_rad: { ...before.rotation_rad } };
    summary = `Move ${object.name} by ${m3(metres)} m ${label}`;
    for (const a of ["x", "y", "z"] as const) {
      if (position[a] !== before.position_m[a]) changes.push(`${a}  ${m3(before.position_m[a])} → ${m3(position[a])} m`);
    }
  } else if (intent.action === "rotate" && intent.rotate) {
    const { direction, angle_deg } = intent.rotate;
    // Seen from above, counterclockwise is a positive turn about +Y (right-hand rule).
    const delta = direction === "counterclockwise" ? angle_deg : -angle_deg;
    const fromDeg = radToDeg(before.rotation_rad.y);
    const toDeg = wrapDegrees(quantizeDegrees(fromDeg + delta, 0.1));
    transform = { position_m: { ...before.position_m }, rotation_rad: { ...before.rotation_rad, y: degToRad(toDeg) } };
    summary = `Turn ${object.name} ${formatFixed(angle_deg, 1)}° ${direction} (seen from above)`;
    changes.push(`rotation Y  ${formatFixed(fromDeg, 1)}° → ${formatFixed(toDeg, 1)}°`);
  } else {
    return { ok: false, message: "The proposal has no move or turn to apply." };
  }

  const command: EditCommand = { type: "set_transform", objectId: object.id, transform };
  const dryRun = applyCommand(project, { baseRevision, command });
  if (!dryRun.ok) return { ok: false, message: dryRun.rejection.message };
  return { ok: true, edit: { command, baseRevision, objectName: object.name, summary, changes } };
}
