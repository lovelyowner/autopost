import { NextResponse } from "next/server";

export const STEALTH_WORKER_OFFLINE_REASON =
  "Stealth Browser Worker is not connected on this Vercel deployment. Vercel serverless functions cannot launch desktop Chrome or store encrypted browser vaults — run `npm run companion` locally (auto-detected on http://127.0.0.1:8001), run the full local stack (`npm run dev`), or set STEALTH_WORKER_URL to your VPS / tunnel.";

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
