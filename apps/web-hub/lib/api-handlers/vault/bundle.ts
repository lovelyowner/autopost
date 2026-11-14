import { NextRequest, NextResponse } from "next/server";
import { loadPresets, upsertPreset } from "@/lib/config-store";
import { getStealthWorkerUrl } from "@/lib/stealth-client";

export async function GET() {
  const stealthUrl = getStealthWorkerUrl();
  try {
    const presets = loadPresets();
    let vaultBundle: Record<string, any> = { profiles: [], proxies: {}, offline: !stealthUrl };
    if (stealthUrl) {
      try {
        const res = await fetch(`${stealthUrl}/api/vault/bundle`, { cache: "no-store" });
        if (res.ok) {
          vaultBundle = await res.json();
        }
      } catch {}
    }
    return NextResponse.json({
      version: 1,
      exportedAt: Math.floor(Date.now() / 1000),
      presets,
      vault: vaultBundle,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Failed to export bundle" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const stealthUrl = getStealthWorkerUrl();
  try {
    const body = await req.json();
    let restoredPresets = 0;
    if (Array.isArray(body?.presets)) {
      for (const p of body.presets) {
        if (p && p.name) {
          upsertPreset(p);
          restoredPresets++;
        }
      }
    }

    let restoredProfiles = 0;
    let restoredProxies = 0;
    const vaultPayload = body?.vault || (Array.isArray(body?.profiles) ? body : null);
    if (vaultPayload && stealthUrl) {
      const res = await fetch(`${stealthUrl}/api/vault/bundle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(vaultPayload),
      });
      if (res.ok) {
        const vData = await res.json();
        restoredProfiles = Number(vData.restored_profiles) || 0;
        restoredProxies = Number(vData.restored_proxies) || 0;
      }
    }

    return NextResponse.json({
      ok: true,
      restoredPresets,
      restoredProfiles,
      restoredProxies,
      stealthOffline: !stealthUrl,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Failed to import bundle" }, { status: 400 });
  }
}
