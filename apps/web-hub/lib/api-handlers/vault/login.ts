import { NextRequest, NextResponse } from "next/server";
import { getStealthWorkerUrl, stealthWorkerOfflineJson } from "@/lib/stealth-client";

export async function POST(req: NextRequest) {
  const stealthUrl = getStealthWorkerUrl();
  if (!stealthUrl) {
    return stealthWorkerOfflineJson({ success: false });
  }
  try {
    const body = await req.json();
    const timeoutSec = Math.max(15, Math.min(600, Number(body.timeout_sec) || 180));
    const res = await fetch(`${stealthUrl}/api/sessions/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        account_id: body.account_id || "main_creator",
        platform: body.platform || "pornhub_video",
        headless: Boolean(body.headless),
        timeout_sec: timeoutSec,
      }),
      signal: AbortSignal.timeout((timeoutSec + 15) * 1000),
    });
    const data = await res.json();
    if (!res.ok) {
      return NextResponse.json(
        { success: false, detail: data.detail || "Stealth worker failed to launch login browser." },
        { status: res.status },
      );
    }
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json(
      { success: false, detail: `Stealth worker unreachable: ${err.message}` },
      { status: 502 },
    );
  }
}
