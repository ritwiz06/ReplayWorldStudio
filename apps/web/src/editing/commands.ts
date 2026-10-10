// The one path by which the editor changes a project. Every change is a typed command checked
// against the scene revision it was prepared for. A command either applies completely - one
// new project value, one edit record and one reversible change - or is rejected and leaves the
// project exactly as it was (projects are never mutated in place).
//
// Revisions: every accepted command, undo and redo advances `scene.revision` by exactly one.
// A command whose `baseRevision` is not the current revision is rejected as a conflict, so an
// edit prepared before an undo (or any other change) can never be applied to a newer state.
import {
  validateProject,
  type Dimensions,
  type Length,
  type ObjectAdded,
  type ObjectEdited,
  type ObjectRemoved,
  type Project,
  type SceneObject,
  type Transform,
} from "@replay-world/contracts";

export type Axis = keyof Dimensions;
export const AXIS_ORDER: readonly Axis[] = ["width", "height", "depth"];

export type EditCommand =
  /** Move and/or rotate an object; the transform is the complete new placement. */
  | { type: "set_transform"; objectId: string; transform: Transform }
  /** Change one or more dimension axes; each changed axis becomes user-supplied. */
  | { type: "set_dimensions"; objectId: string; values: Partial<Record<Axis, number>> }
  /** Place a new instance of a catalog asset at its nominal size and evidence. */
  | { type: "add_instance"; assetId: string; objectId: string; name: string; transform: Transform }
  /** Copy an object (dimensions, evidence, asset and parameters) to a new placement. */
  | { type: "duplicate_object"; sourceId: string; objectId: string; name: string; transform: Transform }
  | { type: "remove_object"; objectId: string };

export interface CommandRequest {
  /** The scene revision the command was prepared against. */
  baseRevision: number;
  command: EditCommand;
}

export type RejectionKind = "conflict" | "not_found" | "invalid" | "no_change";

export interface Rejection {
  kind: RejectionKind;
  message: string;
  /** Which input was wrong, e.g. "position.x" or "dimensions.width". */
  field?: string;
}

export type EditRecord = ObjectEdited | ObjectAdded | ObjectRemoved;
type DraftOf<T> = T extends unknown ? Omit<T, "revision"> : never;
export type EditRecordDraft = DraftOf<EditRecord>;

/** The record with its revision, keys in contract order (as the API writes them). */
function stamp(draft: EditRecordDraft, revision: number): EditRecord {
  const { type, ...rest } = draft;
  return { type, revision, ...rest } as EditRecord;
}

/** Object snapshots at one list index: insert (before null), replace, or remove (after null). */
export interface ObjectPatch {
  index: number;
  before: SceneObject | null;
  after: SceneObject | null;
}

/** A reversible change produced by one accepted command. */
export interface Change {
  /** Short description for undo/redo controls, e.g. "Move Filling cell". */
  label: string;
  /** The object the change is about (selected after undo or redo when it exists). */
  objectId: string;
  patch: ObjectPatch;
  /** The edit record without its revision; the revision is assigned when (re)applied. */
  record: EditRecordDraft;
}

export type Result<T> = ({ ok: true } & T) | { ok: false; rejection: Rejection };

/** Editor limits. The contract only requires finite values and positive lengths; these keep
 * typed mistakes (an extra zero, metres for millimetres) out of a factory-sized scene. */
export const LIMITS = {
  coordinateM: 1000,
  minLengthM: 0.001,
  maxLengthM: 1000,
  angleRad: 2 * Math.PI,
} as const;

export const EDIT_SOURCE_REF = "Entered in the editor; the previous value and its evidence are in the scene edit log";

const STABLE_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/;

const reject = (kind: RejectionKind, message: string, field?: string): { ok: false; rejection: Rejection } => ({
  ok: false,
  rejection: field === undefined ? { kind, message } : { kind, message, field },
});

function checkTransform(t: Transform): Rejection | null {
  if (t.rotation_rad.order !== "XYZ") return { kind: "invalid", message: "Rotation order must be XYZ.", field: "rotation" };
  for (const axis of ["x", "y", "z"] as const) {
    const p = t.position_m[axis];
    if (!Number.isFinite(p)) return { kind: "invalid", message: `Position ${axis.toUpperCase()} must be a finite number.`, field: `position.${axis}` };
    if (Math.abs(p) > LIMITS.coordinateM) {
      return { kind: "invalid", message: `Position ${axis.toUpperCase()} must be within ±${LIMITS.coordinateM} m.`, field: `position.${axis}` };
    }
    const r = t.rotation_rad[axis];
    if (!Number.isFinite(r)) return { kind: "invalid", message: `Rotation ${axis.toUpperCase()} must be a finite number.`, field: `rotation.${axis}` };
    if (Math.abs(r) > LIMITS.angleRad + 1e-9) {
      return { kind: "invalid", message: `Rotation ${axis.toUpperCase()} must be within ±360°.`, field: `rotation.${axis}` };
    }
  }
  return null;
}

function checkLength(axis: Axis, value: number): Rejection | null {
  const field = `dimensions.${axis}`;
  if (!Number.isFinite(value)) return { kind: "invalid", message: `The ${axis} must be a finite number.`, field };
  if (value < LIMITS.minLengthM) return { kind: "invalid", message: `The ${axis} must be at least ${LIMITS.minLengthM * 1000} mm.`, field };
  if (value > LIMITS.maxLengthM) return { kind: "invalid", message: `The ${axis} must be at most ${LIMITS.maxLengthM} m.`, field };
  return null;
}

const sameTransform = (a: Transform, b: Transform): boolean =>
  (["x", "y", "z"] as const).every((k) => a.position_m[k] === b.position_m[k] && a.rotation_rad[k] === b.rotation_rad[k]) &&
  a.rotation_rad.order === b.rotation_rad.order;

const copyTransform = (t: Transform): Transform => ({
  position_m: { x: t.position_m.x, y: t.position_m.y, z: t.position_m.z },
  rotation_rad: { order: t.rotation_rad.order, x: t.rotation_rad.x, y: t.rotation_rad.y, z: t.rotation_rad.z },
});

/** Every object ID the project has used: current objects and any named in the edit log. */
export function usedObjectIds(project: Project): Set<string> {
  const ids = new Set(project.scene.objects.map((o) => o.id));
  for (const record of project.scene.edit_log) {
    if (record.type === "object_removed") ids.add(record.object.id);
    else ids.add(record.object_id);
    if (record.type === "object_added" && record.duplicate_of) ids.add(record.duplicate_of);
  }
  return ids;
}

function checkNewObject(project: Project, objectId: string, name: string): Rejection | null {
  if (!STABLE_ID.test(objectId)) {
    return { kind: "invalid", message: `'${objectId}' is not a valid object ID (lowercase letters, digits and . _ : -).`, field: "id" };
  }
  if (usedObjectIds(project).has(objectId)) {
    return { kind: "invalid", message: `Object ID '${objectId}' is already used in this project; IDs are never reused.`, field: "id" };
  }
  if (name.trim().length === 0 || name.length > 500) return { kind: "invalid", message: "A name of 1-500 characters is required.", field: "name" };
  return null;
}

function describeTransform(before: Transform, after: Transform): string {
  const moved = (["x", "y", "z"] as const).some((k) => before.position_m[k] !== after.position_m[k]);
  const rotated = (["x", "y", "z"] as const).some((k) => before.rotation_rad[k] !== after.rotation_rad[k]);
  return moved && rotated ? "Move and rotate" : rotated ? "Rotate" : "Move";
}

/** Build the change a command would make, without touching the project. */
function prepare(project: Project, command: EditCommand): Result<{ change: Change }> {
  const objects = project.scene.objects;
  const indexOf = (id: string) => objects.findIndex((o) => o.id === id);

  switch (command.type) {
    case "set_transform": {
      const index = indexOf(command.objectId);
      const before = objects[index];
      if (!before) return reject("not_found", `No object '${command.objectId}' in the scene.`);
      const problem = checkTransform(command.transform);
      if (problem) return { ok: false, rejection: problem };
      if (sameTransform(before.transform, command.transform)) return reject("no_change", "The placement is unchanged.");
      const transform = copyTransform(command.transform);
      return {
        ok: true,
        change: {
          label: `${describeTransform(before.transform, transform)} ${before.name}`,
          objectId: before.id,
          patch: { index, before, after: { ...before, transform } },
          record: { type: "object_edited", object_id: before.id, transform: { before: before.transform, after: transform }, dimensions: [] },
        },
      };
    }

    case "set_dimensions": {
      const index = indexOf(command.objectId);
      const before = objects[index];
      if (!before) return reject("not_found", `No object '${command.objectId}' in the scene.`);
      const requested = AXIS_ORDER.filter((axis) => command.values[axis] !== undefined);
      if (requested.length === 0) return reject("invalid", "No dimension was given.");
      // Check every axis before changing any, so a bad value never leaves a partial edit.
      for (const axis of requested) {
        const problem = checkLength(axis, command.values[axis]!);
        if (problem) return { ok: false, rejection: problem };
      }
      const changed = requested.filter((axis) => command.values[axis] !== before.dimensions[axis].value_m);
      if (changed.length === 0) return reject("no_change", "The dimensions are unchanged.");
      const dimensions: Dimensions = { ...before.dimensions };
      for (const axis of changed) {
        const edited: Length = {
          value_m: command.values[axis]!,
          origin: "user_supplied",
          source_ref: EDIT_SOURCE_REF,
          review_status: "unreviewed",
          uncertainty_m: null,
        };
        dimensions[axis] = edited;
      }
      return {
        ok: true,
        change: {
          label: `Resize ${before.name} (${changed.join(", ")})`,
          objectId: before.id,
          patch: { index, before, after: { ...before, dimensions } },
          record: {
            type: "object_edited",
            object_id: before.id,
            transform: null,
            dimensions: changed.map((axis) => ({ axis, before: before.dimensions[axis], after: dimensions[axis] })),
          },
        },
      };
    }

    case "add_instance": {
      const asset = project.catalog.find((a) => a.id === command.assetId);
      if (!asset) return reject("not_found", `No catalog asset '${command.assetId}' in this project.`);
      const problem = checkNewObject(project, command.objectId, command.name) ?? checkTransform(command.transform);
      if (problem) return { ok: false, rejection: problem };
      const after: SceneObject = {
        id: command.objectId,
        name: command.name,
        kind: asset.kind,
        asset_id: asset.id,
        transform: copyTransform(command.transform),
        // The catalog's nominal size, with its evidence, until someone measures this instance.
        dimensions: structuredClone(asset.nominal_dimensions),
        parameters: [],
      };
      return {
        ok: true,
        change: {
          label: `Add ${command.name}`,
          objectId: after.id,
          patch: { index: objects.length, before: null, after },
          record: { type: "object_added", object_id: after.id, asset_id: asset.id, duplicate_of: null },
        },
      };
    }

    case "duplicate_object": {
      const index = indexOf(command.sourceId);
      const source = objects[index];
      if (!source) return reject("not_found", `No object '${command.sourceId}' in the scene.`);
      const problem = checkNewObject(project, command.objectId, command.name) ?? checkTransform(command.transform);
      if (problem) return { ok: false, rejection: problem };
      const after: SceneObject = {
        ...structuredClone(source),
        id: command.objectId,
        name: command.name,
        transform: copyTransform(command.transform),
      };
      return {
        ok: true,
        change: {
          label: `Duplicate ${source.name}`,
          objectId: after.id,
          patch: { index: index + 1, before: null, after },
          record: { type: "object_added", object_id: after.id, asset_id: source.asset_id, duplicate_of: source.id },
        },
      };
    }

    case "remove_object": {
      const index = indexOf(command.objectId);
      const before = objects[index];
      if (!before) return reject("not_found", `No object '${command.objectId}' in the scene.`);
      return {
        ok: true,
        change: {
          label: `Remove ${before.name}`,
          objectId: before.id,
          patch: { index, before, after: null },
          record: { type: "object_removed", object: before },
        },
      };
    }
  }
}

function patchObjects(objects: readonly SceneObject[], patch: ObjectPatch): SceneObject[] {
  const next = [...objects];
  if (patch.before === null && patch.after !== null) next.splice(patch.index, 0, patch.after);
  else if (patch.after === null) next.splice(patch.index, 1);
  else next[patch.index] = patch.after;
  return next;
}

const invert = (patch: ObjectPatch): ObjectPatch => ({ index: patch.index, before: patch.after, after: patch.before });

/** The patch can be applied: the object at its index is exactly the expected snapshot. */
function patchApplies(objects: readonly SceneObject[], patch: ObjectPatch): boolean {
  if (patch.before === null) return patch.index <= objects.length && !objects.some((o) => o.id === patch.after?.id);
  return objects[patch.index] === patch.before;
}

/** Final structural guard: the scene the editor holds always passes the contract schema. */
function guard(project: Project): Rejection | null {
  const check = validateProject(project);
  return check.ok ? null : { kind: "invalid", message: `The edit would break the project contract at ${check.issues[0]?.path ?? "/"}.` };
}

function checkRevision(project: Project, baseRevision: number): Rejection | null {
  const current = project.scene.revision;
  return baseRevision === current
    ? null
    : { kind: "conflict", message: `The scene changed (revision ${current}) since this edit was prepared at revision ${baseRevision}; it was not applied.` };
}

/** Apply a command, producing the next project and its reversible change. */
export function applyCommand(project: Project, request: CommandRequest): Result<{ project: Project; change: Change }> {
  const conflict = checkRevision(project, request.baseRevision);
  if (conflict) return { ok: false, rejection: conflict };
  const prepared = prepare(project, request.command);
  if (!prepared.ok) return prepared;
  const next = commit(project, prepared.change.patch, (revision) => [...project.scene.edit_log, stamp(prepared.change.record, revision)]);
  const problem = guard(next);
  return problem ? { ok: false, rejection: problem } : { ok: true, project: next, change: prepared.change };
}

function commit(project: Project, patch: ObjectPatch, log: (revision: number) => EditRecord[]): Project {
  const revision = project.scene.revision + 1;
  return {
    ...project,
    scene: { ...project.scene, revision, objects: patchObjects(project.scene.objects, patch), edit_log: log(revision) },
  };
}

/**
 * Undo `change`, whose record sits at the end of the edit log with `recordRevision`. The objects
 * return to their earlier snapshots, the record leaves the log, and the revision advances.
 */
export function revertChange(project: Project, change: Change, recordRevision: number, baseRevision: number): Result<{ project: Project }> {
  const conflict = checkRevision(project, baseRevision);
  if (conflict) return { ok: false, rejection: conflict };
  const log = project.scene.edit_log;
  const inverse = invert(change.patch);
  if (log.at(-1)?.revision !== recordRevision || !patchApplies(project.scene.objects, inverse)) {
    return reject("conflict", "The scene no longer matches this step, so it cannot be undone.");
  }
  return { ok: true, project: commit(project, inverse, () => log.slice(0, -1)) };
}

/** Redo `change`: the same snapshots again, with its record re-added at the new revision. */
export function reapplyChange(project: Project, change: Change, baseRevision: number): Result<{ project: Project }> {
  const conflict = checkRevision(project, baseRevision);
  if (conflict) return { ok: false, rejection: conflict };
  if (!patchApplies(project.scene.objects, change.patch)) {
    return reject("conflict", "The scene no longer matches this step, so it cannot be redone.");
  }
  return { ok: true, project: commit(project, change.patch, (revision) => [...project.scene.edit_log, stamp(change.record, revision)]) };
}
