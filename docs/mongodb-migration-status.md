# MongoDB migration status

## Target

Move InfraPilot from PostgreSQL/Drizzle to MongoDB 8.x using the official MongoDB Node.js driver. Work is isolated on the MongoDB migration branch; the active runtime remains operational on PostgreSQL until all services and workers are converted.

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
- **Collection registry & transactions:** `src/db/collections.ts` with all 18 explicit collection names, `newDocumentId()` / `newEntityIds()`, typed `getCollection()`, and `withMongoTransaction()`.
- **Idempotent schema/index bootstrap:** `src/db/app_db.ts` and `src/db/init.ts` ensuring all 18 collections and 55 indexes without dropping data; `scripts/check-mongodb.ts` for connectivity and index verification.
- **Document contracts:** `src/db/models/documents.ts` defining strict TypeScript interfaces for all 18 MongoDB collections aligned with `src/db/schema.ts` and `src/db/app_db.ts`.
- **Stage 1 & core repositories:** `src/db/repositories/` (`users.repository.ts`, `auth-tokens.repository.ts`, `assets.repository.ts`, `audit-notifications.repository.ts`) implementing MongoDB queries, pagination, and transactional token rotation.
- **PostgreSQL → MongoDB data migration script:** `scripts/migrate-data.ts` (supports `--dry-run`) to copy all 18 tables idempotently into MongoDB while preserving UUIDs and sequence numbers.
- **Target Compose topology:** `docker-compose.mongodb.yml` defining MongoDB 8.0 (`rs0`), `mongo-init`, `app`, and `worker`.
- **Readiness probe:** `/api/health` checks validated configuration, active PostgreSQL runtime, and optional MongoDB connectivity whenever `MONGODB_URI` is configured.
- **Architecture blueprint:** `docs/full-system-architecture.md` documenting current vs. target vs. roadmap capabilities.

## Remaining stages

1. **Identity and authentication cutover** — wire `src/services/auth.service.ts`, `src/services/users.service.ts`, and `src/lib/auth.ts` to the MongoDB repositories when `MONGODB_URI` is active (or complete cutover).
2. **Core operations** — implement repositories and wire `assets`, `audit`, `incidents`, `findings`, `maintenance`, `changes`, `notifications`, and `dashboard` services.
3. **Monitoring worker** — migrate target claiming (`findOneAndUpdate` atomic claim), result persistence, retention pruning, aggregation, and worker lifecycle.
4. **Seed & E2E verification against `rs0`** — run `scripts/migrate-data.ts`, `npm run db:check:mongo`, Vitest, and Playwright against a live MongoDB 8 `rs0` deployment.
5. **PostgreSQL removal** — remove `src/db/index.ts`, `src/db/schema.ts`, `drizzle/`, `drizzle-orm`, `pg`, and `docker-compose.yml` PostgreSQL services only after every reference is gone.

## Validation status

- Verified on the current intermediate build (PostgreSQL runtime + staged MongoDB layer):
  - `npx next typegen` — passed
  - `npm exec tsc -- --noEmit --pretty false` — passed
  - `npm run lint` — passed (0 errors; React compiler/hook warnings only)
  - `npx vitest run` — passed (including `tests/unit/mongodb-layer.test.ts`)
  - `npm run build` — passed
  - Live runtime smoke suite (`scripts/smoke-test.ts`) and Playwright E2E (`e2e/infrapilot.spec.ts`) — passed against the PostgreSQL runtime
- Live MongoDB 8 `rs0` integration tests remain pending an environment with a running MongoDB replica set.
