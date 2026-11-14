import { execFileSync } from "node:child_process";
import { NextResponse } from "next/server";
import { readMaskedCredentialSummary } from "@polypost/node-api-worker";
import { pingRedisFast } from "@/lib/redis-singleton";
import { getStealthWorkerUrl } from "@/lib/stealth-client";

export const dynamic = "force-dynamic";

export async function GET() {
  const redisOk = await pingRedisFast(1500);
  const stealthUrl = getStealthWorkerUrl();

  let stealthOk = false;
  let vaultProfilesCount = 0;
  if (stealthUrl) {
    try {
      const res = await fetch(`${stealthUrl}/api/profiles`, {
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
    cloudMode: Boolean(process.env.VERCEL),
    redis: redisOk,
    stealthWorker: stealthOk,
    ffmpeg: ffmpegOk,
    vaultProfilesCount,
    apiProvidersConfigured,
    timestamp: Date.now(),
  });
}
