# Incident intelligence: SLA, timelines and global search

## 1. SLA policy

SLA targets depend only on priority and are applied on read, so incidents created before SLA tracking
still get meaningful figures (no migration required).

| Priority | Acknowledge within | Resolve within |
| --- | --- | --- |
| P1 | 15 minutes | 4 hours |
| P2 | 30 minutes | 8 hours |
| P3 | 2 hours | 24 hours |
| P4 | 8 hours | 72 hours |

Acknowledgement happens when:

- an operator calls `POST /api/v1/incidents/:id/acknowledge`, or
- the incident leaves `open` (status change to investigating/in_progress/resolved/closed) without a
  previous acknowledgement.

`acknowledgedAt` is written once; later calls and status changes never overwrite it, so MTTA is stable.

### States

| State | Meaning |
| --- | --- |
| `pending` | Inside the SLA budget and not acknowledged yet (or acknowledged, with resolution time remaining). |
| `at_risk` | At least 80 % of the acknowledgement or resolution budget has elapsed and the incident is unresolved. |
| `breached` | Acknowledgement or resolution exceeded its target, or the incident is still open past a target. |
| `met` | Resolved/closed within both targets. |

**Unresolved incidents are never counted as resolved.** MTTR averages only incidents with a
`resolvedAt`; open incidents are reported separately as `openIncidents` and can still be `breached`.

### Metrics endpoint

`GET /api/v1/incidents/sla?days=90` returns:

- `openIncidents`, `resolvedIncidents`, `volume`;
- `breachedSla`, `atRiskSla`;
- `mttaMinutes`, `mttrMinutes` (rounded averages, `null` when there is no data);
- counts by severity and a daily opened/resolved trend;
- the policy text for display.

The pre-existing `/incidents/stats` endpoint is unchanged.

## 2. Timeline correlation

`GET /api/v1/incidents/:id` returns a merged timeline (`timeline[]`) with a `source` field:

| Source | Content |
| --- | --- |
| `comment` | Human comments and system comments (status changes, assignment). |
| `alert` | Every event of the monitoring alert linked to the incident, with the alert title and actor. |
| `change` | Change requests that touch an affected asset (planned/implemented time, status, risk). |
| `finding` | Open security findings on affected assets (severity, title, component). |

Entries are sorted by timestamp. Entries from monitoring carry `href: "/alerts"`, changes
`"/changes"` and findings `"/security"` so the UI can link back. Names are resolved server-side;
system actors appear as "Monitoring", "Change management" or "Security" rather than a fake user.

The response also includes `sla` and `monitoringAlert` (when one exists) so the detail page can show
service-level status and the link to the originating alert.

## 3. Global search

`GET /api/v1/search?q=<term>&limit=5` searches:

assets, monitoring checks, alerts, incidents, security findings, maintenance windows, change requests
and — for administrators only — users.

Rules:

- Query must be 2–100 characters (`400 VALIDATION_ERROR` otherwise).
- Each group uses the same repository query as its module list endpoint, so results cannot bypass that
  module's visibility rules.
- The user group is omitted entirely for non-administrators (not merely emptied).
- Results are grouped with per-group totals and a stable `href` for navigation.
- Search is case-insensitive substring matching on the fields each module already searches; it does not
  contact external systems.

The application header exposes the search box; results render at `/search?q=…`.
