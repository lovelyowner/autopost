import { basename } from "node:path";
import { getPlatform } from "@polypost/platform-registry";
import { BlueskyConnector } from "./bluesky";
import { DeviantArtConnector } from "./deviantart";
import { E621Connector } from "./e621";
import { FarcasterConnector } from "./farcaster";
import { InkbunnyConnector } from "./inkbunny";
import { LemmyConnector } from "./lemmy";
import { MastodonConnector } from "./mastodon";
import { MatrixConnector } from "./matrix";
import { MisskeyConnector } from "./misskey";
import { NostrConnector } from "./nostr";
import { DevToConnector, RevoltStoatConnector, VkConnector, WordPressConnector } from "./publishing_apis";
import { RedditConnector } from "./reddit";
import { TelegramConnector } from "./telegram";
import { TumblrConnector } from "./tumblr";
import { TusChunkedConnector } from "./tus_s3_chunked";
import { assertSimulationAllowed, isSimulationDisabled, type ConnectorResult, type PlatformConnector, type PostPayload } from "./types";
import { WebhookConnector } from "./webhooks";
import { XApiConnector } from "./x_api";
import { YouTubeApiConnector } from "./youtube";

export class StealthWorkerBridgeConnector implements PlatformConnector {
  constructor(
    public id: string,
    private workerBaseUrl = process.env.STEALTH_WORKER_URL ?? "http://localhost:8001",
  ) {}

  async publish(payload: PostPayload): Promise<ConnectorResult> {
    const dryRun = isSimulationDisabled() ? false : (payload.extraParams?.dryRun ?? !payload.strictLive);
    const res = await fetch(`${this.workerBaseUrl}/api/upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        job_id: `job_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        account_id: payload.accountId || "default",
        platform_id: payload.platformId,
        file_path: payload.filePath || "",
        title: payload.text.split("\n")[0] || "PolyPost Upload",
        description: payload.text,
        tags: payload.tags || [],
        dry_run: dryRun,
        confirmed_2257_attestation: payload.extraParams?.confirmed_2257_attestation ?? false,
        records_id_2257: payload.extraParams?.records_id_2257,
        extra_params: payload.extraParams || {},
      }),
      signal: AbortSignal.timeout(300_000),
    });

    if (!res.ok) {
      const err = await res.text();
      return {
        success: false,
        platformId: this.id,
        error: `Stealth worker upload failed (${res.status}): ${err}`,
      };
    }

    const data = (await res.json()) as any;
    const rawShot = typeof data.failure_screenshot === "string" ? data.failure_screenshot : undefined;
    return {
      success: Boolean(data.success),
      platformId: this.id,
      simulated: Boolean(data.dry_run),
      publishedUrl: data.published_url,
      postId: data.job_id,
      failureScreenshot: rawShot ? basename(rawShot) : undefined,
      error: data.error,
    };
  }
}

class GenericRestConnector implements PlatformConnector {
  constructor(public id: string) {}

  async publish(payload: PostPayload): Promise<ConnectorResult> {
    const stealthUrl = process.env.STEALTH_WORKER_URL ?? "http://localhost:8001";
    const targetAccount = payload.accountId?.trim();
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
        // Stealth worker unreachable; fall through to strictLive / simulation check below
      }
    }

    assertSimulationAllowed(
      payload.strictLive,
      `No native live API connector configured for '${this.id}'. Connect a browser session in Vault for '${payload.accountId}' or provide connector credentials.`,
    );
    return {
      success: true,
      platformId: this.id,
      simulated: true,
      publishedUrl: `https://${this.id}.example.com/post/sim_${Date.now()}`,
      postId: `sim_${Date.now()}`,
    };
  }
}

export function getConnectorForPlatform(platformId: string): PlatformConnector {
  const pl = getPlatform(platformId);

  // If requires patchright stealth or sau_browser, route to stealth worker
  if (pl.transport === "patchright_stealth" || pl.support === "sau_browser") {
    return new StealthWorkerBridgeConnector(platformId);
  }

  switch (pl.connector) {
    case "youtube":
      return new YouTubeApiConnector();
    case "x":
      return new XApiConnector();
    case "bluesky":
      return new BlueskyConnector();
    case "mastodon":
      return new MastodonConnector(platformId);
    case "misskey":
      return new MisskeyConnector(platformId);
    case "lemmy":
      return new LemmyConnector(platformId);
    case "tumblr":
      return new TumblrConnector(platformId);
    case "nostr":
      return new NostrConnector(platformId);
    case "matrix":
      return new MatrixConnector(platformId);
    case "farcaster":
      return new FarcasterConnector(platformId);
    case "wordpress":
      return new WordPressConnector(platformId);
    case "devto":
      return new DevToConnector(platformId);
    case "revolt":
      return new RevoltStoatConnector(platformId);
    case "vk":
      return new VkConnector(platformId);
    case "telegram":
      return new TelegramConnector();
    case "reddit":
      return new RedditConnector(platformId);
    case "e621":
      return new E621Connector();
    case "deviantart":
      return new DeviantArtConnector(platformId);
    case "inkbunny":
      return new InkbunnyConnector();
    case "discord_webhook":
    case "generic_webhook":
    case "slack_webhook":
      return new WebhookConnector(platformId);
    case "peertube":
    case "vimeo":
    case "dailymotion":
    case "lbry":
      if (process.env[`${platformId.toUpperCase()}_ENDPOINT`]) {
        return new TusChunkedConnector(platformId);
      }
      return new GenericRestConnector(platformId);
    default:
      return new GenericRestConnector(platformId);
  }
}
