// Auth service bootstrap. Fails fast on missing secrets (config.ts) or deps.
// The API owns migrations; auth waits for the schema to reach version >= 3
// before serving, then seeds the bootstrap accounts.

import { serve } from "@hono/node-server";
import { hash as argonHash } from "@node-rs/argon2";
import { createApp } from "./app.ts";
import { config } from "./config.ts";
import { findUserByEmail, pingDb, schemaVersion, upsertUser } from "./db.ts";
import { connectRedis } from "./redis.ts";

const REQUIRED_SCHEMA = 3;

async function waitForSchema(): Promise<void> {
  for (let i = 0; i < 30; i++) {
    if (await pingDb()) {
      const v = await schemaVersion();
      if (v !== null && v >= REQUIRED_SCHEMA) return;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.error(
    `FATAL: schema not at version ${REQUIRED_SCHEMA} (is the API running its migrations?)`,
  );
  process.exit(1);
}

async function seedUsers(): Promise<void> {
  if (!config.bootstrapPassword || config.bootstrapEmails.length === 0) {
    console.warn("no bootstrap users seeded (set AUTH_BOOTSTRAP_EMAILS + AUTH_BOOTSTRAP_PASSWORD)");
    return;
  }
  const passwordHash = await argonHash(config.bootstrapPassword);
  for (const email of config.bootstrapEmails) {
    const existing = await findUserByEmail(email);
    if (existing) continue;
    await upsertUser(email, passwordHash);
    console.log(`seeded user ${email}`);
  }
}

(async () => {
  try {
    await connectRedis();
  } catch (err) {
    console.error("FATAL: redis connect failed:", err);
    process.exit(1);
  }
  await waitForSchema();
  await seedUsers();

  const app = createApp();
  serve({ fetch: app.fetch, port: config.port, hostname: "127.0.0.1" }, () => {
    console.log(`auth http://127.0.0.1:${config.port}`);
  });
})();

process.on("unhandledRejection", (r) => console.error("unhandledRejection:", r));
process.on("uncaughtException", (e) => console.error("uncaughtException:", e));
