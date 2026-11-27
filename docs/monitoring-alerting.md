# Monitoring, analytics and alerting

This document describes how InfraPilot turns probe results into metrics, alerts and incidents, and how
operators interact with that lifecycle. Everything described here is computed from records stored in
MongoDB — there are no hardcoded dashboards, seeded counters or placeholder buttons.

## 1. Check pipeline

For each claimed monitoring target the worker runs the same sequence:

1. **Claim** the target with a lease (`claimedAt`, `claimExpiresAt`). The claim advances `nextCheckAt`
   atomically inside a transaction, so two worker processes can never check the same target at the same
   time.
2. **Probe** the URL or TCP port (`runProbe`) with destination validation (SSRF protections).
3. **Compute state** (`computeState`) using the target's `failureThreshold` and warning latency.
4. **Record** the result in `monitoring_results` and update the target atomically.
5. **Evaluate alerts** (`processCheckAlerts`) — thresholds, deduplication, maintenance suppression,
   automatic incidents and recovery handling.
6. **Process alerts**: release expired suppressions, resolve recovered conditions, resume escalated ones.
7. **Release the lease** in a `finally` block. A crashed worker therefore cannot strand a target: once
   the lease expires, the target becomes claimable again (`claimExpiresAt < now`).

Monitoring state and alerting are deliberately separate. A maintenance window suppresses *alert
escalation*; it does not falsify the recorded check result or the target's health state.

## 2. Thresholds

Every target carries its own thresholds; values fall back to environment defaults for targets created
before the fields existed.

| Setting | Default | Meaning |
| --- | --- | --- |
| `failureThreshold` | `MONITOR_FAILURE_THRESHOLD` (3) | Consecutive failed checks before the target is unavailable and an availability alert is raised. |
| `recoveryThreshold` | `MONITOR_RECOVERY_THRESHOLD` (2) | Consecutive successful checks required before an availability alert resolves. |
| `degradedThresholdMs` | 1000 ms | Successful checks slower than this are `degraded`. |
| `warningThresholdMs` | `MONITOR_WARNING_THRESHOLD_MS` (1500 ms) | Raises a warning latency alert. Also drives the `degraded` state. |
| `criticalThresholdMs` | `MONITOR_CRITICAL_THRESHOLD_MS` (5000 ms) | Raises a critical latency alert. |

The critical threshold can never be configured below the warning threshold.

## 3. Alert lifecycle

Alerts live in the `alerts` collection with the following states:

```
triggered ──► acknowledged ──► resolved
     │              │
     └──────────────┴──► suppressed ──► triggered (when suppression expires)
```

- **Triggered** — the worker detected a condition (availability failure or latency breach).
- **Acknowledged** — an operator has taken ownership. MTTA uses this timestamp.
- **Suppressed** — escalation paused (maintenance window or manual suppression) until
  `suppressedUntil`. Suppression never changes service health.
- **Resolved** — the condition cleared or an operator resolved it. Resolution notes are required for
  manual resolution.

Each transition appends an event to the alert (`triggered`, `refreshed`, `acknowledged`, `resolved`,
`suppressed`, `unsuppressed`, `incident_created`) with actor ID and timestamp, and writes an audit log
entry.

### Deduplication

`alerts_active_dedupe_unique` is a **partial unique index** over `dedupeKey` for the active statuses
(`triggered`, `acknowledged`, `suppressed`). `dedupeKey` is `<targetId>:<availability|latency>`.

Consequences:

- Two workers evaluating the same condition concurrently cannot create two active alerts; the losing
  insert refreshes the winner instead (`occurrences`, `lastSeenAt`, message).
- Once an alert resolves, the key is free again, so a recurrence opens a **new** alert with its own
  lifecycle history rather than rewriting the old one.

### Maintenance suppression

When a check belongs to an asset covered by a `scheduled` or `in_progress` maintenance window
(`startsAt <= now < endsAt`), the worker:

1. records the check result as usual;
2. suppresses any active alerts for that target with the window's end as `suppressedUntil`;
3. skips automatic incident creation.

After the window ends the next check releases the suppression and, if the service is still failing,
escalates again. The audit log records `alert.suppressed_by_maintenance` with the window ID.

### Automatic incidents

`AUTO_INCIDENT_ENABLED` (default `true`) is the environment switch; each target can also opt out with
`autoIncidentEnabled`. A critical alert creates an incident when **all** of the following hold:

- automatic creation is enabled for the environment and the target;
- the alert is critical;
- the target is not under maintenance;
- the alert has no incident yet.

`incidents_source_alert_unique` (unique, sparse on `sourceAlertId`) guarantees a single incident per
alert even with concurrent workers. The incident is created with `autoCreated: true`, priority `p1`,
the affected asset and a system comment. Recovery adds a system comment ("Monitoring recovered…") but
never closes the incident; humans confirm the fix and record the resolution.

## 4. Analytics

All figures are MongoDB aggregations over `monitoring_results`.

- `GET /api/v1/monitoring/analytics?range=24h|7d|30d`
  - uptime for 24 h, 7 d and 30 d;
  - totals and latency distribution: average, minimum, maximum, p95, p99 (via `$percentile`);
  - an hourly (24 h) or daily (7 d/30 d) trend with uptime per bucket;
  - per-target statistics for the selected window.
- `GET /api/v1/monitoring/targets/:id/analytics?range=…` — the same aggregates for one target.
- `GET /api/v1/monitoring/targets/:id/results?range=…` — raw check history, newest first.

Percentiles are computed on numeric response times only, so failed checks with no latency do not
distort latency statistics. Uptime is `successful checks / total checks` in the window and is `null`
when a window has no data (rendered as "—" rather than `0 %`).

## 5. Alert API

| Method | Path | Permission | Purpose |
| --- | --- | --- | --- |
| GET | `/alerts` | read | Paginated list with status, severity, target, asset, incident and text filters. |
| GET | `/alerts/summary` | read | Active counts by state/severity and a 14-day trend. |
| GET | `/alerts/:id` | read | Alert with full event history and resolved names. |
| POST | `/alerts/:id/acknowledge` | write | Acknowledge with an optional note. |
| POST | `/alerts/:id/resolve` | write | Resolve with required notes. |
| POST | `/alerts/:id/suppress` | write | Suppress until a timestamp (default one hour) with a reason. |

Transition endpoints are guarded by expected statuses, so two operators acting at once cannot apply
conflicting transitions; the second receives `409 CONFLICT` and a message to reload.

## 6. Operational notes

- Alert history is retained; nothing prunes alerts automatically today.
- Monitoring results are pruned after `MONITOR_RETENTION_DAYS` (default 30) by the worker.
- The alerts page refreshes every 30 seconds while the tab is visible.
- Acknowledging an alert does **not** stop checks; it records ownership. Suppress it to pause
  escalation.
