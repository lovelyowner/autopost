import { NextRequest, NextResponse } from "next/server";
import {
  CREDENTIAL_PROVIDERS,
  readMaskedCredentialSummary,
  upsertRootEnvCredentials,
} from "@polypost/node-api-worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VERCEL_ENV_READONLY_MSG =
  "Vercel cloud deployments use a read-only filesystem and cannot edit .env files from the browser. Add your platform API keys in Vercel Project Settings -> Environment Variables and redeploy, or run PolyPost locally (node scripts/dev.mjs).";

export async function GET() {
  return NextResponse.json({
    cloudMode: Boolean(process.env.VERCEL),
    ...readMaskedCredentialSummary(),
  });
}

export async function POST(req: NextRequest) {
  if (process.env.VERCEL) {
    return NextResponse.json({ success: false, error: VERCEL_ENV_READONLY_MSG }, { status: 400 });
  }
  try {
    const body = await req.json();
    const values =
      body?.values && typeof body.values === "object"
        ? body.values
        : body?.updates && typeof body.updates === "object"
          ? body.updates
          : {};
    const res = upsertRootEnvCredentials(values);
    return NextResponse.json({
      success: true,
      updatedKeys: res.updatedKeys,
      removedKeys: res.removedKeys,
      ...readMaskedCredentialSummary(),
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  if (process.env.VERCEL) {
    return NextResponse.json({ success: false, error: VERCEL_ENV_READONLY_MSG }, { status: 400 });
  }
  try {
    const providerId = req.nextUrl.searchParams.get("provider")?.trim() || "";
    const spec = CREDENTIAL_PROVIDERS.find((p) => p.id === providerId);
    if (!spec) {
      return NextResponse.json({ success: false, error: `Unknown provider '${providerId}'.` }, { status: 400 });
    }
    const clearMap: Record<string, null> = {};
    for (const f of spec.fields) {
      clearMap[f.key] = null;
    }
    const res = upsertRootEnvCredentials(clearMap);
    return NextResponse.json({
      success: true,
      removedKeys: res.removedKeys,
      ...readMaskedCredentialSummary(),
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 400 });
  }
}
