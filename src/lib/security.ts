import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { SignJWT, jwtVerify } from "jose";
import { getEnv } from "@/lib/env";

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

/** Hashes a password with scrypt (memory-hard KDF from Node's crypto module). Format: scrypt$N$r$p$salt$hash */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 64 * 1024 * 1024 });
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString("base64"), derived.toString("base64")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64!, "base64");
  const derived = await scrypt(password, Buffer.from(saltB64!, "base64"), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: 64 * 1024 * 1024,
  });
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

/** Pre-computed hash used to equalise timing when a login email does not exist. */
export const DUMMY_HASH_PROMISE = hashPassword("infrapilot-timing-equaliser-not-a-password");

export function randomToken(bytes = 48): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export interface AccessTokenClaims {
  sub: string;
  role: "admin" | "operator" | "viewer";
}

const ISSUER = "infrapilot";
const AUDIENCE = "infrapilot-api";

function secretKey(): Uint8Array {
  return new TextEncoder().encode(getEnv().JWT_ACCESS_SECRET);
}

export async function signAccessToken(claims: AccessTokenClaims): Promise<string> {
  return new SignJWT({ role: claims.role })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(claims.sub)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${getEnv().ACCESS_TOKEN_TTL_SECONDS}s`)
    .setJti(randomBytes(12).toString("hex"))
    .sign(secretKey());
}

export async function verifyAccessToken(token: string): Promise<AccessTokenClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ["HS256"],
    });
    const role = payload.role;
    if (typeof payload.sub !== "string" || (role !== "admin" && role !== "operator" && role !== "viewer")) {
      return null;
    }
    return { sub: payload.sub, role };
  } catch {
    return null;
  }
}

interface WindowEntry {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, WindowEntry>();

/**
 * Fixed-window in-memory rate limiter. Suitable for a single instance; for multi-instance
 * deployments back this with Redis (documented in docs/deployment.md).
 */
export function consumeRateLimit(key: string, limit: number, windowMs: number): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  const entry = buckets.get(key);
  if (!entry || entry.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    if (buckets.size > 10000) {
      for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
    }
    return { allowed: true, retryAfterSec: 0 };
  }
  entry.count += 1;
  if (entry.count > limit) {
    return { allowed: false, retryAfterSec: Math.ceil((entry.resetAt - now) / 1000) };
  }
  return { allowed: true, retryAfterSec: 0 };
}
