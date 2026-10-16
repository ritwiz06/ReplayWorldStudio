// IMG-03: render the synthetic stratum and write its exact ground truth.
//
//   node scripts/img03/render.ts            (after scripts/build_img03_scenes.py)
//
// For every scene and camera in bench-results/img-03/manifest.json:
// * the photo: a lit render of the room (floor tiles, walls, the coloured floor mat that is the
//   calibration rectangle, the objects with their generator materials and shadows), as JPEG;
// * the ground truth, from flat-colour passes with no lighting or antialiasing: each object's
//   visible outline (the box around its pixels that show), its whole outline (the object drawn
//   alone), the share of it that shows, and the edges it is cut off at; the mat's corners
//   projected exactly; positions and sizes from the scene, in the mat's frame.
// Writes docs/assist-evaluation/img-03/photos/<scene>-<camera>.jpg and
// annotations/<scene>-<camera>.annotation.json (format rws-img03-annotation/1).
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";
import { chromium } from "@playwright/test";

const ROOT = resolve(new URL("../../../../", import.meta.url).pathname);
const BUILD = join(ROOT, "bench-results/img-03");
const OUT = join(ROOT, "docs/assist-evaluation/img-03");
const THREE = resolve("node_modules/three");

interface SceneObject {
  id: string;
  class: string;
  file: string;
  position: [number, number];
  yaw_deg: number;
  size: [number, number, number];
}
interface Camera {
  id: string;
  position: [number, number, number];
  target: [number, number, number];
  vfov_deg: number;
  width: number;
  height: number;
}
interface Scene {
  id: string;
  scene_type: string;
  split: "development" | "held_out";
  room: { width: number; depth: number; wall_height: number; back_z: number };
  mat: { centre: [number, number]; width: number; depth: number; yaw_deg: number; colour: string };
  objects: SceneObject[];
  cameras: Camera[];
}

const PAGE = `<!doctype html><html><head><style>body{margin:0;background:#000}</style>
<script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}</script></head>
<body><canvas id="photo"></canvas><script type="module">
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
const loader = new GLTFLoader();
const cache = new Map();
async function model(file) {
  if (!cache.has(file)) cache.set(file, await loader.loadAsync("/build/" + file));
  return cache.get(file).scene.clone(true);
}
function tiles() {
  const c = document.createElement("canvas"); c.width = c.height = 512;
  const g = c.getContext("2d");
  g.fillStyle = "#b7bcc2"; g.fillRect(0, 0, 512, 512);
  g.strokeStyle = "#9aa0a7"; g.lineWidth = 6; g.strokeRect(0, 0, 512, 512);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
// Build the room; returns { scene, objects: [{ id, root }], structure: [meshes] }.
async function build(s) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#dfe3e8");
  const W = s.room.width, back = s.room.back_z, H = s.room.wall_height, front = 14;
  const floorTex = tiles(); floorTex.repeat.set(W, front - back);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, front - back), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.9 }));
  floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0, (front + back) / 2); floor.receiveShadow = true;
  const wallMat = new THREE.MeshStandardMaterial({ color: "#e7e4de", roughness: 0.95 });
  const backWall = new THREE.Mesh(new THREE.BoxGeometry(W, H, 0.2), wallMat); backWall.position.set(0, H / 2, back - 0.1);
  const left = new THREE.Mesh(new THREE.BoxGeometry(0.2, H, front - back), wallMat); left.position.set(-W / 2 - 0.1, H / 2, (front + back) / 2);
  const right = left.clone(); right.position.x = W / 2 + 0.1;
  const skirting = new THREE.Mesh(new THREE.BoxGeometry(W, 0.12, 0.04), new THREE.MeshStandardMaterial({ color: "#6b7078" })); skirting.position.set(0, 0.06, back + 0.02);
  for (const m of [backWall, left, right]) { m.receiveShadow = true; }
  const mat = new THREE.Mesh(new THREE.BoxGeometry(s.mat.width, 0.006, s.mat.depth), new THREE.MeshStandardMaterial({ color: s.mat.colour, roughness: 0.85 }));
  mat.position.set(s.mat.centre[0], 0.003, s.mat.centre[1]); mat.rotation.y = s.mat.yaw_deg * Math.PI / 180; mat.receiveShadow = true;
  scene.add(floor, backWall, left, right, skirting, mat);
  const objects = [];
  for (const o of s.objects) {
    const root = await model(o.file);
    root.position.set(o.position[0], 0, o.position[1]);
    root.rotation.y = o.yaw_deg * Math.PI / 180;
    root.traverse((n) => { if (n.isMesh) { n.castShadow = true; n.receiveShadow = true; } });
    scene.add(root);
    objects.push({ id: o.id, root });
  }
  return { scene, objects, structure: [floor, backWall, left, right, skirting, mat] };
}
function camera(c) {
  const cam = new THREE.PerspectiveCamera(c.vfov_deg, c.width / c.height, 0.05, 200);
  cam.position.set(...c.position); cam.lookAt(new THREE.Vector3(...c.target)); cam.updateMatrixWorld(true);
  return cam;
}
const canvas = document.getElementById("photo");
const photoR = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
photoR.outputColorSpace = THREE.SRGBColorSpace; photoR.shadowMap.enabled = true; photoR.shadowMap.type = THREE.PCFSoftShadowMap;
photoR.toneMapping = THREE.ACESFilmicToneMapping; photoR.toneMappingExposure = 1.0;
const env = new THREE.PMREMGenerator(photoR).fromScene(new RoomEnvironment(), 0.04).texture;
window.renderPhoto = async (s, c) => {
  const { scene } = await build(s);
  scene.environment = env; scene.environmentIntensity = 0.5;
  scene.add(new THREE.HemisphereLight("#ffffff", "#7d848c", 0.9));
  const sun = new THREE.DirectionalLight("#fff6e8", 2.4);
  sun.position.set(-6, 12, 8); sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096);
  Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 1, far: 50 }); sun.shadow.bias = -0.0004;
  scene.add(sun);
  photoR.setSize(c.width, c.height, false);
  photoR.render(scene, camera(c));
  return canvas.toDataURL("image/jpeg", 0.92);
};
// Flat colours, exact pixels: object i is drawn as colour i + 1; structure (floor, walls, mat) as 0.
THREE.ColorManagement.enabled = false;
const idR = new THREE.WebGLRenderer({ antialias: false });
idR.outputColorSpace = THREE.LinearSRGBColorSpace;
function flat(root, i) {
  const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(((i + 1) & 255) / 255, ((i + 1) >> 8) / 255, 0), side: THREE.DoubleSide });
  root.traverse((n) => { if (n.isMesh) n.material = m; });
}
function pixels(scene, cam, w, h) {
  const target = new THREE.WebGLRenderTarget(w, h);
  idR.setRenderTarget(target); idR.setClearColor(0x000000, 1); idR.clear(); idR.render(scene, cam);
  const buf = new Uint8Array(w * h * 4); idR.readRenderTargetPixels(target, 0, 0, w, h, buf);
  idR.setRenderTarget(null); target.dispose();
  return buf;
}
function stats(buf, w, h, id) {
  let n = 0, l = w, r = -1, t = h, b = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const k = (y * w + x) * 4;
    if (buf[k] + (buf[k + 1] << 8) !== id) continue;
    n++; const row = h - 1 - y; // the buffer's first row is the bottom of the image
    if (x < l) l = x; if (x > r) r = x; if (row < t) t = row; if (row > b) b = row;
  }
  return n ? { n, box: { left: l / w, top: t / h, right: (r + 1) / w, bottom: (b + 1) / h } } : { n: 0, box: null };
}
window.groundTruth = async (s, c) => {
  const { scene, objects, structure } = await build(s);
  const cam = camera(c);
  const w = c.width, h = c.height;
  for (const m of structure) m.material = new THREE.MeshBasicMaterial({ color: 0x000000 });
  objects.forEach((o, i) => flat(o.root, i));
  const all = pixels(scene, cam, w, h);
  const out = [];
  for (const [i, o] of objects.entries()) {
    const seen = stats(all, w, h, i + 1);
    for (const m of structure) m.visible = false;
    objects.forEach((p) => (p.root.visible = p === o));
    const alone = stats(pixels(scene, cam, w, h), w, h, i + 1);
    for (const m of structure) m.visible = true;
    objects.forEach((p) => (p.root.visible = true));
    // The whole object's 3D box projected, for the edges it is cut off at.
    const box = new THREE.Box3().setFromObject(o.root);
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity, behind = false;
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
      const p = new THREE.Vector3(x, y, z).project(cam);
      if (p.z > 1) behind = true;
      const u = (p.x + 1) / 2, v = (1 - p.y) / 2;
      minU = Math.min(minU, u); maxU = Math.max(maxU, u); minV = Math.min(minV, v); maxV = Math.max(maxV, v);
    }
    const cut = [];
    if (minU < 0) cut.push("left"); if (maxU > 1) cut.push("right"); if (minV < 0) cut.push("top"); if (maxV > 1 || behind) cut.push("bottom");
    out.push({ id: o.id, seen, alone, cut });
  }
  const yaw = s.mat.yaw_deg * Math.PI / 180, cx = s.mat.centre[0], cz = s.mat.centre[1];
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => {
    const lx = a * s.mat.width / 2, lz = b * s.mat.depth / 2;
    const p = new THREE.Vector3(cx + lx * Math.cos(yaw) + lz * Math.sin(yaw), 0, cz - lx * Math.sin(yaw) + lz * Math.cos(yaw)).project(cam);
    return { u: (p.x + 1) / 2, v: (1 - p.y) / 2 };
  });
  return { objects: out, corners };
};
</script></body></html>`;

const MIME: Record<string, string> = { ".js": "text/javascript", ".glb": "model/gltf-binary", ".html": "text/html" };
const server = createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? "/").split("?")[0]!);
  if (url === "/") return void res.writeHead(200, { "content-type": "text/html" }).end(PAGE);
  const file = url.startsWith("/three/") ? join(THREE, url.slice(7)) : url.startsWith("/build/") ? join(BUILD, url.slice(7)) : "";
  if (!file || !existsSync(file)) return void res.writeHead(404).end();
  res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
});
await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
const port = (server.address() as { port: number }).port;

const round = (v: number, d = 4) => Math.round(v * 10 ** d) / 10 ** d;
const scenes = (JSON.parse(readFileSync(join(BUILD, "manifest.json"), "utf8")) as { scenes: Scene[] }).scenes;
const only = process.argv[2];
mkdirSync(join(OUT, "photos"), { recursive: true });
mkdirSync(join(OUT, "annotations"), { recursive: true });
const browser = await chromium.launch({ args: ["--use-angle=metal", "--enable-gpu"] });
const page = await browser.newPage();
await page.goto(`http://127.0.0.1:${port}/`);
await page.waitForFunction(() => "groundTruth" in window);
for (const s of scenes) {
  for (const c of s.cameras) {
    const name = `${s.id}-${c.id}`;
    if (only && !name.startsWith(only)) continue;
    const dataUrl = await page.evaluate(([sc, ca]) => (window as unknown as { renderPhoto: (s: unknown, c: unknown) => Promise<string> }).renderPhoto(sc, ca), [s, c] as const);
    const jpeg = Buffer.from(dataUrl.split(",")[1]!, "base64");
    writeFileSync(join(OUT, "photos", `${name}.jpg`), jpeg);
    const truth = await page.evaluate(([sc, ca]) => (window as unknown as { groundTruth: (s: unknown, c: unknown) => Promise<unknown> }).groundTruth(sc, ca), [s, c] as const);
    const gt = truth as { objects: { id: string; seen: { n: number; box: Record<string, number> | null }; alone: { n: number; box: Record<string, number> | null }; cut: string[] }[]; corners: { u: number; v: number }[] };
    // The mat's frame: origin at its centre, +x along corner 0 -> 1, +z along corner 1 -> 2.
    const yaw = (s.mat.yaw_deg * Math.PI) / 180;
    const ex = [Math.cos(yaw), -Math.sin(yaw)];
    const ez = [Math.sin(yaw), Math.cos(yaw)];
    const objects = s.objects.map((o) => {
      const g = gt.objects.find((x) => x.id === o.id)!;
      const fraction = g.alone.n ? g.seen.n / g.alone.n : 0;
      const visibility = g.seen.n === 0 ? (g.alone.n === 0 ? "out_of_frame" : "mostly_hidden") : fraction >= 0.9 && g.cut.length === 0 ? "visible" : fraction >= 0.25 ? "partly_visible" : "mostly_hidden";
      const box = g.seen.box ? { left: round(g.seen.box.left!), top: round(g.seen.box.top!), right: round(g.seen.box.right!), bottom: round(g.seen.box.bottom!) } : null;
      const big = box !== null && (box.right - box.left) * c.width >= 16 && (box.bottom - box.top) * c.height >= 16;
      const counted = (visibility === "visible" || visibility === "partly_visible") && big;
      const dx = o.position[0] - s.mat.centre[0];
      const dz = o.position[1] - s.mat.centre[1];
      return {
        id: o.id,
        class: o.class,
        centre_m: [round(dx * ex[0]! + dz * ex[1]!), round(dx * ez[0]! + dz * ez[1]!)],
        yaw_deg: round(o.yaw_deg - s.mat.yaw_deg, 3),
        size: { width_m: o.size[0], depth_m: o.size[2], height_m: o.size[1] },
        tolerance_m: 0,
        method: "render_exact",
        visibility,
        visible_fraction: round(fraction, 3),
        visible_box: box,
        amodal_box: g.alone.box ? { left: round(g.alone.box.left!), top: round(g.alone.box.top!), right: round(g.alone.box.right!), bottom: round(g.alone.box.bottom!) } : null,
        cut_off: g.cut,
        on_floor: true,
        counted,
        reason: counted ? null : visibility === "out_of_frame" ? "outside the photo" : visibility === "mostly_hidden" ? "less than a quarter of it shows" : "its visible outline is under 16 px",
        notes: [],
      };
    });
    const annotation = {
      format: "rws-img03-annotation/1",
      image: {
        file: `${name}.jpg`,
        sha256: createHash("sha256").update(jpeg).digest("hex"),
        width_px: c.width,
        height_px: c.height,
        stratum: "synthetic",
        scene_type: s.scene_type,
        split: s.split,
        rights: { source: "Rendered by this project from docs/assist-evaluation/img-03/scenes.json", license: "Project-owned render", analysis_permitted: true, publishable: true },
        local_only: false,
      },
      camera: { position_m: c.position, target_m: c.target, vertical_fov_deg: c.vfov_deg, source: "render camera (exact)" },
      rectangle: {
        feature: "floor mat",
        corners: gt.corners.map((p) => ({ u: round(p.u, 6), v: round(p.v, 6) })),
        width_m: s.mat.width,
        depth_m: s.mat.depth,
        tolerance_m: 0,
        method: "render_exact",
        measured_by: "exact: the render's own geometry",
      },
      objects,
      notes: ["Synthetic: exact geometry from the scene definition; not a measurement of a real site."],
    };
    writeFileSync(join(OUT, "annotations", `${name}.annotation.json`), `${JSON.stringify(annotation, null, 1)}\n`);
    const counted = objects.filter((o) => o.counted).length;
    console.log(`${name}: ${objects.length} objects, ${counted} counted (${objects.filter((o) => o.visibility === "partly_visible").length} partly visible)`);
  }
}
await browser.close();
server.close();
