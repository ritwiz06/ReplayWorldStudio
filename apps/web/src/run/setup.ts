// "Set up a day" (SIM-01): what the person enters to run a day on their own layout, turned into a
// process, or the exact list of what is still needed. Every operating value is entered (basis
// "entered"); nothing is read or guessed from the drawing, and an empty field stays empty.
import type { LocalPoint, OperatingValue, PlannedStop, ProcessModel, Project, RandomStops, SceneObject, ShiftBreak } from "@replay-world/contracts";

export type Side = "front" | "back" | "left" | "right";

export interface StationDraft {
  objectId: string;
  workerS: string;
  machineS: string;
  inCap: string;
  outCap: string;
  side: Side | "kept";
  /** Where the worker stands when the side is "kept" (an earlier setup's point). */
  kept: LocalPoint | null;
  clearanceM: string;
  /** Planned stops: no cycle starts during them. */
  stops: { reason: string; start: string; minutes: string }[];
  /** Unplanned stops drawn from the seed: mean minutes between them and mean minutes long
   * (both empty for none). */
  randomEveryMin: string;
  randomForMin: string;
}

export interface TransferDraft {
  widthM: string;
  allowanceM: string;
  speedMps: string;
  handlingS: string;
}

export interface WorkerDraft {
  name: string;
  speedMps: string;
  widthM: string;
  /** Task keys ("station:<i>" for the i-th process station, "transfer:<i>" for the i-th carry),
   * in priority order. */
  tasks: string[];
}

export interface DayDraft {
  name: string;
  itemName: string;
  supplyObjectId: string;
  supplyConfirmed: boolean;
  supplySide: Side | "kept";
  supplyKept: LocalPoint | null;
  supplyClearanceM: string;
  stations: StationDraft[];
  transfers: TransferDraft[];
  workers: WorkerDraft[];
  shiftStart: string;
  shiftHours: string;
  breaks: { name: string; start: string; minutes: string }[];
  seed: string;
}

export const emptyStation = (objectId = ""): StationDraft => ({ objectId, workerS: "", machineS: "", inCap: "", outCap: "", side: "front", kept: null, clearanceM: "", stops: [], randomEveryMin: "", randomForMin: "" });
export const emptyTransfer = (): TransferDraft => ({ widthM: "", allowanceM: "", speedMps: "", handlingS: "" });

export function emptyDraft(): DayDraft {
  return { name: "", itemName: "", supplyObjectId: "", supplyConfirmed: false, supplySide: "front", supplyKept: null, supplyClearanceM: "", stations: [], transfers: [], workers: [], shiftStart: "", shiftHours: "", breaks: [], seed: "1" };
}

/** Objects a station can be tied to: equipment and structures, not the floor or floor markings. */
export function stationObjects(project: Project): SceneObject[] {
  return project.scene.objects.filter((o) => (o.kind === "equipment" || o.kind === "structure") && o.dimensions.height.value_m > 0.05 && !/floor/i.test(o.name));
}

const number = (text: string): number | null => {
  const t = text.trim().replace(",", ".");
  if (t === "") return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
};

const clock = (text: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 3600 + min * 60 : null;
};

const slug = (text: string, used: Set<string>): string => {
  const base = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "item";
  let id = base;
  for (let i = 2; used.has(id); i++) id = `${base}-${i}`;
  used.add(id);
  return id;
};

/** Where the worker stands, in the object's frame: beside the chosen side, `clearance` out. */
export function sidePoint(object: SceneObject, side: Side, clearanceM: number): LocalPoint {
  const hw = object.dimensions.width.value_m / 2 + clearanceM;
  const hd = object.dimensions.depth.value_m / 2 + clearanceM;
  const p = side === "front" ? { x: 0, z: hd } : side === "back" ? { x: 0, z: -hd } : side === "right" ? { x: hw, z: 0 } : { x: -hw, z: 0 };
  return { x: Number(p.x.toFixed(3)), z: Number(p.z.toFixed(3)) };
}

/** A draft from a process already set up (to change it); its values keep their numbers. */
export function draftFrom(process: ProcessModel): DayDraft {
  const [supply, ...stations] = process.stations;
  const index = new Map(stations.map((s, i) => [s.id, i]));
  const transferIndex = new Map(process.transfers.map((t) => [t.id, index.has(t.from_station) ? index.get(t.from_station)! + 1 : 0]));
  const s = (v: OperatingValue | null) => (v ? String(v.value) : "");
  const hm = (v: number) => `${String(Math.floor(v / 3600)).padStart(2, "0")}:${String(Math.floor((v % 3600) / 60)).padStart(2, "0")}`;
  return {
    name: process.name,
    itemName: process.item_name,
    supplyObjectId: supply!.object_id,
    supplyConfirmed: true,
    supplySide: "kept",
    supplyKept: supply!.access_m,
    supplyClearanceM: "",
    stations: stations.map((st) => ({
      objectId: st.object_id,
      workerS: s(st.worker_s),
      machineS: s(st.machine_s),
      inCap: s(st.input_capacity),
      outCap: s(st.output_capacity),
      side: "kept",
      kept: st.access_m,
      clearanceM: "",
      stops: st.planned_stops.map((p) => ({ reason: p.reason, start: hm(process.shift.start_clock_s.value + p.start_s.value), minutes: String(p.duration_s.value / 60) })),
      randomEveryMin: st.random_stops ? String(st.random_stops.mean_between_s.value / 60) : "",
      randomForMin: st.random_stops ? String(st.random_stops.mean_duration_s.value / 60) : "",
    })),
    transfers: stations.map((_, i) => {
      const t = process.transfers.find((x) => transferIndex.get(x.id) === i);
      return t ? { widthM: s(t.item_width_m), allowanceM: s(t.allowance_m), speedMps: s(t.speed_m_s), handlingS: s(t.handling_s) } : emptyTransfer();
    }),
    workers: process.workers.map((w) => ({
      name: w.name,
      speedMps: s(w.walk_speed_m_s),
      widthM: s(w.width_m),
      tasks: w.tasks.map((task) => {
        const [kind, id] = task.split(":") as [string, string];
        return kind === "station" ? `station:${index.get(id)}` : `transfer:${transferIndex.get(id)}`;
      }),
    })),
    shiftStart: hm(process.shift.start_clock_s.value),
    shiftHours: String(process.shift.duration_s.value / 3600),
    breaks: process.shift.breaks.map((b) => ({ name: b.name, start: hm(process.shift.start_clock_s.value + b.start_s.value), minutes: String(b.duration_s.value / 60) })),
    seed: String(process.seed),
  };
}

export interface Built {
  process: ProcessModel | null;
  /** Exactly what is still needed, in plain words; empty when the process is complete. */
  needs: string[];
}

/** The process the draft describes, every value marked as entered, or what is still needed. */
export function buildProcess(project: Project, draft: DayDraft): Built {
  const needs: string[] = [];
  const objects = new Map(project.scene.objects.map((o) => [o.id, o]));
  const name = (id: string) => objects.get(id)?.name ?? id;
  const entered = (value: number): OperatingValue => ({ value, basis: "entered" });
  const want = (text: string, what: string, check: (v: number) => boolean, rule: string): number | null => {
    const v = number(text);
    if (v === null) needs.push(`${what}${text.trim() === "" ? "" : ` (“${text.trim()}” is not a number)`}`);
    else if (!check(v)) needs.push(`${what}: ${rule}`);
    else return v;
    return null;
  };
  // Times of day (stops) are kept as seconds after the shift starts.
  const shiftStart = clock(draft.shiftStart);
  const shiftHours = number(draft.shiftHours);
  if (draft.itemName.trim() === "") needs.push("What moves through the process (for example “batch” or “carton”)");
  let supplyAccess: LocalPoint | null = draft.supplySide === "kept" ? draft.supplyKept : null;
  if (!draft.supplyObjectId || !objects.has(draft.supplyObjectId)) needs.push("Where material is taken from (the first step)");
  else {
    if (!draft.supplyConfirmed) needs.push(`Confirm that material is always available at ${name(draft.supplyObjectId)} (the run assumes it)`);
    if (draft.supplySide !== "kept") {
      const side = draft.supplySide;
      const clearance = want(draft.supplyClearanceM, `${name(draft.supplyObjectId)}: how far from its ${side} side material is picked (m)`, (v) => v > 0 && v <= 5, "above 0 m and at most 5 m");
      if (clearance !== null) supplyAccess = sidePoint(objects.get(draft.supplyObjectId)!, side, clearance);
    }
  }
  if (draft.stations.length === 0) needs.push("At least one station after the material, in order");
  const used = new Set<string>();
  const supplyId = slug(draft.supplyObjectId ? `${name(draft.supplyObjectId)} material` : "material", used);
  const stationIds: string[] = [];
  const stations: ProcessModel["stations"][number][] = [];
  draft.stations.forEach((st, i) => {
    const label = st.objectId ? name(st.objectId) : `Station ${i + 1}`;
    const object = objects.get(st.objectId);
    if (!object) needs.push(`Station ${i + 1}: which object it is`);
    if (st.objectId && (st.objectId === draft.supplyObjectId || draft.stations.some((o, j) => j < i && o.objectId === st.objectId))) needs.push(`${label} is used twice: each step is at its own object`);
    const workerS = want(st.workerS, `${label}: time with a worker (seconds, 0 if none)`, (v) => v >= 0, "0 or more");
    const machineS = want(st.machineS, `${label}: time running on its own (seconds, 0 if none)`, (v) => v >= 0, "0 or more");
    if (workerS !== null && machineS !== null && workerS + machineS <= 0) needs.push(`${label}: a cycle must take some time`);
    const whole = (v: number) => v >= 1 && Number.isInteger(v);
    const inCap = want(st.inCap, `${label}: how many items can queue in front of it`, whole, "a whole number, at least 1");
    const last = i === draft.stations.length - 1;
    const outCap = last ? 1 : want(st.outCap, `${label}: how many finished items can wait beside it`, whole, "a whole number, at least 1");
    let access: LocalPoint | null = st.side === "kept" ? st.kept : null;
    if (st.side !== "kept") {
      const clearance = want(st.clearanceM, `${label}: how far from its ${st.side} side the worker stands (m)`, (v) => v > 0 && v <= 5, "above 0 m and at most 5 m");
      if (object && clearance !== null) access = sidePoint(object, st.side, clearance);
    }
    const stopIds = new Set<string>();
    const stops: PlannedStop[] = [];
    st.stops.forEach((stop, k) => {
      const what = `${label}: stop ${k + 1}${stop.reason.trim() ? ` (${stop.reason.trim()})` : ""}`;
      const at = clock(stop.start);
      if (at === null) needs.push(`${what}: when it starts (hh:mm)`);
      const minutes = want(stop.minutes, `${what}: how many minutes`, (v) => v > 0, "above 0");
      if (at !== null && minutes !== null && shiftStart !== null) {
        const offset = (at - shiftStart + 86400) % 86400;
        if (shiftHours !== null && offset >= shiftHours * 3600) needs.push(`${what} must start within the shift`);
        else stops.push({ id: slug(stop.reason || `stop ${k + 1}`, stopIds), reason: stop.reason.trim() || "Planned stop", start_s: entered(offset), duration_s: entered(minutes * 60) });
      }
    });
    let random: RandomStops | null = null;
    if (st.randomEveryMin.trim() !== "" || st.randomForMin.trim() !== "") {
      const every = want(st.randomEveryMin, `${label}: unplanned stops, minutes between them on average`, (v) => v > 0, "above 0");
      const length = want(st.randomForMin, `${label}: unplanned stops, minutes long on average`, (v) => v > 0, "above 0");
      if (every !== null && length !== null) random = { mean_between_s: entered(every * 60), mean_duration_s: entered(length * 60) };
    }
    const id = slug(label, used);
    stationIds.push(id);
    if (object && access && workerS !== null && machineS !== null && inCap !== null && outCap !== null) {
      stations.push({ id, object_id: object.id, name: label, role: "process", access_m: access, access_basis: "entered", worker_s: entered(workerS), machine_s: entered(machineS), input_capacity: entered(inCap), output_capacity: entered(outCap), planned_stops: stops as ProcessModel["stations"][number]["planned_stops"], random_stops: random });
    }
  });
  const transfers: ProcessModel["transfers"][number][] = [];
  draft.stations.forEach((st, i) => {
    const from = i === 0 ? draft.supplyObjectId : draft.stations[i - 1]!.objectId;
    const what = `Carrying ${from ? name(from) : "the material"} → ${st.objectId ? name(st.objectId) : `station ${i + 1}`}`;
    const t = draft.transfers[i] ?? emptyTransfer();
    const width = want(t.widthM, `${what}: width of what is carried (m)`, (v) => v > 0 && v <= 10, "above 0 m");
    const allowance = want(t.allowanceM, `${what}: room kept clear on each side (m, 0 if none)`, (v) => v >= 0 && v <= 5, "0 m or more");
    const speed = want(t.speedMps, `${what}: carrying speed (m/s)`, (v) => v > 0 && v <= 10, "above 0 m/s");
    const handling = want(t.handlingS, `${what}: time to pick up, and again to set down (s, 0 if none)`, (v) => v >= 0, "0 or more");
    if (width !== null && allowance !== null && speed !== null && handling !== null) {
      transfers.push({ id: `carry-${i + 1}`, from_station: i === 0 ? supplyId : stationIds[i - 1]!, to_station: stationIds[i]!, method: "carry", item_width_m: entered(width), allowance_m: entered(allowance), speed_m_s: entered(speed), handling_s: entered(handling) });
    }
  });
  if (draft.workers.length === 0) needs.push("At least one worker");
  const workers: ProcessModel["workers"][number][] = [];
  const workerIds = new Set<string>();
  draft.workers.forEach((w, i) => {
    const label = w.name.trim() || `Worker ${i + 1}`;
    if (w.name.trim() === "") needs.push(`Worker ${i + 1}: a name`);
    const speed = want(w.speedMps, `${label}: walking speed (m/s)`, (v) => v > 0 && v <= 10, "above 0 m/s");
    const width = want(w.widthM, `${label}: width of the path they need to walk (m)`, (v) => v > 0 && v <= 5, "above 0 m");
    const tasks = w.tasks
      .map((key) => {
        const [kind, n] = key.split(":") as [string, string];
        const k = Number(n);
        if (kind === "station") return k < stationIds.length ? `station:${stationIds[k]}` : null;
        return k < stationIds.length ? `transfer:carry-${k + 1}` : null;
      })
      .filter((t): t is string => t !== null);
    if (tasks.length === 0) needs.push(`${label}: at least one task`);
    if (speed !== null && width !== null && tasks.length > 0) workers.push({ id: slug(label, workerIds), name: label, tasks: tasks as [string, ...string[]], walk_speed_m_s: entered(speed), width_m: entered(width) });
  });
  draft.stations.forEach((st, i) => {
    const label = st.objectId ? name(st.objectId) : `Station ${i + 1}`;
    if (!draft.workers.some((w) => w.tasks.includes(`transfer:${i}`))) needs.push(`Someone to carry items to ${label} (tick it for a worker)`);
    if ((number(st.workerS) ?? 0) > 0 && !draft.workers.some((w) => w.tasks.includes(`station:${i}`))) needs.push(`Someone to work at ${label} (tick it for a worker)`);
  });
  const start = clock(draft.shiftStart);
  if (start === null) needs.push("When the shift starts (hh:mm)");
  const hours = want(draft.shiftHours, "How long the shift lasts (hours)", (v) => v > 0 && v <= 24, "above 0 and at most 24 hours");
  const breaks: ShiftBreak[] = [];
  const breakIds = new Set<string>();
  draft.breaks.forEach((b, i) => {
    const label = b.name.trim() || `Break ${i + 1}`;
    const at = clock(b.start);
    const minutes = want(b.minutes, `${label}: how many minutes`, (v) => v > 0, "above 0");
    if (at === null) needs.push(`${label}: when it starts (hh:mm)`);
    if (at !== null && start !== null && minutes !== null && hours !== null) {
      const offset = (at - start + 86400) % 86400;
      if (offset + minutes * 60 > hours * 3600) needs.push(`${label} must end within the shift`);
      else breaks.push({ id: slug(label, breakIds), name: label, start_s: entered(offset), duration_s: entered(minutes * 60) });
    }
  });
  const seed = number(draft.seed);
  if (seed === null || !Number.isInteger(seed) || seed < 0) needs.push("A seed: a whole number (it only matters for unplanned stops)");
  if (needs.length > 0 || start === null || hours === null || supplyAccess === null) return { process: null, needs };
  const process: ProcessModel = {
    format: "rws-process/1",
    name: draft.name.trim() || `A day at ${project.name}`.slice(0, 500),
    item_name: draft.itemName.trim(),
    example_note: null,
    shift: { start_clock_s: entered(start), duration_s: entered(hours * 3600), breaks: breaks as ProcessModel["shift"]["breaks"] },
    stations: [
      { id: supplyId, object_id: draft.supplyObjectId, name: `${name(draft.supplyObjectId)} (material)`, role: "supply", access_m: supplyAccess, access_basis: "entered", worker_s: null, machine_s: null, input_capacity: null, output_capacity: null, planned_stops: [], random_stops: null },
      ...stations,
    ] as ProcessModel["stations"],
    transfers: transfers as ProcessModel["transfers"],
    workers: workers as ProcessModel["workers"],
    seed: seed!,
  };
  return { process, needs: [] };
}
