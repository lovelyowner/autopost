import { getPlatform, planWaterfall, TEASER_SECONDS, type Platform, type RenditionKind } from "@polypost/platform-registry";
import { longestSafeWindow, SAFE_THRESHOLD, type ScanResult } from "./vision-scanner";

export type MediaAction = "publish" | "funnel_teaser" | "image_to_short" | "link_only" | "blocked";

export interface PlatformMediaPlan {
  platformId: string;
  action: MediaAction;
  rendition: RenditionKind;
  reason: string;
  teaserWindow?: { startSec: number; endSec: number };
  suggestedTags: string[];
  /** Upload must not proceed until a human confirms 2257 records for this post. */
  requires2257Attestation: boolean;
  publicPreviewSuggested: boolean;
}

export interface PlanInput {
  scan: ScanResult | null;
  masterMb: number;
  isStillImage: boolean;
  platformIds: readonly string[];
}

export const NEUTRAL_TAXONOMY_TAGS = ["SFW", "Lifestyle", "Behind The Scenes"];

function base(pl: Platform, rendition: RenditionKind): Omit<PlatformMediaPlan, "action" | "reason"> {
  return {
    platformId: pl.id,
    rendition,
    suggestedTags: [],
    requires2257Attestation: pl.requiresAdultTaxonomy,
    publicPreviewSuggested: false,
  };
}

/**
 * Routes one piece of media to every selected platform.
 * Strict-SFW platforms only receive media the scanner rated safe, or a teaser cut from a
 * continuous safe window. Unscanned media fails closed on those platforms.
 */
export function planMediaForPlatforms(input: PlanInput): PlatformMediaPlan[] {
  const sizing = new Map(planWaterfall(input.masterMb, input.platformIds).map((a) => [a.platformId, a]));
  const score = input.scan?.sensitivityScore;
  const safeWindow = input.scan && !input.isStillImage ? longestSafeWindow(input.scan.frames) : null;
  const windowLongEnough = !!safeWindow && safeWindow.endSec - safeWindow.startSec >= TEASER_SECONDS;

  return Array.from(new Set(input.platformIds)).map((id): PlatformMediaPlan => {
    const pl = getPlatform(id);
    const size = sizing.get(id)!;
    const b = base(pl, size.rendition);

    if (pl.textOnly) return { ...b, action: "link_only", rendition: "link_preview", reason: "connector posts caption and link" };

    if (pl.strictSfwPolicy) {
      if (score === undefined) {
        return { ...b, action: "blocked", reason: "strict SFW platform requires a completed vision scan" };
      }
      if (score >= SAFE_THRESHOLD) {
        if (windowLongEnough) {
          return {
            ...b,
            action: "funnel_teaser",
            rendition: "teaser_clip",
            teaserWindow: { startSec: safeWindow!.startSec, endSec: safeWindow!.startSec + TEASER_SECONDS },
            reason: `media scored ${score.toFixed(2)}; posting a ${TEASER_SECONDS}s teaser from a safe window`,
          };
        }
        return { ...b, action: "blocked", reason: `media scored ${score.toFixed(2)} and has no ${TEASER_SECONDS}s safe window` };
      }
    }

    if (input.isStillImage && !pl.acceptsImages) {
      if (!pl.acceptsVideo) return { ...b, action: "blocked", reason: "platform accepts neither images nor video" };
      return { ...b, action: "image_to_short", rendition: "master", reason: "image converted to 6s 1080x1920 short" };
    }
    if (!input.isStillImage && !pl.acceptsVideo) {
      return { ...b, action: "link_only", rendition: "link_preview", reason: "platform does not accept video" };
    }

    const neutral = pl.requiresAdultTaxonomy && score !== undefined && score < SAFE_THRESHOLD;
    const action: MediaAction = size.rendition === "link_preview" ? "link_only" : "publish";
    return {
      ...b,
      action,
      reason: size.reason,
      suggestedTags: neutral ? [...NEUTRAL_TAXONOMY_TAGS] : [],
      publicPreviewSuggested: neutral && pl.quadrant === "nsfw_social",
    };
  });
}
