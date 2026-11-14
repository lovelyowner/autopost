import { NextResponse } from "next/server";
import { reloadRootEnvToProcessEnv } from "@polypost/node-api-worker";
import { pingRedisFast } from "@/lib/redis-singleton";
import { getStealthWorkerUrl } from "@/lib/stealth-client";

export async function GET() {
  reloadRootEnvToProcessEnv();
  const stealthUrl = getStealthWorkerUrl();
  const ollamaUrl =
    process.env.OLLAMA_URL || (process.env.VERCEL ? "" : "http://localhost:11434");

  const redisOk = await pingRedisFast(1500);

  let stealthWorkerOk = false;
  let profiles: Array<Record<string, any>> = [];
  if (stealthUrl) {
    try {
      const res = await fetch(`${stealthUrl}/api/profiles`, { signal: AbortSignal.timeout(1500) });
      if (res.ok) {
        stealthWorkerOk = true;
        const data = await res.json();
        profiles = Array.isArray(data.profiles) ? data.profiles : [];
      }
    } catch {}
  }

  let ollamaOk = false;
  if (ollamaUrl) {
    try {
      const res = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(1000) });
      ollamaOk = res.ok;
    } catch {}
  }

  return NextResponse.json({
    cloudMode: Boolean(process.env.VERCEL),
    services: {
      redis: redisOk,
      stealthWorker: stealthWorkerOk,
      ollama: ollamaOk,
      vaultEncryptionEnabled: Boolean(process.env.POLYPOST_SECRET_KEY),
      failureAlertsEnabled: Boolean(process.env.FAILURE_ALERT_WEBHOOK_URL),
      simulationDisabled:
        process.env.DISABLE_SIMULATED_CONNECTORS === "1" ||
        process.env.DISABLE_SIMULATED_CONNECTORS === "true",
    },
    apiCredentials: {
      bluesky: Boolean(process.env.BLUESKY_IDENTIFIER && process.env.BLUESKY_PASSWORD),
      mastodon: Boolean(process.env.MASTODON_ACCESS_TOKEN),
      misskey: Boolean(process.env.MISSKEY_TOKEN),
      lemmy: Boolean(process.env.LEMMY_USERNAME && process.env.LEMMY_PASSWORD),
      tumblr: Boolean(process.env.TUMBLR_BLOG && process.env.TUMBLR_ACCESS_TOKEN),
      nostr: Boolean(process.env.NOSTR_PRIVATE_KEY),
      matrix: Boolean(process.env.MATRIX_ACCESS_TOKEN && process.env.MATRIX_ROOM_ID),
      farcaster: Boolean(process.env.FARCASTER_NEYNAR_API_KEY && process.env.FARCASTER_SIGNER_UUID),
      wordpress: Boolean(
        process.env.WORDPRESS_SITE_URL &&
          process.env.WORDPRESS_USERNAME &&
          process.env.WORDPRESS_APP_PASSWORD,
      ),
      devto: Boolean(process.env.DEVTO_API_KEY),
      revolt: Boolean(process.env.REVOLT_BOT_TOKEN && process.env.REVOLT_CHANNEL_ID),
      vk: Boolean(process.env.VK_ACCESS_TOKEN),
      telegram: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
      discord: Boolean(process.env.WEBHOOK_DISCORD_WEBHOOK || process.env.WEBHOOK_DISCORD || process.env.DISCORD_WEBHOOK_URL),
      slack: Boolean(process.env.WEBHOOK_SLACK_WEBHOOK || process.env.WEBHOOK_SLACK || process.env.SLACK_WEBHOOK_URL),
      peertube: Boolean(process.env.PEERTUBE_ENDPOINT),
      reddit: Boolean(
        process.env.REDDIT_ACCESS_TOKEN ||
          (process.env.REDDIT_CLIENT_ID &&
            process.env.REDDIT_CLIENT_SECRET &&
            process.env.REDDIT_USERNAME &&
            process.env.REDDIT_PASSWORD),
      ),
      e621: Boolean(process.env.E621_USERNAME && process.env.E621_API_KEY),
      deviantart: Boolean(process.env.DEVIANTART_ACCESS_TOKEN),
      inkbunny: Boolean(
        process.env.INKBUNNY_SID || (process.env.INKBUNNY_USERNAME && process.env.INKBUNNY_PASSWORD),
      ),
      openrouter: Boolean(process.env.OPENROUTER_API_KEY),
    },
    vaultedProfiles: profiles,
  });
}
