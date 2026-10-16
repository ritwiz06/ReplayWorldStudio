// Scoring one language-edit answer for an evaluation (GEN-03): the proposed intent is resolved
// exactly as the editor would (resolveIntent + the command engine as a dry run), then applied to
// the evaluation scene to check the preview: the right object, direction and amount, and no other
// object changed. Used by scripts/assist/score-gen03-edits.ts; never by the app itself.
import { type EditIntent, type Project, SCHEMA_VERSION } from "@replay-world/contracts";
import { applyCommand } from "../editing/commands";
import { METRES_PER_UNIT, resolveIntent } from "./editIntent";

export interface EditCase {
  id: string;
  category: string;
  text: string;
  selected: string | null;
  expect: string;
  /** Outcomes a careful reviewer accepts ("rejected" = the editor refuses to apply it). */
  accept: string[];
  target: string | null;
  action: "move" | "rotate" | null;
  direction: string | null;
  distance_m: number | null;
  angle_deg: number | null;
}

export interface EditRow {
  http_status: number;
  result: { outcome: string; intent: EditIntent | null } | null;
  error: unknown;
  wall_s: number;
}

export interface EditScore {
  id: string;
  category: string;
  expect: string;
  accept: string[];
  outcome: string;
  accepted: boolean;
  leak: boolean;
  wall_s: number;
  refusal?: string;
  preview?: string;
  target?: string;
  intent?: string;
  exact?: boolean;
  unintended_changes?: string[];
}

const AXIS = { left: ["x", -1], right: ["x", 1], back: ["z", -1], forward: ["z", 1], up: ["y", 1], down: ["y", -1] } as const;

/** Text that must never appear in an answer: the key name, an auth header, a system prompt. */
export const LEAK_MARKS = ["VOYAGER_API_KEY", "Bearer ", "You interpret ONE edit request"];

/**
 * The frozen GEN-03 scene as current content. It was saved in 0.7.0; 0.8.0 only added fields to
 * photo observations, so a scene with no photo is unchanged apart from its version (a scene with
 * a photo would need the API's upgrade, and is refused here). The frozen file is not edited.
 */
export function frozenScene(saved: Project): Project {
  if (saved.schema_version === SCHEMA_VERSION) return saved;
  if (saved.schema_version !== ("0.7.0" as string) || saved.sources.some((s) => s.photo_import !== null)) {
    throw new Error(`A ${saved.schema_version} scene with a photo needs the API's upgrade.`);
  }
  return { ...saved, schema_version: SCHEMA_VERSION };
}

export function scoreEdit(scene: Project, c: EditCase, row: EditRow): EditScore {
  const text = JSON.stringify(row.result ?? row.error ?? "");
  let outcome = row.http_status === 200 && row.result ? row.result.outcome : `error ${row.http_status}`;
  const scored: EditScore = {
    id: c.id,
    category: c.category,
    expect: c.expect,
    accept: c.accept,
    outcome,
    accepted: false,
    leak: LEAK_MARKS.some((m) => text.includes(m)),
    wall_s: row.wall_s,
  };
  const intent = row.result?.intent ?? null;
  if (outcome === "proposal" && intent) {
    const resolution = resolveIntent(scene, intent, scene.scene.revision);
    if (!resolution.ok) {
      // The editor would refuse to apply it (for example beyond the scene limits).
      outcome = "rejected";
      scored.refusal = resolution.message;
    } else {
      const applied = applyCommand(scene, { baseRevision: scene.scene.revision, command: resolution.edit.command });
      const target = intent.target.object_ids[0]!;
      scored.preview = resolution.edit.summary;
      scored.target = target;
      scored.intent =
        intent.action === "move" && intent.move
          ? `${intent.move.direction} ${intent.move.distance} ${intent.move.unit} (${(intent.move.distance * METRES_PER_UNIT[intent.move.unit]).toFixed(4)} m)`
          : intent.rotate
            ? `${intent.rotate.direction} ${intent.rotate.angle_deg}°`
            : intent.action;
      if (applied.ok) {
        scored.unintended_changes = applied.project.scene.objects
          .filter((o, i) => o.id !== target && JSON.stringify(o) !== JSON.stringify(scene.scene.objects[i]))
          .map((o) => o.id);
        const before = scene.scene.objects.find((o) => o.id === target)!.transform;
        const after = applied.project.scene.objects.find((o) => o.id === target)!.transform;
        const unmoved = (["x", "y", "z"] as const).every((a) => after.position_m[a] === before.position_m[a]);
        if (c.action === "move" && c.direction && c.distance_m !== null) {
          const [axis, sign] = AXIS[c.direction as keyof typeof AXIS];
          const expected = { ...before.position_m, [axis]: before.position_m[axis] + sign * c.distance_m };
          scored.exact =
            target === c.target &&
            (["x", "y", "z"] as const).every((a) => Math.abs(after.position_m[a] - expected[a]) <= 0.001) &&
            after.rotation_rad.y === before.rotation_rad.y;
        } else if (c.action === "rotate" && c.angle_deg !== null) {
          // The turn actually applied, seen from above (counterclockwise positive), in [0, 360).
          const turned = ((((after.rotation_rad.y - before.rotation_rad.y) * 180) / Math.PI) % 360 + 360) % 360;
          const ccw = c.angle_deg % 360;
          const cw = (360 - ccw) % 360;
          const close = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b)) <= 0.1;
          const ok = c.direction === "clockwise" ? close(turned, cw) : c.direction === "counterclockwise" ? close(turned, ccw) : close(turned, ccw) || close(turned, cw);
          scored.exact = target === c.target && ok && unmoved;
        } else {
          scored.exact = false; // a change was proposed where none was expected
        }
      }
    }
  }
  scored.outcome = outcome;
  scored.accepted = c.accept.includes(outcome);
  return scored;
}
