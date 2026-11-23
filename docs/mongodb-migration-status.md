# MongoDB migration status

## Target

Move InfraPilot from PostgreSQL/Drizzle to MongoDB 8.x using the official MongoDB Node.js driver. MongoDB is now the configured deployment and CI target. PostgreSQL compatibility code and dependencies remain until the final cutover is validated.

The target local connection is a single-node replica set named `rs0`. The application must connect with a least-privilege account scoped to the `infrapilot` database.

## Migration rules

- Preserve the current REST routes, request validation, response DTOs, role checks, JWT behavior, password hashing, audit events, and monitoring behavior.
- Keep UUID strings as domain identifiers (`_id` and `id`) during the migration. Do not silently change API IDs to BSON ObjectIds.
- Use explicit MongoDB collection names and indexes. Keep references between domain records as UUID strings.
- Use MongoDB transactions (`withMongoTransaction`) for multi-document operations on `rs0`.
- Never drop existing databases, collections, or user data as part of application startup or seeding.
- Do not use the MongoDB root administrator in the application connection string.
- Keep PostgreSQL compatibility configuration only while unmigrated service modules still depend on Drizzle. Remove PostgreSQL, Drizzle, and SQL migrations only after the service and worker conversion is complete.

## Work completed

- **Connection & pooling:** `src/db/mongo.ts` with URI validation, pooling, graceful close, and `ensureMongoIndexes()`.
- **Collection registry & transactions:** `src/db/collections.ts` with explicit collection names (including durable incident/change sequence counters), `newDocumentId()` / `newEntityIds()`, typed `getCollection()`, and `withMongoTransaction()`.
- **Idempotent schema/index bootstrap:** `src/db/app_db.ts` and `src/db/init.ts` ensure collections and indexes without dropping data and initialize counters from existing records; `scripts/check-mongodb.ts` verifies connectivity and indexes.
- **Document contracts:** `src/db/models/documents.ts` defines strict TypeScript interfaces aligned with the MongoDB bootstrap and migration schema.
- **Stage 1 & core repositories:** `src/db/repositories/` (`users.repository.ts`, `auth-tokens.repository.ts`, `assets.repository.ts`, `audit-notifications.repository.ts`) implementing MongoDB queries, pagination, and transactional token rotation.
- **MongoDB paths for existing workflows:** auth/users, assets, monitoring, dashboard, findings, incidents, maintenance, changes, audit, and notifications now use MongoDB when configured. Incident/change sequence counters are initialized from existing records; multi-document records and approval workflows use replica-set transactions.
- **PostgreSQL → MongoDB data migration script:** `scripts/migrate-data.ts` (supports `--dry-run`) to copy all 18 tables idempotently into MongoDB while preserving UUIDs and sequence numbers.
- **Compose topology:** `docker-compose.yml` starts MongoDB 8.0 (`rs0`), securely provisions its keyfile, creates a database-scoped application user, bootstraps indexes, then starts `app` and `worker`.
- **Seed/bootstrap commands:** `npm run db:init:mongo`, `npm run db:seed:mongo`, and `npm run db:check:mongo`; the seed is idempotent and never overwrites an existing user.
- **Readiness probe:** `/api/health` validates configuration and checks the configured persistence backend.
- **CI:** quality checks and Playwright E2E are configured to use MongoDB; E2E starts an `rs0` replica set and bootstraps/seeds it before launching the app.
- **Architecture blueprint:** `docs/full-system-architecture.md` documenting current vs. target vs. roadmap capabilities.

## Remaining stages

1. **Single-database cutover** — verify all runtime services, routes, seed flows, worker lifecycle, and health checks use MongoDB; then remove PostgreSQL fallback paths.
2. **Seed & E2E verification against `rs0`** — run CI or local integration/E2E against a live MongoDB 8 replica set; no live MongoDB run has yet been verified in this environment.
3. **PostgreSQL removal** — remove `src/db/index.ts`, `src/db/schema.ts`, `drizzle/`, `drizzle-orm`, `pg`, and PostgreSQL Compose/CI configuration only after the cutover passes.
4. **Remaining product scope** — implement the additional asset metadata/operations, dashboard widgets and KPIs, granular RBAC, network/IPAM, supported integrations, DevOps/container/Kubernetes, backup/DR, capacity, runbooks, global search, audit/reporting, and advanced operations progressively as specified in the product brief.

## Validation status

- Previously verified before the MongoDB CI/deployment cutover:
  - `npx next typegen` — passed
  - `npm exec tsc -- --noEmit --pretty false` — passed
  - `npm run lint` — passed (0 errors; React compiler/hook warnings only)
  - `npx vitest run` — passed (including `tests/unit/mongodb-layer.test.ts`)
  - `npm run build` — passed
  - Live runtime smoke suite (`scripts/smoke-test.ts`) and Playwright E2E (`e2e/infrapilot.spec.ts`) — passed against PostgreSQL
- Live MongoDB 8 `rs0` integration tests remain pending an environment with a running MongoDB replica set.
