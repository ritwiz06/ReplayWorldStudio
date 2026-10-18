// The orchestrator's tools for a plan picture (IMP-03): store it (the API renders a PDF page),
// ask the vision model for a draft when the person chooses to, and build the draft world at the
// scale of one known length. The model's answer is a draft of outlines and names, never a size:
// nothing is measured from pixels, the page size or a dimension text. Text on the plan is data.
import type { DrawingAnalysis, ImageAnalysisRequest, PlanPoint, PlanProposalResult, PlanUpload, Project } from "@replay-world/contracts";
import type { ApiClient } from "../api/client";
import { serializeProject } from "../editing/projectFile";
import type { Outcome } from "./orchestrator";
import { buildPlanProject, pictureScale, proposedDrawing } from "./world";

/** Is this file a plan picture (by its name; the API checks its bytes)? */
export const isPlanFile = (file: File) => /\.(pdf|png|jpe?g)$/i.test(file.name);

/** The longest side of the copy the vision model sees. */
const ANALYSIS_SIDE_PX = 1600;

export async function readPlan(client: ApiClient, file: File, signal: AbortSignal): Promise<Outcome<PlanUpload>> {
  const result = await client.uploadPlan(file, file.name, signal);
  return result.ok ? result : { ok: false, message: result.error.message };
}

export async function readPage(client: ApiClient, upload: PlanUpload, page: number, signal: AbortSignal): Promise<Outcome<DrawingAnalysis>> {
  const result = await client.readPlanPage(upload.sha256, page, upload.filename, signal);
  return result.ok ? result : { ok: false, message: result.error.message };
}

/** A copy of the picture for the vision model: at most 1600 px, re-encoded as JPEG, so no
 * metadata goes with it. */
async function pictureCopy(url: string, signal: AbortSignal): Promise<{ data: string; width: number; height: number }> {
  const blob = await (await fetch(url, { signal })).blob();
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, ANALYSIS_SIDE_PX / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(16, Math.round(bitmap.width * scale));
  const height = Math.max(16, Math.round(bitmap.height * scale));
  const canvas = Object.assign(document.createElement("canvas"), { width, height });
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#fff";
  context.fillRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const jpeg = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode"))), "image/jpeg", 0.85));
  const bytes = new Uint8Array(await jpeg.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { data: btoa(binary), width, height };
}

/** Ask the vision model for a draft of the plan (only when the person chooses to). */
export async function proposeLayout(client: ApiClient, analysis: DrawingAnalysis, signal: AbortSignal): Promise<Outcome<PlanProposalResult>> {
  const raster = analysis.drawing.raster;
  if (!raster) return { ok: false, message: "This reading has no picture." };
  let copy: { data: string; width: number; height: number };
  try {
    copy = await pictureCopy(client.sourceFileUrl(raster.uri), signal);
  } catch (err) {
    if (signal.aborted) throw err;
    return { ok: false, message: "The plan picture could not be prepared for the proposal." };
  }
  const body: ImageAnalysisRequest = { media_type: "image/jpeg", data_base64: copy.data, width_px: copy.width, height_px: copy.height, original_sha256: analysis.sha256 };
  const result = await client.proposePlan(body, signal);
  return result.ok ? result : { ok: false, message: result.error.message };
}

/** The known length the person marked, as the draft's scale. */
export interface KnownLength {
  a: PlanPoint;
  b: PlanPoint;
  metres: number;
  /** How precisely each point was marked, in pixels. */
  tolerance: number;
}

/** Build the draft (with the proposal, or none to mark everything by hand) and have the API
 * check it against the contract; nothing is applied. */
export async function preparePlanDraft(client: ApiClient, analysis: DrawingAnalysis, proposal: PlanProposalResult | null, known: KnownLength, signal: AbortSignal): Promise<Outcome<Project>> {
  const drawing = proposedDrawing(analysis, proposal?.proposal ?? null);
  const project = buildPlanProject(analysis, drawing, pictureScale(known.a, known.b, known.metres, known.tolerance));
  const verdict = await client.validateProjectDocument(serializeProject(project), signal);
  if (!verdict.ok) {
    const [first] = verdict.error.kind === "http" || verdict.error.kind === "contract" ? verdict.error.issues : [];
    return { ok: false, message: `The draft did not pass the contract check: ${verdict.error.message}${first ? ` (${first.path}: ${first.message})` : ""}` };
  }
  return { ok: true, value: project };
}
