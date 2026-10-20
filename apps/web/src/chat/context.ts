// What a chat request may tell the language model (UX-03): the words, and the reviewed scene
// facts the request needs - object ids, names, kinds, placements and sizes, the selection - plus
// what the app can do right now. Never a drawing, a picture or a file's text.
import type { ChatState, EditContext, Project } from "@replay-world/contracts";
import { buildEditContext } from "../assist/editIntent";
import type { DrawingSource } from "../drawing/world";

/** The edit context, with a process station named as in the process ("Workbench (Fixtures 5)"),
 * so "the workbench" can be resolved; the object's own name follows when the station lacks it. */
export function buildChatContext(project: Project, selectedId: string | null): EditContext {
  const context = buildEditContext(project, selectedId);
  const stations = new Map((project.process?.stations ?? []).map((s) => [s.object_id, s.name]));
  return {
    ...context,
    objects: context.objects.map((o) => {
      const station = stations.get(o.id);
      if (!station || station.toLowerCase().includes(o.name.toLowerCase())) return { ...o, name: station ?? o.name };
      return { ...o, name: `${station} (${o.name})` };
    }),
  };
}

/** A name for an object in the conversation: its station name when it is one. */
export function nameOf(project: Project, id: string): string {
  const station = project.process?.stations.find((s) => s.object_id === id)?.name;
  const object = project.scene.objects.find((o) => o.id === id);
  if (!object) return id;
  if (!station) return object.name;
  return station.toLowerCase().includes(object.name.toLowerCase()) ? station : `${station} (${object.name})`;
}

export interface WorldFacts {
  hasWorld: boolean;
  hasDrawing: boolean;
  reviewOpen: boolean;
  hasProcess: boolean;
  hasRun: boolean;
  runStale: boolean;
  layoutEdited: boolean;
  canUndo: boolean;
  hasSelection: boolean;
  /** Two runs to compare: a current run on an edited layout. */
  canExplain: boolean;
  /** Whether that run's output differs from the original layout's (null: not known). */
  outputChanged: boolean | null;
}

export function chatState(f: WorldFacts): ChatState {
  return {
    has_world: f.hasWorld,
    has_drawing: f.hasDrawing,
    review_open: f.reviewOpen,
    has_process: f.hasProcess,
    has_run: f.hasRun,
    run_stale: f.runStale,
    layout_edited: f.layoutEdited,
    can_undo: f.canUndo,
  };
}

export type SuggestionId = "example" | "upload" | "capabilities" | "move" | "move_any" | "route" | "run" | "run_example" | "run_again" | "why" | "compare" | "undo" | "export";

export const SUGGESTION_TEXT: Record<SuggestionId, string> = {
  example: "Show me the example factory",
  upload: "Upload a drawing and make a world",
  capabilities: "What can I check in this layout?",
  move: "Move this machine",
  move_any: "Move a machine",
  route: "Will the route still fit?",
  run: "Run a day",
  run_example: "Run an example shift",
  run_again: "Run it again",
  why: "Why did output change?",
  compare: "Compare with the original layout",
  undo: "Undo that",
  export: "Export this run",
};

/** The suggestions that can work now, most useful first (at most four). An empty project
 * offers the three starting points; a world offers what its state allows. */
export function suggestions(f: WorldFacts, sample: boolean): SuggestionId[] {
  if (!f.hasWorld) return ["example", "upload", "capabilities"];
  const out: SuggestionId[] = [];
  if (f.reviewOpen) return ["capabilities"];
  if (f.canExplain) out.push(f.outputChanged ? "why" : "compare");
  if (f.hasRun && f.runStale && f.hasProcess) out.push("run_again");
  out.push(f.hasSelection ? "move" : "move_any");
  if (f.hasDrawing) out.push("route");
  if (f.hasDrawing && !f.hasRun) out.push(sample ? "run_example" : "run");
  if (f.canUndo && out.length < 4) out.push("undo");
  if (!f.hasDrawing && !sample) out.push("example", "upload");
  if (f.hasRun && !f.runStale && out.length < 4) out.push("export");
  return out.slice(0, 4);
}

/** What works now, in plain words, for "What can I check?". */
export function capabilityLines(f: WorldFacts): string[] {
  if (!f.hasWorld) return ["Open the example factory, or attach a DXF, PDF or picture of a plan to make a world.", "Once a world is open: move or turn things, check whether a route fits, run a shift and see why its result changes."];
  if (f.reviewOpen) return ["First, confirm what the drawing shows (the cards below). Then you can move things, check routes and run a shift."];
  const lines = [
    "Move or turn an object by a distance or angle you give, with a preview before anything changes.",
    f.hasDrawing ? "Check whether an item of a width you give can get between two places, and find overlaps (width only; turning and heights are not checked)." : "Route and overlap checks need a reviewed plan.",
    f.hasProcess ? "Run the shift on this layout, run it again after a change, and see why the result changed." : f.hasDrawing ? "Run a day: choose the stations in order; pace and people you don't know are offered as labelled assumptions to accept." : "Running a shift needs a reviewed plan.",
  ];
  if (f.hasRun) lines.push("Export the run as a ZIP someone else can open and rerun.");
  lines.push("It cannot answer general questions, cost or safety, or simulate physics.");
  return lines;
}

/** A route check's sentence, shortened for a card: "Blocked: the best way through narrows to
 * 0.70 m between Machine B and Rack B, and the item needs 0.80 m." becomes "narrows to 0.70 m
 * between Machine B and Rack B; needs 0.80 m". The full sentence stays in the details. */
export function brief(summary: string): string {
  return summary
    .replace(/^Blocked(?: at the (?:start|destination))?:\s*/i, "")
    .replace(/^the best way through /i, "")
    .replace(/^the (start|destination) point is /i, (_m, end: string) => `the ${end === "start" ? "start" : "end"} is `)
    .replace(/, and the item needs ([\d.]+ m)( on each side)?/i, (_m, need: string, each?: string) => `; needs ${need}${each ? " each side" : ""}`)
    .replace(/\.$/, "");
}

/** Layers with loose lines or left-out shapes not yet marked as symbols; `likely` when the name
 * says doors, windows, dimensions, hatches, text or a title block. */
export function symbolCandidates(source: DrawingSource): { layer: string; likely: boolean }[] {
  const layers = new Set<string>();
  for (const line of source.drawing.lines) if (!line.closed && line.ref.block === null) layers.add(line.ref.layer);
  for (const shape of source.drawing.omitted ?? []) layers.add(shape.layer);
  return [...layers]
    .filter((l) => !source.drawing.review.symbol_layers.includes(l))
    .sort()
    .map((layer) => ({ layer, likely: /door|window|dim|hatch|text|title|anno|note|symbol/i.test(layer) }));
}
