/**
 * Demo dataset for InfraPilot presentations.
 *
 * Pure data only: no database access, no environment reads, no side effects. The seeder in
 * `scripts/seed-demo.ts` resolves these keys against real MongoDB documents through the existing
 * service layer, so business rules (validation, audit trail, notifications, approval workflow)
 * still apply.
 *
 * Every record carries an owner marker. Additions never touch records without the marker.
 */

/** Marker written on every document this dataset creates. */
export const DEMO_BATCH = "infrapilot-demo-v1";
export const DEMO_SOURCE = "demo-seed";

/** Default mailbox domain for demo accounts; override with DEMO_EMAIL_DOMAIN. */
export const DEMO_EMAIL_DOMAIN = "infrapilot.local";

export type DemoRole = "admin" | "operator" | "viewer";

export interface DemoUserSpec {
  key: string;
  email: string;
  name: string;
  role: DemoRole;
  /** Human-readable title used in documentation and audit summaries. */
  title: string;
}

/**
 * Only the three roles the application actually implements are used. Job titles are descriptive
 * metadata, never permissions.
 */
export const DEMO_USERS: DemoUserSpec[] = [
  { key: "admin", email: `demo.admin@${DEMO_EMAIL_DOMAIN}`, name: "Priya Raman", role: "admin", title: "System Administrator" },
  { key: "operator", email: `demo.operator@${DEMO_EMAIL_DOMAIN}`, name: "Marcus Bell", role: "operator", title: "Infrastructure Engineer" },
  { key: "cloud", email: `demo.cloud@${DEMO_EMAIL_DOMAIN}`, name: "Elena Sokolova", role: "operator", title: "Cloud Engineer" },
  { key: "security", email: `demo.security@${DEMO_EMAIL_DOMAIN}`, name: "Tomas Ferreira", role: "operator", title: "Security Analyst" },
  { key: "auditor", email: `demo.auditor@${DEMO_EMAIL_DOMAIN}`, name: "Greta Lindqvist", role: "viewer", title: "Read-only Auditor" },
];

export type DemoAssetType =
  | "physical_server"
  | "virtual_machine"
  | "network_device"
  | "cloud_resource"
  | "container"
  | "database"
  | "application"
  | "other";
export type DemoEnvironment = "development" | "testing" | "production";
export type DemoAssetStatus = "healthy" | "degraded" | "unavailable" | "maintenance" | "unknown";

export interface DemoAssetSpec {
  key: string;
  name: string;
  assetType: DemoAssetType;
  environment: DemoEnvironment;
  hostname: string;
  ipAddress: string;
  operatingSystem: string;
  location: string;
  owner: string;
  status: DemoAssetStatus;
  /** Support fields the schema does not model are folded into the description, prefixed. */
  tag: string;
  department: string;
  criticality: "Tier 1" | "Tier 2" | "Tier 3";
  description: string;
  /** Days since the asset was registered, used for realistic created/updated timestamps. */
  ageDays: number;
}

const asset = (spec: Omit<DemoAssetSpec, "description"> & { description?: string }): DemoAssetSpec => ({
  ...spec,
  description:
    spec.description ??
    `${spec.criticality} workload in the ${spec.department} estate. Asset tag ${spec.tag}. Demonstration record created by the demo seeder.`,
});

export const DEMO_ASSETS: DemoAssetSpec[] = [
  asset({ key: "prd-web-01", name: "prd-web-01", assetType: "virtual_machine", environment: "production", hostname: "prd-web-01.lab.infrapilot.internal", ipAddress: "10.20.10.11", operatingSystem: "Ubuntu 22.04.4 LTS", location: "Azure eu-west / AZ-1", owner: "operator", status: "healthy", tag: "SRV-PRD-WEB-01", department: "Digital Platform", criticality: "Tier 1", ageDays: 412 }),
  asset({ key: "prd-web-02", name: "prd-web-02", assetType: "virtual_machine", environment: "production", hostname: "prd-web-02.lab.infrapilot.internal", ipAddress: "10.20.10.12", operatingSystem: "Ubuntu 22.04.4 LTS", location: "Azure eu-west / AZ-2", owner: "operator", status: "healthy", tag: "SRV-PRD-WEB-02", department: "Digital Platform", criticality: "Tier 1", ageDays: 412 }),
  asset({ key: "prd-app-01", name: "prd-app-01", assetType: "physical_server", environment: "production", hostname: "prd-app-01.lab.infrapilot.internal", ipAddress: "10.20.10.21", operatingSystem: "Red Hat Enterprise Linux 9.4", location: "DC1 / Rack B4", owner: "operator", status: "healthy", tag: "SRV-PRD-APP-01", department: "Core Applications", criticality: "Tier 1", ageDays: 918 }),
  asset({ key: "prd-app-02", name: "prd-app-02", assetType: "physical_server", environment: "production", hostname: "prd-app-02.lab.infrapilot.internal", ipAddress: "10.20.10.22", operatingSystem: "Red Hat Enterprise Linux 9.4", location: "DC1 / Rack B5", owner: "operator", status: "degraded", tag: "SRV-PRD-APP-02", department: "Core Applications", criticality: "Tier 1", ageDays: 918 }),
  asset({ key: "prd-db-01", name: "prd-db-01", assetType: "database", environment: "production", hostname: "prd-db-01.lab.infrapilot.internal", ipAddress: "10.20.10.31", operatingSystem: "Ubuntu 22.04.4 LTS / PostgreSQL 16.3", location: "DC1 / Rack C1", owner: "cloud", status: "healthy", tag: "DB-PRD-01", department: "Data Services", criticality: "Tier 1", ageDays: 640 }),
  asset({ key: "prd-db-02", name: "prd-db-02", assetType: "database", environment: "production", hostname: "prd-db-02.lab.infrapilot.internal", ipAddress: "10.20.10.32", operatingSystem: "Ubuntu 22.04.4 LTS / PostgreSQL 16.3", location: "DC1 / Rack C2", owner: "cloud", status: "degraded", tag: "DB-PRD-02", department: "Data Services", criticality: "Tier 1", ageDays: 640 }),
  asset({ key: "prd-redis-01", name: "prd-redis-01", assetType: "container", environment: "production", hostname: "prd-redis-01.lab.infrapilot.internal", ipAddress: "10.20.10.41", operatingSystem: "Redis 7.2 on Ubuntu 22.04", location: "k3s cluster / prod", owner: "cloud", status: "healthy", tag: "APP-PRD-CACHE", department: "Data Services", criticality: "Tier 2", ageDays: 220 }),
  asset({ key: "prd-k8s-node-01", name: "prd-k8s-node-01", assetType: "virtual_machine", environment: "production", hostname: "prd-k8s-node-01.lab.infrapilot.internal", ipAddress: "10.20.10.51", operatingSystem: "Ubuntu 22.04.4 LTS / k3s 1.30", location: "Azure eu-west / AZ-1", owner: "cloud", status: "healthy", tag: "K8S-PRD-01", department: "Platform Engineering", criticality: "Tier 1", ageDays: 310 }),
  asset({ key: "prd-k8s-node-02", name: "prd-k8s-node-02", assetType: "virtual_machine", environment: "production", hostname: "prd-k8s-node-02.lab.infrapilot.internal", ipAddress: "10.20.10.52", operatingSystem: "Ubuntu 22.04.4 LTS / k3s 1.30", location: "Azure eu-west / AZ-2", owner: "cloud", status: "healthy", tag: "K8S-PRD-02", department: "Platform Engineering", criticality: "Tier 1", ageDays: 310 }),
  asset({ key: "prd-win-files-01", name: "prd-win-files-01", assetType: "physical_server", environment: "production", hostname: "prd-win-files-01.lab.infrapilot.internal", ipAddress: "10.20.10.61", operatingSystem: "Windows Server 2022 Datacenter", location: "DC1 / Rack D2", owner: "operator", status: "healthy", tag: "SRV-PRD-FS-01", department: "IT Operations", criticality: "Tier 2", ageDays: 1100 }),
  asset({ key: "prd-backup-01", name: "prd-backup-01", assetType: "other", environment: "production", hostname: "prd-backup-01.lab.infrapilot.internal", ipAddress: "10.20.10.71", operatingSystem: "Veeam Backup & Replication 12.1", location: "DC1 / Rack D4", owner: "operator", status: "unavailable", tag: "BKP-PRD-01", department: "IT Operations", criticality: "Tier 1", ageDays: 780 }),
  asset({ key: "prd-nas-01", name: "prd-nas-01", assetType: "other", environment: "production", hostname: "prd-nas-01.lab.infrapilot.internal", ipAddress: "10.20.10.81", operatingSystem: "TrueNAS SCALE 24.04", location: "DC1 / Rack D5", owner: "operator", status: "unknown", tag: "STG-PRD-01", department: "IT Operations", criticality: "Tier 2", ageDays: 950 }),
  asset({ key: "prd-fw-01", name: "prd-fw-01", assetType: "network_device", environment: "production", hostname: "prd-fw-01.lab.infrapilot.internal", ipAddress: "10.20.0.1", operatingSystem: "FortiOS 7.4.4", location: "DC1 / Rack A1", owner: "security", status: "healthy", tag: "NET-FW-01", department: "Network & Security", criticality: "Tier 1", ageDays: 1330 }),
  asset({ key: "prd-fw-02", name: "prd-fw-02", assetType: "network_device", environment: "production", hostname: "prd-fw-02.lab.infrapilot.internal", ipAddress: "10.20.0.2", operatingSystem: "FortiOS 7.4.4", location: "DC1 / Rack A2", owner: "security", status: "maintenance", tag: "NET-FW-02", department: "Network & Security", criticality: "Tier 1", ageDays: 1330 }),
  asset({ key: "prd-core-sw-01", name: "prd-core-sw-01", assetType: "network_device", environment: "production", hostname: "prd-core-sw-01.lab.infrapilot.internal", ipAddress: "10.20.0.11", operatingSystem: "Cisco IOS-XE 17.9.5", location: "DC1 / Rack A3", owner: "security", status: "healthy", tag: "NET-SW-01", department: "Network & Security", criticality: "Tier 1", ageDays: 1600 }),
  asset({ key: "prd-edge-rt-01", name: "prd-edge-rt-01", assetType: "network_device", environment: "production", hostname: "prd-edge-rt-01.lab.infrapilot.internal", ipAddress: "10.20.0.254", operatingSystem: "Cisco IOS-XE 17.9.5", location: "DC1 / Rack A4", owner: "security", status: "healthy", tag: "NET-RT-01", department: "Network & Security", criticality: "Tier 1", ageDays: 1600 }),
  asset({ key: "prd-vpn-gw-01", name: "prd-vpn-gw-01", assetType: "network_device", environment: "production", hostname: "prd-vpn-gw-01.lab.infrapilot.internal", ipAddress: "10.20.0.21", operatingSystem: "FortiOS 7.4.4 (SSL VPN)", location: "DC1 / Rack A5", owner: "security", status: "degraded", tag: "NET-VPN-01", department: "Network & Security", criticality: "Tier 2", ageDays: 980 }),
  asset({ key: "prd-lb-01", name: "prd-lb-01", assetType: "network_device", environment: "production", hostname: "prd-lb-01.lab.infrapilot.internal", ipAddress: "10.20.0.31", operatingSystem: "NGINX Plus R31 / Debian 12", location: "DC1 / Rack A6", owner: "operator", status: "healthy", tag: "NET-LB-01", department: "Digital Platform", criticality: "Tier 1", ageDays: 700 }),
  asset({ key: "az-hub-vnet", name: "az-hub-vnet", assetType: "cloud_resource", environment: "production", hostname: "vnet-hub-prod", ipAddress: "10.50.0.4", operatingSystem: "Azure Virtual Network (hub)", location: "Azure / eu-west / rg-net-prod", owner: "cloud", status: "healthy", tag: "CLD-VNET-HUB", department: "Cloud Platform", criticality: "Tier 1", ageDays: 520, description: "Hub VNet 10.50.0.0/16 with shared subnets 10.50.0.0/20 (gateway), 10.50.16.0/20 (shared services) and 10.50.32.0/20 (management). Tier 1 network foundation. Asset tag CLD-VNET-HUB. Demonstration record." }),
  asset({ key: "az-kv-prod-01", name: "az-kv-prod-01", assetType: "cloud_resource", environment: "production", hostname: "kv-prod-ip-01", ipAddress: "10.50.1.10", operatingSystem: "Azure Key Vault (Premium, HSM)", location: "Azure / eu-west / rg-sec-prod", owner: "cloud", status: "healthy", tag: "CLD-KV-01", department: "Cloud Platform", criticality: "Tier 1", ageDays: 470 }),
  asset({ key: "az-storage-prod-01", name: "az-storage-prod-01", assetType: "cloud_resource", environment: "production", hostname: "stprodsa01", ipAddress: "10.50.2.10", operatingSystem: "Azure Storage (GRS, private endpoint)", location: "Azure / eu-west / rg-data-prod", owner: "cloud", status: "healthy", tag: "CLD-STG-01", department: "Data Services", criticality: "Tier 2", ageDays: 470 }),
  asset({ key: "az-appgw-01", name: "az-appgw-01", assetType: "cloud_resource", environment: "production", hostname: "agw-prod-01", ipAddress: "10.50.3.10", operatingSystem: "Azure Application Gateway v2 (WAF)", location: "Azure / eu-west / rg-net-prod", owner: "cloud", status: "healthy", tag: "CLD-AGW-01", department: "Cloud Platform", criticality: "Tier 1", ageDays: 470 }),
  asset({ key: "az-monitor-01", name: "az-monitor-01", assetType: "cloud_resource", environment: "production", hostname: "log-prod-01", ipAddress: "10.50.4.10", operatingSystem: "Azure Monitor + Log Analytics workspace", location: "Azure / eu-west / rg-ops-prod", owner: "cloud", status: "unknown", tag: "CLD-MON-01", department: "Platform Engineering", criticality: "Tier 3", ageDays: 430 }),
  asset({ key: "tst-web-01", name: "tst-web-01", assetType: "virtual_machine", environment: "testing", hostname: "tst-web-01.lab.infrapilot.internal", ipAddress: "10.30.10.11", operatingSystem: "Ubuntu 24.04 LTS", location: "Azure eu-west / AZ-1", owner: "operator", status: "healthy", tag: "SRV-TST-WEB-01", department: "Digital Platform", criticality: "Tier 3", ageDays: 96 }),
  asset({ key: "tst-db-01", name: "tst-db-01", assetType: "database", environment: "testing", hostname: "tst-db-01.lab.infrapilot.internal", ipAddress: "10.30.10.31", operatingSystem: "PostgreSQL 16.3 on Ubuntu 24.04", location: "Azure eu-west / AZ-2", owner: "cloud", status: "healthy", tag: "DB-TST-01", department: "Data Services", criticality: "Tier 3", ageDays: 96 }),
  asset({ key: "dev-app-01", name: "dev-app-01", assetType: "virtual_machine", environment: "development", hostname: "dev-app-01.lab.infrapilot.internal", ipAddress: "10.40.10.11", operatingSystem: "Ubuntu 24.04 LTS", location: "Azure eu-west / AZ-1", owner: "operator", status: "healthy", tag: "SRV-DEV-APP-01", department: "Core Applications", criticality: "Tier 3", ageDays: 64 }),
  asset({ key: "dev-ws-01", name: "dev-ws-01", assetType: "other", environment: "development", hostname: "dev-ws-01.lab.infrapilot.internal", ipAddress: "10.40.20.31", operatingSystem: "Windows 11 Pro 24H2 (workstation)", location: "HQ / Floor 3", owner: "operator", status: "unknown", tag: "WS-DEV-031", department: "IT Operations", criticality: "Tier 3", ageDays: 210 }),
  asset({ key: "dev-lt-07", name: "dev-lt-07", assetType: "other", environment: "development", hostname: "dev-lt-07.lab.infrapilot.internal", ipAddress: "10.40.20.47", operatingSystem: "Ubuntu 24.04 LTS (laptop)", location: "Remote / field", owner: "cloud", status: "unknown", tag: "LT-DEV-007", department: "Cloud Platform", criticality: "Tier 3", ageDays: 330 }),
];

export type DemoMonitorState = "healthy" | "degraded" | "unavailable" | "unknown";
export type DemoHistoryPattern = "stable" | "slow" | "outage" | "recovery" | "flapping" | "none";

export interface DemoMonitorSpec {
  key: string;
  name: string;
  monitorType: "http" | "tcp";
  url?: string;
  host?: string;
  port?: number;
  expectedStatusCode?: number;
  intervalSeconds: number;
  timeoutMs: number;
  degradedThresholdMs: number;
  enabled: boolean;
  asset: string;
  /** Current state the demo presents before the worker runs a fresh check. */
  state: DemoMonitorState;
  consecutiveFailures: number;
  lastError: string | null;
  lastResponseMs: number | null;
  pattern: DemoHistoryPattern;
  /** Number of historical result rows to generate (spread over the last 7 days). */
  historyPoints: number;
}

/**
 * Every destination is loopback and belongs to this workstation. Nothing external is probed, and
 * the worker may keep checking these safely after the seeder exits.
 */
export const DEMO_MONITORS: DemoMonitorSpec[] = [
  { key: "mon-web-01", name: "prd-web-01 storefront (HTTP)", monitorType: "http", url: "http://127.0.0.1:3000/login", expectedStatusCode: 200, intervalSeconds: 60, timeoutMs: 5000, degradedThresholdMs: 1500, enabled: true, asset: "prd-web-01", state: "healthy", consecutiveFailures: 0, lastError: null, lastResponseMs: 128, pattern: "stable", historyPoints: 96 },
  { key: "mon-app-01", name: "prd-app-01 API health (HTTP)", monitorType: "http", url: "http://127.0.0.1:4000/health", expectedStatusCode: 200, intervalSeconds: 60, timeoutMs: 5000, degradedThresholdMs: 1200, enabled: true, asset: "prd-app-01", state: "healthy", consecutiveFailures: 0, lastError: null, lastResponseMs: 64, pattern: "stable", historyPoints: 96 },
  { key: "mon-db-01", name: "prd-db-01 PostgreSQL (TCP)", monitorType: "tcp", host: "127.0.0.1", port: 27017, intervalSeconds: 120, timeoutMs: 4000, degradedThresholdMs: 800, enabled: true, asset: "prd-db-01", state: "healthy", consecutiveFailures: 0, lastError: null, lastResponseMs: 12, pattern: "stable", historyPoints: 72 },
  { key: "mon-db-02", name: "prd-db-02 replica PostgreSQL (TCP)", monitorType: "tcp", host: "127.0.0.1", port: 5432, intervalSeconds: 120, timeoutMs: 4000, degradedThresholdMs: 800, enabled: true, asset: "prd-db-02", state: "unavailable", consecutiveFailures: 4, lastError: "connect ECONNREFUSED 127.0.0.1:5432", lastResponseMs: null, pattern: "outage", historyPoints: 72 },
  { key: "mon-backup-01", name: "prd-backup-01 job service (HTTP)", monitorType: "http", url: "http://127.0.0.1:9/health", intervalSeconds: 300, timeoutMs: 5000, degradedThresholdMs: 1500, enabled: true, asset: "prd-backup-01", state: "unavailable", consecutiveFailures: 11, lastError: "connect ECONNREFUSED 127.0.0.1:9", lastResponseMs: null, pattern: "outage", historyPoints: 48 },
  { key: "mon-vpn-01", name: "prd-vpn-gw-01 portal (HTTP)", monitorType: "http", url: "http://127.0.0.1:3000/login", expectedStatusCode: 200, intervalSeconds: 120, timeoutMs: 5000, degradedThresholdMs: 60, enabled: true, asset: "prd-vpn-gw-01", state: "degraded", consecutiveFailures: 0, lastError: null, lastResponseMs: 2140, pattern: "slow", historyPoints: 72 },
  { key: "mon-app-02", name: "prd-app-02 worker API (HTTP)", monitorType: "http", url: "http://127.0.0.1:4000/api/health", intervalSeconds: 60, timeoutMs: 8000, degradedThresholdMs: 400, enabled: true, asset: "prd-app-02", state: "degraded", consecutiveFailures: 0, lastError: null, lastResponseMs: 1820, pattern: "slow", historyPoints: 96 },
  { key: "mon-k8s-node-01", name: "prd-k8s-node-01 kubelet (HTTP)", monitorType: "http", url: "http://127.0.0.1:4010/health", intervalSeconds: 60, timeoutMs: 4000, degradedThresholdMs: 900, enabled: true, asset: "prd-k8s-node-01", state: "healthy", consecutiveFailures: 0, lastError: null, lastResponseMs: 96, pattern: "recovery", historyPoints: 96 },
  { key: "mon-tst-web-01", name: "tst-web-01 staging front (HTTP)", monitorType: "http", url: "http://127.0.0.1:3000/login", expectedStatusCode: 200, intervalSeconds: 300, timeoutMs: 5000, degradedThresholdMs: 1500, enabled: true, asset: "tst-web-01", state: "healthy", consecutiveFailures: 0, lastError: null, lastResponseMs: 132, pattern: "stable", historyPoints: 48 },
  { key: "mon-dev-app-01", name: "dev-app-01 dev front (HTTP)", monitorType: "http", url: "http://127.0.0.1:3000/", expectedStatusCode: 200, intervalSeconds: 300, timeoutMs: 5000, degradedThresholdMs: 2000, enabled: true, asset: "dev-app-01", state: "healthy", consecutiveFailures: 0, lastError: null, lastResponseMs: 210, pattern: "flapping", historyPoints: 48 },
  { key: "mon-nas-01", name: "prd-nas-01 NFS (TCP)", monitorType: "tcp", host: "127.0.0.1", port: 2049, intervalSeconds: 300, timeoutMs: 4000, degradedThresholdMs: 900, enabled: true, asset: "prd-nas-01", state: "unknown", consecutiveFailures: 0, lastError: null, lastResponseMs: null, pattern: "none", historyPoints: 0 },
  { key: "mon-win-files-01", name: "prd-win-files-01 WinRM (HTTP)", monitorType: "http", url: "http://127.0.0.1:5985/wsman", intervalSeconds: 300, timeoutMs: 5000, degradedThresholdMs: 1500, enabled: false, asset: "prd-win-files-01", state: "unknown", consecutiveFailures: 0, lastError: null, lastResponseMs: null, pattern: "none", historyPoints: 0 },
];

export type DemoIncidentStatus = "open" | "investigating" | "in_progress" | "resolved" | "closed";
export type DemoIncidentSeverity = "critical" | "high" | "medium" | "low";
export type DemoIncidentPriority = "p1" | "p2" | "p3" | "p4";

export interface DemoIncidentSpec {
  key: string;
  title: string;
  description: string;
  severity: DemoIncidentSeverity;
  priority: DemoIncidentPriority;
  status: DemoIncidentStatus;
  assignee: string;
  assets: string[];
  openedHoursAgo: number;
  rootCause?: string;
  resolution?: string;
  comments?: Array<{ author: string; body: string; hoursAgo: number }>;
}

export const DEMO_INCIDENTS: DemoIncidentSpec[] = [
  {
    key: "inc-db-replica",
    title: "Database replica prd-db-02 not accepting connections",
    description:
      "The PostgreSQL streaming replica stopped accepting connections after a storage latency spike. Reads for reporting are served by the primary until the replica is rebuilt.",
    severity: "critical",
    priority: "p1",
    status: "in_progress",
    assignee: "operator",
    assets: ["prd-db-02"],
    openedHoursAgo: 5,
    comments: [
      { author: "operator", body: "Monitoring shows ECONNREFUSED on 5432 since 04:12. Failing over reporting reads to prd-db-01.", hoursAgo: 4 },
      { author: "cloud", body: "Storage latency on the replica volume normalised at 04:40. Rebuild started from the base backup.", hoursAgo: 2 },
    ],
  },
  {
    key: "inc-checkout-5xx",
    title: "Checkout service returning HTTP 503 for 8% of requests",
    description:
      "Elevated 503 responses from the storefront between 01:05 and 01:40. Connection pool exhaustion on prd-web-01 is the leading hypothesis.",
    severity: "high",
    priority: "p2",
    status: "investigating",
    assignee: "operator",
    assets: ["prd-web-01", "prd-lb-01"],
    openedHoursAgo: 9,
    comments: [{ author: "operator", body: "Load balancer health checks are green; application logs show pool timeouts. Reviewing max_connections.", hoursAgo: 6 }],
  },
  {
    key: "inc-backup-failed",
    title: "Nightly backup job failed on prd-backup-01",
    description: "The 02:00 incremental backup job failed with a repository connection error. No restore points were produced for the window.",
    severity: "medium",
    priority: "p3",
    status: "resolved",
    assignee: "operator",
    assets: ["prd-backup-01"],
    openedHoursAgo: 52,
    rootCause: "Backup repository service was stopped by an interrupted Windows update and did not restart automatically.",
    resolution: "Restarted the Veeam Backup Service, re-ran the incremental job successfully (12.4 GB) and set the service to delayed automatic start.",
    comments: [{ author: "operator", body: "Recovery point created at 09:15. Adding a health check for the repository service.", hoursAgo: 26 }],
  },
  {
    key: "inc-vpn-latency",
    title: "SSL VPN latency above 2 seconds for remote users",
    description: "Remote access users report slow portal and tunnel establishment since 07:00. CPU on the VPN gateway is at 91%.",
    severity: "high",
    priority: "p2",
    status: "open",
    assignee: "security",
    assets: ["prd-vpn-gw-01"],
    openedHoursAgo: 3,
  },
  {
    key: "inc-disk-capacity",
    title: "Disk capacity warning on prd-app-01",
    description: "Volume /var/log reached 88% utilisation overnight. Log rotation was not covering the new audit stream.",
    severity: "medium",
    priority: "p3",
    status: "closed",
    assignee: "operator",
    assets: ["prd-app-01"],
    openedHoursAgo: 216,
    rootCause: "The audit stream was excluded from logrotate when the application was upgraded.",
    resolution: "Rotated logs manually, extended logrotate coverage and confirmed capacity at 62% for seven consecutive days.",
  },
  {
    key: "inc-cert-expiry",
    title: "TLS certificate for the storefront expires in 21 days",
    description: "Certificate monitoring reported that the storefront certificate on prd-lb-01 expires in 21 days and has not been renewed.",
    severity: "low",
    priority: "p4",
    status: "resolved",
    assignee: "security",
    assets: ["prd-lb-01"],
    openedHoursAgo: 120,
    rootCause: "The renewal automation lost its Key Vault credential after policy changes.",
    resolution: "Renewed the certificate, restored the automation identity and verified a successful staged renewal.",
  },
  {
    key: "inc-cpu-spike",
    title: "Sustained CPU saturation on prd-app-02",
    description: "CPU stayed above 95% for 40 minutes on prd-app-02, causing slow responses from the worker API.",
    severity: "high",
    priority: "p2",
    status: "closed",
    assignee: "cloud",
    assets: ["prd-app-02"],
    openedHoursAgo: 336,
    rootCause: "A batch enrichment job was deployed without a concurrency limit and saturated all available cores.",
    resolution: "Limited the job to two concurrent workers, added CPU-based autoscaling and confirmed 62% average utilisation.",
  },
  {
    key: "inc-fw-ha",
    title: "Firewall HA pair out of sync",
    description: "The passive firewall reported configuration drift after a rule change, leaving the pair unsynchronised.",
    severity: "critical",
    priority: "p1",
    status: "resolved",
    assignee: "security",
    assets: ["prd-fw-01", "prd-fw-02"],
    openedHoursAgo: 144,
    rootCause: "The rule change was committed to the primary firewall only; forced synchronisation had been disabled during a change freeze.",
    resolution: "Re-enabled synchronisation, pushed the configuration to the passive unit and verified both members match.",
  },
  {
    key: "inc-k8s-drain",
    title: "Unexpected node drain on prd-k8s-node-02",
    description: "The node cordoned itself and evicted workloads to node 01 after failing the memory pressure check.",
    severity: "low",
    priority: "p4",
    status: "investigating",
    assignee: "cloud",
    assets: ["prd-k8s-node-02", "prd-k8s-node-01"],
    openedHoursAgo: 30,
    comments: [{ author: "cloud", body: "Memory usage is normal after eviction. Checking the pod requests that drove the eviction.", hoursAgo: 18 }],
  },
  {
    key: "inc-redis-memory",
    title: "Redis memory usage climbing on prd-redis-01",
    description: "Cache memory grew from 4.1 GB to 7.6 GB in 48 hours; eviction is not configured on the cache workload.",
    severity: "medium",
    priority: "p3",
    status: "open",
    assignee: "cloud",
    assets: ["prd-redis-01"],
    openedHoursAgo: 48,
  },
];

export type DemoFindingStatus = "open" | "in_progress" | "resolved" | "accepted_risk";
export type DemoFindingSeverity = "critical" | "high" | "medium" | "low" | "informational";

export interface DemoFindingSpec {
  key: string;
  title: string;
  description: string;
  severity: DemoFindingSeverity;
  status: DemoFindingStatus;
  asset: string | null;
  assignee: string;
  remediation: string;
  detectedDaysAgo: number;
  resolvedDaysAgo?: number;
  /** Required when the status is accepted_risk. */
  acceptNote?: string;
  progressNote?: string;
}

const demoFindingDescription = (body: string) =>
  `${body}\n\nDemonstration finding created by the InfraPilot demo seeder for presentation purposes. It was not produced by a vulnerability scan of your infrastructure.`;

export const DEMO_FINDINGS: DemoFindingSpec[] = [
  {
    key: "fd-tls-weak",
    title: "TLS 1.0 and 1.1 still enabled on the storefront listener",
    description: demoFindingDescription("The public listener on prd-lb-01 accepts TLS 1.0 and 1.1 handshakes, which are deprecated and allow downgrade attacks."),
    severity: "critical",
    status: "open",
    asset: "prd-lb-01",
    assignee: "security",
    remediation: "Disable TLS 1.0/1.1 on the listener, keep TLS 1.2 and 1.3 with the approved cipher suite, then re-test with an external TLS scanner.",
    detectedDaysAgo: 2,
  },
  {
    key: "fd-mgmt-port",
    title: "Firewall management interface reachable from the user VLAN",
    description: demoFindingDescription("Administrative access to prd-fw-01 is permitted from the user VLAN instead of only the management VLAN."),
    severity: "critical",
    status: "in_progress",
    asset: "prd-fw-01",
    assignee: "security",
    remediation: "Restrict HTTPS/SSH administration to the management subnet, remove the user VLAN rule and confirm with a connectivity test.",
    detectedDaysAgo: 3,
    progressNote: "Rule change drafted as CHG for the next maintenance window.",
  },
  {
    key: "fd-patches",
    title: "Missing operating system security updates on the file server",
    description: demoFindingDescription("prd-win-files-01 is 34 cumulative updates behind the approved patch baseline."),
    severity: "high",
    status: "in_progress",
    asset: "prd-win-files-01",
    assignee: "operator",
    remediation: "Apply the monthly security baseline during the Windows patching window and reboot within the maintenance period.",
    detectedDaysAgo: 6,
    progressNote: "Scheduled with the monthly patching window.",
  },
  {
    key: "fd-ssh-root",
    title: "Direct root SSH login permitted on the application server",
    description: demoFindingDescription("prd-app-02 allows password-based root SSH login, which removes accountability and exposes the host to brute force."),
    severity: "high",
    status: "resolved",
    asset: "prd-app-02",
    assignee: "operator",
    remediation: "Set PermitRootLogin to prohibit-password, require key-based access for named accounts and restart sshd.",
    detectedDaysAgo: 21,
    resolvedDaysAgo: 14,
  },
  {
    key: "fd-storage-unenc",
    title: "Storage account not using customer-managed keys",
    description: demoFindingDescription("az-storage-prod-01 is encrypted with platform-managed keys although the data classification requires customer-managed keys."),
    severity: "high",
    status: "accepted_risk",
    asset: "az-storage-prod-01",
    assignee: "cloud",
    remediation: "Configure a customer-managed key from az-kv-prod-01 and rotate the existing key version.",
    detectedDaysAgo: 30,
    acceptNote: "Risk accepted until the Q3 key migration; compensating controls are private endpoints and restricted network access.",
  },
  {
    key: "fd-endpoint-protection",
    title: "Endpoint protection agent not reporting on prd-app-01",
    description: demoFindingDescription("The endpoint protection agent on prd-app-01 has not checked in for nine days."),
    severity: "medium",
    status: "open",
    asset: "prd-app-01",
    assignee: "operator",
    remediation: "Restart the agent service, verify connectivity to the management console and confirm a successful policy sync.",
    detectedDaysAgo: 9,
  },
  {
    key: "fd-pkg-outdated",
    title: "Outdated HTTP server package on the secondary web node",
    description: demoFindingDescription("prd-web-02 runs an HTTP server build with known defects fixed in the current stable release."),
    severity: "medium",
    status: "resolved",
    asset: "prd-web-02",
    assignee: "operator",
    remediation: "Upgrade the package to the approved version and restart the service during the next deployment window.",
    detectedDaysAgo: 40,
    resolvedDaysAgo: 33,
  },
  {
    key: "fd-smb-signing",
    title: "SMB signing not required on the file share",
    description: demoFindingDescription("SMB signing is optional on prd-win-files-01, which permits relay attacks inside the server VLAN."),
    severity: "medium",
    status: "in_progress",
    asset: "prd-win-files-01",
    assignee: "operator",
    remediation: "Enable the signed-communications policy on the server and domain, then verify clients negotiate signing.",
    detectedDaysAgo: 12,
    progressNote: "Pilot on the file server completed; domain policy rollout pending.",
  },
  {
    key: "fd-net-acl",
    title: "Overly permissive network security group rule",
    description: demoFindingDescription("A rule on the hub virtual network allows any source to reach the management subnet on port 3389."),
    severity: "medium",
    status: "open",
    asset: "az-hub-vnet",
    assignee: "cloud",
    remediation: "Scope the rule to the operations jump host subnet, or replace it with just-in-time access.",
    detectedDaysAgo: 5,
  },
  {
    key: "fd-password-policy",
    title: "Password policy below the internal standard",
    description: demoFindingDescription("The identity policy permits 10-character passwords without a breach-list check."),
    severity: "low",
    status: "resolved",
    asset: null,
    assignee: "security",
    remediation: "Raise the minimum length to 14 characters and enable the breached-password check.",
    detectedDaysAgo: 60,
    resolvedDaysAgo: 51,
  },
  {
    key: "fd-audit-logging",
    title: "Diagnostic settings missing for the monitoring workspace",
    description: demoFindingDescription("az-monitor-01 does not forward activity logs to the central workspace, limiting investigation capability."),
    severity: "low",
    status: "open",
    asset: "az-monitor-01",
    assignee: "cloud",
    remediation: "Enable diagnostic settings for the subscription activity log and validate ingestion in the workspace.",
    detectedDaysAgo: 15,
  },
  {
    key: "fd-cert-expiry",
    title: "Certificate inventory entry approaching expiry",
    description: demoFindingDescription("The storefront certificate on prd-lb-01 expires in 21 days and renewal automation has not run."),
    severity: "informational",
    status: "open",
    asset: "prd-lb-01",
    assignee: "security",
    remediation: "Confirm the renewal automation identity and re-run the staged renewal before the expiry date.",
    detectedDaysAgo: 1,
  },
];

export type DemoMaintenanceStatus = "scheduled" | "in_progress" | "completed" | "cancelled";

export interface DemoMaintenanceSpec {
  key: string;
  title: string;
  description: string;
  owner: string;
  assets: string[];
  status: DemoMaintenanceStatus;
  /** Hours from now; negative values are in the past. */
  startOffsetHours: number;
  durationHours: number;
  notes?: string;
}

export const DEMO_MAINTENANCE: DemoMaintenanceSpec[] = [
  {
    key: "mt-win-patching",
    title: "Monthly Windows security patching",
    description: "Apply the July cumulative security updates to the Windows estate, reboot, and confirm the patch baseline.",
    owner: "operator",
    assets: ["prd-win-files-01", "dev-ws-01"],
    status: "scheduled",
    startOffsetHours: 72,
    durationHours: 4,
  },
  {
    key: "mt-linux-security",
    title: "Linux security updates for the web tier",
    description: "Install security errata for the production web tier and restart the application service in a rolling fashion.",
    owner: "cloud",
    assets: ["prd-web-01", "prd-web-02", "prd-app-01"],
    status: "scheduled",
    startOffsetHours: 144,
    durationHours: 3,
  },
  {
    key: "mt-db-vacuum",
    title: "Database maintenance and vacuum",
    description: "Run VACUUM ANALYZE, refresh statistics and verify replica lag stays below 30 seconds during the window.",
    owner: "cloud",
    assets: ["prd-db-01", "prd-db-02"],
    status: "scheduled",
    startOffsetHours: 240,
    durationHours: 2,
  },
  {
    key: "mt-fw-firmware",
    title: "Firewall firmware upgrade (HA pair)",
    description: "Upgrade both members of the firewall HA pair, fail over between members and verify rule parity afterwards.",
    owner: "security",
    assets: ["prd-fw-01", "prd-fw-02"],
    status: "scheduled",
    startOffsetHours: 504,
    durationHours: 5,
  },
  {
    key: "mt-backup-verify",
    title: "Backup verification and restore test",
    description: "Restore the latest database recovery point into an isolated environment and verify integrity of the backup chain.",
    owner: "operator",
    assets: ["prd-backup-01"],
    status: "in_progress",
    startOffsetHours: -1,
    durationHours: 3,
    notes: "Restore running in the isolated lab network.",
  },
  {
    key: "mt-cert-renewal",
    title: "Certificate renewal for the storefront listener",
    description: "Renew the storefront certificate, install it on the load balancer and verify the chain before the expiry date.",
    owner: "security",
    assets: ["prd-lb-01"],
    status: "scheduled",
    startOffsetHours: 288,
    durationHours: 1,
  },
  {
    key: "mt-network-core",
    title: "Core switch firmware and configuration backup",
    description: "Back up the running configuration, apply the approved IOS-XE maintenance release and verify uplink redundancy.",
    owner: "security",
    assets: ["prd-core-sw-01"],
    status: "completed",
    startOffsetHours: -96,
    durationHours: 3,
    notes: "Completed without impact. Configuration backup stored in the network repository.",
  },
  {
    key: "mt-app-deploy",
    title: "Application deployment window (cancelled)",
    description: "Planned deployment of the checkout release, cancelled because the release did not pass regression testing.",
    owner: "cloud",
    assets: ["prd-app-02"],
    status: "cancelled",
    startOffsetHours: -48,
    durationHours: 2,
    notes: "Cancelled by the release manager; new window to be requested.",
  },
];

export type DemoChangeStatus = "draft" | "pending_approval" | "approved" | "rejected" | "implemented" | "rolled_back" | "cancelled";
export type DemoRiskLevel = "low" | "medium" | "high";

export interface DemoChangeSpec {
  key: string;
  title: string;
  description: string;
  reason: string;
  riskLevel: DemoRiskLevel;
  riskAssessment: string;
  rollbackPlan: string;
  requester: string;
  implementer: string;
  assets: string[];
  status: DemoChangeStatus;
  plannedStartOffsetHours: number;
  plannedDurationHours: number;
  decisionComment?: string;
  implementationNotes?: string;
  rollbackNotes?: string;
}

export const DEMO_CHANGES: DemoChangeSpec[] = [
  {
    key: "chg-deploy-checkout",
    title: "Deploy checkout service release 2026.7.2",
    description: "Roll out the checkout service release to the production web tier with a canary step on prd-web-01.",
    reason: "The release fixes the connection-pool exhaustion behind the recent 503 responses.",
    riskLevel: "high",
    riskAssessment: "Customer-facing checkout path. Canary on one node limits blast radius; database connections are pooled per instance.",
    rollbackPlan: "Redeploy the previous image tag on both nodes, verify cart health checks and confirm order creation in staging.",
    requester: "operator",
    implementer: "operator",
    assets: ["prd-web-01", "prd-web-02"],
    status: "approved",
    plannedStartOffsetHours: 24,
    plannedDurationHours: 2,
    decisionComment: "Approved for the Tuesday window; monitor 503 rate for 30 minutes after cutover.",
  },
  {
    key: "chg-db-upgrade",
    title: "Upgrade prd-db-01 to PostgreSQL 16.4",
    description: "Minor version upgrade of the primary database with a logical replica available for cutover.",
    reason: "Includes fixes for two defects observed in the query planner under high concurrency.",
    riskLevel: "medium",
    riskAssessment: "Primary database upgrade requires a short write freeze. Replica remains readable during the window.",
    rollbackPlan: "Restore the pre-upgrade physical backup and repoint the service to the replica if the upgrade fails validation.",
    requester: "cloud",
    implementer: "cloud",
    assets: ["prd-db-01"],
    status: "pending_approval",
    plannedStartOffsetHours: 120,
    plannedDurationHours: 3,
  },
  {
    key: "chg-fw-rules",
    title: "Restrict firewall management access to the management VLAN",
    description: "Remove the legacy user-VLAN rule that permits administrative access to prd-fw-01.",
    reason: "Remediates the critical finding about the exposed management interface.",
    riskLevel: "medium",
    riskAssessment: "Low blast radius: only administrative sessions are affected. Engineers on the management VLAN keep access.",
    rollbackPlan: "Re-add the previous rule from the configuration backup, then verify HTTPS administration from the management host.",
    requester: "security",
    implementer: "security",
    assets: ["prd-fw-01"],
    status: "implemented",
    plannedStartOffsetHours: -48,
    plannedDurationHours: 1,
    decisionComment: "Approved: aligns administrative access with the network standard.",
    implementationNotes: "Rule removed, configuration committed and administration verified from the management host.",
  },
  {
    key: "chg-rotate-creds",
    title: "Rotate Key Vault access credentials",
    description: "Rotate the service principal secret used by the certificate automation and update the Key Vault reference.",
    reason: "Quarterly credential rotation.",
    riskLevel: "low",
    riskAssessment: "No service interruption expected; both values remain valid during overlap.",
    rollbackPlan: "Restore the previous secret version in Key Vault and restart the automation job.",
    requester: "cloud",
    implementer: "cloud",
    assets: ["az-kv-prod-01"],
    status: "draft",
    plannedStartOffsetHours: 168,
    plannedDurationHours: 1,
  },
  {
    key: "chg-backup-cfg",
    title: "Extend backup retention to 60 days",
    description: "Increase the retention policy for the production repository from 30 to 60 days.",
    reason: "Audit requested longer retention for the reporting database.",
    riskLevel: "medium",
    riskAssessment: "Requires additional repository capacity of about 4 TB; no impact to running jobs.",
    rollbackPlan: "Revert the policy to 30 days; existing restore points are unaffected.",
    requester: "operator",
    implementer: "operator",
    assets: ["prd-backup-01"],
    status: "rejected",
    plannedStartOffsetHours: 96,
    plannedDurationHours: 1,
    decisionComment: "Rejected until the storage budget is approved for the additional capacity.",
  },
  {
    key: "chg-os-upgrade",
    title: "Upgrade prd-app-02 to RHEL 9.5",
    description: "In-place minor release upgrade of the application server operating system.",
    reason: "Required to stay inside the supported kernel branch and to close the current patch gap.",
    riskLevel: "high",
    riskAssessment: "In-place upgrade requires a reboot; the second application node carries traffic during the window.",
    rollbackPlan: "Boot the previous snapshot and reattach the data volume if the upgrade fails the smoke test.",
    requester: "operator",
    implementer: "operator",
    assets: ["prd-app-02"],
    status: "approved",
    plannedStartOffsetHours: 216,
    plannedDurationHours: 4,
    decisionComment: "Approved with a mandatory smoke test before traffic is restored.",
  },
  {
    key: "chg-net-reconfig",
    title: "Reconfigure core switch uplink VLANs",
    description: "Consolidate the uplink VLANs on the core switch ahead of the data centre migration.",
    reason: "Simplifies the Layer 2 design before the migration cutover.",
    riskLevel: "high",
    riskAssessment: "High impact: a misconfiguration would isolate the server VLAN.",
    rollbackPlan: "Restore the saved configuration and reload the switch out of hours.",
    requester: "security",
    implementer: "security",
    assets: ["prd-core-sw-01"],
    status: "cancelled",
    plannedStartOffsetHours: -24,
    plannedDurationHours: 3,
    decisionComment: "Cancel pending the migration freeze.",
  },
  {
    key: "chg-monitor-agent",
    title: "Deploy monitoring agent to the k3s nodes",
    description: "Install the node agent on both k3s nodes and register them with the monitoring service.",
    reason: "Closes the observability gap for node-level metrics.",
    riskLevel: "low",
    riskAssessment: "Additive change with a DaemonSet; agent is limited to 100m CPU and 128Mi memory.",
    rollbackPlan: "Remove the DaemonSet and confirm node metrics return to the previous collection path.",
    requester: "cloud",
    implementer: "operator",
    assets: ["prd-k8s-node-01", "prd-k8s-node-02"],
    status: "rolled_back",
    plannedStartOffsetHours: -120,
    plannedDurationHours: 2,
    decisionComment: "Approved for the maintenance window.",
    implementationNotes: "DaemonSet applied to both nodes.",
    rollbackNotes: "Agent caused kubelet restarts on node 02; DaemonSet removed and the change rolled back.",
  },
];

export type DemoNotificationSpec = {
  key: string;
  recipient: string;
  type:
    | "monitoring_unavailable"
    | "monitoring_recovered"
    | "critical_finding"
    | "incident_assigned"
    | "incident_updated"
    | "maintenance_scheduled"
    | "maintenance_reminder"
    | "change_pending_approval"
    | "change_decision"
    | "general";
  title: string;
  message: string;
  link:
    | { kind: "incident"; key: string }
    | { kind: "finding"; key: string }
    | { kind: "change"; key: string }
    | { kind: "maintenance"; key: string; status?: string }
    | { kind: "none" };
  read: boolean;
  hoursAgo: number;
};

export const DEMO_NOTIFICATIONS: DemoNotificationSpec[] = [
  { key: "ntf-db-unavailable", recipient: "admin", type: "monitoring_unavailable", title: "prd-db-02 replica PostgreSQL is unavailable", message: "4 consecutive failed checks (ECONNREFUSED on 5432).", link: { kind: "incident", key: "inc-db-replica" }, read: false, hoursAgo: 5 },
  { key: "ntf-p1-assigned", recipient: "operator", type: "incident_assigned", title: "INC assigned: database replica not accepting connections", message: "You are the assignee for the prd-db-02 replica incident.", link: { kind: "incident", key: "inc-db-replica" }, read: false, hoursAgo: 4 },
  { key: "ntf-critical-tls", recipient: "security", type: "critical_finding", title: "New critical security finding", message: "TLS 1.0/1.1 enabled on the storefront listener (prd-lb-01).", link: { kind: "finding", key: "fd-tls-weak" }, read: false, hoursAgo: 47 },
  { key: "ntf-critical-fw", recipient: "admin", type: "critical_finding", title: "New critical security finding", message: "Firewall management interface reachable from the user VLAN.", link: { kind: "finding", key: "fd-mgmt-port" }, read: false, hoursAgo: 70 },
  { key: "ntf-change-approval", recipient: "admin", type: "change_pending_approval", title: "CHG awaiting approval: PostgreSQL 16.4 upgrade", message: "prd-db-01 minor version upgrade requires a decision.", link: { kind: "change", key: "chg-db-upgrade" }, read: false, hoursAgo: 20 },
  { key: "ntf-change-approved", recipient: "operator", type: "change_decision", title: "Change approved: checkout release 2026.7.2", message: "Approved for the Tuesday window by Priya Raman.", link: { kind: "change", key: "chg-deploy-checkout" }, read: true, hoursAgo: 28 },
  { key: "ntf-change-rejected", recipient: "operator", type: "change_decision", title: "Change rejected: extend backup retention", message: "Rejected until the storage budget is approved.", link: { kind: "change", key: "chg-backup-cfg" }, read: true, hoursAgo: 40 },
  { key: "ntf-maint-reminder", recipient: "operator", type: "maintenance_reminder", title: "Maintenance starts in 3 days: Windows security patching", message: "Monthly Windows patching covers prd-win-files-01 and dev-ws-01.", link: { kind: "maintenance", key: "mt-win-patching" }, read: false, hoursAgo: 12 },
  { key: "ntf-maint-progress", recipient: "admin", type: "maintenance_scheduled", title: "Maintenance in progress: backup verification", message: "Restore test running in the isolated lab network.", link: { kind: "maintenance", key: "mt-backup-verify" }, read: true, hoursAgo: 1 },
  { key: "ntf-recovered", recipient: "cloud", type: "monitoring_recovered", title: "prd-k8s-node-01 kubelet recovered", message: "Service returned to healthy after 3 failed checks.", link: { kind: "none" }, read: true, hoursAgo: 18 },
  { key: "ntf-vpn-open", recipient: "security", type: "incident_assigned", title: "INC assigned: SSL VPN latency above 2 seconds", message: "You are the assignee for the VPN gateway incident.", link: { kind: "incident", key: "inc-vpn-latency" }, read: false, hoursAgo: 3 },
  { key: "ntf-incident-update", recipient: "operator", type: "incident_updated", title: "New update on the checkout 503 incident", message: "Elena Sokolova added a note about connection pool timeouts.", link: { kind: "incident", key: "inc-checkout-5xx" }, read: true, hoursAgo: 6 },
  { key: "ntf-redis", recipient: "cloud", type: "general", title: "Cache memory trending upward", message: "prd-redis-01 grew from 4.1 GB to 7.6 GB in 48 hours.", link: { kind: "incident", key: "inc-redis-memory" }, read: false, hoursAgo: 30 },
  { key: "ntf-welcome", recipient: "auditor", type: "general", title: "Read-only demo access", message: "Your account can review assets, incidents, findings, changes and maintenance without making changes.", link: { kind: "none" }, read: true, hoursAgo: 96 },
];

/**
 * Extra narration for the audit log. These rows describe events the seeder itself performed or
 * explicitly labels as seeded history; they never claim a real human sign-in.
 */
export const DEMO_AUDIT_EVENTS: Array<{
  key: string;
  actor: string;
  action: string;
  entityType: string;
  entity: { kind: "asset" | "incident" | "finding" | "change" | "maintenance" | "user" | "none"; key?: string };
  summary: string;
  hoursAgo: number;
}> = [
  { key: "aud-login-admin", actor: "admin", action: "auth.login", entityType: "user", entity: { kind: "user", key: "admin" }, summary: "Demo history: sign-in by the demo administrator account", hoursAgo: 26 },
  { key: "aud-login-operator", actor: "operator", action: "auth.login", entityType: "user", entity: { kind: "user", key: "operator" }, summary: "Demo history: sign-in by the demo infrastructure engineer", hoursAgo: 25 },
  { key: "aud-login-failed", actor: "auditor", action: "auth.login_failed", entityType: "user", entity: { kind: "user", key: "auditor" }, summary: "Demo history: rejected sign-in attempt for the demo auditor account", hoursAgo: 24 },
  { key: "aud-asset-review", actor: "operator", action: "asset.updated", entityType: "asset", entity: { kind: "asset", key: "prd-nas-01" }, summary: "Demo history: review of the storage appliance record with no field changes", hoursAgo: 22 },
  { key: "aud-monitor-queue", actor: "operator", action: "monitoring_target.check_queued", entityType: "monitoring_target", entity: { kind: "none" }, summary: "Demo history: on-demand check queued for the storefront monitor", hoursAgo: 12 },
  { key: "aud-role-review", actor: "admin", action: "user.updated", entityType: "user", entity: { kind: "user", key: "auditor" }, summary: "Demo history: quarterly access review confirmed the auditor read-only role", hoursAgo: 8 },
];

/** Notification links resolved at seed time; kept here so both the seeder and tests agree. */
export function demoNotificationLinkTarget(link: DemoNotificationSpec["link"]): { kind: string; key?: string } {
  return { kind: link.kind, key: "key" in link ? link.key : undefined };
}
