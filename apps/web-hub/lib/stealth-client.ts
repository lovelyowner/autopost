import { NextResponse } from "next/server";

export const STEALTH_WORKER_OFFLINE_REASON =
  "Stealth Browser Worker is not connected on this Vercel deployment. Vercel serverless functions cannot launch desktop Chrome or store encrypted browser vaults — run PolyPost locally (node scripts/dev.mjs) or host apps/stealth-browser-worker on a VPS / tunnel and set STEALTH_WORKER_URL in Vercel Environment Variables.";

/** Resolve configured Stealth Browser Worker URL, returning empty string on Vercel when unset. */
export function getStealthWorkerUrl(): string {
  const configured = process.env.STEALTH_WORKER_URL?.trim();
  if (configured) {
    return configured.replace(/\/+$/, "");
  }
  return process.env.VERCEL ? "" : "http://127.0.0.1:8001";
}

/** Build a standardized 503 response when the Stealth Worker is unconfigured in cloud mode. */
export function stealthWorkerOfflineJson(extra: Record<string, unknown> = {}, status = 503) {
  return NextResponse.json(
    {
      offline: true,
      detail: STEALTH_WORKER_OFFLINE_REASON,
      error: STEALTH_WORKER_OFFLINE_REASON,
      ...extra,
    },
    { status },
  );
}
