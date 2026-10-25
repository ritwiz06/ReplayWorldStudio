// The conversation's plans (UX-04), driven against the real command engine and the sample hall:
// one Apply for the reviewed change, revisions tracked through the plan's own edits, a stale plan
// never applied, a plan never applied twice, a failed step stopping the steps that depend on it,
// cancellation keeping what was applied (and saying so), an unsupported part never attempted,
// an ambiguous name resolved without losing the rest, and undo giving back the same events.
import { readFileSync } from "node:fs";
import type { ChatStep, Project } from "@replay-world/contracts";
import { validateProject } from "@replay-world/contracts";
import { describe, expect, it } from "vitest";
import type { CommandRequest } from "../editing/commands";
import { createEditor, type EditorState, execute, undo } from "../editing/history";
import { type DayRun, runDay } from "../run/day";
import { drawingSource } from "../drawing/world";
import { type ChatHost, ChatController, type Entry } from "./useChat";

const checked = validateProject(JSON.parse(readFileSync(new URL("../../../../fixtures/scenes/sample-factory.json", import.meta.url), "utf8")));
if (!checked.ok) throw new Error("sample");
const sample = checked.value;
const foundation = validateProject(JSON.parse(readFileSync(new URL("../../../../fixtures/scenes/foundation-scene.json", import.meta.url), "utf8")));
if (!foundation.ok) throw new Error("foundation");
const demo = validateProject(JSON.parse(readFileSync(new URL("../../../../fixtures/scenes/industrial-demo.json", import.meta.url), "utf8")));
if (!demo.ok) throw new Error("industrial-demo");
// As the app ships it: the fixtures' catalogs.
const library = [...foundation.value.catalog, ...demo.value.catalog];

const step = (action: ChatStep["action"], fields: Partial<ChatStep> = {}): ChatStep => ({ action, target_id: null, move: null, rotate: null, route: null, add: null, needs: null, unsupported: null, ...fields });
const moveB = (metres: number, direction: "left" | "right" | "forward" | "back" = "right") => step("move", { target_id: "obj-dxf-111", move: { direction, distance: metres, unit: "m", quote: `${metres} m ${direction}` } });

/** A host over a real editor, as the App provides one. */
function world(options: { refuse?: string; client?: Partial<ChatHost["client"]> } = {}) {
  let editor: EditorState = createEditor(sample);
  let day: DayRun | null = null;
  const runs: DayRun[] = [];
  const host = (): ChatHost => ({
    client: (options.client ?? {}) as ChatHost["client"],
    project: editor.project,
    loadId: 1,
    source: drawingSource(editor.project),
    selectedId: null,
    assist: { available: true, mode: "recorded", note: "", deadlineS: 30 },
    facts: { hasWorld: true, hasDrawing: true, reviewOpen: false, hasProcess: true, hasRun: day !== null, runStale: day !== null && day.sceneRevision !== editor.project.scene.revision, layoutEdited: false, canUndo: editor.undo.length > 0, hasSelection: false, canExplain: false, outputChanged: null },
    routeAsk: null,
    day,
    isSample: true,
    undoLabel: editor.undo.at(-1)?.change.label ?? null,
    fileError: null,
    loadSample: () => undefined,
    openFile: () => undefined,
    createWorld: () => undefined,
    pictureImport: () => undefined,
    select: () => undefined,
    execute: (request: CommandRequest) => {
      // A refusal at execution time (as when the world changed underneath), to test stopping.
      if (options.refuse && "objectId" in request.command && request.command.objectId === options.refuse) {
        return { ok: false as const, state: editor, rejection: { kind: "conflict" as const, message: "The scene changed (revision 99) since this edit was prepared." } };
      }
      const outcome = execute(editor, request);
      if (outcome.ok) editor = outcome.state;
      return outcome;
    },
    undo: () => {
      const outcome = undo(editor, editor.project.scene.revision);
      if (outcome.ok) editor = outcome.state;
      return outcome;
    },
    setRouteAsk: () => undefined,
    setPreview: () => undefined,
    runDay: (target?: Project) => {
      const on = target ?? editor.project;
      day = runDay(on, on.process!, "edited");
      runs.push(day);
      return day;
    },
    compare: () => null,
    openSetup: () => undefined,
    save: () => "saved.json",
    exportRun: () => false,
    openSheet: () => undefined,
    pickFile: () => undefined,
    previewUndo: () => {
      const outcome = undo(editor, editor.project.scene.revision);
      return outcome.ok ? outcome.state.project : null;
    },
    library: async () => library,
    openCreate: () => undefined,
    setLookPreview: () => undefined,
    openLookCreate: () => undefined,
  });
  const chat = new ChatController();
  const sync = () => chat.setHost(host());
  sync();
  const card = (kind: string): Entry | undefined => chat.entries.filter((e) => e.kind === kind).at(-1);
  const plan = () => chat.entries.filter((e) => e.plan).at(-1)!;
  return { chat, sync, card, plan, runs, edit: (request: CommandRequest) => { const o = execute(editor, request); if (o.ok) editor = o.state; sync(); }, get editor() { return editor; } }; // prettier-ignore
}

const apply = async (w: ReturnType<typeof world>) => {
  const id = w.plan().plan!.id;
  const done = w.chat.apply(id);
  // Steps advance on short timers; keep the host current between them, as renders do.
  for (let i = 0; i < 40 && w.chat.entries.some((e) => e.plan?.phase === "running" || e.plan?.phase === "review"); i++) {
    await new Promise((r) => setTimeout(r, 130));
    w.sync();
  }
  await done;
  w.sync();
};

describe("a plan from one message", () => {
  it("shows the whole plan, applies it once, and runs the dependent checks without asking again", async () => {
    const w = world();
    w.chat.startPlan([moveB(1), step("check_route", { route: { from_object_id: "obj-dxf-111", to_object_id: null, width_m: null, width_quote: null } }), step("run_day")], "Move Machine B 1 metre right, check its routes, and run the shift again.", "recorded");
    const review = w.plan();
    expect(review.kind).toBe("proposal");
    expect(review.plan!.rows.map((r) => r.label)).toEqual(["Move Machine B 1 m right", "Check Machine B's routes", "Run the shift"]);
    expect(review.lines ?? []).toEqual(expect.arrayContaining(["Walk Mixer ↔ Machine B: 4.9 m → 5.9 m."]));
    expect(w.editor.project.scene.revision).toBe(sample.scene.revision); // nothing changed yet
    await apply(w);
    expect(w.plan().plan!.rows.map((r) => r.status)).toEqual(["done", "done", "done"]);
    expect(w.editor.project.scene.revision).toBe(sample.scene.revision + 1);
    expect(w.card("route")!.text).toMatch(/^Yes: its 2 routes still fit\.$/);
    expect(w.card("run")!.text).toMatch(/^Ran the shift. Whole-shift result: 102 batches completed by 14:00/);
    // The run used the layout after the move (the plan's own revision, not a stale one).
    expect(w.runs.at(-1)!.sceneRevision).toBe(w.editor.project.scene.revision);
    // Applying again does nothing: a plan runs at most once.
    await w.chat.apply(w.plan().plan!.id);
    expect(w.editor.project.scene.revision).toBe(sample.scene.revision + 1);
  });

  it("takes no new request while its steps run, so nothing acts on a half-changed world", async () => {
    const w = world();
    w.chat.startPlan([moveB(1), step("run_day")], "Move Machine B 1 metre right and run the shift.", "recorded");
    expect(w.chat.getBusy()).toBe(false);
    const running = apply(w);
    expect(w.chat.getBusy()).toBe(true);
    const before = w.chat.entries.length;
    await w.chat.send("What happens during a shift?");
    expect(w.chat.entries.length).toBe(before); // ignored, not queued behind the plan
    await running;
    expect(w.chat.getBusy()).toBe(false);
  });

  it("explains the difference against the layout before the request, run with the same process and seed", async () => {
    const w = world();
    w.chat.startPlan([moveB(3.5, "forward"), step("run_again"), step("explain_change")], "Move Machine B 3.5 m forward, run the same shift, and explain the difference.", "recorded");
    expect((w.plan().lines ?? []).join(" ")).toContain("Rack A (material) ↔ Mixer would be blocked: narrows to 0.70 m between Machine B and Rack B; needs 0.80 m.");
    await apply(w);
    expect(w.card("why")!.text).toBe("Output goes from 102 to 0 completed batches (−102).");
    expect(w.card("why")!.lines![0]).toContain("Because Rack A (material) ↔ Mixer is blocked now: narrows to 0.70 m");
    expect(w.card("why")!.details!.at(-1)).toContain("Before: the layout as it was before this request");
  });

  it("asks which object without losing the rest, and resolves it locally", async () => {
    const w = world();
    const ambiguous = step("move", { move: { direction: "back", distance: 1, unit: "m", quote: "1 m" }, needs: { kind: "target", question: "“the rack” could be Rack A (material), Rack B. Which one?", candidates: ["obj-dxf-106", "obj-dxf-108"] } });
    w.chat.startPlan([ambiguous, step("run_day")], "Move the rack 1 m back and run the shift again.", "recorded");
    const row = w.plan().plan!.rows[0]!;
    expect(row.status).toBe("needs");
    expect(row.need).toMatchObject({ kind: "target", candidates: [{ id: "obj-dxf-106" }, { id: "obj-dxf-108" }] });
    expect(w.plan().plan!.canApply).toBe(false);
    w.chat.planTarget(w.plan().plan!.id, 0, "obj-dxf-108");
    expect(w.plan().plan!.rows.map((r) => r.label)).toEqual(["Move Rack B 1 m back", "Run the shift"]);
    expect(w.plan().plan!.canApply).toBe(true);
  });

  it("asks for a missing distance or direction on its step", () => {
    const w = world();
    w.chat.startPlan([step("move", { target_id: "obj-dxf-111", needs: { kind: "move_details", question: "How far should Machine B move?", candidates: [] } }), step("run_day")], "Move Machine B and run", "recorded");
    expect(w.plan().plan!.rows[0]!.need).toMatchObject({ kind: "move", question: "How far should Machine B move?" });
    w.chat.planMove(w.plan().plan!.id, 0, "left", 0.5);
    expect(w.plan().plan!.rows[0]!.label).toBe("Move Machine B 0.5 m left");
  });

  it("never attempts an unsupported part, and says what will be done", () => {
    const w = world();
    w.chat.startPlan([moveB(1), step(null, { unsupported: "The app cannot paint objects." })], "Move Machine B 1 m right and paint it red", "recorded");
    const p = w.plan();
    expect(p.plan!.rows.at(-1)).toMatchObject({ label: "The app cannot paint objects.", status: "unsupported" });
    expect(p.lines?.at(-1)).toContain("not supported and will not be attempted");
    expect(p.buttons!.find((b) => b.testId === "chat-apply")!.label).toBe("Apply the supported steps");
  });

  it("is set aside, unapplied, when the world changed before Apply", async () => {
    const w = world();
    w.chat.startPlan([moveB(1), step("run_day")], "Move Machine B 1 m right and run", "recorded");
    w.edit({ baseRevision: w.editor.project.scene.revision, command: { type: "set_transform", objectId: "obj-dxf-10a", transform: { ...sample.scene.objects.find((o) => o.id === "obj-dxf-10a")!.transform, position_m: { x: -2.5, y: 0, z: -3.6 } } } });
    const revision = w.editor.project.scene.revision;
    await w.chat.apply(w.plan().plan!.id);
    expect(w.plan().kind).toBe("plan-stale");
    expect(w.editor.project.scene.revision).toBe(revision);
  });

  it("stops the steps that depend on a failed one, and keeps what was done", async () => {
    const w = world({ refuse: "obj-dxf-10a" });
    const turnMixer = step("rotate", { target_id: "obj-dxf-10a", rotate: { direction: "clockwise", angle_deg: 90, quote: "90 degrees clockwise" } });
    w.chat.startPlan([moveB(1), turnMixer, step("run_day")], "Move Machine B, turn the mixer and run", "recorded");
    await apply(w);
    const p = w.plan();
    expect(p.kind).toBe("plan-failed");
    expect(p.plan!.rows.map((r) => r.status)).toEqual(["done", "failed", "skipped"]);
    expect(p.plan!.rows[1]!.note).toContain("The scene changed");
    expect(p.plan!.rows[2]!.note).toBe("not run: it depends on the failed step");
    expect(p.text).toBe("Stopped at a failed step. 1 change was applied before it.");
    expect(w.runs).toHaveLength(0);
    expect(w.editor.project.scene.revision).toBe(sample.scene.revision + 1);
  });

  it("can be cancelled: before Apply nothing changes; during it, later steps stop and done ones are named", async () => {
    const w = world();
    w.chat.startPlan([moveB(1), step("run_day")], "Move and run", "recorded");
    w.chat.cancelPlan(w.plan().plan!.id);
    expect(w.plan().text).toBe("Cancelled: nothing changed.");
    expect(w.editor.project.scene.revision).toBe(sample.scene.revision);

    w.chat.startPlan([moveB(1), step("check_layout"), step("run_day")], "Move, check and run", "recorded");
    const id = w.plan().plan!.id;
    const running = w.chat.apply(id);
    await new Promise((r) => setTimeout(r, 180)); // the move is done
    w.sync();
    w.chat.cancelPlan(id);
    await running;
    w.sync();
    const p = w.plan();
    expect(p.kind).toBe("plan-cancelled");
    expect(p.text).toMatch(/^Stopped\. 1 change was applied before Cancel/);
    expect(p.plan!.rows.map((r) => r.status)).toContain("cancelled");
    expect(w.runs).toHaveLength(0); // the run never happened
    expect(p.buttons!.map((b) => b.testId)).toContain("chat-undo-request");
  });

  it("undoes the request's own changes, and the same shift gives the same events", async () => {
    const w = world();
    const original = runDay(sample, sample.process!, "edited").result!.fingerprint;
    w.chat.startPlan([moveB(1), step("run_day")], "Move and run", "recorded");
    await apply(w);
    expect(w.runs.at(-1)!.result!.fingerprint).not.toBe(original);
    w.chat.undoPlan(w.plan().plan!.id);
    w.sync();
    expect(w.editor.project.scene.revision).toBe(sample.scene.revision + 2);
    expect(JSON.stringify(w.editor.project.scene.objects)).toBe(JSON.stringify(sample.scene.objects));
    w.chat.startPlan([step("run_again")], "Run again", "recorded");
    expect(w.runs.at(-1)!.result!.fingerprint).toBe(original);
  });
});

describe("adding an object from the conversation", () => {
  it("suggests a catalog item, asks the side, places it at the stated size with its provenance, in one undoable step", async () => {
    const w = world();
    const add = step("add_object", { add: { description: "packing table", width_m: 1.5, depth_m: 0.8, height_m: null, near_object_id: "obj-dxf-111", side: null } });
    w.chat.startPlan([add], "Add a packing table, 1.5 metres wide and 0.8 metres deep, beside Machine B.", "recorded");
    await new Promise((r) => setTimeout(r, 20)); // the library is fetched
    w.sync();
    let row = w.plan().plan!.rows[0]!;
    expect(row.need).toMatchObject({ kind: "asset", suggestion: { label: "Generic packing station (provisional)" } });
    const id = w.plan().plan!.id;
    w.chat.planAsset(id, 0, "use");
    row = w.plan().plan!.rows[0]!;
    expect(row.need).toMatchObject({ kind: "side" });
    w.chat.planSide(id, 0, "right");
    expect(w.plan().plan!.canApply).toBe(true);
    await apply(w);
    const added = w.editor.project.scene.objects.at(-1)!;
    expect(added).toMatchObject({ name: "Packing table", asset_id: "asset-generic-packing-station" });
    expect(added.dimensions.width).toMatchObject({ value_m: 1.5, origin: "user_supplied", source_ref: "Stated in the conversation" });
    expect(added.dimensions.depth).toMatchObject({ value_m: 0.8, origin: "user_supplied" });
    expect(added.dimensions.height).toMatchObject({ value_m: 1.4, origin: "default" }); // assumed, from the catalog
    expect(w.editor.project.catalog.map((a) => a.id)).toContain("asset-generic-packing-station");
    expect(w.editor.undo).toHaveLength(1); // one step: undo removes the object and the catalog entry
    w.chat.undoPlan(w.plan().plan!.id);
    expect(w.editor.project.catalog).toHaveLength(0);
    expect(w.editor.project.scene.objects).toHaveLength(sample.scene.objects.length);
  });
});


describe("waiting for the interpretation (UX-05)", () => {
  it("stops at the deadline with nothing changed, keeps the request, and starts no second request", async () => {
    let calls = 0;
    const w = world({ client: { interpretChat: async () => ((calls += 1), { ok: false as const, error: { kind: "http" as const, status: 504, message: "No usable answer within 30 s; nothing was changed.", issues: [] } }) } });
    await w.chat.send("Move Machine B 1 metre right");
    const timeout = w.card("timeout")!;
    expect(timeout.text).toBe("No answer within 30 s, so nothing was changed.");
    expect(timeout.lines![0]).toBe("Your request: “Move Machine B 1 metre right”");
    expect(timeout.buttons!.map((b) => b.testId)).toEqual(["chat-retry", "chat-manual-move"]);
    expect(calls).toBe(1);
    expect(w.chat.getBusy()).toBe(false);
    expect(w.editor.project.scene.revision).toBe(sample.scene.revision);
  });

  it("drops an answer that arrives after Cancel", async () => {
    let release: (v: unknown) => void = () => undefined;
    const answer = { outcome: "plan", steps: [step("run_day")], question: null, candidates: [], message: null, checks: [], provider: { service: "t", base_url: "t", model: "t", mode: "recorded", attempts: 1, first_attempt_valid: true, latency_ms: 0 } };
    const w = world({ client: { interpretChat: (_body: unknown, signal?: AbortSignal) => new Promise((resolve, reject) => { release = resolve; signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))); }) as never } });
    const sent = w.chat.send("Run the shift");
    w.chat.cancelPending();
    release({ ok: true, value: answer });
    await sent;
    expect(w.card("cancelled")!.text).toBe("Cancelled. Nothing was changed.");
    expect(w.runs).toHaveLength(0);
  });

  it("keeps a part not understood in the plan, blocks Apply, and asks again with the answer", () => {
    const w = world();
    const unclear: ChatStep = { ...step(null), needs: { kind: "clarify", question: "What do you mean by “sort out the corner”?", candidates: [] } };
    w.chat.startPlan([moveB(1), unclear], "Move Machine B 1 m right and sort out the corner.", "recorded");
    const plan = w.plan();
    expect(plan.plan!.rows.map((r) => [r.label, r.status])).toEqual([["Move Machine B 1 m right", "ready"], ["Not understood yet", "needs"]]);
    expect(plan.plan!.canApply).toBe(false);
    expect(plan.buttons!.map((b) => b.testId)).not.toContain("chat-apply");
  });
});

describe("equipment appearance from the conversation (UX-05)", () => {
  it("applies the reviewed models once, as one undo step, and refuses a review the world has moved past", async () => {
    const w = world();
    await w.chat.startLook();
    const look = () => w.chat.entries.filter((e) => e.look).at(-1)!;
    expect(look().look!.rows.find((r) => r.objectId === "obj-dxf-111")!.status).toBe("ask");
    const id = look().look!.id;
    w.chat.lookUse(id, "obj-dxf-10f", "asset-electrical-cabinet-800");
    w.chat.lookApply(id);
    w.sync();
    expect(look().kind).toBe("appearance-applied");
    expect(w.editor.project.scene.objects.find((o) => o.id === "obj-dxf-10f")!.asset_id).toBe("asset-electrical-cabinet-800");
    const revision = w.editor.project.scene.revision;
    w.chat.lookApply(id); // a second click does nothing
    expect(w.editor.project.scene.revision).toBe(revision);
    expect(w.editor.undo).toHaveLength(1);
    // A second review, overtaken by an edit before Apply, changes nothing.
    await w.chat.startLook();
    const second = look().look!.id;
    w.chat.lookUse(second, "obj-dxf-10c", "asset-electrical-cabinet-800");
    w.edit({ baseRevision: w.editor.project.scene.revision, command: { type: "set_transform", objectId: "obj-dxf-113", transform: { ...sample.scene.objects.find((o) => o.id === "obj-dxf-113")!.transform, position_m: { x: -6, y: 0, z: 3.6 } } } });
    w.chat.lookApply(second);
    expect(look().kind).toBe("appearance-stale");
    expect(w.editor.project.scene.objects.find((o) => o.id === "obj-dxf-10c")!.asset_id).toBeNull();
  });
});
