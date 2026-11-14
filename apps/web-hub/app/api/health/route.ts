import { execFileSync } from "node:child_process";
import { NextResponse } from "next/server";
import { readMaskedCredentialSummary } from "@polypost/node-api-worker";
import { getSharedRedis } from "@/lib/redis-singleton";

export const dynamic = "force-dynamic";

const STEALTH_WORKER_URL = process.env.STEALTH_WORKER_URL || "http://127.0.0.1:8001";

export async function GET() {
  let redisOk = false;
  try {
    const redis = getSharedRedis();
    if (redis) {
      const pong = await redis.ping();
      redisOk = pong === "PONG";
    }
  } catch {
    redisOk = false;
  }

  let stealthOk = false;
  let vaultProfilesCount = 0;
  try {
    const res = await fetch(`${STEALTH_WORKER_URL}/api/sessions`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2000),
    });
    if (res.ok) {
      stealthOk = true;
      const data = await res.json();
      if (Array.isArray(data?.profiles)) {
        vaultProfilesCount = data.profiles.length;
      }
    }
  } catch {
    stealthOk = false;
  }

  let ffmpegOk = false;
  try {
    execFileSync("ffmpeg", ["-version"], { timeout: 2000, stdio: "ignore" });
    ffmpegOk = true;
  } catch {
    ffmpegOk = false;
  }

  let apiProvidersConfigured = 0;
  try {
    const summary = readMaskedCredentialSummary();
    apiProvidersConfigured = (summary.providers || []).filter(
      (p) => p.id !== "openrouter" && Boolean(p.configured),
    ).length;
  } catch {}

  return NextResponse.json({
    ok: redisOk && stealthOk && ffmpegOk,
    redis: redisOk,
    stealthWorker: stealthOk,
    ffmpeg: ffmpegOk,
    vaultProfilesCount,
    apiProvidersConfigured,
    timestamp: Date.now(),
  });
}
