// Env-driven config. Fails fast: the auth service refuses to start without the
// secrets it needs. Launch policy (public login / allowlist) is config, not
// schema, so a demo can be locked without a migration.

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`FATAL: ${name} is required`);
    process.exit(1);
  }
  return v;
}

const bootstrapEmails = (process.env.AUTH_BOOTSTRAP_EMAILS ?? "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

const allowlist = (process.env.AUTH_ALLOWLIST ?? "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

export const config = {
  port: Number(process.env.AUTH_PORT ?? 8788),
  databaseUrl: required("DATABASE_URL"),
  redisUrl: process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
  jwtSecret: required("JWT_SECRET"),
  jwtSecretPrevious: process.env.JWT_SECRET_PREVIOUS ?? "",
  accessTtl: 15 * 60, // seconds
  refreshTtl: 30 * 24 * 60 * 60, // seconds
  // Secure cookies require HTTPS; dev over http://127.0.0.1:5173 sets them off.
  cookieSecure: (process.env.AUTH_COOKIE_SECURE ?? "true") !== "false",
  publicLogin: (process.env.AUTH_PUBLIC_LOGIN ?? "true") !== "false",
  // Empty allowlist = anyone with valid credentials may log in. Bootstrap
  // accounts are always allowed so a locked-down instance can still be entered.
  allowlist: new Set([...allowlist, ...bootstrapEmails]),
  allowlistEnabled: allowlist.length > 0,
  bootstrapEmails,
  bootstrapPassword: process.env.AUTH_BOOTSTRAP_PASSWORD ?? "",
  defaultQuota: Number(process.env.DEFAULT_QUOTA_COMPUTERS ?? 4),
  loginRateMax: Number(process.env.AUTH_LOGIN_RATE_MAX ?? 10),
  loginRateWindow: Number(process.env.AUTH_LOGIN_RATE_WINDOW ?? 300), // seconds
};

export function emailAllowed(email: string): boolean {
  if (!config.allowlistEnabled) return true;
  return config.allowlist.has(email.toLowerCase());
}
