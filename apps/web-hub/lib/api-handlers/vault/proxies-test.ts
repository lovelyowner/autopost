import { NextRequest, NextResponse } from "next/server";
import { getStealthWorkerUrl, stealthWorkerOfflineJson } from "@/lib/stealth-client";

export async function POST(req: NextRequest) {
  const stealthUrl = getStealthWorkerUrl();
  if (!stealthUrl) {
    return stealthWorkerOfflineJson({ ok: false });
  }
  try {
    const body = await req.json();
    const res = await fetch(`${stealthUrl}/api/proxies/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(6000),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: `Unable to test proxy via Stealth Worker: ${err.message}` },
      { status: 503 },
    );
  }
}
