import { NextRequest, NextResponse } from "next/server";
import * as events from "@/lib/api-handlers/campaigns/events";
import * as failures from "@/lib/api-handlers/campaigns/failures";
import * as history from "@/lib/api-handlers/campaigns/history";
import * as launch from "@/lib/api-handlers/campaigns/launch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string[] }> };

export async function GET(req: NextRequest, context: Ctx) {
  const { slug } = await context.params;
  if (slug.length === 1 && slug[0] === "history") return history.GET(req);
  if (slug.length === 2 && slug[0] === "failures") {
    return failures.GET(req, { params: Promise.resolve({ filename: slug[1] }) });
  }
  if (slug.length === 2 && slug[1] === "events") {
    return events.GET(req, { params: Promise.resolve({ id: slug[0] }) });
  }
  return NextResponse.json({ error: "Campaign route not found" }, { status: 404 });
}

export async function POST(req: NextRequest, context: Ctx) {
  const { slug } = await context.params;
  if (slug.length === 1 && slug[0] === "launch") return launch.POST(req);
  return NextResponse.json({ error: "Campaign route not found" }, { status: 404 });
}

export async function DELETE(req: NextRequest, context: Ctx) {
  const { slug } = await context.params;
  if (slug.length === 1 && slug[0] === "history") return history.DELETE(req);
  return NextResponse.json({ error: "Campaign route not found" }, { status: 404 });
}
