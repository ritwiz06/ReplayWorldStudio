// IMG-03: score live answers against the annotations (rules: docs/assist-evaluation/img-03/criteria.md).
//
//   node scripts/assist/run-ts.mjs scripts/img03/score.ts --results results/qwen3-vl-32b-instruct.json \
//     [--results results/llama4-scout-17b.json] [--manual line-a,store-a,office-a,lounge-a] [--out scores.json]
//
// Paths are relative to docs/assist-evaluation/img-03. Writes the scores (JSON) and prints a short
// summary. Three worlds per photo, never mixed: the initial proposal (what the app pre-accepts),
// the idealised photo-only review, and (for the listed photos) the manual-only baseline.
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { ImageProposalResult } from "@replay-world/contracts";
import { footprint } from "../../src/photo/layoutChecks";
import {
  type Annotation,
  calibrate,
  distribution,
  geometryOf,
  type GeometryRow,
  gtFootprint,
  initialWorld,
  klmSeconds,
  labelAgrees,
  manualWorld,
  matchProposals,
  rectFrame,
  reviewedWorld,
  type World,
} from "../../src/photo/evaluation";

const { values } = parseArgs({
  options: {
    set: { type: "string", default: resolve(new URL("../../../../docs/assist-evaluation/img-03", import.meta.url).pathname) },
    results: { type: "string", multiple: true, default: [] },
    manual: { type: "string", default: "" },
    out: { type: "string" },
    worlds: { type: "string" },
  },
});
const SET = resolve(values.set!);
const manualCases = new Set(values.manual ? values.manual.split(",") : []);

interface Row {
  case: string;
  sha256: string;
  wall_s: number;
  clock_s: number;
  run_fault?: string;
  error: string | null;
  result: ImageProposalResult | null;
  calls: { attempt: number; seconds: number }[];
}
interface Run {
  model: string;
  prompt_version: string;
  rows: Row[];
}

/** A fixed pattern of corner-marking errors (pixels), declared in criteria.md. */
const CORNER_OFFSETS_PX: [number, number][] = [
  [2, -1],
  [-2, 1],
  [1, 2],
  [-1, -2],
];

const read = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;
const r3 = (v: number | null) => (v === null ? null : Math.round(v * 1000) / 1000);

/** The geometry summary the criteria report: centre error, widths, depths, heights, by stratum. */
function geometrySummary(rows: GeometryRow[]) {
  const ordinary = rows.filter((r) => !r.nearHorizon);
  const near = rows.filter((r) => r.nearHorizon);
  const summarise = (rs: GeometryRow[]) => ({
    n: rs.length,
    centre_m: dist(rs.map((r) => r.centreErrorM)),
    across_abs_rel: dist(rs.map((r) => Math.abs(r.acrossRel))),
    along_abs_rel: dist(rs.map((r) => Math.abs(r.alongRel))),
    along_signed_rel_median: r3(distribution(rs.map((r) => r.alongRel)).median),
    height_abs_m: dist(rs.filter((r) => r.heightErrorM !== null).map((r) => Math.abs(r.heightErrorM!))),
  });
  return {
    all: summarise(rows),
    not_near_horizon: summarise(ordinary),
    near_horizon: { ...summarise(near), flagged: near.filter((r) => r.flagged).length },
    partly_visible: summarise(rows.filter((r) => r.visibility === "partly_visible")),
    estimates_labelled: `${rows.filter((r) => r.estimatesLabelled).length}/${rows.length}`,
  };
}
function dist(vs: number[]) {
  const d = distribution(vs);
  return { n: d.n, median: r3(d.median), p90: r3(d.p90), max: r3(d.max) };
}

const annotations = new Map<string, Annotation>();
function annotationOf(name: string): Annotation {
  if (!annotations.has(name)) annotations.set(name, read<Annotation>(join(SET, "annotations", `${name}.annotation.json`)));
  return annotations.get(name)!;
}

const output: Record<string, unknown> = { rules: "docs/assist-evaluation/img-03/criteria.md", models: {} as Record<string, unknown> };
/** The placements of each world, in the app's own scene frame (for the browser cross-check). */
const placements: Record<string, Record<string, Record<string, unknown[]>>> = {};
for (const file of values.results!) {
  const run = read<Run>(join(SET, file));
  const cases: Record<string, unknown>[] = [];
  const pooled = { initial: [] as GeometryRow[], reviewed: [] as GeometryRow[], manual: [] as GeometryRow[], reviewed_corner_offsets: [] as GeometryRow[] };
  const byType: Record<string, { tp: number; fp: number; fn: number; tpAll: number; fpAll: number; fnAll: number; images: number }> = {};
  const totals = { tp: 0, fp: 0, fn: 0, tpAll: 0, fpAll: 0, fnAll: 0, groups: 0, duplicates: 0, labelOk: 0, labelN: 0, errors: 0, runFaults: 0, calls: 0, retries: 0 };
  const effort = { reviewed: [] as number[], reviewedKlm: [] as number[], manual: [] as number[], manualKlm: [] as number[] };
  const outliers: { case: string; world: string; gt: string; centre_m: number; depression_deg: number; visibility: string }[] = [];
  for (const row of run.rows) {
    const a = annotationOf(row.case);
    if (a.image.sha256 !== row.sha256) throw new Error(`${row.case}: answer for a different photo`);
    const type = a.image.scene_type;
    byType[type] ??= { tp: 0, fp: 0, fn: 0, tpAll: 0, fpAll: 0, fnAll: 0, images: 0 };
    byType[type].images++;
    totals.calls += row.calls.length;
    totals.retries += Math.max(0, row.calls.length - 1);
    if (row.run_fault) totals.runFaults++;
    const counted = a.objects.filter((o) => o.counted).length;
    const cal = calibrate(a, "both");
    const frame = rectFrame(cal, a.rectangle.corners);
    // Calibration, measured against the render's own camera and the mat's true depth.
    const widthOnly = calibrate(a, "width_only");
    const calibration = {
      derived_depth_rel: r3((widthOnly.depthM - a.rectangle.depth_m) / a.rectangle.depth_m),
      camera_height_error_m: a.camera ? r3(cal.camera.y - a.camera.position_m[1]) : null,
      fov_error_deg: a.camera ? r3(cal.verticalFovDeg - a.camera.vertical_fov_deg) : null,
      fov_basis: cal.fovBasis,
      corner_residual_px: r3(cal.cornerResidualPx),
    };
    // The manual baseline needs no model: it is built for every listed photo, answered or not.
    if (manualCases.has(row.case)) {
      const manual = manualWorld(cal, a.objects);
      const rows = geometryOf(manual, a.objects, frame);
      pooled.manual.push(...rows);
      effort.manual.push(Object.values(manual.actions).reduce((s, v) => s + v, 0));
      effort.manualKlm.push(klmSeconds(manual.actions));
      for (const g of rows) outliers.push({ case: row.case, world: "manual", gt: g.gt, centre_m: r3(g.centreErrorM)!, depression_deg: r3(g.depressionDeg)!, visibility: g.visibility });
    }
    if (row.error || !row.result?.proposal) {
      // A provider error or no proposal: every counted object is missed (criteria.md).
      totals.errors++;
      totals.fn += counted;
      totals.fnAll += counted;
      byType[type].fn += counted;
      byType[type].fnAll += counted;
      cases.push({ case: row.case, scene_type: type, error: row.error ?? row.result?.message ?? "no proposal", counted, calibration });
      continue;
    }
    const proposal = row.result.proposal;
    const boxesAll = proposal.objects.map((o) => o.box);
    const accepted = proposal.objects.filter((o) => o.suggest_accept);
    const m = matchProposals(accepted.map((o) => o.box), a.objects);
    const mAll = matchProposals(boxesAll, a.objects);
    for (const [i, r] of mAll.proposals.entries()) {
      if (r.status !== "tp" && r.status !== "group") continue;
      totals.labelN++;
      if (labelAgrees(proposal.objects[i]!, a.objects.find((o) => o.id === r.gt)!)) totals.labelOk++;
    }
    Object.assign(totals, {
      tp: totals.tp + m.tp,
      fp: totals.fp + m.fp,
      fn: totals.fn + m.fn,
      tpAll: totals.tpAll + mAll.tp,
      fpAll: totals.fpAll + mAll.fp,
      fnAll: totals.fnAll + mAll.fn,
      groups: totals.groups + mAll.groups,
      duplicates: totals.duplicates + mAll.duplicates,
    });
    Object.assign(byType[type], { tp: byType[type].tp + m.tp, fp: byType[type].fp + m.fp, fn: byType[type].fn + m.fn, tpAll: byType[type].tpAll + mAll.tp, fpAll: byType[type].fpAll + mAll.fp, fnAll: byType[type].fnAll + mAll.fn });
    const worlds: Record<string, World> = { initial: initialWorld(cal, proposal, a.objects), reviewed: reviewedWorld(cal, proposal, a.objects) };
    if (manualCases.has(row.case)) worlds.manual = manualWorld(cal, a.objects);
    const counted_in_pool = new Set(["initial", "reviewed"]); // manual was pooled above
    const geometry: Record<string, GeometryRow[]> = {};
    placements[run.model] ??= {};
    placements[run.model]![row.case] = {
      ...Object.fromEntries(
        Object.entries(worlds).map(([name, world]) => [
          name,
          world.placed.map((p) => ({
            id: p.item.id,
            label: p.item.label,
            gt: world.gtOf.get(p.item.id) ?? null,
            x: p.x,
            z: p.z,
            yaw_deg: r3((p.yawRad * 180) / Math.PI),
            width: p.width,
            depth: p.depth,
            height: p.height,
            // The footprint in the rectangle's frame, for the review sheets' plan.
            rect: footprint(p).map(([x, z]) => frame.toRect(x, z).map((v) => r3(v))),
          })),
        ]),
      ),
      truth: a.objects.map((o) => ({ id: o.id, class: o.class, counted: o.counted, rect: gtFootprint(o)?.map(([x, z]) => [r3(x), r3(z)]) ?? null })),
      camera: [{ x: r3(frame.camera.x), z: r3(frame.camera.z) }],
    };
    for (const [name, world] of Object.entries(worlds)) {
      geometry[name] = geometryOf(world, a.objects, frame);
      if (!counted_in_pool.has(name)) continue;
      pooled[name as keyof typeof pooled].push(...geometry[name]!);
      for (const g of geometry[name]!) outliers.push({ case: row.case, world: name, gt: g.gt, centre_m: r3(g.centreErrorM)!, depression_deg: r3(g.depressionDeg)!, visibility: g.visibility });
    }
    // Sensitivity (criteria.md): the reviewed world with each marked corner a few pixels off.
    const nudged = calibrate(a, "both", CORNER_OFFSETS_PX);
    pooled.reviewed_corner_offsets.push(...geometryOf(reviewedWorld(nudged, proposal, a.objects), a.objects, rectFrame(nudged, a.rectangle.corners)));
    effort.reviewed.push(Object.values(worlds.reviewed!.actions).reduce((s, v) => s + v, 0));
    effort.reviewedKlm.push(klmSeconds(worlds.reviewed!.actions));

    cases.push({
      case: row.case,
      scene_type: type,
      wall_s: row.wall_s,
      calls: row.calls.length,
      run_fault: row.run_fault ?? null,
      counted,
      proposals: proposal.objects.length,
      accepted: accepted.length,
      detection: { tp: m.tp, fp: m.fp, fn: m.fn, groups: m.groups, duplicates: m.duplicates },
      detection_all_proposals: { tp: mAll.tp, fp: mAll.fp, fn: mAll.fn },
      proposals_scored: mAll.proposals.map((r, i) => ({ label: proposal.objects[i]!.label, template: proposal.objects[i]!.template, accepted: proposal.objects[i]!.suggest_accept, box: proposal.objects[i]!.box, ...r, iou: r3(r.iou) })),
      missed: [...mAll.found].filter(([, p]) => p === null).map(([g]) => g),
      calibration,
      actions: { reviewed: worlds.reviewed!.actions, manual: worlds.manual?.actions ?? null },
      geometry: Object.fromEntries(Object.entries(geometry).map(([k, rows]) => [k, rows.map((g) => ({ ...g, centreErrorM: r3(g.centreErrorM), acrossErrorM: r3(g.acrossErrorM), acrossRel: r3(g.acrossRel), alongErrorM: r3(g.alongErrorM), alongRel: r3(g.alongRel), heightErrorM: r3(g.heightErrorM), depressionDeg: r3(g.depressionDeg) }))])),
    });
  }
  const pr = (tp: number, fp: number, fn: number) => ({ tp, fp, fn, precision: r3(tp + fp ? tp / (tp + fp) : null), recall: r3(tp + fn ? tp / (tp + fn) : null) });
  (output.models as Record<string, unknown>)[run.model] = {
    prompt_version: run.prompt_version,
    images: run.rows.length,
    provider: { errors: totals.errors, run_faults: totals.runFaults, calls: totals.calls, retries: totals.retries, wall_s: dist(run.rows.map((r) => r.wall_s).filter((v): v is number => typeof v === "number")) },
    detection_initial: pr(totals.tp, totals.fp, totals.fn),
    detection_all_proposals: pr(totals.tpAll, totals.fpAll, totals.fnAll),
    groups: totals.groups,
    duplicates: totals.duplicates,
    label_agreement: `${totals.labelOk}/${totals.labelN}`,
    by_scene_type: Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, { images: v.images, initial: pr(v.tp, v.fp, v.fn), all_proposals: pr(v.tpAll, v.fpAll, v.fnAll) }])),
    geometry: Object.fromEntries(Object.entries(pooled).filter(([, rows]) => rows.length).map(([k, rows]) => [k, geometrySummary(rows)])),
    effort: {
      reviewed_actions_per_image: dist(effort.reviewed),
      reviewed_klm_s_per_image: dist(effort.reviewedKlm),
      manual_actions_per_image: dist(effort.manual),
      manual_klm_s_per_image: dist(effort.manualKlm),
    },
    worst_centre_errors: outliers.sort((x, y) => y.centre_m - x.centre_m).slice(0, 8),
    cases,
  };
}
const text = `${JSON.stringify(output, null, 1)}\n`;
if (values.out) writeFileSync(join(SET, values.out), text);
if (values.worlds) writeFileSync(join(SET, values.worlds), `${JSON.stringify(placements, null, 1)}\n`);
for (const [model, s] of Object.entries(output.models as Record<string, Record<string, unknown>>)) {
  const g = s.geometry as Record<string, { not_near_horizon: { centre_m: unknown; across_abs_rel: unknown }; near_horizon: { n: number; centre_m: unknown; flagged: number } }>;
  console.log(model, JSON.stringify({ detection: s.detection_initial, all: s.detection_all_proposals, label: s.label_agreement, groups: s.groups }));
  for (const [w, v] of Object.entries(g)) console.log(`  ${w}: centre ${JSON.stringify(v.not_near_horizon.centre_m)} across ${JSON.stringify(v.not_near_horizon.across_abs_rel)} near-horizon n=${v.near_horizon.n} ${JSON.stringify(v.near_horizon.centre_m)} flagged ${v.near_horizon.flagged}`);
}
