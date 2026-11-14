import { NextResponse } from "next/server";

const STEALTH_WORKER_URL = process.env.STEALTH_WORKER_URL || "http://127.0.0.1:8001";

export async function POST() {
  try {
    const res = await fetch(`${STEALTH_WORKER_URL}/api/sessions/audit-all`, {
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
