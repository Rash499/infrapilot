# MongoDB-only migration

## Objective

Move InfraPilot's application runtime from PostgreSQL/Drizzle to MongoDB while preserving existing API contracts, identifiers, authorization behavior, and domain workflows.

## Migration requirements

- Convert every database-backed service and worker to MongoDB collections and supported MongoDB operations.
- Preserve authentication behavior, including access tokens, refresh-token rotation, password reset, roles, and permissions.
- Preserve assets and relationships, monitoring targets/results, findings/events, incidents and comments, maintenance records, change requests and approvals, notifications, and audit history.
- Convert database initialization and seed workflows. Seed operations must not silently erase existing data.
- Use MongoDB transactions for operations that require multi-document atomicity. Local and CI MongoDB instances must therefore run as replica sets.
- Make health/readiness checks validate MongoDB only.
- Replace PostgreSQL Docker Compose and CI services with MongoDB replica-set setup.
- Remove PostgreSQL/Drizzle packages, SQL migrations, configuration, environment variables, and code only after all runtime imports and queries have been migrated.

## Data safety

- Do not drop collections or reset production data as part of initialization.
- Keep existing UUID-style document identifiers and API response shapes.
- Any destructive development-only reset must be explicit and separately invoked.

## Verification required

- Repository-wide search for PostgreSQL, Drizzle, `pg`, SQL migrations, and `DATABASE_URL`.
- Lint, typecheck, unit tests, production build, and Playwright E2E using MongoDB.
- Exercise login, refresh, password reset, role/permission checks, monitoring worker state transitions, and core asset/incident/change-management workflows.

## Current status

This document records the acceptance scope for the migration branch. It does not claim that the migration is complete. PostgreSQL is still used by the base branch's database adapter, services, worker, health check, Docker Compose, and CI workflow. The PR must remain a draft until those dependencies are converted and the verification above passes.
