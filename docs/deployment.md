# InfraPilot — Deployment guide

This guide covers local development, Docker Compose on a single host, CI, and the production checklist.
Items marked **requires real-world validation** must be verified in your environment before go-live.

## 1. Local development

Prerequisites: Node.js 22+ and a MongoDB 8 replica set reachable at `MONGODB_URI`.
For a local replica set, the Compose setup in the next section also creates the least-privilege app user.

```bash
cp .env.example .env            # set MongoDB credentials, MONGODB_URI and JWT_ACCESS_SECRET
npm ci
npm run db:init:mongo
SEED_PASSWORD='choose-a-strong-dev-password' npm run db:seed:mongo
npm run dev                     # http://localhost:3000 (scheduler runs in-process)
```

For an existing PostgreSQL installation, import its data before switching the application to MongoDB.
Set `DATABASE_URL` temporarily and use `scripts/migrate-data.ts`; it supports `--dry-run` and does not
delete or modify the source database.

Run the monitoring worker as a separate process (recommended when the web server runs in dev mode):

```bash
INFRAPILOT_EMBEDDED_WORKER=false npx tsx src/workers/run.ts
```

## 2. Docker Compose

```bash
cp .env.example .env
# edit .env: generate unique root/app passwords with `openssl rand -hex 32`, a replica key with
# `openssl rand -base64 756`, and set JWT_ACCESS_SECRET, APP_ORIGIN and EXPOSE_RESET_TOKEN=false.
# Keep MONGODB_URI's app password in sync with MONGO_APP_PASSWORD.
docker compose up -d --build
docker compose ps                 # mongo, mongo-init, app and worker should become healthy
curl -fsS http://localhost:3000/api/health
```

Services:

| Service | Role | Notes |
| --- | --- | --- |
| `mongo` | MongoDB 8.0 single-node `rs0` replica set | Named volume `mongodata`; database port bound to 127.0.0.1; keyfile is generated inside the container |
| `mongo-init` | Replica-set and application bootstrap | Creates the app user with `readWrite` access to the configured database and idempotently ensures collections/indexes |
| `app` | Next.js production server | Starts after database bootstrap; health check on `/api/health` |
| `worker` | Monitoring scheduler | Same image, `INFRAPILOT_EMBEDDED_WORKER=false`; targets are claimed atomically |

Create a seed administrator once (dev/staging only; does not overwrite existing users):

```bash
SEED_PASSWORD='choose-a-strong-password' npm run db:seed:mongo
```

Backup and restore:

```bash
docker compose exec -T mongo sh -c 'mongodump --username "$MONGO_INITDB_ROOT_USERNAME" --password "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin --db "$MONGODB_DB" --archive' | gzip > infrapilot-$(date +%F).archive.gz
gunzip -c infrapilot-YYYY-MM-DD.archive.gz | docker compose exec -T mongo sh -c 'mongorestore --username "$MONGO_INITDB_ROOT_USERNAME" --password "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin --archive'
```

## 3. Reverse proxy and TLS (production)

Place a TLS-terminating proxy (Caddy, nginx, Traefik or a cloud load balancer) in front of port 3000:

- Terminate HTTPS and forward `Host` and `X-Forwarded-For`.
- Set `APP_ORIGIN=https://infrapilot.example.com`. Cross-origin mutations are refused unless the origin matches.
- Set `TRUST_PROXY_HEADERS=true` **only** if the proxy overwrites `X-Forwarded-For`, otherwise clients can spoof
  their address and bypass rate limits.
- The refresh cookie is `Secure` in production; the application must be served over HTTPS.

Example Caddyfile:

```
infrapilot.example.com {
  encode gzip
  reverse_proxy app:3000
}
```

## 4. Production checklist

- [ ] `JWT_ACCESS_SECRET` is at least 32 random characters, stored in a secret manager, not in the repository.
- [ ] MongoDB root/app passwords and replica-set key are unique, stored in a secret manager, and not committed.
- [ ] The application uses only the database-scoped `readWrite` user; MongoDB port is not exposed publicly.
- [ ] `EXPOSE_RESET_TOKEN=false`. Configure a real mail transport (`setMailTransport` in `src/lib/mailer.ts`)
      **requires real-world validation** before users depend on password reset.
- [ ] HTTPS is enforced at the proxy; HSTS header is emitted by the application in production.
- [ ] `APP_ORIGIN` matches the public origin.
- [ ] Backups scheduled and restore tested. **requires real-world validation**.
- [ ] Monitoring checks configured only for destinations you own or are authorised to probe.
- [ ] Log shipping configured for stdout/stderr JSON logs.
- [ ] Multi-instance deployments: replace the in-memory rate limiter with a shared store
      (**requires implementation**). Keep `worker` replicas as needed.

## 5. Scaling notes

- Web tier: stateless; scale horizontally behind the proxy (rate limiter is per instance, see limitations).
- Worker tier: scale replicas; `MONITOR_BATCH_SIZE` and `MONITOR_MAX_CONCURRENCY` bound per-process load.
- Database: monitoring results grow quickly. Retention is controlled by `MONITOR_RETENTION_DAYS`; MongoDB
  indexes support target/time queries. Consider a sharded or external time-series strategy for very large fleets.

## 6. Continuous integration

`.github/workflows/ci.yml` runs on every push to `main` and on pull requests:

1. `npm ci`
2. `npm run lint`
3. `npx next typegen` and `npx tsc --noEmit`
4. `npm test` (unit, component and probe tests)
5. `npm run build`
6. End-to-end job: start a MongoDB `rs0` replica set, bootstrap collections, seed, build, and run `npm run test:e2e`.

## 7. Upgrades

1. Back up the database and verify the restore procedure.
2. Pull the new revision and rebuild: `docker compose up -d --build`.
3. `mongo-init` idempotently ensures collections, indexes, and counters; startup does not drop data.
