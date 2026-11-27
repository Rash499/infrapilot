import type { FindingSeverity } from "@/db/models/documents";

/**
 * Safe parser for Trivy JSON reports.
 *
 * InfraPilot never scans images itself: it imports a report produced elsewhere
 * (`trivy image --format json --output report.json IMAGE`) and turns the vulnerabilities into
 * findings. Parsing is pure, bounded and defensive — uploaded documents are data, never code.
 */

export const TRIVY_MAX_REPORT_BYTES = 2 * 1024 * 1024;

export class TrivyParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TrivyParseError";
  }
}

export interface ParsedVulnerability {
  cveId: string;
  title: string;
  description: string;
  severity: FindingSeverity;
  cvssScore: number | null;
  component: string;
  installedVersion: string | null;
  fixedVersion: string | null;
  primaryUrl: string | null;
  packageType: string | null;
  target: string | null;
  remediation: string;
}

export interface SkippedVulnerability {
  id: string;
  reason: string;
}

export interface ParsedTrivyReport {
  schemaVersion: number | null;
  artifactName: string;
  artifactType: string | null;
  scannerVersion: string | null;
  scannedAt: Date | null;
  vulnerabilities: ParsedVulnerability[];
  skipped: SkippedVulnerability[];
  duplicateCount: number;
}

const CVE_PATTERN = /^CVE-\d{4}-\d{4,}$/i;
const SEVERITY_MAP: Record<string, FindingSeverity> = {
  CRITICAL: "critical",
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
  UNKNOWN: "informational",
  NEGLIGIBLE: "informational",
};

/** CVSS bands from the CVSS v3 specification, used when Trivy reports UNKNOWN severity. */
export function cvssToSeverity(score: number | null): FindingSeverity {
  if (score === null) return "informational";
  if (score >= 9) return "critical";
  if (score >= 7) return "high";
  if (score >= 4) return "medium";
  if (score > 0) return "low";
  return "informational";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Maximum CVSS v3 base score reported by any vendor block, which is what operators triage on. */
export function extractCvssScore(value: unknown): number | null {
  const cvss = asRecord(value);
  if (!cvss) return null;
  const scores: number[] = [];
  for (const vendor of Object.values(cvss)) {
    const block = asRecord(vendor);
    if (!block) continue;
    for (const key of ["V3Score", "V2Score"]) {
      const score = asNumber(block[key]);
      if (score !== null && score >= 0 && score <= 10) scores.push(score);
    }
  }
  return scores.length > 0 ? Math.max(...scores) : null;
}

/** Remediation deadline by severity; days are a policy choice, documented for operators. */
export const REMEDIATION_DAYS: Record<FindingSeverity, number> = {
  critical: 7,
  high: 30,
  medium: 90,
  low: 180,
  informational: 365,
};

export function remediationDeadline(severity: FindingSeverity, from: Date): Date {
  const due = new Date(from);
  due.setUTCDate(due.getUTCDate() + REMEDIATION_DAYS[severity]);
  return due;
}

/**
 * Validates and normalizes a Trivy JSON document.
 *
 * @throws TrivyParseError with a user-facing message when the document is too large, not an object,
 * missing `Results`, or contains no usable vulnerabilities.
 */
export function parseTrivyReport(raw: unknown | string, options: { now?: Date; maxBytes?: number } = {}): ParsedTrivyReport {
  const now = options.now ?? new Date();
  const maxBytes = options.maxBytes ?? TRIVY_MAX_REPORT_BYTES;
  let document: unknown = raw;

  if (typeof raw === "string") {
    if (Buffer.byteLength(raw, "utf8") > maxBytes) {
      throw new TrivyParseError(`Report exceeds the ${Math.round(maxBytes / 1024)} KB limit`);
    }
    try {
      document = JSON.parse(raw);
    } catch {
      throw new TrivyParseError("Report is not valid JSON");
    }
  } else if (Buffer.byteLength(JSON.stringify(raw ?? null), "utf8") > maxBytes) {
    throw new TrivyParseError(`Report exceeds the ${Math.round(maxBytes / 1024)} KB limit`);
  }

  const report = asRecord(document);
  if (!report) throw new TrivyParseError("Report must be a JSON object");
  const results = report.Results;
  if (!Array.isArray(results)) throw new TrivyParseError("Report is missing the Results array");

  const metadata = asRecord(report.Metadata) ?? {};
  const scannerVersion = asString(asRecord(metadata.Scanner)?.Version);
  const scannedAtRaw = asString(metadata.ScanStartedAt) ?? asString(metadata.CreatedAt);
  const scannedAt = scannedAtRaw ? new Date(scannedAtRaw) : null;

  const vulnerabilities: ParsedVulnerability[] = [];
  const skipped: SkippedVulnerability[] = [];
  const seen = new Set<string>();
  let duplicateCount = 0;

  for (const resultRaw of results) {
    const result = asRecord(resultRaw);
    if (!result) continue;
    const target = asString(result.Target);
    const packageType = asString(result.Type);
    const list = result.Vulnerabilities;
    if (!Array.isArray(list)) continue;

    for (const vulnerabilityRaw of list) {
      const vulnerability = asRecord(vulnerabilityRaw);
      if (!vulnerability) continue;
      const id = asString(vulnerability.VulnerabilityID);
      if (!id) {
        skipped.push({ id: "unknown", reason: "missing VulnerabilityID" });
        continue;
      }
      if (!CVE_PATTERN.test(id)) {
        skipped.push({ id, reason: "identifier is not a CVE" });
        continue;
      }
      const pkg = asString(vulnerability.PkgName);
      if (!pkg) {
        skipped.push({ id, reason: "missing package name" });
        continue;
      }
      const installed = asString(vulnerability.InstalledVersion);
      const dedupe = `${id.toUpperCase()}|${pkg}|${installed ?? ""}`;
      if (seen.has(dedupe)) {
        duplicateCount += 1;
        continue;
      }
      seen.add(dedupe);

      const cvssScore = extractCvssScore(vulnerability.CVSS);
      const declared = SEVERITY_MAP[(asString(vulnerability.Severity) ?? "").toUpperCase()];
      const severity = declared && declared !== "informational" ? declared : cvssToSeverity(cvssScore);
      const fixed = asString(vulnerability.FixedVersion);
      const title = asString(vulnerability.Title) ?? `${id.toUpperCase()} in ${pkg}`;

      vulnerabilities.push({
        cveId: id.toUpperCase(),
        title: title.slice(0, 200),
        description:
          asString(vulnerability.Description) ??
          `Vulnerability ${id.toUpperCase()} affects ${pkg}${installed ? ` ${installed}` : ""}.`,
        severity,
        cvssScore,
        component: pkg,
        installedVersion: installed,
        fixedVersion: fixed,
        primaryUrl: asString(vulnerability.PrimaryURL),
        packageType,
        target,
        remediation: fixed
          ? `Upgrade ${pkg} from ${installed ?? "the installed version"} to ${fixed} and redeploy, then re-import the scan report.`
          : `No fixed version is published yet. Apply the vendor mitigation for ${pkg} and track ${id.toUpperCase()}.`,
      });
      void now;
    }
  }

  if (vulnerabilities.length === 0) {
    throw new TrivyParseError(
      skipped.length > 0
        ? `Report contains no vulnerabilities that can be imported (${skipped.length} advisory entries were skipped)`
        : "Report contains no vulnerabilities",
    );
  }

  return {
    schemaVersion: asNumber(report.SchemaVersion),
    artifactName: asString(report.ArtifactName) ?? asString(metadata.RepoDigest) ?? "unknown artifact",
    artifactType: asString(report.ArtifactType),
    scannerVersion,
    scannedAt: scannedAt && !Number.isNaN(scannedAt.getTime()) ? scannedAt : null,
    vulnerabilities,
    skipped,
    duplicateCount,
  };
}
