import { NextRequest, NextResponse } from "next/server";

const STEALTH_WORKER_URL = process.env.STEALTH_WORKER_URL ?? "http://localhost:8001";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const res = await fetch(`${STEALTH_WORKER_URL}/api/proxies/test`, {
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
