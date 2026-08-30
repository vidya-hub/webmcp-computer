// Redis for auth: login rate-limiting and session revocation.
//
// Revocation is published as a key `revoked:{familyId}` with a TTL of the access
// token lifetime. The API checks this key on every request, so a logout or a
// detected refresh-token theft kills live access tokens within one request, not
// only at their 15-minute expiry.

import Redis from "ioredis";
import { config } from "./config.ts";

export const redis = new Redis(config.redisUrl, {
  lazyConnect: true,
  maxRetriesPerRequest: 2,
  enableOfflineQueue: false,
});

redis.on("error", (err) => console.error("auth redis error:", err.message));

export async function connectRedis(): Promise<void> {
  await redis.connect();
  await redis.ping();
}

/** Returns true if the caller is within the login rate limit. */
export async function loginRateOk(ip: string): Promise<boolean> {
  const key = `rl:login:${ip}`;
  const n = await redis.incr(key);
  if (n === 1) await redis.expire(key, config.loginRateWindow);
  return n <= config.loginRateMax;
}

export async function revoke(familyId: string): Promise<void> {
  await redis.set(`revoked:${familyId}`, "1", "EX", config.accessTtl);
}
