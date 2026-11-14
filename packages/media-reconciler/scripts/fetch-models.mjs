import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const modelsDir = resolve(here, "../../../models");
const target = resolve(modelsDir, "nudenet-320n.onnx");
const url = "https://github.com/notAI-tech/NudeNet/releases/download/v3.4-weights/320n.onnx";

if (existsSync(target)) {
  console.log(`model present: ${target}`);
} else {
  mkdirSync(modelsDir, { recursive: true });
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`download failed: ${res.status} ${res.statusText}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(target));
  console.log(`model saved: ${target}`);
}
