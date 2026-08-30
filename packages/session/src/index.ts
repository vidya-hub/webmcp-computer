// Shared session primitives used by BOTH apps/auth (mints tokens) and apps/api
// (verifies them). Kept out of the web bundle — the SPA never sees a secret.
//
// Access tokens are short-lived HS256 JWTs carrying the user id + a session id
// (sid) so the API can check Redis for revocation. Refresh tokens are opaque
// random strings (not JWTs); apps/auth stores only their hash. Rotation uses a
// dual secret: verify accepts the current and the previous secret.

import { SignJWT, jwtVerify } from "jose";

export const ACCESS_COOKIE = "wc_at";
export const REFRESH_COOKIE = "wc_rt";
export const ISS = "webmcp-computer";
export const AUD = "webmcp-computer";

export interface AccessClaims {
  sub: string; // user id
  email: string;
  sid: string; // session id, for Redis revocation
}

function keyOf(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function signAccess(
  claims: AccessClaims,
  secret: string,
  ttlSeconds: number,
): Promise<string> {
  return new SignJWT({ email: claims.email, sid: claims.sid })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuer(ISS)
    .setAudience(AUD)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(keyOf(secret));
}

/**
 * Verify against the current secret, then any fallbacks (e.g.
 * JWT_SECRET_PREVIOUS during rotation). Returns null on any failure.
 */
export async function verifyAccess(
  token: string,
  secrets: string[],
): Promise<AccessClaims | null> {
  for (const secret of secrets) {
    if (!secret) continue;
    try {
      const { payload } = await jwtVerify(token, keyOf(secret), {
        issuer: ISS,
        audience: AUD,
      });
      if (
        typeof payload.sub === "string" &&
        typeof payload.sid === "string" &&
        typeof payload.email === "string"
      ) {
        return { sub: payload.sub, email: payload.email, sid: payload.sid };
      }
    } catch {
      // try the next secret
    }
  }
  return null;
}

/** Secrets to try, current first. Reads JWT_SECRET(+_PREVIOUS) from env. */
export function jwtSecrets(): string[] {
  return [process.env.JWT_SECRET ?? "", process.env.JWT_SECRET_PREVIOUS ?? ""].filter(
    Boolean,
  );
}
