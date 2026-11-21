# MongoDB migration status

## Target

Move InfraPilot from PostgreSQL/Drizzle to MongoDB 8.x using the official MongoDB Node.js driver. The migration is performed on the `mongodb-migration` branch; `main` is not modified.

The target local connection is a single-node replica set named `rs0`. The application must connect with a least-privilege account scoped to the `infrapilot` database.

## Migration rules

- Preserve the current REST routes, request validation, response DTOs, role checks, JWT behavior, password hashing, audit events, and monitoring behavior.
- Keep UUID strings as domain identifiers during the first migration. Do not silently change API IDs to BSON ObjectIds.
- Use explicit MongoDB collection names and indexes. Keep references between domain records as UUID strings.
- Use MongoDB transactions for multi-document operations. The local MongoDB server must therefore run as a replica set.
- Never drop existing databases, collections, or user data as part of application startup or seeding.
- Do not use the MongoDB root administrator in the application connection string.
- Keep PostgreSQL compatibility configuration only while unmigrated service modules still depend on Drizzle. Remove PostgreSQL, Drizzle, and SQL migrations only after the service and worker conversion is complete.

## Stages

1. **Connection foundation** — add the official driver, validated MongoDB settings, shared connection pool, graceful close, and idempotent index creation.
2. **Identity and authentication** — migrate users, refresh tokens, password-reset tokens, and authentication/session flows.
3. **Core operations** — migrate assets, audit logs, incidents, findings, maintenance, changes, notifications, and dashboard queries.
4. **Monitoring worker** — migrate target claiming, result persistence, retention, aggregation, and worker lifecycle.
5. **Seed, deployment, and CI** — migrate seed behavior, Docker Compose, health checks, tests, and deployment documentation.
6. **Removal** — remove Drizzle, PostgreSQL, SQL migration files, and PostgreSQL environment variables after all references are gone.

## Current status

Stage 1 is being implemented. Existing service modules still use Drizzle/PostgreSQL at this point; the application is not yet fully MongoDB-backed. Do not deploy this intermediate branch as a completed migration.
