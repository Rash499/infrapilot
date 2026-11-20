# Phase 0 — Repository Baseline Audit

**Audit date:** 2026-11-21  
**Audited base:** `main` at `f15c29941b3ad8da6ab96059da63f2df4624be91`  
**Scope:** repository structure, application stack, database, authentication/security foundations, tests, Docker/CI and the InfraPilot Ultimate requirements.

This document records evidence visible in the repository and the latest GitHub Actions run. It is not a production security certification or a claim that every feature is complete.

## 1. Baseline repository inventory

- Repository: `Rash499/infrapilot`
- Default branch: `main`
- Audited tree: 141 entries.
- Application: Next.js 16 App Router, React 19, TypeScript.
- Persistence: PostgreSQL with Drizzle ORM and SQL migrations.
- API: versioned REST API at `/api/v1`, dispatched through route/controller/service layers.
- Background monitoring: a dedicated monitoring worker and probe implementation.
- Existing test tooling: Vitest, Testing Library and Playwright.
- Deployment: Dockerfile, Docker Compose and GitHub Actions CI.

The current implementation is not the Vite + Express + Prisma stack named in the uploaded reference. The architecture decision is to preserve Next.js + Drizzle and evolve it incrementally rather than perform a risky framework/ORM rewrite.

## 2. CI verification evidence

The latest workflow run on the audited `main` commit is:

- Run: [CI #5](https://github.com/Rash499/infrapilot/actions/runs/44805892512)
- Commit: `f15c29941b3ad8da6ab96059da63f2df4624be91`
- Overall conclusion: **success**
- Both jobs completed successfully.

### Quality job

The following steps completed successfully:

1. Dependency installation using `npm install --no-audit --no-fund`.
2. ESLint.
3. Next.js type generation.
4. TypeScript type checking.
5. Vitest unit and component tests.
6. Production build.

### End-to-end job

The following steps completed successfully:

1. PostgreSQL 16 service startup and health check.
2. Dependency installation.
3. Drizzle migrations.
4. Development seed.
5. Production build.
6. Playwright Chromium installation.
7. Playwright E2E suite.

The current E2E file contains scenarios for invalid login, asset registration + monitoring target + incident + security finding, and maintenance scheduling. CI success is evidence that the configured workflow passed; it is not proof that every requested product workflow is covered.

## 3. Existing foundation confirmed in source

| Area | Source evidence | Baseline assessment |
|---|---|---|
| Authentication | `auth.controller.ts`, `auth.service.ts`, `lib/security.ts` | Registration, login, logout, password reset and refresh-token rotation are present |
| Password storage | `lib/security.ts` | Node scrypt password hashing |
| Session refresh | `auth.service.ts`, refresh-token schema | Refresh token hashes stored; rotation and token-family reuse revocation present |
| Authorization | Controller/service routes and user role enum | Three roles exist: admin, operator, viewer; granular permission model remains incomplete |
| Assets | Asset controller/service/schema/UI | Core asset CRUD and history foundations exist; Ultimate field coverage/import/export remain incomplete |
| Monitoring | Monitoring controller/service/worker/probe/schema | HTTP/TCP probes and persisted results exist; Prometheus/exporter integration remains incomplete |
| SSRF protection | `lib/ssrf.ts` and tests | Destination validation and private-network opt-in are present |
| Security findings | Findings service and schema | Manual findings/remediation foundation exists; scanner ingestion/CVSS workflow remains incomplete |
| ITSM | Incident, maintenance and change services | Core workflows exist; service requests/SLA/escalation remain incomplete |
| Audit | Audit service and schema | Application audit events exist; broader coverage and append-only guarantees require dedicated verification |
| Notifications | Notification service and mailer | In-app notification foundation exists; default mail transport only logs delivery intent |
| Tests | `tests/unit`, `tests/components`, `e2e` | Useful baseline suite exists; coverage is much narrower than the 30-module acceptance scope |

## 4. Phase 0 gaps and risks

### P0 — Reproducible dependency installation

- No `package-lock.json` is present in the audited tree.
- CI currently uses `npm install`, so dependency resolution is not pinned by a committed npm lockfile.
- Before the project is considered reproducible, generate and commit a reviewed lockfile, then switch CI to `npm ci`.

### P0 — Expand automated acceptance coverage

- Current E2E coverage is limited to the scenarios listed above.
- Add integration/API tests for authorization boundaries, refresh-token rotation/reuse, password reset, asset permissions, monitoring lifecycle, incident/change approvals and audit behavior.
- Add regression coverage before changing security-sensitive behavior.

### P1 — Operational security hardening

- The rate limiter is process-local in-memory state; it is not shared across multiple application instances.
- The default mail transport is a log transport, not SMTP delivery.
- The role model is currently limited to three roles rather than the requested seven roles and granular permissions.
- Review origin/CSRF behavior, trusted-proxy configuration, cookie flags, rate-limit coverage and audit immutability in dedicated tests.
- Add dependency audit, secret scanning, container scanning and SBOM generation to CI.

### P1 — Integration boundary verification

Prometheus, Blackbox Exporter, Node Exporter, Windows Exporter, GitHub, Docker Engine, Kubernetes, Trivy, Greenbone, Terraform, Ansible, Restic, SMTP and Telegram are not verified as configured integrations in the current baseline. They require separate adapters, credentials, permissions and connection tests.

## 5. Phase 0 acceptance checklist

| ID | Acceptance criterion | Status |
|---|---|---|
| P0-01 | Inspect repository structure and current architecture | Complete |
| P0-02 | Record current feature coverage against the 30-module specification | Complete |
| P0-03 | Verify latest main-branch CI quality job | Complete — CI #5 |
| P0-04 | Verify migrations, seed, build and E2E workflow in CI | Complete — CI #5 |
| P0-05 | Generate and commit package lockfile | Pending |
| P0-06 | Switch dependency install to deterministic `npm ci` | Pending |
| P0-07 | Add focused auth/RBAC/CSRF/refresh-token integration tests | Pending |
| P0-08 | Add dependency and secret scanning to CI | Pending |
| P0-09 | Re-run CI on the Phase 0 branch and record results | Pending |
| P0-10 | Review and merge Phase 0 pull request | Pending |

Phase 0 is **not complete** until the pending acceptance criteria are closed or explicitly deferred with a documented reason.

## 6. Next implementation phase

After Phase 0, proceed to **Phase 1 — Identity, Permissions and Audit**:

1. Introduce granular permissions and map the requested roles to them.
2. Keep authorization enforced in backend route/service boundaries.
3. Add session inventory and administrative session revocation.
4. Add login history and account status workflows.
5. Test cross-origin/CSRF protections and refresh-token rotation/reuse.
6. Verify audit coverage for administrative and security-sensitive actions.

Do not begin Phase 2 IPAM/topology work until Phase 1 exit criteria are met.
