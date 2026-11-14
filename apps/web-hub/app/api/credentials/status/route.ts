import { NextResponse } from "next/server";
import { reloadRootEnvToProcessEnv } from "@polypost/node-api-worker";
import { getSharedRedis } from "@/lib/redis-singleton";

export async function GET() {
  reloadRootEnvToProcessEnv();
  const stealthUrl = process.env.STEALTH_WORKER_URL || "http://localhost:8001";
  const ollamaUrl = process.env.OLLAMA_URL || "http://localhost:11434";

  let redisOk = false;
  try {
    const redis = getSharedRedis();
    const pong = await redis.ping();
    redisOk = pong === "PONG";
  } catch {}

  let stealthWorkerOk = false;
  let profiles: Array<Record<string, any>> = [];
  try {
    const res = await fetch(`${stealthUrl}/api/profiles`, { signal: AbortSignal.timeout(1500) });
    if (res.ok) {
      stealthWorkerOk = true;
      const data = await res.json();
      profiles = Array.isArray(data.profiles) ? data.profiles : [];
    }
  } catch {}

  let ollamaOk = false;
  try {
    const res = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(1000) });
    ollamaOk = res.ok;
  } catch {}

  return NextResponse.json({
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
