import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { db, pool } from "@/db";
import {
  assets,
  changeAssets,
  changeRequests,
  incidentAssets,
  incidentComments,
  incidents,
  maintenanceAssets,
  maintenances,
  monitoringTargets,
  securityFindings,
  users,
} from "@/db/schema";
import { hashPassword } from "@/lib/security";

/**
 * Development seed. Idempotent: does nothing when users already exist.
 * Contains no production data. Set SEED_PASSWORD to choose the shared password; otherwise a random
 * one is generated and printed once to the console.
 */
async function main(): Promise<void> {
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(users);
  if (total > 0) {
    console.log("Seed skipped: users already exist.");
    return;
  }

  const generated = !process.env.SEED_PASSWORD;
  const password = process.env.SEED_PASSWORD ?? `${randomBytes(12).toString("base64url")}Aa1`;
  const passwordHash = await hashPassword(password);

  const [admin] = await db
    .insert(users)
    .values({ email: "admin@infrapilot.local", name: "Ada Admin", passwordHash, role: "admin" })
    .returning();
  const [operator] = await db
    .insert(users)
    .values({ email: "operator@infrapilot.local", name: "Olu Operator", passwordHash, role: "operator" })
    .returning();
  await db.insert(users).values({ email: "viewer@infrapilot.local", name: "Vera Viewer", passwordHash, role: "viewer" });
  if (!admin || !operator) throw new Error("Seed users could not be created");

  const inserted = await db
    .insert(assets)
    .values([
      { name: "web-prod-01", assetType: "virtual_machine", hostname: "web-prod-01.internal", ipAddress: "10.20.0.11", operatingSystem: "Ubuntu 24.04 LTS", environment: "production", location: "eu-west-1a", ownerId: operator.id, description: "Customer-facing web tier", createdById: admin.id },
      { name: "orders-db", assetType: "database", hostname: "orders-db.internal", ipAddress: "10.20.0.21", operatingSystem: "Debian 12", environment: "production", location: "eu-west-1b", ownerId: admin.id, description: "PostgreSQL 16 primary for orders", createdById: admin.id },
      { name: "core-switch-a", assetType: "network_device", hostname: "core-sw-a", ipAddress: "10.20.0.1", operatingSystem: "IOS-XE 17", environment: "production", location: "DC1 Rack A3", ownerId: operator.id, description: "Core distribution switch", createdById: admin.id },
      { name: "k8s-staging", assetType: "container", environment: "testing", location: "eu-central-1", ownerId: operator.id, description: "Staging Kubernetes cluster", createdById: admin.id },
      { name: "s3-exports", assetType: "cloud_resource", environment: "production", location: "eu-west-1", ownerId: admin.id, description: "Nightly export bucket", createdById: admin.id },
    ])
    .returning();
  const [web, orders, switchA] = inserted;
  if (!web || !orders || !switchA) throw new Error("Seed assets could not be created");

  await db.insert(monitoringTargets).values([
    { name: "Public website (HTTPS)", monitorType: "http", url: "https://www.iana.org/", host: "www.iana.org", intervalSeconds: 60, timeoutMs: 5000, degradedThresholdMs: 1500, assetId: web.id, createdById: admin.id },
    { name: "Public DNS resolver (TCP 53)", monitorType: "tcp", host: "1.1.1.1", port: 53, intervalSeconds: 120, timeoutMs: 3000, degradedThresholdMs: 500, assetId: switchA.id, createdById: admin.id },
  ]);

  await db.insert(securityFindings).values([
    { title: "TLS 1.0 enabled on load balancer", description: "The public listener accepts TLS 1.0 handshakes.", severity: "high", status: "open", assetId: web.id, assigneeId: operator.id, remediation: "Disable TLS 1.0 and 1.1 and enforce TLS 1.2+.", createdById: admin.id },
    { title: "Outdated OpenSSH on switch management plane", description: "Management SSH banner reports a version with known advisories.", severity: "medium", status: "in_progress", assetId: switchA.id, assigneeId: operator.id, remediation: "Upgrade firmware in the next maintenance window.", createdById: admin.id },
    { title: "Database superuser used by application", description: "The orders service connects with the superuser role.", severity: "critical", status: "open", assetId: orders.id, assigneeId: admin.id, remediation: "Create a least-privilege application role.", createdById: admin.id },
  ]);

  const [incident] = await db
    .insert(incidents)
    .values({
      title: "Elevated checkout latency",
      description: "p95 latency on checkout exceeded 2 seconds for 15 minutes.",
      severity: "high",
      priority: "p2",
      status: "investigating",
      assigneeId: operator.id,
      reporterId: admin.id,
    })
    .returning();
  if (incident) {
    await db.insert(incidentAssets).values([{ incidentId: incident.id, assetId: web.id }, { incidentId: incident.id, assetId: orders.id }]);
    await db.insert(incidentComments).values([
      { incidentId: incident.id, authorId: admin.id, kind: "system", body: "Incident opened by Ada Admin (High severity, P2)" },
      { incidentId: incident.id, authorId: operator.id, kind: "comment", body: "Connection pool saturation suspected on orders-db." },
    ]);
  }

  const [window] = await db
    .insert(maintenances)
    .values({
      title: "Orders database minor upgrade",
      description: "Apply PostgreSQL minor version update and restart the primary.",
      status: "scheduled",
      startsAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      endsAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000 + 2 * 60 * 60 * 1000),
      ownerId: operator.id,
      createdById: admin.id,
    })
    .returning();
  if (window) await db.insert(maintenanceAssets).values([{ maintenanceId: window.id, assetId: orders.id }]);

  const [change] = await db
    .insert(changeRequests)
    .values({
      title: "Rotate TLS certificates on web tier",
      description: "Replace the wildcard certificate on the public load balancer.",
      reason: "Current certificate expires in 21 days.",
      riskLevel: "medium",
      riskAssessment: "Brief connection resets possible during reload.",
      rollbackPlan: "Re-attach previous certificate bundle from the secrets store.",
      status: "pending_approval",
      requesterId: operator.id,
      implementerId: operator.id,
    })
    .returning();
  if (change) await db.insert(changeAssets).values([{ changeId: change.id, assetId: web.id }]);

  console.log("Seed complete: 3 users, 5 assets, 2 monitoring checks, 3 findings, 1 incident, 1 maintenance window, 1 change.");
  console.log("Accounts: admin@infrapilot.local (Administrator), operator@infrapilot.local (Operator), viewer@infrapilot.local (Viewer).");
  if (generated) console.log(`Generated shared password (store it now, it will not be shown again): ${password}`);
}

main()
  .catch((err: unknown) => {
    console.error("Seed failed:", err instanceof Error ? err.message : "unknown error");
    process.exitCode = 1;
  })
  .finally(() => {
    void pool.end();
  });
