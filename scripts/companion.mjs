import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const WORKER_DIR = join(ROOT, "apps", "stealth-browser-worker");
const HOST = process.env.COMPANION_HOST || "127.0.0.1";
const PORT = process.env.COMPANION_PORT || "8001";

function resolvePythonBin() {
  const candidates =
    process.platform === "win32"
      ? [join(ROOT, ".venv", "Scripts", "python.exe"), "python"]
      : [join(ROOT, ".venv", "bin", "python"), "python3", "python"];

  for (const cand of candidates) {
    if (!cand.includes("/") && !cand.includes("\\")) return cand;
    if (existsSync(cand)) return cand;
  }
  return "python3";
}

const pythonBin = resolvePythonBin();

console.log("===============================================================");
console.log(" PolyPost Local Browser Companion");
console.log(` Listening on http://${HOST}:${PORT}`);
console.log(" Safe mode: cookies (./profiles), proxies, Chrome & uploads stay local.");
console.log(" Open https://autopost-gilt-gamma.vercel.app (or http://localhost:3000)");
console.log(" -> PolyPost auto-detects :8001 in your browser.");
console.log("===============================================================");

const child = spawn(
  pythonBin,
  ["-m", "uvicorn", "src.api:app", "--host", HOST, "--port", PORT],
  {
    cwd: WORKER_DIR,
    stdio: "inherit",
    env: { ...process.env, PYTHONPATH: "." },
  },
);

child.on("exit", (code) => {
  process.exit(code ?? 0);
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    try {
      child.kill(sig);
    } catch {
      process.exit(0);
    }
  });
}
