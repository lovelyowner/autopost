import { getPlatform } from "./master-platforms";
import type { Platform, RenditionAssignment, ScalingMode, UploadConstraints } from "./types";

export const PROMO_CUT_MAX_MB = 2000;
export const PROMO_CUT_SECONDS = 180;
export const TEASER_MAX_MB = 9.5;
export const TEASER_SECONDS = 12;

function resolve(ids: readonly string[]): Platform[] {
  const unique = Array.from(new Set(ids));
  return unique.map(getPlatform);
}

function sortAscending(platforms: Platform[]): Platform[] {
  return [...platforms].sort((a, b) => a.maxMb - b.maxMb || a.id.localeCompare(b.id));
}

/**
 * strict: the upload ceiling is the smallest selected limit, and nextLimitIfUnchecked shows
 * what the ceiling becomes when the bottleneck platform is deselected.
 * waterfall_autoscale: the ceiling is the largest selected limit; smaller targets receive
 * derived renditions from planWaterfall().
 */
export function calculateUploadConstraints(
  selectedPlatformIds: readonly string[],
  scalingMode: ScalingMode,
): UploadConstraints {
  const sorted = sortAscending(resolve(selectedPlatformIds));
  if (sorted.length === 0) {
    return { mode: scalingMode, allowedMaxMb: 0, bottleneckPlatform: null, nextLimitIfUnchecked: 0, sorted };
  }
  if (scalingMode === "strict") {
    return {
      mode: scalingMode,
      allowedMaxMb: sorted[0].maxMb,
      bottleneckPlatform: sorted[0],
      nextLimitIfUnchecked: sorted[1]?.maxMb ?? sorted[0].maxMb,
      sorted,
    };
  }
  const top = sorted[sorted.length - 1];
  return {
    mode: scalingMode,
    allowedMaxMb: top.maxMb,
    bottleneckPlatform: top,
    nextLimitIfUnchecked: sorted[sorted.length - 2]?.maxMb ?? top.maxMb,
    sorted,
  };
}

const LOW_LIMIT_CHAT_MICROBLOG_MB = 100;

/**
 * Assigns each selected platform the rendition that fits its limit for a master file of masterMb.
 * - master: the platform accepts the full file
 * - promo_cut: 18+ tube networks that cannot take the master get a 3-minute watermarked promo under 2,000 MB
 * - teaser_clip: low-limit chat and microblog targets get a 12-second clip under 9.5 MB
 * - link_preview: text-only connectors or targets too small even for the teaser get a caption + link
 */
export function planWaterfall(masterMb: number, selectedPlatformIds: readonly string[]): RenditionAssignment[] {
  return sortAscending(resolve(selectedPlatformIds)).map((pl): RenditionAssignment => {
    if (pl.textOnly) {
      return { platformId: pl.id, rendition: "link_preview", targetMaxMb: 0, reason: "connector publishes text and link only" };
    }
    if (masterMb <= pl.maxMb) {
      return { platformId: pl.id, rendition: "master", targetMaxMb: pl.maxMb, reason: "master fits platform limit" };
    }
    if (pl.quadrant === "nsfw_tube" && pl.maxMb >= PROMO_CUT_MAX_MB / 2) {
      const target = Math.min(PROMO_CUT_MAX_MB, pl.maxMb);
      return {
        platformId: pl.id,
        rendition: "promo_cut",
        targetMaxMb: target,
        maxDurationSec: PROMO_CUT_SECONDS,
        reason: `master ${masterMb} MB exceeds ${pl.maxMb} MB, sending ${PROMO_CUT_SECONDS}s watermarked promo`,
      };
    }
    if (pl.maxMb >= TEASER_MAX_MB && (pl.maxMb <= LOW_LIMIT_CHAT_MICROBLOG_MB || pl.quadrant !== "nsfw_tube")) {
      return {
        platformId: pl.id,
        rendition: "teaser_clip",
        targetMaxMb: TEASER_MAX_MB,
        maxDurationSec: TEASER_SECONDS,
        reason: `master exceeds ${pl.maxMb} MB, sending ${TEASER_SECONDS}s teaser`,
      };
    }
    return { platformId: pl.id, rendition: "link_preview", targetMaxMb: 0, reason: "no video rendition fits, posting link preview" };
  });
}

/** Target video bitrate (kbit/s) that keeps a clip of durationSec under maxMb with the given audio bitrate. */
export function bitrateForBudget(maxMb: number, durationSec: number, audioKbps = 128, safety = 0.92): number {
  const totalKbits = maxMb * 8 * 1024 * safety;
  return Math.max(150, Math.floor(totalKbits / durationSec - audioKbps));
}
