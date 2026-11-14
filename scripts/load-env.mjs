import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function ensureVaultSecretKey(rootDir = DEFAULT_ROOT) {
  const envPath = resolve(rootDir, ".env");
  try {
    const existingText = existsSync(envPath) ? readFileSync(envPath, "utf-8") : "# PolyPost Environment Configuration\n";
    if (!/^\s*(?:export\s+)?POLYPOST_SECRET_KEY\s*=\s*\S+/m.test(existingText)) {
      const generated = randomBytes(32).toString("hex");
      const sep = existingText.endsWith("\n") ? "" : "\n";
      writeFileSync(envPath, `${existingText}${sep}POLYPOST_SECRET_KEY=${generated}\n`, {
        encoding: "utf-8",
        mode: 0o600,
      });
    }
    chmodSync(envPath, 0o600);
  } catch {}
}

export function parseRootEnv(rootDir = DEFAULT_ROOT) {
  const envPath = resolve(rootDir, ".env");
  const parsed = {};
  if (!existsSync(envPath)) return parsed;
  for (const raw of readFileSync(envPath, "utf-8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const stripped = line.startsWith("export ") ? line.slice(7).trim() : line;
    const eq = stripped.indexOf("=");
    if (eq <= 0) continue;
    const key = stripped.slice(0, eq).trim();
    let val = stripped.slice(eq + 1).trim();
    if ((val.startsWith("\"") && val.endsWith("\"")) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key) parsed[key] = val;
  }
  return parsed;
}

export function loadMergedRootEnv(rootDir = DEFAULT_ROOT, baseEnv = process.env) {
  ensureVaultSecretKey(rootDir);
  const parsed = parseRootEnv(rootDir);
  const merged = { ...baseEnv };
  for (const [key, val] of Object.entries(parsed)) {
    if (!(key in merged) || merged[key] === "") {
      merged[key] = val;
    }
  }
  return merged;
}

export function applyRootEnv(rootDir = DEFAULT_ROOT) {
  const parsed = parseRootEnv(rootDir);
  for (const [key, val] of Object.entries(parsed)) {
    if (!process.env[key]) {
      process.env[key] = val;
    }
  }
}
