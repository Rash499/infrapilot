# MongoDB migration status

## Target

Move InfraPilot from PostgreSQL/Drizzle to MongoDB 8.x using the official MongoDB Node.js driver. Work is isolated on `feature/mongodb-migration-implementation`; `main` is not modified.

The target local connection is a single-node replica set named `rs0`. The application must connect with a least-privilege account scoped to the `infrapilot` database.

## Migration rules

- Preserve the current REST routes, request validation, response DTOs, role checks, JWT behavior, password hashing, audit events, and monitoring behavior.
- Keep UUID strings as domain identifiers during the first migration. Do not silently change API IDs to BSON ObjectIds.
- Use explicit MongoDB collection names and indexes. Keep references between domain records as UUID strings.
- Use MongoDB transactions for multi-document operations. The local MongoDB server must therefore run as a replica set.
- Never drop existing databases, collections, or user data as part of application startup or seeding.
- Do not use the MongoDB root administrator in the application connection string.
- Keep PostgreSQL compatibility configuration only while unmigrated service modules still depend on Drizzle. Remove PostgreSQL, Drizzle, and SQL migrations only after the service and worker conversion is complete.

## Work completed on this branch

- Reused the existing MongoDB client pool, connection validation, graceful close, and idempotent index definitions in `src/db/mongo.ts`.
- Added `src/db/collections.ts` with an explicit collection-name registry, UUID document IDs, typed collection access, and a transaction helper.
- Added `scripts/check-mongodb.ts` and `npm run db:check:mongo` to ping the configured database and verify/create indexes without dropping data.
- Updated `/api/health` to check MongoDB connectivity.
- Kept the PostgreSQL/Drizzle implementation in place because the current service modules still depend on it. This is an intentional intermediate stage, not a completed datastore migration.

## Remaining stages

1. **Identity and authentication** — migrate users, refresh tokens, password-reset tokens, and authentication/session flows.
2. **Core operations** — migrate assets, audit logs, incidents, findings, maintenance, changes, notifications, and dashboard queries.
3. **Monitoring worker** — migrate target claiming, result persistence, retention, aggregation, and worker lifecycle.
4. **Seed, deployment, and CI** — migrate seed behavior, Docker Compose, tests, and deployment documentation.
5. **Removal** — remove Drizzle, PostgreSQL, SQL migrations, and PostgreSQL environment variables only after all application references are gone.

## Validation status

The GitHub edits have been committed, but the branch has not been run through the project's local typecheck, lint, unit tests, or build. Do not deploy this intermediate branch as a completed MongoDB migration.
