// The guided "Set up a day" (SIM-01): a manager picks stations in process order, says in plain
// words what travels between them, gives the pace and the number of people if they know them,
// and accepts or changes clearly labelled example assumptions for everything else. Nothing is
// read from the drawing as an operating fact: a value is either typed by the person ("entered")
// or an example they explicitly accepted ("example"). Where a worker stands is chosen as the
// first side of the object that is clear on the plan, and that choice is an example too.
import type { LocalPoint, OperatingValue, ProcessModel, Project, SceneObject } from "@replay-world/contracts";
import { footprint, inside, pointDistance, segmentDistance, type Vec } from "../checks/geometry";
import { checkInputs } from "../checks/inputs";
import { accessPoint, type RunPlan } from "./plan";
import { plural } from "./day";
import { type Side, sidePoint } from "./setup";

export interface GuidedStation {
  objectId: string;
  /** The station's name in the process (the object keeps its own name). */
  name: string;
}

export type PaceUnit = "s" | "min";

export interface GuidedDraft {
  stations: GuidedStation[];
  /** What travels between the stations, in the person's words. */
  item: string;
  /** Time for one item at each process station, as typed (by object id). */
  pace: Record<string, string>;
  paceUnit: PaceUnit;
  /** How many people work this process, as typed. */
  workers: string;
  /** Example assumptions the person changed: key → what they typed. */
  changes: Record<string, string>;
  /** Example assumptions the person explicitly accepted. */
  accepted: string[];
}

export const emptyGuided = (): GuidedDraft => ({ stations: [], item: "", pace: {}, paceUnit: "min", workers: "", changes: {}, accepted: [] });

export interface Assumption {
  key: string;
  group: "essential" | "details";
  label: string;
  /** The value used, in words with its unit. */
  shown: string;
  basis: "example" | "entered";
  /** For an example: whether the person accepted it. */
  accepted: boolean;
  /** What to show in the field when changing it. */
  input: string;
  unit: string;
  /** Choices for a value picked from a list (a side of the object). */
  choices?: string[];
}

export interface Guided {
  process: ProcessModel | null;
  /** What has to be done before any example can stand in: in plain words. */
  needs: string[];
  assumptions: Assumption[];
  /** Examples not yet accepted: Run stays off until there are none. */
  unaccepted: Assumption[];
  counts: { entered: number; examples: number };
}

/** The examples offered for anything not answered. Illustrative, never a claim about a site. */
export const EXAMPLES = {
  item: "item",
  paceS: 120,
  queue: 2,
  ready: 2,
  carryWidth: 0.6,
  carryClear: 0.1,
  carrySpeed: 1.0,
  handling: 10,
  walkSpeed: 1.2,
  walkWidth: 0.8,
  /** Beyond half the path's width, between the object and where a worker stands (m). */
  access: 0.05,
  shiftStart: "06:00",
  shiftHours: 8,
  breaks: "09:00 15; 12:00 30",
} as const;

const SIDES: Side[] = ["front", "back", "left", "right"];

const number = (text: string | undefined): number | null => {
  const t = (text ?? "").trim().replace(",", ".");
  if (t === "") return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
};

const clock = (text: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? Number(m[1]) * 3600 + Number(m[2]) * 60 : null;
};

const slug = (text: string, used: Set<string>): string => {
  const base = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "station";
  let id = base;
  for (let i = 2; used.has(id); i++) id = `${base}-${i}`;
  used.add(id);
  return id;
};

const secondsText = (s: number) => (s >= 60 && s % 60 === 0 ? `${s / 60} min` : `${s} s`);

/** Objects that can be stations: equipment and structures standing on the floor. */
export function candidates(project: Project): SceneObject[] {
  const inputs = checkInputs(project);
  const floorId = inputs?.source.drawing.review.floor.object_id;
  return project.scene.objects.filter((o) => o.id !== floorId && (o.kind === "equipment" || o.kind === "structure") && o.dimensions.height.value_m > 0.05);
}

/** A name shared with other objects, or a layer name with a number ("Fixtures 5" among
 * "Fixtures 1..7"), does not say which object it is: such a station needs its own name. */
export function ambiguous(project: Project, objectId: string, name: string): string | null {
  const object = project.scene.objects.find((o) => o.id === objectId);
  if (!object || name.trim() !== object.name) return null;
  const others = project.scene.objects.filter((o) => o.id !== objectId);
  if (others.some((o) => o.name === object.name)) return `${object.name} shares its name with another object`;
  const base = /^(.*\S)\s+\d+$/.exec(object.name)?.[1];
  if (base && others.some((o) => o.name.startsWith(`${base} `) && /\d+$/.test(o.name))) return `several objects are called “${base} …”`;
  return null;
}

/** The first side of the object where a worker fits, clear of other objects, keep-clear zones
 * and the drawing's loose lines, inside the floor; null when no side is clear. */
export function clearSide(project: Project, object: SceneObject, corridorM: number, clearanceM: number): { side: Side; point: LocalPoint } | null {
  const inputs = checkInputs(project);
  if (!inputs?.floor) return null;
  const half = corridorM / 2;
  const others: Vec[][] = [...inputs.obstacles, ...inputs.zones].filter((s) => s.id !== object.id).map((s) => s.poly);
  const lines = inputs.uncertain.map((u) => u.points);
  for (const side of SIDES) {
    const local = sidePoint(object, side, clearanceM);
    const at = accessPoint(object, local);
    if (!inside(at, inputs.floor.poly)) continue;
    const floorEdge = Math.min(...inputs.floor.poly.map((p, i) => segmentDistance(at, p, inputs.floor!.poly[(i + 1) % inputs.floor!.poly.length]!)));
    if (floorEdge < half) continue;
    if (pointDistance(at, footprint(object)) < clearanceM - 1e-6) continue;
    if (others.some((poly) => pointDistance(at, poly) < half)) continue;
    if (lines.some((pts) => pts.slice(1).some((p, i) => segmentDistance(at, pts[i]!, p) < half))) continue;
    return { side, point: local };
  }
  return null;
}

/** Who does what, by an example rule: with as many people as stations, each works one station
 * and carries items into it; with fewer, stations are shared in turn; extra people carry. Each
 * person's work further down the line comes first, so finished items do not pile up. */
export function assignWorkers(stations: number, people: number): number[][] {
  const owned: number[][] = Array.from({ length: people }, () => []);
  for (let s = 1; s <= stations; s++) owned[(s - 1) % people]!.push(s);
  return owned;
}

export function buildGuided(project: Project, draft: GuidedDraft): Guided {
  const needs: string[] = [];
  const assumptions: Assumption[] = [];
  const objects = new Map(project.scene.objects.map((o) => [o.id, o]));
  const accepted = new Set(draft.accepted);
  const unit = draft.paceUnit === "min" ? 60 : 1;

  /** A value: what the person typed (entered), or the example (until they change it). */
  const value = (key: string, group: Assumption["group"], label: string, example: number, unitText: string, typed?: string, format: (v: number) => string = (v) => `${v} ${unitText}`): number | null => {
    const text = typed ?? draft.changes[key];
    if (text !== undefined && text.trim() !== "") {
      const v = number(text);
      if (v === null || v < 0) {
        needs.push(`${label}: “${text.trim()}” is not a number`);
        return null;
      }
      assumptions.push({ key, group, label, shown: format(v), basis: "entered", accepted: true, input: text, unit: unitText });
      return v;
    }
    assumptions.push({ key, group, label, shown: format(example), basis: "example", accepted: accepted.has(key), input: String(example), unit: unitText });
    return example;
  };
  const textValue = (key: string, group: Assumption["group"], label: string, example: string, typed: string, shown: (v: string) => string = (v) => v): string => {
    if (typed.trim() !== "") {
      assumptions.push({ key, group, label, shown: shown(typed.trim()), basis: "entered", accepted: true, input: typed, unit: "" });
      return typed.trim();
    }
    assumptions.push({ key, group, label, shown: shown(example), basis: "example", accepted: accepted.has(key), input: example, unit: "" });
    return example;
  };

  // 1. Stations, in order: they have to exist and be named so that each says which object it is.
  if (draft.stations.length < 2) needs.push(draft.stations.length === 0 ? "Choose the stations in process order: first where material comes from, then each step" : "Add at least one station after where material comes from");
  const names = new Map<string, number>();
  draft.stations.forEach((s) => names.set(s.name.trim().toLowerCase(), (names.get(s.name.trim().toLowerCase()) ?? 0) + 1));
  draft.stations.forEach((s, i) => {
    if (!objects.has(s.objectId)) needs.push(`Station ${i + 1} (${s.name || s.objectId}) is no longer in the layout: remove it or choose its object again`);
    if (s.name.trim() === "") needs.push(`Station ${i + 1}: give it a name`);
    else if ((names.get(s.name.trim().toLowerCase()) ?? 0) > 1) needs.push(`Two stations are called “${s.name.trim()}”: give each its own name`);
    const why = ambiguous(project, s.objectId, s.name);
    if (why) needs.push(`Rename station ${i + 1} (“${s.name}”): ${why}, so the name would not say which one it is`);
    if (draft.stations.findIndex((o) => o.objectId === s.objectId) !== i) needs.push(`${s.name} is in the list twice: each step is at its own object`);
  });

  // 2. What travels, and the essentials: pace at each step and how many people.
  const item = textValue("item", "essential", "What moves between the stations", EXAMPLES.item, draft.item, (v) => `${v} (carried by hand)`);
  const processStations = draft.stations.slice(1);
  const pace = processStations.map((s) => value(`pace:${s.objectId}`, "essential", `${s.name}: time for one ${item}`, EXAMPLES.paceS / unit, draft.paceUnit === "min" ? "min" : "s", draft.pace[s.objectId], (v) => secondsText(Math.round(v * unit))));
  const people = value("workers", "essential", "People working this process", Math.max(processStations.length, 1), "people", draft.workers, (v) => `${v} ${v === 1 ? "person" : "people"}`);
  if (people !== null && (people < 1 || !Number.isInteger(people))) needs.push("People working this process: a whole number, at least 1");

  // 3. Everything else, under Review assumptions.
  const first = draft.stations[0];
  if (first) assumptions.push({ key: "supply", group: "details", label: `Material is always available at ${first.name}`, shown: "always available", basis: "example", accepted: accepted.has("supply"), input: "", unit: "" });
  const carryWidth = value("carry-width", "details", `Width of a ${item} being carried`, EXAMPLES.carryWidth, "m");
  const carryClear = value("carry-clear", "details", "Room kept clear on each side when carrying", EXAMPLES.carryClear, "m");
  const carrySpeed = value("carry-speed", "details", "Carrying speed", EXAMPLES.carrySpeed, "m/s");
  const handling = value("carry-handling", "details", "Time to pick up, and again to set down", EXAMPLES.handling, "s");
  const walkSpeed = value("walk-speed", "details", "Walking speed with empty hands", EXAMPLES.walkSpeed, "m/s");
  const walkWidth = value("walk-width", "details", "Path a person needs with empty hands", EXAMPLES.walkWidth, "m");
  const corridor = Math.max((carryWidth ?? 0) + 2 * (carryClear ?? 0), walkWidth ?? 0);
  const access = draft.stations.map((s) => {
    const object = objects.get(s.objectId);
    if (!object) return null;
    const key = `access:${s.objectId}`;
    const typed = draft.changes[key];
    if (typed && SIDES.includes(typed as Side)) {
      const point = sidePoint(object, typed as Side, EXAMPLES.access + corridor / 2);
      assumptions.push({ key, group: "details", label: `Where a worker stands at ${s.name}`, shown: `${typed} side`, basis: "entered", accepted: true, input: typed, unit: "", choices: SIDES });
      return point;
    }
    const clear = clearSide(project, object, corridor, EXAMPLES.access + corridor / 2);
    if (!clear) {
      needs.push(`${s.name}: no side of it is clear for a ${corridor.toFixed(2)} m path on the plan; choose a side under Review assumptions, or move what stands around it`);
      assumptions.push({ key, group: "details", label: `Where a worker stands at ${s.name}`, shown: "no clear side found", basis: "example", accepted: false, input: "front", unit: "", choices: SIDES });
      return null;
    }
    assumptions.push({ key, group: "details", label: `Where a worker stands at ${s.name}`, shown: `${clear.side} side (the first side clear on the plan)`, basis: "example", accepted: accepted.has(key), input: clear.side, unit: "", choices: SIDES });
    return clear.point;
  });
  const attended = processStations.map((s, i) => value(`attended:${s.objectId}`, "details", `${s.name}: time a worker is needed (the rest runs on its own)`, pace[i] !== null ? Math.round(pace[i]! * unit) : EXAMPLES.paceS, "s", undefined, (v) => (pace[i] !== null && v >= Math.round(pace[i]! * unit) ? `the whole time (${secondsText(v)})` : secondsText(v))));
  const queue = processStations.map((s) => value(`queue:${s.objectId}`, "details", `${s.name}: ${plural(item)} that can queue in front`, EXAMPLES.queue, plural(item)));
  const ready = processStations.slice(0, -1).map((s) => value(`ready:${s.objectId}`, "details", `${s.name}: finished ${plural(item)} that can wait beside it`, EXAMPLES.ready, plural(item)));
  const shiftStart = textValue("shift-start", "details", "Shift starts at", EXAMPLES.shiftStart, draft.changes["shift-start"] ?? "");
  const shiftHours = value("shift-hours", "details", "Shift length", EXAMPLES.shiftHours, "h");
  const breaksText = textValue("breaks", "details", "Breaks (start and minutes, for everyone)", EXAMPLES.breaks, draft.changes["breaks"] ?? "", (v) => v.split(";").map((b) => b.trim().replace(/\s+(\d+)$/, " for $1 min")).join(", "));
  const owners = people !== null && people >= 1 && Number.isInteger(people) ? assignWorkers(processStations.length, people) : [];
  if (owners.length > 0 && processStations.length > 0) {
    const words = owners.map((own, k) => (own.length ? `person ${k + 1}: ${own.map((s) => draft.stations[s]!.name).join(", ")} (and carrying into ${own.length === 1 ? "it" : "them"})` : `person ${k + 1}: carrying`)).join("; ");
    assumptions.push({ key: "assign", group: "details", label: "Who does what", shown: words, basis: "example", accepted: accepted.has("assign"), input: "", unit: "" });
  }

  // Values are checked for sense only once they are numbers.
  pace.forEach((v, i) => v !== null && v <= 0 && needs.push(`${processStations[i]!.name}: the time for one ${item} must be above 0`));
  for (const [v, what] of [[carrySpeed, "Carrying speed"], [walkSpeed, "Walking speed"], [carryWidth, `Width of a ${item}`], [walkWidth, "Path a person needs"], [shiftHours, "Shift length"]] as const) {
    if (v !== null && v <= 0) needs.push(`${what} must be above 0`);
  }
  if (shiftHours !== null && shiftHours > 24) needs.push("Shift length: at most 24 h");
  const start = clock(shiftStart);
  if (start === null) needs.push(`Shift starts at: “${shiftStart}” is not a time (hh:mm)`);
  [...queue, ...ready].forEach((v) => v !== null && (v < 1 || !Number.isInteger(v)) && needs.push("Queues and waiting places hold a whole number of items, at least 1"));
  const breaks = breaksText
    .split(";")
    .map((b) => b.trim())
    .filter(Boolean)
    .map((b, i) => {
      const m = /^(\d{1,2}:\d{2})\s+(\d+(?:[.,]\d+)?)$/.exec(b);
      const at = m ? clock(m[1]!) : null;
      if (!m || at === null || start === null || shiftHours === null) {
        if (start !== null) needs.push(`Breaks: write each as “hh:mm minutes”, separated by “;” (not “${b}”)`);
        return null;
      }
      const offset = (at - start + 86400) % 86400;
      const minutes = Number(m[2]!.replace(",", "."));
      if (offset + minutes * 60 > shiftHours * 3600) {
        needs.push(`The break at ${m[1]} must end within the shift`);
        return null;
      }
      return { id: `break-${i + 1}`, name: `Break ${m[1]}`, offset, minutes };
    });

  const unaccepted = assumptions.filter((a) => a.basis === "example" && !a.accepted);
  const counts = { entered: assumptions.filter((a) => a.basis === "entered").length, examples: assumptions.filter((a) => a.basis === "example").length };
  const basisOf = (key: string): "example" | "entered" => assumptions.find((a) => a.key === key)?.basis ?? "example";
  const ov = (v: number, key: string): OperatingValue => ({ value: v, basis: basisOf(key) });
  if (needs.length > 0 || pace.some((v) => v === null) || people === null || start === null || shiftHours === null || access.some((a) => a === null) || [carryWidth, carryClear, carrySpeed, handling, walkSpeed, walkWidth].some((v) => v === null) || [...queue, ...ready, ...attended].some((v) => v === null) || breaks.some((b) => b === null)) {
    return { process: null, needs, assumptions, unaccepted, counts };
  }

  const used = new Set<string>();
  const ids = draft.stations.map((s) => slug(s.name, used));
  const stations: ProcessModel["stations"][number][] = draft.stations.map((s, i) => {
    if (i === 0) return { id: ids[0]!, object_id: s.objectId, name: s.name.trim(), role: "supply", access_m: access[0]!, access_basis: basisOf(`access:${s.objectId}`), worker_s: null, machine_s: null, input_capacity: null, output_capacity: null, planned_stops: [], random_stops: null };
    const k = i - 1;
    const total = Math.round(pace[k]! * unit);
    const withWorker = Math.min(attended[k]!, total);
    const last = i === draft.stations.length - 1;
    return {
      id: ids[i]!,
      object_id: s.objectId,
      name: s.name.trim(),
      role: "process",
      access_m: access[i]!,
      access_basis: basisOf(`access:${s.objectId}`),
      // A worker needed the whole time (the example) makes the time with a worker the pace itself,
      // with the pace's basis; the split is then the example. A typed split keeps its own basis.
      worker_s: basisOf(`attended:${s.objectId}`) === "entered" ? ov(withWorker, `attended:${s.objectId}`) : ov(withWorker, `pace:${s.objectId}`),
      machine_s: basisOf(`attended:${s.objectId}`) === "entered" ? ov(total - withWorker, `pace:${s.objectId}`) : ov(total - withWorker, `attended:${s.objectId}`),
      input_capacity: ov(queue[k]!, `queue:${s.objectId}`),
      output_capacity: last ? ov(1, `queue:${s.objectId}`) : ov(ready[k]!, `ready:${s.objectId}`),
      planned_stops: [],
      random_stops: null,
    };
  });
  const transfers = draft.stations.slice(1).map((_, k) => ({
    id: `carry-${k + 1}`,
    from_station: ids[k]!,
    to_station: ids[k + 1]!,
    method: "carry" as const,
    item_width_m: ov(carryWidth!, "carry-width"),
    allowance_m: ov(carryClear!, "carry-clear"),
    speed_m_s: ov(carrySpeed!, "carry-speed"),
    handling_s: ov(handling!, "carry-handling"),
  }));
  const workers = owners.map((own, k) => {
    const tasks = own.length ? [...own].reverse().flatMap((s) => [`transfer:carry-${s}`, `station:${ids[s]}`]) : transfers.map((t) => `transfer:${t.id}`);
    return { id: `person-${k + 1}`, name: `Person ${k + 1}`, tasks: tasks as [string, ...string[]], walk_speed_m_s: ov(walkSpeed!, "walk-speed"), width_m: ov(walkWidth!, "walk-width") };
  });
  const process: ProcessModel = {
    format: "rws-process/1",
    name: `A day: ${draft.stations.map((s) => s.name.trim()).join(" → ")}`.slice(0, 500),
    item_name: item,
    example_note: null,
    shift: {
      start_clock_s: { value: start, basis: basisOf("shift-start") },
      duration_s: ov(shiftHours * 3600, "shift-hours"),
      breaks: breaks.map((b) => ({ id: b!.id, name: b!.name, start_s: { value: b!.offset, basis: basisOf("breaks") }, duration_s: { value: b!.minutes * 60, basis: basisOf("breaks") } })) as ProcessModel["shift"]["breaks"],
    },
    stations: stations as ProcessModel["stations"],
    transfers: transfers as ProcessModel["transfers"],
    workers: workers as ProcessModel["workers"],
    seed: 1,
  };
  return { process, needs, assumptions, unaccepted, counts };
}

/** What to correct for each move the run needs that is not clear, in plain words. */
export function corrections(plan: RunPlan): string[] {
  return plan.routes
    .filter((r) => r.outcome !== "fits")
    .map((r) => {
      const a = plan.locations[r.from]!.name;
      const b = plan.locations[r.to]!.name;
      const what = `${a} ↔ ${b} (${r.corridorM.toFixed(2)} m path, for ${r.uses.join(", ")})`;
      const inside = /(start|destination) point is inside (.+?),/.exec(r.summary);
      if (inside) {
        const station = inside[1] === "start" ? a : b;
        return `${what}: where a worker stands at ${station} is inside ${inside[2]}. Choose another side for ${station} under Review assumptions, or move ${inside[2]}.`;
      }
      const end = /(?:Blocked at the|the) (start|destination) point is/.exec(r.summary);
      if (end) {
        const station = end[1] === "start" ? a : b;
        return `${what}: ${r.summary} Choose another side for ${station} under Review assumptions, or move what stands next to it.`;
      }
      if (r.outcome === "conflict") return `${what}: ${r.summary} Move one of the objects named to widen the gap, or carry something narrower (Review assumptions).`;
      return `${what}: ${r.summary} The run cannot use this route until it is resolved; nothing is assumed to pass.`;
    });
}

/** A guided draft from a process already set up (to change it): stations, what moves, and the
 * values that were typed; examples are offered again and need accepting again. */
export function guidedFrom(process: ProcessModel): GuidedDraft {
  const [, ...steps] = process.stations;
  const pace: Record<string, string> = {};
  for (const s of steps) {
    if (s.worker_s?.basis === "entered" || s.machine_s?.basis === "entered") pace[s.object_id] = String(((s.worker_s?.value ?? 0) + (s.machine_s?.value ?? 0)) / 60);
  }
  return {
    stations: process.stations.map((s) => ({ objectId: s.object_id, name: s.name })),
    item: process.item_name === EXAMPLES.item ? "" : process.item_name,
    pace,
    paceUnit: "min",
    workers: "",
    changes: {},
    accepted: [],
  };
}
