// The public preview's sample (ADR-054): the synthetic factory hall of
// fixtures/drawings/layout-checks-mm.dxf, already reviewed, so a newcomer can move one machine
// and watch a width-only route go from clear to blocked. The route asked about is part of the
// sample, not of the saved project.
import type { DrawingAnalysis, PlanPoint, Project } from "@replay-world/contracts";
import { createEditor, type EditorState, execute } from "../editing/history";
import { SAMPLE_PROCESS } from "../run/example";
import type { ReviewCorrection } from "./review";
import { buildDrawingProject } from "./world";

export const SAMPLE_PROJECT_ID = "proj-sample-factory-hall";
/** The machine to move, and where the "Move it for me" button puts it (drawing mm). */
export const SAMPLE_MACHINE = "Machine B";
export const SAMPLE_MOVE_TO: PlanPoint = { x: 8500, y: 5000 };
/** The question the sample asks: along the aisle, a 1.20 m item with 0.10 m each side. */
export const SAMPLE_ROUTE = { start: { x: 1000, y: 5000 }, end: { x: 16000, y: 5000 }, width: "1.2", allowance: "0.1" } as const;

export function sampleProject(analysis: DrawingAnalysis): Project {
  let editor: EditorState = createEditor(buildDrawingProject(analysis, "mm"));
  const corrections: ReviewCorrection[] = [{ kind: "accept_floor" }, { kind: "unit", unit: "mm" }, { kind: "accept_remaining" }, { kind: "accept_omissions" }];
  for (const correction of corrections) {
    const outcome = execute(editor, { baseRevision: editor.project.scene.revision, command: { type: "review_drawing", sourceId: editor.project.sources[0]!.id, correction } });
    if (!outcome.ok) throw new Error(outcome.rejection.message);
    editor = outcome.state;
  }
  const project = editor.project;
  return {
    ...project,
    id: SAMPLE_PROJECT_ID,
    name: "Sample factory hall (synthetic)",
    fixture: {
      kind: "demonstration",
      note: "A synthetic sample: a 20 m x 10 m hall drawn as a DXF, reviewed, with two racks and a 2 m aisle, and an example shift for Run a day. Not a real site; sizes are the drawing's, heights are assumed for display, and the shift's times and workers are made-up assumptions.",
    },
    // A fresh start: the review that made it is the sample's own preparation, not your edits.
    scene: { ...project.scene, revision: 0, edit_log: [] },
    // An example shift for Run a day; its values are assumptions, labelled as such.
    process: SAMPLE_PROCESS,
  };
}
