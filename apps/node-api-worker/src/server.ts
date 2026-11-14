import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Redis from "ioredis";
import { applyRootEnv } from "../../../scripts/load-env.mjs";
import { FunnelEngine } from "./funnel_flow";
import { OAuthTokenManager } from "./token_manager";

const here = dirname(fileURLToPath(import.meta.url));
applyRootEnv(resolve(here, "../../.."));

const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
});

const engine = new FunnelEngine(redis);
engine.startWorkers();

const tokenManager = new OAuthTokenManager();
const stopTokenLoop = tokenManager.startAutoRefreshLoop();

console.log("[Node Worker] BullMQ FunnelEngine workers started.");
console.log("[Node Worker] Listening on heavy-video-queue (concurrency: 2) & lightweight-social-queue (concurrency: 15).");
console.log("[Node Worker] OAuth token auto-refresh scheduler active (15-min expiry buffer).");

process.on("SIGINT", async () => {
  console.log("[Node Worker] Shutting down workers...");
  stopTokenLoop();
  await engine.close();
  await redis.quit();
  process.exit(0);
});
