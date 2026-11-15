import { NextRequest, NextResponse } from "next/server";
import * as manage from "@/lib/api-handlers/credentials/manage";
import * as oauth from "@/lib/api-handlers/credentials/oauth";
import * as status from "@/lib/api-handlers/credentials/status";
import * as test from "@/lib/api-handlers/credentials/test";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ action: string }> };

export async function GET(_req: NextRequest, context: Ctx) {
  const { action } = await context.params;
  if (action === "manage") return manage.GET();
  if (action === "oauth") return oauth.GET();
  if (action === "status") return status.GET();
  return NextResponse.json({ error: "Credentials route not found" }, { status: 404 });
}

export async function POST(req: NextRequest, context: Ctx) {
  const { action } = await context.params;
  if (action === "manage") return manage.POST(req);
  if (action === "oauth") return oauth.POST(req);
  if (action === "test") return test.POST(req);
  return NextResponse.json({ error: "Credentials route not found" }, { status: 404 });
}

export async function DELETE(req: NextRequest, context: Ctx) {
  const { action } = await context.params;
  if (action === "manage") return manage.DELETE(req);
  return NextResponse.json({ error: "Credentials route not found" }, { status: 404 });
}
