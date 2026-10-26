// The conversation (UX-03/UX-04, AGT-01): one orchestrating assistant over a small registry of
// typed, bounded actions. A typed message is interpreted by the language model in one cancellable
// call; its answer is a short plan of checked steps, a question or "cannot". The app resolves
// what a step still needs (an object, an amount, which side), previews the whole plan's changes
// in the world with their consequences from the existing checks, and after one Apply performs the
// steps in order with its own deterministic code: the edit commands (undoable), the route and
// layout checks, the guided setup and the run engine. Suggestions, forms and attachments use the
// same actions directly, with no model at all. A late answer - after Cancel, or after the scene
// changed - is never applied; a plan never runs twice; a failed step stops the steps after it.
import type { CatalogAsset, ChatResult, ChatStep, Project, UploadedModelReport } from "@replay-world/contracts";
import { envelopeFill, fitScale, modelExtents } from "../scene/fit";
import { useState, useSyncExternalStore } from "react";
import type { ApiClient } from "../api/client";
import { type RouteAsk, runChecks, type SceneChecks, sceneChecks } from "../checks/results";
import { precheck, prepareDraft, readDrawing, settledUnit } from "../drawing/orchestrator";
import { type DrawingSource, type DrawingUnit, drawingSource, formatSize } from "../drawing/world";
import { type CommandRequest, canChangeLook } from "../editing/commands";
import type { Outcome } from "../editing/history";
import { compareDays, type DayComparison, type DayRun, plural, runDay, valueCounts } from "../run/day";
import { clockText } from "../run/replay";
import { brief, buildChatContext, capabilityLines, chatState, nameOf, SUGGESTION_TEXT, type SuggestionId, type WorldFacts } from "./context";
import { editImpact } from "./impact";
import { type AddChoice, dryRun, type Ghost, MUTATING, type PlanStep, planStep, type Side, stepCommand, stepLabel, stepNeeds, suggestAssets } from "./plan";
import { answerAsked, answerProcess, routeBetween } from "./routes";
import { type Candidate, describeFor, equipmentToImprove, type Match, matchEquipment } from "../matching/appearance";

export type Tone = "info" | "done" | "warn" | "error" | "progress" | "question";

export interface CardButton {
  label: string;
  testId: string;
  primary?: boolean;
  run: () => void;
}

export interface CardChoice {
  label: string;
  testId: string;
  objectId: string | null;
  run: () => void;
}

export type ChatForm =
  | { kind: "move"; objectId: string | null }
  | { kind: "route"; fromId: string | null; toId: string | null; width: string; allowance: string }
  | { kind: "unit"; units: { unit: DrawingUnit; label: string }[]; choose: (unit: DrawingUnit) => void };

export interface Entry {
  id: number;
  role: "user" | "assistant";
  /** The card's kind, for styling and tests: proposal, question, route, run, why, … */
  kind: string;
  text: string;
  tone: Tone;
  lines?: string[];
  details?: string[];
  buttons?: CardButton[];
  choices?: CardChoice[];
  form?: ChatForm | null;
  /** Interpreted by the language model: live, or a recorded answer replayed (tests). */
  via?: "live" | "recorded" | null | undefined;
  /** Its buttons no longer apply (done, cancelled or out of date). */
  closed?: boolean;
  /** A plan of several steps (UX-04): its rows, and whether it can be applied. */
  plan?: PlanView;
  /** Reviewing models for imported equipment (UX-05). */
  look?: LookView;
  /** Reviewing an attached .glb for one object (ENR-01). */
  model?: ModelView;
  /** Where the time went (UX-05), in ms: interpreting (and the provider's part of it),
   * preparing the proposal in the browser, and performing it after Apply. */
  timing?: { interpretMs?: number; providerMs?: number; prepareMs?: number; executeMs?: number };
}

export type RowStatus = "ready" | "needs" | "running" | "done" | "failed" | "skipped" | "cancelled" | "unsupported";

export interface PlanRow {
  index: number;
  label: string;
  status: RowStatus;
  note: string | null;
  need:
    | { kind: "target"; question: string; candidates: { id: string; label: string }[] }
    | { kind: "move"; question: string; objectId: string | null }
    | { kind: "rotate"; question: string }
    | { kind: "asset"; question: string; suggestion: { id: string; label: string } | null; description: string }
    | { kind: "near"; question: string; candidates: { id: string; label: string }[] }
    | { kind: "side"; question: string; near: string }
    /** A part the interpreter could not understand (UX-05): answered by asking again. */
    | { kind: "clarify"; question: string }
    | null;
}

export interface PlanView {
  id: number;
  phase: "review" | "running" | "done" | "cancelled" | "stale" | "failed";
  rows: PlanRow[];
  canApply: boolean;
}

export interface ChatPreview {
  /** A plan's changes, dry-run: where each moved, turned or added object would stand. */
  ghosts: Ghost[];
  candidates: string[];
  route: SceneChecks | null;
}

export interface ChatHost {
  client: ApiClient;
  project: Project | null;
  loadId: number;
  source: DrawingSource | null;
  selectedId: string | null;
  /** `deadlineS`: the API's end-to-end deadline for interpreting one message (UX-05). */
  assist: { available: boolean; mode: "live" | "recorded" | "off" | "checking" | "unreachable"; note: string; deadlineS?: number | null };
  facts: WorldFacts;
  routeAsk: RouteAsk | null;
  day: DayRun | null;
  isSample: boolean;
  undoLabel: string | null;
  fileError: string | null;
  loadSample(): void;
  openFile(file: File): void;
  createWorld(project: Project, filename: string): void;
  pictureImport(file: File): void;
  select(id: string | null): void;
  execute(request: CommandRequest): Outcome | null;
  undo(): Outcome | null;
  setRouteAsk(ask: RouteAsk | null): void;
  setPreview(preview: ChatPreview | null): void;
  runDay(target?: Project): DayRun | null;
  compare(): { original: DayRun; result: DayComparison } | null;
  openSetup(): void;
  save(): string | null;
  exportRun(): boolean;
  openSheet(view: "review" | "check" | "run" | "compare"): void;
  pickFile(): void;
  /** The project an undo would leave (from the edit history), without changing anything. */
  previewUndo(): Project | null;
  /** Catalog items the app ships (the fixtures' catalogs) plus this project's own. */
  library(): Promise<CatalogAsset[]>;
  /** The existing Describe-an-object or builder window, with the person's words kept. */
  openCreate(kind: "describe" | "builder", description: string): void;
  /** Choose a .glb from this computer for one object (ENR-01). */
  pickModelFile(objectId: string): void;
  /** Improve one object's look from a photo of it (ENR-01): the review window, with the photo
   * already chosen when it was attached here. */
  openPhotoLook(objectId: string, file: File | null): void;
  /** Select an object and bring it into view (for reviewing its look closely). */
  focusObject(objectId: string): void;
  /** Draw one object with a candidate model while it is reviewed (display only; UX-05). */
  setLookPreview(preview: { objectId: string; asset: CatalogAsset } | null): void;
  /** The object generator for an existing object (UX-05): its words and recorded size carried
   * over; the reviewed result becomes that object's model (one undoable step), never a new
   * object. `done` gets what happened: applied, refused, or null when closed without a model. */
  openLookCreate(objectId: string, kind: "describe" | "builder", initial: { text: string; name: string; size: { width: number; depth: number; height: number } }, done: (outcome: { ok: true; assetName: string } | { ok: false; message: string } | null) => void): void;
}

/** One option for an object's look, as the appearance card shows it. */
export interface LookOption {
  assetId: string;
  name: string;
  reason: string;
  warnings: string[];
  /** The fit in one line, for the list of options. */
  summary: string;
  generic: boolean;
  /** A small still of the model (shipped models only), or null. */
  preview: string | null;
}

export interface LookRow {
  objectId: string;
  label: string;
  /** suggested: the names agree; ask: the name says nothing; none: no model of that kind;
   * chosen: a model is picked for Apply; kept: the current look stays; made: a generated model
   * was applied to it from this card. */
  status: "suggested" | "ask" | "none" | "chosen" | "kept" | "made";
  question: string | null;
  suggestion: LookOption | null;
  chosen: string | null;
  options: LookOption[];
  browsing: boolean;
  note: string | null;
}

export interface LookView {
  id: number;
  phase: "review" | "applied" | "cancelled" | "stale" | "undone";
  rows: LookRow[];
  canApply: boolean;
}

interface LookState {
  id: number;
  entryId: number;
  loadId: number;
  baseRevision: number;
  library: CatalogAsset[];
  rows: { match: Match; chosen: string | null; kept: boolean; browsing: boolean; made: string | null; note: string | null }[];
  phase: LookView["phase"];
  revisionAfter: number | null;
  applied: number;
}

export type UpAxis = "+Y" | "-Y" | "+Z" | "-Z" | "+X" | "-X";
export type ModelUnit = "m" | "cm" | "mm" | "in" | "ft";
type Triple = [number, number, number];

/** An attached model under review for one object (ENR-01): the choices, and what they give. */
export interface ModelView {
  id: number;
  phase: "review" | "applied" | "cancelled" | "stale" | "undone";
  objectId: string;
  label: string;
  filename: string;
  up: UpAxis;
  turns: number;
  unit: ModelUnit;
  fit: "contain" | "scale_to_dimensions";
  showing: "proposed" | "current";
  busy: boolean;
  /** Sizes, width × height × depth in metres: the model as turned; the object's recorded ones
   * (never changed); and the model as drawn in that space. */
  model: Triple | null;
  recorded: Triple;
  recordedNote: string;
  drawn: Triple | null;
  /** Problems to see before Apply, beside it. */
  warnings: string[];
  /** Technical details, folded. */
  details: string[];
  scaleHint: string | null;
}

interface ModelState {
  id: number;
  entryId: number;
  loadId: number;
  baseRevision: number;
  objectId: string;
  expected: string | null;
  report: UploadedModelReport;
  up: UpAxis;
  turns: number;
  unit: ModelUnit;
  fit: ModelView["fit"];
  showing: ModelView["showing"];
  asset: CatalogAsset | null;
  busy: boolean;
  problem: string | null;
  phase: ModelView["phase"];
  revisionAfter: number | null;
  /** Bumped on every choice, so a slower earlier proposal never overwrites a newer one. */
  ask: number;
}

const ORIGIN_WORDS: Record<string, string> = { drawn: "drawn", default: "assumed", inferred: "estimated", measured: "measured", supplier: "supplier", user_supplied: "entered" };

/** Stills of the shipped models (public/catalog-previews/), for the appearance card. */
const SHIPPED_PREVIEWS = new Set(["asset-belt-conveyor-3m", "asset-guarded-machine-cell", "asset-electrical-cabinet-800", "asset-pallet-cartons"]);

function lookOption(c: Candidate): LookOption {
  return { assetId: c.asset.id, name: c.asset.name, reason: c.reason, warnings: c.warnings, summary: c.summary, generic: c.generic, preview: SHIPPED_PREVIEWS.has(c.asset.id) ? `/catalog-previews/${c.asset.id}.jpg` : null };
}

/** Why a model was used, as recorded with the change: the suggestion's reason or the choice. */
function reasonOf(match: Match, assetId: string): string {
  const options = match.kind === "suggested" ? [match.best, ...match.others] : match.options;
  const option = options.find((o) => o.asset.id === assetId);
  if (match.kind === "suggested" && match.best.asset.id === assetId) return `suggested: ${option?.reason ?? "the names agree"}`;
  return "chosen by the person";
}

/** A file is a binary glTF by its content (the first four bytes), whatever its name. */
async function isGlb(file: File): Promise<boolean> {
  try {
    return new TextDecoder().decode(await file.slice(0, 4).arrayBuffer()) === "glTF";
  } catch {
    return false;
  }
}

/** Typed requests about how equipment looks are handled here, without the AI. */
const LOOK_WORDS = /\b(appearance|recogni[sz]e|recogni[sz]able|look(s)? like|models? for|easier to see|look of)\b/i;



function runSentence(run: DayRun, project: Project): { text: string; lines: string[]; tone: Tone } {
  const process = project.process!;
  const result = run.result;
  if (!result) return { text: `The shift can't run yet: ${run.plan.reasons.join("; ")}.`, lines: [], tone: "warn" };
  const m = result.metrics;
  const item = plural(process.item_name);
  const end = clockText(process.shift.start_clock_s.value, process.shift.duration_s.value * 1000);
  const lines: string[] = [];
  if (run.plan.outcome === "blocked") {
    const [route, why] = run.plan.reasons[0]!.split(/ is blocked for [^:]*: /);
    lines.push(why ? `Blocked: ${route}: ${brief(why)}.` : `Blocked: ${run.plan.reasons[0]}`);
  }
  if (m.busiest) lines.push(`${m.busiest} is the busiest station and sets the pace.`);
  return {
    text: `${m.completed} ${item} completed by ${end}${m.unfinished ? `, ${m.unfinished} unfinished` : ""}.`,
    lines,
    tone: run.plan.outcome === "blocked" || m.completed === 0 ? "warn" : "done",
  };
}

function assumptionLine(project: Project): string {
  const process = project.process!;
  if (process.example_note) return "Every time, capacity and staffing here is an example assumption for this synthetic hall, not data.";
  const c = valueCounts(process);
  return `Under ${c.entered} value${c.entered === 1 ? "" : "s"} you entered and ${c.examples} illustrative assumption${c.examples === 1 ? "" : "s"} you accepted.`;
}

type Awaiting = { kind: "run" | "world" | "file"; since: number; name?: string; entryId?: number };

interface PlanState {
  id: number;
  entryId: number;
  message: string;
  via: Entry["via"];
  loadId: number;
  /** The scene revision the plan was prepared on; a different one at Apply means it is stale. */
  baseRevision: number;
  steps: PlanStep[];
  statuses: RowStatus[];
  notes: (string | null)[];
  unsupported: string[];
  /** Questions about parts of the message that were not understood: nothing applies until the
   * person answers (the request is then interpreted again with the answer). */
  clarify: string[];
  checks: string[];
  phase: PlanView["phase"];
  timing: NonNullable<Entry["timing"]>;
  cancelled: boolean;
  /** Changes this plan applied (each one entry in the undo history). */
  applied: number;
  before: DayRun | null;
  undoneTo: { label: string } | null;
  revisionAfter?: number;
}

/** Between a plan's steps: long enough to see each one happen and to press Cancel. */
const STEP_PAUSE_MS = 120;

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/** Where a request's time went, in words, for its card's Details (UX-05). */
function timingLines(t: NonNullable<Entry["timing"]>, via: Entry["via"]): string[] {
  const lines: string[] = [];
  if (t.interpretMs !== undefined) {
    const provider = t.providerMs !== undefined ? `; ${via === "recorded" ? "a recorded answer, no provider wait" : `the AI took ${seconds(t.providerMs)}`}` : "";
    lines.push(`Interpreted in ${seconds(t.interpretMs)}${provider}.`);
  }
  if (t.prepareMs !== undefined) lines.push(`Proposal prepared in the browser in ${t.prepareMs} ms.`);
  if (t.executeMs !== undefined) lines.push(`Performed in ${t.executeMs} ms after Apply (pauses between steps not counted).`);
  return lines;
}

/** The conversation's state and its actions. A plain object (not hooks), so actions can call
 * one another; the component reads it through useSyncExternalStore and refreshes `host` after
 * every render, so an action always sees the world as it is when it runs. */
export class ChatController {
  /** Set after the first render (and every render after it), before anything can be clicked. */
  host!: ChatHost;
  entries: Entry[] = [];
  busy = false;
  /** Plans being executed: no new request starts until they end (a request sent mid-plan would
   * act on a half-changed world). */
  private executing = 0;
  private nextId = 1;
  private pending: { controller: AbortController; entryId: number } | null = null;
  /** What the conversation is waiting for: a run from the guided setup, a world from an import. */
  private awaiting: Awaiting | null = null;
  private listeners = new Set<() => void>();

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };
  getEntries = () => this.entries;
  getBusy = () => this.busy || this.executing > 0;
  private emit() {
    for (const listener of this.listeners) listener();
  }
  private setEntries(change: (list: Entry[]) => Entry[]) {
    this.entries = change(this.entries);
    this.emit();
  }
  private setBusy(busy: boolean) {
    this.busy = busy;
    this.emit();
  }


  push = (entry: Omit<Entry, "id">): number => {
    const id = this.nextId++;
    this.setEntries((list) => [...list, { ...entry, id }]);
    return id;
  };
  update = (id: number, patch: Partial<Entry>) => this.setEntries((list) => list.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  remove = (id: number) => this.setEntries((list) => list.filter((e) => e.id !== id));
  say = (kind: string, text: string, extra: Partial<Entry> = {}) => this.push({ role: "assistant", kind, text, tone: "info", ...extra });

  // ── Actions (each checks its own prerequisites against the live state) ─────────────────

  needWorld = (): boolean => {
    const h = this.host;
    if (h.facts.hasWorld) return true;
    this.say("cannot", "There's no world open yet.", {
      tone: "warn",
      buttons: [
        { label: SUGGESTION_TEXT.example, testId: "chat-do-example", run: () => this.doExample() },
        { label: "Attach a plan", testId: "chat-do-upload", run: () => this.host.pickFile() },
      ],
    });
    return false;
  };

  doExample = () => {
    const h = this.host;
    if (h.isSample) {
      this.say("done", "The example factory is open: a made-up hall drawn as a DXF, with an example shift. Every operating value in it is an assumption.", { tone: "done" });
      return;
    }
    h.loadSample();
    const entryId = this.say("progress", "Opening the example factory…", { tone: "progress" });
    this.awaiting = { kind: "world", since: h.loadId, name: "the example factory", entryId };
  };

  doCapabilities = () => {
    this.say("capabilities", "Here's what works right now:", { lines: capabilityLines(this.host.facts) });
  };

  // ── Plans (UX-04) ──────────────────────────────────────────────────────────────────────

  private plans = new Map<number, PlanState>();
  private nextPlan = 1;
  /** The object the conversation last acted on, for "it" and "that machine". */
  focus: string | null = null;

  /** A plan from checked steps: shown, completed where it asks, applied once. */
  startPlan = (steps: ChatStep[], message: string, via: Entry["via"], checks: string[] = [], timing: NonNullable<Entry["timing"]> = {}) => {
    const h = this.host;
    const project = h.project;
    if (!project) return void this.needWorld();
    const planned = steps.map(planStep);
    const clarify = planned.filter((s) => s.step.needs?.kind === "clarify").map((s) => s.step.needs!.question);
    const unsupported = planned.filter((s) => s.step.action === null && s.step.unsupported).map((s) => s.step.unsupported!);
    const supported = planned.filter((s) => s.step.action !== null);
    const id = this.nextPlan++;
    const changes = supported.some((s) => MUTATING.has(s.step.action!));
    // Only read-only steps, nothing to resolve: performed at once (nothing in the world changes).
    if (!changes && !unsupported.length && !clarify.length && supported.every((s) => stepNeeds(s) === null)) {
      if (supported.length === 1) return this.runReadOnly(supported[0]!, via, project);
      const entryId = this.push({ role: "assistant", kind: "plan", tone: "progress", via, text: `${supported.length} steps:`, buttons: [] });
      const plan: PlanState = { id, entryId, message, via, loadId: h.loadId, baseRevision: project.scene.revision, steps: supported, statuses: supported.map(() => "ready"), notes: supported.map(() => null), unsupported, clarify, checks, phase: "review", cancelled: false, applied: 0, before: null, undoneTo: null, timing };
      this.plans.set(id, plan);
      void this.execute(plan);
      return;
    }
    const entryId = this.push({ role: "assistant", kind: "proposal", tone: "question", via, text: "", buttons: [] });
    const plan: PlanState = { id, entryId, message, via, loadId: h.loadId, baseRevision: project.scene.revision, steps: supported, statuses: supported.map(() => "ready"), notes: supported.map(() => null), unsupported, clarify, checks, phase: "review", cancelled: false, applied: 0, before: null, undoneTo: null, timing };
    this.plans.set(id, plan);
    for (const s of supported) if (s.step.action === "add_object") void this.suggestFor(plan, s);
    this.renderPlan(plan);
  };

  private async suggestFor(plan: PlanState, s: PlanStep) {
    const library = await this.host.library().catch(() => [] as CatalogAsset[]);
    const [best] = suggestAssets(s.step.add!.description, library);
    s.add = { ...(s.add as AddChoice), asset: best ?? null };
    this.renderPlan(plan);
  }

  /** The plan card: its rows, what each still needs, the dry run's ghosts and consequences. */
  private renderPlan = (plan: PlanState) => {
    const h = this.host;
    const project = h.project;
    if (!project) return;
    const undoLabel = plan.undoneTo ? plan.undoneTo.label : h.undoLabel;
    const rows: PlanRow[] = plan.steps.map((s, index) => ({ index, label: stepLabel(project, s, undoLabel), status: plan.statuses[index]!, note: plan.notes[index]!, need: plan.phase === "review" ? this.needOf(project, s) : null }));
    for (const [i, row] of rows.entries()) if (plan.phase === "review" && row.need) rows[i] = { ...row, status: "needs" };
    for (const why of plan.unsupported) rows.push({ index: -1, label: why, status: "unsupported", note: "not done", need: null });
    for (const question of plan.clarify) rows.push({ index: -1, label: "Not understood yet", status: plan.phase === "review" ? "needs" : "skipped", note: null, need: plan.phase === "review" ? { kind: "clarify", question } : null });
    const ready = rows.every((r) => r.status !== "needs");
    const mutating = plan.steps.some((s) => MUTATING.has(s.step.action!));
    let lines: string[] = [];
    let details: string[] = [...plan.checks];
    let canApply = false;
    if (plan.phase === "review") {
      const preparing = performance.now();
      const undone = plan.steps.some((s) => s.step.action === "undo") ? h.previewUndo() : null;
      const dry = ready ? dryRun(project, plan.steps, undone) : null;
      if (ready && plan.timing.prepareMs === undefined) plan.timing.prepareMs = Math.round(performance.now() - preparing);
      if (dry && !dry.ok) {
        rows[dry.index] = { ...rows[dry.index]!, status: "failed", note: dry.message };
        lines = [`Can't do: ${dry.message}`];
      } else if (dry?.ok) {
        canApply = true;
        const impact = editImpact(project, dry.after, h.routeAsk);
        lines = impact.length ? impact.slice(0, 3) : mutating ? ["No overlap, keep-clear zone or route the checks look at changes."] : [];
        details = [...impact.slice(3), ...details];
        h.setPreview({ ghosts: dry.ghosts, candidates: [], route: null });
      }
      if (plan.unsupported.length) lines.push(`Only the steps above can be done; the rest is not supported and will not be attempted.`);
      if (plan.clarify.length) lines.push("Nothing is applied until the part not understood is answered.");
      if (mutating) details.push("Directions are as seen from above (the Top view), whatever the camera shows. Nothing changes until you press Apply.");
    }
    const single = plan.steps.length === 1 && !plan.unsupported.length && !plan.clarify.length && mutating;
    const title = (() => {
      if (plan.phase === "review") return single ? `${rows[0]!.label}?` : `Plan: ${plan.steps.length} step${plan.steps.length === 1 ? "" : "s"}${ready ? "" : " (one needs your answer)"}`;
      if (plan.phase === "running") return "Working…";
      const done = plan.statuses.filter((x) => x === "done").length;
      if (plan.phase === "done") return single ? `${rows[0]!.label.replace(/^Move/, "Moved").replace(/^Turn/, "Turned").replace(/^Add/, "Added").replace(/^Undo:/, "Undone:")}.` : `Done: ${done} of ${plan.steps.length} steps.`;
      if (plan.phase === "cancelled") return plan.applied ? `Stopped. ${plan.applied} change${plan.applied === 1 ? " was" : "s were"} applied before Cancel (you can undo ${plan.applied === 1 ? "it" : "them"}).` : "Cancelled: nothing changed.";
      if (plan.phase === "stale") return "The world changed since this plan was made, so nothing was applied.";
      return plan.applied ? `Stopped at a failed step. ${plan.applied} change${plan.applied === 1 ? " was" : "s were"} applied before it.` : "Stopped at a failed step; nothing changed.";
    })();
    const buttons: CardButton[] = [];
    if (plan.phase === "review") {
      if (canApply) buttons.push({ label: mutating ? (plan.unsupported.length ? "Apply the supported steps" : "Apply") : "Do it", testId: "chat-apply", primary: true, run: () => void this.apply(plan.id) });
      buttons.push({ label: "Cancel", testId: "chat-cancel", run: () => this.cancelPlan(plan.id) });
    } else if (plan.phase === "running") {
      buttons.push({ label: "Cancel", testId: "chat-cancel-plan", run: () => this.cancelPlan(plan.id) });
    } else if (plan.phase === "stale") {
      buttons.push({ label: "Prepare it again", testId: "chat-replan", run: () => this.startPlan(plan.steps.map((x) => this.reStep(x)), plan.message, plan.via, plan.checks) });
    } else if (plan.applied > 0 && !plan.steps.some((x) => x.step.action === "undo")) {
      buttons.push({ label: plan.applied === 1 ? "Undo" : "Undo this request", testId: "chat-undo-request", run: () => this.undoPlan(plan.id) });
    } else if (plan.applied > 0) {
      lines = ["Redo (top bar) brings back what was undone."];
    }
    if (plan.phase === "cancelled" && plan.applied === 0) lines = ["Cancelled: nothing changed."];
    this.update(plan.entryId, {
      kind: plan.phase === "review" ? "proposal" : plan.phase === "done" ? (single ? "applied" : "plan-done") : plan.phase === "running" ? "plan" : `plan-${plan.phase}`,
      tone: plan.phase === "review" ? "question" : plan.phase === "done" ? "done" : plan.phase === "running" ? "progress" : plan.phase === "cancelled" && plan.applied === 0 ? "info" : "warn",
      text: title,
      lines,
      details: plan.phase === "review" ? [...details, ...timingLines(plan.timing, plan.via)] : timingLines(plan.timing, plan.via),
      buttons,
      timing: { ...plan.timing },
      closed: false,
      // One change says itself in the title: its row is shown only while it asks or fails.
      plan: { id: plan.id, phase: plan.phase, rows: single && (plan.phase !== "review" || (!rows[0]!.need && rows[0]!.status !== "failed")) ? [] : rows, canApply },
    });
  };

  /** A step as the model planned it, with the person's choices kept (for "Prepare it again"). */
  private reStep(s: PlanStep): ChatStep {
    return { ...s.step, target_id: s.target, move: s.move, rotate: s.rotate, needs: null, add: s.step.add ? { ...s.step.add, near_object_id: s.add?.near ?? null, side: s.add?.side ?? null } : null };
  }

  private needOf(project: Project, s: PlanStep): PlanRow["need"] {
    const need = stepNeeds(s);
    const label = (id: string) => ({ id, label: nameOf(project, id) });
    if (need === "target") {
      const asked = s.step.needs;
      const candidates = asked?.kind === "target" ? asked.candidates : [];
      return { kind: "target", question: asked?.question ?? "Which object do you mean?", candidates: (candidates.length ? candidates : project.scene.objects.filter((o) => o.kind === "equipment").map((o) => o.id)).map(label) };
    }
    if (need === "move") return { kind: "move", question: s.step.needs?.question ?? "How far, and which way?", objectId: s.target };
    if (need === "rotate") return { kind: "rotate", question: s.step.needs?.question ?? "By how many degrees, and which way?" };
    if (need === "asset") {
      const suggestion = s.add?.asset ?? null;
      return { kind: "asset", question: suggestion ? `The closest catalog item is “${suggestion.name}”, a plain stand-in. Use it at the size you gave?` : `No catalog item here matches “${s.step.add!.description}”.`, suggestion: suggestion ? { id: suggestion.id, label: suggestion.name } : null, description: s.step.add!.description };
    }
    if (need === "near") return { kind: "near", question: "Beside which object?", candidates: project.scene.objects.filter((o) => o.kind === "equipment" || o.kind === "structure").map((o) => o.id).map(label) };
    if (need === "side") return { kind: "side", question: `Which side of ${nameOf(project, s.add!.near!)}? (as seen from above)`, near: s.add!.near! };
    return null;
  }

  private planOf(id: number): PlanState | null {
    const plan = this.plans.get(id);
    return plan && plan.phase === "review" ? plan : null;
  }

  planTarget = (id: number, index: number, objectId: string) => {
    const plan = this.planOf(id);
    if (!plan) return;
    plan.steps[index]!.target = objectId;
    // "It" in a later step means the object just chosen.
    for (const s of plan.steps.slice(index + 1)) if (!s.target && s.step.needs?.kind === "reference") s.target = objectId;
    this.focus = objectId;
    this.renderPlan(plan);
  };
  planMove = (id: number, index: number, direction: "left" | "right" | "forward" | "back", metres: number) => {
    const plan = this.planOf(id);
    if (!plan) return;
    plan.steps[index]!.move = { direction, distance: metres, unit: "m", quote: `${metres} m ${direction}` };
    this.renderPlan(plan);
  };
  planRotate = (id: number, index: number, direction: "clockwise" | "counterclockwise", degrees: number) => {
    const plan = this.planOf(id);
    if (!plan) return;
    plan.steps[index]!.rotate = { direction, angle_deg: degrees, quote: `${degrees}° ${direction}` };
    this.renderPlan(plan);
  };
  planAsset = (id: number, index: number, choice: "use" | "describe" | "builder") => {
    const plan = this.planOf(id);
    if (!plan) return;
    const s = plan.steps[index]!;
    if (choice === "use" && s.add?.asset) {
      s.add = { ...s.add, accepted: true };
      return this.renderPlan(plan);
    }
    // The existing workflows, with the person's words and sizes kept; this plan is closed.
    const a = s.step.add!;
    const sizes = [a.width_m && `${a.width_m} m wide`, a.depth_m && `${a.depth_m} m deep`, a.height_m && `${a.height_m} m high`].filter(Boolean).join(", ");
    this.cancelPlan(id, choice === "describe" ? "Opened Describe an object with your words." : "Opened the object builder.");
    this.host.openCreate(choice === "use" ? "describe" : choice, `${a.description}${sizes ? `, ${sizes}` : ""}`);
  };
  planNear = (id: number, index: number, objectId: string) => {
    const plan = this.planOf(id);
    if (!plan?.steps[index]?.add) return;
    plan.steps[index]!.add = { ...plan.steps[index]!.add!, near: objectId };
    this.renderPlan(plan);
  };
  planSide = (id: number, index: number, side: Side) => {
    const plan = this.planOf(id);
    if (!plan?.steps[index]?.add) return;
    plan.steps[index]!.add = { ...plan.steps[index]!.add!, side };
    this.renderPlan(plan);
  };

  // ---------- An attached 3D model for one object (ENR-01) ----------

  private models = new Map<number, ModelState>();
  private nextModel = 1;

  /** A .glb for an existing object: which object (the selection is offered first), then its
   * review. The file is read and stored by the local API only; nothing goes to the AI. */
  attachModel = async (file: File, objectId?: string) => {
    const h = this.host;
    const project = h.project;
    if (!project || !project.scene.objects.length) {
      this.say("cannot", "A 3D model improves an object already in a world. Open the example or attach a plan first; then choose the object it is for.", { tone: "warn" });
      return;
    }
    if (file.name.toLowerCase().endsWith(".gltf")) {
      this.say("cannot", `${file.name} is a text glTF that keeps its data in other files, which are never fetched. Export the model as a single binary .glb (glTF 2.0) with everything embedded.`, { tone: "error" });
      return;
    }
    const equipment = project.scene.objects.filter((o) => o.kind === "equipment");
    const target = objectId ?? null;
    if (target) return this.reviewModel(file, target);
    const selected = h.selectedId && equipment.some((o) => o.id === h.selectedId) ? h.selectedId : null;
    const others = equipment.filter((o) => o.id !== selected);
    let asked = 0;
    const choose = (id: string) => {
      this.update(asked, { closed: true, choices: [], lines: [`For ${nameOf(project, id)}.`] });
      void this.reviewModel(file, id);
    };
    const choices: CardChoice[] = [
      ...(selected ? [{ label: `Use for ${nameOf(project, selected)}`, testId: `model-for-${selected}`, objectId: selected, run: () => choose(selected) }] : []),
      ...others.map((o) => ({ label: nameOf(project, o.id), testId: `model-for-${o.id}`, objectId: o.id, run: () => choose(o.id) })),
    ];
    asked = this.say("question", selected ? `Is ${file.name} a better model of ${nameOf(project, selected)}? Or choose the object it belongs to.` : `Which object is ${file.name} a better model of? It improves that object; it never adds a new one or replaces the world.`, { tone: "question", choices });
  };

  private reviewModel = async (file: File, objectId: string) => {
    const h = this.host;
    const project = h.project;
    const object = project?.scene.objects.find((o) => o.id === objectId);
    if (!project || !object) return;
    h.setPreview({ ghosts: [], candidates: [objectId], route: null });
    const controller = new AbortController();
    const entryId = this.push({ role: "assistant", kind: "progress", tone: "progress", text: `Reading ${file.name} on this computer… (it is not sent to the AI)`, buttons: [] });
    this.update(entryId, { buttons: [{ label: "Cancel", testId: "model-cancel-upload", run: () => (controller.abort(), this.update(entryId, { kind: "cancelled", text: "Cancelled: nothing was changed.", tone: "info", closed: true, buttons: [] })) }] });
    const result = await h.client.uploadModel(file, file.name, controller.signal).catch(() => null);
    if (!result || controller.signal.aborted) return;
    if (!result.ok) {
      this.update(entryId, { kind: "model-rejected", tone: "error", closed: true, buttons: [], text: `${file.name} can't be used: ${result.error.message}`, lines: ["Nothing was changed: the object keeps its current look."] });
      h.setPreview(null);
      return;
    }
    const now = this.host.project;
    if (!now) return;
    const id = this.nextModel++;
    const state: ModelState = { id, entryId, loadId: this.host.loadId, baseRevision: now.scene.revision, objectId, expected: object.asset_id, report: result.value, up: "+Y", turns: 0, unit: "m", fit: "contain", showing: "proposed", asset: null, busy: true, problem: null, phase: "review", revisionAfter: null, ask: 0 };
    this.models.set(id, state);
    this.renderModel(state);
    await this.proposeModel(state);
  };

  private async proposeModel(state: ModelState) {
    const ask = ++state.ask;
    state.busy = true;
    this.renderModel(state);
    const r = state.report;
    const name = r.filename.replace(/\.glb$/i, "") || "Attached model";
    const kind = this.host.project?.scene.objects.find((o) => o.id === state.objectId)?.kind;
    const assetKind = kind === "structure" || kind === "reference" ? kind : "equipment";
    const result = await this.host.client.uploadedAsset({ sha256: r.sha256, filename: r.filename, name, kind: assetKind, up_axis: state.up, turns: state.turns, unit: state.unit, fit: state.fit, note: null }).catch(() => null);
    if (ask !== state.ask || state.phase !== "review") return; // a newer choice, or no longer open
    state.busy = false;
    if (!result || !result.ok) {
      state.asset = null;
      state.problem = result && !result.ok ? result.error.message : "The local API did not answer.";
    } else {
      state.asset = result.value;
      state.problem = null;
    }
    this.showModel(state);
    this.renderModel(state);
    // The first proposal is brought into view, close enough to judge its facing and fit.
    if (ask === 1) this.host.focusObject(state.objectId);
  }

  private showModel(state: ModelState) {
    const h = this.host;
    h.setLookPreview(state.phase === "review" && state.showing === "proposed" && state.asset ? { objectId: state.objectId, asset: state.asset } : null);
  }

  private renderModel(state: ModelState) {
    const project = this.host.project;
    const object = project?.scene.objects.find((o) => o.id === state.objectId);
    if (!project || !object) return;
    const d = object.dimensions;
    const recorded: Triple = [d.width.value_m, d.height.value_m, d.depth.value_m];
    const visual = state.asset?.visual.type === "gltf" ? state.asset.visual : null;
    const model = visual ? modelExtents(visual) : null;
    const drawn = visual && model ? (fitScale(visual, d).map((f, i) => f * model[i]!) as Triple) : null;
    const warnings: string[] = [];
    const axes = ["width", "height", "depth"] as const;
    if (visual && model) {
      const fill = envelopeFill(visual, d);
      if (state.fit === "contain") {
        const low = fill.map((f, i) => [axes[i]!, f] as const).filter(([, f]) => f < 0.5);
        if (low.length) warnings.push(`The model fills only ${low.map(([a, f]) => `${Math.round(f * 100)} % of the recorded ${a}`).join(" and ")}: check it is the right model and the right way up.`);
      } else {
        const stretch = fitScale(visual, d).map((f, i) => [axes[i]!, f] as const).filter(([, f]) => Math.abs(f - 1) > 0.25);
        if (stretch.length) warnings.push(`Stretched to fill: ${stretch.map(([a, f]) => `${a} ×${f.toFixed(2)}`).join(", ")}. The model is distorted.`);
      }
    }
    if (state.unit === "m" && state.report.scale_hint) warnings.push(state.report.scale_hint);
    warnings.push(...state.report.notes.filter((n) => /animation|skin|morph/i.test(n)));
    if (state.problem) warnings.unshift(state.problem);
    const r = state.report;
    const details = [
      `File: ${r.filename}, ${(r.bytes / 1024).toFixed(0)} KB, sha256 ${r.sha256.slice(0, 12)}…, kept unchanged on this computer (${r.uri}).`,
      `${r.triangles.toLocaleString()} triangles, ${r.vertices.toLocaleString()} vertices, ${r.nodes} node${r.nodes === 1 ? "" : "s"}, ${r.meshes} mesh${r.meshes === 1 ? "" : "es"}, ${r.materials} material${r.materials === 1 ? "" : "s"}, ${r.textures} texture${r.textures === 1 ? "" : "s"} (${r.texture_pixels.toLocaleString()} pixels).`,
      `Bounds as written (file units, through every node transform): ${["x", "y", "z"].map((a) => `${a} ${r.file_bounds.min[a as "x"].toFixed(3)} to ${r.file_bounds.max[a as "x"].toFixed(3)}`).join(", ")}.`,
      ...(r.extensions_used.length ? [`Extensions: ${r.extensions_used.join(", ")}.`] : []),
      ...r.notes,
      "The model's sizes are its geometry, not a measurement of the machine. The object keeps its recorded dimensions and their evidence; adopting sizes from a supplier's document is a separate, reviewed step.",
      "No licence is assumed: the file's origin and terms are recorded as not stated.",
    ];
    const view: ModelView = {
      id: state.id,
      phase: state.phase,
      objectId: state.objectId,
      label: nameOf(project, state.objectId),
      filename: r.filename,
      up: state.up,
      turns: state.turns,
      unit: state.unit,
      fit: state.fit,
      showing: state.showing,
      busy: state.busy,
      model,
      recorded,
      recordedNote: axes.map((a) => ORIGIN_WORDS[d[a].origin] ?? d[a].origin).join(" / "),
      drawn,
      warnings,
      details,
      scaleHint: r.scale_hint,
    };
    const title = {
      review: `A new look for ${view.label}?`,
      applied: `${view.label} now uses ${r.filename}.`,
      cancelled: "Cancelled: the object keeps its current look.",
      stale: "The world changed since this review, so nothing was changed.",
      undone: `Undone: ${view.label} looks as it did before.`,
    }[state.phase];
    const buttons: CardButton[] = [];
    if (state.phase === "review") {
      buttons.push({ label: "Apply", testId: "model-apply", primary: true, run: () => this.modelApply(state.id) });
      buttons.push({ label: "Cancel", testId: "model-cancel", run: () => this.modelCancel(state.id) });
    } else if (state.phase === "applied") {
      buttons.push({ label: "Undo", testId: "model-undo", run: () => this.modelUndo(state.id) });
    }
    this.update(state.entryId, {
      kind: state.phase === "review" ? "model-review" : `model-${state.phase}`,
      tone: state.phase === "review" ? "question" : state.phase === "applied" ? "done" : state.phase === "stale" ? "warn" : "info",
      text: title,
      lines: state.phase === "applied" ? ["Only its look changed: id, name, position, turn, recorded dimensions and their evidence, drawing and process links, routes and the run are as they were."] : [],
      details: [],
      buttons,
      closed: state.phase !== "review" && state.phase !== "applied",
      model: view,
    });
  }

  private modelOf(id: number): ModelState | null {
    const state = this.models.get(id);
    return state && state.phase === "review" ? state : null;
  }

  /** Change one choice and propose again: which way is up, the quarter turn, the unit, the fit. */
  modelChoose = (id: number, choice: { up?: UpAxis; turn?: 1 | -1; unit?: ModelUnit; fit?: ModelView["fit"] }) => {
    const state = this.modelOf(id);
    if (!state) return;
    if (choice.up) state.up = choice.up;
    if (choice.turn) state.turns = (state.turns + choice.turn + 4) % 4;
    if (choice.unit) state.unit = choice.unit;
    if (choice.fit) state.fit = choice.fit;
    state.showing = "proposed";
    void this.proposeModel(state);
  };

  /** Show the object as it is now, or with the proposed model (display only). */
  modelShow = (id: number, showing: ModelView["showing"]) => {
    const state = this.modelOf(id);
    if (!state) return;
    state.showing = showing;
    this.showModel(state);
    this.renderModel(state);
  };

  modelApply = (id: number) => {
    const state = this.modelOf(id);
    if (!state || !state.asset || state.busy) return;
    const h = this.host;
    state.phase = "applied"; // before executing: a second click finds nothing to apply
    h.setLookPreview(null);
    h.setPreview(null);
    const outcome = h.loadId === state.loadId ? h.execute({ baseRevision: state.baseRevision, command: { type: "set_appearance", changes: [{ objectId: state.objectId, assetId: state.asset.id, expected: state.expected, reason: `attached file ${state.report.filename}, reviewed; ${state.fit === "contain" ? "kept in proportion" : "stretched to fill"}` }], assets: [state.asset] } }) : null;
    if (!outcome?.ok) {
      state.phase = "stale";
      this.renderModel(state);
      if (outcome && outcome.rejection.kind !== "conflict") this.update(state.entryId, { lines: [outcome.rejection.message] });
      return;
    }
    state.revisionAfter = outcome.state.project.scene.revision;
    this.renderModel(state);
  };

  modelCancel = (id: number) => {
    const state = this.modelOf(id);
    if (!state) return;
    state.phase = "cancelled";
    this.host.setLookPreview(null);
    this.host.setPreview(null);
    this.renderModel(state);
  };

  modelUndo = (id: number) => {
    const state = this.models.get(id);
    if (!state || state.phase !== "applied") return;
    if (state.revisionAfter !== this.host.project?.scene.revision) {
      this.update(state.entryId, { lines: ["Later changes came after this one: use Undo in the top bar to step back in order."] });
      return;
    }
    if (!this.host.undo()?.ok) return;
    state.phase = "undone";
    this.renderModel(state);
  };

  // ---------- Equipment appearance (UX-05) ----------

  private looks = new Map<number, LookState>();
  private nextLook = 1;

  /** Review models for imported equipment, all of it or only `only`. Deterministic: no AI. */
  startLook = async (only?: string[]) => {
    const h = this.host;
    const project = h.project;
    if (!project) return void this.needWorld();
    const objects = equipmentToImprove(project).filter((o) => !only || only.includes(o.id));
    const picked = only ? project.scene.objects.filter((o) => only.includes(o.id) && canChangeLook(o)) : objects;
    if (!picked.length) {
      this.say("done", h.facts.hasDrawing ? "All the imported equipment already has a model, or there is none." : "Matching models is for equipment of an imported plan; open or attach one first.", { tone: "info" });
      return;
    }
    const library = await h.library().catch(() => [] as CatalogAsset[]);
    const now = this.host.project;
    if (!now || now !== project) return; // the world changed while the catalog loaded
    const matches = matchEquipment(now, picked, library);
    const id = this.nextLook++;
    const entryId = this.push({ role: "assistant", kind: "appearance", tone: "question", text: "", buttons: [] });
    const look: LookState = {
      id,
      entryId,
      loadId: h.loadId,
      baseRevision: now.scene.revision,
      library,
      rows: matches.map((match) => ({ match, chosen: null, kept: false, browsing: only !== undefined && match.kind !== "suggested", made: null, note: null })),
      phase: "review",
      revisionAfter: null,
      applied: 0,
    };
    this.looks.set(id, look);
    this.renderLook(look);
  };

  private renderLook(look: LookState) {
    const rows: LookRow[] = look.rows.map((r) => {
      const m = r.match;
      const options = (m.kind === "suggested" ? [m.best, ...m.others] : m.options).map(lookOption);
      const status: LookRow["status"] = r.made ? "made" : r.chosen ? "chosen" : r.kept ? "kept" : m.kind;
      return {
        objectId: m.object.id,
        label: m.label,
        status,
        question: m.kind === "ask" ? m.question : m.kind === "none" ? "No catalog model is this kind of equipment." : null,
        suggestion: m.kind === "suggested" ? lookOption(m.best) : null,
        chosen: r.chosen,
        options,
        browsing: r.browsing,
        note: r.note,
      };
    });
    const chosen = look.rows.filter((r) => r.chosen);
    const count = (k: Match["kind"]) => look.rows.filter((r) => r.match.kind === k && !r.chosen && !r.kept && !r.made).length;
    const parts = [count("suggested") && `${count("suggested")} suggested`, count("ask") && `${count("ask")} to choose or keep`, count("none") && `${count("none")} without a catalog model`].filter(Boolean);
    const title = {
      review: `Equipment appearance${parts.length ? `: ${parts.join(", ")}` : ""}`,
      applied: `Changed the look of ${look.applied} object${look.applied === 1 ? "" : "s"}.`,
      cancelled: "Kept every object as it was.",
      stale: "The world changed since these suggestions, so nothing was changed.",
      undone: "Undone: the objects look as they did before.",
    }[look.phase];
    const lines =
      look.phase === "review"
        ? [
            "Each model is a generic illustration fitted to the recorded size; it identifies no manufacturer or machine. Only how the object is drawn changes: its id, name, position, dimensions and their evidence, process and drawing links, and every check and run stay as they are.",
            ...(chosen.length ? [`Apply changes: ${chosen.map((r) => r.match.label).join(", ")}.`] : []),
          ]
        : look.phase === "applied"
          ? ["Display only: dimensions and their evidence, process and drawing links are unchanged, and runs read the same layout."]
          : [];
    const buttons: CardButton[] = [];
    if (look.phase === "review") {
      if (chosen.length) buttons.push({ label: `Apply ${chosen.length} change${chosen.length === 1 ? "" : "s"}`, testId: "look-apply", primary: true, run: () => this.lookApply(look.id) });
      buttons.push({ label: chosen.length ? "Cancel" : "Done", testId: "look-cancel", run: () => this.lookCancel(look.id) });
    } else if (look.phase === "applied") {
      buttons.push({ label: "Undo", testId: "look-undo", run: () => this.lookUndo(look.id) });
    } else if (look.phase === "stale") {
      buttons.push({ label: "Suggest again", testId: "look-again", run: () => void this.startLook() });
    }
    this.update(look.entryId, {
      kind: look.phase === "review" ? "appearance" : `appearance-${look.phase}`,
      tone: look.phase === "review" ? "question" : look.phase === "applied" ? "done" : look.phase === "stale" ? "warn" : "info",
      text: title,
      lines,
      buttons,
      closed: look.phase !== "review" && look.phase !== "applied",
      look: { id: look.id, phase: look.phase, rows: look.phase === "review" ? rows : rows.filter((r) => r.status === "chosen" || r.status === "made"), canApply: chosen.length > 0 },
    });
  }

  private lookOf(id: number): LookState | null {
    const look = this.looks.get(id);
    return look && look.phase === "review" ? look : null;
  }

  private rowOf(look: LookState, objectId: string) {
    return look.rows.find((r) => r.match.object.id === objectId) ?? null;
  }

  /** Use this model (for Apply): shown on the object in the world at once. */
  lookUse = (id: number, objectId: string, assetId: string) => {
    const look = this.lookOf(id);
    const row = look && this.rowOf(look, objectId);
    const asset = look?.library.find((a) => a.id === assetId);
    if (!look || !row || !asset || row.made) return;
    row.chosen = assetId;
    row.kept = false;
    row.browsing = false;
    this.host.setLookPreview({ objectId, asset });
    this.renderLook(look);
  };

  /** Upload a 3D model for this object instead (ENR-01): its own review follows. */
  lookUpload = (objectId: string) => this.host.pickModelFile(objectId);

  /** Improve this object's look from a photo of it (ENR-01): its own review window follows. */
  lookPhoto = (objectId: string) => this.host.openPhotoLook(objectId, null);

  /** A look from a photo was applied in its window: said here, with Undo, like every step. */
  notePhotoLook = (request: CommandRequest) => {
    const command = request.command;
    if (command.type !== "set_appearance") return;
    const project = this.host.project;
    const objectId = command.changes[0]?.objectId;
    if (!project || !objectId) return;
    // An open look card for this object is past: its choices were made for the old look.
    for (const look of this.looks.values()) {
      if (look.phase === "review" && look.rows.some((r) => r.match.object.id === objectId)) {
        look.phase = "stale";
        this.renderLook(look);
      }
    }
    const revision = project.scene.revision;
    let entryId = 0;
    entryId = this.say("done", `${nameOf(project, objectId)} now looks more like its photo.`, {
      tone: "done",
      kind: "photo-look-applied",
      lines: ["Only its look changed: its id, name, position, recorded size and evidence, process and source links, routes and the run are as they were. The photo is kept with the world as its reference."],
      buttons: [
        {
          label: "Undo",
          testId: "photo-look-undo",
          run: () => {
            if (this.host.project?.scene.revision !== revision) return this.update(entryId, { buttons: [], lines: ["Something changed since; use Undo at the top."] });
            if (this.host.undo()?.ok) this.update(entryId, { kind: "photo-look-undone", text: "Undone: it looks as it did before.", tone: "info", buttons: [], lines: [] });
          },
        },
      ],
    });
  };

  /** A picture attached while a world is open: a reference for one of its objects, or (as
   * before) a new world from the picture. Nothing is read or sent until the person chooses. */
  private offerReference(file: File) {
    const h = this.host;
    const project = h.project!;
    const objects = project.scene.objects.filter(canChangeLook);
    const selected = h.selectedId && objects.some((o) => o.id === h.selectedId) ? h.selectedId : null;
    let asked = 0;
    const close = (line: string) => this.update(asked, { closed: true, choices: [], lines: [line] });
    const forObject = (id: string) => {
      close(`A reference for ${nameOf(project, id)}.`);
      h.openPhotoLook(id, file);
    };
    const choices: CardChoice[] = [
      ...(selected ? [{ label: `Use as a reference for ${nameOf(project, selected)}`, testId: `photo-for-${selected}`, objectId: selected, run: () => forObject(selected) }] : []),
      ...objects.filter((o) => o.id !== selected).map((o) => ({ label: nameOf(project, o.id), testId: `photo-for-${o.id}`, objectId: o.id, run: () => forObject(o.id) })),
      {
        label: "Create a world from this picture instead",
        testId: "photo-new-world",
        objectId: null,
        run: () => {
          close("A new world from the picture.");
          if (/\.(png|jpe?g)$/i.test(file.name)) {
            this.awaiting = { kind: "world", since: h.loadId, name: file.name };
            h.pictureImport(file);
            this.say("question", "A picture or PDF page has no scale. In the window that opened, mark one length you know; then I'll show the draft here.", { tone: "question" });
          } else this.say("cannot", "A plan picture must be PNG or JPEG.", { tone: "error" });
        },
      },
    ];
    asked = this.say(
      "question",
      selected
        ? `Is ${file.name} a photo of ${nameOf(project, selected)}? It can make that object look more like it, or start a new world.`
        : `Which object is ${file.name} a photo of? It can make that object look more like it, or start a new world.`,
      { tone: "question", choices },
    );
  }

  lookKeep = (id: number, objectId: string) => {
    const look = this.lookOf(id);
    const row = look && this.rowOf(look, objectId);
    if (!look || !row || row.made) return;
    row.chosen = null;
    row.kept = true;
    row.browsing = false;
    this.host.setLookPreview(null);
    this.renderLook(look);
  };

  lookBrowse = (id: number, objectId: string) => {
    const look = this.lookOf(id);
    const row = look && this.rowOf(look, objectId);
    if (!look || !row) return;
    row.browsing = !row.browsing;
    row.kept = false;
    this.renderLook(look);
  };

  /** Hovering an option: the object drawn with it (display only) and highlighted. */
  lookHover = (id: number, objectId: string | null, assetId: string | null) => {
    const look = this.looks.get(id);
    const h = this.host;
    if (!look || look.phase !== "review" || !objectId) {
      h.setLookPreview(null);
      return;
    }
    const row = this.rowOf(look, objectId);
    const asset = look.library.find((a) => a.id === (assetId ?? row?.chosen));
    h.setPreview({ ghosts: [], candidates: [objectId], route: null });
    h.setLookPreview(asset ? { objectId, asset } : null);
  };

  lookApply = (id: number) => {
    const look = this.lookOf(id);
    if (!look) return; // applied at most once
    const h = this.host;
    const chosen = look.rows.filter((r) => r.chosen);
    if (!chosen.length) return;
    look.phase = "applied"; // before executing: a second click finds nothing to apply
    const assets = [...new Set(chosen.map((r) => r.chosen!))].map((a) => look.library.find((x) => x.id === a)!).filter(Boolean);
    const outcome = h.loadId === look.loadId ? h.execute({ baseRevision: look.baseRevision, command: { type: "set_appearance", changes: chosen.map((r) => ({ objectId: r.match.object.id, assetId: r.chosen, expected: r.match.object.asset_id, reason: reasonOf(r.match, r.chosen!) })), assets } }) : null;
    h.setLookPreview(null);
    h.setPreview(null);
    if (!outcome?.ok) {
      look.phase = "stale";
      this.renderLook(look);
      if (outcome && outcome.rejection.kind !== "conflict") this.update(look.entryId, { lines: [outcome.rejection.message] });
      return;
    }
    look.applied = chosen.length;
    look.revisionAfter = outcome.state.project.scene.revision;
    this.renderLook(look);
  };

  lookCancel = (id: number) => {
    const look = this.lookOf(id);
    if (!look) return;
    look.phase = "cancelled";
    for (const r of look.rows) r.chosen = null;
    this.host.setLookPreview(null);
    this.host.setPreview(null);
    this.renderLook(look);
  };

  lookUndo = (id: number) => {
    const look = this.looks.get(id);
    if (!look || look.phase !== "applied") return;
    if (look.revisionAfter !== this.host.project?.scene.revision) {
      // Something else changed after it: undo in order from the top bar instead.
      this.update(look.entryId, { lines: ["Later changes came after this one: use Undo in the top bar to step back in order."] });
      return;
    }
    const outcome = this.host.undo();
    if (!outcome?.ok) return;
    look.phase = "undone";
    this.renderLook(look);
  };

  /** No suitable model: describe it to the object generator, or build it by hand. The current
   * object stays as it is while that runs; a cancelled or failed generation changes nothing. */
  lookCreate = (id: number, objectId: string, kind: "describe" | "builder") => {
    const look = this.lookOf(id);
    const row = look && this.rowOf(look, objectId);
    const project = this.host.project;
    if (!look || !row || !project) return;
    const object = project.scene.objects.find((o) => o.id === objectId);
    if (!object) return;
    this.host.openLookCreate(objectId, kind, describeFor(project, object), (outcome) => {
      if (look.phase !== "review") return;
      if (outcome === null) row.note = "Closed without a new model: it looks as before.";
      else if (!outcome.ok) row.note = `Not changed: ${outcome.message}`;
      else {
        row.made = outcome.assetName;
        row.chosen = null;
        row.note = `Now drawn with “${outcome.assetName}” (its own undo step; size and evidence unchanged).`;
        // That step was this card's own: the other rows still apply to the world as it is now.
        look.baseRevision = this.host.project?.scene.revision ?? look.baseRevision;
      }
      this.renderLook(look);
    });
  };

  /** Answer the part of a plan that was not understood: this plan closes, and the request is
   * interpreted again with the answer (one new call; nothing was applied). */
  planClarify = (id: number, answer: string) => {
    const plan = this.planOf(id);
    const reply = answer.trim();
    if (!plan || !reply) return;
    this.cancelPlan(id, "Asked again with your answer.");
    void this.send(`${plan.message} (${reply})`);
  };

  cancelPlan = (id: number, note?: string) => {
    const plan = this.plans.get(id);
    if (!plan) return;
    if (plan.phase === "running") {
      plan.cancelled = true; // stops before the next step; nothing already applied is lost
      return;
    }
    if (plan.phase !== "review") return;
    plan.phase = "cancelled";
    plan.statuses = plan.statuses.map(() => "cancelled");
    this.host.setPreview(null);
    this.renderPlan(plan);
    if (note) this.update(plan.entryId, { lines: [note] });
  };

  /** Apply once: every step in order, tracking the revisions the plan's own edits make. */
  apply = async (id: number) => {
    const plan = this.plans.get(id);
    if (!plan || plan.phase !== "review") return; // a plan is applied at most once
    const h = this.host;
    if (h.loadId !== plan.loadId || h.project?.scene.revision !== plan.baseRevision) {
      plan.phase = "stale";
      h.setPreview(null);
      this.renderPlan(plan);
      return;
    }
    await this.execute(plan);
  };

  private execute = async (plan: PlanState) => {
    this.executing++;
    this.emit();
    try {
      await this.executeSteps(plan);
    } finally {
      this.executing--;
      this.emit();
    }
  };

  private executeSteps = async (plan: PlanState) => {
    const started = performance.now();
    try {
      await this.performSteps(plan);
    } finally {
      // The steps' own work, without the pauses between them that let Cancel in.
      plan.timing.executeMs = Math.max(0, Math.round(performance.now() - started - STEP_PAUSE_MS * plan.steps.length));
      this.renderPlan(plan);
    }
  };

  private performSteps = async (plan: PlanState) => {
    const h = this.host;
    let project = h.project!;
    const pre = project;
    plan.phase = "running";
    h.setPreview(null);
    this.renderPlan(plan);
    let lastRun: DayRun | null = h.day && !h.facts.runStale ? h.day : null;
    let stopped = false;
    for (let i = 0; i < plan.steps.length; i++) {
      await new Promise((resolve) => setTimeout(resolve, STEP_PAUSE_MS)); // show progress; let Cancel in
      if (plan.cancelled) {
        for (let j = i; j < plan.steps.length; j++) plan.statuses[j] = "cancelled";
        plan.phase = "cancelled";
        stopped = true;
        break;
      }
      const s = plan.steps[i]!;
      plan.statuses[i] = "running";
      this.renderPlan(plan);
      const action = s.step.action!;
      try {
        if (action === "undo") {
          const outcome = h.undo();
          if (!outcome?.ok) throw new Error(outcome && !outcome.ok ? outcome.rejection.message : "There is nothing to undo.");
          project = outcome.state.project;
          plan.applied++;
        } else if (MUTATING.has(action)) {
          const made = stepCommand(project, s);
          if (!made.ok) throw new Error(made.message);
          const request: CommandRequest = { baseRevision: project.scene.revision, command: made.command };
          const outcome = h.execute(request);
          if (!outcome || !outcome.ok) throw new Error(outcome && !outcome.ok ? outcome.rejection.message : "The scene is not editable right now.");
          project = outcome.state.project;
          plan.applied++;
          const target = action === "add_object" ? outcome.change.objectId : s.target;
          if (target) this.focus = target;
        } else if (action === "select") {
          h.select(s.target);
          this.focus = s.target;
        } else if (action === "check_route") {
          this.doRoute(s.step.route, plan.via, project);
        } else if (action === "check_layout") {
          this.doCheckLayout(project, plan.via);
        } else if (action === "run_day" || action === "run_again") {
          const before = lastRun;
          lastRun = this.doRun(action === "run_again" || before !== null, plan.via, project, before);
          if (!lastRun) throw new Error("The shift could not run (see above).");
        } else if (action === "explain_change") {
          if (plan.applied > 0) {
            // Before: the layout as it was before this request, run now with the same process
            // and seed (a valid baseline, never invented). After: this request's run.
            if (!pre.process) throw new Error("There is no shift set up to compare.");
            const before = runDay(pre, pre.process, "original");
            const after = lastRun ?? this.doRun(true, plan.via, project, null);
            if (!after) throw new Error("The shift could not run.");
            this.explainPair(before, after, pre, plan.via);
          } else this.doWhy(plan.via);
        } else if (action === "show_example") {
          this.doExample();
        } else if (action === "capabilities") this.doCapabilities();
        else if (action === "save") this.doSave();
        else if (action === "export") this.doExport();
        plan.statuses[i] = "done";
      } catch (error) {
        plan.statuses[i] = "failed";
        plan.notes[i] = error instanceof Error ? error.message : String(error);
        for (let j = i + 1; j < plan.steps.length; j++) {
          plan.statuses[j] = "skipped";
          plan.notes[j] = "not run: it depends on the failed step";
        }
        plan.phase = "failed";
        stopped = true;
        break;
      }
      this.renderPlan(plan);
    }
    if (!stopped) plan.phase = "done";
    plan.revisionAfter = project.scene.revision;
    this.renderPlan(plan);
  };

  /** Undo the request's own changes, newest first, while they are still the latest ones. */
  undoPlan = (id: number) => {
    const plan = this.plans.get(id);
    if (!plan || plan.applied === 0) return;
    const h = this.host;
    if (h.project?.scene.revision !== plan.revisionAfter) {
      this.say("cannot", "Other changes were made after this request; use Undo in the top bar to step back through them.", { tone: "warn" });
      return;
    }
    let undone = 0;
    for (let i = 0; i < plan.applied; i++) {
      const outcome = h.undo();
      if (!outcome?.ok) break;
      undone++;
    }
    plan.applied -= undone;
    this.update(plan.entryId, { buttons: [], lines: [`Undone: ${undone} change${undone === 1 ? "" : "s"} from this request.`] });
  };

  private runReadOnly = (s: PlanStep, via: Entry["via"], project: Project) => {
    switch (s.step.action) {
      case "select":
        return this.doSelect(s.target!, via);
      case "check_route":
        return this.doRoute(s.step.route, via, project);
      case "check_layout":
        return this.doCheckLayout(project, via);
      case "run_day":
        return void this.doRun(false, via);
      case "run_again":
        return void this.doRun(true, via);
      case "explain_change":
        return this.doWhy(via);
      case "show_example":
        return this.doExample();
      case "capabilities":
        return this.doCapabilities();
      case "save":
        return this.doSave();
      case "export":
        return this.doExport();
    }
  };

  /** Overlaps and keep-clear zones from the existing check, and the asked route if any. */
  doCheckLayout = (project: Project | null = this.host.project, via: Entry["via"] = null) => {
    const h = this.host;
    if (!project || !drawingSource(project)) {
      this.say("cannot", "The layout check needs a reviewed plan.", { tone: "warn", via });
      return;
    }
    const checks = runChecks(project, h.routeAsk);
    if (!checks) {
      this.say("cannot", "The layout can't be checked yet (it needs a floor).", { tone: "warn", via });
      return;
    }
    const findings = checks.now.layout.findings.filter((f) => f.state === "conflict");
    const unsure = checks.now.layout.findings.filter((f) => f.state !== "conflict");
    const route = checks.now.route;
    const sentence = findings.length ? `${findings.length} conflict${findings.length === 1 ? "" : "s"}: ${findings.slice(0, 2).map((f) => f.message.replace(/\.$/, "")).join("; ")}.` : unsure.length ? "No conflict found, but some outlines are not exact enough to be sure." : "No overlaps or keep-clear conflicts.";
    const lines = route ? [route.outcome === "fits" ? "The asked route fits." : `The asked route: ${brief(route.summary)}.`] : [];
    h.setPreview({ ghosts: [], candidates: [], route: sceneChecks(checks.now, h.routeAsk) });
    this.say("layout", sentence, { tone: findings.length ? "warn" : "done", via, lines, details: [...findings.slice(2).map((f) => f.message), ...unsure.map((f) => f.message), "2D checks of the reviewed design: width only; turning and heights are not checked."] });
  };

  /** The comparison of two runs with the same process, seed and engine. */
  private explainPair = (before: DayRun, after: DayRun, pre: Project, via: Entry["via"]) => {
    const compared = compareDays(before, after, pre.process!);
    const reword = (l: string) => l.replace(/in the original layout/g, "before this request").replace(/in the edited layout/g, "now");
    const { explanation, identical, rows } = compared;
    const output = explanation.find((l) => l.startsWith("Output")) ?? explanation.at(-1)!;
    const weight = (l: string) => (/ is blocked in the edited layout/.test(l) ? 0 : / is clear now/.test(l) ? 1 : 2);
    const causes = explanation.filter((l) => l !== output).sort((a, b) => weight(a) - weight(b));
    this.say("why", reword(identical ? explanation[0]! : output), {
      tone: identical ? "info" : "warn",
      via,
      lines: identical ? [] : causes.slice(0, 1).map((l) => `Because ${reword(l.replace(/ \((Blocked[^)]*)\)\. It is needed for .*$/, (_m: string, why: string) => `: ${brief(why)}.`))}`),
      details: [...causes.map(reword), ...rows.map((r) => `${r.label}: ${r.before} → ${r.after} (${r.change})`), "Before: the layout as it was before this request, run with the same process, seed and engine; only the layout differs."],
    });
  };

  doMoveForm = () => {
    const h = this.host;
    if (!this.needWorld()) return;
    const objectId = h.selectedId;
    this.push({
      role: "assistant",
      kind: "move-form",
      tone: "question",
      text: objectId ? `Move ${nameOf(h.project!, objectId)}: which way, and how far?` : "Which machine, which way, and how far?",
      form: { kind: "move", objectId },
    });
  };

  submitMove = (entryId: number, objectId: string, direction: "left" | "right" | "forward" | "back", metres: number) => {
    this.update(entryId, { closed: true });
    const step: ChatStep = { action: "move", target_id: objectId, move: { direction, distance: metres, unit: "m", quote: `${metres} m ${direction}` }, rotate: null, route: null, add: null, needs: null, unsupported: null };
    this.startPlan([step], `Move ${metres} m ${direction}`, null);
  };

  answerRoute = (ask: RouteAsk, project: Project | null = this.host.project) => {
    const h = this.host;
    const answer = project ? answerAsked(project, ask) : null;
    if (!answer) {
      this.say("cannot", "The route can't be checked on this layout (it needs a reviewed plan with a floor).", { tone: "warn" });
      return;
    }
    h.setRouteAsk(ask);
    h.setPreview({ ghosts: [], candidates: [], route: answer.highlight });
    this.say("route", answer.sentence, { tone: answer.outcome === "fits" ? "done" : "warn", details: answer.details, buttons: [{ label: "Show on the plan", testId: "chat-show-check", run: () => this.host.openSheet("check") }] });
  };

  doRoute = (route: ChatStep["route"] | null, via: Entry["via"] = null, override: Project | null = null) => {
    const h = this.host;
    if (!this.needWorld()) return;
    const project = override ?? h.project!;
    const source = drawingSource(project);
    if (!source) {
      this.say("cannot", "Routes are checked on a reviewed plan, and this world has none. Attach a plan, or open the example factory.", { tone: "warn", via });
      return;
    }
    if (h.facts.reviewOpen) {
      this.say("cannot", "First confirm what the drawing shows (the card below); then routes can be checked.", { tone: "warn", via });
      return;
    }
    // "Its routes": the shift's routes to and from that object, when it is a station.
    if (route?.from_object_id && !route.to_object_id && !route.width_m && project.process?.stations.some((st) => st.object_id === route.from_object_id)) {
      const answer = answerProcess(project, route.from_object_id);
      if (answer) {
        h.setPreview({ ghosts: [], candidates: [], route: answer.highlight });
        this.say("route", answer.sentence, { tone: answer.outcome === "fits" ? "done" : "warn", details: answer.details, via });
        return;
      }
    }
    const named = route && (route.from_object_id || route.to_object_id || route.width_m);
    if (!named && h.routeAsk?.start && h.routeAsk.end) return this.answerRoute(h.routeAsk, project);
    if (!named && project.process) {
      const answer = answerProcess(project);
      if (answer) {
        h.setPreview({ ghosts: [], candidates: [], route: answer.highlight });
        this.say("route", answer.sentence, { tone: answer.outcome === "fits" ? "done" : "warn", details: answer.details, via });
        return;
      }
    }
    const width = route?.width_m ?? null;
    if (route?.from_object_id && route.to_object_id && width) {
      const a = project.scene.objects.find((o) => o.id === route.from_object_id)!;
      const b = project.scene.objects.find((o) => o.id === route.to_object_id)!;
      return this.answerRoute(routeBetween(source, a, b, width, 0.1), project);
    }
    this.push({
      role: "assistant",
      kind: "route-form",
      tone: "question",
      via,
      text: "Which route, and how wide is the item?",
      form: { kind: "route", fromId: route?.from_object_id ?? null, toId: route?.to_object_id ?? null, width: width ? String(width) : "", allowance: "0.1" },
    });
  };

  submitRoute = (entryId: number, fromId: string, toId: string, width: number, allowance: number) => {
    const h = this.host;
    if (!h.source || !h.project) return;
    const a = h.project.scene.objects.find((o) => o.id === fromId);
    const b = h.project.scene.objects.find((o) => o.id === toId);
    if (!a || !b || a.id === b.id) return;
    this.update(entryId, { closed: true, lines: [`${nameOf(h.project, fromId)} → ${nameOf(h.project, toId)}, ${width} m wide with ${allowance} m each side.`] });
    this.answerRoute(routeBetween(h.source, a, b, width, allowance));
  };

  /** Run the shift on `override` (the plan's layout) or the world as it is; returns the run. */
  doRun = (again: boolean, via: Entry["via"] = null, override: Project | null = null, previous: DayRun | null = this.host.day): DayRun | null => {
    const h = this.host;
    if (!this.needWorld()) return null;
    const project = override ?? h.project!;
    if (!drawingSource(project)) {
      this.say("cannot", "A shift runs on a reviewed plan, and this world has none. Open the example factory, or attach a plan.", {
        tone: "warn",
        via,
        buttons: [{ label: SUGGESTION_TEXT.example, testId: "chat-do-example", run: () => this.doExample() }],
      });
      return null;
    }
    if (h.facts.reviewOpen) {
      this.say("cannot", "First confirm what the drawing shows (the card below); then a shift can run.", { tone: "warn", via });
      return null;
    }
    if (!project.process) {
      h.openSetup();
      this.awaiting = { kind: "run", since: h.day?.result ? 1 : 0 };
      this.say("question", "This layout has no shift set up yet. Pick the stations in order below; times and people you don't know are offered as labelled assumptions, and nothing runs until you accept them.", { tone: "question", via });
      return null;
    }
    const made = h.runDay(project);
    if (!made) return null;
    const s = runSentence(made, project);
    const lines = [...s.lines];
    // "Again" only when there is an earlier run to repeat; otherwise it is simply a run.
    const repeat = again && previous?.result != null;
    if (repeat && previous?.result && made.result) {
      lines.unshift(made.result.fingerprint === previous.result.fingerprint ? "Same events as the last run: the change didn't affect this shift." : `Was ${previous.result.metrics.completed} before the change, with the same process and seed.`);
    }
    this.say(repeat ? "run-again" : "run", `${repeat ? "Ran the same shift again" : "Ran the shift"}. Whole-shift result: ${s.text}`, {
      tone: s.tone,
      via,
      lines,
      details: [
        "The playback in the world shows this shift unfolding: its count is “Completed so far” at the clock shown; this result is the whole shift.",
        assumptionLine(project),
        `Engine ${made.engine}, seed ${made.seed}, ${made.result?.events.length ?? 0} events, fingerprint ${made.result?.fingerprint ?? "–"}.`,
        "Predicts what happens under these assumptions only; it does not verify real output or safety.",
      ],
      buttons: [{ label: "Full results", testId: "chat-run-details", run: () => this.host.openSheet("run") }],
    });
    return made;
  };

  doWhy = (via: Entry["via"] = null) => {
    const h = this.host;
    if (!this.needWorld()) return;
    if (!h.project?.process || !h.day?.result) {
      this.say("cannot", "There's no run to explain yet. Run the shift first.", { tone: "warn", via, buttons: h.project?.process ? [{ label: "Run the shift", testId: "chat-do-run", run: () => this.doRun(false) }] : [] });
      return;
    }
    if (h.facts.runStale) {
      this.say("cannot", "The last run was made before your latest change. Run it again first, then I can compare.", { tone: "warn", via, buttons: [{ label: SUGGESTION_TEXT.run_again, testId: "chat-do-run-again", run: () => this.doRun(true) }] });
      return;
    }
    if (!h.facts.layoutEdited) {
      this.say("cannot", "Nothing to compare: the layout is as drawn, so the run is the original one.", { tone: "info", via });
      return;
    }
    const compared = h.compare();
    if (!compared) {
      this.say("cannot", "The original layout can't be run for comparison (no reviewed drawing).", { tone: "warn", via });
      return;
    }
    const { explanation, identical, rows } = compared.result;
    const output = explanation.find((l) => l.startsWith("Output")) ?? explanation.at(-1)!;
    // A blocked (or cleared) route explains a change in output before a longer or shorter walk.
    const weight = (l: string) => (/ is blocked in the edited layout/.test(l) ? 0 : / is clear now/.test(l) ? 1 : 2);
    const causes = explanation.filter((l) => l !== output).sort((a, b) => weight(a) - weight(b));
    const route = answerProcess(h.project);
    h.setPreview({ ghosts: [], candidates: [], route: route?.highlight ?? null });
    this.say("why", identical ? explanation[0]! : output, {
      tone: identical ? "info" : "warn",
      via,
      lines: identical ? [] : causes.slice(0, 1).map((l) => `Because ${l.replace(/ \((Blocked[^)]*)\)\. It is needed for .*$/, (_m: string, why: string) => `: ${brief(why)}.`)}`),
      details: [...causes, ...rows.map((r) => `${r.label}: ${r.before} → ${r.after} (${r.change})`), "Both runs use the same process, seed and engine; only the layout differs."],
      buttons: [{ label: "Full comparison", testId: "chat-why-details", run: () => this.host.openSheet("run") }],
    });
  };

  doUndo = (via: Entry["via"] = null) => {
    const h = this.host;
    const label = h.undoLabel;
    const outcome = h.undo();
    h.setPreview(null);
    if (!outcome || !outcome.ok) {
      this.say("cannot", "There's nothing to undo.", { tone: "info", via });
      return;
    }
    this.say("done", `Undone: ${label ?? "the last change"}.`, { tone: "done", via, buttons: h.facts.hasProcess ? [{ label: SUGGESTION_TEXT.run_again, testId: "chat-do-run-again", run: () => this.doRun(true) }] : [] });
  };

  doSave = () => {
    const name = this.host.save();
    this.say(name ? "done" : "cannot", name ? `Saved as ${name} (in your downloads).` : "There's nothing to save yet.", { tone: name ? "done" : "info" });
  };

  doExport = () => {
    if (!this.host.exportRun()) this.say("cannot", "Run the shift first; then the run can be exported.", { tone: "info" });
  };

  doSelect = (id: string, via: Entry["via"] = null) => {
    const h = this.host;
    h.select(id);
    h.setPreview({ ghosts: [], candidates: [id], route: null });
    this.say("done", `Here is ${nameOf(h.project!, id)}.`, { tone: "done", via });
  };

  // ── Typed messages ─────────────────────────────────────────────────────────────────────

  act = (result: ChatResult, message: string, timing: NonNullable<Entry["timing"]> = {}) => {
    const via = result.provider.mode;
    const h = this.host;
    if (result.outcome === "unsupported") {
      this.say("cannot", result.message!, { tone: "warn", via, lines: ["I can move, turn and add things, check routes and the layout, run a shift and explain its result."] });
      return;
    }
    if (result.outcome === "clarification") {
      const project = h.project;
      const choices: CardChoice[] = project
        ? result.candidates.map((id) => ({
            label: nameOf(project, id),
            testId: `chat-choice-${id}`,
            objectId: id,
            run: () => {
              const object = this.host.project?.scene.objects.find((o) => o.id === id);
              if (object) void this.send(`${message} (I mean ${object.name})`);
            },
          }))
        : [];
      if (choices.length) h.setPreview({ ghosts: [], candidates: result.candidates, route: null });
      this.say("question", result.question!, { tone: "question", via, choices, lines: result.checks });
      return;
    }
    this.startPlan(result.steps, message, via, result.checks, timing);
  };

  send = async (text: string) => {
    const message = text.trim();
    if (message.length < 3 || this.getBusy()) return; // one request at a time: no duplicate sends
    const h = this.host;
    this.push({ role: "user", kind: "user", text: message, tone: "info" });
    if (LOOK_WORDS.test(message) && h.facts.hasDrawing) {
      // How equipment looks is matched here, from the catalog, with no model call.
      // "this equipment" is all of it; "it", "this machine" or "the selected one" is the selection.
      const selected = h.selectedId && /\b(it|selected|this (?:object|machine|one))\b/i.test(message) ? [h.selectedId] : undefined;
      void this.startLook(selected);
      return;
    }
    if (!h.assist.available) {
      this.say(
        "cannot",
        h.assist.mode === "off"
          ? "Typing a request needs the AI, which is off here (no Voyager key). Use the suggestions, attach a plan, or open the Full editor: everything works by hand."
          : "The AI's availability isn't known yet (the local API did not answer). Use the suggestions or the Full editor meanwhile.",
        { tone: "warn" },
      );
      return;
    }
    this.pending?.controller.abort();
    const controller = new AbortController();
    const project = h.project;
    const revision = project?.scene.revision ?? -1;
    const loadId = h.loadId;
    // One deadline for the whole interpretation (the API's, retries included); the browser stops
    // waiting just after it. Progress is the time elapsed, never an invented percentage.
    const deadlineS = h.assist.deadlineS ?? 30;
    const started = performance.now();
    const waiting = (elapsed: number) => `Reading your request… ${elapsed} s (stops at ${deadlineS} s)`;
    const entryId = this.push({ role: "assistant", kind: "progress", text: waiting(0), tone: "progress", buttons: [] });
    const ticker = setInterval(() => {
      if (this.pending?.entryId === entryId) this.update(entryId, { text: waiting(Math.floor((performance.now() - started) / 1000)) });
    }, 1000);
    const cancel = () => {
      clearInterval(ticker);
      controller.abort();
      this.update(entryId, { text: "Cancelled. Nothing was changed.", tone: "info", closed: true, kind: "cancelled" });
      if (this.pending?.entryId === entryId) this.pending = null;
      this.setBusy(false);
    };
    this.update(entryId, { buttons: [{ label: "Cancel", testId: "chat-cancel-request", run: cancel }] });
    this.pending = { controller, entryId };
    this.setBusy(true);
    const context = project ? buildChatContext(project, h.selectedId) : { revision: 0, selected_object_id: null, objects: [] };
    // The conversation's object is sent only when the words refer back to it ("it", "that").
    const refers = /\b(it|its|that|this|them|those|these)\b/i.test(message);
    const focus = refers && this.focus && project?.scene.objects.some((o) => o.id === this.focus) ? this.focus : null;
    let response: Awaited<ReturnType<ApiClient["interpretChat"]>>;
    try {
      response = await h.client.interpretChat({ request: message, context, state: chatState(h.facts), focus_object_id: focus }, controller.signal, (deadlineS + 3) * 1000);
    } catch {
      return; // cancelled: the card already says so
    } finally {
      clearInterval(ticker);
    }
    if (controller.signal.aborted) return; // a late answer to a cancelled request is dropped
    this.pending = null;
    this.setBusy(false);
    const interpretMs = Math.round(performance.now() - started);
    const now = this.host;
    if (now.loadId !== loadId || (now.project?.scene.revision ?? -1) !== revision) {
      this.update(entryId, { text: "The world changed while I was reading that, so the answer was set aside and nothing was applied. Ask again.", tone: "warn", closed: true, kind: "stale" });
      return;
    }
    if (!response.ok) {
      const error = response.error;
      const timedOut = (error.kind === "http" && error.status === 504) || (error.kind === "network" && /did not respond within/.test(error.message));
      if (timedOut) {
        // Nothing was changed and no second request is started: Try again is the person's choice.
        this.update(entryId, {
          kind: "timeout",
          tone: "warn",
          closed: false,
          text: `No answer within ${deadlineS} s, so nothing was changed.`,
          lines: [`Your request: “${message}”`, "Try again, or do it by hand: the suggestions below and Move a machine work without the AI."],
          buttons: [
            { label: "Try again", testId: "chat-retry", primary: true, run: () => (this.update(entryId, { closed: true, buttons: [] }), void this.send(message)) },
            { label: "Move a machine by hand", testId: "chat-manual-move", run: () => (this.update(entryId, { closed: true, buttons: [] }), this.suggest("move_any")) },
          ],
          timing: { interpretMs },
        });
        return;
      }
      this.update(entryId, { text: `The AI couldn't answer: ${error.message}`, tone: "error", closed: true, kind: "error" });
      return;
    }
    this.remove(entryId);
    this.act(response.value, message, { interpretMs, ...(response.value.timing ? { providerMs: response.value.timing.provider_ms } : {}) });
  };

  cancelPending = () => {
    const p = this.pending;
    if (!p) return;
    p.controller.abort();
    this.update(p.entryId, { text: "Cancelled. Nothing was changed.", tone: "info", closed: true, kind: "cancelled" });
    this.pending = null;
    this.setBusy(false);
  };

  // ── Suggestions and attachments ────────────────────────────────────────────────────────

  suggest = (id: SuggestionId) => {
    this.push({ role: "user", kind: "user", text: SUGGESTION_TEXT[id], tone: "info" });
    const actions: Record<SuggestionId, () => void> = {
      example: this.doExample,
      upload: () => {
        this.say("question", "Choose a DXF, PDF, PNG or JPEG of the plan. It stays on this computer; nothing is sent to the AI.", { tone: "question" });
        this.host.pickFile();
      },
      capabilities: this.doCapabilities,
      move: this.doMoveForm,
      move_any: this.doMoveForm,
      route: () => this.doRoute(null),
      run: () => this.doRun(false),
      run_example: () => this.doRun(false),
      run_again: () => this.doRun(true),
      why: () => this.doWhy(),
      compare: () => this.doWhy(),
      undo: () => this.doUndo(),
      export: this.doExport,
      appearance: () => void this.startLook(),
    };
    actions[id]();
  };

  attach = async (file: File) => {
    const h = this.host;
    this.push({ role: "user", kind: "user", text: `Attached ${file.name}`, tone: "info" });
    if (/\.(glb|gltf)$/i.test(file.name) || (await isGlb(file))) {
      void this.attachModel(file);
      return;
    }
    if (/\.(json|zip)$/i.test(file.name)) {
      h.openFile(file);
      const entryId = this.say("progress", `Opening ${file.name}…`, { tone: "progress" });
      this.awaiting = { kind: "file", since: h.loadId, name: file.name, entryId };
      return;
    }
    if (/\.(png|jpe?g|webp)$/i.test(file.name) && h.project?.scene.objects.some(canChangeLook)) {
      this.offerReference(file);
      return;
    }
    if (/\.(pdf|png|jpe?g)$/i.test(file.name)) {
      this.awaiting = { kind: "world", since: h.loadId, name: file.name };
      h.pictureImport(file);
      this.say("question", "A picture or PDF page has no scale. In the window that opened, mark one length you know; then I'll show the draft here.", { tone: "question" });
      return;
    }
    const refused = precheck(file);
    if (refused) {
      this.say("cannot", refused, { tone: "error" });
      return;
    }
    const controller = new AbortController();
    const id = this.push({ role: "assistant", kind: "progress", text: `Reading ${file.name}… (on this computer; nothing goes to the AI)`, tone: "progress", buttons: [] });
    this.update(id, { buttons: [{ label: "Cancel", testId: "chat-cancel-import", run: () => { controller.abort(); this.update(id, { text: "Cancelled. Nothing was imported.", closed: true, tone: "info" }); } }] }); // prettier-ignore
    const read = await readDrawing(h.client, file, controller.signal).catch(() => null);
    if (!read || controller.signal.aborted) return;
    if (!read.ok) {
      this.update(id, { text: `${file.name} can't be read: ${read.message}`, tone: "error", closed: true, kind: "error" });
      return;
    }
    const analysis = read.value;
    const build = async (unit: DrawingUnit) => {
      const draft = await prepareDraft(this.host.client, analysis, unit, controller.signal).catch(() => null);
      if (!draft || controller.signal.aborted) return;
      if (!draft.ok) {
        this.say("cannot", draft.message, { tone: "error" });
        return;
      }
      this.awaiting = { kind: "world", since: this.host.loadId, name: file.name };
      this.host.createWorld(draft.value, file.name);
    };
    const unit = settledUnit(analysis, null);
    if (unit) {
      this.update(id, { text: `Read ${file.name}.`, closed: true, kind: "read", tone: "done" });
      await build(unit);
      return;
    }
    const units: DrawingUnit[] = ["mm", "cm", "m", "in", "ft"];
    this.update(id, {
      text: `${file.name} doesn't say what its unit is. Which size is right?`,
      tone: "question",
      kind: "question",
      buttons: [],
      form: { kind: "unit", units: units.map((u) => ({ unit: u, label: formatSize(analysis.drawing, u) })), choose: (u) => { this.update(id, { closed: true, form: null, lines: [`Unit: ${u}`] }); void build(u); } }, // prettier-ignore
    });
  };

  /** Called after every render with the latest host: notice a world arriving, a run made by the
   * guided setup, or a file the API refused, that the conversation was waiting for. */
  setHost = (host: ChatHost) => {
    this.host = host;
    const a = this.awaiting;
    if (!a) return;
    if ((a.kind === "world" || a.kind === "file") && host.loadId !== a.since && host.project) {
      this.awaiting = null;
      host.setPreview(null);
      const objects = host.project.scene.objects.length;
      if (a.entryId) this.remove(a.entryId);
      if (a.kind === "file") {
        this.say("done", `Opened ${a.name}: ${objects} objects.`, { tone: "done" });
      } else if (host.isSample) {
        this.say("done", "Here's the example factory: a made-up hall drawn as a DXF, with an example shift. Every operating value in it is an assumption, not data.", { tone: "done" });
      } else {
        this.say("done", `Here's the draft world from ${a.name}: ${objects} objects from the drawing.`, {
          tone: "done",
          lines: ["Footprints and positions come from the drawing. Heights are assumed for display, and a drawing has no machine times or staffing: I'll ask for those only if you run a shift."],
        });
      }
      return;
    }
    if (a.kind === "run" && host.day?.result && host.project?.process) {
      this.awaiting = null;
      const s = runSentence(host.day, host.project);
      this.say("run", `Ran the shift. Whole-shift result: ${s.text}`, {
        tone: s.tone,
        lines: s.lines,
        details: [assumptionLine(host.project), `Engine ${host.day.engine}, seed ${host.day.seed}, fingerprint ${host.day.result.fingerprint}.`],
        buttons: [{ label: "Full results", testId: "chat-run-details", run: () => this.host.openSheet("run") }],
      });
      return;
    }
    if (a.kind === "file" && host.fileError) {
      if (a.entryId) this.remove(a.entryId);
      this.awaiting = null;
      this.say("cannot", host.fileError, { tone: "error" });
    }
  };
}

/** The conversation for a component that calls `controller.setHost(...)` after each render. */
export function useChat() {
  const [controller] = useState(() => new ChatController());
  const entries = useSyncExternalStore(controller.subscribe, controller.getEntries);
  const busy = useSyncExternalStore(controller.subscribe, controller.getBusy);
  return { controller, entries, busy };
}
