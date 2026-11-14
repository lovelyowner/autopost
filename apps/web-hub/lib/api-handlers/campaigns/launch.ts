import { NextRequest, NextResponse } from "next/server";
import { profileForPlatform } from "@polypost/ai-caption-spinner";
import { getPlatform } from "@polypost/platform-registry";
import {
  buildFunnelFlow,
  isSimulationDisabled,
  parseAccountAndTargetOverride,
  QUEUE_NAMES,
  saveCampaignState,
  varyCaptionForAccountSibling,
  type CampaignStateSnapshot,
} from "@polypost/node-api-worker";
import { getSharedFunnelEngine, getSharedRedis, hasConfiguredRedis } from "@/lib/redis-singleton";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      masterPlatformId = "youtube",
      teaserPlatformIds = [],
      masterMb = 350,
      topic = "PolyPost Campaign",
      captions = {},
      mediaPath = "",
      accountId = "default",
      accountOverrides = {},
      tags = [],
      confirmed2257Attestation = false,
      recordsId2257 = "",
      strictLive = false,
      postFirstComment = false,
      firstCommentTemplate = "",
      autoReconcile = true,
      startSec = 0,
      staggerSec = 0,
      delayMinutes = 0,
      delayMs = 0,
      priceUsd = 0,
      priceOverrides = {},
      appendUtm = false,
      existingMasterUrl = "",
      watermark,
    } = body;

    const effectiveStrictLive = Boolean(strictLive) || isSimulationDisabled();
    const trimmedExistingMasterUrl = String(existingMasterUrl || "").trim();
    const numericStartSec = Math.max(0, Number(startSec) || 0);
    const numericStaggerSec = Math.max(0, Number(staggerSec) || 0);
    const numericPriceUsd = Math.max(0, Number(priceUsd) || 0);
    const cleanPriceOverrides: Record<string, number> = {};
    if (priceOverrides && typeof priceOverrides === "object") {
      for (const [k, v] of Object.entries(priceOverrides)) {
        const n = Number(v);
        if (!Number.isNaN(n) && n > 0) cleanPriceOverrides[k] = n;
      }
    }
    const numericDelayMs = Math.max(
      0,
      Number(delayMs) || Math.round((Number(delayMinutes) || 0) * 60_000),
    );
    const normalizedWatermark =
      watermark && (watermark.text || watermark.pngPath)
        ? {
            text: watermark.text ? String(watermark.text) : undefined,
            pngPath: watermark.pngPath ? String(watermark.pngPath) : undefined,
            position: watermark.position || "bottom-right",
          }
        : undefined;

    const allTargetIds = [masterPlatformId, ...teaserPlatformIds];
    const requires2257 = allTargetIds.some((id) => getPlatform(id).requiresAdultTaxonomy);
    if (requires2257 && !confirmed2257Attestation) {
      return NextResponse.json(
        {
          success: false,
          error: "2257_ATTESTATION_REQUIRED",
          message:
            "One or more selected adult platforms require explicit 18 U.S.C. 2257 custodian attestation before launch.",
        },
        { status: 428 },
      );
    }

    const campaignId = `camp_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const masterPlatform = getPlatform(masterPlatformId);
    const redis = hasConfiguredRedis() ? getSharedRedis() : null;
    const overridesMap: Record<string, string> =
      accountOverrides && typeof accountOverrides === "object" ? accountOverrides : {};

    const parseAccountAliases = (raw: string | undefined, fallback: string): string[] => {
      const source = raw && raw.trim() ? raw : fallback;
      const list = Array.from(
        new Set(
          String(source || "default")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        ),
      );
      return list.length > 0 ? list : ["default"];
    };

    const masterAliases = parseAccountAliases(overridesMap[masterPlatformId], accountId);
    const primaryMasterAlias = masterAliases[0];
    const extraMasterAliases = masterAliases.slice(1);

    let teaserIndex = 0;
    const childTeasers: Array<{
      jobId: string;
      platformId: string;
      platformName: string;
      accountId: string;
      targetSubreddit?: string;
      targetUrlOverride?: string;
      captionTemplate: string;
      status: "queued";
      queue: string;
    }> = [];

    // If the user specified multiple aliases for the master platform (e.g. 5 Rumble/Pornhub accounts),
    // queue the 2nd..Nth master accounts as parallel child jobs too (unless using an existing master URL).
    if (!trimmedExistingMasterUrl) {
      for (const extraAlias of extraMasterAliases) {
        teaserIndex++;
        const parsedMaster = parseAccountAndTargetOverride(extraAlias);
        const masterProfile = profileForPlatform(masterPlatform);
        const rawCaption =
          captions[masterPlatformId] || captions[masterProfile] || captions.tube_seo || topic;
        childTeasers.push({
          jobId: `${campaignId}_teaser_${teaserIndex}`,
          platformId: masterPlatformId,
          platformName: `${masterPlatform.name} (@${parsedMaster.accountId})`,
          accountId: parsedMaster.accountId,
          targetSubreddit: parsedMaster.targetSubreddit,
          targetUrlOverride: parsedMaster.targetUrlOverride,
          captionTemplate: rawCaption,
          status: "queued" as const,
          queue: QUEUE_NAMES.LIGHTWEIGHT_SOCIAL,
        });
      }
    }

    for (const tid of teaserPlatformIds) {
      const pl = getPlatform(tid);
      const profile = profileForPlatform(pl);
      const rawCaption = captions[tid] || captions[profile] || captions.microblog || topic;
      const targetAliases = parseAccountAliases(overridesMap[tid], accountId);

      targetAliases.forEach((targetAlias, siblingIdx) => {
        teaserIndex++;
        const parsedTarget = parseAccountAndTargetOverride(targetAlias);
        const subSuffix = parsedTarget.targetSubreddit ? ` r/${parsedTarget.targetSubreddit}` : "";
        childTeasers.push({
          jobId: `${campaignId}_teaser_${teaserIndex}`,
          platformId: tid,
          platformName:
            targetAliases.length > 1 || parsedTarget.targetSubreddit
              ? `${pl.name} (@${parsedTarget.accountId}${subSuffix})`
              : pl.name,
          accountId: parsedTarget.accountId,
          targetSubreddit: parsedTarget.targetSubreddit,
          targetUrlOverride: parsedTarget.targetUrlOverride,
          captionTemplate: varyCaptionForAccountSibling(rawCaption, siblingIdx),
          status: "queued" as const,
          queue: QUEUE_NAMES.LIGHTWEIGHT_SOCIAL,
        });
      });
    }

    const initialSnapshot: CampaignStateSnapshot = {
      campaignId,
      topic,
      masterPlatformId,
      accountId: parseAccountAndTargetOverride(primaryMasterAlias).accountId,
      mediaPath,
      existingMasterUrl: trimmedExistingMasterUrl || undefined,
      firstCommentTemplate: String(firstCommentTemplate || "").trim() || undefined,
      priceOverrides: cleanPriceOverrides,
      accountOverrides: Object.keys(overridesMap).length > 0 ? overridesMap : undefined,
      step: trimmedExistingMasterUrl ? "broadcasting_teasers" : "uploading_master",
      uploadPercent: trimmedExistingMasterUrl ? 100 : 10,
      liveMasterUrl: trimmedExistingMasterUrl || undefined,
      masterSimulated: trimmedExistingMasterUrl ? false : undefined,
      teasers: childTeasers.map((t: any) => ({
        jobId: t.jobId,
        platformId: t.platformId,
        platformName: t.platformName,
        accountId: t.accountId,
        status: "queued",
        injectedCaption: t.captionTemplate,
      })),
      updatedAt: Date.now(),
    };
    await saveCampaignState(redis, initialSnapshot);

    const masterProfile = profileForPlatform(masterPlatform);
    const extraParams = {
      confirmed_2257_attestation: Boolean(confirmed2257Attestation),
      records_id_2257: recordsId2257 || undefined,
      dryRun: !effectiveStrictLive,
    };

    let queuedInRedis = false;
    try {
      if (!redis) {
        throw new Error("REDIS_URL is not configured on this Vercel deployment.");
      }
      const engine = getSharedFunnelEngine();
      const flow = buildFunnelFlow({
        campaignId,
        strictLive: effectiveStrictLive,
        autoReconcile: Boolean(autoReconcile),
        startSec: numericStartSec,
        staggerSec: numericStaggerSec,
        priceUsd: numericPriceUsd > 0 ? numericPriceUsd : undefined,
        priceOverrides: cleanPriceOverrides,
        appendUtm: Boolean(appendUtm),
        firstCommentTemplate: String(firstCommentTemplate || "").trim() || undefined,
        existingMasterUrl: trimmedExistingMasterUrl || undefined,
        delayMs: numericDelayMs > 0 ? numericDelayMs : undefined,
        watermark: normalizedWatermark,
        accountOverrides: overridesMap,
        masterTarget: {
          jobId: `${campaignId}_master`,
          platformId: masterPlatformId,
          accountId: primaryMasterAlias,
          title: topic,
          description: captions[masterPlatformId] || captions[masterProfile] || captions.tube_seo || topic,
          filePath: mediaPath,
          tags,
          strictLive: effectiveStrictLive,
          extraParams,
        },
        teaserTargets: childTeasers.map((t: any) => ({
          jobId: t.jobId,
          platformId: t.platformId,
          accountId: t.accountId,
          targetUrlOverride: t.targetUrlOverride,
          captionTemplate: t.captionTemplate,
          filePath: mediaPath,
          tags,
          postFirstComment: Boolean(postFirstComment),
          strictLive: effectiveStrictLive,
          autoReconcile: Boolean(autoReconcile),
          startSec: numericStartSec,
          staggerSec: numericStaggerSec,
          watermark: normalizedWatermark,
          extraParams: t.targetSubreddit
            ? { ...extraParams, subreddit: t.targetSubreddit }
            : extraParams,
        })),
      });
      await engine.flowProducer.add(flow);
      queuedInRedis = true;
    } catch (err: any) {
      if (effectiveStrictLive) {
        return NextResponse.json(
          { success: false, error: `Strict Live requires active Redis/BullMQ queue: ${err.message}` },
          { status: 503 },
        );
      }

      // Clean offline fallback state progression when Redis is unreachable in demo mode
      const fallbackUrl = `https://${masterPlatformId}.example.com/p/sim_${Date.now().toString().slice(-8)}`;
      setTimeout(() => {
        void saveCampaignState(redis, {
          campaignId,
          topic,
          masterPlatformId,
          accountId,
          mediaPath,
          step: "completed",
          uploadPercent: 100,
          liveMasterUrl: fallbackUrl,
          masterSimulated: true,
          teasers: childTeasers.map((t: any) => {
            const targetUrl = t.targetUrlOverride || fallbackUrl;
            return {
              jobId: t.jobId,
              platformId: t.platformId,
              platformName: t.platformName,
              status: "published",
              simulated: true,
              injectedCaption: t.captionTemplate.replace(/\{\{LIVE_MASTER_URL\}\}/g, targetUrl),
              publishedUrl: `https://${t.platformId}.example.com/p/sim_${Date.now().toString().slice(-6)}`,
            };
          }),
          updatedAt: Date.now(),
        });
      }, 600);
    }

    return NextResponse.json({
      success: true,
      campaignId,
      queuedInRedis,
      strictLive: effectiveStrictLive,
      status: "orchestrating",
      masterJob: {
        jobId: `${campaignId}_master`,
        platformId: masterPlatformId,
        platformName: masterPlatform.name,
        fileSizeMb: masterMb,
        mediaPath,
        status: "uploading_master",
        queue: QUEUE_NAMES.HEAVY_VIDEO,
      },
      teaserJobs: childTeasers,
      timestamp: Date.now(),
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
