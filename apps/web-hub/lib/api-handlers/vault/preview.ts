import { NextRequest, NextResponse } from "next/server";
import { getStealthWorkerUrl, stealthWorkerOfflineJson } from "@/lib/stealth-client";

const SAFE_PNG_NAME = /^[a-zA-Z0-9._-]+\.png$/;

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ filename: string }> },
) {
  const { filename } = await context.params;
  if (!SAFE_PNG_NAME.test(filename)) {
    return NextResponse.json({ error: "Invalid preview filename" }, { status: 400 });
  }

  const stealthUrl = getStealthWorkerUrl();
  if (!stealthUrl) {
    return stealthWorkerOfflineJson();
  }
  try {
    const res = await fetch(`${stealthUrl}/api/previews/${encodeURIComponent(filename)}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      return NextResponse.json({ error: "Preview screenshot not found" }, { status: res.status });
    }
    const buf = await res.arrayBuffer();
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-cache",
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
