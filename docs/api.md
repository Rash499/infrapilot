# InfraPilot REST API (v1)

Base path: `/api/v1`. All JSON.

## Conventions

**Authentication.** Protected endpoints require `Authorization: Bearer <accessToken>`. Access tokens expire
after `ACCESS_TOKEN_TTL_SECONDS` (default 900). Refresh with `POST /auth/refresh`.

**Cookie endpoints** (`/auth/refresh`, `/auth/logout`) also require the header `X-InfraPilot-Request: 1`.

**Roles.** `read` = Viewer, Operator, Administrator. `write` = Operator, Administrator. `admin` = Administrator.

**Success envelope.** `{ "data": <payload> }`. Lists add `"meta": { "page", "pageSize", "total", "totalPages" }`
plus endpoint-specific fields (for example `unreadCount`).

**Error envelope.** `{ "error": { "code": "<CODE>", "message": "<text>", "details"?: [...] } }`.

| HTTP | Code | Meaning |
| --- | --- | --- |
| 400 | `BAD_REQUEST`, `VALIDATION_ERROR`, `MALFORMED_JSON` | Invalid input (`details` lists field issues) |
| 401 | `UNAUTHORIZED` | Missing, expired or invalid session |
| 403 | `FORBIDDEN` | Role or policy does not allow the action |
| 404 | `NOT_FOUND` | Resource or endpoint does not exist |
| 405 | `METHOD_NOT_ALLOWED` | Path exists with a different method |
| 409 | `CONFLICT` | Duplicate or state conflict |
| 422 | `UNPROCESSABLE` | Valid syntax but rejected by business or network policy (for example a blocked monitoring destination) |
| 429 | `RATE_LIMITED` | Too many attempts |
| 500 | `INTERNAL_ERROR` | Unexpected failure; includes `X-Request-Id` for correlation |

Every response carries `X-Request-Id`. Send your own value to correlate logs.

**Pagination.** `page` (default 1) and `pageSize` (default 20, max 100).

**Sorting.** `sort` (whitelisted per endpoint) and `order=asc|desc`.

---

## Health

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/api/health` | none | Database connectivity probe. Returns `{ "ok": true }` or 500 |

## Authentication — `/auth`

| Method | Path | Auth | Role | Body / params | Success | Errors |
| --- | --- | --- | --- | --- | --- | --- |
| POST | `/auth/register` | none | — | `{ name, email, password }`. Password ≥ 12 chars with upper, lower, digit | 201 `{ accessToken, expiresIn, user }` + refresh cookie. First account becomes admin | 400, 409 (email exists), 429 |
| POST | `/auth/login` | none | — | `{ email, password }` | 200 `{ accessToken, expiresIn, user }` + refresh cookie | 400, 401, 403 (deactivated), 429 |
| POST | `/auth/refresh` | refresh cookie + header | — | none. Rotates the refresh token | 200 `{ accessToken, expiresIn, user }` + new cookie | 401 (also on token reuse), 403 (missing header) |
| POST | `/auth/logout` | refresh cookie + header | — | none | 200 `{ loggedOut: true }`, cookie cleared | 403 |
| POST | `/auth/forgot-password` | none | — | `{ email }` | 202 `{ message }`; `devToken` only when `EXPOSE_RESET_TOKEN=true` | 400, 429 |
| POST | `/auth/reset-password` | reset token | — | `{ token, password }` | 200 `{ message }`; all sessions revoked | 400 (invalid/expired/used), 429 |

## Users — `/users`

| Method | Path | Auth | Role | Body / params | Success | Errors |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `/users/me` | bearer | read | — | 200 user | 401 |
| PATCH | `/users/me` | bearer | read | `{ name }` | 200 user | 400 |
| POST | `/users/me/password` | bearer | read | `{ currentPassword, newPassword }`. Revokes other sessions and returns a fresh session | 200 session | 400, 401 (wrong current password), 429 |
| GET | `/users/options` | bearer | read | — | 200 `[{ id, name, role }]` active users for assignment pickers | 401 |
| GET | `/users` | bearer | admin | `search`, `role`, pagination | 200 list | 403 |
| PATCH | `/users/:id` | bearer | admin | `{ name?, role?, isActive? }`. Role or deactivation revokes sessions | 200 user | 400 (self-demotion), 403, 404 |

## Infrastructure assets — `/assets`

| Method | Path | Auth | Role | Parameters | Success | Errors |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `/assets` | bearer | read | `search`, `assetType`, `environment`, `status`, `archived=true|false`, `sort=name|assetType|environment|status|createdAt|updatedAt`, `order`, pagination | 200 list | 400 |
| POST | `/assets` | bearer | write | `{ name, assetType, hostname?, ipAddress?, operatingSystem?, environment?, location?, ownerId?, description?, status? }` | 201 asset | 400, 422 (unknown owner) |
| GET | `/assets/:id` | bearer | read | — | 200 asset with `monitors`, `findings`, `incidents` | 404 |
| PATCH | `/assets/:id` | bearer | write | any subset of POST fields plus `archived: boolean` | 200 asset | 400, 404, 422 |
| DELETE | `/assets/:id` | bearer | write | Archives the asset (soft delete) | 200 asset | 404 |
| GET | `/assets/:id/history` | bearer | read | — | 200 audit entries for the asset | 404 |

Asset types: `physical_server`, `virtual_machine`, `network_device`, `cloud_resource`, `container`, `database`,
`application`, `other`. Environments: `development`, `testing`, `production`. Statuses: `healthy`, `degraded`,
`unavailable`, `maintenance`, `unknown`.

## Monitoring — `/monitoring`

| Method | Path | Auth | Role | Body / parameters | Success | Errors |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `/monitoring/overview` | bearer | read | — | 200 `{ summary, uptime24hPct, avgResponse24hMs, checks24h, services[] }` | 401 |
| GET | `/monitoring/targets` | bearer | read | `search`, `state`, `monitorType=http|tcp`, `sort=name|status|lastCheckedAt|intervalSeconds`, `order`, pagination | 200 list | 400 |
| POST | `/monitoring/targets` | bearer | write | `{ name, monitorType:"http"|"tcp", url? (http), host? + port? (tcp), expectedStatusCode?, intervalSeconds (30–86400), timeoutMs (500–30000), degradedThresholdMs, enabled, allowPrivateNetwork (admin only), assetId? }` | 201 target | 400, 403 (`allowPrivateNetwork` by non-admin), 422 (blocked or unresolvable destination) |
| GET | `/monitoring/targets/:id` | bearer | read | — | 200 target with `stats` (uptime 24h/7d/30d) and `recentResults` | 404 |
| PATCH | `/monitoring/targets/:id` | bearer | write | any subset of POST fields. Queues an immediate check | 200 target | 400, 403, 404, 422 |
| DELETE | `/monitoring/targets/:id` | bearer | admin | — | 200 `{ deleted: true }` | 403, 404 |
| POST | `/monitoring/targets/:id/check` | bearer | write | — Queues an on-demand check for the worker | 202 `{ queued, queuedAt }` | 404, 422 (disabled) |
| GET | `/monitoring/targets/:id/results` | bearer | read | `range=1h|24h|7d|30d`, pagination | 200 list of results | 404 |

Service states: `healthy`, `degraded`, `unavailable`, `unknown`. Blocked destinations include loopback,
RFC 1918, link-local, CGNAT, unique-local IPv6, and cloud metadata addresses unless
`allowPrivateNetwork` was authorised by an administrator (metadata is always blocked).

## Security findings — `/findings`

| Method | Path | Auth | Role | Body / parameters | Success | Errors |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `/findings` | bearer | read | `search`, `severity`, `status`, `assetId`, `assigneeId`, `sort=severity|createdAt|updatedAt|title`, `order`, pagination | 200 list | 400 |
| POST | `/findings` | bearer | write | `{ title, description, severity, assetId?, assigneeId?, remediation?, cveId? }` | 201 finding with `history` | 400, 422 |
| GET | `/findings/:id` | bearer | read | — | 200 finding with remediation `history` | 404 |
| PATCH | `/findings/:id` | bearer | write | any subset of POST fields plus `status` (`open`, `in_progress`, `resolved`, `accepted_risk`) and `note`. `accepted_risk` requires `note` | 200 finding | 400, 404, 422 |
| DELETE | `/findings/:id` | bearer | admin | — | 200 `{ deleted: true }` | 403, 404 |

Severities: `critical`, `high`, `medium`, `low`, `informational`. A new critical finding notifies operators and administrators.

## Incidents — `/incidents`

| Method | Path | Auth | Role | Body / parameters | Success | Errors |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `/incidents` | bearer | read | `search`, `status`, `severity`, `priority`, `assigneeId`, `assetId`, `active=true|false`, `sort=openedAt|severity|priority|updatedAt`, `order`, pagination | 200 list | 400 |
| POST | `/incidents` | bearer | write | `{ title, description, severity, priority: p1..p4, assigneeId?, assetIds[] }` | 201 incident with timeline | 400, 422 |
| GET | `/incidents/stats` | bearer | read | `days` (1–365, default 90) | 200 `{ total, activeCount, bySeverity, byStatus, openedByDay, meanTimeToResolveHours }` | 400 |
| GET | `/incidents/:id` | bearer | read | — | 200 incident with `assets` and `timeline` | 404 |
| PATCH | `/incidents/:id` | bearer | write | `{ title?, description?, severity?, priority?, status?, assigneeId?, assetIds?, rootCause?, resolution? }`. `resolved` and `closed` require a resolution | 200 incident | 400, 404, 422 |
| POST | `/incidents/:id/comments` | bearer | write | `{ body }` | 201 comment | 400, 404 |

Statuses: `open`, `investigating`, `in_progress`, `resolved`, `closed`. Assignment, status changes and comments create notifications for the assignee.

## Maintenance — `/maintenance`

| Method | Path | Auth | Role | Body / parameters | Success | Errors |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `/maintenance` | bearer | read | `search`, `status`, `from`, `to` (ISO), `sort=startsAt|createdAt`, `order`, pagination | 200 list | 400 |
| POST | `/maintenance` | bearer | write | `{ title, description, startsAt, endsAt (ISO, after start), ownerId?, assetIds[], notes? }`. Response includes `conflictWarnings` | 201 maintenance with `conflicts` | 400, 422 |
| GET | `/maintenance/:id` | bearer | read | — | 200 maintenance with `conflicts` | 404 |
| PATCH | `/maintenance/:id` | bearer | write | any subset of POST fields plus `status`. Transitions: scheduled → in_progress/cancelled/completed; in_progress → completed/cancelled | 200 maintenance | 400, 404, 422 |
| DELETE | `/maintenance/:id` | bearer | admin | — | 200 `{ deleted: true }` | 403, 404 |

## Change management — `/changes`

| Method | Path | Auth | Role | Body / parameters | Success | Errors |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `/changes` | bearer | read | `search`, `status`, `riskLevel`, `sort=createdAt|updatedAt|plannedStartAt`, `order`, pagination | 200 list with `approvalsRequired` | 400 |
| POST | `/changes` | bearer | write | `{ title, description, reason, riskLevel, riskAssessment?, rollbackPlan?, plannedStartAt?, plannedEndAt?, implementerId?, assetIds[] }` | 201 change (draft) | 400, 422 |
| GET | `/changes/:id` | bearer | read | — | 200 change with `assets` and `approvals` | 404 |
| PATCH | `/changes/:id` | bearer | write | any subset of POST fields. Only draft or rejected changes, by requester or admin | 200 change | 400, 403, 404, 422 |
| POST | `/changes/:id/submit` | bearer | write | — Requires `riskAssessment` and `rollbackPlan`. Moves to pending approval and notifies approvers | 200 change | 403, 404, 422 |
| POST | `/changes/:id/approvals` | bearer | write | `{ decision: "approved"|"rejected", comment? }`. Requester cannot decide; one decision per approver; rejection requires a comment | 201 change | 403 (requester), 404, 409 (duplicate), 422 |
| POST | `/changes/:id/transitions` | bearer | write | `{ action: "implement"|"rollback"|"cancel", notes? }`. Rollback requires notes | 200 change | 404, 422 |

Statuses: `draft`, `pending_approval`, `approved`, `rejected`, `implemented`, `rolled_back`, `cancelled`.
Approval count required is `REQUIRED_CHANGE_APPROVALS` (default 1).

## Notifications — `/notifications`

| Method | Path | Auth | Role | Parameters | Success | Errors |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `/notifications` | bearer | read | `unread=true|false`, pagination | 200 list with `unreadCount` | 400 |
| POST | `/notifications/read-all` | bearer | read | — | 200 `{ updated }` | 401 |
| POST | `/notifications/:id/read` | bearer | read | — | 200 `{ read: true }` | 404 |

Notification types: `monitoring_unavailable`, `monitoring_recovered`, `critical_finding`, `incident_assigned`,
`incident_updated`, `maintenance_scheduled`, `maintenance_reminder`, `change_pending_approval`, `change_decision`, `general`.

## Dashboard — `/dashboard`

| Method | Path | Auth | Role | Parameters | Success | Errors |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `/dashboard` | bearer | read | `days=1|7|30|90` (default 7) | 200 `{ range, kpis, assetDistribution, incidentBySeverity, findingsByStatus, responseTrend, upcomingMaintenance, recentChanges, generatedAt }` | 400 |

Time series use the selected range. Asset, service and finding figures are current snapshots.

## Audit — `/audit`

| Method | Path | Auth | Role | Parameters | Success | Errors |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `/audit` | bearer | admin | `entityType`, `entityId`, `actorId`, pagination | 200 list | 403 |
| GET | `/audit/:entityType/:entityId` | bearer | read | — | 200 entity history | 401 |
