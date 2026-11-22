/**
 * Idempotent PostgreSQL → MongoDB data migration utility.
 *
 * Reads all 18 operational tables from PostgreSQL and upserts them into the corresponding
 * MongoDB collections while preserving UUID strings, numeric incident/change references,
 * timestamps, and join pairs. Never drops collections or existing documents.
 *
 *   npx tsx scripts/migrate-data.ts --dry-run   # inspect row counts & transform shapes without writing to MongoDB
 *   npx tsx scripts/migrate-data.ts             # ensure indexes and migrate data into MONGODB_URI / MONGODB_DB
 */

import "../src/lib/load-env";
import type { AnyBulkWriteOperation, Document } from "mongodb";
import { db, pool } from "@/db";
import * as pg from "@/db/schema";
import { initializeAppDatabase } from "@/db/app_db";
import { collections } from "@/db/collections";
import { closeMongo, getMongoDb } from "@/db/mongo";

const BATCH_SIZE = 1000;
const dryRun = process.argv.includes("--dry-run");

interface MigrationStep {
  name: string;
  collection: string;
  load: () => Promise<Array<{ filter: Record<string, unknown>; doc: Document }>>;
}

function withUuid<T extends { id: string }>(row: T): { filter: Record<string, unknown>; doc: Document } {
  return {
    filter: { id: row.id },
    doc: { _id: row.id, ...row },
  };
}

function joinPair<T extends Record<string, unknown>>(
  row: T,
  leftKey: keyof T & string,
  rightKey: keyof T & string,
): { filter: Record<string, unknown>; doc: Document } {
  const id = `${String(row[leftKey])}:${String(row[rightKey])}`;
  return {
    filter: { [leftKey]: row[leftKey], [rightKey]: row[rightKey] },
    doc: { _id: id, ...row },
  };
}

const STEPS: MigrationStep[] = [
  { name: "users", collection: collections.users, load: async () => (await db.select().from(pg.users)).map(withUuid) },
  { name: "refresh_tokens", collection: collections.refreshTokens, load: async () => (await db.select().from(pg.refreshTokens)).map(withUuid) },
  { name: "password_reset_tokens", collection: collections.passwordResetTokens, load: async () => (await db.select().from(pg.passwordResetTokens)).map(withUuid) },
  { name: "assets", collection: collections.assets, load: async () => (await db.select().from(pg.assets)).map(withUuid) },
  { name: "monitoring_targets", collection: collections.monitoringTargets, load: async () => (await db.select().from(pg.monitoringTargets)).map(withUuid) },
  { name: "monitoring_results", collection: collections.monitoringResults, load: async () => (await db.select().from(pg.monitoringResults)).map(withUuid) },
  { name: "security_findings", collection: collections.securityFindings, load: async () => (await db.select().from(pg.securityFindings)).map(withUuid) },
  { name: "finding_events", collection: collections.findingEvents, load: async () => (await db.select().from(pg.findingEvents)).map(withUuid) },
  { name: "incidents", collection: collections.incidents, load: async () => (await db.select().from(pg.incidents)).map(withUuid) },
  { name: "incident_assets", collection: collections.incidentAssets, load: async () => (await db.select().from(pg.incidentAssets)).map((r) => joinPair(r, "incidentId", "assetId")) },
  { name: "incident_comments", collection: collections.incidentComments, load: async () => (await db.select().from(pg.incidentComments)).map(withUuid) },
  { name: "maintenances", collection: collections.maintenances, load: async () => (await db.select().from(pg.maintenances)).map(withUuid) },
  { name: "maintenance_assets", collection: collections.maintenanceAssets, load: async () => (await db.select().from(pg.maintenanceAssets)).map((r) => joinPair(r, "maintenanceId", "assetId")) },
  { name: "change_requests", collection: collections.changeRequests, load: async () => (await db.select().from(pg.changeRequests)).map(withUuid) },
  { name: "change_assets", collection: collections.changeAssets, load: async () => (await db.select().from(pg.changeAssets)).map((r) => joinPair(r, "changeId", "assetId")) },
  { name: "change_approvals", collection: collections.changeApprovals, load: async () => (await db.select().from(pg.changeApprovals)).map(withUuid) },
  { name: "notifications", collection: collections.notifications, load: async () => (await db.select().from(pg.notifications)).map(withUuid) },
  { name: "audit_logs", collection: collections.auditLogs, load: async () => (await db.select().from(pg.auditLogs)).map(withUuid) },
];

async function main(): Promise<void> {
  console.log(`InfraPilot PostgreSQL → MongoDB migration (${dryRun ? "DRY RUN" : "LIVE"})`);

  if (!dryRun) {
    const init = await initializeAppDatabase();
    console.log(`MongoDB "${init.database}" initialized (${init.collectionsCreated} created, ${init.indexesEnsured} indexes ensured).`);
  }

  const mongoDb = dryRun ? null : await getMongoDb();
  let totalRows = 0;

  for (const step of STEPS) {
    const entries = await step.load();
    totalRows += entries.length;
    if (dryRun || !mongoDb || entries.length === 0) {
      console.log(`  • ${step.name.padEnd(24)} ${entries.length} rows${dryRun ? " (dry-run)" : ""}`);
      continue;
    }

    const col = mongoDb.collection(step.collection);
    let upserted = 0;
    let matched = 0;
    for (let i = 0; i < entries.length; i += BATCH_SIZE) {
      const batch = entries.slice(i, i + BATCH_SIZE);
      const ops: AnyBulkWriteOperation<Document>[] = batch.map((entry) => ({
        updateOne: {
          filter: entry.filter,
          update: { $setOnInsert: entry.doc },
          upsert: true,
        },
      }));
      const res = await col.bulkWrite(ops, { ordered: false });
      upserted += res.upsertedCount;
      matched += res.matchedCount;
    }
    console.log(`  ✓ ${step.name.padEnd(24)} ${entries.length} rows (${upserted} inserted, ${matched} already present)`);
  }

  console.log(`\nMigration ${dryRun ? "dry-run " : ""}complete: ${totalRows} total records across ${STEPS.length} collections.`);
}

main()
  .catch((err: unknown) => {
    console.error("Migration failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.allSettled([pool.end(), closeMongo()]);
  });
