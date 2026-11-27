# MongoDB compatibility

The application uses the existing `infrapilot` database and MongoDB replica set `rs0`.

MongoDB 8 connection, collection definitions, repositories, and index initialization live in `packages/database/src`.

No existing collections or documents are dropped or renamed. The `worker_statuses` collection stores independent worker heartbeats. PostgreSQL schema/driver code is isolated under `scripts/migration/postgres` and is retained only for the optional, idempotent one-time importer in `scripts/migrate-data.ts`.

## Collections added for alerting, security imports and analytics

| Collection | Purpose | Key indexes |
| --- | --- | --- |
| `alerts` | Alert lifecycle (triggered / acknowledged / suppressed / resolved) with event history. | `{id}` unique; `{dedupeKey}` unique **partial** over active statuses; `{status, severity, triggeredAt}`; `{targetId, status}`; `{assetId, status}`; `{incidentId}`. |
| `scan_imports` | One row per imported Trivy report: asset, artifact, scanner version, counts. | `{id}` unique; `{assetId, importedAt}`. |

Additional indexes on existing collections:

| Collection | Index | Reason |
| --- | --- | --- |
| `monitoring_targets` | `{enabled, status}`; `{claimExpiresAt}` (sparse) | Queue filtering and expired-lease reclaim. |
| `incidents` | `{sourceAlertId}` unique sparse; `{acknowledgedAt}` sparse | One incident per alert; SLA queries. |
| `security_findings` | `{assetId, cveId, component}` unique partial (`cveId`/`component` strings); `{remediationDeadline, status}` | Vulnerability dedupe and overdue reporting. |

### Schema tolerance

New fields on existing documents are optional and defaulted on read, so a database created by an
earlier release keeps working:

- `monitoring_targets`: `failureThreshold`, `recoveryThreshold`, `warningThresholdMs`,
  `criticalThresholdMs`, `autoIncidentEnabled`, `consecutiveSuccesses`, `claimedAt`,
  `claimExpiresAt` (all optional).
- `incidents`: `acknowledgedAt`, `category`, `impact`, `urgency`, `sourceAlertId`,
  `sourceMonitoringTargetId`, `autoCreated`.
- `security_findings`: `cvssScore`, `component`, `installedVersion`, `fixedVersion`,
  `remediationDeadline`, `source`, `scanId`, `lastSeenAt`.
- `assets`: optional CMDB attributes reserved for a later phase (`assetTag`, `department`,
  `criticality`, `lifecycleStatus`, `manufacturer`, `model`, `serialNumber`).

`initializeAppDatabase()` is idempotent: it creates missing collections and indexes, and never drops or
rewrites existing documents.
