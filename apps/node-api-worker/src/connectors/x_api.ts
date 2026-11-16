import { existsSync, readFileSync } from "node:fs";
import { extname } from "node:path";
import { StealthWorkerBridgeConnector } from "./registry";
import { assertSimulationAllowed, type ConnectorResult, type PlatformConnector, type PostPayload } from "./types";

const X_IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);

async function tryUploadXImageMedia(filePath: string, bearerToken: string): Promise<string | null> {
  if (!existsSync(filePath) || !X_IMAGE_EXTS.has(extname(filePath).toLowerCase())) {
    return null;
  }
  try {
    const form = new FormData();
    const raw = readFileSync(filePath);
    form.append("media_data", raw.toString("base64"));
    const uploadRes = await fetch("https://upload.twitter.com/1.1/media/upload.json", {
      method: "POST",
      headers: { Authorization: `Bearer ${bearerToken}` },
      body: form,
      signal: AbortSignal.timeout(20_000),
    });
    if (!uploadRes.ok) return null;
    const data = (await uploadRes.json()) as { media_id_string?: string };
    return data.media_id_string || null;
  } catch {
    return null;
  }
}

export class XApiConnector implements PlatformConnector {
  id = "x";

  async publish(payload: PostPayload): Promise<ConnectorResult> {
    const stealthUrl = process.env.STEALTH_WORKER_URL ?? "http://localhost:8001";
    const targetAccount = payload.accountId?.trim();

    // 1. If targetAccount is a connected Stealth Browser Vault profile (e.g. main_creator, x_acc_1..10),
    // dispatch through the isolated Patchright browser session for that account.
    if (targetAccount) {
      try {
        const res = await fetch(`${stealthUrl}/api/profiles`, {
          signal: AbortSignal.timeout(1500),
        });
        if (res.ok) {
          const data = (await res.json()) as { profiles?: Array<{ account_id?: string }> };
          const hasVaultProfile = (data.profiles || []).some((p) => p.account_id === targetAccount);
          if (hasVaultProfile) {
            return await new StealthWorkerBridgeConnector(this.id, stealthUrl).publish(payload);
          }
        }
      } catch {
        // Stealth worker unreachable; fall through to X API v2 check below
      }
    }

    // 2. Otherwise use X API v2 Bearer / OAuth2 User Token if configured
    const token = payload.credentials?.bearerToken ?? process.env.X_BEARER_TOKEN;
    if (!token) {
      assertSimulationAllowed(
        payload.strictLive,
        `X (Twitter) live publish for '${targetAccount || "default"}' requires either a connected Browser Vault session or X_BEARER_TOKEN in .env.`,
      );
      return {
        success: true,
        platformId: this.id,
        simulated: true,
        publishedUrl: `https://x.com/i/status/sim_${Date.now()}`,
        postId: `sim_${Date.now()}`,
      };
    }

    const tweetText = payload.linkUrl && !payload.firstComment && !payload.text.includes(payload.linkUrl)
      ? `${payload.text}\n\n${payload.linkUrl}`.slice(0, 280)
      : payload.text.slice(0, 280);

    const mediaId = payload.filePath ? await tryUploadXImageMedia(payload.filePath, token) : null;

    const res = await fetch("https://api.x.com/2/tweets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        mediaId ? { text: tweetText, media: { media_ids: [mediaId] } } : { text: tweetText },
      ),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const errText = await res.text();
      return {
        success: false,
        platformId: this.id,
        error: `X API v2 post failed (${res.status}): ${errText}`,
      };
    }

    const created = (await res.json()) as { data?: { id?: string } };
    const tweetId = created?.data?.id || `${Date.now()}`;
    const publishedUrl = `https://x.com/i/status/${tweetId}`;
    let firstCommentUrl: string | undefined;

    if (payload.firstComment && created?.data?.id) {
      const replyRes = await fetch("https://api.x.com/2/tweets", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: payload.firstComment.slice(0, 280),
          reply: { in_reply_to_tweet_id: tweetId },
        }),
        signal: AbortSignal.timeout(15_000),
      }).catch(() => null);

      if (replyRes && replyRes.ok) {
        const replyData = (await replyRes.json()) as { data?: { id?: string } };
        if (replyData?.data?.id) {
          firstCommentUrl = `https://x.com/i/status/${replyData.data.id}`;
        }
      }
    }

    return {
      success: true,
      platformId: this.id,
      simulated: false,
      publishedUrl,
      postId: tweetId,
      firstCommentUrl,
    };
  }
}
