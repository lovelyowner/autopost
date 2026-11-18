/** Browser-safe caption preflight validator: platform char limits, Strict-SFW check, and spintax uniqueness analyzer. */
import { getPlatform, type Platform } from "@polypost/platform-registry";
import {
  STRICT_DENYLIST,
  profileForPlatform,
  violatesStrict,
  type CaptionProfile,
} from "@polypost/ai-caption-spinner";

export const PLATFORM_CHAR_LIMITS: Record<string, number> = {
  x: 280,
  bluesky: 300,
  reddit: 300,
  mastodon: 500,
  threads: 500,
  pinterest: 500,
  onlyfans_feed: 1000,
  onlyfans_ppv: 1000,
  manyvids_store: 1000,
  manyvids_club: 1000,
  telegram: 1024,
  fansly_wall: 1500,
  fansly_vault: 1500,
  fansly_fyp: 1500,
  discord: 2000,
  fluxer: 2000,
  stoat: 2000,
  nostr: 2000,
  instagram: 2200,
  tiktok: 2200,
  facebook: 2200,
  misskey: 3000,
  linkedin: 3000,
  matrix: 4000,
  youtube: 5000,
};

const DEFAULT_CHAR_LIMIT = 1000;
const SAMPLE_MASTER_URL_PLACEHOLDER = "https://example.com/release/live-master";

export interface SpintaxAnalysis {
  hasSpintax: boolean;
  unbalancedBraces: boolean;
  blockCount: number;
  permutations: number;
  samples: string[];
}

export interface PlatformCaptionAudit {
  platformId: string;
  platformName: string;
  profile: CaptionProfile;
  rawCaption: string;
  resolvedLength: number;
  maxChars: number;
  overLimit: boolean;
  strictViolation: string | null;
  accountCount: number;
  spintaxPermutations: number;
  duplicateSiblingRisk: boolean;
  unbalancedBraces: boolean;
  ok: boolean;
}

export interface CampaignCaptionPreflight {
  items: PlatformCaptionAudit[];
  overLimitCount: number;
  strictViolationCount: number;
  duplicateSiblingRiskCount: number;
  unbalancedCount: number;
  allOk: boolean;
}

export function getPlatformCharLimit(platformId: string): number {
  return PLATFORM_CHAR_LIMITS[platformId] ?? DEFAULT_CHAR_LIMIT;
}

/** Counts spintax blocks and unique permutations for top-level `{a|b|c}` syntax. */
export function analyzeSpintax(text: string, sampleCount = 3): SpintaxAnalysis {
  let depth = 0;
  let unbalancedBraces = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "{") {
      // Ignore `{{LIVE_MASTER_URL}}` style template tags
      if (text[i + 1] === "{") {
        const closeDouble = text.indexOf("}}", i + 2);
        if (closeDouble !== -1) {
          i = closeDouble + 1;
          continue;
        }
      }
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth < 0) {
        unbalancedBraces = true;
        depth = 0;
      }
    }
  }
  if (depth !== 0) {
    unbalancedBraces = true;
  }

  const blockRegex = /(?<!\{)\{([^{}]+)\}(?!\})/g;
  const blocks: string[][] = [];
  for (const m of text.matchAll(blockRegex)) {
    const parts = m[1]
      .split("|")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (parts.length >= 2) {
      blocks.push(parts);
    }
  }

  let permutations = 1;
  for (const opts of blocks) {
    permutations = Math.min(1_000_000, permutations * opts.length);
  }

  const samples: string[] = [];
  const totalSamples = Math.max(1, Math.min(sampleCount, permutations));
  for (let s = 0; s < totalSamples; s++) {
    samples.push(resolveSpintaxVariant(text, s));
  }

  return {
    hasSpintax: blocks.length > 0,
    unbalancedBraces,
    blockCount: blocks.length,
    permutations,
    samples,
  };
}

/** Deterministically resolves `{a|b|c}` spintax blocks for a given variant index (mixed-radix indexing). */
export function resolveSpintaxVariant(text: string, variantIndex: number): string {
  let rem = Math.max(0, Math.floor(variantIndex));
  return text.replace(/(?<!\{)\{([^{}]+)\}(?!\})/g, (full, inner: string) => {
    const parts = inner
      .split("|")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (parts.length < 2) return full;
    const choice = parts[rem % parts.length];
    rem = Math.floor(rem / parts.length);
    return choice;
  });
}

/** Resolves each spintax block to its longest option so character limits check worst-case length. */
export function resolveWorstCaseCaptionLength(text: string, masterUrl?: string): number {
  const longestSpintax = text.replace(/(?<!\{)\{([^{}]+)\}(?!\})/g, (full, inner: string) => {
    const parts = inner
      .split("|")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (parts.length < 2) return full;
    return parts.reduce((a, b) => (b.length > a.length ? b : a), parts[0]);
  });
  const effectiveUrl = (masterUrl || "").trim() || SAMPLE_MASTER_URL_PLACEHOLDER;
  return longestSpintax.replace(/\{\{LIVE_MASTER_URL\}\}/g, effectiveUrl).trim().length;
}

export function auditCampaignCaptions(params: {
  selectedPlatformIds: string[];
  generatedCaptions: Record<CaptionProfile, string>;
  captionOverrides?: Record<string, string>;
  accountOverrides?: Record<string, string>;
  existingMasterUrl?: string;
}): CampaignCaptionPreflight {
  const items: PlatformCaptionAudit[] = [];

  for (const platformId of params.selectedPlatformIds) {
    const pl = getPlatform(platformId);
    const profile = profileForPlatform(pl);
    const override = (params.captionOverrides?.[platformId] || "").trim();
    const rawCaption = override || (params.generatedCaptions[profile] || "").trim();

    const spintax = analyzeSpintax(rawCaption, 1);
    const maxChars = getPlatformCharLimit(platformId);
    const resolvedLength = resolveWorstCaseCaptionLength(rawCaption, params.existingMasterUrl);
    const overLimit = resolvedLength > maxChars;
    const strictViolation = pl.strictSfwPolicy ? violatesStrict(rawCaption) : null;

    const rawAcct = (params.accountOverrides?.[platformId] || "").trim();
    const accountCount = rawAcct
      ? Math.max(
          1,
          rawAcct
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean).length,
        )
      : 1;
    const duplicateSiblingRisk = accountCount > 1 && spintax.permutations < accountCount;

    const ok = !overLimit && !strictViolation && !duplicateSiblingRisk && !spintax.unbalancedBraces;

    items.push({
      platformId,
      platformName: pl.name,
      profile,
      rawCaption,
      resolvedLength,
      maxChars,
      overLimit,
      strictViolation,
      accountCount,
      spintaxPermutations: spintax.permutations,
      duplicateSiblingRisk,
      unbalancedBraces: spintax.unbalancedBraces,
      ok,
    });
  }

  const overLimitCount = items.filter((i) => i.overLimit).length;
  const strictViolationCount = items.filter((i) => Boolean(i.strictViolation)).length;
  const duplicateSiblingRiskCount = items.filter((i) => i.duplicateSiblingRisk).length;
  const unbalancedCount = items.filter((i) => i.unbalancedBraces).length;

  return {
    items,
    overLimitCount,
    strictViolationCount,
    duplicateSiblingRiskCount,
    unbalancedCount,
    allOk:
      overLimitCount === 0 &&
      strictViolationCount === 0 &&
      duplicateSiblingRiskCount === 0 &&
      unbalancedCount === 0,
  };
}

/** Cleans strict-SFW denylisted terms (when required) and trims caption to platform limit while preserving {{LIVE_MASTER_URL}}. */
export function autoFixPlatformCaption(
  caption: string,
  platform: Platform,
  masterUrl?: string,
): string {
  let cleaned = caption;
  if (platform.strictSfwPolicy) {
    for (const word of STRICT_DENYLIST) {
      const escaped = word.replace(/[+]/g, "\\+");
      const re = new RegExp(`(^|[^a-z0-9])${escaped}(?=[^a-z0-9]|$)`, "gi");
      cleaned = cleaned.replace(re, "$1");
    }
    cleaned = cleaned.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  }

  const maxChars = getPlatformCharLimit(platform.id);
  const effectiveUrl = (masterUrl || "").trim() || SAMPLE_MASTER_URL_PLACEHOLDER;
  const hasToken = cleaned.includes("{{LIVE_MASTER_URL}}");

  if (resolveWorstCaseCaptionLength(cleaned, masterUrl) <= maxChars) {
    return cleaned;
  }

  if (hasToken) {
    const withoutToken = cleaned.replace(/\{\{LIVE_MASTER_URL\}\}/g, "").replace(/[ \t]{2,}/g, " ").trim();
    const reserve = effectiveUrl.length + 2;
    const allowedTextLen = Math.max(12, maxChars - reserve);
    const trimmedBody =
      withoutToken.length > allowedTextLen
        ? `${withoutToken.slice(0, Math.max(1, allowedTextLen - 1)).trimEnd()}…`
        : withoutToken;
    return `${trimmedBody} {{LIVE_MASTER_URL}}`.trim();
  }

  return `${cleaned.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
}
