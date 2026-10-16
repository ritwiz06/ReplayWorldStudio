// IMG-03: review sheets, one per photo and model, from scores.json and worlds.json.
//
//   node scripts/img03/sheets.ts [--model qwen3-vl-32b-instruct]
//
// Left: the photo with the model's outlines, coloured by how they were scored (green: found;
// orange: a group outline; purple: a duplicate; red: a false positive; grey: ignored or not
// ticked), and the true visible outlines dashed (white: counted; dim: not counted). Right: the
// floor plan in the mat's frame (camera at the bottom), true footprints in white, the initial
// proposal in red, the reviewed world in green. Written to docs/assist-evaluation/img-03/sheets/.
import { mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "@playwright/test";

const SET = resolve(new URL("../../../../docs/assist-evaluation/img-03", import.meta.url).pathname);
const { values } = parseArgs({ options: { model: { type: "string", default: "qwen3-vl-32b-instruct" }, scores: { type: "string", default: "scores.json" }, worlds: { type: "string", default: "worlds.json" } } });
type Box = { left: number; top: number; right: number; bottom: number };
type Poly = [number, number][];
const scores = JSON.parse(readFileSync(join(SET, values.scores!), "utf8")) as { models: Record<string, { cases: { case: string; scene_type: string; detection?: { tp: number; fp: number; fn: number }; error?: string; proposals_scored?: { label: string; status: string; accepted: boolean; box: Box; iou: number }[]; geometry?: Record<string, { gt: string; centreErrorM: number }[]> }[] }> };
const worlds = JSON.parse(readFileSync(join(SET, values.worlds!), "utf8")) as Record<string, Record<string, { initial: { rect: Poly; gt: string | null }[]; reviewed: { rect: Poly; gt: string | null }[]; truth: { id: string; counted: boolean; rect: Poly | null }[]; camera: { x: number; z: number }[] }>>;
const model = values.model!;
const COLOUR: Record<string, string> = { tp: "#2ecc71", group: "#ff9f1a", duplicate: "#b36bff", poor_outline: "#ff4d4d", no_object: "#ff4d4d", ignored: "#9aa0a6" };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

function sheet(name: string): string {
  const s = scores.models[model]!.cases.find((c) => c.case === name)!;
  const w = worlds[model]![name]!;
  const a = JSON.parse(readFileSync(join(SET, "annotations", `${name}.annotation.json`), "utf8")) as { rectangle: { width_m: number; depth_m: number }; objects: { id: string; counted: boolean; visible_box: Box | null }[] };
  const photo = readFileSync(join(SET, "photos", `${name}.jpg`)).toString("base64");
  const rect = (b: Box, colour: string, dash: string, label = "") =>
    `<rect x="${b.left}" y="${b.top}" width="${b.right - b.left}" height="${b.bottom - b.top}" fill="none" stroke="${colour}" stroke-width="0.0035" ${dash}/>${label ? `<text x="${b.left + 0.003}" y="${b.top - 0.006}" font-size="0.022" fill="${colour}">${esc(label)}</text>` : ""}`;
  const truth = a.objects.filter((o) => o.visible_box).map((o) => rect(o.visible_box!, o.counted ? "#ffffff" : "rgba(255,255,255,0.45)", 'stroke-dasharray="0.01 0.006"')).join("");
  const proposals = (s.proposals_scored ?? []).map((p) => rect(p.box, p.accepted ? COLOUR[p.status]! : "#9aa0a6", "", `${p.label} (${p.status === "tp" ? "found" : p.status})`)).join("");
  // Plan: the mat's frame; camera towards +z (bottom of the drawing).
  const all: Poly = [...w.truth.flatMap((t) => t.rect ?? []), ...w.initial.flatMap((p) => p.rect), ...w.reviewed.flatMap((p) => p.rect), [w.camera[0]!.x, w.camera[0]!.z]];
  const xs = all.map((p) => p[0]);
  const zs = all.map((p) => p[1]);
  const pad = 0.8;
  const [minX, maxX, minZ, maxZ] = [Math.min(...xs) - pad, Math.max(...xs) + pad, Math.min(...zs) - pad, Math.max(...zs) + pad];
  const poly = (p: Poly, stroke: string, extra = "") => `<polygon points="${p.map(([x, z]) => `${x},${z}`).join(" ")}" fill="none" stroke="${stroke}" stroke-width="0.05" ${extra}/>`;
  const mat = poly(
    [
      [-a.rectangle.width_m / 2, -a.rectangle.depth_m / 2],
      [a.rectangle.width_m / 2, -a.rectangle.depth_m / 2],
      [a.rectangle.width_m / 2, a.rectangle.depth_m / 2],
      [-a.rectangle.width_m / 2, a.rectangle.depth_m / 2],
    ],
    "#e5ad0c",
  );
  const plan = [
    mat,
    ...w.truth.filter((t) => t.rect).map((t) => poly(t.rect!, t.counted ? "#ffffff" : "rgba(255,255,255,0.4)")),
    ...w.initial.map((p) => poly(p.rect, "#ff4d4d", 'stroke-dasharray="0.15 0.1"')),
    ...w.reviewed.map((p) => poly(p.rect, "#2ecc71")),
    `<circle cx="${w.camera[0]!.x}" cy="${w.camera[0]!.z}" r="0.18" fill="#7cc4ff"/>`,
  ].join("");
  const worst = Object.entries(s.geometry ?? {})
    .filter(([k]) => k === "initial" || k === "reviewed")
    .map(([k, rows]) => `${k}: ${rows.length ? `worst ${Math.max(...rows.map((r) => r.centreErrorM)).toFixed(2)} m (${rows.sort((x, y) => y.centreErrorM - x.centreErrorM)[0]!.gt})` : "nothing placed"}`)
    .join(" · ");
  const head = s.error ? `error: ${esc(s.error)}` : `found ${s.detection!.tp}, false positives ${s.detection!.fp}, missed ${s.detection!.fn} · ${worst}`;
  return `<!doctype html><html><body style="margin:0;background:#16191d;color:#e3e7ec;font:13px sans-serif">
<div style="padding:6px 10px"><b>${esc(name)}</b> (${s.scene_type}, synthetic) · ${esc(model)} · ${head}</div>
<div style="display:flex;gap:8px;padding:0 10px 10px">
 <div style="position:relative;width:820px;height:615px"><img src="data:image/jpeg;base64,${photo}" style="width:820px;height:615px;display:block"/>
  <svg viewBox="0 0 1 1" preserveAspectRatio="none" style="position:absolute;inset:0;width:820px;height:615px">${truth}${proposals}</svg></div>
 <div><svg viewBox="${minX} ${minZ} ${maxX - minX} ${maxZ - minZ}" style="width:520px;height:615px;background:#23272c">${plan}</svg>
  <div style="font-size:12px">Plan (mat's frame, camera blue): true footprints white; initial proposal red dashed; reviewed green; mat gold.</div></div>
</div></body></html>`;
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1380, height: 660 } });
const out = join(SET, "sheets", model);
mkdirSync(out, { recursive: true });
for (const c of scores.models[model]!.cases) {
  if (!worlds[model]?.[c.case]) continue;
  await page.setContent(sheet(c.case));
  await page.screenshot({ path: join(out, `${c.case}.jpg`), type: "jpeg", quality: 82, fullPage: true });
  console.log(`${model}/${c.case}`);
}
await browser.close();
