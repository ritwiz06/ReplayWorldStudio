// Builds the catalog's glTF models deterministically and records their hashes and bounds.
//
//   pnpm assets:build   write assets/catalog/models/*.glb and manifest.json
//   pnpm assets:check   fail if the committed files differ from a fresh build
//
// The demo fixture copies each model's sha256 and bounds from manifest.json, so a rebuilt
// model must be followed by `pnpm fixtures:build`.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { REVISION } from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { assemble } from "./kit.ts";
import { MODELS } from "./models.ts";

// GLTFExporter reads its output through the browser FileReader API; Node only has Blob.
class NodeFileReader {
  result: ArrayBuffer | string | null = null;
  onloadend: (() => void) | null = null;
  readAsArrayBuffer(blob: Blob): void {
    void blob.arrayBuffer().then((buffer) => {
      this.result = buffer;
      this.onloadend?.();
    });
  }
  readAsDataURL(blob: Blob): void {
    void blob.arrayBuffer().then((buffer) => {
      this.result = `data:${blob.type || "application/octet-stream"};base64,${Buffer.from(buffer).toString("base64")}`;
      this.onloadend?.();
    });
  }
}
(globalThis as { FileReader?: unknown }).FileReader ??= NodeFileReader;

const GENERATOR = "apps/web/scripts/catalog/build.ts";
const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const modelsDir = join(repoRoot, "assets/catalog/models");
const check = process.argv.includes("--check");

const outputs: [path: string, bytes: Buffer][] = [];
const manifest = {
  generator: GENERATOR,
  three_revision: REVISION,
  conventions: { units: "metres", up_axis: "+Y", front_axis: "+Z", origin: "bottom_centre" },
  models: [] as unknown[],
};

for (const definition of MODELS) {
  const model = assemble(definition.key, definition.build(), {
    asset: definition.key,
    generator: GENERATOR,
    units: "metres",
    up_axis: "+Y",
    front_axis: "+Z",
    origin: "bottom_centre",
  });
  const glb = Buffer.from((await new GLTFExporter().parseAsync(model.scene, { binary: true })) as ArrayBuffer);
  const uri = `models/${definition.key}.glb`;
  outputs.push([join(repoRoot, "assets/catalog", uri), glb]);
  const [min, max] = [model.bounds.min, model.bounds.max];
  manifest.models.push({
    key: definition.key,
    name: definition.name,
    uri,
    sha256: createHash("sha256").update(glb).digest("hex"),
    bytes: glb.length,
    triangles: model.triangles,
    materials: model.materials,
    bounds_m: { min: { x: min[0], y: min[1], z: min[2] }, max: { x: max[0], y: max[1], z: max[2] } },
  });
}
outputs.push([join(modelsDir, "manifest.json"), Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`)]);

if (check) {
  const stale = outputs.filter(([path, bytes]) => {
    try {
      return !readFileSync(path).equals(bytes);
    } catch {
      return true;
    }
  });
  for (const [path] of stale) console.error(`Out of date: ${relative(repoRoot, path)}`);
  if (stale.length > 0) {
    console.error("Run `pnpm assets:build`, then `pnpm fixtures:build`, and commit the result.");
    process.exit(1);
  }
  console.log(`Catalog models are up to date (${MODELS.length} models, three r${REVISION}).`);
} else {
  mkdirSync(modelsDir, { recursive: true });
  for (const [path, bytes] of outputs) {
    writeFileSync(path, bytes);
    console.log(`Wrote ${relative(repoRoot, path)} (${bytes.length} bytes)`);
  }
}
