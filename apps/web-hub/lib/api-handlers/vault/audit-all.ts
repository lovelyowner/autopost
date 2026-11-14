import { NextResponse } from "next/server";
import { getStealthWorkerUrl, stealthWorkerOfflineJson } from "@/lib/stealth-client";

export async function POST() {
  const stealthUrl = getStealthWorkerUrl();
  if (!stealthUrl) {
    return stealthWorkerOfflineJson({ ok: false, profiles: [] });
  }
  try {
    const res = await fetch(`${stealthUrl}/api/sessions/audit-all`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Stealth browser worker unreachable" },
      { status: 502 },
    );
  }
}
