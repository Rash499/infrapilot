# MongoDB migration status

## Current state

MongoDB 8 on a replica set is the only application runtime database. The workspace extraction and
runtime cutover are implemented across `apps/backend`, `apps/worker`, `packages/contracts`,
`packages/database`, and `packages/server-core`. PostgreSQL and Drizzle remain in root development
dependencies only because the optional one-way importer in `scripts/migrate-data.ts` reads legacy
installations; its schema and connection code are isolated under `scripts/migration/postgres`.

The code has not been validated against a live MongoDB replica set in this environment. Run the
MongoDB-backed CI/E2E workflow and verify the importer against an isolated, non-production snapshot
before production rollout.

## Migration guarantees

- Preserve the REST routes, request/response contracts, role checks, JWT behavior, password hashing,
  audit events, and monitoring behavior.
- Preserve UUID string identifiers and references; do not convert API IDs to BSON ObjectIds.
- Use explicit collection names, indexes, and replica-set transactions for multi-document operations.
- Startup, bootstrap, and seed operations do not drop existing databases, collections, or user data.
- Application runtime connections use the database-scoped MongoDB user, not the MongoDB root account.
- The legacy importer is opt-in, supports `--dry-run`, and performs idempotent insert-only writes to
  MongoDB while leaving the source database unchanged.

## Implemented

- Workspace packages separate frontend, Express backend, monitoring worker, shared contracts,
  MongoDB persistence, and server-core services.
- MongoDB connection pooling, explicit collection registry, typed repositories, transaction helper,
  sequence counters, and idempotent bootstrap are implemented in `packages/database/src`.
- Runtime service modules use MongoDB repositories only; PostgreSQL compatibility modules are under
  `scripts/migration/postgres` and are not aliases/imports in runtime workspaces.
- Worker instances persist status and heartbeat data in `worker_statuses`; backend and worker expose
  health/readiness endpoints.
- Compose provisions MongoDB 8 `rs0`, bootstraps the application user/indexes, and starts separate
  frontend, backend, and worker services.
- The MongoDB seed adds missing demo roles and skips existing users.
- CI configures an isolated `rs0` replica set and starts backend, worker, and frontend for Playwright.
- `scripts/migrate-data.ts` remains available to copy the legacy PostgreSQL tables while preserving
  UUIDs and sequence values.

## Validation status

- Workspace typechecks, unit tests, lint, production build, and `git diff --check` are run for the
  current branch before release; see the implementation status document for the latest results.
- Live MongoDB replica-set integration and Playwright E2E validation are still required.
- Importer validation against a non-production PostgreSQL snapshot is still required.

## Next steps

1. Run the updated MongoDB replica-set CI/E2E workflow and address any integration failures.
2. Verify migration counts and application behavior with a safe, non-production legacy snapshot.
3. Keep the importer isolated and available until legacy data migration is no longer needed.
4. Continue remaining product roadmap work separately from the completed runtime storage cutover.
