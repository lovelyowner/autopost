import { NextRequest, NextResponse } from "next/server";

export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ accountId: string }> },
) {
  const stealthUrl = process.env.STEALTH_WORKER_URL || "http://localhost:8001";
  const { accountId } = await context.params;
  try {
    const res = await fetch(`${stealthUrl}/api/profiles/${encodeURIComponent(accountId)}`, {
      method: "DELETE",
      signal: AbortSignal.timeout(10_000),
    });
    const data = await res.json();
    if (!res.ok) {
      return NextResponse.json(
        { deleted: false, detail: data.detail || "Failed to delete vaulted profile" },
        { status: res.status },
      );
    }
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json(
      { deleted: false, detail: `Stealth worker unreachable: ${err.message}` },
      { status: 502 },
    );
  }
}
