import { describe, expect, it } from "vitest";
import { consumeRateLimit, hashPassword, sha256, verifyPassword } from "@/lib/security";
import { parseMonitorUrl, classifyIp } from "@/lib/ssrf";
import { redact } from "@/lib/logger";

describe("password hashing (scrypt)", () => {
  it("verifies the original password and rejects others", async () => {
    const hash = await hashPassword("Correct-Horse-42battery");
    expect(hash.startsWith("scrypt$")).toBe(true);
    await expect(verifyPassword("Correct-Horse-42battery", hash)).resolves.toBe(true);
    await expect(verifyPassword("wrong-password-X1", hash)).resolves.toBe(false);
  });

  it("produces a different salt for each hash of the same password", async () => {
    const a = await hashPassword("Same-Password-123");
    const b = await hashPassword("Same-Password-123");
    expect(a).not.toEqual(b);
  });

  it("rejects malformed stored hashes without throwing", async () => {
    await expect(verifyPassword("anything", "not-a-hash")).resolves.toBe(false);
  });
});

describe("token hashing", () => {
  it("stores SHA-256 digests that are stable and not the raw token", () => {
    const digest = sha256("refresh-token-value");
    expect(digest).toHaveLength(64);
    expect(digest).toEqual(sha256("refresh-token-value"));
    expect(digest).not.toContain("refresh-token-value");
  });
});

describe("rate limiter", () => {
  it("allows requests up to the limit and then blocks", () => {
    const key = `test-${Math.random()}`;
    for (let i = 0; i < 3; i += 1) expect(consumeRateLimit(key, 3, 60_000).allowed).toBe(true);
    const blocked = consumeRateLimit(key, 3, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
  });
});

describe("log redaction", () => {
  it("redacts password, token and authorization fields recursively", () => {
    const out = redact({ email: "a@b.c", password: "x", nested: { refreshToken: "y", authorization: "Bearer z" } }) as Record<string, unknown>;
    expect(out.email).toBe("a@b.c");
    expect(out.password).toBe("[REDACTED]");
    expect(out.nested).toEqual({ refreshToken: "[REDACTED]", authorization: "[REDACTED]" });
  });
});

describe("SSRF: address classification", () => {
  it.each([
    ["127.0.0.1", "loopback address"],
    ["10.1.2.3", "private network"],
    ["172.16.5.5", "private network"],
    ["192.168.1.1", "private network"],
    ["169.254.169.254", "cloud metadata endpoint"],
    ["100.64.0.1", "carrier-grade NAT address"],
    ["::1", "loopback address"],
    ["fd00::1", "unique local address"],
    ["fe80::1", "link-local address"],
    ["::ffff:127.0.0.1", "loopback address"],
  ])("classifies %s as %s", (ip, reason) => {
    expect(classifyIp(ip)).toBe(reason);
  });

  it.each(["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"])("treats public address %s as routable", (ip) => {
    expect(classifyIp(ip)).toBeNull();
  });
});

describe("SSRF: URL validation", () => {
  it("accepts a plain https URL", () => {
    expect(parseMonitorUrl("https://example.com/health").hostname).toBe("example.com");
  });

  it("rejects non-HTTP schemes", () => {
    expect(() => parseMonitorUrl("file:///etc/passwd")).toThrow(/Only http and https/);
    expect(() => parseMonitorUrl("gopher://example.com")).toThrow(/Only http and https/);
  });

  it("rejects URLs that embed credentials", () => {
    expect(() => parseMonitorUrl("https://user:pass@example.com")).toThrow(/credentials/);
  });

  it("rejects invalid URLs", () => {
    expect(() => parseMonitorUrl("not a url")).toThrow(/not valid/);
  });
});
