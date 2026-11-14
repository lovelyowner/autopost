import { NextRequest, NextResponse } from "next/server";
import { getPlatform } from "@polypost/platform-registry";
import { buildFunnelFlow, isSimulationDisabled } from "@polypost/node-api-worker";
import {
  addScheduledItems,
  deleteScheduledItem,
  loadSchedule,
  type ScheduledItem,
} from "@/lib/config-store";
import { getSharedFunnelEngine } from "@/lib/redis-singleton";

export async function GET() {
  return NextResponse.json({ items: loadSchedule() });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const rawItems: Array<Partial<ScheduledItem>> = Array.isArray(body.items) ? body.items : [body];
    if (rawItems.length === 0) {
      return NextResponse.json({ error: "No schedule items provided" }, { status: 400 });
    }

    const confirmed2257Attestation = Boolean(body.confirmed2257Attestation);
    const recordsId2257 = typeof body.recordsId2257 === "string" ? body.recordsId2257.trim() : "";
    const effectiveStrictLive = Boolean(body.strictLive) || isSimulationDisabled();

    const requires2257 = rawItems.some((item) =>
      (item.platforms || []).some((pid) => getPlatform(pid).requiresAdultTaxonomy),
    );
    if (requires2257 && !confirmed2257Attestation) {
      return NextResponse.json(
        {
          success: false,
          error: "2257_ATTESTATION_REQUIRED",
          message:
            "Scheduled batch targets one or more adult platforms and requires explicit 18 U.S.C. 2257 custodian attestation.",
        },
        { status: 428 },
      );
    }

    const builtItems: ScheduledItem[] = [];
    for (let i = 0; i < rawItems.length; i++) {
      const r = rawItems[i];
      if (!r.title || !r.platforms || r.platforms.length === 0) continue;

      const id = r.id || `sched_${Date.now()}_${i}`;
      const masterPlatformId = r.masterPlatformId || r.platforms[0];
      const teaserPlatforms = r.platforms.filter((p) => p !== masterPlatformId);
      let queuedJobId: string | undefined;

      // Compute delay from YYYY-MM-DD + HH:MM (UTC)
      const timeClean = (r.time || "12:00 UTC").replace(/\s*UTC$/i, "").trim();
      const targetMs = Date.parse(`${r.date}T${timeClean}:00Z`);
      const delayMs = Number.isFinite(targetMs) ? Math.max(0, targetMs - Date.now()) : 0;

      if (body.enqueueInRedis !== false && delayMs > 0) {
        try {
          const engine = getSharedFunnelEngine();
          const flow = buildFunnelFlow({
            campaignId: id,
            delayMs,
            strictLive: effectiveStrictLive,
            masterTarget: {
              jobId: `${id}_master`,
              platformId: masterPlatformId,
              accountId: r.accountId || "default",
              title: r.title,
              description: r.title,
              filePath: r.mediaPath || "",
              extraParams: {
                confirmed_2257_attestation: confirmed2257Attestation,
                records_id_2257: recordsId2257 || undefined,
                dryRun: !effectiveStrictLive,
              },
            },
            teaserTargets: teaserPlatforms.map((pid, idx) => ({
              jobId: `${id}_teaser_${idx + 1}`,
              platformId: pid,
              accountId: r.accountId || "default",
              captionTemplate: `${r.title} - Full release live: {{LIVE_MASTER_URL}}`,
              filePath: r.mediaPath || "",
            })),
          });
          const added = await engine.flowProducer.add(flow);
          queuedJobId = added.job.id;
        } catch {
          // Persist locally even if Redis is offline
        }
      }

      builtItems.push({
        id,
        title: r.title,
        date: r.date || new Date().toISOString().slice(0, 10),
        time: r.time || "12:00 UTC",
        platforms: r.platforms,
        masterPlatformId,
        mediaPath: r.mediaPath,
        accountId: r.accountId,
        status: "scheduled",
        queuedJobId,
        createdAt: Date.now(),
      });
    }

    const items = addScheduledItems(builtItems);
    return NextResponse.json({ success: true, addedCount: builtItems.length, items });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Schedule id query param required" }, { status: 400 });
  }
  const items = deleteScheduledItem(id);
  return NextResponse.json({ success: true, items });
}
