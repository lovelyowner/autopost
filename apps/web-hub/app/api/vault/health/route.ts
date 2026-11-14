import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const stealthUrl = process.env.STEALTH_WORKER_URL || "http://localhost:8001";
  try {
    const body = await req.json();
    const res = await fetch(`${stealthUrl}/api/sessions/health`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        account_id: body.account_id || "default",
        platform: body.platform || "generic",
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const data = await res.json();
    if (!res.ok) {
      return NextResponse.json(
        { healthy: false, reason: data.detail || "Session health check failed" },
        { status: res.status },
      );
    }
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json(
      { healthy: false, reason: `Stealth worker unreachable: ${err.message}` },
      { status: 502 },
    );
  }
}
