import { FunnelEngine } from "@polypost/node-api-worker";
import Redis from "ioredis";

const globalForPolyPost = globalThis as unknown as {
  __polypostRedis?: Redis;
  __polypostFunnelEngine?: FunnelEngine;
};

export function getSharedRedis(): Redis {
  if (!globalForPolyPost.__polypostRedis) {
    globalForPolyPost.__polypostRedis = new Redis(
      process.env.REDIS_URL || "redis://127.0.0.1:6379",
      {
        maxRetriesPerRequest: null,
        lazyConnect: true,
        connectTimeout: 2000,
        enableReadyCheck: false,
        retryStrategy: process.env.VERCEL ? () => null : undefined,
      },
    );
    globalForPolyPost.__polypostRedis.on("error", () => {});
  }
  return globalForPolyPost.__polypostRedis;
}

/** Return true when Redis should be queried (configured URL or local non-Vercel host). */
export function hasConfiguredRedis(): boolean {
  return Boolean(process.env.REDIS_URL) || !process.env.VERCEL;
}

/** Ping Redis with a hard deadline so serverless health checks never block on an offline queue. */
export async function pingRedisFast(timeoutMs = 1500): Promise<boolean> {
  if (!hasConfiguredRedis()) {
    return false;
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const redis = getSharedRedis();
    const pong = await Promise.race([
      redis.ping().catch(() => null),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
    return pong === "PONG";
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function getSharedFunnelEngine(): FunnelEngine {
  if (!globalForPolyPost.__polypostFunnelEngine) {
    const engine = new FunnelEngine(getSharedRedis());
    engine.startWorkers();
    globalForPolyPost.__polypostFunnelEngine = engine;
  }
  return globalForPolyPost.__polypostFunnelEngine;
}
