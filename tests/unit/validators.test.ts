import { describe, expect, it } from "vitest";
import {
  assetCreateSchema,
  changeTransitionSchema,
  incidentCreateSchema,
  monitorCreateSchema,
  registerSchema,
  maintenanceCreateSchema,
} from "@/validators/schemas";

describe("registration validation", () => {
  it("rejects weak passwords", () => {
    const result = registerSchema.safeParse({ name: "Ada", email: "ada@example.com", password: "weakpassword" });
    expect(result.success).toBe(false);
  });

  it("accepts a strong password and normalises the email", () => {
    const result = registerSchema.safeParse({ name: " Ada ", email: " ADA@Example.com ", password: "Strong-Passw0rd" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe("ada@example.com");
      expect(result.data.name).toBe("Ada");
    }
  });
});

describe("monitoring configuration validation", () => {
  it("requires a URL for HTTP checks", () => {
    const result = monitorCreateSchema.safeParse({ name: "API", monitorType: "http" });
    expect(result.success).toBe(false);
  });

  it("requires host and port for TCP checks", () => {
    expect(monitorCreateSchema.safeParse({ name: "DB", monitorType: "tcp", host: "db.example.com" }).success).toBe(false);
    expect(monitorCreateSchema.safeParse({ name: "DB", monitorType: "tcp", host: "db.example.com", port: 5432 }).success).toBe(true);
  });

  it("rejects intervals below 30 seconds", () => {
    expect(monitorCreateSchema.safeParse({ name: "x", monitorType: "http", url: "https://example.com", intervalSeconds: 5 }).success).toBe(false);
  });
});

describe("asset validation", () => {
  it("rejects malformed IP addresses", () => {
    const result = assetCreateSchema.safeParse({ name: "srv", assetType: "physical_server", ipAddress: "999.1.1.1" });
    expect(result.success).toBe(false);
  });

  it("accepts a minimal valid asset", () => {
    const result = assetCreateSchema.safeParse({ name: "srv", assetType: "physical_server" });
    expect(result.success).toBe(true);
  });
});

describe("workflow validation", () => {
  it("requires rollback notes", () => {
    expect(changeTransitionSchema.safeParse({ action: "rollback" }).success).toBe(false);
    expect(changeTransitionSchema.safeParse({ action: "rollback", notes: "Reverted config" }).success).toBe(true);
  });

  it("rejects incident assignees that are not UUIDs", () => {
    const result = incidentCreateSchema.safeParse({
      title: "Outage",
      description: "Details",
      severity: "high",
      priority: "p1",
      assigneeId: "not-a-uuid",
      assetIds: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects maintenance windows that end before they start", () => {
    const result = maintenanceCreateSchema.safeParse({
      title: "Patch",
      description: "Kernel update",
      startsAt: "2030-01-02T10:00:00.000Z",
      endsAt: "2030-01-02T09:00:00.000Z",
      assetIds: [],
    });
    expect(result.success).toBe(false);
  });
});
