import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadMergedRootEnv } from "./load-env.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const procs = [];

const rootEnv = loadMergedRootEnv(root);
const localNodeDir = resolve(root, ".tools/node-v22.11.0-linux-x64/bin");
if (existsSync(localNodeDir)) {
  rootEnv.PATH = `${localNodeDir}:${rootEnv.PATH || ""}`;
}

function run(name, cmd, args, cwd = root, env = rootEnv) {
  const p = spawn(cmd, args, {
    cwd,
    stdio: "inherit",
    env: { ...env, FORCE_COLOR: "1" },
  });
  p.on("error", (err) => console.error(`[${name}] error:`, err.message));
  p.on("exit", (code) => console.log(`[${name}] exited with code ${code}`));
  procs.push(p);
  return p;
}

const redisBin = resolve(root, ".tools/redis-7.4.1/src/redis-server");
if (existsSync(redisBin)) {
  console.log("[PolyPost] Launching local Redis daemon...");
  run("redis", redisBin, [
    "--port",
    "6379",
    "--daemonize",
    "no",
    "--stop-writes-on-bgsave-error",
    "no",
    "--save",
    "",
  ]);
}

console.log("[PolyPost] Launching Stealth Browser Worker (FastAPI on :8001)...");
const pythonBin = existsSync(resolve(root, ".venv/bin/python"))
  ? resolve(root, ".venv/bin/python")
  : "python3";

run(
  "stealth-worker",
  pythonBin,
  ["-m", "uvicorn", "src.api:app", "--host", "0.0.0.0", "--port", "8001"],
  resolve(root, "apps/stealth-browser-worker"),
  { ...rootEnv, PYTHONPATH: resolve(root, "apps/stealth-browser-worker") },
);

const nodeBinPath = existsSync(resolve(localNodeDir, "node"))
  ? resolve(localNodeDir, "node")
  : "node";
const viteNodeCli = resolve(root, "node_modules/vite-node/dist/cli.mjs");
if (existsSync(viteNodeCli)) {
  console.log("[PolyPost] Launching Node BullMQ FunnelEngine Worker...");
  run("node-worker", nodeBinPath, [viteNodeCli, "apps/node-api-worker/src/server.ts"], root, rootEnv);
}

console.log("[PolyPost] Launching Next.js Web Hub (on :3000)...");
console.log("[PolyPost] Open App -> http://localhost:3000 (Settings & Plans -> http://localhost:3000/settings)");
const npxBin = existsSync(resolve(localNodeDir, "npx"))
  ? resolve(localNodeDir, "npx")
  : "npx";

run("web-hub", npxBin, ["next", "dev", "-H", "0.0.0.0", "-p", "3000"], resolve(root, "apps/web-hub"), rootEnv);

function shutdown() {
  console.log("\n[PolyPost] Shutting down services...");
  procs.forEach((p) => {
    try {
      p.kill("SIGTERM");
    } catch {}
  });
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
