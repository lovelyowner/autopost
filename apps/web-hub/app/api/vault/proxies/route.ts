import { NextRequest, NextResponse } from "next/server";

const STEALTH_WORKER_URL = process.env.STEALTH_WORKER_URL ?? "http://localhost:8001";

export async function GET() {
  try {
    const res = await fetch(`${STEALTH_WORKER_URL}/api/proxies`, {
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
  try {
    const body = await req.json();
    const res = await fetch(`${STEALTH_WORKER_URL}/api/proxies`, {
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
