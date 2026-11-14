import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BlueskyConnector,
  buildFirstCommentForTeaser,
  buildFunnelFlow,
  createSignedNostrEvent,
  deleteCampaignHistory,
  deleteSimulatedCampaignHistory,
  deriveNostrPubkeyHex,
  DeviantArtConnector,
  DevToConnector,
  E621Connector,
  FarcasterConnector,
  formatCleanAccountHandle,
  formatMasterUrlForTeaser,
  getAccountCooldownWaitMs,
  getCampaignHistoryEntry,
  getConnectorForPlatform,
  InkbunnyConnector,
  isNonRetryableAuthOrChallengeError,
  LemmyConnector,
  loadCampaignHistory,
  MatrixConnector,
  MisskeyConnector,
  NostrConnector,
  OAuthTokenManager,
  parseAccountAndTargetOverride,
  prepareTeaserMedia,
  pruneStaleTeaserRenders,
  QUEUE_NAMES,
  readMaskedCredentialSummary,
  recordAccountUploadTimestamp,
  recordCampaignHistory,
  RedditConnector,
  resolveAccountWatermark,
  RevoltStoatConnector,
  rotateTagsForAccountSibling,
  shouldUseFirstComment,
  TelegramConnector,
  TumblrConnector,
  upsertRootEnvCredentials,
  VkConnector,
  WordPressConnector,
  type FunnelSubmission,
} from "../src/index";
import type { ConnectorResult, PlatformConnector, PostPayload } from "../src/connectors/types";

describe("BullMQ Funnel-Link FlowProducer", () => {
  const submission: FunnelSubmission = {
    campaignId: "camp_2026_neon",
    masterTarget: {
      jobId: "master_job_001",
      platformId: "youtube",
      accountId: "acc_main",
      title: "Cyberpunk Studio Walkthrough 4K",
      description: "Behind the scenes 4K master walkthrough.",
      filePath: "/media/master_4k.mp4",
      tags: ["cyberpunk", "studio", "4k"],
    },
    teaserTargets: [
      {
        jobId: "teaser_job_001",
        platformId: "bluesky",
        accountId: "acc_social",
        captionTemplate: "Full video now live! Check it out: {{LIVE_MASTER_URL}}",
        filePath: "/media/teaser_12s.mp4",
      },
      {
        jobId: "teaser_job_002",
        platformId: "discord_webhook",
        accountId: "acc_social",
        captionTemplate: "New upload drop: {{LIVE_MASTER_URL}}",
        postFirstComment: true,
      },
      {
        jobId: "teaser_job_003",
        platformId: "x",
        accountId: "acc_social",
        captionTemplate: "Watch the full walkthrough here -> {{LIVE_MASTER_URL}}",
      },
    ],
  };

  it("constructs parent-child FlowJob hierarchy where master video executes first as child", () => {
    const flow = buildFunnelFlow({ ...submission, strictLive: true });

    expect(flow.queueName).toBe(QUEUE_NAMES.LIGHTWEIGHT_SOCIAL);
    expect(flow.name).toBe("funnel-teasers-camp_2026_neon");
    expect(flow.children).toHaveLength(1);
    expect((flow.data as any).strictLive).toBe(true);

    const masterChild = flow.children![0];
    expect(masterChild.queueName).toBe(QUEUE_NAMES.HEAVY_VIDEO);
    expect(masterChild.name).toBe("master-upload-youtube");
    expect((masterChild.data as any).platformId).toBe("youtube");
    expect((masterChild.data as any).strictLive).toBe(true);
    expect(masterChild.opts?.attempts).toBe(3);
    expect((masterChild.opts?.backoff as any)?.type).toBe("exponential");
  });

  it("verifies live URL injection logic across child teaser targets", async () => {
    const masterLiveUrl = "https://youtube.com/watch?v=dQw4w9WgXcQ";
    const publishedTeasers: Array<{ platformId: string; text: string; linkUrl: string }> = [];

    const mockConnector: PlatformConnector = {
      id: "mock",
      async publish(payload: PostPayload): Promise<ConnectorResult> {
        publishedTeasers.push({
          platformId: payload.platformId,
          text: payload.text,
          linkUrl: payload.linkUrl || "",
        });
        return {
          success: true,
          platformId: payload.platformId,
          publishedUrl: `https://${payload.platformId}.com/p/123`,
        };
      },
    };

    for (const teaser of submission.teaserTargets) {
      const injectedText = teaser.captionTemplate.replace(/\{\{LIVE_MASTER_URL\}\}/g, masterLiveUrl);
      await mockConnector.publish({
        platformId: teaser.platformId,
        accountId: teaser.accountId,
        text: injectedText,
        linkUrl: masterLiveUrl,
        filePath: teaser.filePath,
      });
    }

    expect(publishedTeasers).toHaveLength(3);
    expect(publishedTeasers[0].text).toContain("https://youtube.com/watch?v=dQw4w9WgXcQ");
    expect(publishedTeasers[0].linkUrl).toBe(masterLiveUrl);
    expect(publishedTeasers[1].text).toContain("https://youtube.com/watch?v=dQw4w9WgXcQ");
    expect(publishedTeasers[2].text).toContain("https://youtube.com/watch?v=dQw4w9WgXcQ");
  });

  it("TelegramConnector enforces strictLive guard and posts message + first comment reply via Bot API", async () => {
    const tgOffline = new TelegramConnector();
    const simResult = await tgOffline.publish({
      platformId: "telegram",
      accountId: "acc",
      text: "Hello channel",
    });
    expect(simResult.simulated).toBe(true);

    await expect(
      tgOffline.publish({ platformId: "telegram", accountId: "acc", text: "Hello", strictLive: true }),
    ).rejects.toThrow(/TELEGRAM_BOT_TOKEN/);

    const calls: Array<{ url: string; body: any }> = [];
    const tgMock = new TelegramConnector(async (input, init) => {
      calls.push({ url: String(input), body: JSON.parse(String(init?.body ?? "{}")) });
      const msgId = calls.length === 1 ? 101 : 102;
      return new Response(
        JSON.stringify({ ok: true, result: { message_id: msgId, chat: { username: "nova_studio" } } }),
        { status: 200 },
      );
    });

    const liveRes = await tgMock.publish({
      platformId: "telegram",
      accountId: "acc",
      text: "Teaser clip drop!",
      linkUrl: "https://youtube.com/watch?v=abc",
      firstComment: "Full 4K master: https://youtube.com/watch?v=abc",
      strictLive: true,
      credentials: { botToken: "tok_123", chatId: "@nova_studio" },
    });

    expect(liveRes.simulated).toBe(false);
    expect(liveRes.publishedUrl).toBe("https://t.me/nova_studio/101");
    expect(liveRes.firstCommentId).toBe("102");
    expect(calls[0].body.text).toBe("Teaser clip drop!");
    expect(calls[1].body.reply_to_message_id).toBe(101);
  });

  it("BlueskyConnector enforces strictLive when unconfigured", async () => {
    const bsky = new BlueskyConnector();
    const sim = await bsky.publish({ platformId: "bluesky", accountId: "a", text: "hi" });
    expect(sim.simulated).toBe(true);
    await expect(
      bsky.publish({ platformId: "bluesky", accountId: "a", text: "hi", strictLive: true }),
    ).rejects.toThrow(/BLUESKY_IDENTIFIER/);
  });

  it("OAuthTokenManager refreshes expiring tokens within 15-minute window and skips healthy tokens", async () => {
    const dir = mkdtempSync(join(tmpdir(), "polypost-oauth-"));
    try {
      const storePath = join(dir, "oauth-tokens.json");
      const now = 1_700_000_000_000;
      const manager = new OAuthTokenManager(storePath, async () => {
        return new Response(
          JSON.stringify({
            access_token: "new_access_999",
            refresh_token: "new_refresh_999",
            expires_in: 7200,
          }),
          { status: 200 },
        );
      });

      manager.saveTokens([
        {
          accountId: "yt_main",
          provider: "youtube",
          accessToken: "old_access",
          refreshToken: "old_refresh",
          expiresAtMs: now + 5 * 60 * 1000, // 5 mins left -> triggers 15-min refresh window
        },
        {
          accountId: "x_main",
          provider: "x",
          accessToken: "healthy_access",
          refreshToken: "healthy_refresh",
          expiresAtMs: now + 60 * 60 * 1000, // 60 mins left -> stays untouched
        },
      ]);

      const report = await manager.refreshExpiring(now);
      expect(report.refreshed).toEqual(["youtube:yt_main"]);
      expect(report.errors).toEqual([]);

      const updated = manager.loadTokens();
      expect(updated[0].accessToken).toBe("new_access_999");
      expect(updated[0].refreshToken).toBe("new_refresh_999");
      expect(updated[1].accessToken).toBe("healthy_access");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("buildFunnelFlow propagates autoReconcile and prepareTeaserMedia skips gracefully or reconciles real media", async () => {
    const flow = buildFunnelFlow({ ...submission, autoReconcile: true });
    expect((flow.data as any).autoReconcile).toBe(true);
    expect((flow.data as any).teasers[0].autoReconcile).toBe(true);

    const skippedMissing = await prepareTeaserMedia({
      campaignId: "camp_test",
      platformId: "bluesky",
      filePath: "/nonexistent/demo_video.mp4",
      autoReconcile: true,
    });
    expect(skippedMissing.reconciled).toBe(false);
    expect(skippedMissing.skippedReason).toBe("source_missing");
    expect(skippedMissing.filePath).toBe("/nonexistent/demo_video.mp4");

    const dir = mkdtempSync(join(tmpdir(), "polypost-reconcile-"));
    try {
      const samplePng = join(dir, "sample.png");
      const rendersDir = join(dir, "renders");
      execFileSync(
        "ffmpeg",
        ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=cyan:s=64x64:d=0.1", "-frames:v", "1", samplePng],
      );

      const textOnlyRes = await prepareTeaserMedia({
        campaignId: "camp_test",
        platformId: "reddit_nsfw",
        filePath: samplePng,
        autoReconcile: true,
        rendersDir,
      });
      expect(textOnlyRes.reconciled).toBe(false);
      expect(textOnlyRes.filePath).toBeUndefined();
      expect(textOnlyRes.skippedReason).toBe("text_only_platform");

      const cleanedImage = await prepareTeaserMedia({
        campaignId: "camp_test",
        platformId: "bluesky",
        filePath: samplePng,
        autoReconcile: true,
        rendersDir,
      });
      expect(cleanedImage.reconciled).toBe(true);
      expect(cleanedImage.mode).toBe("privacy_clean");
      expect(cleanedImage.isStillImage).toBe(true);
      expect(cleanedImage.filePath && existsSync(cleanedImage.filePath)).toBe(true);

      const shortMp4 = await prepareTeaserMedia({
        campaignId: "camp_test",
        platformId: "fansly_fyp",
        filePath: samplePng,
        autoReconcile: true,
        rendersDir,
      });
      expect(shortMp4.reconciled).toBe(true);
      expect(shortMp4.mode).toBe("image_to_short");
      expect(shortMp4.isStillImage).toBe(false);
      expect(shortMp4.filePath?.endsWith(".mp4")).toBe(true);
      expect(shortMp4.filePath && existsSync(shortMp4.filePath)).toBe(true);

      const sampleVideo = join(dir, "sample.mp4");
      execFileSync("ffmpeg", [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "color=c=magenta:s=160x120:d=2",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        sampleVideo,
      ]);
      const flowWm = buildFunnelFlow({
        ...submission,
        autoReconcile: true,
        startSec: 0.5,
        watermark: { text: "@StudioNova", position: "bottom-right" },
      });
      expect((flowWm.data as any).teasers[0].startSec).toBe(0.5);
      expect((flowWm.data as any).teasers[0].watermark.text).toBe("@StudioNova");

      const teaserVid = await prepareTeaserMedia({
        campaignId: "camp_vid",
        platformId: "bluesky",
        filePath: sampleVideo,
        autoReconcile: true,
        startSec: 0.5,
        watermark: { text: "@StudioNova", position: "top-left" },
        rendersDir,
      });
      expect(teaserVid.reconciled).toBe(true);
      expect(teaserVid.mode).toBe("funnel_bridge");
      expect(teaserVid.filePath && existsSync(teaserVid.filePath)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("persists campaign history entries and enforces DISABLE_SIMULATED_CONNECTORS", async () => {
    const dir = mkdtempSync(join(tmpdir(), "polypost-history-"));
    try {
      recordCampaignHistory(
        {
          campaignId: "camp_hist_1",
          topic: "Neon Launch",
          masterPlatformId: "youtube",
          accountId: "nova_acc",
          mediaPath: "/media/neon.mp4",
          step: "uploading_master",
          uploadPercent: 10,
          teasers: [{ jobId: "t1", platformId: "bluesky", status: "queued" }],
          updatedAt: 1000,
        },
        dir,
      );

      recordCampaignHistory(
        {
          campaignId: "camp_hist_1",
          step: "completed",
          uploadPercent: 100,
          liveMasterUrl: "https://youtube.com/watch?v=live1",
          masterSimulated: false,
          teasers: [
            {
              jobId: "t1",
              platformId: "bluesky",
              status: "published",
              publishedUrl: "https://bsky.app/profile/nova/post/1",
              failureScreenshot: "t1.png",
            },
          ],
          updatedAt: 2000,
        },
        dir,
      );

      const list = loadCampaignHistory(10, dir);
      expect(list).toHaveLength(1);
      expect(list[0].topic).toBe("Neon Launch");
      expect(list[0].publishedCount).toBe(1);
      expect(list[0].createdAt).toBe(1000);
      expect(getCampaignHistoryEntry("camp_hist_1", dir)?.teasers[0].failureScreenshot).toBe("t1.png");

      const del = deleteCampaignHistory("camp_hist_1", dir);
      expect(del.deleted).toBe(1);
      expect(loadCampaignHistory(10, dir)).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }

    const prevFlag = process.env.DISABLE_SIMULATED_CONNECTORS;
    process.env.DISABLE_SIMULATED_CONNECTORS = "1";
    try {
      const bsky = new BlueskyConnector();
      await expect(bsky.publish({ platformId: "bluesky", accountId: "a", text: "hi" })).rejects.toThrow(
        /DISABLE_SIMULATED_CONNECTORS/,
      );
      const tg = new TelegramConnector();
      await expect(tg.publish({ platformId: "telegram", accountId: "a", text: "hi" })).rejects.toThrow(
        /DISABLE_SIMULATED_CONNECTORS/,
      );
    } finally {
      if (prevFlag === undefined) delete process.env.DISABLE_SIMULATED_CONNECTORS;
      else process.env.DISABLE_SIMULATED_CONNECTORS = prevFlag;
    }
  });

  it("routes and publishes live payloads via Reddit, e621, DeviantArt, and Inkbunny connectors with strictLive guards", async () => {
    expect(getConnectorForPlatform("reddit").id).toBe("reddit");
    expect(getConnectorForPlatform("reddit_nsfw").id).toBe("reddit_nsfw");
    expect(getConnectorForPlatform("e621").id).toBe("e621");
    expect(getConnectorForPlatform("deviantart_mature").id).toBe("deviantart_mature");
    expect(getConnectorForPlatform("inkbunny").id).toBe("inkbunny");

    // strictLive blocks missing credentials cleanly
    const redditConn = new RedditConnector("reddit_nsfw");
    await expect(
      redditConn.publish({ platformId: "reddit_nsfw", accountId: "a", text: "hi", strictLive: true }),
    ).rejects.toThrow(/REDDIT/);
    await expect(
      new E621Connector().publish({ platformId: "e621", accountId: "a", text: "hi", strictLive: true }),
    ).rejects.toThrow(/E621/);
    await expect(
      new DeviantArtConnector().publish({ platformId: "deviantart_mature", accountId: "a", text: "hi", strictLive: true }),
    ).rejects.toThrow(/DEVIANTART/);
    await expect(
      new InkbunnyConnector().publish({ platformId: "inkbunny", accountId: "a", text: "hi", strictLive: true }),
    ).rejects.toThrow(/INKBUNNY/);

    // Mock live Reddit password OAuth + submit + first comment
    const calls: string[] = [];
    const mockRedditFetch: typeof fetch = async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/api/v1/access_token")) {
        return new Response(JSON.stringify({ access_token: "red_tok_1" }), { status: 200 });
      }
      if (url.endsWith("/api/submit")) {
        return new Response(
          JSON.stringify({ json: { data: { url: "https://reddit.com/r/nova/comments/abc1", name: "t3_abc1", id: "abc1" } } }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({ json: { data: { things: [{ data: { name: "t1_xyz9" } }] } } }),
        { status: 200 },
      );
    };
    const redditLive = await new RedditConnector("reddit_nsfw", mockRedditFetch).publish({
      platformId: "reddit_nsfw",
      accountId: "a",
      text: "Studio Cyberpunk Release",
      firstComment: "Full set: https://example.com/live",
      strictLive: true,
      credentials: { clientId: "cid", clientSecret: "csec", username: "nova", password: "pw", subreddit: "r/nova" },
    });
    expect(redditLive.simulated).toBe(false);
    expect(redditLive.publishedUrl).toBe("https://reddit.com/r/nova/comments/abc1");
    expect(redditLive.firstCommentId).toBe("t1_xyz9");
    expect(calls).toHaveLength(3);

    // Mock live media uploads for e621, DeviantArt, and Inkbunny
    const dir = mkdtempSync(join(tmpdir(), "polypost-connectors-"));
    try {
      const sampleFile = join(dir, "art.png");
      writeFileSync(sampleFile, Buffer.from("fake-png-bytes"));

      const e621Res = await new E621Connector(async () => new Response(JSON.stringify({ success: true, post_id: 7742 }), { status: 200 })).publish({
        platformId: "e621",
        accountId: "a",
        text: "Neon study",
        tags: ["cyberpunk", "neon lighting"],
        filePath: sampleFile,
        strictLive: true,
        credentials: { username: "nova", apiKey: "k123" },
      });
      expect(e621Res.simulated).toBe(false);
      expect(e621Res.publishedUrl).toBe("https://e621.net/posts/7742");

      const daRes = await new DeviantArtConnector("deviantart_mature", async (input) => {
        if (String(input).includes("stash/submit")) {
          return new Response(JSON.stringify({ itemid: 5511 }), { status: 200 });
        }
        return new Response(
          JSON.stringify({ url: "https://www.deviantart.com/nova/art/5511", deviationid: "DEV-5511" }),
          { status: 200 },
        );
      }).publish({
        platformId: "deviantart_mature",
        accountId: "a",
        text: "Cyberpunk Release",
        filePath: sampleFile,
        strictLive: true,
        credentials: { accessToken: "da_tok" },
      });
      expect(daRes.simulated).toBe(false);
      expect(daRes.postId).toBe("DEV-5511");

      const ibRes = await new InkbunnyConnector(async (input) => {
        const u = String(input);
        if (u.includes("api_login")) return new Response(JSON.stringify({ sid: "ib_sid_1" }), { status: 200 });
        if (u.includes("api_upload")) return new Response(JSON.stringify({ submission_id: 9088 }), { status: 200 });
        return new Response(JSON.stringify({ submission_id: 9088 }), { status: 200 });
      }).publish({
        platformId: "inkbunny",
        accountId: "a",
        text: "Studio Frame",
        filePath: sampleFile,
        strictLive: true,
        credentials: { username: "nova", password: "pw" },
      });
      expect(ibRes.simulated).toBe(false);
      expect(ibRes.publishedUrl).toBe("https://inkbunny.net/s/9088");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("manages masked .env credentials dynamically and maps per-platform accountOverrides in buildFunnelFlow", () => {
    const dir = mkdtempSync(join(tmpdir(), "polypost-env-"));
    const prevEnvMap = {
      BLUESKY_IDENTIFIER: process.env.BLUESKY_IDENTIFIER,
      BLUESKY_PASSWORD: process.env.BLUESKY_PASSWORD,
    };
    try {
      const saveRes = upsertRootEnvCredentials(
        {
          BLUESKY_IDENTIFIER: "nova.bsky.social",
          BLUESKY_PASSWORD: "app-password-9876",
        },
        dir,
      );
      expect(saveRes.updatedKeys).toContain("BLUESKY_IDENTIFIER");
      expect(saveRes.updatedKeys).toContain("BLUESKY_PASSWORD");

      // Secret untouched placeholder must NOT overwrite actual password
      upsertRootEnvCredentials({ BLUESKY_PASSWORD: "••••9876" }, dir);
      expect(process.env.BLUESKY_PASSWORD).toBe("app-password-9876");

      const summary = readMaskedCredentialSummary(dir);
      const bsky = summary.providers.find((p) => p.id === "bluesky");
      expect(bsky?.configured).toBe(true);
      expect(bsky?.fields.find((f) => f.key === "BLUESKY_PASSWORD")?.preview).toBe("••••9876");

      upsertRootEnvCredentials({ BLUESKY_IDENTIFIER: null, BLUESKY_PASSWORD: null }, dir);
      expect(process.env.BLUESKY_IDENTIFIER).toBeUndefined();

      expect(() => upsertRootEnvCredentials({ PATH: "/bad" }, dir)).toThrow(/not an editable/);
    } finally {
      if (prevEnvMap.BLUESKY_IDENTIFIER === undefined) delete process.env.BLUESKY_IDENTIFIER;
      else process.env.BLUESKY_IDENTIFIER = prevEnvMap.BLUESKY_IDENTIFIER;
      if (prevEnvMap.BLUESKY_PASSWORD === undefined) delete process.env.BLUESKY_PASSWORD;
      else process.env.BLUESKY_PASSWORD = prevEnvMap.BLUESKY_PASSWORD;
      rmSync(dir, { recursive: true, force: true });
    }

    const flow = buildFunnelFlow({
      ...submission,
      accountOverrides: {
        youtube: "yt_main_channel",
        x: "x_promo_alt",
      },
    });
    expect((flow.children![0].data as any).accountId).toBe("yt_main_channel");
    const teasers = (flow.data as any).teasers as Array<{ platformId: string; accountId: string }>;
    expect(teasers.find((t) => t.platformId === "x")?.accountId).toBe("x_promo_alt");
    expect(teasers.find((t) => t.platformId === "bluesky")?.accountId).toBe("acc_social");
  });

  it("delegates REST/upload platforms like youtube/x to StealthWorker when vaulted browser session exists for accountId", async () => {
    const prevFetch = globalThis.fetch;
    const prevStealth = process.env.STEALTH_WORKER_URL;
    const calls: string[] = [];
    process.env.STEALTH_WORKER_URL = "http://stealth.mock";
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/api/profiles")) {
        return new Response(JSON.stringify({ profiles: [{ account_id: "yt_vaulted", platform: "youtube" }] }), {
          status: 200,
        });
      }
      if (url.endsWith("/api/upload")) {
        return new Response(
          JSON.stringify({
            success: true,
            job_id: "job_yt_1",
            published_url: "https://www.youtube.com/watch?v=vault_ok",
            dry_run: false,
          }),
          { status: 200 },
        );
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    try {
      const ytConn = getConnectorForPlatform("youtube");
      const res = await ytConn.publish({
        platformId: "youtube",
        accountId: "yt_vaulted",
        text: "My Studio Upload\nDescription",
        filePath: "/tmp/vid.mp4",
        strictLive: true,
      });
      expect(res.success).toBe(true);
      expect(res.publishedUrl).toBe("https://www.youtube.com/watch?v=vault_ok");
      expect(calls).toEqual(["http://stealth.mock/api/profiles", "http://stealth.mock/api/upload"]);
    } finally {
      globalThis.fetch = prevFetch;
      if (prevStealth === undefined) delete process.env.STEALTH_WORKER_URL;
      else process.env.STEALTH_WORKER_URL = prevStealth;
    }

    expect(
      isNonRetryableAuthOrChallengeError("Security challenge detected (Cloudflare). Automatic retries halted"),
    ).toBe(true);
    expect(isNonRetryableAuthOrChallengeError("Session expired; redirected to login gate")).toBe(true);
    expect(isNonRetryableAuthOrChallengeError("Reddit API error (401): Unauthorized")).toBe(true);
    expect(isNonRetryableAuthOrChallengeError("Network socket hang up ETIMEDOUT")).toBe(false);
  });

  it("fans out comma-separated multi-account overrides (5 accounts on X) with unique anti-sybil captions", () => {
    const flow = buildFunnelFlow({
      ...submission,
      staggerSec: 15,
      accountOverrides: {
        x: "x_acc_1, x_acc_2, x_acc_3, x_acc_4, x_acc_5",
      },
    });
    const teasers = (flow.data as any).teasers as Array<{
      jobId: string;
      platformId: string;
      accountId: string;
      captionTemplate: string;
      siblingIndex?: number;
      staggerSec?: number;
    }>;
    const xTeasers = teasers.filter((t) => t.platformId === "x");
    expect(xTeasers.map((t) => t.accountId)).toEqual([
      "x_acc_1",
      "x_acc_2",
      "x_acc_3",
      "x_acc_4",
      "x_acc_5",
    ]);
    expect(xTeasers.map((t) => t.siblingIndex)).toEqual([0, 1, 2, 3, 4]);
    expect(xTeasers.every((t) => t.staggerSec === 15)).toBe(true);
    // Every sibling account on X must get a distinct caption template to avoid duplicate text hash bans
    const uniqueCaptions = new Set(xTeasers.map((t) => t.captionTemplate));
    expect(uniqueCaptions.size).toBe(5);
    for (const c of uniqueCaptions) {
      expect(c).toContain("{{LIVE_MASTER_URL}}");
    }
  });

  it("resolves per-account {{ACCOUNT_ID}} watermarks, scheduled delayMs, and prunes stale teaser renders", () => {
    const wm = resolveAccountWatermark(
      { text: "Exclusive @{{ACCOUNT_ID}}", position: "bottom-right" },
      "manyvids_acc_3",
    );
    expect(wm?.text).toBe("Exclusive @manyvids_acc_3");

    const flow = buildFunnelFlow({
      ...submission,
      delayMs: 1_800_000,
      teaserTargets: [
        {
          jobId: "t_wm_1",
          platformId: "x",
          accountId: "x_vip_2",
          captionTemplate: "Follow @{{ACCOUNT_ID}} -> {{LIVE_MASTER_URL}}",
        },
      ],
    });
    expect(flow.children?.[0]?.opts?.delay).toBe(1_800_000);
    const firstTeaser = (flow.data as any).teasers[0];
    expect(firstTeaser.captionTemplate).toContain("@x_vip_2");

    const tmpRenders = mkdtempSync(join(tmpdir(), "polypost-prune-test-"));
    try {
      for (let i = 0; i < 6; i++) {
        writeFileSync(join(tmpRenders, `render_${i}.mp4`), `video_${i}`);
      }
      const res = pruneStaleTeaserRenders(tmpRenders, 3);
      expect(res.deleted).toBe(3);
      expect(res.kept).toBe(3);
    } finally {
      rmSync(tmpRenders, { recursive: true, force: true });
    }
  });

  it("parses account:r/subreddit overrides so multi-account Reddit fan-out targets distinct subreddits", () => {
    expect(parseAccountAndTargetOverride("reddit_1:r/cyberpunk")).toEqual({
      accountId: "reddit_1",
      targetSubreddit: "cyberpunk",
    });
    expect(parseAccountAndTargetOverride("reddit_2:neonart")).toEqual({
      accountId: "reddit_2",
      targetSubreddit: "neonart",
    });

    const flow = buildFunnelFlow({
      ...submission,
      accountOverrides: {
        reddit_nsfw: "reddit_1:r/cyberpunk, reddit_2:r/neonart",
      },
      teaserTargets: [
        {
          jobId: "t_red_1",
          platformId: "reddit_nsfw",
          accountId: "default",
          captionTemplate: "New set live -> {{LIVE_MASTER_URL}}",
        },
      ],
    });
    const teasers = (flow.data as any).teasers;
    expect(teasers).toHaveLength(2);
    expect(teasers[0].accountId).toBe("reddit_1");
    expect(teasers[0].extraParams?.subreddit).toBe("cyberpunk");
    expect(teasers[1].accountId).toBe("reddit_2");
    expect(teasers[1].extraParams?.subreddit).toBe("neonart");
  });

  it("injects per-platform PPV priceOverrides ({{PRICE_USD}}) and formats UTM tracking URLs per account", () => {
    const tracked = formatMasterUrlForTeaser(
      "https://onlyfans.com/studionova/c123",
      "x",
      "x_acc_4",
      true,
    );
    expect(tracked).toBe(
      "https://onlyfans.com/studionova/c123?utm_source=x&utm_medium=social_teaser&utm_content=x_acc_4",
    );
    expect(
      formatMasterUrlForTeaser("https://onlyfans.com/studionova/c123", "x", "x_acc_4", false),
    ).toBe("https://onlyfans.com/studionova/c123");

    const flow = buildFunnelFlow({
      ...submission,
      priceUsd: 14.99,
      priceOverrides: {
        manyvids_store: 19.99,
        onlyfans_ppv: 9.5,
      },
      appendUtm: true,
      teaserTargets: [
        {
          jobId: "t_mv",
          platformId: "manyvids_store",
          accountId: "mv_1",
          captionTemplate: "Unlock 4K on MV for {{PRICE_USD}} -> {{LIVE_MASTER_URL}}",
        },
        {
          jobId: "t_of",
          platformId: "onlyfans_ppv",
          accountId: "of_1",
          captionTemplate: "Unlock on OF for {{PRICE}} -> {{LIVE_MASTER_URL}}",
        },
      ],
    });
    const teasers = (flow.data as any).teasers;
    expect(teasers[0].extraParams?.price_usd).toBe(19.99);
    expect(teasers[0].captionTemplate).toContain("$19.99");
    expect(teasers[0].appendUtm).toBe(true);
    expect(teasers[1].extraParams?.price_usd).toBe(9.5);
    expect(teasers[1].captionTemplate).toContain("$9.50");
  });

  it("skips the heavy master upload child job when existingMasterUrl is provided (Teaser-Only Fast Mode)", () => {
    const flow = buildFunnelFlow({
      ...submission,
      existingMasterUrl: "https://onlyfans.com/studionova",
      delayMs: 60_000,
    });
    expect(flow.children).toBeUndefined();
    expect((flow.data as any).existingMasterUrl).toBe("https://onlyfans.com/studionova");
    expect(flow.opts?.delay).toBe(60_000);

    const baseTags = ["neon", "cyberpunk", "photoshoot", "4k"];
    expect(rotateTagsForAccountSibling(baseTags, 0)).toEqual(["neon", "cyberpunk", "photoshoot", "4k"]);
    expect(rotateTagsForAccountSibling(baseTags, 1)).toEqual(["cyberpunk", "photoshoot", "4k", "neon"]);
    expect(rotateTagsForAccountSibling(baseTags, 2)).toEqual(["photoshoot", "4k", "neon", "cyberpunk"]);
  });

  it("rotates sibling first-comment CTAs, skips store-only targets, and enforces per-account cooldown guards", () => {
    expect(shouldUseFirstComment("reddit", true)).toBe(true);
    expect(shouldUseFirstComment("x", true)).toBe(true);
    expect(shouldUseFirstComment("manyvids_store", true)).toBe(false);
    expect(shouldUseFirstComment("clips4sale", true)).toBe(false);
    expect(shouldUseFirstComment("reddit", false)).toBe(false);

    const url = "https://fansly.com/post/999?utm_source=x";
    const comment0 = buildFirstCommentForTeaser({
      postFirstComment: true,
      platformId: "x",
      trackedMasterUrl: url,
      siblingIndex: 0,
      priceUsd: 14.99,
    });
    const comment1 = buildFirstCommentForTeaser({
      postFirstComment: true,
      platformId: "x",
      trackedMasterUrl: url,
      siblingIndex: 1,
      priceUsd: 14.99,
    });
    expect(comment0).toContain(url);
    expect(comment1).toContain(url);
    expect(comment0).not.toEqual(comment1);

    const customComment = buildFirstCommentForTeaser({
      postFirstComment: true,
      platformId: "reddit",
      trackedMasterUrl: url,
      firstCommentTemplate: "Unlock VIP for {{PRICE_USD}} on @{{ACCOUNT_ID}} -> {{LIVE_MASTER_URL}}",
      siblingIndex: 0,
      accountId: "nova_vip",
      priceUsd: 19.99,
    });
    expect(customComment).toBe(`Unlock VIP for $19.99 on @nova_vip -> ${url}`);

    expect(
      buildFirstCommentForTeaser({
        postFirstComment: true,
        platformId: "manyvids_store",
        trackedMasterUrl: url,
      }),
    ).toBeUndefined();

    recordAccountUploadTimestamp("x", "acc_cooldown_test", 10_000);
    expect(getAccountCooldownWaitMs("x", "acc_cooldown_test", 12_000, 5_000)).toBe(3_000);
    expect(getAccountCooldownWaitMs("x", "acc_cooldown_test", 16_000, 5_000)).toBe(0);
  });

  it("parses per-account promo link overrides (accountId|https://...) and propagates targetUrlOverride in buildFunnelFlow", () => {
    expect(parseAccountAndTargetOverride("x_1|https://onlyfans.com/persona1")).toEqual({
      accountId: "x_1",
      targetUrlOverride: "https://onlyfans.com/persona1",
    });
    expect(
      parseAccountAndTargetOverride("reddit_1:r/cyberpunk|https://fansly.com/persona1"),
    ).toEqual({
      accountId: "reddit_1",
      targetSubreddit: "cyberpunk",
      targetUrlOverride: "https://fansly.com/persona1",
    });

    const flow = buildFunnelFlow({
      ...submission,
      accountOverrides: {
        x: "x_1|https://onlyfans.com/persona1, x_2|https://onlyfans.com/persona2",
      },
    });
    const xTeasers = ((flow.data as any).teasers as any[]).filter((t) => t.platformId === "x");
    expect(xTeasers).toHaveLength(2);
    expect(xTeasers[0].accountId).toBe("x_1");
    expect(xTeasers[0].targetUrlOverride).toBe("https://onlyfans.com/persona1");
    expect(xTeasers[1].accountId).toBe("x_2");
    expect(xTeasers[1].targetUrlOverride).toBe("https://onlyfans.com/persona2");
  });

  it("formats {{ACCOUNT_HANDLE}}, parses #WatermarkText overrides, and prunes simulated history while keeping live runs", () => {
    expect(formatCleanAccountHandle("x_acc_studionova")).toBe("studionova");
    expect(formatCleanAccountHandle("reddit_account_cyber")).toBe("cyber");
    const wm = resolveAccountWatermark(
      { text: "@{{ACCOUNT_HANDLE}}", position: "bottom-right" },
      "x_acc_studionova",
    );
    expect(wm?.text).toBe("@studionova");

    expect(
      parseAccountAndTargetOverride("x_1#@NovaVIP|https://onlyfans.com/persona1"),
    ).toEqual({
      accountId: "x_1",
      watermarkText: "@NovaVIP",
      targetUrlOverride: "https://onlyfans.com/persona1",
    });

    const tmpHistoryDir = mkdtempSync(join(tmpdir(), "polypost-sim-prune-"));
    try {
      recordCampaignHistory(
        {
          campaignId: "camp_live_1",
          topic: "Live Run",
          masterPlatformId: "youtube",
          accountId: "main",
          existingMasterUrl: "https://onlyfans.com/studionova",
          firstCommentTemplate: "Unlock VIP for {{PRICE_USD}}: {{LIVE_MASTER_URL}}",
          priceOverrides: { manyvids_store: 19.99 },
          accountOverrides: { x: "x_1, x_2" },
          step: "completed",
          uploadPercent: 100,
          liveMasterUrl: "https://youtube.com/watch?v=real1",
          masterSimulated: false,
          teasers: [],
          updatedAt: Date.now(),
        },
        tmpHistoryDir,
      );
      recordCampaignHistory(
        {
          campaignId: "camp_sim_1",
          topic: "Demo Run",
          masterPlatformId: "youtube",
          accountId: "main",
          step: "completed",
          uploadPercent: 100,
          liveMasterUrl: "https://youtube.example.com/p/sim_1",
          masterSimulated: true,
          teasers: [],
          updatedAt: Date.now() + 100,
        },
        tmpHistoryDir,
      );

      const pruned = deleteSimulatedCampaignHistory(tmpHistoryDir);
      expect(pruned).toEqual({ deleted: 1, kept: 1 });
      const remaining = loadCampaignHistory(10, tmpHistoryDir);
      expect(remaining).toHaveLength(1);
      expect(remaining[0].campaignId).toBe("camp_live_1");
      expect(remaining[0].existingMasterUrl).toBe("https://onlyfans.com/studionova");
      expect(remaining[0].firstCommentTemplate).toBe(
        "Unlock VIP for {{PRICE_USD}}: {{LIVE_MASTER_URL}}",
      );
      expect(remaining[0].priceOverrides).toEqual({ manyvids_store: 19.99 });
      expect(remaining[0].accountOverrides).toEqual({ x: "x_1, x_2" });
    } finally {
      rmSync(tmpHistoryDir, { recursive: true, force: true });
    }
  });

  it("routes Misskey, Lemmy,PieFed, Tumblr, and new creator platforms (Maloum, Boosty, FanCentro, Slushy, APClips, Modelhub, BentBox, Ko-fi)", async () => {
    expect(getConnectorForPlatform("misskey")).toBeInstanceOf(MisskeyConnector);
    expect(getConnectorForPlatform("lemmy")).toBeInstanceOf(LemmyConnector);
    expect(getConnectorForPlatform("piefed")).toBeInstanceOf(LemmyConnector);
    expect(getConnectorForPlatform("tumblr")).toBeInstanceOf(TumblrConnector);

    for (const pid of ["maloum", "boosty", "fancentro", "slushy", "apclips", "modelhub", "bentbox", "kofi"]) {
      const conn = getConnectorForPlatform(pid);
      expect(conn.id).toBe(pid);
    }

    expect(shouldUseFirstComment("apclips", true)).toBe(false);
    expect(shouldUseFirstComment("modelhub", true)).toBe(false);
    expect(shouldUseFirstComment("bentbox", true)).toBe(false);
    expect(shouldUseFirstComment("fancentro", true)).toBe(false);

    await expect(
      new MisskeyConnector().publish({
        platformId: "misskey",
        accountId: "default",
        text: "Test",
        strictLive: true,
      }),
    ).rejects.toThrow(/MISSKEY_TOKEN/);

    await expect(
      new LemmyConnector().publish({
        platformId: "lemmy",
        accountId: "default",
        text: "Test",
        strictLive: true,
      }),
    ).rejects.toThrow(/LEMMY_USERNAME/);

    await expect(
      new TumblrConnector().publish({
        platformId: "tumblr",
        accountId: "default",
        text: "Test",
        strictLive: true,
      }),
    ).rejects.toThrow(/TUMBLR_BLOG/);
  });

  it("signs NIP-01 Schnorr Nostr events and routes Nostr, Matrix, Farcaster, WordPress, Dev.to, Stoat/Revolt, and VK connectors", async () => {
    expect(getConnectorForPlatform("nostr")).toBeInstanceOf(NostrConnector);
    expect(getConnectorForPlatform("matrix")).toBeInstanceOf(MatrixConnector);
    expect(getConnectorForPlatform("farcaster")).toBeInstanceOf(FarcasterConnector);
    expect(getConnectorForPlatform("wordpress")).toBeInstanceOf(WordPressConnector);
    expect(getConnectorForPlatform("devto")).toBeInstanceOf(DevToConnector);
    expect(getConnectorForPlatform("stoat")).toBeInstanceOf(RevoltStoatConnector);
    expect(getConnectorForPlatform("vk")).toBeInstanceOf(VkConnector);

    // BIP-340 test vector #0: privkey = 0x0000...0003 -> x-only pubkey = f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9
    const testPrivKey = "0000000000000000000000000000000000000000000000000000000000000003";
    const pubkey = deriveNostrPubkeyHex(testPrivKey);
    expect(pubkey).toBe("f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9");

    const signedEvent = createSignedNostrEvent({
      privKeyHex: testPrivKey,
      content: "Cyberpunk drop live! #nostr #cyberpunk",
      tags: [["t", "nostr"], ["t", "cyberpunk"]],
      createdAt: 1700000000,
    });
    expect(signedEvent.pubkey).toBe(pubkey);
    expect(signedEvent.kind).toBe(1);
    expect(signedEvent.id).toMatch(/^[0-9a-f]{64}$/);
    expect(signedEvent.sig).toMatch(/^[0-9a-f]{128}$/);

    await expect(
      new NostrConnector().publish({
        platformId: "nostr",
        accountId: "default",
        text: "Test Nostr note",
        strictLive: true,
      }),
    ).rejects.toThrow(/NOSTR_PRIVATE_KEY/);

    await expect(
      new MatrixConnector().publish({
        platformId: "matrix",
        accountId: "default",
        text: "Test Matrix message",
        strictLive: true,
      }),
    ).rejects.toThrow(/MATRIX_ACCESS_TOKEN/);

    await expect(
      new FarcasterConnector().publish({
        platformId: "farcaster",
        accountId: "default",
        text: "Test Farcaster cast",
        strictLive: true,
      }),
    ).rejects.toThrow(/FARCASTER_NEYNAR_API_KEY/);

    await expect(
      new WordPressConnector().publish({
        platformId: "wordpress",
        accountId: "default",
        text: "Test WP post",
        strictLive: true,
      }),
    ).rejects.toThrow(/WORDPRESS_SITE_URL/);
  });
});
