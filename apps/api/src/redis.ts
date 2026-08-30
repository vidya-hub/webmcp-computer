// Shared Redis client. Redis is normal production infrastructure here — it holds
// per-user session state (selection/recording/approval), pub/sub for WS fan-out
// across API processes, one-time stream tickets, and login/spawn rate limits.
//
// One command client is reused everywhere. Pub/sub needs dedicated connections
// (a subscribed connection cannot issue normal commands), so `subscriber()`
// hands out duplicates the caller owns.

import Redis, { type RedisOptions } from "ioredis";

const URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";

const OPTS: RedisOptions = {
  lazyConnect: true,
  maxRetriesPerRequest: 2,
  // Don't wedge a request forever if Redis is down; fail the command instead.
  enableOfflineQueue: false,
};

export const redis = new Redis(URL, OPTS);

redis.on("error", (err) => {
  // Without a handler ioredis throws on transient drops and crashes the process.
  console.error("redis error:", err.message);
});

let connected = false;

/** Connect once and verify with PING. Boot calls this so prod fails fast. */
export async function connectRedis(): Promise<void> {
  if (connected) return;
  await redis.connect();
  await redis.ping();
  connected = true;
}

/** Liveness check for /api/ready. */
export async function pingRedis(): Promise<boolean> {
  try {
    const pong = await redis.ping();
    return pong === "PONG";
  } catch {
    return false;
  }
}

/** A dedicated connection for SUBSCRIBE/PSUBSCRIBE. Caller owns/closes it. */
export function subscriber(): Redis {
  return new Redis(URL, { ...OPTS, enableOfflineQueue: true });
}
