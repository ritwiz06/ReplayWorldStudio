// GEN-08: render a revision run for the visual review, by two different viewing methods.
//
//   uv run python scripts/evaluate_gen05.py --set DIR --build-targets      (the "before" models)
//   pnpm --filter @replay-world/web exec node scripts/assist/run-ts.mjs scripts/assist/render-gen08.ts --set DIR [--models DIR] [--out DIR]
//
// * dialog: what a user sees on opening the updated Improve dialog for the proposal. Same
//   background, lights and grid as ModelPreview.tsx; glass and clear plastic with the viewer's
//   edges and compositing, coincident faces resolved as modelLoader.ts does; the camera view the
//   API chose for the proposal (both models from that view); the parts a warning refers to
//   outlined in orange, as the dialog outlines them. This is the method the gate uses.
// * fixed: GEN-05's renderer unchanged (light background, front-right camera, no edges), for
//   context only. The two methods are different viewing conditions, so their means are not
//   comparable as if the review were the same.
//
// Each method gets its own shuffled, numbered sheets (sheet-NN.png) and its own key
// (sheet-key-<method>.json), opened only after every sheet of that method is scored.
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "@playwright/test";

const { values: options } = parseArgs({
  options: {
    set: { type: "string", default: new URL("../../../../docs/assist-evaluation/gen-08/", import.meta.url).pathname },
    models: { type: "string" },
    out: { type: "string" },
  },
});
const SET = resolve(options.set);
const NAME = SET.replace(/\/+$/, "").split("/").pop()!;
const MODELS = resolve(options.models ?? `../../bench-results/${NAME}-models`);
const OUT = resolve(options.out ?? `../../bench-results/${NAME}-review`);
const THREE = resolve("node_modules/three");

const PAGE = `<!doctype html><html><head><style>body{margin:0;background:#fff;font:14px sans-serif}</style>
<script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}</script></head>
<body><canvas id="fixed" width="480" height="360"></canvas><canvas id="dialog" width="612" height="260"></canvas><script type="module">
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
function renderer(id) {
  const r = new THREE.WebGLRenderer({ canvas: document.getElementById(id), antialias: true, preserveDrawingBuffer: true });
  r.outputColorSpace = THREE.SRGBColorSpace;
  return r;
}
const fixedR = renderer("fixed"), dialogR = renderer("dialog");
const fixedEnv = new THREE.PMREMGenerator(fixedR).fromScene(new RoomEnvironment(), 0.04).texture;
const dialogEnv = new THREE.PMREMGenerator(dialogR).fromScene(new RoomEnvironment(), 0.04).texture;
// GEN-05's renderer, unchanged.
window.drawFixed = async (url) => {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#eef0f2");
  scene.environment = fixedEnv;
  scene.environmentIntensity = 0.6;
  scene.add(new THREE.HemisphereLight("#ffffff", "#8a9099", 1.4));
  const sun = new THREE.DirectionalLight("#ffffff", 2.2); sun.position.set(3, 6, 4); scene.add(sun);
  const gltf = await new GLTFLoader().loadAsync(url);
  scene.add(gltf.scene);
  const box = new THREE.Box3().setFromObject(gltf.scene);
  const size = box.getSize(new THREE.Vector3());
  const reach = Math.max(size.x, size.y, size.z);
  scene.add(new THREE.GridHelper(reach * 3, 12, "#b8bec5", "#d3d7dc"));
  const camera = new THREE.PerspectiveCamera(35, 480 / 360, reach / 100, reach * 50);
  camera.position.set(reach * 1.6, size.y * 0.9 + reach * 0.7, reach * 2.1);
  camera.lookAt(0, size.y / 2, 0);
  fixedR.render(scene, camera);
};
// The Improve dialog's preview (ModelPreview.tsx) with the viewer's treatment (modelLoader.ts) as
// it was frozen for GEN-08 (1-px mid-blue edges at 30 degrees). GEN-09 changed the viewer's
// edges; this copy is kept so the GEN-08 sheets re-render exactly.
const EDGE = "#3a8fd6";
function prepare(root) {
  const meshes = [];
  root.traverse((n) => { if (n.isMesh) meshes.push(n); });
  meshes.forEach((mesh, index) => {
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (mats.some((m) => m.transparent)) {
      for (const m of mats) m.depthWrite = false;
      mesh.renderOrder = 1;
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, 30), new THREE.LineBasicMaterial({ color: EDGE }));
      edges.renderOrder = 2;
      mesh.add(edges);
    } else {
      const step = Math.min(index, 8);
      for (const m of mats) { m.polygonOffset = true; m.polygonOffsetFactor = -step; m.polygonOffsetUnits = -4 * step; }
    }
  });
}
function viewCamera(view, w, h, d) {
  const reach = Math.max(w, h, d);
  if (view === "rear-left") return { eye: [-reach * 1.6, h * 0.9 + reach * 0.7, -reach * 2.1], target: [0, h / 2, 0] };
  if (view === "low-front") return { eye: [reach * 1.1, h * 0.12, reach * 2.6], target: [0, h * 0.4, 0] };
  return { eye: [reach * 1.6, h * 0.9 + reach * 0.7, reach * 2.1], target: [0, h / 2, 0] };
}
window.drawDialog = async (url, view, boxes) => {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#1f2329");
  scene.environment = dialogEnv;
  scene.environmentIntensity = 0.5;
  scene.add(new THREE.HemisphereLight("#e8edf2", "#4a4e53", 0.6));
  const gltf = await new GLTFLoader().loadAsync(url);
  prepare(gltf.scene);
  scene.add(gltf.scene);
  const box = new THREE.Box3().setFromObject(gltf.scene);
  const size = box.getSize(new THREE.Vector3());
  const reach = Math.max(size.x, size.y, size.z);
  const a = new THREE.DirectionalLight("#ffffff", 1.6); a.position.set(reach * 2, reach * 3, reach * 2.5); scene.add(a);
  const b = new THREE.DirectionalLight("#ffffff", 0.3); b.position.set(-reach * 2, reach, -reach * 2); scene.add(b);
  // The dialog's grid: 0.1 m cells, faint, fading out a few object lengths away (drei Grid).
  const extent = Math.max(2, Math.ceil(reach * 6));
  const grid = new THREE.GridHelper(extent, Math.round(extent / 0.1), "#4a5058", "#4a5058");
  grid.material.transparent = true; grid.material.opacity = 0.55; grid.position.y = 0.001; scene.add(grid);
  for (const bx of boxes) {
    const pad = Math.max(...bx.size) * 0.08 + 0.01;
    const line = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(bx.size[0] + pad, bx.size[1] + pad, bx.size[2] + pad)),
      new THREE.LineBasicMaterial({ color: "#ffb020", depthTest: false, transparent: true, opacity: 0.95 }));
    line.position.set(...bx.center); line.renderOrder = 10; scene.add(line);
  }
  const camera = new THREE.PerspectiveCamera(35, 612 / 260, 0.01, 500);
  const { eye, target } = viewCamera(view, size.x, size.y, size.z);
  camera.position.set(...eye); camera.lookAt(...target);
  dialogR.render(scene, camera);
};
</script></body></html>`;

const server = createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? "/").split("?")[0]!);
  const file = url === "/" ? null : url.startsWith("/three/") ? join(THREE, url.slice(7)) : url.startsWith("/models/") ? join(MODELS, url.slice(8)) : null;
  if (url === "/") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(PAGE);
  } else if (file && existsSync(file)) {
    res.writeHead(200, { "Content-Type": extname(file) === ".js" ? "text/javascript" : "model/gltf-binary" });
    createReadStream(file).pipe(res);
  } else {
    res.writeHead(404);
    res.end();
  }
});
await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
const port = (server.address() as { port: number }).port;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
await page.goto(`http://127.0.0.1:${port}/`);

interface Part { id: string; center_m: { x: number; y: number; z: number }; size_m: { x: number; y: number; z: number } }
const [model] = readdirSync(MODELS).filter((d) => d !== "targets" && !d.startsWith("diagnostic-"));
if (!model) throw new Error(`No proposals in ${MODELS}`);
const revisions = JSON.parse(readFileSync(join(SET, "revisions.json"), "utf8")) as { cases: { id: string; target: string; instruction: string }[] };
const results = JSON.parse(readFileSync(join(SET, "results", `${model}.json`), "utf8")) as {
  rows: Record<string, { result: { view?: string; spec?: { parts: Part[] }; problems?: { part_ids: string[] }[] } | null }>;
};
const cases = revisions.cases.filter((c) => existsSync(join(MODELS, model, `${c.id}.glb`)));

async function shoot(method: "fixed" | "dialog", file: string, view: string, boxes: unknown[]): Promise<string> {
  const url = `/models/${file}`;
  if (method === "fixed") await page.evaluate((u) => (window as unknown as { drawFixed: (u: string) => Promise<void> }).drawFixed(u), url);
  else await page.evaluate(([u, v, b]) => (window as unknown as { drawDialog: (u: string, v: string, b: unknown) => Promise<void> }).drawDialog(u as string, v as string, b), [url, view, boxes] as const);
  const png = await page.locator(`#${method}`).screenshot();
  return `data:image/png;base64,${png.toString("base64")}`;
}

const escape = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
const style = "body{font:14px sans-serif;margin:16px}section{break-inside:avoid;margin-bottom:18px}.row{display:flex;gap:8px}figure{margin:0}figcaption{font-weight:600}img{border:1px solid #ccc}";
const sheetPage = await browser.newPage({ viewport: { width: 1320, height: 480 } });
for (const [method, seed] of [["dialog", "gen-08-dialog"], ["fixed", "gen-08-fixed"]] as const) {
  let state = [...seed].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  const random = () => ((state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const order = cases.map((c) => [random(), c] as const).sort((a, b) => a[0] - b[0]).map(([, c]) => c);
  const dir = join(OUT, method);
  mkdirSync(dir, { recursive: true });
  const key: Record<string, string> = {};
  const cells: string[] = [];
  for (const [i, c] of order.entries()) {
    const sheet = `Sheet ${String(i + 1).padStart(2, "0")}`;
    key[sheet] = c.id;
    const result = results.rows[c.id]?.result;
    const view = result?.view ?? "front-right";
    const wanted = new Set((result?.problems ?? []).flatMap((p) => p.part_ids));
    const boxes = (result?.spec?.parts ?? [])
      .filter((p) => wanted.has(p.id))
      .map((p) => ({ center: [p.center_m.x, p.center_m.y, p.center_m.z], size: [p.size_m.x, p.size_m.y, p.size_m.z] }));
    const before = await shoot(method, `targets/${c.target}.glb`, view, []);
    const after = await shoot(method, `${model}/${c.id}.glb`, view, boxes);
    const html = `<section><h3>${sheet}</h3><p>${escape(c.instruction)}</p><div class="row"><figure><figcaption>Before</figcaption><img src="${before}"></figure><figure><figcaption>After</figcaption><img src="${after}"></figure></div></section>`;
    cells.push(html);
    await sheetPage.setContent(`<!doctype html><meta charset="utf-8"><style>${style}</style>${html}`);
    await sheetPage.locator("section").screenshot({ path: join(dir, `sheet-${String(i + 1).padStart(2, "0")}.png`) });
  }
  writeFileSync(join(dir, "sheets.html"), `<!doctype html><meta charset="utf-8"><style>${style}</style>${cells.join("\n")}`);
  writeFileSync(join(OUT, `sheet-key-${method}.json`), `${JSON.stringify({ model, method, sheets: key }, null, 1)}\n`);
  console.log(`${method}: ${cells.length} sheets in ${dir}; key in sheet-key-${method}.json (do not open before scoring).`);
}
await browser.close();
server.close();
