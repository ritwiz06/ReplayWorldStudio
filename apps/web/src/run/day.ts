// "Run a day" as the screen uses it (SIM-03/04): one run of the project's process on a layout,
// identified by the engine, the seed, the scene revision, and fingerprints of the process and of
// the event log; and the comparison of the original layout's run with the edited one's, with the
// same process and seed (paired assumptions). Every sentence of the explanation is computed from
// the two runs and their routes: nothing is claimed that the runs do not show.
import type { ProcessModel, Project } from "@replay-world/contracts";
import { asDrawn } from "../checks/arrangement";
import { ENGINE_VERSION, fingerprint, type RunResult, simulate } from "./engine";
import { planRun, type RouteUse, type RunPlan } from "./plan";
import { Replay } from "./replay";

export interface DayRun {
  layout: "original" | "edited";
  engine: string;
  seed: number;
  sceneRevision: number;
  processFingerprint: string;
  plan: RunPlan;
  result: RunResult | null;
  replay: Replay | null;
}

export function runDay(project: Project, process: ProcessModel, layout: DayRun["layout"]): DayRun {
  const plan = planRun(project, process);
  const result = plan.input ? simulate(plan.input) : null;
  return {
    layout,
    engine: ENGINE_VERSION,
    seed: process.seed,
    sceneRevision: project.scene.revision,
    processFingerprint: fingerprint(JSON.stringify(process)),
    plan,
    result,
    replay: result ? new Replay(result, plan, process.shift.start_clock_s.value, process.item_name) : null,
  };
}

/** The same process on the drawing's own arrangement, or null without a reviewed drawing. */
export function runOriginal(project: Project, process: ProcessModel): DayRun | null {
  const original = asDrawn(project);
  return original ? runDay(original, process, "original") : null;
}

export interface CompareRow {
  label: string;
  before: string;
  after: string;
  change: string;
  worse: boolean | null;
}

export interface DayComparison {
  rows: CompareRow[];
  explanation: string[];
  identical: boolean;
}

/** "batch" → "batches", "tray" → "trays", "box" → "boxes". */
export const plural = (word: string) => (/(s|x|z|ch|sh)$/.test(word) ? `${word}es` : /[^aeiou]y$/.test(word) ? `${word.slice(0, -1)}ies` : `${word}s`);

const pct = (v: number) => `${Math.round(v * 100)} %`;
const signed = (v: number, digits = 0) => `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v).toFixed(digits)}`;

const routeName = (plan: RunPlan, r: RouteUse) => `${plan.locations[r.from]!.name} ↔ ${plan.locations[r.to]!.name}`;

export function compareDays(a: DayRun, b: DayRun, process: ProcessModel): DayComparison {
  const item = process.item_name;
  const explanation: string[] = [];
  const rows: CompareRow[] = [];
  const ra = a.result;
  const rb = b.result;
  if (!ra || !rb) {
    const which = !rb ? b : a;
    explanation.push(`The ${which.layout} layout's run cannot be compared: ${which.plan.reasons.join("; ")}.`);
    return { rows, explanation, identical: false };
  }
  const ma = ra.metrics;
  const mb = rb.metrics;
  const row = (label: string, x: number, y: number, higherIsWorse: boolean | null, format: (v: number) => string = (v) => String(v)) =>
    rows.push({ label, before: format(x), after: format(y), change: x === y ? "same" : signed(y - x), worse: x === y || higherIsWorse === null ? null : higherIsWorse ? y > x : y < x });
  row(`Completed ${plural(item)}`, ma.completed, mb.completed, false);
  row(`Unfinished at the shift end`, ma.unfinished, mb.unfinished, true);
  for (const sa of ma.stations) {
    const sb = mb.stations.find((s) => s.id === sa.id);
    if (!sb) continue;
    rows.push({
      label: `${sa.name}: busy`,
      before: pct(sa.share.loading + sa.share.running),
      after: pct(sb.share.loading + sb.share.running),
      change: `${signed(Math.round((sb.share.loading + sb.share.running) * 100) - Math.round((sa.share.loading + sa.share.running) * 100))} pts`,
      worse: null,
    });
    rows.push({ label: `${sa.name}: longest queue`, before: String(sa.inputMax), after: String(sb.inputMax), change: sa.inputMax === sb.inputMax ? "same" : signed(sb.inputMax - sa.inputMax), worse: sb.inputMax === sa.inputMax ? null : sb.inputMax > sa.inputMax });
    if (sa.share.blocked > 0.005 || sb.share.blocked > 0.005) {
      rows.push({ label: `${sa.name}: blocked`, before: pct(sa.share.blocked), after: pct(sb.share.blocked), change: `${signed(Math.round(sb.share.blocked * 100) - Math.round(sa.share.blocked * 100))} pts`, worse: sb.share.blocked > sa.share.blocked });
    }
  }
  for (const wa of ma.workers) {
    const wb = mb.workers.find((w) => w.id === wa.id);
    if (!wb) continue;
    const active = (w: typeof wa) => w.share.working + w.share.carrying + w.share.walking;
    rows.push({ label: `${wa.name}: working, carrying or walking`, before: pct(active(wa)), after: pct(active(wb)), change: `${signed(Math.round(active(wb) * 100) - Math.round(active(wa) * 100))} pts`, worse: null });
  }

  if (ra.fingerprint === rb.fingerprint) {
    explanation.push(`The two runs are identical (same events, fingerprint ${ra.fingerprint}): no route the process uses changed, and moving equipment alone does not change the result under these assumptions.`);
    return { rows, explanation, identical: true };
  }
  // Routes: blocked or changed in length.
  for (const r of b.plan.routes) {
    const before = a.plan.routes.find((x) => x.from === r.from && x.to === r.to && Math.abs(x.corridorM - r.corridorM) < 1e-9);
    if (r.outcome === "conflict" && before?.outcome !== "conflict") {
      explanation.push(`${routeName(b.plan, r)} is blocked in the edited layout (${r.summary.replace(/\.$/, "")}). It is needed for ${r.uses.join(" and ")}, so that cannot happen; nothing is moved through equipment.`);
    } else if (r.outcome === "fits" && before?.outcome === "conflict") {
      explanation.push(`${routeName(b.plan, r)} was blocked in the original layout and is clear now.`);
    } else if (r.lengthM !== null && before?.lengthM !== null && before?.lengthM !== undefined && Math.abs(r.lengthM - before.lengthM) >= 0.05) {
      const carry = process.transfers.find((t) => Math.abs(t.item_width_m.value + 2 * t.allowance_m.value - r.corridorM) < 1e-9 && r.uses.some((u) => u.startsWith("carrying")));
      const speed = carry ? carry.speed_m_s.value : (process.workers.find((w) => Math.abs(w.width_m.value - r.corridorM) < 1e-9)?.walk_speed_m_s.value ?? 1);
      const seconds = (r.lengthM - before.lengthM) / speed;
      explanation.push(
        `${routeName(b.plan, r)} is ${before.lengthM.toFixed(1)} m in the original layout and ${r.lengthM.toFixed(1)} m now (${signed(r.lengthM - before.lengthM, 1)} m): about ${Math.abs(seconds).toFixed(0)} s ${seconds > 0 ? "more" : "less"} each way at the entered ${speed.toFixed(1)} m/s.`,
      );
    }
  }
  const dc = mb.completed - ma.completed;
  explanation.push(dc === 0 ? `Output is the same: ${ma.completed} ${plural(item)} completed in both runs.` : `Output goes from ${ma.completed} to ${mb.completed} completed ${plural(item)} (${signed(dc)}).`);
  if (dc !== 0 && b.plan.outcome !== "blocked") {
    const busiest = mb.stations.find((s) => s.name === mb.busiest);
    if (busiest) explanation.push(`${busiest.name} is the busiest station in the edited run (${pct(busiest.share.loading + busiest.share.running)} of the shift loading or running), so it sets the pace; the difference comes only from the route lengths above and how the workers' time is shared.`);
  } else if (dc === 0 && b.plan.outcome !== "blocked") {
    const busiest = mb.stations.find((s) => s.name === mb.busiest);
    if (busiest) explanation.push(`${busiest.name} sets the pace (${pct(busiest.share.loading + busiest.share.running)} busy), so the changed walking only changes how the workers' time is spent.`);
  }
  return { rows, explanation, identical: false };
}
