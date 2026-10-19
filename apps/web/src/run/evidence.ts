// Evidence bundles (REL-01): what "Export this run" writes, and the check that a bundle's runs
// come out the same when they are run again. The event logs are the engine's own (rws-run/1),
// unchanged; nothing here makes or edits an event. The manifest says what each number rests on:
// layout evidence (the drawing and its review) is kept apart from operating values, each of
// which is marked as an example assumption or a value someone entered. Exporting reads the
// project; it never changes it.
import type {
  EvidenceAsset,
  EvidenceBundleRequest,
  EvidenceComparison,
  EvidenceExcluded,
  EvidenceInput,
  EvidenceManifest,
  EvidenceRun,
  EvidenceText,
  ProcessModel,
  Project,
} from "@replay-world/contracts";
import { SCHEMA_VERSION } from "@replay-world/contracts";
import { asDrawn } from "../checks/arrangement";
import { compareWithDrawing } from "../drawing/compare";
import { SAMPLE_PROJECT_ID } from "../drawing/sampleProject";
import { drawingSource } from "../drawing/world";
import { serializeProject } from "../editing/projectFile";
import { compareDays, type DayComparison, type DayRun, plural, runDay, runOriginal } from "./day";
import { ENGINE_VERSION, fingerprint } from "./engine";
import { clockText } from "./replay";
import { SCOPE } from "./words";

export const EVIDENCE_FORMAT = "rws-evidence/1";
export const PROJECT_FILE = "project.json";

/** Identifies an arrangement: the fingerprint of its scene objects as stored. */
export const layoutFingerprint = (project: Project) => fingerprint(JSON.stringify(project.scene.objects));

/** The runs a bundle holds: the original layout's, and the edited one's when the layout differs
 * from the drawing. Without a drawing there is only the layout as it is. */
export function bundleRuns(project: Project, current: DayRun, edited: boolean, original: DayRun | null): DayRun[] {
  const process = project.process!;
  const base = original ?? runOriginal(project, process);
  if (!base) return [current];
  return edited ? [base, current] : [base];
}

const layoutOf = (project: Project, run: DayRun) => (run.layout === "original" ? (asDrawn(project) ?? project) : project);

/** Every operating value of the process, with its unit and basis. */
export function operatingInputs(process: ProcessModel): EvidenceInput[] {
  const out: EvidenceInput[] = [];
  const add = (path: string, label: string, v: { value: number; basis: "example" | "entered" } | null | undefined, unit: string) => {
    if (v) out.push({ path, label, value: v.value, unit, detail: null, basis: v.basis });
  };
  const sh = process.shift;
  add("shift.start_clock_s", "Shift start (seconds after midnight)", sh.start_clock_s, "s");
  add("shift.duration_s", "Shift length", sh.duration_s, "s");
  sh.breaks.forEach((b, i) => {
    add(`shift.breaks[${i}].start_s`, `${b.name}: starts after the shift start`, b.start_s, "s");
    add(`shift.breaks[${i}].duration_s`, `${b.name}: length`, b.duration_s, "s");
  });
  process.stations.forEach((s, i) => {
    out.push({
      path: `stations[${i}].access_m`,
      label: `${s.name}: where a worker stands`,
      value: null,
      unit: "m in the object's frame",
      detail: `x ${s.access_m.x.toFixed(2)} m, z ${s.access_m.z.toFixed(2)} m from the object's centre${s.role === "supply" ? "; material is always available here" : ""}`,
      basis: s.access_basis,
    });
    add(`stations[${i}].worker_s`, `${s.name}: time with a worker`, s.worker_s, "s");
    add(`stations[${i}].machine_s`, `${s.name}: time on its own`, s.machine_s, "s");
    add(`stations[${i}].input_capacity`, `${s.name}: queue (input) places`, s.input_capacity, "items");
    add(`stations[${i}].output_capacity`, `${s.name}: output places`, s.output_capacity, "items");
    s.planned_stops.forEach((p, j) => {
      add(`stations[${i}].planned_stops[${j}].start_s`, `${s.name}: ${p.reason} starts after the shift start`, p.start_s, "s");
      add(`stations[${i}].planned_stops[${j}].duration_s`, `${s.name}: ${p.reason} length`, p.duration_s, "s");
    });
    if (s.random_stops) {
      add(`stations[${i}].random_stops.mean_between_s`, `${s.name}: mean time between unplanned stops`, s.random_stops.mean_between_s, "s");
      add(`stations[${i}].random_stops.mean_duration_s`, `${s.name}: mean unplanned stop length`, s.random_stops.mean_duration_s, "s");
    }
  });
  const name = new Map(process.stations.map((s) => [s.id, s.name]));
  process.transfers.forEach((t, i) => {
    const label = `Carry ${name.get(t.from_station)} → ${name.get(t.to_station)}`;
    add(`transfers[${i}].item_width_m`, `${label}: item width`, t.item_width_m, "m");
    add(`transfers[${i}].allowance_m`, `${label}: clearance each side`, t.allowance_m, "m");
    add(`transfers[${i}].speed_m_s`, `${label}: speed`, t.speed_m_s, "m/s");
    add(`transfers[${i}].handling_s`, `${label}: pick up, and again set down`, t.handling_s, "s");
  });
  process.workers.forEach((w, i) => {
    add(`workers[${i}].walk_speed_m_s`, `${w.name}: walking speed`, w.walk_speed_m_s, "m/s");
    add(`workers[${i}].width_m`, `${w.name}: walking width`, w.width_m, "m");
  });
  return out;
}

/** What the drawing and its review established, in words: the layout evidence. */
export function layoutEvidence(project: Project): string[] {
  const source = drawingSource(project);
  if (!source) return ["No reviewed drawing: the layout is the scene as built in the app."];
  const review = source.drawing.review;
  const lines = [
    `The layout was read from ${source.filename} (${source.kind.toUpperCase()}, sha256 ${source.sha256?.slice(0, 12)}…) and reviewed in the app: floor ${review.floor.choice} (${review.floor.status}), scale ${review.scale.status}, ${review.objects.length} drawn outlines reviewed${review.symbol_layers.length ? `, layers marked as drawing symbols: ${review.symbol_layers.join(", ")}` : ""}.`,
    "A drawing shows a design: the intended arrangement and sizes, as reviewed. It is not a survey of a built site, and nothing here was measured on one.",
  ];
  if (project.id === SAMPLE_PROJECT_ID) lines.push("The drawing is a synthetic example made for this repository (fixtures/drawings/layout-checks-mm.dxf); it describes no real hall.");
  const changed = compareWithDrawing(project)?.changes.filter((c) => c.status !== "unchanged") ?? [];
  lines.push(changed.length ? `The edited layout differs from the drawing: ${changed.map((c) => `${c.label} ${c.what.join(", ")}`).join("; ")}.` : "The layout is as drawn.");
  return lines;
}

const CONVENTIONS = [
  "Event times (t) and durations (ms) are whole milliseconds from the shift start; a clock time is the shift start plus t. Operating inputs are in the units listed with them (seconds, metres, metres per second, items).",
  "Each events.json lists the events exactly as the engine produced them, in the order it processed them: by time, then in the order they were scheduled. Ties at the same millisecond keep that order.",
  "Numbers in an event (worker, station, transfer, from, to) are positions in the tables of the same events.json (workers, stations, transfers, locations). Item numbers count from 0 in the order items were created at the supply.",
  "Anything at or after the shift end does not happen. An item counts as completed if its last step ends before the shift ends.",
  "Shares in metrics.json are fractions (0 to 1) of the shift. Route lengths are metres along the route the route check found.",
  "event_fingerprint: cyrb53 (53-bit) of the events array as compact JSON (JSON.stringify), 14 hex digits. process_fingerprint and layout_fingerprint: the same hash of the process, and of the layout's scene objects. Files are identified by sha256 in this manifest.",
];

const runPaths = (layout: DayRun["layout"]) => ({ events: `runs/${layout}/events.json`, metrics: `runs/${layout}/metrics.json` });

function eventsText(run: DayRun, process: ProcessModel): string {
  const input = run.plan.input;
  return `${JSON.stringify(
    {
      format: "rws-run-events/1",
      engine: run.engine,
      layout: run.layout,
      seed: run.seed,
      time_unit: "ms from the shift start",
      shift_start_clock: clockText(process.shift.start_clock_s.value, 0),
      event_fingerprint: run.result?.fingerprint ?? null,
      locations: input?.locations ?? [],
      stations: input?.stations.map((s, i) => ({ index: i, id: s.id, name: s.name, supply: s.supply })) ?? [],
      transfers: input?.transfers.map((t, i) => ({ index: i, id: t.id, name: t.name })) ?? [],
      workers: input?.workers.map((w, i) => ({ index: i, id: w.id, name: w.name })) ?? [],
      events: run.result?.events ?? [],
    },
    null,
    1,
  )}\n`;
}

function metricsText(run: DayRun): string {
  const plan = run.plan;
  return `${JSON.stringify(
    {
      format: "rws-run-metrics/1",
      engine: run.engine,
      layout: run.layout,
      outcome: plan.outcome,
      reasons: plan.reasons,
      routes: plan.routes.map((r) => ({
        from: plan.locations[r.from]?.name,
        to: plan.locations[r.to]?.name,
        corridor_m: r.corridorM,
        outcome: r.outcome,
        length_m: r.lengthM,
        summary: r.summary,
        uses: r.uses,
      })),
      metrics: run.result?.metrics ?? null,
    },
    null,
    2,
  )}\n`;
}

function evidenceRun(project: Project, run: DayRun, files: boolean): EvidenceRun {
  const m = run.result?.metrics ?? null;
  const paths = runPaths(run.layout);
  return {
    layout: run.layout,
    engine: run.engine,
    seed: run.seed,
    scene_revision: run.sceneRevision,
    layout_fingerprint: layoutFingerprint(layoutOf(project, run)),
    process_fingerprint: run.processFingerprint,
    outcome: run.plan.outcome,
    reasons: run.plan.reasons,
    event_fingerprint: run.result?.fingerprint ?? null,
    event_count: run.result?.events.length ?? 0,
    completed: m?.completed ?? null,
    created: m?.created ?? null,
    unfinished: m?.unfinished ?? null,
    events_file: files && run.result ? paths.events : null,
    metrics_file: files ? paths.metrics : null,
  };
}

const basisWords = (b: "example" | "entered", shipped: boolean) => (b === "entered" ? "entered" : shipped ? "example assumption" : "illustrative assumption, accepted");
const cell = (s: string) => s.replace(/\|/g, "\\|");

function summaryText(project: Project, manifest: EvidenceManifest, comparison: DayComparison | null): string {
  const process = project.process!;
  const shipped = process.example_note !== null;
  const item = process.item_name;
  const lines: string[] = [`# ${project.name}: ${manifest.runs.length === 2 ? "the same shift before and after a layout change" : "one shift"}`, ""];
  if (manifest.project.synthetic) lines.push("**Synthetic example.** The hall, its drawing and its shift are made up for this repository; nothing describes a real factory.", "");
  lines.push(`**Results under stated assumptions.** ${SCOPE}`, "");
  if (manifest.comparison) {
    lines.push("## What changed and what happened", "");
    for (const line of manifest.comparison.explanation) lines.push(`- ${line}`);
    lines.push("");
    if (comparison && comparison.rows.length) {
      lines.push("| | Original layout | Edited layout | Change |", "| --- | --- | --- | --- |");
      for (const r of comparison.rows) lines.push(`| ${cell(r.label)} | ${r.before} | ${r.after} | ${r.change} |`);
      lines.push("", "Both runs use the same process, seed and engine; only the layout differs.", "");
    }
  }
  lines.push("## Runs", "", `| Layout | Outcome | Completed ${plural(item)} | Unfinished | Events | Event fingerprint | Layout fingerprint |`, "| --- | --- | --- | --- | --- | --- | --- |");
  for (const r of manifest.runs) lines.push(`| ${r.layout} | ${r.outcome} | ${r.completed ?? "–"} | ${r.unfinished ?? "–"} | ${r.event_count} | ${r.event_fingerprint ?? "–"} | ${r.layout_fingerprint} |`);
  lines.push("", `Engine ${manifest.engine}, seed ${manifest.process.seed}, process fingerprint ${manifest.process.fingerprint}, contract ${manifest.schema_version}.`, "");
  for (const r of manifest.runs.filter((x) => x.reasons.length)) {
    lines.push(`**${r.layout === "original" ? "Original" : "Edited"} layout:**`, "");
    for (const reason of r.reasons) lines.push(`- ${reason}`);
    lines.push("");
  }
  lines.push("## Layout evidence (the drawing and its review)", "");
  for (const l of manifest.layout_evidence) lines.push(`- ${l}`);
  lines.push("", "## Operating inputs and their basis", "");
  if (process.example_note) lines.push(process.example_note, "");
  lines.push("| Input | Value | Basis |", "| --- | --- | --- |");
  for (const i of manifest.inputs) lines.push(`| ${cell(i.label)} | ${i.value === null ? cell(i.detail ?? "") : `${i.value} ${i.unit}`} | ${basisWords(i.basis, shipped)} |`);
  const counts = manifest.inputs.reduce((a, i) => ({ ...a, [i.basis]: a[i.basis] + 1 }), { example: 0, entered: 0 });
  lines.push("", `${counts.entered} entered, ${counts.example} ${shipped ? "example assumptions" : "illustrative assumptions accepted"}. Seed ${process.seed}: used only for unplanned stops, if any are entered.`, "");
  lines.push("## What this shows and does not show", "");
  for (const c of manifest.claims) lines.push(`- ${c}`);
  lines.push("");
  return `${lines.join("\n")}\n`;
}

const RECIPIENT_NEEDS =
  "a checkout of the Replay World Studio repository (git), Node.js 22.12 or newer with pnpm, and uv (it installs the Python version the repository names). No API key, account or network service is needed to open or rerun a bundle; installing needs the internet once.";

function readmeText(project: Project, manifest: EvidenceManifest): string {
  const files = manifest.files.length ? manifest.files : [];
  const lines = [
    `# Evidence bundle: ${project.name}`,
    "",
    `Made with Replay World Studio on ${manifest.created_utc} (UTC): contract ${manifest.schema_version}, engine ${manifest.engine}, seed ${manifest.process.seed}.`,
    "",
    manifest.project.synthetic ? "**Synthetic example. Results under stated assumptions.** " + SCOPE : "**Results under stated assumptions.** " + SCOPE,
    "",
    "## What is in it",
    "",
    "| File | What it is |",
    "| --- | --- |",
    "| README.md | This file. |",
    "| summary.md | The before/after summary in words: what changed, what happened and why, and what every number rests on. |",
    "| manifest.json | Every file with its sha256; contract and engine versions, seed, fingerprints of each layout, process and event log; the basis of every operating input. |",
  ];
  if (manifest.project.file) lines.push("| project.json | The project: the reviewed layout (as edited), the drawing reading, the process and the edit record. |");
  for (const r of manifest.runs) {
    if (r.events_file) lines.push(`| ${r.events_file} | The ${r.layout} layout's event log, as the engine produced it. |`);
    if (r.metrics_file) lines.push(`| ${r.metrics_file} | The ${r.layout} layout's routes and whole-shift results. |`);
  }
  for (const f of files.filter((x) => x.role === "source" || x.role === "model")) lines.push(`| ${f.path} | ${f.role === "model" ? "A model file" : "A source file"} the project names (${f.uri}). |`);
  lines.push("");
  if (manifest.excluded.length) {
    lines.push("## Not included", "");
    for (const e of manifest.excluded) lines.push(`- ${e.what}: ${e.reason}.`);
    lines.push("");
  }
  lines.push("## Open it and run it again", "");
  if (manifest.replay === "summary_only") {
    lines.push("This bundle is **summary only**: it holds no project file, so its runs cannot be rerun. The summary, the event logs and the metrics are as the app made them.", "");
  } else {
    lines.push(
      `You need ${RECIPIENT_NEEDS}`,
      "",
      "1. In the repository: `uv sync --locked`, `pnpm install --frozen-lockfile`, then `pnpm start`, and open the address it prints (http://127.0.0.1:8000 by default).",
      "2. **Open** (top bar), and choose this ZIP. The app checks every file against manifest.json and refuses a changed or damaged bundle.",
      "3. In the **Run** tab, press **Run both layouts again**. The app reruns each layout with the same process and seed, and compares the event logs, fingerprints, counts and explanation with the recorded ones.",
      "",
      manifest.replay === "full"
        ? "Everything the project names is in the bundle or part of the repository, so the runs and the plan drawing open as recorded."
        : "Some files the project names are not included (see above). The runs still replay from project.json, which holds the reviewed layout; the files left out cannot be shown or checked.",
      "",
    );
  }
  lines.push("## Conventions", "");
  for (const c of manifest.conventions) lines.push(`- ${c}`);
  lines.push("", "## What this shows and does not show", "");
  for (const c of manifest.claims) lines.push(`- ${c}`);
  lines.push("");
  return `${lines.join("\n")}\n`;
}

export interface ExportChoice {
  /** Asset URIs to include (sources and models). */
  include: string[];
  summaryOnly: boolean;
}

const EXCLUDED_REASON: Record<EvidenceAsset["status"], string> = {
  library: "your own file, not selected for this bundle",
  missing: "not on this computer",
  changed: "the file on this computer differs from the one the project records",
  repo_owned: "part of the repository, not selected",
};

/** The request that packages a bundle: its texts, the files to include and its manifest. */
export function buildEvidence(project: Project, runs: DayRun[], assets: EvidenceAsset[], choice: ExportChoice, now: Date = new Date()): EvidenceBundleRequest {
  const process = project.process;
  if (!process) throw new Error("The project has no process to export.");
  const include = choice.summaryOnly ? [] : assets.filter((a) => choice.include.includes(a.uri)).map((a) => a.uri);
  const excluded: EvidenceExcluded[] = choice.summaryOnly
    ? [{ what: "The project file", reason: "a summary-only bundle holds no project, so it cannot be rerun" }, ...assets.map((a) => ({ what: a.label, reason: "a summary-only bundle holds no source or model files" }))]
    : assets.filter((a) => !include.includes(a.uri)).map((a) => ({ what: a.label, reason: EXCLUDED_REASON[a.status] }));
  const replay: EvidenceManifest["replay"] = choice.summaryOnly ? "summary_only" : include.length === assets.length ? "full" : "runs_only";
  const pair = runs.length === 2 ? compareDays(runs[0]!, runs[1]!, process) : null;
  const comparison: EvidenceComparison | null = pair ? { identical: pair.identical, explanation: pair.explanation } : null;
  const synthetic = project.id === SAMPLE_PROJECT_ID;
  const manifest: EvidenceManifest = {
    format: EVIDENCE_FORMAT,
    created_utc: now.toISOString().replace(/\.\d{3}Z$/, "Z"),
    schema_version: SCHEMA_VERSION,
    engine: ENGINE_VERSION,
    project: {
      file: choice.summaryOnly ? null : PROJECT_FILE,
      id: project.id,
      name: project.name,
      synthetic,
      note: synthetic ? "Synthetic example: a made-up hall, drawing and shift for this repository." : null,
    },
    process: { name: process.name, fingerprint: fingerprint(JSON.stringify(process)), seed: process.seed, example_note: process.example_note },
    runs: runs.map((r) => evidenceRun(project, r, true)) as EvidenceManifest["runs"],
    comparison,
    inputs: operatingInputs(process),
    layout_evidence: layoutEvidence(project),
    claims: [
      "These are the results of a deterministic event model under the operating inputs listed; they are not measurements and do not predict real output.",
      "Inputs marked as example or illustrative assumptions were not measured or entered by anyone for a real site.",
      "Routes are width-only checks on the reviewed plan (no turning and no congestion between workers).",
      "It does not verify real productivity, worker safety, forces, structural strength, clearances or chemistry; equipment models are illustrations and their insides are not simulated.",
    ],
    conventions: CONVENTIONS,
    replay,
    files: [],
    excluded,
  };
  const texts: EvidenceText[] = [];
  if (!choice.summaryOnly) texts.push({ path: PROJECT_FILE, role: "project", text: serializeProject(project) });
  for (const run of runs) {
    const paths = runPaths(run.layout);
    if (run.result) texts.push({ path: paths.events, role: "events", text: eventsText(run, process) });
    texts.push({ path: paths.metrics, role: "metrics", text: metricsText(run) });
  }
  texts.push({ path: "summary.md", role: "summary", text: summaryText(project, manifest, pair) });
  // The README lists the asset files too, with the paths the API will give them.
  const assetFiles = include.map((uri) => {
    const a = assets.find((x) => x.uri === uri)!;
    return { path: `${a.kind === "model" ? "models" : "files"}/${uri}`, sha256: a.sha256 ?? "", bytes: a.bytes ?? 0, role: a.kind === "model" ? ("model" as const) : ("source" as const), uri };
  });
  texts.push({ path: "README.md", role: "readme", text: readmeText(project, { ...manifest, files: assetFiles }) });
  return { manifest, texts: texts as EvidenceBundleRequest["texts"], include };
}

/** `sample-factory-hall-run-0f3a….zip` */
export function bundleFileName(project: Project, runs: DayRun[]): string {
  const stem = project.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `${stem || "project"}-run-${runs.at(-1)?.result?.fingerprint ?? "none"}.zip`;
}

export interface ReproductionRow {
  layout: string;
  what: string;
  recorded: string;
  now: string;
  same: boolean;
}

export interface Reproduction {
  rows: ReproductionRow[];
  same: boolean;
  runs: DayRun[];
}

/** Run each recorded layout again with the bundle's project and compare with what was recorded. */
export function reproduce(project: Project, manifest: EvidenceManifest, recorded: Record<string, unknown[] | undefined>): Reproduction {
  const rows: ReproductionRow[] = [];
  const process = project.process;
  const row = (layout: string, what: string, a: unknown, b: unknown) => rows.push({ layout, what, recorded: String(a ?? "–"), now: String(b ?? "–"), same: a === b });
  if (!process) {
    rows.push({ layout: "–", what: "process", recorded: manifest.process.name, now: "none", same: false });
    return { rows, same: false, runs: [] };
  }
  row("both", "engine", manifest.engine, ENGINE_VERSION);
  row("both", "process fingerprint", manifest.process.fingerprint, fingerprint(JSON.stringify(process)));
  const runs: DayRun[] = [];
  for (const r of manifest.runs) {
    const run = r.layout === "original" ? runOriginal(project, process) : runDay(project, process, "edited");
    if (!run) {
      rows.push({ layout: r.layout, what: "run", recorded: r.outcome, now: "no reviewed drawing to run the original layout", same: false });
      continue;
    }
    runs.push(run);
    row(r.layout, "layout fingerprint", r.layout_fingerprint, layoutFingerprint(layoutOf(project, run)));
    row(r.layout, "outcome", r.outcome, run.plan.outcome);
    row(r.layout, "blocked or undetermined routes", r.reasons.join(" | ") || "none", run.plan.reasons.join(" | ") || "none");
    row(r.layout, "events", r.event_count, run.result?.events.length ?? 0);
    row(r.layout, "event fingerprint", r.event_fingerprint, run.result?.fingerprint ?? null);
    row(r.layout, `completed ${plural(process.item_name)}`, r.completed, run.result?.metrics.completed ?? null);
    row(r.layout, "unfinished", r.unfinished, run.result?.metrics.unfinished ?? null);
    const log = recorded[r.layout];
    if (log) {
      const now = run.result?.events ?? [];
      const first = log.findIndex((e, i) => JSON.stringify(e) !== JSON.stringify(now[i]));
      const same = log.length === now.length && first === -1;
      rows.push({ layout: r.layout, what: "event log, event by event", recorded: `${log.length} events`, now: same ? `${now.length} events, identical in order` : `differs from event ${first === -1 ? log.length : first}`, same });
    }
  }
  if (manifest.comparison && runs.length === 2) {
    const now = compareDays(runs[0]!, runs[1]!, process).explanation;
    rows.push({ layout: "both", what: "explanation", recorded: manifest.comparison.explanation.join(" "), now: now.join(" "), same: JSON.stringify(now) === JSON.stringify(manifest.comparison.explanation) });
  }
  return { rows, same: rows.every((r) => r.same), runs };
}
