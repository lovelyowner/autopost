import { NextRequest, NextResponse } from "next/server";
import * as auditAll from "@/lib/api-handlers/vault/audit-all";
import * as bundle from "@/lib/api-handlers/vault/bundle";
import * as health from "@/lib/api-handlers/vault/health";
import * as vaultImport from "@/lib/api-handlers/vault/import";
import * as inspect from "@/lib/api-handlers/vault/inspect";
import * as login from "@/lib/api-handlers/vault/login";
import * as loginComplete from "@/lib/api-handlers/vault/login-complete";
import * as preview from "@/lib/api-handlers/vault/preview";
import * as profileDelete from "@/lib/api-handlers/vault/profile-delete";
import * as proxies from "@/lib/api-handlers/vault/proxies";
import * as proxiesTest from "@/lib/api-handlers/vault/proxies-test";
import * as selectors from "@/lib/api-handlers/vault/selectors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string[] }> };

export async function GET(req: NextRequest, context: Ctx) {
  const { slug } = await context.params;
  if (slug.length === 1 && slug[0] === "bundle") return bundle.GET();
  if (slug.length === 1 && slug[0] === "proxies") return proxies.GET();
  if (slug.length === 1 && slug[0] === "selectors") return selectors.GET(req);
  if (slug.length === 2 && slug[0] === "preview") {
    return preview.GET(req, { params: Promise.resolve({ filename: slug[1] }) });
  }
  return NextResponse.json({ error: "Vault route not found" }, { status: 404 });
}

export async function POST(req: NextRequest, context: Ctx) {
  const { slug } = await context.params;
  if (slug.length === 1 && slug[0] === "audit-all") return auditAll.POST();
  if (slug.length === 1 && slug[0] === "bundle") return bundle.POST(req);
  if (slug.length === 1 && slug[0] === "health") return health.POST(req);
  if (slug.length === 1 && slug[0] === "import") return vaultImport.POST(req);
  if (slug.length === 1 && slug[0] === "inspect") return inspect.POST(req);
  if (slug.length === 1 && slug[0] === "login") return login.POST(req);
  if (slug.length === 2 && slug[0] === "login" && slug[1] === "complete") {
    return loginComplete.POST(req);
  }
  if (slug.length === 1 && slug[0] === "proxies") return proxies.POST(req);
  if (slug.length === 2 && slug[0] === "proxies" && slug[1] === "test") {
    return proxiesTest.POST(req);
  }
  return NextResponse.json({ error: "Vault route not found" }, { status: 404 });
}

export async function PUT(req: NextRequest, context: Ctx) {
  const { slug } = await context.params;
  if (slug.length === 1 && slug[0] === "selectors") return selectors.PUT(req);
  return NextResponse.json({ error: "Vault route not found" }, { status: 404 });
}

export async function DELETE(req: NextRequest, context: Ctx) {
  const { slug } = await context.params;
  if (slug.length === 1 && slug[0] === "selectors") return selectors.DELETE(req);
  if (slug.length === 2 && slug[0] === "profiles") {
    return profileDelete.DELETE(req, { params: Promise.resolve({ accountId: slug[1] }) });
  }
  return NextResponse.json({ error: "Vault route not found" }, { status: 404 });
}
