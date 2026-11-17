import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { detectBestH264Encoder, isImagePath, reconcile, type Watermark } from "@polypost/media-reconciler";
import { getPlatform, TEASER_MAX_MB } from "@polypost/platform-registry";
import { FlowProducer, type FlowJob, Queue, UnrecoverableError, Worker, type Job } from "bullmq";
import type { Redis } from "ioredis";
import { getConnectorForPlatform } from "./connectors/registry";
import type { ConnectorResult, PostPayload } from "./connectors/types";
import { reloadRootEnvToProcessEnv } from "./env_store";
import { recordCampaignHistory, resolveDataDir } from "./history_store";

export const QUEUE_NAMES = {
  HEAVY_VIDEO: "polypost-heavy-video-queue",
  LIGHTWEIGHT_SOCIAL: "polypost-lightweight-social-queue",
  DEAD_LETTER: "polypost-dead-letter-queue",
} as const;

export interface MasterJobData {
  jobId: string;
  platformId: string;
  accountId: string;
  title: string;
  description: string;
  filePath: string;
  tags?: string[];
  strictLive?: boolean;
  credentials?: Record<string, string>;
  extraParams?: Record<string, any>;
}

export interface TeaserJobData {
  jobId: string;
  platformId: string;
  accountId: string;
  targetUrlOverride?: string;
  captionTemplate: string;
  filePath?: string;
  isStillImage?: boolean;
  tags?: string[];
  postFirstComment?: boolean;
  firstCommentTemplate?: string;
  strictLive?: boolean;
  autoReconcile?: boolean;
  startSec?: number;
  staggerSec?: number;
  siblingIndex?: number;
  priceUsd?: number;
  appendUtm?: boolean;
  watermark?: Watermark;
  credentials?: Record<string, string>;
  extraParams?: Record<string, any>;
}

export interface FunnelSubmission {
  campaignId: string;
  strictLive?: boolean;
  autoReconcile?: boolean;
  startSec?: number;
  staggerSec?: number;
  priceUsd?: number;
  priceOverrides?: Record<string, number>;
  appendUtm?: boolean;
  firstCommentTemplate?: string;
  existingMasterUrl?: string;
  watermark?: Watermark;
  delayMs?: number;
  accountOverrides?: Record<string, string>;
  masterTarget: MasterJobData;
  teaserTargets: TeaserJobData[];
}

export type CampaignStep = "uploading_master" | "injecting_url" | "broadcasting_teasers" | "completed" | "failed";

export interface TeaserProgressState {
  jobId: string;
  platformId: string;
  platformName?: string;
  accountId?: string;
  status: "queued" | "publishing" | "published" | "failed";
  injectedCaption?: string;
  publishedUrl?: string;
  simulated?: boolean;
  firstCommentUrl?: string;
  failureScreenshot?: string;
  error?: string;
}

export interface CampaignStateSnapshot {
  campaignId: string;
  topic?: string;
  masterPlatformId?: string;
  accountId?: string;
  mediaPath?: string;
  existingMasterUrl?: string;
  firstCommentTemplate?: string;
  priceOverrides?: Record<string, number>;
  accountOverrides?: Record<string, string>;
  step: CampaignStep;
  uploadPercent: number;
  liveMasterUrl?: string;
  masterSimulated?: boolean;
  masterError?: string;
  teasers: TeaserProgressState[];
  updatedAt: number;
}

const CAMPAIGN_KEY_PREFIX = "polypost:campaign:";
const fallbackCampaignState = new Map<string, CampaignStateSnapshot>();

export async function saveCampaignState(redis: Redis | null | undefined, state: CampaignStateSnapshot): Promise<void> {
  fallbackCampaignState.set(state.campaignId, state);
  try {
    recordCampaignHistory(state);
  } catch {
    // Non-fatal if history disk directory is unwritable in restricted test runners
  }
  if (!redis) return;
  try {
    await redis.set(`${CAMPAIGN_KEY_PREFIX}${state.campaignId}`, JSON.stringify(state), "EX", 86400);
  } catch {
    // Non-fatal if Redis is unavailable during unit tests or offline fallback
  }
}

export async function getCampaignState(redis: Redis | null | undefined, campaignId: string): Promise<CampaignStateSnapshot | null> {
  if (redis) {
    try {
      const raw = await redis.get(`${CAMPAIGN_KEY_PREFIX}${campaignId}`);
      if (raw) {
        const parsed = JSON.parse(raw) as CampaignStateSnapshot;
        fallbackCampaignState.set(campaignId, parsed);
        return parsed;
      }
    } catch {
      // Fall back to in-memory snapshot
    }
  }
  return fallbackCampaignState.get(campaignId) ?? null;
}

const SIBLING_HOOK_PREFIXES = [
  "",
  "New release — ",
  "Live now: ",
  "Fresh drop: ",
  "Just posted: ",
  "Studio update — ",
  "Out now: ",
  "New set live: ",
  "Latest cut — ",
  "Full drop: ",
];

const SIBLING_CTA_SUFFIXES = [
  "",
  " ✨",
  " 🔥",
  " ⚡",
  " — check it out",
  " — full version live",
  " (new drop)",
  " — watch now",
  " — unlocked now",
  " (latest release)",
];

/**
 * Prevents identical duplicate text hashes (Sybil / coordinated spam flags) when fanning out
 * a campaign to 2–10+ accounts on the SAME platform (e.g. x_acc_1 .. x_acc_10).
 * Sibling 0 is returned verbatim; siblings 1..N receive natural prefix/suffix and rotated hashtags.
 */
export function varyCaptionForAccountSibling(caption: string, siblingIndex: number): string {
  if (siblingIndex <= 0 || !caption) return caption;
  const prefix = SIBLING_HOOK_PREFIXES[siblingIndex % SIBLING_HOOK_PREFIXES.length];
  const suffix = SIBLING_CTA_SUFFIXES[siblingIndex % SIBLING_CTA_SUFFIXES.length];

  // Rotate any hashtags so hashtag block order is also distinct per account
  const hashtagRegex = /(#[a-zA-Z0-9_]+)/g;
  const tags = caption.match(hashtagRegex) || [];
  let body = caption;
  if (tags.length > 1) {
    const shift = siblingIndex % tags.length;
    const rotated = [...tags.slice(shift), ...tags.slice(0, shift)];
    let idx = 0;
    body = caption.replace(hashtagRegex, () => rotated[idx++] || "");
  }

  if (body.includes("{{LIVE_MASTER_URL}}")) {
    return `${prefix}${body.replace("{{LIVE_MASTER_URL}}", `{{LIVE_MASTER_URL}}${suffix}`)}`.trim();
  }
  return `${prefix}${body}${suffix}`.trim();
}

/**
 * Rotates and varies the tag array order for sibling accounts targeting the same platform
 * so 5–10 accounts never submit an identical ordered tag array.
 */
export function rotateTagsForAccountSibling(
  tags: string[] | undefined,
  siblingIndex: number,
): string[] | undefined {
  if (siblingIndex <= 0 || !Array.isArray(tags) || tags.length <= 1) {
    return tags;
  }
  const shift = siblingIndex % tags.length;
  const rotated = [...tags.slice(shift), ...tags.slice(0, shift)];
  if (rotated.length >= 3 && siblingIndex >= tags.length) {
    // Swap last two items on wrap-around cycles so >N accounts still get unique tag sequences
    const last = rotated.length - 1;
    [rotated[last - 1], rotated[last]] = [rotated[last], rotated[last - 1]];
  }
  return rotated;
}

const STORE_ONLY_NO_SELF_REPLY_PLATFORMS = new Set([
  "manyvids_store",
  "clips4sale",
  "iwantclips",
  "loyalfans_store",
  "onlyfans_ppv",
  "fansly_vault",
  "apclips",
  "modelhub",
  "bentbox",
  "fancentro",
]);

export function shouldUseFirstComment(platformId: string, postFirstComment?: boolean): boolean {
  return Boolean(postFirstComment) && !STORE_ONLY_NO_SELF_REPLY_PLATFORMS.has(platformId);
}

export function buildFirstCommentForTeaser(opts: {
  postFirstComment?: boolean;
  platformId: string;
  trackedMasterUrl: string;
  firstCommentTemplate?: string;
  siblingIndex?: number;
  accountId?: string;
  priceUsd?: number;
}): string | undefined {
  if (!shouldUseFirstComment(opts.platformId, opts.postFirstComment)) {
    return undefined;
  }
  let tpl = opts.firstCommentTemplate?.trim() || "Watch the full video here: {{LIVE_MASTER_URL}}";
  if (!tpl.includes("{{LIVE_MASTER_URL}}")) {
    tpl = `${tpl} {{LIVE_MASTER_URL}}`;
  }
  if (opts.accountId) {
    tpl = tpl.replace(/\{\{\s*ACCOUNT(?:_ID)?\s*\}\}/gi, opts.accountId);
  }
  if (typeof opts.priceUsd === "number" && opts.priceUsd > 0) {
    tpl = tpl.replace(/\{\{\s*PRICE(?:_USD)?\s*\}\}/gi, `$${opts.priceUsd.toFixed(2)}`);
  }
  if ((opts.siblingIndex ?? 0) > 0) {
    tpl = varyCaptionForAccountSibling(tpl, opts.siblingIndex!);
  }
  return tpl.replace(/\{\{LIVE_MASTER_URL\}\}/g, opts.trackedMasterUrl).trim();
}

const lastAccountUploadMap = new Map<string, number>();

export function getAccountCooldownWaitMs(
  platformId: string,
  accountId: string,
  now = Date.now(),
  minSpacingMs = 1500,
): number {
  const key = `${platformId}:${accountId || "default"}`;
  const prev = lastAccountUploadMap.get(key);
  if (!prev) return 0;
  const elapsed = now - prev;
  return elapsed < minSpacingMs ? minSpacingMs - elapsed : 0;
}

export function recordAccountUploadTimestamp(
  platformId: string,
  accountId: string,
  now = Date.now(),
): void {
  const key = `${platformId}:${accountId || "default"}`;
  lastAccountUploadMap.set(key, now);
}

export function formatMasterUrlForTeaser(
  baseUrl: string,
  platformId: string,
  accountId?: string,
  appendUtm?: boolean,
): string {
  if (!appendUtm || !baseUrl || !/^https?:\/\//i.test(baseUrl)) {
    return baseUrl;
  }
  try {
    const parsed = new URL(baseUrl);
    if (!parsed.searchParams.has("utm_source")) {
      parsed.searchParams.set("utm_source", platformId);
    }
    if (!parsed.searchParams.has("utm_medium")) {
      parsed.searchParams.set("utm_medium", "social_teaser");
    }
    if (accountId && accountId !== "default" && !parsed.searchParams.has("utm_content")) {
      parsed.searchParams.set("utm_content", accountId);
    }
    return parsed.toString();
  } catch {
    const sep = baseUrl.includes("?") ? "&" : "?";
    const accParam =
      accountId && accountId !== "default" ? `&utm_content=${encodeURIComponent(accountId)}` : "";
    return `${baseUrl}${sep}utm_source=${encodeURIComponent(platformId)}&utm_medium=social_teaser${accParam}`;
  }
}

export function parseAccountAndTargetOverride(rawToken: string): {
  accountId: string;
  targetSubreddit?: string;
  targetUrlOverride?: string;
  watermarkText?: string;
} {
  const trimmed = String(rawToken || "").trim();
  if (!trimmed) return { accountId: "default" };

  let leftPart = trimmed;
  let targetUrlOverride: string | undefined;
  const pipeIdx = trimmed.indexOf("|");
  if (pipeIdx !== -1) {
    leftPart = trimmed.slice(0, pipeIdx).trim();
    const rawUrl = trimmed.slice(pipeIdx + 1).trim();
    if (/^https?:\/\//i.test(rawUrl)) {
      targetUrlOverride = rawUrl;
    }
  }

  let watermarkText: string | undefined;
  const hashIdx = leftPart.indexOf("#");
  if (hashIdx !== -1) {
    const rawWm = leftPart.slice(hashIdx + 1).trim();
    leftPart = leftPart.slice(0, hashIdx).trim();
    if (rawWm) {
      watermarkText = rawWm;
    }
  }

  const colonIdx = leftPart.indexOf(":");
  if (colonIdx === -1) {
    return {
      accountId: leftPart || "default",
      targetUrlOverride,
      watermarkText,
    };
  }
  const accountId = leftPart.slice(0, colonIdx).trim() || "default";
  const rightAfterColon = leftPart.slice(colonIdx + 1).trim();
  if (!targetUrlOverride && /^https?:\/\//i.test(rightAfterColon)) {
    return {
      accountId,
      targetUrlOverride: rightAfterColon,
      watermarkText,
    };
  }
  const rawSub = rightAfterColon.replace(/^r\//i, "");
  return {
    accountId,
    targetSubreddit: rawSub || undefined,
    targetUrlOverride,
    watermarkText,
  };
}

export function buildFunnelFlow(submission: FunnelSubmission): FlowJob {
  const strictLive = submission.strictLive ?? submission.masterTarget.strictLive ?? false;
  const autoReconcile = submission.autoReconcile ?? false;
  const overrides = submission.accountOverrides || {};
  const rawMasterOverride = overrides[submission.masterTarget.platformId]?.trim();
  const masterAccountId = rawMasterOverride
    ? parseAccountAndTargetOverride(rawMasterOverride.split(",")[0]).accountId ||
      submission.masterTarget.accountId
    : parseAccountAndTargetOverride(submission.masterTarget.accountId).accountId;

  // In BullMQ FlowProducer, children execute first.
  const masterChild: FlowJob = {
    name: `master-upload-${submission.masterTarget.platformId}`,
    queueName: QUEUE_NAMES.HEAVY_VIDEO,
    data: {
      ...submission.masterTarget,
      accountId: masterAccountId,
      strictLive,
      campaignId: submission.campaignId,
      isMaster: true,
    },
    opts: {
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 5000,
      },
      delay: submission.delayMs,
      removeOnComplete: 100,
      removeOnFail: 200,
    },
  };

  const expandedTeasers: TeaserJobData[] = [];
  for (const t of submission.teaserTargets) {
    const rawOverride = overrides[t.platformId]?.trim();
    const overrideList = rawOverride
      ? Array.from(
          new Set(
            rawOverride
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
          ),
        )
      : [];

    if (overrideList.length > 1) {
      // If caller already expanded each alias into its own TeaserJobData, keep t.accountId
      const parsedTokens = overrideList.map((tok) => parseAccountAndTargetOverride(tok));
      const matchedExisting = parsedTokens.find(
        (p) => p.accountId === t.accountId || `${p.accountId}:${p.targetSubreddit}` === t.accountId,
      );
      if (matchedExisting) {
        const baseWm = t.watermark ?? submission.watermark;
        expandedTeasers.push({
          ...t,
          accountId: matchedExisting.accountId,
          targetUrlOverride: t.targetUrlOverride ?? matchedExisting.targetUrlOverride,
          strictLive: t.strictLive ?? strictLive,
          autoReconcile: t.autoReconcile ?? autoReconcile,
          startSec: t.startSec ?? submission.startSec ?? 0,
          watermark: matchedExisting.watermarkText
            ? {
                ...(baseWm || {}),
                text: matchedExisting.watermarkText,
                position: baseWm?.position || "bottom-right",
              }
            : baseWm,
          extraParams: matchedExisting.targetSubreddit
            ? { ...(t.extraParams || {}), subreddit: matchedExisting.targetSubreddit }
            : t.extraParams,
        });
      } else {
        parsedTokens.forEach((parsed, idx) => {
          const baseWm = t.watermark ?? submission.watermark;
          expandedTeasers.push({
            ...t,
            jobId: idx === 0 ? t.jobId : `${t.jobId}_${idx + 1}`,
            accountId: parsed.accountId,
            targetUrlOverride: t.targetUrlOverride ?? parsed.targetUrlOverride,
            strictLive: t.strictLive ?? strictLive,
            autoReconcile: t.autoReconcile ?? autoReconcile,
            startSec: t.startSec ?? submission.startSec ?? 0,
            watermark: parsed.watermarkText
              ? {
                  ...(baseWm || {}),
                  text: parsed.watermarkText,
                  position: baseWm?.position || "bottom-right",
                }
              : baseWm,
            extraParams: parsed.targetSubreddit
              ? { ...(t.extraParams || {}), subreddit: parsed.targetSubreddit }
              : t.extraParams,
          });
        });
      }
    } else {
      const parsedSingle = parseAccountAndTargetOverride(overrideList[0] || t.accountId);
      const baseWm = t.watermark ?? submission.watermark;
      expandedTeasers.push({
        ...t,
        accountId: parsedSingle.accountId,
        targetUrlOverride: t.targetUrlOverride ?? parsedSingle.targetUrlOverride,
        strictLive: t.strictLive ?? strictLive,
        autoReconcile: t.autoReconcile ?? autoReconcile,
        startSec: t.startSec ?? submission.startSec ?? 0,
        watermark: parsedSingle.watermarkText
          ? {
              ...(baseWm || {}),
              text: parsedSingle.watermarkText,
              position: baseWm?.position || "bottom-right",
            }
          : baseWm,
        extraParams: parsedSingle.targetSubreddit
          ? { ...(t.extraParams || {}), subreddit: parsedSingle.targetSubreddit }
          : t.extraParams,
      });
    }
  }

  // Ensure multi-account siblings targeting the same platform never share an identical text hash
  const platformSeenCounts = new Map<string, number>();
  const priceMap = submission.priceOverrides || {};
  for (const t of expandedTeasers) {
    const idx = platformSeenCounts.get(t.platformId) ?? 0;
    platformSeenCounts.set(t.platformId, idx + 1);
    t.siblingIndex = idx;
    t.staggerSec = t.staggerSec ?? submission.staggerSec;
    t.appendUtm = t.appendUtm ?? submission.appendUtm;
    t.firstCommentTemplate = t.firstCommentTemplate ?? submission.firstCommentTemplate;
    t.postFirstComment = shouldUseFirstComment(t.platformId, t.postFirstComment);

    const rawPrice = t.priceUsd ?? priceMap[t.platformId] ?? submission.priceUsd;
    if (typeof rawPrice === "number" && !Number.isNaN(rawPrice) && rawPrice > 0) {
      t.priceUsd = rawPrice;
      t.extraParams = { ...(t.extraParams || {}), price_usd: rawPrice };
      t.captionTemplate = t.captionTemplate.replace(
        /\{\{\s*PRICE(?:_USD)?\s*\}\}/gi,
        `$${rawPrice.toFixed(2)}`,
      );
    }

    if (t.accountId) {
      t.captionTemplate = t.captionTemplate.replace(/\{\{\s*ACCOUNT(?:_ID)?\s*\}\}/gi, t.accountId);
    }
    if (idx > 0) {
      t.captionTemplate = varyCaptionForAccountSibling(t.captionTemplate, idx);
      t.tags = rotateTagsForAccountSibling(t.tags, idx);
    }
  }

  const trimmedExistingUrl = submission.existingMasterUrl?.trim() || "";

  return {
    name: `funnel-teasers-${submission.campaignId}`,
    queueName: QUEUE_NAMES.LIGHTWEIGHT_SOCIAL,
    data: {
      campaignId: submission.campaignId,
      masterPlatformId: submission.masterTarget.platformId,
      strictLive,
      autoReconcile,
      existingMasterUrl: trimmedExistingUrl || undefined,
      teasers: expandedTeasers,
    },
    children: trimmedExistingUrl ? undefined : [masterChild],
    opts: {
      attempts: 2,
      delay: trimmedExistingUrl ? submission.delayMs : undefined,
      removeOnComplete: 100,
    },
  };
}

export interface PreparedTeaserMedia {
  filePath?: string;
  isStillImage?: boolean;
  reconciled: boolean;
  mode?: "privacy_clean" | "image_to_short" | "funnel_bridge";
  skippedReason?: string;
}

async function runReconcileWithFallback(
  params:
    | { mode: "funnel_bridge"; input: string; output: string; startSec?: number; maxMb: number; watermark?: Watermark }
    | { mode: "image_to_short"; input: string; output: string; watermark?: Watermark },
) {
  const encoder = await detectBestH264Encoder().catch(() => "libx264" as const);
  const job =
    params.mode === "funnel_bridge"
      ? {
          mode: "funnel_bridge" as const,
          input: params.input,
          output: params.output,
          startSec: Math.max(0, params.startSec ?? 0),
          maxMb: params.maxMb,
          watermark: params.watermark,
          videoEncoder: encoder,
        }
      : {
          mode: "image_to_short" as const,
          input: params.input,
          output: params.output,
          watermark: params.watermark,
          videoEncoder: encoder,
        };

  try {
    await reconcile(job);
  } catch (err) {
    // Hardware encoders reported in -encoders may fail without live GPU device access; retry once on libx264.
    if (encoder === "libx264") throw err;
    await reconcile({ ...job, videoEncoder: "libx264" });
  }
}

export function formatCleanAccountHandle(accountId?: string): string {
  if (!accountId || accountId === "default") return "creator";
  const stripped = accountId
    .replace(
      /^(?:x|twitter|reddit|ig|instagram|tiktok|yt|youtube|tg|telegram|bsky|bluesky|of|onlyfans|fansly|mv|manyvids)_(?:acc_|account_)?/i,
      "",
    )
    .replace(/^(?:acc_|account_)/i, "")
    .trim();
  return stripped || accountId;
}

export function resolveAccountWatermark(
  watermark: Watermark | undefined,
  accountId?: string,
): Watermark | undefined {
  if (!watermark || !watermark.text) return watermark;
  const resolvedHandle = accountId && accountId !== "default" ? accountId : "creator";
  const cleanHandle = formatCleanAccountHandle(accountId);
  const replacedText = watermark.text
    .replace(/\{\{\s*ACCOUNT_HANDLE\s*\}\}/gi, cleanHandle)
    .replace(/\{\{\s*ACCOUNT(?:_ID)?\s*\}\}/gi, resolvedHandle);
  return {
    ...watermark,
    text: replacedText,
  };
}

export function pruneStaleTeaserRenders(
  rendersDir?: string,
  maxFiles = 20,
): { deleted: number; kept: number } {
  const targetDir = resolve(rendersDir ?? join(resolveDataDir(), "renders"));
  if (!existsSync(targetDir)) {
    return { deleted: 0, kept: 0 };
  }
  try {
    const entries = readdirSync(targetDir)
      .filter((name) => /\.(mp4|jpg|jpeg|png|webp)$/i.test(name))
      .map((name) => {
        const fullPath = join(targetDir, name);
        let mtimeMs = 0;
        try {
          mtimeMs = statSync(fullPath).mtimeMs;
        } catch {}
        return { fullPath, mtimeMs };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);

    const keepCount = Math.max(0, maxFiles);
    const toDelete = entries.slice(keepCount);
    let deleted = 0;
    for (const item of toDelete) {
      try {
        unlinkSync(item.fullPath);
        deleted++;
      } catch {}
    }
    return { deleted, kept: entries.length - deleted };
  } catch {
    return { deleted: 0, kept: 0 };
  }
}

/**
 * Strips EXIF metadata and enforces teaser size/format rules on disk when autoReconcile is enabled.
 * Preserves unresolved paths when running mock/demo campaigns without local media files.
 */
export async function prepareTeaserMedia(opts: {
  campaignId: string;
  platformId: string;
  accountId?: string;
  siblingIndex?: number;
  filePath?: string;
  isStillImage?: boolean;
  autoReconcile?: boolean;
  startSec?: number;
  watermark?: Watermark;
  rendersDir?: string;
}): Promise<PreparedTeaserMedia> {
  const { campaignId, platformId, filePath, isStillImage, autoReconcile, watermark } = opts;
  const effectiveWatermark = resolveAccountWatermark(watermark, opts.accountId);
  if (!autoReconcile || !filePath) {
    return {
      filePath,
      isStillImage,
      reconciled: false,
      skippedReason: !autoReconcile ? "disabled" : "no_file",
    };
  }

  if (!existsSync(filePath)) {
    return {
      filePath,
      isStillImage,
      reconciled: false,
      skippedReason: "source_missing",
    };
  }

  const platform = getPlatform(platformId);
  if (platform.textOnly) {
    return {
      filePath: undefined,
      isStillImage: false,
      reconciled: false,
      skippedReason: "text_only_platform",
    };
  }

  const rendersDir = resolve(opts.rendersDir ?? join(resolveDataDir(), "renders"));
  mkdirSync(rendersDir, { recursive: true });

  const accountSuffix =
    opts.accountId && opts.accountId !== "default" ? `_${opts.accountId}` : "";
  const safeId = `${campaignId}_${platformId}${accountSuffix}`.replace(/[^a-zA-Z0-9_-]/g, "_");
  const sourceIsImage = isStillImage ?? isImagePath(filePath);

  if (sourceIsImage) {
    if (platform.shortFormVideo || (!platform.acceptsImages && platform.acceptsVideo)) {
      const output = join(rendersDir, `${safeId}.mp4`);
      await runReconcileWithFallback({
        mode: "image_to_short",
        input: filePath,
        output,
        watermark: effectiveWatermark,
      });
      pruneStaleTeaserRenders(rendersDir);
      return { filePath: output, isStillImage: false, reconciled: true, mode: "image_to_short" };
    }

    const ext = extname(filePath) || ".jpg";
    const output = join(rendersDir, `${safeId}${ext}`);
    await reconcile({
      mode: "privacy_clean",
      input: filePath,
      output,
      siblingIndex: opts.siblingIndex,
    });
    pruneStaleTeaserRenders(rendersDir);
    return { filePath: output, isStillImage: true, reconciled: true, mode: "privacy_clean" };
  }

  const output = join(rendersDir, `${safeId}.mp4`);
  const maxMb = Math.min(platform.maxMb || TEASER_MAX_MB, TEASER_MAX_MB);
  const siblingOffsetSec = (opts.siblingIndex ?? 0) > 0 ? (opts.siblingIndex ?? 0) * 0.25 : 0;
  const effectiveStartSec =
    opts.startSec !== undefined || siblingOffsetSec > 0
      ? Math.max(0, (opts.startSec ?? 0) + siblingOffsetSec)
      : undefined;
  await runReconcileWithFallback({
    mode: "funnel_bridge",
    input: filePath,
    output,
    startSec: effectiveStartSec,
    maxMb,
    watermark: effectiveWatermark,
  });
  pruneStaleTeaserRenders(rendersDir);
  return { filePath: output, isStillImage: false, reconciled: true, mode: "funnel_bridge" };
}

async function maybeReconcileTeaserMedia(
  campaignId: string,
  teaser: TeaserJobData,
  fallbackAutoReconcile?: boolean,
  strictLive?: boolean,
): Promise<PreparedTeaserMedia> {
  try {
    return await prepareTeaserMedia({
      campaignId,
      platformId: teaser.platformId,
      accountId: teaser.accountId,
      siblingIndex: teaser.siblingIndex,
      filePath: teaser.filePath,
      isStillImage: teaser.isStillImage,
      autoReconcile: teaser.autoReconcile ?? fallbackAutoReconcile,
      startSec: teaser.startSec,
      watermark: teaser.watermark,
    });
  } catch (err) {
    if (strictLive) throw err;
    return {
      filePath: teaser.filePath,
      isStillImage: teaser.isStillImage,
      reconciled: false,
      skippedReason: "reconcile_failed",
    };
  }
}

export function isNonRetryableAuthOrChallengeError(errorMsg: string): boolean {
  const lower = (errorMsg || "").toLowerCase();
  return [
    "session expired",
    "security challenge",
    "anti-bot challenge",
    "no active session",
    "invalid credentials",
    "unauthorized",
    "forbidden",
    "(401)",
    "(403)",
    "status 401",
    "status 403",
    "checkpoint",
    "disable_simulated_connectors",
    "compliance_confirmation_required",
    "no native live api connector",
  ].some((marker) => lower.includes(marker));
}

async function notifyFailureWebhook(job: Job, error: Error) {
  const webhookUrl = process.env.FAILURE_ALERT_WEBHOOK_URL;
  if (!webhookUrl) return;
  const payload = {
    content: `[PolyPost DLQ] Job '${job.name}' (${job.id}) failed permanently after ${job.attemptsMade} attempt(s): ${error.message}`,
    jobId: job.id,
    queue: job.queueName,
    campaignId: (job.data as any)?.campaignId,
    error: error.message,
  };
  await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => {});
}

export class FunnelEngine {
  public flowProducer: FlowProducer;
  public dlq: Queue;
  public heavyVideoWorker?: Worker;
  public socialWorker?: Worker;

  constructor(public redisConnection: Redis) {
    this.flowProducer = new FlowProducer({ connection: redisConnection as any });
    this.dlq = new Queue(QUEUE_NAMES.DEAD_LETTER, { connection: redisConnection as any });
  }

  async submitFunnel(submission: FunnelSubmission) {
    const flow = buildFunnelFlow(submission);
    return await this.flowProducer.add(flow);
  }

  private attachDlqHandler(worker: Worker) {
    worker.on("failed", async (job, err) => {
      if (!job) return;
      const maxAttempts = job.opts?.attempts ?? 1;
      if (job.attemptsMade < maxAttempts) return;

      try {
        await this.dlq.add("dead-letter-job", {
          originalQueue: job.queueName,
          originalJobId: job.id,
          name: job.name,
          data: job.data,
          failedReason: err.message,
          stacktrace: job.stacktrace,
          failedAt: Date.now(),
        });
      } catch {
        // Ignore Redis DLQ errors if closing
      }

      const campaignId = (job.data as any)?.campaignId;
      if (campaignId) {
        const existing = await getCampaignState(this.redisConnection, campaignId);
        if (existing) {
          existing.step = "failed";
          existing.masterError = err.message;
          existing.updatedAt = Date.now();
          await saveCampaignState(this.redisConnection, existing);
        }
      }

      await notifyFailureWebhook(job, err);
    });
  }

  startWorkers(opts: {
    customConnectorResolver?: typeof getConnectorForPlatform;
  } = {}) {
    const resolveConnector = opts.customConnectorResolver ?? getConnectorForPlatform;

    // 1. Heavy video worker: concurrency 2, zero-RAM streaming
    this.heavyVideoWorker = new Worker(
      QUEUE_NAMES.HEAVY_VIDEO,
      async (job: Job<MasterJobData & { campaignId: string }>): Promise<ConnectorResult> => {
        reloadRootEnvToProcessEnv();
        const data = job.data;
        await job.updateProgress(15);

        const existing = await getCampaignState(this.redisConnection, data.campaignId);
        if (existing) {
          existing.step = "uploading_master";
          existing.uploadPercent = 25;
          existing.updatedAt = Date.now();
          await saveCampaignState(this.redisConnection, existing);
        }

        const connector = resolveConnector(data.platformId);
        await job.updateProgress(50);

        const res = await connector.publish({
          platformId: data.platformId,
          accountId: data.accountId,
          text: data.description,
          filePath: data.filePath,
          tags: data.tags,
          strictLive: data.strictLive,
          credentials: data.credentials,
          extraParams: data.extraParams,
        });

        if (!res.success) {
          const errMsg = res.error || `Master upload to ${data.platformId} failed`;
          if (isNonRetryableAuthOrChallengeError(errMsg)) {
            throw new UnrecoverableError(errMsg);
          }
          throw new Error(errMsg);
        }

        await job.updateProgress(100);
        const latest = await getCampaignState(this.redisConnection, data.campaignId);
        if (latest) {
          latest.step = "injecting_url";
          latest.uploadPercent = 100;
          latest.liveMasterUrl = res.publishedUrl;
          latest.masterSimulated = res.simulated;
          latest.updatedAt = Date.now();
          await saveCampaignState(this.redisConnection, latest);
        }

        return res;
      },
      {
        connection: this.redisConnection as any,
        concurrency: 2,
      },
    );
    this.attachDlqHandler(this.heavyVideoWorker);

    // 2. Lightweight social worker: concurrency 15
    this.socialWorker = new Worker(
      QUEUE_NAMES.LIGHTWEIGHT_SOCIAL,
      async (
        job: Job<{
          campaignId: string;
          masterPlatformId: string;
          teasers: TeaserJobData[];
          strictLive?: boolean;
          autoReconcile?: boolean;
          existingMasterUrl?: string;
        }>,
      ) => {
        reloadRootEnvToProcessEnv();
        let liveMasterUrl = job.data.existingMasterUrl?.trim() || "";
        let masterSimulated = false;

        if (!liveMasterUrl) {
          const childrenValues = await job.getChildrenValues<ConnectorResult>();
          for (const result of Object.values(childrenValues)) {
            if (result && result.publishedUrl) {
              liveMasterUrl = result.publishedUrl;
              masterSimulated = Boolean(result.simulated);
              break;
            }
          }
        }

        if (!liveMasterUrl) {
          throw new Error("Cannot execute social teasers: Parent master job did not produce a publishedUrl");
        }

        const fallbackState: CampaignStateSnapshot = {
          campaignId: job.data.campaignId,
          step: "broadcasting_teasers",
          uploadPercent: 100,
          liveMasterUrl,
          masterSimulated,
          teasers: job.data.teasers.map((t): TeaserProgressState => ({
            jobId: t.jobId,
            platformId: t.platformId,
            accountId: t.accountId,
            status: "queued",
          })),
          updatedAt: Date.now(),
        };
        const state: CampaignStateSnapshot = (await getCampaignState(this.redisConnection, job.data.campaignId)) ?? fallbackState;
        state.step = "broadcasting_teasers";
        state.uploadPercent = 100;
        state.liveMasterUrl = liveMasterUrl;
        state.masterSimulated = masterSimulated;
        await saveCampaignState(this.redisConnection, state);

        const publishedTeasers: ConnectorResult[] = [];
        const total = Math.max(1, job.data.teasers.length);

        for (let i = 0; i < job.data.teasers.length; i++) {
          const teaser = job.data.teasers[i];
          const connector = resolveConnector(teaser.platformId);
          const effectiveMasterUrl = teaser.targetUrlOverride?.trim() || liveMasterUrl;
          const trackedMasterUrl = formatMasterUrlForTeaser(
            effectiveMasterUrl,
            teaser.platformId,
            teaser.accountId,
            teaser.appendUtm,
          );
          const useFirstComment = shouldUseFirstComment(teaser.platformId, teaser.postFirstComment);
          const resolvedFirstComment = buildFirstCommentForTeaser({
            postFirstComment: useFirstComment,
            platformId: teaser.platformId,
            trackedMasterUrl,
            firstCommentTemplate: teaser.firstCommentTemplate,
            siblingIndex: teaser.siblingIndex,
            accountId: teaser.accountId,
            priceUsd: teaser.priceUsd,
          });
          const cleanTemplate = useFirstComment
            ? teaser.captionTemplate.replace(/\{\{LIVE_MASTER_URL\}\}/g, "").trim()
            : teaser.captionTemplate.replace(/\{\{LIVE_MASTER_URL\}\}/g, trackedMasterUrl);

          const teaserState = state.teasers.find((ts) => ts.jobId === teaser.jobId);
          if (teaserState) {
            teaserState.status = "publishing";
            teaserState.injectedCaption = useFirstComment
              ? `${cleanTemplate} (1st comment: ${resolvedFirstComment})`
              : cleanTemplate;
            await saveCampaignState(this.redisConnection, state);
          }

          const teaserStrictLive = teaser.strictLive ?? job.data.strictLive;
          const preparedMedia = await maybeReconcileTeaserMedia(
            job.data.campaignId,
            teaser,
            job.data.autoReconcile,
            teaserStrictLive,
          );

          const payload: PostPayload = {
            platformId: teaser.platformId,
            accountId: teaser.accountId,
            text: cleanTemplate || `Watch the full video on ${job.data.masterPlatformId}`,
            linkUrl: trackedMasterUrl,
            filePath: preparedMedia.filePath,
            isStillImage: preparedMedia.isStillImage,
            tags: teaser.tags,
            strictLive: teaserStrictLive,
            firstComment: resolvedFirstComment,
            credentials: teaser.credentials,
            extraParams: teaser.extraParams,
          };

          try {
            if (teaserStrictLive && process.env.POLYPOST_ACCOUNT_COOLDOWN_MS !== "0") {
              const minCooldown = Number(process.env.POLYPOST_ACCOUNT_COOLDOWN_MS) || 1500;
              const waitMs = getAccountCooldownWaitMs(teaser.platformId, teaser.accountId, Date.now(), minCooldown);
              if (waitMs > 0) {
                await new Promise((r) => setTimeout(r, waitMs));
              }
            }
            const res = await connector.publish(payload);
            recordAccountUploadTimestamp(teaser.platformId, teaser.accountId);
            publishedTeasers.push(res);
            if (!res.simulated && i + 1 < job.data.teasers.length && process.env.POLYPOST_TEASER_PACING_MS !== "0") {
              const nextSamePlatform = job.data.teasers[i + 1]?.platformId === teaser.platformId;
              const explicitStaggerMs =
                teaser.staggerSec && teaser.staggerSec > 0 ? Math.round(teaser.staggerSec * 1000) : 0;
              const defaultBase =
                explicitStaggerMs > 0
                  ? explicitStaggerMs + Math.floor(Math.random() * 450)
                  : nextSamePlatform
                    ? 850 + Math.floor(Math.random() * 650)
                    : 350 + Math.floor(Math.random() * 400);
              const pacingMs = Number(process.env.POLYPOST_TEASER_PACING_MS) || defaultBase;
              await new Promise((r) => setTimeout(r, pacingMs));
            }
            if (teaserState) {
              teaserState.status = res.success ? "published" : "failed";
              teaserState.publishedUrl = res.publishedUrl;
              teaserState.simulated = res.simulated;
              teaserState.firstCommentUrl = res.firstCommentUrl;
              teaserState.failureScreenshot = res.failureScreenshot;
              teaserState.error = res.error;
            }
          } catch (err: any) {
            const msg = err?.message ?? String(err);
            const failedRes: ConnectorResult = {
              success: false,
              platformId: teaser.platformId,
              error: msg,
            };
            publishedTeasers.push(failedRes);
            if (teaserState) {
              teaserState.status = "failed";
              teaserState.error = msg;
            }
          }

          state.updatedAt = Date.now();
          await saveCampaignState(this.redisConnection, state);
          await job.updateProgress(Math.round(((i + 1) / total) * 100));
        }

        state.step = publishedTeasers.some((r) => !r.success) && publishedTeasers.every((r) => !r.success)
          ? "failed"
          : "completed";
        state.updatedAt = Date.now();
        await saveCampaignState(this.redisConnection, state);

        return {
          campaignId: job.data.campaignId,
          liveMasterUrl,
          teasersCount: publishedTeasers.length,
          results: publishedTeasers,
        };
      },
      {
        connection: this.redisConnection as any,
        concurrency: 15,
      },
    );
    this.attachDlqHandler(this.socialWorker);
  }

  async close() {
    await this.flowProducer.close();
    await this.dlq.close();
    if (this.heavyVideoWorker) await this.heavyVideoWorker.close();
    if (this.socialWorker) await this.socialWorker.close();
  }
}
