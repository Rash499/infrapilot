# InfraPilot

InfraPilot is a three-process infrastructure operations application:

- `apps/frontend`: Next.js 16 / React 19 UI
- `apps/backend`: Express REST API at `/api/v1`
- `apps/worker`: independent MongoDB monitoring worker
- `packages/database`: shared MongoDB connection and repository entry point
- `packages/server-core`: existing route and service dispatcher
- `packages/contracts`: shared API contracts

The application data layer is MongoDB. PostgreSQL and Drizzle packages remain only as migration-tool dependencies for `scripts/migrate-data.ts`; they are not used by runtime application services.

## Local development

1. Copy `.env.example` to `.env` and configure MongoDB and JWT secrets.
2. Install dependencies:

   ```powershell
   npm install
   ```

3. Start each process in a separate terminal:

   ```powershell
   npm run dev:backend
   npm run dev:worker
   npm run dev:frontend
   ```

The frontend uses `http://localhost:3000`, the backend uses `http://localhost:4000`, and the API proxy is `/api/v1`.

## Commands

```powershell
npm test
npm run typecheck
npm run build
npm run lint
npm run dev:backend
npm run dev:worker
npm run dev:frontend
npm run db:init:mongo
npm run db:seed:mongo
```

Docker Compose remains optional. It can run MongoDB, backend, frontend, and worker:

```powershell
docker compose up --build
```
