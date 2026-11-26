# MongoDB compatibility

The application uses the existing `infrapilot` database and MongoDB replica set `rs0`.

MongoDB 8 repository code, collection definitions, and index initialization remain in `src/db`. The shared package entry point is `packages/database/src/index.ts`.

No existing collections or documents are recreated or renamed. PostgreSQL migration code is retained only in `scripts/migrate-data.ts` for one-time legacy data preservation.
