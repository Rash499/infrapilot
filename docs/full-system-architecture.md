# InfraPilot – Full System Architecture

> **Status:** MongoDB migration in progress. This document records the complete system architecture and distinguishes **current repository capabilities** from **staged migration work** and **future roadmap capabilities**.

InfraPilot is a centralized Infrastructure and IT Operations Management Platform (ITOM) designed to manage IT infrastructure, monitor service availability, identify security risks, manage incidents, and control infrastructure changes through one web-based console.

---

## 1. High-level architecture

The system follows a **layered modular monolith** architecture: independently organized business modules running within one Next.js application (plus an independently runnable monitoring worker process) rather than separate microservices.

```
Users & Administrators (Administrator · Operator · Viewer)
  │
  ▼
Presentation Layer — Next.js 16 · React 19
  Dashboard · Asset Inventory · Monitoring · Security · Incidents · Maintenance · Changes · Notifications · Users · Settings
  │
  ▼
API & Application Layer — REST API · TypeScript (/api/v1)
  Routes → Controllers → Validators (Zod) → Services → Repositories / Database Layer
  Authentication · RBAC · Business Rules · Audit · Notifications
  │
  ├──► Background Processing — Monitoring Worker (Scheduler · Probe Engine · State Machine · Reminders)
  │
  └──► Data Persistence Layer
        • Supported deployment: MongoDB 8 (`rs0` replica set, `src/db/mongo.ts`, `src/db/collections.ts`, `src/db/app_db.ts`, `src/db/models/`, `src/db/repositories/`)
        • PostgreSQL/Drizzle compatibility paths remain during the staged cutover
```

### Request lifecycle

1. A user interacts with the React frontend.
2. The frontend sends an HTTP request to `/api/v1/*` via Axios (`src/lib/client/api.ts`) with single-flight token refresh and `X-InfraPilot-Request: 1` anti-CSRF header.
3. The API authenticates the bearer JWT and re-verifies the user's current active state and role (`src/lib/auth.ts`).
4. The controller validates params, query strings, and request bodies via Zod (`src/validators/schemas.ts`).
5. The service executes business rules, transactions, audit logging, and notifications (`src/services/*.service.ts`).
6. The database layer reads or writes persisted records.
7. The API returns a standardized JSON envelope (`{ data, meta }` or `{ error: { code, message, details } }`).

---

## 2. Technology stack

| Layer | Technology | Responsibility |
|---|---|---|
| Frontend | Next.js 16 (App Router) | Application framework & route handlers |
| UI | React 19 | Interactive interface |
| Language | TypeScript (strict) | Shared contracts across frontend & backend |
| Styling | Tailwind CSS v4 | Responsive UI |
| Charts | Recharts | Infrastructure & operations analytics |
| Forms | React Hook Form + Zod resolvers | Form handling & client validation |
| Validation | Zod 4 | Input & environment validation |
| HTTP client | Axios | API communication & single-flight refresh |
| Authentication | `jose` + Node.js `crypto` | HS256 JWT access tokens & scrypt password hashing |
| Primary DB & driver | MongoDB 8 + Node.js Driver 6 | Supported runtime and CI target (`rs0` replica set) |
| Compatibility DB | PostgreSQL + Drizzle ORM | Legacy fallback and one-time migration support; removal remains pending |
| Background jobs | Node.js monitoring worker | Probes, state evaluation, roll-ups & reminders |
| Testing | Vitest, Testing Library, Playwright | Unit, component & browser E2E testing |
| Packaging | Docker & Docker Compose | Application packaging & local orchestration |
| CI/CD | GitHub Actions | Automated lint, typecheck, tests & build |

> **Database migration distinction:** MongoDB is the configured runtime for the supported Compose and CI paths. PostgreSQL/Drizzle fallback code and migration tooling remain in the repository and still require removal after the MongoDB workflows pass live validation.

---

## 3. Frontend architecture

### A. Public authentication area (`src/app/(auth)`)
- `/login` — Sign in
- `/register` — Account registration (first user bootstraps as `admin`, subsequent self-registrations are `viewer`)
- `/forgot-password` — Password reset request and token completion

### B. Protected application area (`src/app/(app)`)
- `/` — Operations overview (KPIs, response-time/uptime trends, asset distribution, incident/finding summaries, upcoming maintenance, recent changes)
- `/assets`, `/assets/[id]` — Infrastructure inventory, filters, archive/restore, history & linked targets/findings/incidents
- `/monitoring` — HTTP/HTTPS & TCP availability targets, response history, uptime metrics & on-demand checks
- `/security` — Findings, severity/status triage, CVE tracking, remediation history
- `/incidents`, `/incidents/[id]` — Incident lifecycle (`INC-00001`), timeline comments, asset links & MTTR stats
- `/maintenance` — Maintenance windows, overlap warnings & 24-hour reminders
- `/changes` — Change requests (`CHG-00001`), risk assessment, rollback plans, approvals & transitions
- `/notifications` — Operational alert feed, unread filtering & mark-read actions
- `/users` — User administration (role changes, activation/deactivation) & audit log viewer
- `/settings` — Profile & password management

### Frontend boundaries
- `src/components/app-shell.tsx` — Navigation, header, role-aware links, unread notification badge
- `src/components/ui.tsx`, `src/components/charts.tsx`, `src/components/forms/` — Reusable UI primitives, charts & forms
- `src/context/` — `auth-context.tsx`, `theme-context.tsx`, `toast-context.tsx`
- `src/lib/client/` — Axios client & `useAsync` hooks
- The frontend never accesses any database directly; all data flows through `/api/v1`.

---

## 4. Backend architecture & module boundaries

```
src/app/api/v1/[...segments]/route.ts  → Thin Next.js entry point
src/routes/index.ts                    → Origin/Sec-Fetch-Site check, route matching, UUID validation, error mapping
src/controllers/*.controller.ts        → Authorize → validate → call service → respond
src/validators/schemas.ts              → Shared Zod 4 schemas
src/services/*.service.ts              → Business rules, transactions, audit & notifications
src/db/                                → Persistence layer (Drizzle + staged MongoDB models/repositories)
```

| Module | Responsibility |
|---|---|
| `auth` | Login, registration, single-use refresh token rotation, family revocation, password reset |
| `users` | Profile, password change, admin role/activation management, user options |
| `assets` | Inventory CRUD, search/filter/sort/pagination, archive/restore, history |
| `monitoring` | HTTP/HTTPS & TCP target management, SSRF checks, results & overview |
| `findings` | Security findings, severity/status triage, CVE field, remediation events |
| `incidents` | Numbered incidents (`INC-*`), asset links, system/human timeline, MTTR stats |
| `maintenance` | Scheduling, overlap detection, asset links, 24h reminders |
| `changes` | Numbered changes (`CHG-*`), submit, approve/reject, implement, rollback, cancel |
| `dashboard` | Live DB-computed KPIs and 1/7/30/90-day aggregations |
| `notifications` | In-app feed, role/user targeting, unread counters |
| `audit` | Append-only activity & security trail |

---

## 5. MongoDB database architecture

Target database: **MongoDB 8.x**, replica set **`rs0`**, database **`infrapilot`**, accessed with a least-privilege application account (`MONGODB_URI`, `MONGODB_DB`).

### Registered collections (18)

| Collection | Stored information |
|---|---|
| `users` | User accounts, roles (`admin`, `operator`, `viewer`), active status |
| `refresh_tokens` | SHA-256 token hashes, families, revocation metadata |
| `password_reset_tokens` | SHA-256 reset token hashes, expiry & usage timestamp |
| `assets` | Servers, VMs, network devices, cloud resources, containers, databases, apps |
| `monitoring_targets` | Target URLs/hosts/ports, intervals, thresholds, current state |
| `monitoring_results` | Historical probe checks, latency, status codes & errors |
| `security_findings` | Vulnerabilities, severity, status, CVE & remediation text |
| `finding_events` | Finding status transitions & remediation notes |
| `incidents` | Numbered incidents, priority P1–P4, root cause & resolution |
| `incident_assets` | Incident-to-asset links |
| `incident_comments` | System events and operator comments |
| `maintenances` | Scheduled windows, reminders & notes |
| `maintenance_assets` | Maintenance-to-asset links |
| `change_requests` | Numbered changes, risk assessment, rollback plan & workflow state |
| `change_assets` | Change-to-asset links |
| `change_approvals` | Per-approver decisions (`approved` / `rejected`) |
| `notifications` | Per-user operational feed & read timestamps |
| `audit_logs` | Immutable operational & security audit records |

### Design rules
- Retain UUID strings on both `_id` and `id` (`newEntityIds()`) so API contracts do not break.
- Use explicit collection names (`src/db/collections.ts`) and explicit indexes (`src/db/app_db.ts`).
- Use MongoDB multi-document transactions (`withMongoTransaction`) on `rs0` for atomic multi-collection mutations.
- Never drop collections or user data during application startup or seeding.
- Data layer modules: `src/db/mongo.ts`, `src/db/collections.ts`, `src/db/app_db.ts`, `src/db/init.ts`, `src/db/models/documents.ts`, `src/db/repositories/`, `scripts/check-mongodb.ts`, `scripts/migrate-data.ts`.

---

## 6. Infrastructure monitoring architecture

1. **Configuration:** HTTP/HTTPS/TCP targets, intervals (≥ 30s), timeouts, degraded latency thresholds, optional asset link, SSRF controls.
2. **Scheduler (`src/workers/monitor.worker.ts`):** Claims due targets atomically, runs probes with bounded concurrency (`MONITOR_MAX_CONCURRENCY`), prunes expired results (`MONITOR_RETENTION_DAYS`), triggers 24-hour maintenance reminders.
3. **Probe engine (`src/workers/probe.ts`):** Executes pinned-IP HTTP/HTTPS/TCP checks (defeating DNS rebinding), classifies network errors safely without leaking internals.
4. **State machine:** `Healthy` → `Degraded` (latency > threshold or < `MONITOR_FAILURE_THRESHOLD` failures) → `Unavailable` (≥ `MONITOR_FAILURE_THRESHOLD` consecutive failures), plus asset status roll-up and transition notifications.

**Planned monitoring extensions (not yet implemented):** Prometheus, Node Exporter, Windows Exporter, Blackbox Exporter, SNMP, certificate expiry & DNS record monitoring.

---

## 7. Authentication & security controls

- **Passwords:** `scrypt` with per-user salt; minimum 12 characters with mixed case and digits.
- **Sessions:** Short-lived HS256 JWT access tokens held in browser memory; single-use rotating refresh tokens stored only as SHA-256 hashes in `HttpOnly; SameSite=Strict` cookies with family revocation on replay.
- **Authorization:** `admin`, `operator`, `viewer` enforced on every endpoint (`authorize(req, "read" | "write" | "admin")`), re-reading live user role and `isActive` from the database.
- **CSRF & Origin policy:** `X-InfraPilot-Request: 1` header on cookie/API calls plus same-origin / `Sec-Fetch-Site: same-origin` validation (`src/routes/index.ts`).
- **SSRF protection:** Blocks loopback, private RFC1918, link-local, CGNAT, and metadata endpoints unless explicitly authorized by an administrator (`src/lib/ssrf.ts`); pins validated IP per probe and refuses redirects.
- **Hardening:** CSP, `X-Frame-Options: DENY`, `nosniff`, strict referrer & permissions policies, rate limiting, structured JSON logging with recursive secret redaction (`src/lib/logger.ts`).

---

## 8. Deployment & CI/CD architecture

- **Supported Compose setup:** `docker-compose.yml` (MongoDB 8.0 `rs0` replica set + `mongo-init` user/index bootstrap + `app` + `worker`).
- **CI pipeline:** `.github/workflows/ci.yml` — ESLint, TypeScript, Vitest, production build, and Playwright E2E.

---

## 9. Roadmap & recommended sequence

1. **Complete MongoDB cutover:** Verify every runtime route, seed flow, worker, readiness check, and transaction against a live `rs0` replica set; then remove PostgreSQL fallback code and Drizzle/PostgreSQL dependencies while retaining the one-time importer if needed.
2. **Stabilize & harden:** Keep lint, strict `tsc --noEmit`, Vitest, production build, API smoke suite (`scripts/smoke-test.ts`), and Playwright E2E green on every change.
3. **Core infrastructure expansion:** IPAM (subnets/VLANs/allocations), network topology, asset CSV import/export.
4. **Monitoring & alerting expansion:** Prometheus + exporter adapters, alert rules, email/chat/webhook notification sinks.
5. **Security & ITSM:** Scanner ingestion (Trivy/Greenbone), service requests, SLAs, multi-approver governance.
6. **DevOps, cloud & resilience:** GitHub/Docker/Kubernetes/Terraform/Ansible adapters, approved runbooks, backup/DR verification.
