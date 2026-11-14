import { NextRequest, NextResponse } from "next/server";
import {
  deleteCampaignHistory,
  deleteSimulatedCampaignHistory,
  getCampaignHistoryEntry,
  loadCampaignHistory,
} from "@polypost/node-api-worker";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const campaignId = searchParams.get("campaignId");

  if (campaignId) {
    const entry = getCampaignHistoryEntry(campaignId);
    if (!entry) {
      return NextResponse.json({ error: `Campaign '${campaignId}' not found` }, { status: 404 });
    }
    return NextResponse.json({ entry });
  }

  const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit")) || 50));
  const history = loadCampaignHistory(limit);
  const summary = {
    total: history.length,
    completed: history.filter((h) => h.step === "completed").length,
    failed: history.filter((h) => h.step === "failed").length,
    liveRuns: history.filter((h) => h.masterSimulated === false).length,
    simulatedRuns: history.filter((h) => h.masterSimulated === true).length,
  };

  return NextResponse.json({ history, summary });
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("mode");
  if (mode === "simulated") {
    const result = deleteSimulatedCampaignHistory();
    return NextResponse.json({ success: true, ...result });
  }
  const campaignId = searchParams.get("campaignId") || undefined;
  const result = deleteCampaignHistory(campaignId);
  return NextResponse.json({ success: true, ...result });
}
