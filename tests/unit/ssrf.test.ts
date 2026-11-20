import { describe, expect, it } from "vitest";
import { assertSafeDestination } from "@/lib/ssrf";

describe("assertSafeDestination", () => {
  it("blocks loopback IP literals by default", async () => {
    await expect(assertSafeDestination("127.0.0.1", false)).rejects.toThrow(/not permitted/);
  });

  it("blocks localhost host names by default", async () => {
    await expect(assertSafeDestination("localhost", false)).rejects.toThrow(/Local hostnames/);
  });

  it("blocks cloud metadata endpoints even when private networks are authorised", async () => {
    await expect(assertSafeDestination("169.254.169.254", true)).rejects.toThrow(/prohibited/);
    await expect(assertSafeDestination("metadata.google.internal", true)).rejects.toThrow(/prohibited/);
  });

  it("allows private addresses only when explicitly authorised", async () => {
    await expect(assertSafeDestination("10.0.0.5", false)).rejects.toThrow(/private network/);
    await expect(assertSafeDestination("10.0.0.5", true)).resolves.toEqual(["10.0.0.5"]);
  });

  it("returns the validated address for public IP literals", async () => {
    await expect(assertSafeDestination("1.1.1.1", false)).resolves.toEqual(["1.1.1.1"]);
  });
});
