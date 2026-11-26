# MongoDB compatibility

The application uses the existing `infrapilot` database and MongoDB replica set `rs0`.

MongoDB 8 connection, collection definitions, repositories, and index initialization live in `packages/database/src`.

No existing collections or documents are dropped or renamed. The `worker_statuses` collection stores independent worker heartbeats. PostgreSQL schema/driver code is isolated under `scripts/migration/postgres` and is retained only for the optional, idempotent one-time importer in `scripts/migrate-data.ts`.
