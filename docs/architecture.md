# InfraPilot — Architecture

## 1. Purpose

InfraPilot centralises infrastructure asset inventory, availability monitoring, security findings,
incident response, maintenance scheduling, and change management behind one role-aware console.

## 2. Technology decisions

| Concern | Choice | Rationale |
| --- | --- | --- |
| Frontend | Next.js 16 (App Router) | Standalone UI with a same-origin API proxy |
| Backend | Express 5 REST API | Independently deployable API at `/api/v1` |
| Language | TypeScript (strict) | Shared Zod schemas between browser and server |
| Primary database | MongoDB 8 (`rs0`) | Document persistence and replica-set transactions |
| Data access | MongoDB Node.js Driver 6 + repositories | Typed collection access and explicit indexes |
| Legacy migration tooling | PostgreSQL + Drizzle ORM | Optional one-time importer only; application runtime uses MongoDB |
| Validation | Zod 4 | Identical rules in forms (client) and handlers (server) |
| Auth tokens | `jose` (HS256 JWT) | Maintained, standards-compliant JOSE implementation |
| Password hashing | scrypt (Node `crypto`) | Memory-hard KDF with no native dependency; interchangeable with Argon2id later |
| UI | Tailwind CSS v4, shadcn-style primitives, Lucide, Recharts | Free and open source; components are local and editable |
| Forms | React Hook Form + `@hookform/resolvers` | Uncontrolled inputs, Zod-driven validation |
| HTTP client | Axios | Interceptors for bearer tokens and single-flight refresh |
| Monitoring | Node `http`/`https`/`net` probes | No third-party agent; pinned-IP connections defeat DNS rebinding |
| Testing | Vitest, React Testing Library, Playwright | Unit, component and end-to-end layers |
| Packaging | Docker multi-stage, Compose, GitHub Actions | Reproducible local and CI builds |

## 3. Layered backend

```
HTTP request
  └─ apps/frontend/app/api/v1/[...segments]/route.ts  same-origin proxy
       └─ apps/backend/src/app.ts                     Express middleware and HTTP health
            └─ apps/backend/src/routes/               route matching and request dispatch
                 └─ apps/backend/src/controllers/     authorization, validation and response mapping
                      └─ packages/server-core/        business rules, transactions, audit and notifications
                           └─ packages/database/      MongoDB collections and repositories
```

Supporting modules:

- `packages/server-core/src/lib/` — HTTP errors, auth, security, SSRF policy, environment validation and structured logs.
- `packages/contracts/src/` — browser-safe API types, Zod validators and role permissions.
- `apps/worker/src/` — independent scheduler, probe runner and health endpoint.
- `packages/database/src/` — MongoDB connection, idempotent collection/index bootstrap, documents and repositories.

### Why controllers and routes are split this way

The frontend catch-all route proxies same-origin API requests to the independent Express backend.
Express routes and controllers dispatch validated requests to shared services; authentication and
authorization are applied before business logic. No business logic lives in frontend route handlers.

## 4. Frontend structure

- `src/app/(auth)` — login, registration, password reset (public).
- `src/app/(app)` — protected shell: layout guard, overview and module pages.
- `src/context` — auth session, toast notifications, theme.
- `src/lib/client` — Axios instance, single-flight refresh, `useAsync` data hook.
- `src/components` — UI primitives, charts, app shell, reusable forms (asset form, asset picker).

Access tokens are kept in memory. On page load the client calls `POST /api/v1/auth/refresh`; the httpOnly
refresh cookie restores the session without storing secrets in `localStorage`.

## 5. Logical data model

The diagram describes domain relationships; runtime records use UUID string identifiers and explicit
MongoDB collections. Multi-document writes that must remain consistent use replica-set transactions.

```mermaid
erDiagram
  users ||--o{ refresh_tokens : "owns"
  users ||--o{ password_reset_tokens : "requests"
  users ||--o{ notifications : "receives"
  users ||--o{ audit_logs : "acts"
  users ||--o{ assets : "owns"
  assets ||--o{ monitoring_targets : "monitored by"
  monitoring_targets ||--o{ monitoring_results : "produces"
  assets ||--o{ security_findings : "affected by"
  security_findings ||--o{ finding_events : "history"
  incidents ||--o{ incident_assets : "affects"
  assets ||--o{ incident_assets : "linked"
  incidents ||--o{ incident_comments : "timeline"
  maintenances ||--o{ maintenance_assets : "covers"
  assets ||--o{ maintenance_assets : "linked"
  change_requests ||--o{ change_assets : "touches"
  assets ||--o{ change_assets : "linked"
  change_requests ||--o{ change_approvals : "decided by"
  users ||--o{ change_approvals : "approves"
```

Key constraints and policies:

| Collection | Constraints / indexes | Deletion policy |
| --- | --- | --- |
| `users` | unique `email`; index `role` | Deactivation (`is_active`) preferred; hard delete not exposed |
| `refresh_tokens` | unique `token_hash`; indexes `user_id`, `family_id` | Cascade with user |
| `password_reset_tokens` | unique `token_hash` | Cascade with user |
| `assets` | indexes type, environment, status, hostname, name, archived_at | Soft archive (`archived_at`); owner set null |
| `monitoring_targets` | index `(enabled, next_check_at)` for scheduling; `asset_id` | Asset delete sets null |
| `monitoring_results` | index `(target_id, checked_at)`; `checked_at` for pruning | Cascade with target; pruned after `MONITOR_RETENTION_DAYS` |
| `security_findings` | indexes severity, status, asset, assignee | Asset delete sets null |
| `finding_events` | index `finding_id` | Cascade with finding |
| `incidents` | unique `number` (serial); indexes status, severity, assignee, opened_at | Assignee/reporter set null |
| `incident_assets`, `maintenance_assets`, `change_assets` | composite primary keys | Cascade both ways |
| `incident_comments` | index `incident_id` | Cascade with incident |
| `maintenances` | indexes starts_at, status | Owner set null |
| `change_requests` | unique `number`; indexes status, requester, risk | Requester set null |
| `change_approvals` | unique `(change_id, approver_id)` — one decision per approver | Cascade with change |
| `notifications` | index `(user_id, read_at)` | Cascade with user |
| `audit_logs` | index `(entity_type, entity_id)`, `created_at`, `actor_id` | Actor set null; rows are never updated |

`npm run db:init:mongo` idempotently creates MongoDB collections, indexes, and sequence counters without
dropping data. `scripts/migrate-data.ts` is an optional one-time PostgreSQL importer; PostgreSQL/Drizzle
code is isolated to that migration tooling and is not imported by runtime workspaces.

## 6. Monitoring design

1. **Scheduling.** `claimDueTargets` atomically claims due, enabled targets and advances `nextCheckAt`.
   Several workers can run without double-probing a target.
2. **Concurrency.** A bounded pool (`MONITOR_MAX_CONCURRENCY`) runs probes; a `ticking` guard prevents
   overlapping scheduler passes.
3. **Probing.** HTTP uses `http`/`https` with `lookup` pinned to a pre-validated address. Redirects are not
   followed. Successful status defaults to 2xx/3xx or the configured expected code. TCP connects to the
   pinned address. Every probe has an enforced timeout.
4. **Validation at three points.** When a target is saved (synchronous DNS and policy check), when the worker
   runs it (re-validated, so DNS changes are caught), and at connection time (pinned IP).
5. **State.** `computeState` is a pure function: healthy, degraded (slow or first failures), unavailable
   (≥ `MONITOR_FAILURE_THRESHOLD` consecutive failures), unknown (never checked).
6. **Side effects.** Results are inserted, the target row is updated, state transitions create in-app
   notifications, and linked asset status is rolled up from its monitors. Worker instances persist their
   heartbeats in `worker_statuses`, exposed through `/health/ready` on the worker and `/health/worker` on
   the backend. Assets with no monitors keep their manually maintained status.

## 7. Security architecture

| Control | Implementation |
| --- | --- |
| Password storage | scrypt, N=16384, r=8, p=1, 16-byte random salt, constant-time comparison |
| Password policy | ≥ 12 characters with upper, lower, digit (Zod schema, enforced server-side) |
| Account enumeration | Login and reset responses are uniform; login always performs a hash comparison |
| Access token | HS256 JWT, 15-minute TTL, issuer/audience checked, held in memory on the client |
| Refresh token | 384-bit random value, stored as SHA-256 hash, httpOnly + SameSite=Strict + Secure in production, path-scoped to `/api/v1/auth` |
| Rotation & revocation | Single use; reuse of a revoked token revokes the whole family; password change/reset, deactivation revoke all sessions |
| CSRF | State-changing cookie endpoints require `X-InfraPilot-Request: 1` (cannot be sent cross-site without CORS preflight); bearer-authenticated APIs are not cookie-authenticated |
| Origin checks | Non-GET requests with an `Origin` header must match the request origin or `APP_ORIGIN` |
| Authorisation | Role checked on every endpoint against the database value (`viewer` < `operator` < `admin`); self-demotion and self-deactivation blocked |
| Input validation | Zod for bodies, queries, path identifiers (UUID), enum values, lengths, URL schemes |
| Database query safety | Runtime MongoDB driver filters are structured values; the isolated legacy importer uses bound ORM queries |
| SSRF | Scheme allow-list, credential rejection, DNS resolution with full address-class policy, metadata endpoints always blocked, private ranges only with admin authorisation per target, pinned connections |
| Rate limiting | Fixed window per IP on login, registration, refresh, password reset and change |
| Headers | Helmet-equivalent headers in `next.config.ts`: CSP, frame-ancestors none, nosniff, referrer policy, permissions policy, COOP/CORP, HSTS in production |
| Error exposure | Unknown errors return a generic message with a request ID; stack traces are never returned |
| Logging | JSON logs; keys matching password/token/secret/authorization/cookie/hash are redacted |
| Audit | Immutable `audit_logs` written for security-relevant and business-state changes |

## 8. Known limitations

- Rate limiting is in-memory per process. Multi-instance deployments should move it to Redis.
- Mail delivery uses a log transport by default. Reset links are only echoed in responses when
  `EXPOSE_RESET_TOKEN=true` (development). Configure a real transport through `setMailTransport`.
- DNS rebinding is mitigated by connecting to pre-validated addresses; a determined attacker controlling
  a public host that later resolves to a private address is blocked at connect time by pinning, but the
  policy is evaluated on the resolved set at check time.
- Redirects are not followed by monitoring probes, which avoids redirect-based SSRF at the cost of not
  measuring post-redirect behaviour.
