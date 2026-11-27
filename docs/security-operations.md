# Security operations: findings and Trivy report import

InfraPilot is a **vulnerability register**, not a scanner. It does not run Trivy, pull container images
or contact registries. Operators run a scan elsewhere and import the JSON report; InfraPilot validates,
normalises and stores the findings.

## 1. What the import does — and does not do

- ✅ Parses a Trivy JSON document (schema 2, `Results[].Vulnerabilities[]`).
- ✅ Creates one finding per asset/CVE/package and refreshes it on later scans.
- ✅ Computes CVSS, severity, component/version, remediation text and a remediation deadline.
- ✅ Records the import (scanner version, artifact, counts) in `scan_imports` and the audit log.
- ❌ Never executes the uploaded file, never runs a shell command and never spawns Trivy.
- ❌ Never contacts the artifact registry or the URLs contained in the report.
- ❌ Does not claim a "live scan": findings show the report's `ScanStartedAt` and are labelled
  `source: trivy`.

## 2. Endpoint contract

```
POST /api/v1/security/imports
Content-Type: application/json
X-InfraPilot-Request: 1
Authorization: Bearer <access token>

{
  "assetId": "<uuid of an existing asset>",
  "report": { ...Trivy JSON document... }
}
```

Required permission: `write` (admin or operator). The request body limit is 4 MB at the HTTP layer; the
import itself rejects reports larger than **2 MB** (`413 PAYLOAD_TOO_LARGE`).

Response (201):

```json
{
  "data": {
    "scanId": "…",
    "asset": { "id": "…", "name": "prd-api-01" },
    "scanner": "trivy",
    "artifactName": "registry.example.com/api:1.4.2",
    "artifactType": "container_image",
    "scannerVersion": "0.55.0",
    "scannedAt": "2026-01-10T08:30:00.000Z",
    "importedAt": "2026-01-11T09:00:00.000Z",
    "vulnerabilitiesSeen": 12,
    "findingsCreated": 9,
    "findingsUpdated": 3,
    "findingsSkipped": 1,
    "findingsReopened": 0,
    "criticalCount": 2,
    "highCount": 4,
    "duplicateCount": 1,
    "skipped": [{ "id": "GHSA-…", "reason": "identifier is not a CVE" }],
    "remediationPolicyDays": { "critical": 7, "high": 30, "medium": 90, "low": 180, "informational": 365 }
  }
}
```

Related reads:

- `GET /api/v1/security/dashboard` — open counts by severity/status, overdue and due-soon deadlines,
  top affected assets and a 30-day creation trend, all aggregated from stored findings.
- `GET /api/v1/security/imports/:assetId` — recent imports for an asset.

## 3. Validation rules

| Rule | Behaviour |
| --- | --- |
| Body must be JSON with an object `report` | Zod validation; `400 VALIDATION_ERROR` |
| Report ≤ 2 MB | `413 PAYLOAD_TOO_LARGE` |
| `Results` must be an array | `422 UNPROCESSABLE` with the parser message |
| At least one importable vulnerability | `422` otherwise |
| Maximum 1,000 vulnerabilities per import | `422`, advises splitting the report |
| Vulnerability IDs must match `CVE-YYYY-NNNN` | Other advisories (GHSA, etc.) are skipped and reported |
| Package name required | Missing-name entries are skipped and reported |
| CVSS must be 0–10 | Out-of-range vendor scores are ignored |
| Duplicate CVE/package/version entries in one report | Collapsed, counted in `duplicateCount` |

Uploading the same report twice is safe: existing findings are refreshed, `findingsUpdated` is
incremented, and no duplicate documents are created.

## 4. Finding identity and remediation policy

A finding is identified by `(assetId, cveId, component)` via the partial unique index
`findings_vulnerability_unique`. Re-imports:

- refresh severity, CVSS, versions, remediation text, `lastSeenAt` and `scanId`;
- preserve triage state (`status`, assignee, notes) — an accepted risk stays accepted;
- **reopen** a previously resolved finding with a history event if the new scan still reports it.

Remediation deadlines are set from the import time according to severity: critical 7 days, high 30,
medium 90, low 180, informational 365. Changing a finding's severity restarts the clock. The security
dashboard reports overdue and due-within-7-days findings from these stored deadlines.

## 5. Permissions and audit

- Reading findings, the dashboard and import history requires the `read` role (all authenticated
  users).
- Importing requires `write`; deleting a finding remains admin-only, as before.
- Every import writes an audit entry `finding.report_imported` (asset, counts, artifact, scanner) and
  every finding creation/reopen writes a finding-history event.
- Imports of critical findings notify operators and administrators.
- The uploaded document is never echoed back in logs; only counts and the artifact name are recorded.

## 6. UI

`/security` shows the register, the dashboard counters and the **Import Trivy report** dialog:

1. choose the asset;
2. choose a `.json` report (client-side 2 MB guard);
3. review the import summary (created / refreshed / reopened / skipped, critical and high counts).

The dialog states explicitly that the file is parsed, not executed, and that findings reflect the
report's scan rather than a live scan by InfraPilot.
