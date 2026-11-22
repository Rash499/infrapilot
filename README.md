# InfraPilot

InfraPilot is a modular infrastructure operations platform built with Next.js, React, TypeScript, and a database-backed REST API. Its application areas cover infrastructure assets, service monitoring, security findings, incidents, maintenance, change management, notifications, and audit history.

> **Migration status:** The MongoDB migration is in progress. The current codebase still contains PostgreSQL/Drizzle-backed services and a PostgreSQL monitoring worker. Do not treat the MongoDB connection and collection bootstrap as proof that all application data has migrated. PostgreSQL remains required until the service and worker migration is complete.

## Technology

- Next.js App Router and React
- TypeScript
- Tailwind CSS
- Zod validation
- MongoDB Node.js driver (target datastore)
- PostgreSQL and Drizzle (temporary compatibility layer during migration)
- Vitest and Playwright

## Local development

1. Install Node.js 22 or later.
2. Install dependencies:

   ```bash
   npm install
   ```

3. Copy the environment template:

   ```bash
   cp .env.example .env
   ```

4. Configure the environment variables. During the staged migration, both MongoDB and PostgreSQL settings are required by different parts of the application.
5. Start the development server:

   ```bash
   npm run dev
   ```

## Useful commands

```bash
npm run lint
npm run typecheck
npm test
npm run test:watch
npm run test:e2e
npm run build
npm run db:check:mongo
npm run db:init
```

The MongoDB check and initialization commands verify connectivity and ensure indexes/collections without dropping existing data. The local MongoDB instance should be configured as a replica set named `rs0` for transaction support.

## Database migration principles

- Preserve public API contracts and UUID-based identifiers.
- Use a least-privilege MongoDB application user scoped to the `infrapilot` database.
- Keep MongoDB initialization idempotent and non-destructive.
- Migrate each service and worker before removing PostgreSQL/Drizzle dependencies.
- Validate authentication, authorization, transactions, monitoring job claiming, and data integrity before deployment.

## Documentation

See `docs/` for architecture, API, deployment, implementation, and migration notes. The MongoDB migration checklist is maintained in [docs/mongodb-migration-status.md](docs/mongodb-migration-status.md).
