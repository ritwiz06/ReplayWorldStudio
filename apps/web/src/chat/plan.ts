// A short plan from one chat message (UX-04): its steps in words, the exact commands its changes
// become, a dry run of all of them in order (so the preview and its consequences are those of
// the whole plan), and the bounded "add an object" path: a suggested catalog item, never a silent
// match, placed beside a named object at the stated size. Everything here is pure and checked by
// the same command engine that applies the plan.
import type { CatalogAsset, ChatStep, EditIntent, Project, SceneObject, Transform } from "@replay-world/contracts";
import { resolveIntent } from "../assist/editIntent";
import { footprint } from "../checks/geometry";
import { applyCommand, type CommandRequest, type EditCommand } from "../editing/commands";
import { nameOf } from "./context";

export const MAX_STEPS = 4;

/** Stated sizes come from the person's words in the conversation. */
export const STATED_IN_CHAT = "Stated in the conversation";

export type Side = "left" | "right" | "front" | "back";

/** A step as the plan holds it: what the model asked for, plus what the person chose since. */
export interface PlanStep {
  step: ChatStep;
  /** Chosen by the person for a step that asked (an object, an amount). */
  target: string | null;
  move: ChatStep["move"];
  rotate: ChatStep["rotate"];
  add: AddChoice | null;
}

export interface AddChoice {
  asset: CatalogAsset | null;
  /** True once the person accepted the suggested item (a suggestion is never used silently). */
  accepted: boolean;
  near: string | null;
  side: Side | null;
}

export const MUTATING = new Set(["move", "rotate", "add_object", "undo"]);

export function planStep(step: ChatStep): PlanStep {
  return { step, target: step.target_id, move: step.move, rotate: step.rotate, add: step.add ? { asset: null, accepted: false, near: step.add.near_object_id, side: step.add.side } : null };
}

const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0+$/, "").replace(/\.$/, ""));
const METRES = { km: 1000, m: 1, cm: 0.01, mm: 0.001, ft: 0.3048, in: 0.0254 } as const;

/** What a step will do, in words ("Move Machine B 1 m right"). */
export function stepLabel(project: Project, s: PlanStep, undoLabel: string | null): string {
  const name = (id: string | null) => (id ? nameOf(project, id) : "…");
  switch (s.step.action) {
    case "move":
      return s.move ? `Move ${name(s.target)} ${fmt(s.move.distance * METRES[s.move.unit])} m ${s.move.direction}` : `Move ${name(s.target)}`;
    case "rotate":
      return s.rotate ? `Turn ${name(s.target)} ${fmt(s.rotate.angle_deg)}° ${s.rotate.direction}` : `Turn ${name(s.target)}`;
    case "select":
      return `Show ${name(s.target)}`;
    case "add_object": {
      const a = s.step.add!;
      const size = [a.width_m && `${fmt(a.width_m)} m wide`, a.depth_m && `${fmt(a.depth_m)} m deep`, a.height_m && `${fmt(a.height_m)} m high`].filter(Boolean).join(", ");
      const where = s.add?.near ? ` ${s.add.side ? `to the ${s.add.side} of` : "beside"} ${name(s.add.near)}` : "";
      return `Add a ${a.description}${size ? `, ${size}` : ""}${where}`;
    }
    case "check_route":
      return s.step.route?.from_object_id && !s.step.route.to_object_id ? `Check ${name(s.step.route.from_object_id)}'s routes` : "Check the route";
    case "check_layout":
      return "Check the layout (overlaps, keep-clear zones, routes)";
    case "run_day":
      return "Run the shift";
    case "run_again":
      return "Run the same shift again";
    case "explain_change":
      return "Explain the difference";
    case "undo":
      return undoLabel ? `Undo: ${undoLabel}` : "Undo the last change";
    case "show_example":
      return "Open the example factory";
    case "capabilities":
      return "Say what can be checked here";
    case "save":
      return "Save the project";
    case "export":
      return "Export the run";
    default:
      return s.step.unsupported ?? "Not supported";
  }
}

/** What a step still needs before the plan can be shown in full, or null. */
export function stepNeeds(s: PlanStep): "target" | "move" | "rotate" | "asset" | "near" | "side" | null {
  const a = s.step.action;
  if (a === "move" || a === "rotate" || a === "select") {
    if (!s.target) return "target";
    if (a === "move" && !s.move) return "move";
    if (a === "rotate" && !s.rotate) return "rotate";
  }
  if (a === "add_object" && s.add) {
    if (!s.add.asset || !s.add.accepted) return "asset";
    if (!s.add.near) return "near";
    if (!s.add.side) return "side";
  }
  return null;
}

/** Catalog items whose name shares a word with the description ("packing table" → "Generic
 * packing station"), best first. A suggestion for the person to accept, never a silent match. */
export function suggestAssets(description: string, library: readonly CatalogAsset[]): CatalogAsset[] {
  const ignore = new Set(["a", "an", "the", "of", "generic", "provisional", "new", "small", "large", "big"]);
  const words = (t: string) => t.toLowerCase().match(/[a-z]+/g)?.filter((w) => !ignore.has(w) && w.length > 2) ?? [];
  const wanted = words(description);
  const scored = library
    .map((asset) => ({ asset, score: words(asset.name).filter((w) => wanted.some((x) => x.startsWith(w.slice(0, 5)) || w.startsWith(x.slice(0, 5)))).length }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.asset.name.localeCompare(b.asset.name));
  const seen = new Set<string>();
  return scored.map((x) => x.asset).filter((a) => !seen.has(a.id) && seen.add(a.id));
}

/** Where a new object of `size` stands beside `near`: touching its `side` in plan with 0.2 m
 * between, the same turn. Sides are seen from above (left = −X, front = +Z), as for moves. */
export function besideTransform(near: SceneObject, size: { width: number; depth: number }, side: Side): Transform {
  const gap = 0.2;
  const p = near.transform.position_m;
  const hw = near.dimensions.width.value_m / 2;
  const hd = near.dimensions.depth.value_m / 2;
  const offset = { left: { x: -(hw + gap + size.width / 2), z: 0 }, right: { x: hw + gap + size.width / 2, z: 0 }, back: { x: 0, z: -(hd + gap + size.depth / 2) }, front: { x: 0, z: hd + gap + size.depth / 2 } }[side];
  const round = (v: number) => Math.round(v * 1000) / 1000;
  return { position_m: { x: round(p.x + offset.x), y: p.y, z: round(p.z + offset.z) }, rotation_rad: { order: "XYZ", x: 0, y: 0, z: 0 } };
}

export function newObjectId(project: Project, base: string): string {
  const stem = `obj-chat-${base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "object"}`;
  let n = 1;
  while (project.scene.objects.some((o) => o.id === `${stem}-${n}`)) n++;
  return `${stem}-${n}`;
}

const titleCase = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** The command a changing step becomes on `project`, or why it cannot. Undo has no command. */
export function stepCommand(project: Project, s: PlanStep): { ok: true; command: EditCommand } | { ok: false; message: string } {
  const a = s.step.action;
  if (a === "move" || a === "rotate") {
    const intent: EditIntent = { action: a, target: { reference: "named", object_ids: [s.target!], phrase: nameOf(project, s.target!) }, move: a === "move" ? s.move : null, rotate: a === "rotate" ? s.rotate : null };
    const resolved = resolveIntent(project, intent, project.scene.revision);
    return resolved.ok ? { ok: true, command: resolved.edit.command } : { ok: false, message: resolved.message };
  }
  if (a === "add_object" && s.add?.asset && s.add.near && s.add.side) {
    const add = s.step.add!;
    const near = project.scene.objects.find((o) => o.id === s.add!.near);
    if (!near) return { ok: false, message: "The object to stand beside is no longer in the scene." };
    const nominal = s.add.asset.nominal_dimensions;
    const width = add.width_m ?? nominal.width.value_m;
    const depth = add.depth_m ?? nominal.depth.value_m;
    const values = { ...(add.width_m ? { width: add.width_m } : {}), ...(add.depth_m ? { depth: add.depth_m } : {}), ...(add.height_m ? { height: add.height_m } : {}) };
    return {
      ok: true,
      command: { type: "add_catalog_instance", asset: s.add.asset, objectId: newObjectId(project, add.description), name: titleCase(add.description), transform: besideTransform(near, { width, depth }, s.add.side), values, sourceRef: STATED_IN_CHAT },
    };
  }
  return { ok: false, message: "This step is not ready." };
}

export interface Ghost {
  points: { x: number; z: number }[];
  top: number;
  from: { x: number; z: number } | null;
  to: { x: number; z: number };
}

/** The whole plan's changes, dry-run in order: the project after them, and a ghost for each
 * object moved, turned or added. `undone` is the project after an undo step (from history). */
export function dryRun(project: Project, steps: PlanStep[], undone: Project | null): { ok: true; after: Project; ghosts: Ghost[] } | { ok: false; index: number; message: string } {
  let current = project;
  const ghosts: Ghost[] = [];
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]!;
    if (!MUTATING.has(s.step.action ?? "")) continue;
    if (s.step.action === "undo") {
      if (!undone || i !== steps.findIndex((x) => MUTATING.has(x.step.action ?? ""))) return { ok: false, index: i, message: "Undo can only come first among the changes of one request." };
      current = undone;
      continue;
    }
    const made = stepCommand(current, s);
    if (!made.ok) return { ok: false, index: i, message: made.message };
    const request: CommandRequest = { baseRevision: current.scene.revision, command: made.command };
    const result = applyCommand(current, request);
    if (!result.ok) return { ok: false, index: i, message: result.rejection.message };
    const id = result.change.objectId;
    const before = id ? current.scene.objects.find((o) => o.id === id) : undefined;
    const now = id ? result.project.scene.objects.find((o) => o.id === id) : undefined;
    if (now) ghosts.push({ points: footprint(now), top: now.transform.position_m.y + now.dimensions.height.value_m, from: before ? { x: before.transform.position_m.x, z: before.transform.position_m.z } : null, to: { x: now.transform.position_m.x, z: now.transform.position_m.z } });
    current = result.project;
  }
  return { ok: true, after: current, ghosts };
}
