import { NextRequest, NextResponse } from "next/server";
import { getStealthWorkerUrl, stealthWorkerOfflineJson } from "@/lib/stealth-client";

export async function POST(req: NextRequest) {
  const stealthUrl = getStealthWorkerUrl();
  if (!stealthUrl) {
    return stealthWorkerOfflineJson({ success: false });
  }
  try {
    const body = await req.json();
    const res = await fetch(`${stealthUrl}/api/sessions/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        account_id: body.account_id || "main_creator",
        platform: body.platform || "pornhub_video",
        cookies_json: body.cookies_json,
      }),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json();
    if (!res.ok) {
      return NextResponse.json(
        { success: false, detail: data.detail || "Failed to import browser cookies." },
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
