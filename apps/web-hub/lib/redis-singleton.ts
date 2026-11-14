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
      },
    );
    globalForPolyPost.__polypostRedis.on("error", () => {});
  }
  return globalForPolyPost.__polypostRedis;
}

export function getSharedFunnelEngine(): FunnelEngine {
  if (!globalForPolyPost.__polypostFunnelEngine) {
    const engine = new FunnelEngine(getSharedRedis());
    engine.startWorkers();
    globalForPolyPost.__polypostFunnelEngine = engine;
  }
  return globalForPolyPost.__polypostFunnelEngine;
}
