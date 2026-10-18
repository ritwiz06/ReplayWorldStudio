// Run Replay World Studio on this computer, for you only: build the web app once and serve it
// from the local API on http://127.0.0.1:8000 (loopback: not reachable from other machines).
//   pnpm start               build, then serve
//   pnpm start --no-build    serve the last build
// Your files stay in data/sources; the API reads your .env as in development (a Voyager key
// there turns the optional AI features on). Stop with Ctrl+C.
import { spawnSync, spawn } from "node:child_process";
import { createConnection } from "node:net";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const dist = join(root, "apps/web/dist-local");
const port = process.env.RWS_API_PORT || "8000";

// Something already listening (often an older API left running) would make the server fail later.
const busy = await new Promise((resolve) => {
  const socket = createConnection({ host: "127.0.0.1", port: Number(port) });
  socket.once("connect", () => (socket.destroy(), resolve(true)));
  socket.once("error", () => resolve(false));
});
if (busy) {
  console.error(`Port ${port} is already in use on this computer (perhaps an API you started earlier).`);
  console.error(`Stop that process, or choose another port:  RWS_API_PORT=8001 pnpm start`);
  process.exit(1);
}

if (!process.argv.includes("--no-build") || !existsSync(join(dist, "index.html"))) {
  console.log("Building the web app…");
  const built = spawnSync("pnpm", ["--filter", "@replay-world/web", "exec", "vite", "build", "--outDir", "dist-local", "--emptyOutDir"], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, VITE_API_BASE_URL: "/" },
  });
  if (built.status !== 0) process.exit(built.status ?? 1);
}

console.log(`\nReplay World Studio: open http://127.0.0.1:${port} (only on this computer). Ctrl+C to stop.\n`);
const server = spawn("uv", ["run", "python", "-m", "replay_world_api"], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, RWS_WEB_DIR: dist, RWS_API_HOST: "127.0.0.1", RWS_API_PORT: port },
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.kill(signal));
server.on("exit", (code) => process.exit(code ?? 0));
