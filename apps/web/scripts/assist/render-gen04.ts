// GEN-04: render the frozen revision run for the visual review (one model, so no model key).
//
//   uv run python scripts/evaluate_gen04.py --build-targets      (the "before" models)
//   pnpm --filter @replay-world/web exec node scripts/assist/run-ts.mjs scripts/assist/render-gen04.ts [--models DIR] [--out DIR]
//
// Every proposal built by the run (bench-results/gen-04-models/<model>/<case>.glb) is drawn with
// three.js exactly as in GEN-03 (fixed front-right view, the app's studio lighting), next to its
// target's current model. Each case with a proposal becomes one numbered sheet, in a shuffled
// order, showing only the instruction and the two pictures (sheet-NN.png and sheets.html): no case
// id, group, automatic score or answer text. Which case each sheet is goes to sheet-key.json,
// opened only after every sheet is scored.
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "@playwright/test";

const { values: options } = parseArgs({
  options: {
    models: { type: "string", default: "../../bench-results/gen-04-models" },
    out: { type: "string", default: "../../bench-results/gen-04-review" },
    seed: { type: "string", default: "gen-04" },
  },
});
const SET = new URL("../../../../docs/assist-evaluation/gen-04/", import.meta.url).pathname;
const MODELS = resolve(options.models);
const OUT = resolve(options.out);
const THREE = resolve("node_modules/three");
mkdirSync(OUT, { recursive: true });

// A deterministic shuffle, so the sheets can be regenerated with the same key.
let state = [...options.seed].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const random = () => ((state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32);

const PAGE = `<!doctype html><html><head><style>body{margin:0;background:#fff;font:14px sans-serif}</style>
<script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}</script></head>
<body><canvas id="c" width="480" height="360"></canvas><script type="module">
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById("c"), antialias: true, preserveDrawingBuffer: true });
renderer.outputColorSpace = THREE.SRGBColorSpace;
// The same studio lighting as the app's model preview, so metals and paints read as they do there.
const environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
window.draw = async (url) => {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#eef0f2");
  scene.environment = environment;
  scene.environmentIntensity = 0.6;
  scene.add(new THREE.HemisphereLight("#ffffff", "#8a9099", 1.4));
  const sun = new THREE.DirectionalLight("#ffffff", 2.2); sun.position.set(3, 6, 4); scene.add(sun);
  const gltf = await new GLTFLoader().loadAsync(url);
  scene.add(gltf.scene);
  const box = new THREE.Box3().setFromObject(gltf.scene);
  const size = box.getSize(new THREE.Vector3());
  const reach = Math.max(size.x, size.y, size.z);
  const grid = new THREE.GridHelper(reach * 3, 12, "#b8bec5", "#d3d7dc"); scene.add(grid);
  const camera = new THREE.PerspectiveCamera(35, 480 / 360, reach / 100, reach * 50);
  camera.position.set(reach * 1.6, size.y * 0.9 + reach * 0.7, reach * 2.1);
  camera.lookAt(0, size.y / 2, 0);
  renderer.render(scene, camera);
  return [size.x, size.y, size.z];
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
const page = await browser.newPage({ viewport: { width: 480, height: 360 } });
await page.goto(`http://127.0.0.1:${port}/`);

/** Render one GLB to a PNG data URL (or null when the model does not exist). */
async function shot(path: string): Promise<string | null> {
  if (!existsSync(join(MODELS, path))) return null;
  await page.evaluate((url) => (window as unknown as { draw: (u: string) => Promise<number[]> }).draw(url), `/models/${path}`);
  const png = await page.locator("#c").screenshot();
  return `data:image/png;base64,${png.toString("base64")}`;
}

const [model] = readdirSync(MODELS).filter((d) => d !== "targets" && !d.startsWith("diagnostic-"));
if (!model) throw new Error(`No proposals in ${MODELS}`);
const revisions = JSON.parse(readFileSync(join(SET, "revisions.json"), "utf8")) as { cases: { id: string; target: string; instruction: string }[] };
const cases = revisions.cases.filter((c) => existsSync(join(MODELS, model, `${c.id}.glb`)));
const order = cases.map((c) => [random(), c] as const).sort((a, b) => a[0] - b[0]).map(([, c]) => c);
const key: Record<string, string> = {};
const cells: string[] = [];
const escape = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
const style = "body{font:14px sans-serif;margin:16px}section{break-inside:avoid;margin-bottom:18px}.row{display:flex;gap:8px}figure{margin:0}figcaption{font-weight:600}img{width:320px;height:240px;border:1px solid #ccc}";
const sheetPage = await browser.newPage({ viewport: { width: 700, height: 340 } });
for (const [i, c] of order.entries()) {
  const sheet = `Sheet ${String(i + 1).padStart(2, "0")}`;
  key[sheet] = c.id;
  const before = await shot(`targets/${c.target}.glb`);
  const after = await shot(`${model}/${c.id}.glb`);
  const html = `<section><h3>${sheet}</h3><p>${escape(c.instruction)}</p><div class="row"><figure><figcaption>Before</figcaption><img src="${before}"></figure><figure><figcaption>After</figcaption><img src="${after}"></figure></div></section>`;
  cells.push(html);
  await sheetPage.setContent(`<!doctype html><meta charset="utf-8"><style>${style}</style>${html}`);
  await sheetPage.locator("section").screenshot({ path: join(OUT, `sheet-${String(i + 1).padStart(2, "0")}.png`) });
}
await browser.close();
server.close();

writeFileSync(join(OUT, "sheets.html"), `<!doctype html><meta charset="utf-8"><style>${style}</style>${cells.join("\n")}`);
writeFileSync(join(OUT, "sheet-key.json"), `${JSON.stringify({ model, sheets: key }, null, 1)}\n`);
console.log(`Wrote ${cells.length} sheets to ${OUT}; the case key is in sheet-key.json (do not open before scoring).`);
