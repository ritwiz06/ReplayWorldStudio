// Undo and redo over the command engine. The history lives only in this browser session: a
// saved project keeps its edit log (what changed and the evidence it replaced), not the undo
// stack, so reopening a file starts with nothing to undo.
import type { Project } from "@replay-world/contracts";
import { applyCommand, reapplyChange, revertChange, type Change, type CommandRequest, type Rejection } from "./commands";

export interface HistoryEntry {
  change: Change;
  /** Revision of this change's record in the edit log while it is applied. */
  revision: number;
}

export interface EditorState {
  project: Project;
  undo: readonly HistoryEntry[];
  redo: readonly HistoryEntry[];
}

/** Oldest steps beyond this are dropped from the undo stack (their records stay in the log). */
export const HISTORY_LIMIT = 200;

export type Outcome =
  | { ok: true; state: EditorState; change: Change; kind: "execute" | "undo" | "redo" }
  | { ok: false; state: EditorState; rejection: Rejection };

export function createEditor(project: Project): EditorState {
  return { project, undo: [], redo: [] };
}

/** Apply a command. Accepting any new edit clears the redo branch. */
export function execute(state: EditorState, request: CommandRequest): Outcome {
  const result = applyCommand(state.project, request);
  if (!result.ok) return { ok: false, state, rejection: result.rejection };
  const entry = { change: result.change, revision: result.project.scene.revision };
  return {
    ok: true,
    kind: "execute",
    change: result.change,
    state: { project: result.project, undo: [...state.undo, entry].slice(-HISTORY_LIMIT), redo: [] },
  };
}

export function undo(state: EditorState, baseRevision: number): Outcome {
  const entry = state.undo.at(-1);
  if (!entry) return { ok: false, state, rejection: { kind: "no_change", message: "Nothing to undo." } };
  const result = revertChange(state.project, entry.change, entry.revision, baseRevision);
  if (!result.ok) return { ok: false, state, rejection: result.rejection };
  return {
    ok: true,
    kind: "undo",
    change: entry.change,
    state: { project: result.project, undo: state.undo.slice(0, -1), redo: [...state.redo, entry] },
  };
}

export function redo(state: EditorState, baseRevision: number): Outcome {
  const entry = state.redo.at(-1);
  if (!entry) return { ok: false, state, rejection: { kind: "no_change", message: "Nothing to redo." } };
  const result = reapplyChange(state.project, entry.change, baseRevision);
  if (!result.ok) return { ok: false, state, rejection: result.rejection };
  const redone = { change: entry.change, revision: result.project.scene.revision };
  return {
    ok: true,
    kind: "redo",
    change: entry.change,
    state: { project: result.project, undo: [...state.undo, redone], redo: state.redo.slice(0, -1) },
  };
}
