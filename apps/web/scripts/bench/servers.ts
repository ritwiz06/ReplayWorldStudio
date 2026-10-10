// Production build plus local API and `vite preview` servers for the benchmark and the visual review.
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { mkdirSync, openSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const WEB_DIR = fileURLToPath(new URL("../..", import.meta.url));
export const REPO = resolve(WEB_DIR, "../..");
export const API_PORT = 8020;
/** Not 4190: browsers refuse that port (Fetch "bad ports"). */
export const WEB_PORT = 4183;
export const BASE = `http://127.0.0.1:${WEB_PORT}`;

const children: ChildProcess[] = [];
export const stopServers = () => children.forEach((child) => child.kill("SIGTERM"));
process.on("exit", stopServers);
process.on("SIGINT", () => process.exit(130));

export const pause = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/** Build the web app for production into `webOut`, pointed at the benchmark API port. */
export function buildWeb(webOut: string) {
  execFileSync("pnpm", ["exec", "vite", "build", "--outDir", webOut, "--emptyOutDir"], {
    cwd: WEB_DIR,
    stdio: "inherit",
    env: { ...process.env, VITE_API_BASE_URL: `http://127.0.0.1:${API_PORT}` },
  });
}

/** Generate synthetic benchmark scenes (demo plus N catalog instances) into `dir`. */
export function buildScenes(dir: string, extras: number[]) {
  if (extras.length === 0) return;
  execFileSync("uv", ["run", "python", "scripts/build_benchmark_scenes.py", dir, ...extras.map(String)], { cwd: REPO, stdio: "inherit" });
}

async function waitFor(url: string) {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // not up yet
    }
    await pause(500);
  }
  throw new Error(`${url} did not start`);
}

/** Start the API and the preview server for a built app; logs go to `logDir`. */
export async function startServers(webOut: string, logDir: string) {
  mkdirSync(logDir, { recursive: true });
  const serve = (name: string, command: string, args: string[], cwd: string, env: Record<string, string>) => {
    const log = openSync(join(logDir, `${name}.log`), "w");
    children.push(spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", log, log] }));
  };
  serve("api", "uv", ["run", "python", "-m", "replay_world_api"], REPO, { RWS_API_PORT: String(API_PORT), RWS_CORS_ORIGINS: BASE });
  serve("web", "pnpm", ["exec", "vite", "preview", "--outDir", webOut, "--port", String(WEB_PORT), "--strictPort"], WEB_DIR, {});
  await waitFor(`http://127.0.0.1:${API_PORT}/health`);
  await waitFor(BASE);
}

/** Chrome flags so a window that is covered or unfocused keeps rendering at full rate. */
export const CHROME_ARGS = [
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
  "--disable-background-timer-throttling",
  "--no-first-run",
  "--no-default-browser-check",
];
