// The conversation (UX-03, AGT-01): one orchestrating assistant over a small registry of typed,
// bounded actions. A typed message is interpreted by the language model (cancellable); its answer
// is a typed action, a question or "cannot". The app then checks the scene revision and the
// action's prerequisites and performs it with its own deterministic code: the edit commands
// (previewed, applied only on Apply, undoable), the route check, the guided setup and the run
// engine. Suggestions and attachments call the same actions directly, with no model at all.
// A late answer - after Cancel, or after the scene changed - is never applied.
import type { ChatResult, EditIntent, Project, Transform } from "@replay-world/contracts";
import { useState, useSyncExternalStore } from "react";
import type { ApiClient } from "../api/client";
import { resolveIntent } from "../assist/editIntent";
import type { RouteAsk, SceneChecks } from "../checks/results";
import { precheck, prepareDraft, readDrawing, settledUnit } from "../drawing/orchestrator";
import { type DrawingSource, type DrawingUnit, formatSize } from "../drawing/world";
import type { CommandRequest } from "../editing/commands";
import type { Outcome } from "../editing/history";
import { applyCommand } from "../editing/commands";
import { type DayComparison, type DayRun, plural, valueCounts } from "../run/day";
import { clockText } from "../run/replay";
import { brief, buildChatContext, capabilityLines, chatState, nameOf, SUGGESTION_TEXT, type SuggestionId, type WorldFacts } from "./context";
import { editImpact } from "./impact";
import { answerAsked, answerProcess, routeBetween } from "./routes";

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
  via?: "live" | "recorded" | null;
  /** Its buttons no longer apply (done, cancelled or out of date). */
  closed?: boolean;
}

export interface ChatPreview {
  move: { objectId: string; transform: Transform } | null;
  candidates: string[];
  route: SceneChecks | null;
}

export interface ChatHost {
  client: ApiClient;
  project: Project | null;
  loadId: number;
  source: DrawingSource | null;
  selectedId: string | null;
  assist: { available: boolean; mode: "live" | "recorded" | "off" | "checking" | "unreachable"; note: string };
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
}


const METRES = { km: 1000, m: 1, cm: 0.01, mm: 0.001, ft: 0.3048, in: 0.0254 } as const;
const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0+$/, "").replace(/\.$/, ""));

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

/** The conversation's state and its actions. A plain object (not hooks), so actions can call
 * one another; the component reads it through useSyncExternalStore and refreshes `host` after
 * every render, so an action always sees the world as it is when it runs. */
export class ChatController {
  /** Set after the first render (and every render after it), before anything can be clicked. */
  host!: ChatHost;
  entries: Entry[] = [];
  busy = false;
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
  getBusy = () => this.busy;
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

  /** A proposal card for one exact edit, previewed in the world; applied only on Apply. */
  propose = (intent: EditIntent, via: Entry["via"] = null) => {
    const h = this.host;
    const project = h.project;
    if (!project) return void this.needWorld();
    const resolved = resolveIntent(project, intent, project.scene.revision);
    if (!resolved.ok) {
      this.say("cannot", `That change can't be made: ${resolved.message}`, { tone: "error", via });
      return;
    }
    const edit = resolved.edit;
    const dry = applyCommand(project, { baseRevision: edit.baseRevision, command: edit.command });
    const impact = dry.ok ? editImpact(project, dry.project, h.routeAsk) : [];
    const objectId = intent.target.object_ids[0]!;
    const name = nameOf(project, objectId);
    const metres = intent.move ? intent.move.distance * METRES[intent.move.unit] : 0;
    const title = intent.move ? `Move ${name} ${fmt(metres)} m ${intent.move.direction}` : `Turn ${name} ${fmt(intent.rotate!.angle_deg)}° ${intent.rotate!.direction}`;
    const transform = edit.command.type === "set_transform" ? edit.command.transform : null;
    h.setPreview({ move: transform ? { objectId, transform } : null, candidates: [], route: null });
    const id = this.push({
      role: "assistant",
      kind: "proposal",
      tone: "question",
      via,
      text: `${title}?`,
      lines: impact.length ? impact.slice(0, 2) : ["No overlap, keep-clear zone or route the checks look at changes."],
      details: [...impact.slice(2), ...edit.changes, "Directions as seen from above (the Top view). Nothing changes until you press Apply."],
      buttons: [],
    });
    const apply = () => {
      const now = this.host;
      now.setPreview(null);
      const outcome = now.execute({ baseRevision: edit.baseRevision, command: edit.command });
      if (!outcome || !outcome.ok) {
        const why = outcome && !outcome.ok ? outcome.rejection.message : "The scene is not editable right now.";
        this.update(id, { closed: true, tone: "warn", lines: [`Not applied: ${why}`] });
        return;
      }
      const facts = this.host.facts;
      this.update(id, {
        tone: "done",
        kind: "applied",
        text: `${title.replace(/^Move/, "Moved").replace(/^Turn/, "Turned")}.`,
        buttons: [
          { label: "Undo", testId: "chat-undo", run: () => this.doUndo() },
          ...(facts.hasProcess ? [{ label: SUGGESTION_TEXT.run_again, testId: "chat-do-run-again", run: () => this.doRun(true) }] : []),
          ...(facts.hasDrawing ? [{ label: SUGGESTION_TEXT.route, testId: "chat-do-route", run: () => this.doRoute(null) }] : []),
        ],
      });
    };
    const cancel = () => {
      this.host.setPreview(null);
      this.update(id, { closed: true, tone: "info", lines: ["Cancelled: nothing changed."] });
    };
    this.update(id, {
      buttons: [
        { label: "Apply", testId: "chat-apply", primary: true, run: apply },
        { label: "Cancel", testId: "chat-cancel", run: cancel },
      ],
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
    this.propose({ action: "move", target: { reference: "named", object_ids: [objectId], phrase: nameOf(this.host.project!, objectId) }, move: { direction, distance: metres, unit: "m", quote: `${metres} m ${direction}` }, rotate: null });
  };

  answerRoute = (ask: RouteAsk) => {
    const h = this.host;
    const answer = h.project ? answerAsked(h.project, ask) : null;
    if (!answer) {
      this.say("cannot", "The route can't be checked on this layout (it needs a reviewed plan with a floor).", { tone: "warn" });
      return;
    }
    h.setRouteAsk(ask);
    h.setPreview({ move: null, candidates: [], route: answer.highlight });
    this.say("route", answer.sentence, { tone: answer.outcome === "fits" ? "done" : "warn", details: answer.details, buttons: [{ label: "Show on the plan", testId: "chat-show-check", run: () => this.host.openSheet("check") }] });
  };

  doRoute = (route: ChatResult["route"] | null, via: Entry["via"] = null) => {
    const h = this.host;
    if (!this.needWorld()) return;
    if (!h.source) {
      this.say("cannot", "Routes are checked on a reviewed plan, and this world has none. Attach a plan, or open the example factory.", { tone: "warn", via });
      return;
    }
    if (h.facts.reviewOpen) {
      this.say("cannot", "First confirm what the drawing shows (the card below); then routes can be checked.", { tone: "warn", via });
      return;
    }
    const project = h.project!;
    const named = route && (route.from_object_id || route.to_object_id || route.width_m);
    if (!named && h.routeAsk?.start && h.routeAsk.end) return this.answerRoute(h.routeAsk);
    if (!named && project.process) {
      const answer = answerProcess(project);
      if (answer) {
        h.setPreview({ move: null, candidates: [], route: answer.highlight });
        this.say("route", answer.sentence, { tone: answer.outcome === "fits" ? "done" : "warn", details: answer.details, via });
        return;
      }
    }
    const width = route?.width_m ?? null;
    if (route?.from_object_id && route.to_object_id && width) {
      const a = project.scene.objects.find((o) => o.id === route.from_object_id)!;
      const b = project.scene.objects.find((o) => o.id === route.to_object_id)!;
      return this.answerRoute(routeBetween(h.source, a, b, width, 0.1));
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

  doRun = (again: boolean, via: Entry["via"] = null) => {
    const h = this.host;
    if (!this.needWorld()) return;
    const project = h.project!;
    if (!h.source) {
      this.say("cannot", "A shift runs on a reviewed plan, and this world has none. Open the example factory, or attach a plan.", {
        tone: "warn",
        via,
        buttons: [{ label: SUGGESTION_TEXT.example, testId: "chat-do-example", run: () => this.doExample() }],
      });
      return;
    }
    if (h.facts.reviewOpen) {
      this.say("cannot", "First confirm what the drawing shows (the card below); then a shift can run.", { tone: "warn", via });
      return;
    }
    if (!project.process) {
      h.openSetup();
      this.awaiting = { kind: "run", since: h.day?.result ? 1 : 0 };
      this.say("question", "This layout has no shift set up yet. Pick the stations in order below; times and people you don't know are offered as labelled assumptions, and nothing runs until you accept them.", { tone: "question", via });
      return;
    }
    const before = h.day;
    const made = h.runDay();
    if (!made) return;
    const s = runSentence(made, project);
    const lines = [...s.lines];
    if (again && before?.result && made.result) {
      lines.unshift(made.result.fingerprint === before.result.fingerprint ? "Same events as the last run: the change didn't affect this shift." : `Was ${before.result.metrics.completed} before the change, with the same process and seed.`);
    }
    const facts = h.facts;
    this.say(again ? "run-again" : "run", `${again ? "Ran the same shift again" : "Ran the shift"}: ${s.text}`, {
      tone: s.tone,
      via,
      lines,
      details: [assumptionLine(project), `Engine ${made.engine}, seed ${made.seed}, ${made.result?.events.length ?? 0} events, fingerprint ${made.result?.fingerprint ?? "–"}.`, "Predicts what happens under these assumptions only; it does not verify real output or safety."],
      buttons: [
        { label: "Full results", testId: "chat-run-details", run: () => this.host.openSheet("run") },
        ...(facts.layoutEdited ? [{ label: SUGGESTION_TEXT.compare, testId: "chat-do-why", run: () => this.doWhy() }] : []),
      ],
    });
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
    h.setPreview({ move: null, candidates: [], route: route?.highlight ?? null });
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
    h.setPreview({ move: null, candidates: [id], route: null });
    this.say("done", `Here is ${nameOf(h.project!, id)}.`, { tone: "done", via });
  };

  // ── Typed messages ─────────────────────────────────────────────────────────────────────

  act = (result: ChatResult, message: string) => {
    const via = result.provider.mode;
    const h = this.host;
    if (result.outcome === "unsupported") {
      this.say("cannot", result.message!, { tone: "warn", via, lines: ["I can move or turn things, check routes, run a shift and explain its result."] });
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
      if (choices.length) h.setPreview({ move: null, candidates: result.candidates, route: null });
      this.say("question", result.question!, { tone: "question", via, choices, lines: result.checks });
      return;
    }
    switch (result.action) {
      case "move":
      case "rotate":
        return this.propose(result.edit!, via);
      case "select":
        return this.doSelect(result.object_id!, via);
      case "check_route":
        return this.doRoute(result.route, via);
      case "run_day":
        return this.doRun(false, via);
      case "run_again":
        return this.doRun(true, via);
      case "explain_change":
        return this.doWhy(via);
      case "undo":
        return this.doUndo(via);
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

  send = async (text: string) => {
    const message = text.trim();
    if (message.length < 3) return;
    const h = this.host;
    this.push({ role: "user", kind: "user", text: message, tone: "info" });
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
    const entryId = this.push({ role: "assistant", kind: "progress", text: "Reading your request…", tone: "progress", buttons: [] });
    const cancel = () => {
      controller.abort();
      this.update(entryId, { text: "Cancelled. Nothing was changed.", tone: "info", closed: true, kind: "cancelled" });
      if (this.pending?.entryId === entryId) this.pending = null;
      this.setBusy(false);
    };
    this.update(entryId, { buttons: [{ label: "Cancel", testId: "chat-cancel-request", run: cancel }] });
    this.pending = { controller, entryId };
    this.setBusy(true);
    const context = project ? buildChatContext(project, h.selectedId) : { revision: 0, selected_object_id: null, objects: [] };
    let response: Awaited<ReturnType<ApiClient["interpretChat"]>>;
    try {
      response = await h.client.interpretChat({ request: message, context, state: chatState(h.facts) }, controller.signal);
    } catch {
      return; // cancelled: the card already says so
    }
    if (controller.signal.aborted) return;
    this.pending = null;
    this.setBusy(false);
    const now = this.host;
    if (now.loadId !== loadId || (now.project?.scene.revision ?? -1) !== revision) {
      this.update(entryId, { text: "The world changed while I was reading that, so the answer was set aside and nothing was applied. Ask again.", tone: "warn", closed: true, kind: "stale" });
      return;
    }
    if (!response.ok) {
      this.update(entryId, { text: `The AI couldn't answer: ${response.error.message}`, tone: "error", closed: true, kind: "error" });
      return;
    }
    this.remove(entryId);
    this.act(response.value, message);
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
    };
    actions[id]();
  };

  attach = async (file: File) => {
    const h = this.host;
    this.push({ role: "user", kind: "user", text: `Attached ${file.name}`, tone: "info" });
    if (/\.(json|zip)$/i.test(file.name)) {
      h.openFile(file);
      const entryId = this.say("progress", `Opening ${file.name}…`, { tone: "progress" });
      this.awaiting = { kind: "file", since: h.loadId, name: file.name, entryId };
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
      this.say("run", `Ran the shift: ${s.text}`, {
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
