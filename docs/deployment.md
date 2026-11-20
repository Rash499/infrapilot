# InfraPilot — Deployment guide

This guide covers local development, Docker Compose on a single host, CI, and the production checklist.
Items marked **requires real-world validation** must be verified in your environment before go-live.

## 1. Local development (without Docker)

Prerequisites: Node.js 22+, PostgreSQL 16 reachable at `DATABASE_URL`.

```bash
cp .env.example .env            # set DATABASE_URL, JWT_ACCESS_SECRET (openssl rand -base64 48)
npm ci
npx drizzle-kit migrate         # apply migrations in ./drizzle
SEED_PASSWORD='choose-a-strong-dev-password' npx tsx src/db/seed.ts   # optional demo data
npm run dev                     # http://localhost:3000 (scheduler runs in-process)
```

Run the monitoring worker as a separate process (recommended when the web server runs in dev mode):

```bash
INFRAPILOT_EMBEDDED_WORKER=false npx tsx src/workers/run.ts
```

## 2. Docker Compose

```bash
cp .env.example .env
# edit .env: POSTGRES_PASSWORD, JWT_ACCESS_SECRET, APP_ORIGIN (public URL), EXPOSE_RESET_TOKEN=false
docker compose up -d --build
docker compose ps                 # db, app and worker should become healthy
curl -fsS http://localhost:3000/api/health
```

Services:

| Service | Role | Notes |
| --- | --- | --- |
| `db` | PostgreSQL 16 (Alpine) | Named volume `pgdata` persists data across restarts; bound to 127.0.0.1 |
| `app` | Next.js production server | Runs `drizzle-kit migrate` on start; health check on `/api/health` |
| `worker` | Monitoring scheduler | Same image, `INFRAPILOT_EMBEDDED_WORKER=false`; safe to scale horizontally because targets are claimed atomically |

Seed demo data once (dev/staging only):

```bash
docker compose exec app npx tsx src/db/seed.ts
```

Backup and restore:

```bash
docker compose exec -T db pg_dump -U postgres app_db | gzip > infrapilot-$(date +%F).sql.gz
gunzip -c infrapilot-YYYY-MM-DD.sql.gz | docker compose exec -T db psql -U postgres app_db
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
- [ ] `POSTGRES_PASSWORD` is unique; database port is not exposed publicly.
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
- Database: monitoring results grow quickly. Retention is controlled by `MONITOR_RETENTION_DAYS`; index
  `(target_id, checked_at)` supports range queries. Consider table partitioning for very large fleets.

## 6. Continuous integration

`.github/workflows/ci.yml` runs on every push to `main` and on pull requests:

1. `npm ci`
2. `npm run lint`
3. `npx next typegen` and `npx tsc --noEmit`
4. `npx vitest run` (unit, component and probe tests)
5. `npm run build`
6. End-to-end job: migrate, seed, build, `npx playwright test` against a PostgreSQL service container.

## 7. Upgrades

1. Back up the database.
2. Pull the new revision and rebuild: `docker compose up -d --build`.
3. The `app` container applies pending migrations before starting. Review generated SQL in `drizzle/` first.
