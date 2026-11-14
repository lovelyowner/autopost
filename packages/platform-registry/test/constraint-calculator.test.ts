import { describe, expect, it } from "vitest";
import {
  ACTIVE_PLATFORMS,
  ARCHIVED_PLATFORMS,
  MASTER_PLATFORMS,
  bitrateForBudget,
  calculateUploadConstraints,
  getPlatform,
  planWaterfall,
} from "../src/index";

describe("master platform registry", () => {
  it("tracks at least 125 platforms with unique ids", () => {
    expect(MASTER_PLATFORMS.length).toBeGreaterThanOrEqual(125);
    expect(ACTIVE_PLATFORMS.length).toBeGreaterThanOrEqual(120);
    expect(ARCHIVED_PLATFORMS.length).toBeGreaterThanOrEqual(3);
    expect(new Set(MASTER_PLATFORMS.map((p) => p.id)).size).toBe(MASTER_PLATFORMS.length);
  });

  it("encodes the specified ceilings", () => {
    const expected: Record<string, number> = {
      discord: 10, fluxer: 10, furaffinity: 10, medium: 20, stoat: 25, pixiv_r18: 32, mastodon: 40,
      bluesky: 100, redgifs: 200, threads: 500, x: 512, instagram: 650, rednote: 1024, telegram: 2048,
      spankbang: 4096, eporner: 5120, clips4sale: 6144, bilibili: 8192, pornhub_video: 10240,
      odysee: 15360, gumroad_18: 16384, fansly_vault: 51200, youtube: 262144,
    };
    for (const [id, mb] of Object.entries(expected)) expect(getPlatform(id).maxMb, id).toBe(mb);
  });

  it("only lists connectors or SAU platforms for automated support levels", () => {
    for (const p of MASTER_PLATFORMS) {
      if (p.support === "native_connector") expect(p.connector, p.id).toBeTruthy();
      if (p.support === "sau_browser") expect(p.sauPlatform, p.id).toBeTruthy();
    }
  });
});

describe("calculateUploadConstraints", () => {
  it("strict mode returns the smallest limit as the ceiling", () => {
    const c = calculateUploadConstraints(["youtube", "bluesky", "discord", "telegram"], "strict");
    expect(c.allowedMaxMb).toBe(10);
    expect(c.bottleneckPlatform?.id).toBe("discord");
    expect(c.nextLimitIfUnchecked).toBe(100);
  });

  it("unchecking the bottleneck raises the ceiling to the previous nextLimitIfUnchecked", () => {
    const before = calculateUploadConstraints(["youtube", "bluesky", "discord", "telegram"], "strict");
    const after = calculateUploadConstraints(["youtube", "bluesky", "telegram"], "strict");
    expect(after.allowedMaxMb).toBe(before.nextLimitIfUnchecked);
    expect(after.bottleneckPlatform?.id).toBe("bluesky");
    expect(after.nextLimitIfUnchecked).toBe(2048);
  });

  it("strict mode with one platform repeats its own limit", () => {
    const c = calculateUploadConstraints(["vimeo"], "strict");
    expect(c.allowedMaxMb).toBe(5120);
    expect(c.nextLimitIfUnchecked).toBe(5120);
  });

  it("waterfall mode unlocks the largest selected limit", () => {
    const c = calculateUploadConstraints(["discord", "fansly_vault", "youtube", "xvideos"], "waterfall_autoscale");
    expect(c.allowedMaxMb).toBe(262144);
    expect(c.bottleneckPlatform?.id).toBe("youtube");
  });

  it("deduplicates ids and handles empty selections", () => {
    expect(calculateUploadConstraints([], "strict").allowedMaxMb).toBe(0);
    expect(calculateUploadConstraints(["bluesky", "bluesky"], "strict").sorted).toHaveLength(1);
  });

  it("rejects unknown platform ids", () => {
    expect(() => calculateUploadConstraints(["not_a_platform"], "strict")).toThrow(/Unknown platform/);
  });
});

describe("planWaterfall", () => {
  it("routes master, promo cut, teaser and link preview renditions", () => {
    const plan = Object.fromEntries(
      planWaterfall(8000, ["youtube", "xvideos", "discord", "bluesky", "x", "fansly_vault"]).map((a) => [a.platformId, a]),
    );
    expect(plan.youtube.rendition).toBe("master");
    expect(plan.fansly_vault.rendition).toBe("master");
    expect(plan.xvideos.rendition).toBe("promo_cut");
    expect(plan.xvideos.targetMaxMb).toBe(2000);
    expect(plan.xvideos.maxDurationSec).toBe(180);
    expect(plan.discord.rendition).toBe("teaser_clip");
    expect(plan.discord.targetMaxMb).toBe(9.5);
    expect(plan.bluesky.rendition).toBe("teaser_clip");
    expect(plan.x.rendition).toBe("link_preview");
  });

  it("computes a bitrate that fits the 12-second teaser budget", () => {
    const kbps = bitrateForBudget(9.5, 12);
    expect((kbps + 128) * 12 / 8 / 1024).toBeLessThanOrEqual(9.5);
  });
});
