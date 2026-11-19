import { describe, expect, it } from "vitest";
import { getPlatform } from "@polypost/platform-registry";
import {
  analyzeSpintax,
  auditCampaignCaptions,
  autoFixPlatformCaption,
  formatResolvedCaptionSheet,
  injectAntiSpamSpintax,
  resolveSpintaxVariant,
  resolveWorstCaseCaptionLength,
} from "../lib/caption-preflight";
import { NAV_ITEMS } from "../components/SiteNav";
import {
  addUtcMinutes,
  formatScheduleToCsv,
  parseScheduleCsv,
  staggerScheduledSlots,
} from "../lib/schedule-utils";

describe("caption preflight, strict-SFW scanner, and spintax uniqueness", () => {
  it("counts spintax permutations while ignoring {{LIVE_MASTER_URL}} template variables", () => {
    const template = "{Hey|Hi|Yo} check the {new drop|fresh clip} -> {{LIVE_MASTER_URL}}";
    const info = analyzeSpintax(template, 4);
    expect(info.hasSpintax).toBe(true);
    expect(info.unbalancedBraces).toBe(false);
    expect(info.blockCount).toBe(2);
    expect(info.permutations).toBe(6);
    expect(new Set(info.samples).size).toBe(4);
    expect(resolveSpintaxVariant(template, 0)).toBe("Hey check the new drop -> {{LIVE_MASTER_URL}}");
    expect(resolveSpintaxVariant(template, 1)).toBe("Hi check the new drop -> {{LIVE_MASTER_URL}}");
    expect(resolveSpintaxVariant(template, 3)).toBe("Hey check the fresh clip -> {{LIVE_MASTER_URL}}");

    const broken = analyzeSpintax("{Hey|Hi missing brace", 2);
    expect(broken.unbalancedBraces).toBe(true);
  });

  it("flags overlong X captions, strict-SFW violations on YouTube, and multi-account duplicate caption risk", () => {
    const longMicroblog = `${"A".repeat(260)} {{LIVE_MASTER_URL}}`;
    const audit = auditCampaignCaptions({
      selectedPlatformIds: ["x", "youtube", "bluesky"],
      generatedCaptions: {
        tube_seo: "Tube title",
        creator_store: "Store drop",
        microblog: longMicroblog,
        chat_community: "Hey chat!",
        strict_sfw_clean: "Check out my new nsfw onlyfans release!",
      },
      accountOverrides: {
        x: "x_acc_1, x_acc_2, x_acc_3",
      },
    });

    expect(audit.allOk).toBe(false);
    expect(audit.overLimitCount).toBeGreaterThanOrEqual(1);
    expect(audit.strictViolationCount).toBe(1);
    expect(audit.duplicateSiblingRiskCount).toBe(1);

    const xAudit = audit.items.find((i) => i.platformId === "x")!;
    expect(xAudit.overLimit).toBe(true);
    expect(xAudit.duplicateSiblingRisk).toBe(true);

    const ytAudit = audit.items.find((i) => i.platformId === "youtube")!;
    expect(ytAudit.strictViolation).toBe("nsfw");
  });

  it("auto-fixes strict-SFW denylisted terms and trims overlong captions while preserving {{LIVE_MASTER_URL}}", () => {
    const yt = getPlatform("youtube");
    const fixedYt = autoFixPlatformCaption("Brand new nsfw onlyfans studio shoot!", yt);
    expect(fixedYt.toLowerCase()).not.toContain("nsfw");
    expect(fixedYt.toLowerCase()).not.toContain("onlyfans");

    const x = getPlatform("x");
    const overlongX = `${"Cyberpunk neon night drop ".repeat(15)} {{LIVE_MASTER_URL}}`;
    const fixedX = autoFixPlatformCaption(overlongX, x);
    expect(fixedX).toContain("{{LIVE_MASTER_URL}}");
    expect(resolveWorstCaseCaptionLength(fixedX)).toBeLessThanOrEqual(280);
  });

  it("injects 16+ anti-spam spintax permutations and formats a resolved caption sheet", () => {
    const spun = injectAntiSpamSpintax(
      "Exploring neon saturation in the studio. {{LIVE_MASTER_URL}}",
      "microblog",
    );
    const analysis = analyzeSpintax(spun, 4);
    expect(analysis.hasSpintax).toBe(true);
    expect(analysis.permutations).toBeGreaterThanOrEqual(16);
    expect(injectAntiSpamSpintax(spun, "microblog")).toBe(spun);

    const audit = auditCampaignCaptions({
      selectedPlatformIds: ["x", "bluesky"],
      generatedCaptions: {
        tube_seo: "Tube",
        creator_store: "Store",
        microblog: spun,
        chat_community: "Chat",
        strict_sfw_clean: "SFW",
      },
      existingMasterUrl: "https://example.org/master",
    });
    const sheet = formatResolvedCaptionSheet(audit.items, "https://example.org/master");
    expect(sheet).toContain("https://example.org/master");
    expect(sheet).toContain("(x)");
    expect(sheet).toContain("(bluesky)");
  });

  it("defines 6 icon-only left menu navigation items with Alt+1..Alt+6 shortcuts", () => {
    expect(NAV_ITEMS.map((item) => item.href)).toEqual([
      "/",
      "/vault",
      "/presets",
      "/calendar",
      "/history",
      "/plans",
    ]);
    expect(NAV_ITEMS.map((item) => item.shortcut)).toEqual([
      "Alt+1",
      "Alt+2",
      "Alt+3",
      "Alt+4",
      "Alt+5",
      "Alt+6",
    ]);
    expect(NAV_ITEMS.filter((i) => i.group === "primary").length).toBe(5);
    expect(NAV_ITEMS.filter((i) => i.group === "bottom").length).toBe(1);
  });
});

describe("UTC schedule CSV parsing and anti-spam slot staggering", () => {
  it("parses valid CSV rows, reports malformed line numbers, and round-trips export", () => {
    const raw = [
      "Title, Date, Time, Platforms",
      "# comment line",
      "Neon Shoot, 2026-11-20, 19:00 UTC, youtube, x, bluesky",
      "Broken Line Without Platforms, 2026-11-20",
      "Bad Date Row, 2026-13-99, 10:00, x",
      "VIP Teaser, 2026-11-20, 19:10, x, discord",
    ].join("\n");

    const parsed = parseScheduleCsv(raw);
    expect(parsed.items.length).toBe(2);
    expect(parsed.items[1].time).toBe("19:10 UTC");
    expect(parsed.skippedLines.length).toBe(2);
    expect(parsed.skippedLines[0].lineNumber).toBe(4);
    expect(parsed.skippedLines[1].lineNumber).toBe(5);

    const csvOut = formatScheduleToCsv(
      parsed.items.map((it, idx) => ({
        ...it,
        id: `id_${idx}`,
        status: "scheduled" as const,
        createdAt: 1,
      })),
    );
    expect(csvOut).toContain("Neon Shoot, 2026-11-20, 19:00 UTC, youtube, x, bluesky");
  });

  it("staggers overlapping drops cleanly across midnight UTC without local timezone drift", () => {
    expect(addUtcMinutes("2026-11-20", "23:45 UTC", 30)).toEqual({
      date: "2026-11-21",
      time: "00:15 UTC",
    });

    const res = staggerScheduledSlots(
      [
        {
          id: "a",
          title: "Drop 1",
          date: "2026-11-20",
          time: "23:40 UTC",
          platforms: ["x"],
          status: "scheduled",
          createdAt: 1,
        },
        {
          id: "b",
          title: "Drop 2",
          date: "2026-11-20",
          time: "23:45 UTC",
          platforms: ["bluesky"],
          status: "scheduled",
          createdAt: 2,
        },
        {
          id: "c",
          title: "Drop 3",
          date: "2026-11-20",
          time: "23:50 UTC",
          platforms: ["discord"],
          status: "scheduled",
          createdAt: 3,
        },
      ],
      30,
    );

    expect(res.shiftedCount).toBe(2);
    expect(res.items.map((i) => `${i.date} ${i.time}`)).toEqual([
      "2026-11-20 23:40 UTC",
      "2026-11-21 00:10 UTC",
      "2026-11-21 00:40 UTC",
    ]);
  });
});
