import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { errors } from "@/lib/http";

export class DestinationError extends Error {}

const ALWAYS_BLOCKED_HOSTNAMES = new Set([
  "metadata",
  "metadata.google.internal",
  "metadata.goog",
  "instance-data",
  "instance-data.ec2.internal",
]);

const ALWAYS_BLOCKED_IPS = new Set([
  "169.254.169.254", // AWS/Azure/GCP/OpenStack metadata
  "169.254.170.2", // AWS ECS task metadata
  "100.100.100.200", // Alibaba Cloud metadata
  "fd00:ec2::254", // AWS IPv6 metadata
]);

const LOCAL_HOSTNAME_SUFFIXES = [".localhost", ".local", ".internal", ".localdomain"];

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

function inCidr4(ip: string, base: string, bits: number): boolean {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return ((ipv4ToInt(ip) & mask) >>> 0) === ((ipv4ToInt(base) & mask) >>> 0);
}

/** Classifies an IPv4 address. Returns a reason string when the address is not publicly routable. */
export function classifyIPv4(ip: string): string | null {
  if (ALWAYS_BLOCKED_IPS.has(ip)) return "cloud metadata endpoint";
  if (inCidr4(ip, "169.254.0.0", 16)) return "link-local address";
  if (inCidr4(ip, "127.0.0.0", 8)) return "loopback address";
  if (inCidr4(ip, "10.0.0.0", 8)) return "private network";
  if (inCidr4(ip, "172.16.0.0", 12)) return "private network";
  if (inCidr4(ip, "192.168.0.0", 16)) return "private network";
  if (inCidr4(ip, "100.64.0.0", 10)) return "carrier-grade NAT address";
  if (inCidr4(ip, "198.18.0.0", 15)) return "benchmark network";
  if (inCidr4(ip, "0.0.0.0", 8)) return "unspecified network";
  if (inCidr4(ip, "224.0.0.0", 4)) return "multicast address";
  if (inCidr4(ip, "240.0.0.0", 4)) return "reserved address";
  return null;
}

/** Classifies an IPv6 address, including IPv4-mapped forms. */
export function classifyIPv6(raw: string): string | null {
  const ip = raw.toLowerCase();
  if (ALWAYS_BLOCKED_IPS.has(ip)) return "cloud metadata endpoint";
  if (ip === "::1" || ip === "::") return "loopback address";
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  if (mapped) return classifyIPv4(mapped[1]!);
  const hexMapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(ip);
  if (hexMapped) {
    const hi = parseInt(hexMapped[1]!, 16);
    const lo = parseInt(hexMapped[2]!, 16);
    return classifyIPv4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  if (/^f[cd]/.test(ip)) return "unique local address";
  if (/^fe[89ab]/.test(ip)) return "link-local address";
  if (/^ff/.test(ip)) return "multicast address";
  return null;
}

export function classifyIp(ip: string): string | null {
  return isIP(ip) === 6 ? classifyIPv6(ip) : classifyIPv4(ip);
}

/**
 * Validates an HTTP(S) URL supplied for monitoring. Rejects credentials, unsupported schemes,
 * and overly long values. Network-level checks happen in assertSafeDestination.
 */
export function parseMonitorUrl(input: string): URL {
  if (input.length > 2048) throw new DestinationError("URL is too long");
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new DestinationError("URL is not valid");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new DestinationError("Only http and https URLs can be monitored");
  }
  if (url.username || url.password) {
    throw new DestinationError("URLs containing credentials are not allowed");
  }
  if (!url.hostname) throw new DestinationError("URL must include a host");
  return url;
}

export function validatePort(port: number): void {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new DestinationError("Port must be between 1 and 65535");
  }
}

/**
 * Resolves the host and verifies every resulting address is allowed. Returns the validated
 * addresses so the caller can connect to a pinned IP (prevents DNS rebinding between check and connect).
 * `allowPrivate` is only ever true for targets an administrator explicitly authorised.
 */
export async function assertSafeDestination(hostname: string, allowPrivate: boolean): Promise<string[]> {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!host) throw new DestinationError("Host is required");
  if (ALWAYS_BLOCKED_HOSTNAMES.has(host) || ALWAYS_BLOCKED_IPS.has(host)) {
    throw new DestinationError("Destination is a prohibited metadata endpoint");
  }
  const localName = host === "localhost" || LOCAL_HOSTNAME_SUFFIXES.some((s) => host.endsWith(s));
  if (localName && !allowPrivate) {
    throw new DestinationError("Local hostnames are not allowed unless private network monitoring is authorised");
  }

  let addresses: string[];
  if (isIP(host)) {
    addresses = [host];
  } else {
    try {
      const results = await lookup(host, { all: true, verbatim: true });
      addresses = results.map((r) => r.address);
    } catch {
      throw new DestinationError("Host could not be resolved");
    }
  }
  if (addresses.length === 0) throw new DestinationError("Host could not be resolved");

  for (const addr of addresses) {
    const reason = classifyIp(addr);
    if (!reason) continue;
    const isMetadata = reason === "cloud metadata endpoint";
    if (isMetadata || !allowPrivate) {
      throw new DestinationError(`Destination resolves to a ${reason}, which is not permitted`);
    }
  }
  return addresses;
}

export function assertNotSafeGuard(): never {
  throw errors.forbidden();
}
