import { NextRequest, NextResponse } from "next/server";
import { getStealthWorkerUrl, stealthWorkerOfflineJson } from "@/lib/stealth-client";

export async function POST(req: NextRequest) {
  const stealthUrl = getStealthWorkerUrl();
  if (!stealthUrl) {
    return stealthWorkerOfflineJson({ signaled: false });
  }
  try {
    const body = await req.json();
    const res = await fetch(`${stealthUrl}/api/sessions/login/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        account_id: body.account_id || "main_creator",
      }),
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json();
    if (!res.ok) {
      return NextResponse.json(
        { signaled: false, detail: data.detail || "No active login session found." },
        { status: res.status },
      );
    }
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json(
      { signaled: false, detail: `Stealth worker unreachable: ${err.message}` },
      { status: 502 },
    );
  }
}
