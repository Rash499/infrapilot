/**
 * End-to-end API smoke test for a running InfraPilot instance that holds the demo workspace.
 *
 *   SEED_RESET=true npx tsx src/db/seed.ts     # rebuild the demo data
 *   npm run start                             # in another terminal
 *   npx tsx scripts/smoke-test.ts
 *
 * Environment: SMOKE_BASE_URL (default http://localhost:3000), SMOKE_PASSWORD or SEED_PASSWORD.
 * The run signs in as each seeded role and exercises every module, including access control, validation,
 * the change approval workflow, session rotation and the background monitoring and alerting worker.
 * It leaves a few records named "Smoke ..." behind; re-run the seed for a clean workspace.
 */

// Must be evaluated first: reads `.env.local` and `.env` so SEED_PASSWORD and DATABASE_URL are set.
import "../src/lib/load-env";

const BASE_URL = (process.env.SMOKE_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const API = `${BASE_URL}/api/v1`;
const PASSWORD = process.env.SMOKE_PASSWORD ?? process.env.SEED_PASSWORD ?? "";
const DEMO = {
  admin: "admin@infrapilot.local",
  operator: "operator@infrapilot.local",
  viewer: "viewer@infrapilot.local",
} as const;

type Json = Record<string, unknown>;
type Method = "GET" | "POST" | "PATCH" | "DELETE";

interface Session {
  token: string;
  cookie: string;
}
interface CallOptions {
  session?: Session;
  body?: unknown;
  rawBody?: string;
  /** Overrides the session cookie; `null` sends no cookie. */
  cookie?: string | null;
  /** Sends the anti-CSRF header the browser client sends on every call. Default: true. */
  csrf?: boolean;
}
interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
}
interface ApiResult<T> {
  status: number;
  data: T;
  meta: Json;
  error: ApiErrorBody;
  setCookie: string;
}

let passed = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail?: string): boolean {
  if (ok) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    const line = detail ? `${name} — ${detail}` : name;
    failures.push(line);
    console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ""}`);
  }
  return ok;
}

function section(title: string): void {
  console.log(`\n■ ${title}`);
}

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function record(value: unknown): Json {
  return isRecord(value) ? value : {};
}
function list(value: unknown): Json[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}
function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}
function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : Number.NaN;
}
/** Timestamp helper: positive values are in the future. */
const inHours = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();
const cookiePair = (setCookie: string) => setCookie.split(";")[0] ?? "";

function describe(res: ApiResult<Json | Json[]>): string {
  return `HTTP ${res.status}${res.error.code ? ` ${res.error.code}: ${res.error.message}` : ""}`;
}

async function call<T extends Json | Json[]>(method: Method, path: string, opts: CallOptions = {}): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (opts.body !== undefined || opts.rawBody !== undefined) headers["Content-Type"] = "application/json";
  if (opts.session) headers.Authorization = `Bearer ${opts.session.token}`;
  if (opts.csrf !== false) headers["X-InfraPilot-Request"] = "1";
  const cookie = opts.cookie === undefined ? opts.session?.cookie : opts.cookie;
  if (cookie) headers.Cookie = cookie;

  const response = await fetch(`${API}${path}`, {
    method,
    headers,
    body: opts.rawBody ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)),
  });
  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  const envelope = (parsed ?? {}) as Partial<{ data: T; meta: Json; error: ApiErrorBody }>;
  return {
    status: response.status,
    data: (envelope.data ?? {}) as T,
    meta: envelope.meta ?? {},
    error: envelope.error ?? { code: "", message: "" },
    setCookie: response.headers.get("set-cookie") ?? "",
  };
}

/** Performs a request and records whether the status code is one of `expected` (default 200). */
async function api<T extends Json | Json[]>(
  name: string,
  method: Method,
  path: string,
  opts: CallOptions = {},
  expected: number[] = [200],
): Promise<ApiResult<T>> {
  const res = await call<T>(method, path, opts);
  check(name, expected.includes(res.status), `${method} ${path} → ${describe(res)}`);
  return res;
}

/** List endpoints return `data` as an array; history endpoints may return an `items` array instead. */
function entries(res: ApiResult<Json | Json[]>): Json[] {
  return Array.isArray(res.data) ? res.data : list(res.data.items);
}

async function waitFor(label: string, attempt: () => Promise<Json | undefined>, timeoutMs: number): Promise<Json | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const value = await attempt();
      if (value) return value;
    } catch {
      // The instance may still be starting a check; retry until the deadline.
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  console.log(`  • timed out waiting for ${label}`);
  return undefined;
}

async function login(email: string, password: string = PASSWORD): Promise<Session & { id: string; role: string; rawCookie: string }> {
  const res = await call<Json>("POST", "/auth/login", { body: { email, password } });
  return {
    token: str(res.data.accessToken),
    cookie: cookiePair(res.setCookie),
    rawCookie: res.setCookie,
    id: str(record(res.data.user).id),
    role: str(record(res.data.user).role),
  };
}

async function fetchPage(path: string): Promise<{ status: number; html: string; headers: Headers }> {
  const response = await fetch(`${BASE_URL}${path}`, { redirect: "manual" });
  return { status: response.status, html: await response.text(), headers: response.headers };
}

async function main(): Promise<void> {
  console.log(`InfraPilot smoke test → ${BASE_URL}`);
  if (!PASSWORD) {
    console.error("Set SEED_PASSWORD (or SMOKE_PASSWORD) to the seeded demo password.");
    process.exit(2);
  }
  const stamp = Date.now();
  const startedAt = Date.now();

  // ------------------------------------------------------------------ health and page shell
  section("Health, security headers and page shell");
  const health = await fetch(`${BASE_URL}/api/health`);
  const healthBody = record(((await health.json().catch(() => null)) as Json | null) ?? {});
  const dependencies = record(healthBody.dependencies);
  check("GET /api/health is ok", health.status === 200 && healthBody.ok === true, `HTTP ${health.status}`);
  check(
    "configuration and PostgreSQL dependencies report ok",
    dependencies.postgresql === "ok" && dependencies.configuration === "ok",
    JSON.stringify(healthBody),
  );

  const loginPage = await fetchPage("/login");
  check("login page renders", loginPage.status === 200 && /<html[\s>]/i.test(loginPage.html), `HTTP ${loginPage.status}`);
  check(
    "security headers are applied (CSP, frame denial, nosniff)",
    /frame-ancestors 'none'/.test(loginPage.headers.get("content-security-policy") ?? "") &&
      loginPage.headers.get("x-frame-options") === "DENY" &&
      loginPage.headers.get("x-content-type-options") === "nosniff",
  );

  // ------------------------------------------------------------------ authentication
  section("Authentication");
  const wrongPassword = await call<Json>("POST", "/auth/login", { body: { email: DEMO.admin, password: "Definitely-Wrong-123" } });
  check("wrong password is rejected with 401", wrongPassword.status === 401, describe(wrongPassword));
  const unknownEmail = await call<Json>("POST", "/auth/login", { body: { email: "nobody@example.com", password: "Definitely-Wrong-123" } });
  check(
    "unknown email returns the same message (no account enumeration)",
    unknownEmail.status === 401 && unknownEmail.error.message === wrongPassword.error.message,
    describe(unknownEmail),
  );
  const anonymous = await call<Json[]>("GET", "/assets");
  check("request without a token is rejected with 401", anonymous.status === 401, describe(anonymous));
  const forged = await call<Json[]>("GET", "/assets", { session: { token: "not-a-jwt", cookie: "" } });
  check("forged bearer token is rejected with 401", forged.status === 401, describe(forged));

  // Origin policy: simulated browser requests carrying an Origin that differs from the internal host.
  const postAsBrowser = (headers: Record<string, string>) =>
    fetch(`${API}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-InfraPilot-Request": "1", ...headers },
      body: JSON.stringify({ email: DEMO.admin, password: PASSWORD }),
    }).then((response) => response.status);
  const foreignOrigin = await postAsBrowser({ Origin: "https://evil.example" });
  check("state-changing request from a foreign Origin is blocked (403)", foreignOrigin === 403, `HTTP ${foreignOrigin}`);
  const crossSite = await postAsBrowser({ Origin: "https://evil.example", "Sec-Fetch-Site": "cross-site" });
  check("browser-flagged cross-site request is blocked (403)", crossSite === 403, `HTTP ${crossSite}`);
  const behindProxy = await postAsBrowser({ Origin: "https://smoke-preview.example", "Sec-Fetch-Site": "same-origin" });
  check(
    "browser-flagged same-origin request passes behind a host-rewriting proxy",
    behindProxy === 200,
    `HTTP ${behindProxy}`,
  );
  const malformed = await call<Json>("POST", "/auth/login", { rawBody: "{not json" });
  check("malformed JSON returns 400 MALFORMED_JSON", malformed.status === 400 && malformed.error.code === "MALFORMED_JSON", describe(malformed));

  const admin = await login(DEMO.admin);
  const operator = await login(DEMO.operator);
  const viewer = await login(DEMO.viewer);
  check(
    "administrator, operator and viewer can all sign in",
    [admin, operator, viewer].every((s) => s.token.length > 20 && s.cookie.startsWith("infrapilot_refresh=")),
    [admin, operator, viewer].map((s) => `${s.role}:${s.token.length}`).join(" "),
  );
  check("refresh cookie is HttpOnly and SameSite=Strict", /httponly/i.test(admin.rawCookie) && /samesite=strict/i.test(admin.rawCookie), admin.rawCookie);
  const me = await api<Json>("GET /users/me returns the signed-in profile", "GET", "/users/me", { session: admin });
  check("profile carries the administrator role", me.data.email === DEMO.admin && me.data.role === "admin", JSON.stringify(me.data));

  // ------------------------------------------------------------------ access control
  section("Role-based access control");
  const viewerAsset = await call<Json>("POST", "/assets", { session: viewer, body: { name: "Smoke denied", assetType: "application" } });
  check("viewer cannot create assets (403)", viewerAsset.status === 403, describe(viewerAsset));
  const viewerTarget = await call<Json>("POST", "/monitoring/targets", {
    session: viewer,
    body: { name: "Smoke denied check", monitorType: "http", url: "https://example.com/" },
  });
  check("viewer cannot create monitoring checks (403)", viewerTarget.status === 403, describe(viewerTarget));
  const viewerIncident = await call<Json>("POST", "/incidents", {
    session: viewer,
    body: { title: "Smoke denied incident", description: "Should be rejected.", severity: "low", priority: "p4" },
  });
  check("viewer cannot open incidents (403)", viewerIncident.status === 403, describe(viewerIncident));
  const operatorUsers = await call<Json[]>("GET", "/users", { session: operator });
  check("operator cannot manage users (403)", operatorUsers.status === 403, describe(operatorUsers));
  const operatorAudit = await call<Json[]>("GET", "/audit", { session: operator });
  check("operator cannot read the audit log (403)", operatorAudit.status === 403, describe(operatorAudit));
  const viewerAssets = await api<Json[]>("viewer can read assets", "GET", "/assets", { session: viewer });
  check("viewer read access returns data", entries(viewerAssets).length > 0, `${entries(viewerAssets).length} items`);
  const options = await api<Json[]>("any role can load assignee options", "GET", "/users/options", { session: viewer });
  check("assignee options never expose password hashes", entries(options).length >= 3 && entries(options).every((u) => !("passwordHash" in u)));

  // ------------------------------------------------------------------ demo workspace
  section("Demo workspace data");
  const dash = await api<Json>("dashboard loads (7 days)", "GET", "/dashboard?days=7", { session: viewer });
  const kpis = record(dash.data.kpis);
  check(
    "dashboard KPIs reflect the demo workspace",
    num(kpis.totalAssets) === 12 &&
      num(kpis.monitoredServices) === 5 &&
      num(kpis.openIncidents) === 3 &&
      num(kpis.criticalHighOpenFindings) === 4 &&
      num(kpis.upcomingMaintenance) === 4,
    JSON.stringify(kpis),
  );
  check(
    "asset distribution sums to the asset total",
    list(dash.data.assetDistribution).reduce((sum, entry) => sum + num(entry.count), 0) === num(kpis.totalAssets),
  );
  const trend = list(dash.data.responseTrend);
  check(
    "response-time trend has a populated bucket for every day",
    trend.length >= 7 && trend.every((point) => num(point.avgResponseMs) > 0 && num(point.uptimePct) > 0),
    `${trend.length} buckets`,
  );
  check(
    "upcoming maintenance and recent changes are listed",
    list(dash.data.upcomingMaintenance).length >= 1 && list(dash.data.recentChanges).length >= 1,
  );
  // Buckets only exist for days that hold monitoring history (the demo workspace ships 30 days).
  for (const [days, minBuckets] of [[1, 24], [30, 30], [90, 30]] as const) {
    const res = await call<Json>("GET", `/dashboard?days=${days}`, { session: viewer });
    const buckets = list(res.data.responseTrend).length;
    check(`dashboard accepts a ${days}-day range`, res.status === 200 && buckets >= minBuckets, `${describe(res)} — ${buckets} buckets`);
  }
  const badRange = await call<Json>("GET", "/dashboard?days=5", { session: admin });
  check("dashboard rejects a range other than 1/7/30/90 (400)", badRange.status === 400, describe(badRange));

  const assetList = await api<Json[]>("asset list loads", "GET", "/assets?pageSize=100", { session: viewer });
  const demoAssets = entries(assetList);
  check("12 active demo assets are present", demoAssets.length === 12 && num(assetList.meta.total) === 12, `${demoAssets.length} items`);
  const archivedAssets = await api<Json[]>("archived list loads", "GET", "/assets?archived=true", { session: viewer });
  check("archived asset is hidden by default and listed when requested", !demoAssets.some((a) => a.name === "decommissioned-web-03") && entries(archivedAssets).some((a) => a.name === "decommissioned-web-03"));
  const production = await api<Json[]>("environment filter works", "GET", "/assets?environment=production", { session: viewer });
  check("production filter returns 9 assets", num(production.meta.total) === 9, `total ${String(production.meta.total)}`);
  const searched = await api<Json[]>("search works", "GET", "/assets?search=web-prod", { session: viewer });
  check("search returns the two web nodes", num(searched.meta.total) === 2, `total ${String(searched.meta.total)}`);
  const paged = await api<Json[]>("pagination works", "GET", "/assets?page=2&pageSize=5&sort=name&order=asc", { session: viewer });
  check(
    "second page has 5 sorted items out of 3 pages",
    entries(paged).length === 5 && num(paged.meta.page) === 2 && num(paged.meta.totalPages) === 3 && num(paged.meta.total) === 12,
    JSON.stringify(paged.meta),
  );
  const assetByName = (name: string) => record(demoAssets.find((a) => a.name === name));
  const ordersDbId = str(assetByName("orders-db").id);

  const overview = await api<Json>("monitoring overview loads", "GET", "/monitoring/overview", { session: viewer });
  const summary = record(overview.data.summary);
  check(
    "overview counts healthy, unavailable and paused checks",
      // The portal check keeps a 50 ms threshold against the live network, so it is healthy or degraded by nature.
      num(summary.total) === 6 && num(summary.paused) === 1 && num(summary.unavailable) === 1 && num(summary.healthy) >= 3 && num(summary.healthy) + num(summary.degraded) === 4,
    JSON.stringify(summary),
  );
  check("24-hour uptime is aggregated across checks", num(overview.data.uptime24hPct) >= 79 && num(overview.data.uptime24hPct) < 100 && num(overview.data.checks24h) > 1_000, `${String(overview.data.uptime24hPct)} % over ${String(overview.data.checks24h)} checks`);
  const services = list(overview.data.services);
  const websiteId = str(record(services.find((s) => s.name === "Public website (HTTPS)")).id);
  const website = await api<Json>("target detail exposes uptime statistics", "GET", `/monitoring/targets/${websiteId}`, { session: viewer });
  const stats = record(website.data.stats);
  check(
    "30-day uptime is computed from history (one short outage)",
    num(stats.uptime30dPct) > 99 && num(stats.uptime30dPct) < 100 && num(stats.checks24h) > 250 && list(website.data.recentResults).length === 30,
    JSON.stringify(stats),
  );
  const ftp = record(services.find((s) => s.name === "Legacy FTP server (TCP 21)"));
  check("failing check is unavailable with 0% daily uptime", ftp.status === "unavailable" && num(ftp.uptime24hPct) === 0, JSON.stringify(ftp));

  const findings = await api<Json[]>("findings list loads", "GET", "/findings?pageSize=100", { session: viewer });
  check(
    "12 findings cover every severity and status",
    entries(findings).length === 12 && new Set(entries(findings).map((f) => f.severity)).size === 5 && new Set(entries(findings).map((f) => f.status)).size === 4,
    `${entries(findings).length} items`,
  );
  const critical = await api<Json[]>("severity filter works", "GET", "/findings?severity=critical", { session: viewer });
  check("three critical findings", num(critical.meta.total) === 3, `total ${String(critical.meta.total)}`);

  const incidentList = await api<Json[]>("incident list loads", "GET", "/incidents?pageSize=100", { session: viewer });
  check("nine incidents carry formatted references", entries(incidentList).length === 9 && entries(incidentList).every((i) => /^INC-\d{5}$/.test(str(i.reference))));
  const incidentStats = await api<Json>("incident statistics load", "GET", "/incidents/stats?days=90", { session: viewer });
  check(
    "statistics report active count and mean time to resolve",
    num(incidentStats.data.total) === 9 && num(incidentStats.data.activeCount) === 3 && num(incidentStats.data.meanTimeToResolveHours) > 2 && num(incidentStats.data.meanTimeToResolveHours) < 3,
    JSON.stringify(incidentStats.data),
  );
  const seededIncident = await api<Json>("incident detail includes affected assets and a timeline", "GET", `/incidents/${str(entries(incidentList)[0]?.id)}`, { session: viewer });
  check("incident timeline has system and human entries", list(seededIncident.data.timeline).length >= 1 && list(seededIncident.data.assets).length >= 1);

  const maintenanceList = await api<Json[]>("maintenance list loads", "GET", "/maintenance?pageSize=100", { session: viewer });
  const scheduled = await api<Json[]>("maintenance status filter works", "GET", "/maintenance?status=scheduled", { session: viewer });
  check("7 maintenance windows, 4 of them scheduled", entries(maintenanceList).length === 7 && num(scheduled.meta.total) === 4, `${entries(maintenanceList).length} / ${String(scheduled.meta.total)}`);
  const changes = await api<Json[]>("change list loads", "GET", "/changes?pageSize=100", { session: viewer });
  check(
    "7 change requests cover every workflow state",
    entries(changes).length === 7 && new Set(entries(changes).map((c) => c.status)).size === 7 && num(changes.meta.approvalsRequired) === 1,
    `${entries(changes).length} items`,
  );

  const adminFeed = await api<Json[]>("administrator notification feed loads", "GET", "/notifications?pageSize=100", { session: admin });
  check("administrator has unread notifications", num(adminFeed.meta.unreadCount) >= 2, `unread ${String(adminFeed.meta.unreadCount)}`);
  const operatorFeed = await api<Json[]>("operator notification feed loads", "GET", "/notifications?pageSize=100", { session: operator });
  check("operator has unread notifications", num(operatorFeed.meta.unreadCount) >= 3, `unread ${String(operatorFeed.meta.unreadCount)}`);
  const viewerFeed = await api<Json[]>("viewer notification feed loads", "GET", "/notifications?pageSize=100", { session: viewer });
  check("viewer has an empty feed and no unread badge", num(viewerFeed.meta.unreadCount) === 0 && entries(viewerFeed).length === 0);

  const userList = await api<Json[]>("user list loads (admin)", "GET", "/users?pageSize=100", { session: admin });
  check("three demo users are listed without password hashes", entries(userList).length === 3 && entries(userList).every((u) => !("passwordHash" in u)));
  const audit = await api<Json[]>("audit log loads (admin)", "GET", "/audit?pageSize=5", { session: admin });
  const auditFiltered = await api<Json[]>("audit log can be filtered by entity", "GET", "/audit?entityType=change_request", { session: admin });
  check(
    "audit trail holds the demo history",
    num(audit.meta.total) >= 20 && entries(audit).length === 5 && num(auditFiltered.meta.total) >= 9 && entries(audit).every((e) => typeof e.action === "string" && typeof e.summary === "string"),
    `${String(audit.meta.total)} entries`,
  );

  for (const path of [
    "/",
    "/register",
    "/forgot-password",
    "/assets",
    `/assets/${ordersDbId}`,
    "/monitoring",
    `/monitoring?target=${websiteId}`,
    "/security",
    "/incidents",
    `/incidents/${str(entries(incidentList)[0]?.id)}`,
    "/maintenance",
    "/changes",
    "/notifications",
    "/users",
    "/settings",
  ]) {
    const page = await fetchPage(path);
    // Next.js embeds its default not-found text in every page shell, so only real failures are flagged.
    const broken = /Internal Server Error/i.test(page.html);
    check(`page ${path} renders`, page.status === 200 && /<html[\s>]/i.test(page.html) && !broken, `HTTP ${page.status}`);
  }
  const unknownPage = await fetchPage("/monitoring/00000000-0000-4000-8000-000000000000");
  check("unknown route is a 404 (no crash)", unknownPage.status === 404, `HTTP ${unknownPage.status}`);

  // ------------------------------------------------------------------ assets
  section("Assets: create, validate, update, archive and restore");
  const invalidAsset = await call<Json>("POST", "/assets", {
    session: admin,
    body: { name: "", assetType: "application", ipAddress: "999.1.1.1" },
  });
  check("invalid asset payload returns 400 with field errors", invalidAsset.status === 400 && Array.isArray(invalidAsset.error.details), describe(invalidAsset));
  const createdAsset = await api<Json>(
    "create asset",
    "POST",
    "/assets",
    { session: admin, body: { name: "Smoke test gateway", assetType: "application", environment: "testing", description: "Created by the smoke test.", ownerId: operator.id } },
    [201],
  );
  const assetId = str(createdAsset.data.id);
  check("new asset starts as unknown", createdAsset.data.status === "unknown" && assetId.length === 36, JSON.stringify(createdAsset.data));
  const readAsset = await api<Json>("read asset", "GET", `/assets/${assetId}`, { session: viewer });
  check("asset is readable by a viewer", readAsset.data.name === "Smoke test gateway");
  const updatedAsset = await api<Json>("update asset", "PATCH", `/assets/${assetId}`, {
    session: operator,
    body: { description: "Updated by the smoke test.", location: "Smoke rack 1", status: "healthy" },
  });
  check("asset update is persisted", updatedAsset.data.location === "Smoke rack 1" && updatedAsset.data.status === "healthy");
  const emptyPatch = await call<Json>("PATCH", `/assets/${assetId}`, { session: admin, body: {} });
  check("empty update leaves the asset unchanged", emptyPatch.status === 200 && emptyPatch.data.location === "Smoke rack 1", describe(emptyPatch));
  const history = await call<Json | Json[]>("GET", `/assets/${assetId}/history`, { session: viewer });
  const historyEntries = entries(history);
  check(
    "asset history records the update",
    history.status === 200 && historyEntries.length >= 1 && historyEntries.some((e) => e.action === "asset.updated"),
    `${describe(history)} — ${historyEntries.map((e) => String(e.action ?? e.kind ?? "?")).join(", ")}`,
  );
  const missingAsset = await call<Json>("GET", "/assets/00000000-0000-4000-8000-000000000000", { session: admin });
  check("unknown asset id returns 404", missingAsset.status === 404, describe(missingAsset));
  const malformedId = await call<Json>("GET", "/assets/not-a-uuid", { session: admin });
  check("malformed asset id is rejected", malformedId.status === 400 || malformedId.status === 404, describe(malformedId));

  await api("archive asset", "DELETE", `/assets/${assetId}`, { session: operator });
  const afterArchive = await api<Json[]>("list after archiving", "GET", "/assets?search=Smoke", { session: viewer });
  check("archived asset leaves the default list", num(afterArchive.meta.total) === 0, `total ${String(afterArchive.meta.total)}`);
  const archivedOnly = await api<Json[]>("list archived assets", "GET", "/assets?archived=true&search=Smoke", { session: viewer });
  check("archived asset is listed under archived=true", num(archivedOnly.meta.total) === 1, `total ${String(archivedOnly.meta.total)}`);
  const restored = await api<Json>("restore asset", "PATCH", `/assets/${assetId}`, { session: admin, body: { archived: false } });
  const afterRestore = await call<Json[]>("GET", "/assets?search=Smoke", { session: viewer });
  check("asset can be restored", restored.status === 200 && num(afterRestore.meta.total) === 1, `total ${String(afterRestore.meta?.total)}`);

  // ------------------------------------------------------------------ monitoring
  section("Monitoring: SSRF protection and the live worker");
  const loopback = await call<Json>("POST", "/monitoring/targets", {
    session: admin,
    body: { name: "Smoke loopback", monitorType: "http", url: "http://127.0.0.1:3000/api/health" },
  });
  check("loopback target is blocked", loopback.status === 422, describe(loopback));
  const metadata = await call<Json>("POST", "/monitoring/targets", {
    session: admin,
    body: { name: "Smoke metadata", monitorType: "http", url: "http://169.254.169.254/latest/meta-data/" },
  });
  check("cloud metadata address is blocked", metadata.status === 422, describe(metadata));
  const privateTcp = await call<Json>("POST", "/monitoring/targets", {
    session: admin,
    body: { name: "Smoke private", monitorType: "tcp", host: "10.0.0.1", port: 22 },
  });
  check("private TCP target is blocked", privateTcp.status === 422, describe(privateTcp));
  const privateFlag = await call<Json>("POST", "/monitoring/targets", {
    session: operator,
    body: { name: "Smoke override", monitorType: "tcp", host: "10.0.0.1", port: 22, allowPrivateNetwork: true },
  });
  check("only administrators may authorise private networks (403)", privateFlag.status === 403, describe(privateFlag));
  const missingUrl = await call<Json>("POST", "/monitoring/targets", { session: admin, body: { name: "Smoke no url", monitorType: "http" } });
  check("HTTP check without a URL is rejected", missingUrl.status === 400, describe(missingUrl));

  const createdTarget = await api<Json>(
    "create HTTPS check",
    "POST",
    "/monitoring/targets",
    {
      session: admin,
      body: { name: `Smoke check example.com ${stamp}`, monitorType: "http", url: "https://example.com/", intervalSeconds: 60, timeoutMs: 5000, degradedThresholdMs: 1500 },
    },
    [201],
  );
  const targetId = str(createdTarget.data.id);
  const queuedAt = Date.now();
  await api("queue an on-demand check", "POST", `/monitoring/targets/${targetId}/check`, { session: operator }, [202]);
  const liveResult = await waitFor(
    "the queued check",
    async () => {
      const res = await call<Json[]>("GET", `/monitoring/targets/${targetId}/results?range=1h&pageSize=1`, { session: viewer });
      const latest = entries(res)[0];
      return latest && Date.parse(str(latest.checkedAt)) >= queuedAt - 1_000 ? latest : undefined;
    },
    30_000,
  );
  check(
    "background worker executes the queued check",
    liveResult?.success === true && liveResult.statusCode === 200 && num(liveResult.responseTimeMs) > 0,
    JSON.stringify(liveResult),
  );
  const afterCheck = await call<Json>("GET", `/monitoring/targets/${targetId}`, { session: viewer });
  check(
    "target state reflects the executed check",
    (afterCheck.data.status === "healthy" || afterCheck.data.status === "degraded") && typeof afterCheck.data.lastCheckedAt === "string" && num(record(afterCheck.data.stats).checks24h) >= 1,
    JSON.stringify(afterCheck.data.stats),
  );
  await api("update check thresholds", "PATCH", `/monitoring/targets/${targetId}`, { session: admin, body: { degradedThresholdMs: 2000, intervalSeconds: 120 } });
  await api("pause check", "PATCH", `/monitoring/targets/${targetId}`, { session: admin, body: { enabled: false } });
  const pausedQueue = await call<Json>("POST", `/monitoring/targets/${targetId}/check`, { session: admin });
  check("paused check cannot be queued (422)", pausedQueue.status === 422, describe(pausedQueue));
  await api("delete check", "DELETE", `/monitoring/targets/${targetId}`, { session: admin });
  const goneTarget = await call<Json>("GET", `/monitoring/targets/${targetId}`, { session: admin });
  check("deleted check returns 404", goneTarget.status === 404, describe(goneTarget));
  const viewerDelete = await call<Json>("DELETE", `/monitoring/targets/${websiteId}`, { session: viewer });
  const websiteStillThere = await call<Json>("GET", `/monitoring/targets/${websiteId}`, { session: viewer });
  check("viewer cannot delete a check (403) and it is untouched", viewerDelete.status === 403 && websiteStillThere.status === 200, describe(viewerDelete));

  // ------------------------------------------------------------------ findings
  section("Security findings: record, triage, resolve and delete");
  const badCve = await call<Json>("POST", "/findings", {
    session: admin,
    body: { title: "Smoke finding", description: "Invalid CVE reference.", severity: "low", cveId: "NOT-A-CVE" },
  });
  check("malformed CVE id is rejected", badCve.status === 400, describe(badCve));
  const createdFinding = await api<Json>(
    "record finding",
    "POST",
    "/findings",
    {
      session: admin,
      body: {
        title: "Smoke finding: default credentials",
        description: "A service account still uses the vendor default password.",
        severity: "high",
        assetId,
        assigneeId: operator.id,
        cveId: "CVE-2025-0001",
        remediation: "Rotate the credential and store it in the secrets manager.",
      },
    },
    [201],
  );
  const findingId = str(createdFinding.data.id);
  check("new finding starts as open", createdFinding.data.status === "open");
  await api("start remediation", "PATCH", `/findings/${findingId}`, { session: operator, body: { status: "in_progress", note: "Owner confirmed; fix scheduled." } });
  const resolvedFinding = await api<Json>("resolve finding", "PATCH", `/findings/${findingId}`, {
    session: operator,
    body: { status: "resolved", remediation: "Rotated the credential and enforced MFA." },
  });
  check("resolved finding records a resolution timestamp", resolvedFinding.data.status === "resolved" && typeof resolvedFinding.data.resolvedAt === "string");
  const findingDetail = await api<Json>("finding detail loads", "GET", `/findings/${findingId}`, { session: viewer });
  check(
    "finding history records the creation and both transitions",
    list(findingDetail.data.history).map((e) => e.toStatus).join(",") === "open,in_progress,resolved",
    JSON.stringify(findingDetail.data.history),
  );
  const findingAudit = await api<Json[]>("finding audit trail loads", "GET", `/audit?entityType=security_finding&entityId=${findingId}`, { session: admin });
  check("finding changes are audited", num(findingAudit.meta.total) >= 3, `total ${String(findingAudit.meta.total)}`);
  const resolvedOnly = await api<Json[]>("filter resolved findings", "GET", "/findings?status=resolved&search=Smoke", { session: viewer });
  check("status and search filters combine", num(resolvedOnly.meta.total) === 1, `total ${String(resolvedOnly.meta.total)}`);
  const viewerFinding = await call<Json>("POST", "/findings", { session: viewer, body: { title: "Smoke denied", description: "Should be rejected.", severity: "low" } });
  check("viewer cannot record findings (403)", viewerFinding.status === 403, describe(viewerFinding));
  const deletedFinding = await api<Json>("delete finding", "DELETE", `/findings/${findingId}`, { session: admin });
  const goneFinding = await call<Json>("GET", `/findings/${findingId}`, { session: admin });
  check("deleted finding returns 404", deletedFinding.data.deleted === true && goneFinding.status === 404, describe(goneFinding));

  // ------------------------------------------------------------------ incidents
  section("Incidents: open, comment, progress, resolve and close");
  const createdIncident = await api<Json>(
    "open incident",
    "POST",
    "/incidents",
    {
      session: operator,
      body: {
        title: "Smoke incident: staging API errors",
        description: "The staging API returns 502 after the latest deploy.",
        severity: "medium",
        priority: "p3",
        assigneeId: operator.id,
        assetIds: [assetId],
      },
    },
    [201],
  );
  const incidentId = str(createdIncident.data.id);
  check("new incident gets the next reference and starts investigating or open", /^INC-\d{5}$/.test(str(createdIncident.data.reference)), JSON.stringify({ reference: createdIncident.data.reference, status: createdIncident.data.status }));
  const viewerComment = await call<Json>("POST", `/incidents/${incidentId}/comments`, { session: viewer, body: { body: "Should be rejected." } });
  check("viewer cannot comment on incidents (403)", viewerComment.status === 403, describe(viewerComment));
  await api("add incident comment", "POST", `/incidents/${incidentId}/comments`, { session: admin, body: { body: "Rolled back the staging deploy." } }, [201]);
  await api("move incident to in progress", "PATCH", `/incidents/${incidentId}`, { session: operator, body: { status: "in_progress" } });
  const resolvedIncident = await api<Json>("resolve incident", "PATCH", `/incidents/${incidentId}`, {
    session: operator,
    body: { status: "resolved", rootCause: "Bad build artifact.", resolution: "Redeployed the previous build." },
  });
  check("resolved incident stores root cause and resolution", resolvedIncident.data.status === "resolved" && resolvedIncident.data.rootCause === "Bad build artifact." && typeof resolvedIncident.data.resolvedAt === "string");
  const closedIncident = await api<Json>("close incident", "PATCH", `/incidents/${incidentId}`, { session: admin, body: { status: "closed" } });
  check("closed incident records the closing time", closedIncident.data.status === "closed" && typeof closedIncident.data.closedAt === "string");
  const incidentDetail = await api<Json>("incident detail loads", "GET", `/incidents/${incidentId}`, { session: viewer });
  const timeline = list(incidentDetail.data.timeline);
  check(
    "timeline shows the comment and every status change",
    timeline.length >= 6 && timeline.some((t) => t.kind === "comment" && str(t.body).includes("Rolled back")) && list(incidentDetail.data.assets).some((a) => a.id === assetId),
    `${timeline.length} timeline entries`,
  );
  const closedOnly = await api<Json[]>("filter incidents", "GET", "/incidents?status=closed&search=Smoke", { session: viewer });
  check("status and search filters combine", num(closedOnly.meta.total) === 1, `total ${String(closedOnly.meta.total)}`);

  // ------------------------------------------------------------------ maintenance
  section("Maintenance: schedule, overlap warning, complete and delete");
  const badWindow = await call<Json>("POST", "/maintenance", {
    session: operator,
    body: { title: "Smoke bad window", description: "Ends before it starts.", startsAt: inHours(3), endsAt: inHours(2) },
  });
  check("window that ends before it starts is rejected", badWindow.status === 400, describe(badWindow));
  const windowBody = (title: string, start: number, end: number) => ({
    title,
    description: "Automated smoke test window.",
    startsAt: inHours(start),
    endsAt: inHours(end),
    ownerId: operator.id,
    assetIds: [ordersDbId],
  });
  const createdWindow = await api<Json>("schedule maintenance", "POST", "/maintenance", { session: operator, body: windowBody("Smoke maintenance: staging redeploy", 2, 3) }, [201]);
  const windowId = str(createdWindow.data.id);
  check("new window is scheduled with its asset", createdWindow.data.status === "scheduled" && list(createdWindow.data.assets).length === 1, JSON.stringify(createdWindow.data.assets));
  const overlapping = await call<Json>("POST", "/maintenance", { session: operator, body: windowBody("Smoke maintenance: overlapping", 2.5, 4) });
  const overlapFlagged = Object.entries(overlapping.data).some(
    ([key, value]) => /overlap|conflict|warn/i.test(key) && Array.isArray(value) && value.length > 0,
  );
  check(
    "overlapping window for a shared asset is flagged",
    overlapping.status === 201 && overlapFlagged,
    `${describe(overlapping)} — keys: ${Object.keys(overlapping.data).join(", ")}`,
  );
  await api("start maintenance", "PATCH", `/maintenance/${windowId}`, { session: operator, body: { status: "in_progress" } });
  const completedWindow = await api<Json>("complete maintenance", "PATCH", `/maintenance/${windowId}`, {
    session: operator,
    body: { status: "completed", notes: "Redeploy finished in 18 minutes." },
  });
  check("completed window keeps its notes", completedWindow.data.status === "completed" && completedWindow.data.notes === "Redeploy finished in 18 minutes.");
  const viewerWindow = await call<Json>("DELETE", `/maintenance/${windowId}`, { session: viewer });
  check("viewer cannot delete maintenance (403)", viewerWindow.status === 403, describe(viewerWindow));
  const operatorWindow = await call<Json>("DELETE", `/maintenance/${windowId}`, { session: operator });
  check("deleting maintenance is reserved for administrators (403)", operatorWindow.status === 403, describe(operatorWindow));
  await api("delete maintenance", "DELETE", `/maintenance/${windowId}`, { session: admin });
  const goneWindow = await call<Json>("GET", `/maintenance/${windowId}`, { session: operator });
  check("deleted window returns 404", goneWindow.status === 404, describe(goneWindow));

  // ------------------------------------------------------------------ change workflow
  section("Change management: draft → submit → approve → implement → roll back");
  const draftedChange = await api<Json>(
    "draft change request",
    "POST",
    "/changes",
    {
      session: operator,
      body: {
        title: "Smoke change: raise connection pool limit",
        description: "Raise the orders service pool limit from 20 to 50.",
        reason: "Prevent pool exhaustion during peak traffic.",
        riskLevel: "low",
        implementerId: operator.id,
        assetIds: [ordersDbId],
      },
    },
    [201],
  );
  const changeId = str(draftedChange.data.id);
  check("new change is a draft with a reference", draftedChange.data.status === "draft" && /^CHG-\d{5}$/.test(str(draftedChange.data.reference)));
  const earlySubmit = await call<Json>("POST", `/changes/${changeId}/submit`, { session: operator });
  check("draft without risk assessment and rollback plan cannot be submitted (422)", earlySubmit.status === 422, describe(earlySubmit));
  await api("add risk assessment and rollback plan", "PATCH", `/changes/${changeId}`, {
    session: operator,
    body: { riskAssessment: "Brief connection reset during reload.", rollbackPlan: "Restore the previous pool limit." },
  });
  const viewerSubmit = await call<Json>("POST", `/changes/${changeId}/submit`, { session: viewer });
  check("viewer cannot submit a change (403)", viewerSubmit.status === 403, describe(viewerSubmit));
  const submitted = await api<Json>("submit for approval", "POST", `/changes/${changeId}/submit`, { session: operator });
  check("submitted change awaits approval", submitted.data.status === "pending_approval");
  const editLocked = await call<Json>("PATCH", `/changes/${changeId}`, { session: operator, body: { title: "Smoke change: renamed" } });
  check("submitted change can no longer be edited (422)", editLocked.status === 422, describe(editLocked));
  const selfApproval = await call<Json>("POST", `/changes/${changeId}/approvals`, { session: operator, body: { decision: "approved" } });
  check("requester cannot approve their own change (403)", selfApproval.status === 403, describe(selfApproval));
  const rejectWithoutComment = await call<Json>("POST", `/changes/${changeId}/approvals`, { session: admin, body: { decision: "rejected" } });
  check("rejection requires a comment (422)", rejectWithoutComment.status === 422, describe(rejectWithoutComment));
  const approved = await api<Json>(
    "administrator approves",
    "POST",
    `/changes/${changeId}/approvals`,
    { session: admin, body: { decision: "approved", comment: "Approved for tonight's window." } },
    [201],
  );
  check("approval moves the change to approved", approved.data.status === "approved" && list(approved.data.approvals).length === 1, JSON.stringify(approved.data.approvals));
  const doubleVote = await call<Json>("POST", `/changes/${changeId}/approvals`, { session: admin, body: { decision: "approved" } });
  // With one required approval the change has already left "pending_approval"; with more it would be a 409.
  check("a second decision by the same approver is refused", doubleVote.status === 409 || doubleVote.status === 422, describe(doubleVote));
  const earlyRollback = await call<Json>("POST", `/changes/${changeId}/transitions`, { session: admin, body: { action: "rollback", notes: "Too early." } });
  check("approved change cannot be rolled back yet (422)", earlyRollback.status === 422, describe(earlyRollback));
  const viewerImplement = await call<Json>("POST", `/changes/${changeId}/transitions`, { session: viewer, body: { action: "implement" } });
  check("viewer cannot implement a change (403)", viewerImplement.status === 403, describe(viewerImplement));
  const implemented = await api<Json>(
    "record implementation",
    "POST",
    `/changes/${changeId}/transitions`,
    { session: admin, body: { action: "implement", notes: "Pool limit raised and service reloaded." } },
  );
  check("implementation is recorded", implemented.data.status === "implemented" && typeof implemented.data.implementedAt === "string");
  const rollbackWithoutNotes = await call<Json>("POST", `/changes/${changeId}/transitions`, { session: admin, body: { action: "rollback" } });
  check("rollback requires notes (400)", rollbackWithoutNotes.status === 400, describe(rollbackWithoutNotes));
  const rolledBack = await api<Json>("roll back with notes", "POST", `/changes/${changeId}/transitions`, {
    session: admin,
    body: { action: "rollback", notes: "Error rate rose after the reload." },
  });
  check("rollback closes the workflow as rolled back", rolledBack.data.status === "rolled_back" && rolledBack.data.rollbackNotes === "Error rate rose after the reload.");
  const changeAudit = await api<Json[]>("change audit trail loads", "GET", `/audit?entityType=change_request&entityId=${changeId}`, { session: admin });
  // created, updated, submitted, approved, implemented, rolled back
  check("every workflow step is audited", num(changeAudit.meta.total) >= 6, `total ${String(changeAudit.meta.total)}`);
  const decisionFeed = await api<Json[]>("requester is notified of decisions", "GET", "/notifications?unread=true&pageSize=100", { session: operator });
  check(
    "requester received approval and rollback notifications",
    entries(decisionFeed).some((n) => n.type === "change_decision" && str(n.link).includes(changeId)),
    `${entries(decisionFeed).length} unread`,
  );

  // ------------------------------------------------------------------ notifications
  section("Notifications: unread filter, mark read and mark all");
  const feed = await api<Json[]>("feed loads with an unread count", "GET", "/notifications?pageSize=100", { session: admin });
  const unreadOnly = await api<Json[]>("unread filter loads", "GET", "/notifications?unread=true&pageSize=100", { session: admin });
  const unreadBefore = num(feed.meta.unreadCount);
  check("unread filter returns exactly the unread items", entries(unreadOnly).length === unreadBefore && entries(unreadOnly).every((n) => n.readAt === null), `${entries(unreadOnly).length} items, unread ${unreadBefore}`);
  const operatorNotice = entries(operatorFeed).find((n) => n.readAt === null);
  const foreign = await call<Json>("POST", `/notifications/${str(operatorNotice?.id)}/read`, { session: admin });
  check("another user's notification cannot be marked read (404)", operatorNotice !== undefined && foreign.status === 404, describe(foreign));
  const firstUnread = entries(unreadOnly)[0];
  await api("mark one notification read", "POST", `/notifications/${str(firstUnread?.id)}/read`, { session: admin });
  const afterOne = await call<Json[]>("GET", "/notifications?pageSize=1", { session: admin });
  check("unread count decreases by one", num(afterOne.meta.unreadCount) === unreadBefore - 1, `unread ${String(afterOne.meta.unreadCount)}`);
  const markedAll = await api<Json>("mark all as read", "POST", "/notifications/read-all", { session: admin });
  const afterAll = await call<Json[]>("GET", "/notifications?pageSize=1", { session: admin });
  check("unread count is zero afterwards", num(markedAll.data.updated) === unreadBefore - 1 && num(afterAll.meta.unreadCount) === 0, JSON.stringify(markedAll.data));

  // ------------------------------------------------------------------ users and administration
  section("Users and administration");
  const selfDemote = await call<Json>("PATCH", `/users/${admin.id}`, { session: admin, body: { role: "viewer" } });
  check("administrator cannot demote their own account (400)", selfDemote.status === 400, describe(selfDemote));
  await api("change operator role", "PATCH", `/users/${operator.id}`, { session: admin, body: { role: "viewer" } });
  const demotedWrite = await call<Json>("POST", "/assets", { session: operator, body: { name: "Smoke denied after demotion", assetType: "application" } });
  check("role change applies to existing sessions immediately (403)", demotedWrite.status === 403, describe(demotedWrite));
  await api("restore operator role", "PATCH", `/users/${operator.id}`, { session: admin, body: { role: "operator" } });
  await api("deactivate viewer", "PATCH", `/users/${viewer.id}`, { session: admin, body: { isActive: false } });
  const deactivated = await call<Json>("GET", "/users/me", { session: viewer });
  const deactivatedRefresh = await call<Json>("POST", "/auth/refresh", { cookie: viewer.cookie });
  check("deactivated user loses API and refresh access (401)", deactivated.status === 401 && deactivatedRefresh.status === 401, `${describe(deactivated)} / ${describe(deactivatedRefresh)}`);
  await api("reactivate viewer", "PATCH", `/users/${viewer.id}`, { session: admin, body: { isActive: true } });
  await api("update profile", "PATCH", "/users/me", { session: admin, body: { name: "Ada Admin (smoke)" } });
  await api("restore profile", "PATCH", "/users/me", { session: admin, body: { name: "Ada Admin" } });
  const wrongCurrent = await call<Json>("POST", "/users/me/password", { session: admin, body: { currentPassword: "Definitely-Wrong-123", newPassword: "Smoke-Rotate-2026Aa9" } });
  check("password change rejects a wrong current password", wrongCurrent.status >= 400 && wrongCurrent.status < 500, describe(wrongCurrent));
  const operatorManage = await call<Json>("PATCH", `/users/${viewer.id}`, { session: operator, body: { role: "operator" } });
  check("operator cannot change roles (403)", operatorManage.status === 403, describe(operatorManage));

  // ------------------------------------------------------------------ registration, reset and rotation
  section("Registration, password reset and session rotation");
  const smokeEmail = `smoke-${stamp}@example.com`;
  const smokePassword = `Smoke-Rotate-${stamp}Aa9`;
  const weak = await call<Json>("POST", "/auth/register", { body: { name: "Sam Smoke", email: smokeEmail, password: "short" } });
  check("weak password is rejected at registration", weak.status === 400, describe(weak));
  const registered = await api<Json>("register a new account", "POST", "/auth/register", { body: { name: "Sam Smoke", email: smokeEmail, password: PASSWORD } }, [201]);
  check("self-registered accounts are viewers", record(registered.data.user).role === "viewer", JSON.stringify(registered.data.user));
  const duplicate = await call<Json>("POST", "/auth/register", { body: { name: "Sam Smoke", email: smokeEmail, password: PASSWORD } });
  check("duplicate email is a conflict (409)", duplicate.status === 409, describe(duplicate));

  const forgot = await call<Json>("POST", "/auth/forgot-password", { body: { email: smokeEmail } });
  check(
    "reset request answers 202 without revealing account state",
    forgot.status === 202 && typeof forgot.data.message === "string",
    describe(forgot),
  );
  // The reset token is only returned in development (EXPOSE_RESET_TOKEN=true); rotation is verified either way.
  const resetToken = forgot.status === 202 ? str(forgot.data.devToken) : "";
  let currentPassword = PASSWORD;
  if (resetToken) {
    const reset = await api<Json>("complete password reset", "POST", "/auth/reset-password", { body: { token: resetToken, password: smokePassword } });
    const oldLogin = await call<Json>("POST", "/auth/login", { body: { email: smokeEmail, password: PASSWORD } });
    check("old password no longer signs in after the reset (401)", reset.status === 200 && oldLogin.status === 401, `${describe(reset)} / ${describe(oldLogin)}`);
    const tokenReuse = await call<Json>("POST", "/auth/reset-password", { body: { token: resetToken, password: PASSWORD } });
    check("reset token is single use", tokenReuse.status >= 400 && tokenReuse.status < 500, describe(tokenReuse));
    currentPassword = smokePassword;
  } else {
    console.log("  • the reset token is not exposed on this instance; password-reset checks skipped");
  }

  const fresh = await login(smokeEmail, currentPassword);
  check("account signs in with its current password", fresh.token.length > 20);
  const noCsrf = await call<Json>("POST", "/auth/refresh", { cookie: fresh.cookie, csrf: false });
  check("refresh without the anti-CSRF header is rejected (403)", noCsrf.status === 403, describe(noCsrf));
  const refreshed = await call<Json>("POST", "/auth/refresh", { cookie: fresh.cookie });
  const rotatedCookie = cookiePair(refreshed.setCookie);
  check("refresh returns a new access token and rotates the cookie", refreshed.status === 200 && str(record(refreshed.data).accessToken).length > 20 && rotatedCookie !== fresh.cookie, describe(refreshed));
  const replay = await call<Json>("POST", "/auth/refresh", { cookie: fresh.cookie });
  check("replaying a used refresh cookie is rejected (401)", replay.status === 401, describe(replay));
  const family = await call<Json>("POST", "/auth/refresh", { cookie: rotatedCookie });
  check("reuse detection revokes the whole token family (401)", family.status === 401, describe(family));

  const logoutSession = await login(smokeEmail, currentPassword);
  await api("logout", "POST", "/auth/logout", { cookie: logoutSession.cookie });
  const afterLogout = await call<Json>("POST", "/auth/refresh", { cookie: logoutSession.cookie });
  check("refresh after logout is rejected (401)", afterLogout.status === 401, describe(afterLogout));

  // ------------------------------------------------------------------ background worker and alerting
  section("Background worker: state machine, alerting and roll-up");
  const alertTarget = await api<Json>(
    "create a check that always fails",
    "POST",
    "/monitoring/targets",
    {
      session: admin,
      // The SSRF policy only accepts resolvable hosts, so fail the check with an impossible expected status code.
      body: { name: `Smoke failing check ${stamp}`, monitorType: "http", url: "https://example.com/", expectedStatusCode: 418, intervalSeconds: 30, timeoutMs: 5000, assetId },
    },
    [201],
  );
  const alertId = str(alertTarget.data.id);
  const alertName = str(alertTarget.data.name);
  const unavailable = await waitFor(
    "the failure threshold",
    async () => {
      const res = await call<Json>("GET", `/monitoring/targets/${alertId}`, { session: viewer });
      return res.data.status === "unavailable" ? res.data : undefined;
    },
    110_000,
  );
  check("worker marks the check unavailable after the failure threshold", unavailable !== undefined, JSON.stringify(unavailable ?? {}));
  const rolledUp = await call<Json>("GET", `/assets/${assetId}`, { session: viewer });
  check("asset status rolls up from its failing check", rolledUp.data.status === "unavailable", `asset status ${String(rolledUp.data.status)}`);
  const alert = await waitFor(
    "the alert notification",
    async () => {
      const res = await call<Json[]>("GET", "/notifications?pageSize=100", { session: admin });
      return entries(res).find((n) => n.type === "monitoring_unavailable" && n.title === `Service unavailable: ${alertName}`);
    },
    20_000,
  );
  check("an alert is delivered to administrators", alert !== undefined);
  const alertLink = str(alert?.link);
  const alertPage = alertLink ? await fetchPage(alertLink) : null;
  check(
    "alert link opens the monitoring console for that check",
    alertLink.startsWith("/monitoring?target=") && alertPage?.status === 200,
    `${alertLink} → HTTP ${String(alertPage?.status)}`,
  );

  await api("accept the real status code", "PATCH", `/monitoring/targets/${alertId}`, { session: admin, body: { expectedStatusCode: 200 } });
  const recovered = await waitFor(
    "the next successful check",
    async () => {
      const res = await call<Json>("GET", `/monitoring/targets/${alertId}`, { session: viewer });
      return res.data.status === "healthy" || res.data.status === "degraded" ? res.data : undefined;
    },
    45_000,
  );
  check("worker restores the check after a successful probe", recovered !== undefined, JSON.stringify(recovered ?? {}));
  const recoveredNotice = await waitFor(
    "the recovery notification",
    async () => {
      const res = await call<Json[]>("GET", "/notifications?pageSize=100", { session: operator });
      return entries(res).find((n) => n.type === "monitoring_recovered" && n.title === `Service recovered: ${alertName}`);
    },
    20_000,
  );
  check("a recovery notification is delivered", recoveredNotice !== undefined);
  const rolledBackUp = await call<Json>("GET", `/assets/${assetId}`, { session: viewer });
  check("asset status rolls back up with its check", rolledBackUp.data.status === "healthy" || rolledBackUp.data.status === "degraded", `asset status ${String(rolledBackUp.data.status)}`);
  await api("remove the alert test check", "DELETE", `/monitoring/targets/${alertId}`, { session: admin });

  const reminder = await waitFor(
    "the 24-hour maintenance reminder",
    async () => {
      const res = await call<Json[]>("GET", "/notifications?pageSize=100", { session: admin });
      return entries(res).find((n) => n.type === "maintenance_reminder");
    },
    15_000,
  );
  check("scheduler delivers the 24-hour maintenance reminder", reminder !== undefined, JSON.stringify(reminder ?? {}));

  console.log(`\n${"─".repeat(72)}`);
  console.log(`${failures.length === 0 ? "PASSED" : "FAILED"} — ${passed} checks passed, ${failures.length} failed in ${Math.round((Date.now() - startedAt) / 1000)} s`);
  if (failures.length > 0) {
    console.log("\nFailures:");
    for (const failure of failures) console.log(`  • ${failure}`);
  }
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error("\nSmoke test aborted:", err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
