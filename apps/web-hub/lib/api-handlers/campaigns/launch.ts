import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { profileForPlatform } from "@polypost/ai-caption-spinner";
import { getPlatform } from "@polypost/platform-registry";
import {
  buildFirstCommentForTeaser,
  buildFunnelFlow,
  formatMasterUrlForTeaser,
  getConnectorForPlatform,
  isSimulationDisabled,
  parseAccountAndTargetOverride,
  QUEUE_NAMES,
  resolveDataDir,
  rotateTagsForAccountSibling,
  saveCampaignState,
  shouldUseFirstComment,
  varyCaptionForAccountSibling,
  type CampaignStateSnapshot,
  type ConnectorResult,
  type TeaserProgressState,
} from "@polypost/node-api-worker";
import { mapCredentialsForConnector } from "@/lib/credential-mapping";
import { getSharedFunnelEngine, getSharedRedis, hasConfiguredRedis } from "@/lib/redis-singleton";

const MAX_INLINE_MEDIA_BYTES = Math.round(3.6 * 1024 * 1024);

function sanitizeClientCredentials(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string" && v.trim()) {
      out[k] = v.trim();
    }
  }
  return out;
}

function materializeMediaDataUrl(
  campaignId: string,
  mediaDataUrl: unknown,
): { filePath: string; cleanup: () => void } | null {
  if (typeof mediaDataUrl !== "string") return null;
  const match = /^data:(image\/(?:webp|jpeg|jpg|png|gif));base64,([A-Za-z0-9+/=\s]+)$/i.exec(
    mediaDataUrl.trim(),
  );
  if (!match) return null;
  const mime = match[1].toLowerCase();
  const ext = mime === "image/jpeg" ? "jpg" : mime.split("/")[1];
  const rawBuffer = Buffer.from(match[2].replace(/\s+/g, ""), "base64");
  if (rawBuffer.byteLength === 0 || rawBuffer.byteLength > MAX_INLINE_MEDIA_BYTES) {
    return null;
  }
  const uploadsDir = join(resolveDataDir(), "uploads");
  mkdirSync(uploadsDir, { recursive: true });
  const tempPath = join(uploadsDir, `${campaignId}_client.${ext}`);
  writeFileSync(tempPath, rawBuffer);
  return {
    filePath: tempPath,
    cleanup: () => {
      try {
        if (existsSync(tempPath)) unlinkSync(tempPath);
      } catch {
        // Ignore transient cleanup failures in /tmp
      }
    },
  };
}

function isRemoteBrowserPlatform(platformId: string): boolean {
  const pl = getPlatform(platformId);
  return pl.transport === "patchright_stealth" || pl.support === "sau_browser";
}

function injectPlaceholders(
  template: string,
  trackedUrl: string,
  accountId?: string,
  priceUsd?: number,
): string {
  let out = template || "";
  if (accountId) {
    out = out.replace(/\{\{\s*ACCOUNT(?:_ID)?\s*\}\}/gi, accountId);
  }
  if (typeof priceUsd === "number" && priceUsd > 0) {
    out = out.replace(/\{\{\s*PRICE(?:_USD)?\s*\}\}/gi, `$${priceUsd.toFixed(2)}`);
  }
  return out.replace(/\{\{LIVE_MASTER_URL\}\}/g, trackedUrl).trim();
}

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
      clientCredentials,
      mediaDataUrl,
    } = body;

    const flatClientCreds = sanitizeClientCredentials(clientCredentials);

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
      siblingIndex: number;
      targetSubreddit?: string;
      targetUrlOverride?: string;
      captionTemplate: string;
      status: "queued";
      queue: string;
    }> = [];

    // If the user specified multiple aliases for the master platform (e.g. 5 Rumble/Pornhub accounts),
    // queue the 2nd..Nth master accounts as parallel child jobs too (unless using an existing master URL).
    if (!trimmedExistingMasterUrl) {
      extraMasterAliases.forEach((extraAlias, extraIdx) => {
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
          siblingIndex: extraIdx + 1,
          targetSubreddit: parsedMaster.targetSubreddit,
          targetUrlOverride: parsedMaster.targetUrlOverride,
          captionTemplate: varyCaptionForAccountSibling(rawCaption, extraIdx + 1),
          status: "queued" as const,
          queue: QUEUE_NAMES.LIGHTWEIGHT_SOCIAL,
        });
      });
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
          siblingIndex: siblingIdx,
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
    let immediateSnapshot: CampaignStateSnapshot | undefined;
    const serverlessWithoutStealth = Boolean(process.env.VERCEL && !process.env.STEALTH_WORKER_URL);

    if (!redis) {
      // Stateless inline execution on serverless deployments (no Redis/BullMQ worker required):
      // uses visitor browser-supplied credentials + inline compressed image data URL directly.
      const materialized = materializeMediaDataUrl(campaignId, mediaDataUrl);
      const resolvedMediaPath =
        materialized?.filePath || (mediaPath && existsSync(mediaPath) ? String(mediaPath) : undefined);
      const resolvedIsStillImage = Boolean(materialized);

      try {
        let liveMasterUrl = trimmedExistingMasterUrl;
        let masterSimulated = false;
        let masterError: string | undefined;

        if (!liveMasterUrl) {
          if (serverlessWithoutStealth && isRemoteBrowserPlatform(masterPlatformId)) {
            if (effectiveStrictLive) {
              masterError = `${masterPlatform.name} uses desktop browser automation. Connect your Companion Worker URL in Vault, run locally, or paste an Existing Master Post URL.`;
            } else {
              liveMasterUrl = `https://${masterPlatformId}.example.com/p/sim_${Date.now().toString().slice(-8)}`;
              masterSimulated = true;
            }
          } else {
            try {
              const masterCreds = mapCredentialsForConnector(
                masterPlatform.connector,
                flatClientCreds,
              );
              const masterConnector = getConnectorForPlatform(masterPlatformId);
              const masterRes = await masterConnector.publish({
                platformId: masterPlatformId,
                accountId: parseAccountAndTargetOverride(primaryMasterAlias).accountId,
                text: String(
                  captions[masterPlatformId] || captions[masterProfile] || captions.tube_seo || topic,
                ),
                filePath: resolvedMediaPath,
                isStillImage: resolvedIsStillImage,
                tags,
                strictLive: effectiveStrictLive,
                credentials: masterCreds,
                extraParams,
              });
              if (!masterRes.success || !masterRes.publishedUrl) {
                masterError =
                  masterRes.error || `Master publish failed on ${masterPlatform.name}.`;
              } else {
                liveMasterUrl = masterRes.publishedUrl;
                masterSimulated = Boolean(masterRes.simulated);
              }
            } catch (err: any) {
              masterError = err?.message || `Master publish error on ${masterPlatform.name}.`;
            }
          }
        }

        if (masterError || !liveMasterUrl) {
          const failedSnapshot: CampaignStateSnapshot = {
            ...initialSnapshot,
            step: "failed",
            uploadPercent: 0,
            masterError: masterError || "No master URL produced.",
            teasers: initialSnapshot.teasers.map((ts) => ({
              ...ts,
              status: "failed",
              error: `Skipped: ${masterError || "Master upload failed"}`,
            })),
            updatedAt: Date.now(),
          };
          await saveCampaignState(null, failedSnapshot);
          return NextResponse.json(
            {
              success: false,
              campaignId,
              error: failedSnapshot.masterError,
              immediateSnapshot: failedSnapshot,
            },
            { status: effectiveStrictLive ? 422 : 200 },
          );
        }

        const teaserResults: TeaserProgressState[] = await Promise.all(
          childTeasers.map(async (t): Promise<TeaserProgressState> => {
            const pl = getPlatform(t.platformId);
            const effectiveMasterUrl = t.targetUrlOverride?.trim() || liveMasterUrl;
            const trackedMasterUrl = formatMasterUrlForTeaser(
              effectiveMasterUrl,
              t.platformId,
              t.accountId,
              Boolean(appendUtm),
            );
            const effectivePrice =
              cleanPriceOverrides[t.platformId] ||
              (numericPriceUsd > 0 ? numericPriceUsd : undefined);
            const useFirstComment = shouldUseFirstComment(
              t.platformId,
              Boolean(postFirstComment),
            );
            const resolvedFirstComment = buildFirstCommentForTeaser({
              postFirstComment: useFirstComment,
              platformId: t.platformId,
              trackedMasterUrl,
              firstCommentTemplate: String(firstCommentTemplate || "").trim() || undefined,
              siblingIndex: t.siblingIndex,
              accountId: t.accountId,
              priceUsd: effectivePrice,
            });
            const resolvedCaption = useFirstComment
              ? injectPlaceholders(
                  t.captionTemplate.replace(/\{\{LIVE_MASTER_URL\}\}/g, ""),
                  trackedMasterUrl,
                  t.accountId,
                  effectivePrice,
                )
              : injectPlaceholders(
                  t.captionTemplate,
                  trackedMasterUrl,
                  t.accountId,
                  effectivePrice,
                );
            const displayCaption = useFirstComment && resolvedFirstComment
              ? `${resolvedCaption} (1st comment: ${resolvedFirstComment})`
              : resolvedCaption;

            if (serverlessWithoutStealth && isRemoteBrowserPlatform(t.platformId)) {
              if (!effectiveStrictLive) {
                return {
                  jobId: t.jobId,
                  platformId: t.platformId,
                  platformName: t.platformName,
                  accountId: t.accountId,
                  status: "published",
                  simulated: true,
                  injectedCaption: displayCaption,
                  publishedUrl: `https://${t.platformId}.example.com/p/sim_${Date.now().toString().slice(-6)}`,
                };
              }
              return {
                jobId: t.jobId,
                platformId: t.platformId,
                platformName: t.platformName,
                accountId: t.accountId,
                status: "failed",
                injectedCaption: displayCaption,
                error: `${pl.name} requires your local/tunnel Companion Worker URL in Vault (desktop browser platform).`,
              };
            }

            try {
              const teaserCreds = mapCredentialsForConnector(pl.connector, flatClientCreds);
              const connector = getConnectorForPlatform(t.platformId);
              const res: ConnectorResult = await connector.publish({
                platformId: t.platformId,
                accountId: t.accountId,
                text: resolvedCaption || `Watch the full video on ${masterPlatform.name}`,
                linkUrl: trackedMasterUrl,
                filePath: resolvedMediaPath,
                isStillImage: resolvedIsStillImage,
                tags: rotateTagsForAccountSibling(tags, t.siblingIndex),
                strictLive: effectiveStrictLive,
                firstComment: resolvedFirstComment,
                credentials: teaserCreds,
                extraParams: t.targetSubreddit
                  ? { ...extraParams, subreddit: t.targetSubreddit }
                  : extraParams,
              });
              return {
                jobId: t.jobId,
                platformId: t.platformId,
                platformName: t.platformName,
                accountId: t.accountId,
                status: res.success ? "published" : "failed",
                publishedUrl: res.publishedUrl,
                simulated: res.simulated,
                firstCommentUrl: res.firstCommentUrl,
                failureScreenshot: res.failureScreenshot,
                injectedCaption: displayCaption,
                error: res.error,
              };
            } catch (err: any) {
              return {
                jobId: t.jobId,
                platformId: t.platformId,
                platformName: t.platformName,
                accountId: t.accountId,
                status: "failed",
                injectedCaption: displayCaption,
                error: err?.message || `Failed to publish to ${pl.name}`,
              };
            }
          }),
        );

        const anySuccess = teaserResults.some((t) => t.status === "published");
        const allFailed = teaserResults.length > 0 && !anySuccess;
        immediateSnapshot = {
          ...initialSnapshot,
          step: allFailed ? "failed" : "completed",
          uploadPercent: 100,
          liveMasterUrl,
          masterSimulated,
          teasers: teaserResults,
          updatedAt: Date.now(),
        };
        await saveCampaignState(null, immediateSnapshot);
      } finally {
        materialized?.cleanup();
      }
    } else {
      try {
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
            credentials: mapCredentialsForConnector(masterPlatform.connector, flatClientCreds),
            extraParams,
          },
          teaserTargets: childTeasers.map((t) => ({
            jobId: t.jobId,
            platformId: t.platformId,
            accountId: t.accountId,
            siblingIndex: t.siblingIndex,
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
            credentials: mapCredentialsForConnector(
              getPlatform(t.platformId).connector,
              flatClientCreds,
            ),
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
            teasers: childTeasers.map((t) => {
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
    }

    return NextResponse.json({
      success: true,
      campaignId,
      queuedInRedis,
      executedStatelessly: Boolean(immediateSnapshot),
      immediateSnapshot,
      strictLive: effectiveStrictLive,
      status: immediateSnapshot?.step || "orchestrating",
      masterJob: {
        jobId: `${campaignId}_master`,
        platformId: masterPlatformId,
        platformName: masterPlatform.name,
        fileSizeMb: masterMb,
        mediaPath,
        status: immediateSnapshot?.liveMasterUrl ? "completed" : "uploading_master",
        queue: QUEUE_NAMES.HEAVY_VIDEO,
      },
      teaserJobs: immediateSnapshot?.teasers || childTeasers,
      timestamp: Date.now(),
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
