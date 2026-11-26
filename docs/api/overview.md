# API overview

The API is served by Express at `http://localhost:4000/api/v1`.

Existing feature routes include:

- `/auth/*`
- `/users/*`
- `/assets/*`
- `/monitoring/*`
- `/incidents/*`
- `/changes/*`
- `/maintenance/*`
- `/notifications/*`
- `/dashboard/*`
- `/settings/*`
- `/audit/*`

The frontend proxies `/api/v1` through Next.js or calls `NEXT_PUBLIC_API_URL` directly. Backend liveness is available at `/health/live`; readiness (including MongoDB connectivity) is available at `/health/ready`. `/api/health` remains as a compatibility readiness endpoint and is proxied by the frontend.
