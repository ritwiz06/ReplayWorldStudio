// The one bounded orchestrator for "upload a plan" (AGT-01): a fixed sequence of typed tools
// over the existing deterministic operations. It reads the drawing (API, no language model),
// waits for the unit when the drawing does not settle it, builds the draft world (local, pure)
// and has the API check it against the contract. Nothing replaces the open project: the result
// is handed to the editor, which applies its own unsaved-change protection. Text in the file is
// data, never an instruction; no step calls a model, so the first view never waits for one.
import type { DrawingAnalysis, Project } from "@replay-world/contracts";
import type { ApiClient } from "../api/client";
import { serializeProject } from "../editing/projectFile";
import { buildDrawingProject, type DrawingUnit, headerUnit } from "./world";

export const MAX_DRAWING_BYTES = 10 * 1024 * 1024;

export const DWG_MESSAGE =
  "DWG files can't be read yet - DWG support is planned. In your CAD program choose Save As (or Export) > DXF, AutoCAD 2000 or later, ASCII format, then upload the .dxf file.";

export type StepId = "read" | "units" | "build" | "check";

export const STEPS: readonly { id: StepId; label: string }[] = [
  { id: "read", label: "Read the drawing" },
  { id: "units", label: "Settle the unit" },
  { id: "build", label: "Build the 3D draft" },
  { id: "check", label: "Check it against the contract" },
];

export type Outcome<T> = { ok: true; value: T } | { ok: false; message: string };

/** Refuse what is not worth sending: a DWG (with the export route) or an oversized file. */
export function precheck(file: File): string | null {
  if (/\.dwg$/i.test(file.name)) return DWG_MESSAGE;
  if (file.size > MAX_DRAWING_BYTES) return `The drawing is ${(file.size / 1048576).toFixed(1)} MB; the limit is 10 MB. Export only the floor-layout layers.`;
  if (file.size === 0) return "The file is empty.";
  return null;
}

/** Tool 1: read the drawing (the API stores it by its sha256 only if it can be read). */
export async function readDrawing(client: ApiClient, file: File, signal: AbortSignal): Promise<Outcome<DrawingAnalysis>> {
  const refused = precheck(file);
  if (refused) return { ok: false, message: refused };
  const result = await client.uploadDrawing(file, file.name, signal);
  return result.ok ? result : { ok: false, message: result.error.message };
}

/** Tool 2: the unit to build with now, or null while the person has to choose. */
export function settledUnit(analysis: DrawingAnalysis, chosen: DrawingUnit | null): DrawingUnit | null {
  return chosen ?? headerUnit(analysis.drawing);
}

/** Tools 3 and 4: build the draft world and have the API check it; nothing is applied. */
export async function prepareDraft(client: ApiClient, analysis: DrawingAnalysis, unit: DrawingUnit, signal: AbortSignal): Promise<Outcome<Project>> {
  const project = buildDrawingProject(analysis, unit);
  const verdict = await client.validateProjectDocument(serializeProject(project), signal);
  if (!verdict.ok) {
    const [first] = verdict.error.kind === "http" || verdict.error.kind === "contract" ? verdict.error.issues : [];
    return { ok: false, message: `The draft did not pass the contract check: ${verdict.error.message}${first ? ` (${first.path}: ${first.message})` : ""}` };
  }
  return { ok: true, value: project };
}
