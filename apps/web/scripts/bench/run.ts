// Reproducible rendering benchmark on a real, hardware-accelerated browser (WRL-04).
//
//   pnpm bench                                   default: 5 runs each of the demo and demo+15
//   pnpm bench -- --scenes 0,15,45,105 --runs 3 --viewport 1440x900@2 --label baseline
//   pnpm bench -- --uncapped                     also lift vsync to show headroom
//
// It builds the production bundle, starts the API (port 8020) and `vite preview` (port 4183),
// generates synthetic benchmark scenes (scripts/build_benchmark_scenes.py), and drives headed
// Google Chrome. Every run uses a fresh browser context (cold cache) and measures, in order:
// load milestones; opening the benchmark scene (if any); then idle, orbit, top-view pan, walk
// and an edit-handle drag, each a fixed-length window of paced input with frame intervals,
// draw calls, long animation frames, main-thread and process CPU time. Raw results go to
// bench-results/<label>/results.json and a summary to summary.md (git-ignored).
//
// Headless or software-rendered browsers are refused: the GPU must report hardware WebGL.
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { release } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { gzipSync } from "node:zlib";
import { type CDPSession, chromium, type Page } from "@playwright/test";
import { type FrameWindow, instrument } from "./instrument.ts";
import { BASE, buildScenes, buildWeb, CHROME_ARGS, pause, REPO, startServers, stopServers } from "./servers.ts";
import { type FrameStats, frameStats, median, round, spread } from "./stats.ts";

const { values: options } = parseArgs({
  options: {
    runs: { type: "string", default: "5" },
    scenes: { type: "string", default: "0,15" },
    viewport: { type: "string", default: "1440x900@2" },
    label: { type: "string", default: new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19) },
    uncapped: { type: "boolean", default: false },
    "window-ms": { type: "string", default: "4000" },
    "skip-build": { type: "boolean", default: false },
  },
});

const repo = REPO;
const out = join(repo, "bench-results", options.label);
const WINDOW_MS = Number(options["window-ms"]);
const RUNS = Number(options.runs);
const SCENES = options.scenes.split(",").map(Number);
const [size, dprText] = options.viewport.split("@");
const [WIDTH, HEIGHT] = size!.split("x").map(Number) as [number, number];
const DPR = Number(dprText ?? 1);

function bundleSize(dir: string) {
  const assets = join(dir, "assets");
  let raw = 0;
  let gzip = 0;
  for (const name of readdirSync(assets)) {
    if (!/\.(js|css)$/.test(name)) continue;
    const bytes = readFileSync(join(assets, name));
    raw += bytes.length;
    gzip += gzipSync(bytes).length;
  }
  const models = join(repo, "assets/catalog/models");
  const glb = readdirSync(models)
    .filter((n) => n.endsWith(".glb"))
    .reduce((sum, n) => sum + statSync(join(models, n)).size, 0);
  return { jsCssBytes: raw, jsCssGzipBytes: gzip, catalogGlbBytes: glb };
}

type Bench = {
  start(): void;
  stop(): FrameWindow;
  marks: Record<string, number>;
  gpu(): unknown;
  complexity(): Record<string, number | null>;
};
const bench = (page: Page) => ({
  start: () => page.evaluate(() => (window as unknown as { __bench: Bench }).__bench.start()),
  stop: () => page.evaluate(() => (window as unknown as { __bench: Bench }).__bench.stop()),
  marks: () => page.evaluate(() => ({ ...(window as unknown as { __bench: Bench }).__bench.marks })),
  gpu: () => page.evaluate(() => (window as unknown as { __bench: Bench }).__bench.gpu()),
  complexity: () => page.evaluate(() => (window as unknown as { __bench: Bench }).__bench.complexity()),
});

async function metrics(session: CDPSession): Promise<Record<string, number>> {
  const { metrics: list } = await session.send("Performance.getMetrics");
  return Object.fromEntries(list.map((m) => [m.name, m.value]));
}

async function processCpu(browserSession: CDPSession) {
  const { processInfo } = await browserSession.send("SystemInfo.getProcessInfo");
  const sum = (type: string) => processInfo.filter((p) => p.type === type).reduce((s, p) => s + p.cpuTime, 0);
  return { browser: sum("browser"), renderer: sum("renderer"), gpu: sum("GPU"), pids: processInfo.map((p) => ({ type: p.type, pid: p.id })) };
}

function rssMb(pids: { type: string; pid: number }[]) {
  const total = (type: string) =>
    pids
      .filter((p) => p.type === type)
      .reduce((sum, { pid }) => {
        try {
          return sum + Number(execFileSync("ps", ["-o", "rss=", "-p", String(pid)], { encoding: "utf8" }).trim()) / 1024;
        } catch {
          return sum;
        }
      }, 0);
  return { renderer: round(total("renderer"), 0), gpu: round(total("GPU"), 0) };
}

interface WindowResult {
  name: string;
  wallMs: number;
  /** Intervals between animation frames (vsync ticks): a long one is a visible hitch. */
  stats: FrameStats;
  /** Frames in which the scene was actually rendered (the canvas renders on demand). */
  renderedFrames: number;
  rendersPerSecond: number;
  /** Intervals between rendered frames, when there were at least two. */
  renderStats: FrameStats | null;
  /** Median over rendered frames. */
  drawCallsPerFrame: number;
  trianglesPerFrame: number;
  longFrames: FrameWindow["longFrames"];
  /** Fraction of wall time the page's main thread was busy (CDP TaskDuration). */
  mainThreadBusy: number;
  scriptBusy: number;
  /** CPU seconds per wall second of the renderer and GPU processes (1.0 = one core). */
  rendererCpu: number;
  gpuProcessCpu: number;
  frames: number[];
}

async function measure(page: Page, session: CDPSession, browserSession: CDPSession, name: string, act: () => Promise<void>): Promise<WindowResult> {
  const m0 = await metrics(session);
  const p0 = await processCpu(browserSession);
  const t0 = performance.now();
  await bench(page).start();
  await act();
  const window = await bench(page).stop();
  const wall = performance.now() - t0;
  const m1 = await metrics(session);
  const p1 = await processCpu(browserSession);
  const seconds = wall / 1000;
  const rendered = window.calls.map((calls, i) => (calls > 0 ? i : -1)).filter((i) => i >= 0);
  const times = window.frames.reduce<number[]>((acc, f) => [...acc, (acc.at(-1) ?? 0) + f], []);
  const renderIntervals = rendered.slice(1).map((i, k) => times[i]! - times[rendered[k]!]!);
  const span = window.frames.reduce((a, b) => a + b, 0) / 1000;
  return {
    name,
    wallMs: round(wall, 0),
    stats: frameStats(window.frames),
    renderedFrames: rendered.length,
    rendersPerSecond: round(rendered.length / span, 1),
    renderStats: renderIntervals.length > 0 ? frameStats(renderIntervals) : null,
    drawCallsPerFrame: rendered.length > 0 ? median(rendered.map((i) => window.calls[i]!)) : 0,
    trianglesPerFrame: rendered.length > 0 ? median(rendered.map((i) => window.triangles[i]!)) : 0,
    longFrames: window.longFrames,
    mainThreadBusy: round((m1.TaskDuration! - m0.TaskDuration!) / seconds, 3),
    scriptBusy: round((m1.ScriptDuration! - m0.ScriptDuration!) / seconds, 3),
    rendererCpu: round((p1.renderer - p0.renderer) / seconds, 3),
    gpuProcessCpu: round((p1.gpu - p0.gpu) / seconds, 3),
    frames: window.frames.map((f) => round(f, 2)),
  };
}

/** Paced pointer drag: ~60 input events per second for `ms`, following `path(t)` with t in [0, 1]. */
async function paced(page: Page, from: [number, number], path: (t: number) => [number, number], ms = WINDOW_MS) {
  await page.mouse.move(...from);
  await page.mouse.down();
  const start = performance.now();
  for (let t = 0; t < 1; t = (performance.now() - start) / ms) {
    const [x, y] = path(t);
    await page.mouse.move(from[0] + x, from[1] + y);
    await pause(16);
  }
  await page.mouse.up();
}

async function center(page: Page): Promise<[number, number]> {
  const box = (await page.getByTestId("viewport").boundingBox())!;
  return [box.x + box.width * 0.5, box.y + box.height * 0.58];
}

async function main() {
  mkdirSync(out, { recursive: true });
  const scenesDir = join(out, "scenes");
  buildScenes(scenesDir, SCENES.filter((n) => n > 0));
  const webOut = join(out, "web");
  if (!options["skip-build"]) buildWeb(webOut);
  await startServers(webOut, out);

  const args = [...CHROME_ARGS];
  if (options.uncapped) args.push("--disable-gpu-vsync", "--disable-frame-rate-limit");
  // A fresh browser (and profile) per scene: run 1 is a first visit with empty HTTP and GPU
  // shader caches; later runs use new contexts (cold HTTP cache) in the same browser.
  const launch = async () => {
    const browser = await chromium.launch({ channel: "chrome", headless: false, args });
    const browserSession = await browser.newBrowserCDPSession();
    return { browser, browserSession };
  };
  const first = await launch();
  const { gpu } = await first.browserSession.send("SystemInfo.getInfo");
  const environment = {
    date: new Date().toISOString(),
    browser: `Google Chrome ${first.browser.version()}`,
    os: `${execFileSync("sw_vers", ["-productName"], { encoding: "utf8" }).trim()} ${execFileSync("sw_vers", ["-productVersion"], { encoding: "utf8" }).trim()} (Darwin ${release()})`,
    cpu: execFileSync("sysctl", ["-n", "machdep.cpu.brand_string"], { encoding: "utf8" }).trim(),
    power: execFileSync("pmset", ["-g", "batt"], { encoding: "utf8" }).split("\n")[0]!.trim(),
    lowPowerMode: /lowpowermode\s+1/.test(execFileSync("pmset", ["-g"], { encoding: "utf8" })),
    viewport: { width: WIDTH, height: HEIGHT, deviceScaleFactor: DPR },
    uncapped: options.uncapped,
    gpuDevices: gpu.devices.map((d) => `${d.vendorString} ${d.deviceString} (driver ${d.driverVersion || "n/a"})`),
    gpuFeatureStatus: gpu.featureStatus,
    bundle: bundleSize(webOut),
    webgl: null as unknown,
  };
  const status = gpu.featureStatus as Record<string, string>;
  if (!String(status.webgl2 ?? status.webgl).startsWith("enabled") || !String(status.gpu_compositing).startsWith("enabled")) {
    throw new Error(`Hardware acceleration is not active: ${JSON.stringify(status)}`);
  }
  console.log(`Chrome ${first.browser.version()} · ${environment.gpuDevices.join("; ")} · ${WIDTH}x${HEIGHT}@${DPR}${options.uncapped ? " · vsync off" : ""}`);
  await first.browser.close();

  const results: Record<string, unknown>[] = [];
  for (const extra of SCENES) {
    const scenePath = extra > 0 ? join(scenesDir, `industrial-demo-plus-${extra}.json`) : null;
    const objectCount = extra > 0 ? (JSON.parse(readFileSync(scenePath!, "utf8")) as { scene: { objects: unknown[] } }).scene.objects.length : 15;
    const { browser, browserSession } = await launch();
    for (let run = 1; run <= RUNS; run++) {
      const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: DPR });
      await context.addInitScript(instrument);
      // Skip the guided start panel (GEN-01): the benchmark measures the editor.
      await context.addInitScript(() => window.localStorage.setItem("rws.start.seen", "1"));
      const page = await context.newPage();
      await page.bringToFront();
      const session = await context.newCDPSession(page);
      await session.send("Performance.enable");

      await page.goto(BASE);
      await page.waitForFunction(() => (window as unknown as { __bench: Bench }).__bench.marks.modelsReady !== undefined, null, { timeout: 60_000 });
      const marks = await bench(page).marks();
      const loadLongFrames = await page.evaluate(() => (window as unknown as { __bench: { loadLongFrames: FrameWindow["longFrames"] } }).__bench.loadLongFrames);
      const resources = await page.evaluate(() =>
        (performance.getEntriesByType("resource") as PerformanceResourceTiming[])
          .filter((r) => /\.glb$|\/fixtures\/|\.js$/.test(r.name))
          .map((r) => ({ name: r.name.replace(/^https?:\/\/[^/]+/, ""), start: Math.round(r.startTime), end: Math.round(r.responseEnd), bytes: r.encodedBodySize })),
      );
      if (environment.webgl === null) environment.webgl = await bench(page).gpu();

      let openMs: number | null = null;
      if (scenePath) {
        const t0 = await page.evaluate(() => performance.now());
        await page.getByTestId("scene-file-input").setInputFiles(scenePath);
        const t1 = await (
          await page.waitForFunction(
            (n) => {
              const status = document.querySelector('[data-testid="scene-status"]')?.textContent;
              const models = document.querySelector('[data-testid="viewport"]')?.getAttribute("data-models");
              return status === `Scene loaded · ${n} objects` && models === "4/4 ready, 0 failed" ? performance.now() : false;
            },
            objectCount,
            { polling: "raf", timeout: 60_000 },
          )
        ).jsonValue();
        openMs = round(Number(t1) - t0, 0);
      }

      await pause(1500);
      const windows: WindowResult[] = [];
      const key = (name: string, keyName: string, settle = 1500) =>
        measure(page, session, browserSession, name, async () => {
          await page.keyboard.press(keyName);
          await pause(settle);
        });
      // Pressing a key and waiting includes any one-off work the change triggers (for example
      // compiling shaders for objects or lighting seen for the first time).
      windows.push(await key("frame-all", "h"));
      windows.push(await measure(page, session, browserSession, "idle", () => pause(WINDOW_MS)));
      const complexity = await bench(page).complexity();

      const [cx, cy] = await center(page);
      windows.push(await measure(page, session, browserSession, "orbit", () => paced(page, [cx, cy], (t) => [220 * Math.sin(t * 4 * Math.PI), 50 * Math.sin(t * 2 * Math.PI)])));
      await pause(800);

      windows.push(await key("switch-top", "2"));
      windows.push(await measure(page, session, browserSession, "top-pan", () => paced(page, [cx, cy], (t) => [160 * Math.sin(t * 4 * Math.PI), 90 * Math.sin(t * 2 * Math.PI)])));
      await pause(500);

      windows.push(await key("switch-walk", "3"));
      windows.push(
        await measure(page, session, browserSession, "walk", async () => {
          await page.keyboard.down("KeyE");
          await page.keyboard.down("KeyW");
          await pause(WINDOW_MS / 2);
          await page.keyboard.up("KeyW");
          await page.keyboard.down("KeyS");
          await pause(WINDOW_MS / 2);
          await page.keyboard.up("KeyS");
          await page.keyboard.up("KeyE");
        }),
      );
      windows.push(await key("switch-orbit", "Escape"));
      await page.keyboard.press("h");
      await pause(900);
      await page.getByRole("button", { name: /^Filling cell/ }).click();
      await page.keyboard.press("m");
      await page.keyboard.press("f");
      await pause(1300);
      const revisionBefore = await page.getByTestId("revision-status").textContent();
      const probe = JSON.parse((await page.getByTestId("viewport").getAttribute("data-handles")) ?? "null") as { points: Record<string, [number, number]> };
      const grip = probe.points["move-xz"]!;
      windows.push(await measure(page, session, browserSession, "handle-drag", () => paced(page, grip, (t) => [70 * Math.sin(t * 2 * Math.PI), 50 * (1 - Math.cos(t * 2 * Math.PI))])));
      await pause(300);
      const revisionAfter = await page.getByTestId("revision-status").textContent();

      const memory = await metrics(session);
      const processes = await processCpu(browserSession);
      const result = {
        scene: extra === 0 ? "demo-15" : `demo+${extra} (${objectCount} objects)`,
        objects: objectCount,
        run,
        load: {
          rendererCreatedMs: round(marks.rendererCreated ?? Number.NaN, 0),
          firstSceneMs: round(marks.firstScene!, 0),
          longFrames: loadLongFrames,
          modelsReadyMs: round(marks.modelsReady!, 0),
          openBenchmarkFileMs: openMs,
          resources,
        },
        complexity,
        windows,
        handleCommit: `${revisionBefore} → ${revisionAfter}`,
        memory: { jsHeapUsedMb: round(memory.JSHeapUsedSize! / 2 ** 20, 1), domNodes: memory.Nodes, rssMb: rssMb(processes.pids) },
      };
      results.push(result);
      const line = windows.map((w) => `${w.name} ${w.stats.medianMs}/${w.stats.p95Ms}${w.stats.over50 ? ` (${w.stats.over50} > 50 ms)` : ""}`).join(" · ");
      console.log(`${result.scene} run ${run}: first scene ${result.load.firstSceneMs} ms, models ${result.load.modelsReadyMs} ms${openMs !== null ? `, open ${openMs} ms` : ""} · ${line} · ${result.handleCommit}`);
      await context.close();
    }
    await browser.close();
  }
  writeFileSync(join(out, "results.json"), JSON.stringify({ environment, results }, null, 2));
  writeFileSync(join(out, "summary.md"), summarise(environment, results as unknown as RunResult[]));
  console.log(`\nWrote ${join(out, "results.json")} and summary.md`);
  stopServers();
}

interface RunResult {
  scene: string;
  objects: number;
  run: number;
  load: { rendererCreatedMs: number; firstSceneMs: number; modelsReadyMs: number; openBenchmarkFileMs: number | null; longFrames: FrameWindow["longFrames"] };
  complexity: Record<string, number | null>;
  windows: WindowResult[];
  memory: { jsHeapUsedMb: number; rssMb: { renderer: number; gpu: number } };
}

function summarise(environment: Record<string, unknown>, results: RunResult[]): string {
  const lines: string[] = [`# Benchmark ${options.label}`, "", "```json", JSON.stringify({ ...environment, bundle: environment.bundle }, null, 2), "```", ""];
  const scenes = [...new Set(results.map((r) => r.scene))];
  lines.push(
    "## Load (ms from navigation start)",
    "",
    "Run 1 of each scene is a first visit in a fresh browser profile (empty HTTP and GPU shader caches); runs 2+ are new contexts in the same browser (cold HTTP cache, warm shader cache). Median (range).",
    "",
    "| Scene | Visit | Runs | Renderer created | First useful scene | All models ready | Long frames during load | Open benchmark file |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
  );
  for (const scene of scenes) {
    for (const [visit, runs] of [
      ["first", results.filter((r) => r.scene === scene && r.run === 1)],
      ["repeat", results.filter((r) => r.scene === scene && r.run > 1)],
    ] as const) {
      if (runs.length === 0) continue;
      const open = runs.map((r) => r.load.openBenchmarkFileMs).filter((v): v is number => v !== null);
      const longest = Math.max(0, ...runs.flatMap((r) => r.load.longFrames.map((f) => f.duration)));
      lines.push(
        `| ${scene} | ${visit} | ${runs.length} | ${spread(runs.map((r) => r.load.rendererCreatedMs), 0)} | ${spread(runs.map((r) => r.load.firstSceneMs), 0)} | ${spread(runs.map((r) => r.load.modelsReadyMs), 0)} | ${runs.reduce((n, r) => n + r.load.longFrames.length, 0)} (longest ${Math.round(longest)} ms) | ${open.length ? spread(open, 0) : "-"} |`,
      );
    }
  }
  lines.push(
    "",
    "## Frame times (ms; median of run medians, p95 as median and max over runs)",
    "",
    "Frame columns are intervals between animation frames (display refreshes); a long one is a visible hitch. Renders/s counts frames in which the scene was drawn (on-demand rendering draws only when something changes).",
    "",
    "| Scene | Window | Median | p95 | p99 max | Max | Frames > 33 ms | Frames > 50 ms | Long animation frames | Renders/s | Draw calls | Triangles | Main thread busy | GPU process CPU |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  );
  for (const scene of scenes) {
    const runs = results.filter((r) => r.scene === scene);
    for (const name of runs[0]!.windows.map((w) => w.name)) {
      const ws = runs.map((r) => r.windows.find((w) => w.name === name)!);
      const total = (f: (w: WindowResult) => number) => ws.reduce((s, w) => s + f(w), 0);
      lines.push(
        `| ${scene} | ${name} | ${spread(ws.map((w) => w.stats.medianMs), 2)} | ${median(ws.map((w) => w.stats.p95Ms)).toFixed(1)} / ${Math.max(...ws.map((w) => w.stats.p95Ms)).toFixed(1)} | ${Math.max(...ws.map((w) => w.stats.p99Ms)).toFixed(1)} | ${Math.max(...ws.map((w) => w.stats.maxMs)).toFixed(1)} | ${total((w) => w.stats.over33)}/${total((w) => w.stats.frames)} | ${total((w) => w.stats.over50)} | ${total((w) => w.longFrames.length)} | ${median(ws.map((w) => w.rendersPerSecond ?? 1000 / w.stats.medianMs)).toFixed(0)} | ${median(ws.map((w) => w.drawCallsPerFrame))} | ${median(ws.map((w) => w.trianglesPerFrame))} | ${(median(ws.map((w) => w.mainThreadBusy)) * 100).toFixed(0)} % | ${(median(ws.map((w) => w.gpuProcessCpu)) * 100).toFixed(0)} % |`,
      );
    }
  }
  lines.push("", "## Scene complexity and memory (first run)", "", "| Scene | Complexity | JS heap MB | RSS renderer / GPU MB |", "| --- | --- | --- | --- |");
  for (const scene of scenes) {
    const r = results.find((x) => x.scene === scene)!;
    lines.push(`| ${scene} | ${Object.entries(r.complexity).map(([k, v]) => `${k} ${v}`).join(", ")} | ${r.memory.jsHeapUsedMb} | ${r.memory.rssMb.renderer} / ${r.memory.rssMb.gpu} |`);
  }
  return `${lines.join("\n")}\n`;
}

await main().catch((error: unknown) => {
  console.error(error);
  stopServers();
  process.exit(1);
});
