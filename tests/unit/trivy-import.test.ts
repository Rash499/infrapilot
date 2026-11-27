import { describe, expect, it } from "vitest";
import {
  cvssToSeverity,
  parseTrivyReport,
  REMEDIATION_DAYS,
  remediationDeadline,
  TrivyParseError,
} from "../../packages/server-core/src/security/trivy";

const report = {
  SchemaVersion: 2,
  ArtifactName: "registry.example.com/checkout:1.4.2",
  ArtifactType: "container_image",
  Metadata: {
    ScanStartedAt: "2026-01-10T08:30:00Z",
    Scanner: { Version: "0.55.0" },
  },
  Results: [
    {
      Target: "checkout (alpine 3.19)",
      Type: "alpine",
      Vulnerabilities: [
        {
          VulnerabilityID: "CVE-2025-12345",
          PkgName: "openssl",
          InstalledVersion: "3.1.0-r0",
          FixedVersion: "3.1.1-r0",
          Severity: "CRITICAL",
          Title: "OpenSSL buffer overflow",
          Description: "A crafted handshake can overflow a buffer in openssl.",
          PrimaryURL: "https://avd.aquasec.com/nvd/cve-2025-12345",
          CVSS: {
            nvd: { V3Score: 9.8 },
            redhat: { V3Score: 8.1 },
          },
        },
        {
          VulnerabilityID: "CVE-2025-12345",
          PkgName: "openssl",
          InstalledVersion: "3.1.0-r0",
          Severity: "CRITICAL",
        },
        {
          VulnerabilityID: "GHSA-abcd-efgh-ijkl",
          PkgName: "libfoo",
          InstalledVersion: "1.0.0",
          Severity: "HIGH",
        },
      ],
    },
    {
      Target: "usr/local/bin/checkout",
      Type: "gobinary",
      Vulnerabilities: [
        {
          VulnerabilityID: "CVE-2024-99999",
          PkgName: "golang.org/x/net",
          InstalledVersion: "v0.10.0",
          Severity: "UNKNOWN",
          CVSS: { ghsa: { V3Score: 5.3 } },
        },
        {
          VulnerabilityID: "CVE-2024-11111",
          PkgName: "example",
          Severity: "LOW",
        },
      ],
    },
  ],
};

describe("parseTrivyReport", () => {
  it("extracts the artifact metadata and normalized vulnerabilities", () => {
    const parsed = parseTrivyReport(report);
    expect(parsed.artifactName).toBe("registry.example.com/checkout:1.4.2");
    expect(parsed.artifactType).toBe("container_image");
    expect(parsed.scannerVersion).toBe("0.55.0");
    expect(parsed.scannedAt?.toISOString()).toBe("2026-01-10T08:30:00.000Z");
    expect(parsed.vulnerabilities).toHaveLength(3);
  });

  it("deduplicates identical CVE/package/version entries inside one report", () => {
    const parsed = parseTrivyReport(report);
    expect(parsed.duplicateCount).toBe(1);
    expect(parsed.vulnerabilities.filter((v) => v.cveId === "CVE-2025-12345")).toHaveLength(1);
  });

  it("skips advisories that are not CVEs and reports why", () => {
    const parsed = parseTrivyReport(report);
    expect(parsed.skipped).toEqual([{ id: "GHSA-abcd-efgh-ijkl", reason: "identifier is not a CVE" }]);
  });

  it("keeps the highest vendor CVSS score and infers severity when Trivy reports UNKNOWN", () => {
    const parsed = parseTrivyReport(report);
    const critical = parsed.vulnerabilities.find((v) => v.cveId === "CVE-2025-12345")!;
    expect(critical.cvssScore).toBe(9.8);
    expect(critical.severity).toBe("critical");
    const unknown = parsed.vulnerabilities.find((v) => v.cveId === "CVE-2024-99999")!;
    expect(unknown.severity).toBe("medium");
    expect(unknown.cvssScore).toBe(5.3);
  });

  it("builds a remediation recommendation from the fixed version", () => {
    const parsed = parseTrivyReport(report);
    const critical = parsed.vulnerabilities.find((v) => v.cveId === "CVE-2025-12345")!;
    expect(critical.remediation).toContain("3.1.1-r0");
    const noFix = parsed.vulnerabilities.find((v) => v.cveId === "CVE-2024-11111")!;
    expect(noFix.remediation).toContain("No fixed version");
  });

  it("accepts a JSON string and rejects malformed or oversized documents", () => {
    expect(() => parseTrivyReport(JSON.stringify(report))).not.toThrow();
    expect(() => parseTrivyReport("{not json")).toThrow(TrivyParseError);
    expect(() => parseTrivyReport({ Results: [] })).toThrow(/no vulnerabilities/i);
    expect(() => parseTrivyReport({})).toThrow(/Results array/);
    expect(() => parseTrivyReport(JSON.stringify(report), { maxBytes: 100 })).toThrow(/limit/);
    expect(() => parseTrivyReport([])).toThrow(/JSON object/);
  });

  it("does not treat arbitrary objects with a Results property as a report", () => {
    expect(() => parseTrivyReport({ Results: [{ Vulnerabilities: [{ Description: "no id" }] }] })).toThrow(
      /no vulnerabilities/i,
    );
  });
});

describe("remediation policy", () => {
  it("maps CVSS bands to severities", () => {
    expect(cvssToSeverity(9.5)).toBe("critical");
    expect(cvssToSeverity(7.2)).toBe("high");
    expect(cvssToSeverity(4.1)).toBe("medium");
    expect(cvssToSeverity(0.4)).toBe("low");
    expect(cvssToSeverity(null)).toBe("informational");
  });

  it("sets deadlines from the import time using the documented day counts", () => {
    const from = new Date("2026-01-01T00:00:00.000Z");
    expect(remediationDeadline("critical", from).toISOString()).toBe("2026-01-08T00:00:00.000Z");
    expect(remediationDeadline("high", from).toISOString()).toBe("2026-01-31T00:00:00.000Z");
    expect(REMEDIATION_DAYS.critical).toBe(7);
    expect(REMEDIATION_DAYS.informational).toBe(365);
  });
});
