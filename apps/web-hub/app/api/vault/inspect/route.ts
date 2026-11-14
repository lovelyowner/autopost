import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const stealthUrl = process.env.STEALTH_WORKER_URL || "http://localhost:8001";
  try {
    const body = await req.json();
    const res = await fetch(`${stealthUrl}/api/sessions/inspect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        account_id: body.account_id || "default",
        platform: body.platform || "pornhub_video",
        custom_url: body.custom_url || null,
        headless: body.headless ?? true,
      }),
      signal: AbortSignal.timeout(45_000),
    });

    const data = await res.json();
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: data.detail || "Selector inspection failed" },
        { status: res.status },
      );
    }
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: `Stealth worker inspection unreachable: ${err.message}` },
      { status: 502 },
    );
  }
}
