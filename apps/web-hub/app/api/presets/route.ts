import { NextRequest, NextResponse } from "next/server";
import { deletePreset, loadPresets, upsertPreset, type PresetProfile } from "@/lib/config-store";

export async function GET() {
  return NextResponse.json({ presets: loadPresets() });
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<PresetProfile>;
    if (!body.name) {
      return NextResponse.json({ error: "Preset name is required" }, { status: 400 });
    }
    const saved: PresetProfile = {
      id: body.id || `preset_custom_${Date.now()}`,
      name: body.name,
      recordsId2257: body.recordsId2257 || "REC-2257-VAULT-NOVA-2026",
      custodianContact: body.custodianContact || "compliance@studionova.example.com",
      ppvPriceUsd: Number(body.ppvPriceUsd) || 14.99,
      watermarkPngPath: body.watermarkPngPath || "/watermarks/nova_corner_white.png",
      watermarkPosition: body.watermarkPosition || "bottom-right",
      seoTags: Array.isArray(body.seoTags) ? body.seoTags : [],
      masterPlatformId: body.masterPlatformId,
      targetPlatforms: body.targetPlatforms,
      accountId: body.accountId,
      accountOverrides: body.accountOverrides,
      priceOverrides: body.priceOverrides,
      captionOverrides: body.captionOverrides,
      firstCommentTemplate: body.firstCommentTemplate,
      existingMasterUrl: body.existingMasterUrl,
      staggerSec: body.staggerSec,
    };
    const presets = upsertPreset(saved);
    return NextResponse.json({ success: true, saved, presets });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Preset id query param required" }, { status: 400 });
  }
  const presets = deletePreset(id);
  return NextResponse.json({ success: true, presets });
}
