import { NextRequest, NextResponse } from "next/server";
import { getStealthWorkerUrl, stealthWorkerOfflineJson } from "@/lib/stealth-client";

export async function GET() {
  const stealthUrl = getStealthWorkerUrl();
  if (!stealthUrl) {
    return NextResponse.json({ accounts: {}, offline: true });
  }
  try {
    const res = await fetch(`${stealthUrl}/api/proxies`, {
      signal: AbortSignal.timeout(4000),
      cache: "no-store",
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err: any) {
    return NextResponse.json(
      { detail: `Unable to reach Stealth Browser Worker: ${err.message}` },
      { status: 503 },
    );
  }
}

export async function POST(req: NextRequest) {
  const stealthUrl = getStealthWorkerUrl();
  if (!stealthUrl) {
    return stealthWorkerOfflineJson();
  }
  try {
    const body = await req.json();
    const res = await fetch(`${stealthUrl}/api/proxies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err: any) {
    return NextResponse.json(
      { detail: `Unable to save proxy on Stealth Browser Worker: ${err.message}` },
      { status: 503 },
    );
  }
}
