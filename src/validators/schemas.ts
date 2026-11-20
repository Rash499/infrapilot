import { z } from "zod";

/* ---------- shared primitives ---------- */

export const uuid = z.uuid({ message: "Must be a valid UUID" });
export const isoDate = z.iso.datetime({ offset: true, message: "Must be an ISO 8601 date-time" });

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const sortOrder = z.enum(["asc", "desc"]).default("desc");

const trimmed = (max: number) => z.string().trim().min(1, "Required").max(max);
const optionalTrimmed = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));
const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

/* ---------- auth & users ---------- */

export const passwordSchema = z
  .string()
  .min(12, "Password must be at least 12 characters")
  .max(128, "Password must be at most 128 characters")
  .regex(/[a-z]/, "Password must include a lowercase letter")
  .regex(/[A-Z]/, "Password must include an uppercase letter")
  .regex(/[0-9]/, "Password must include a number");

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(255)
  .pipe(z.email("Enter a valid email address"));

export const registerSchema = z.object({
  name: trimmed(120),
  email: emailSchema,
  password: passwordSchema,
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required").max(128),
});

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  password: passwordSchema,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required").max(128),
  newPassword: passwordSchema,
});

export const updateProfileSchema = z.object({ name: trimmed(120) });

export const userRole = z.enum(["admin", "operator", "viewer"]);

export const updateUserSchema = z
  .object({
    name: trimmed(120).optional(),
    role: userRole.optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "At least one field is required");

export const userListQuery = paginationQuery.extend({
  search: z.string().trim().max(100).optional(),
  role: userRole.optional(),
});

/* ---------- assets ---------- */

export const assetTypes = [
  "physical_server",
  "virtual_machine",
  "network_device",
  "cloud_resource",
  "container",
  "database",
  "application",
  "other",
] as const;
export const environments = ["development", "testing", "production"] as const;
export const assetStatuses = ["healthy", "degraded", "unavailable", "maintenance", "unknown"] as const;

const hostnameSchema = z
  .string()
  .trim()
  .max(255)
  .regex(/^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$/, "Hostname contains invalid characters")
  .or(z.literal(""))
  .nullish()
  .transform((v) => (v ? v : null));

const ipSchema = z
  .string()
  .trim()
  .max(64)
  .refine((v) => v === "" || z.ipv4().or(z.ipv6()).safeParse(v).success, "Enter a valid IPv4 or IPv6 address")
  .nullish()
  .transform((v) => (v ? v : null));

export const assetBodySchema = z.object({
  name: trimmed(160),
  assetType: z.enum(assetTypes),
  hostname: hostnameSchema,
  ipAddress: ipSchema,
  operatingSystem: optionalTrimmed(120),
  environment: z.enum(environments).default("development"),
  location: optionalTrimmed(160),
  ownerId: uuid.nullish().transform((v) => v ?? null),
  description: nullableText(4000),
  status: z.enum(assetStatuses).optional(),
});

export const assetCreateSchema = assetBodySchema;
export const assetUpdateSchema = assetBodySchema.omit({ environment: true }).partial().extend({
  environment: z.enum(environments).optional(),
  archived: z.boolean().optional(),
});

export const assetListQuery = paginationQuery.extend({
  search: z.string().trim().max(100).optional(),
  assetType: z.enum(assetTypes).optional(),
  environment: z.enum(environments).optional(),
  status: z.enum(assetStatuses).optional(),
  archived: z.enum(["true", "false"]).default("false"),
  sort: z.enum(["name", "assetType", "environment", "status", "createdAt", "updatedAt"]).default("name"),
  order: sortOrder,
});

/* ---------- monitoring ---------- */

export const monitorBodySchema = z.object({
  name: trimmed(160),
  monitorType: z.enum(["http", "tcp"]),
  url: z.string().trim().max(2048).optional().transform((v) => (v ? v : undefined)),
  host: hostnameSchema,
  port: z.coerce.number().int().min(1).max(65535).nullish().transform((v) => v ?? undefined),
  expectedStatusCode: z.coerce.number().int().min(100).max(599).nullish().transform((v) => v ?? undefined),
  intervalSeconds: z.coerce.number().int().min(30).max(86400).default(60),
  timeoutMs: z.coerce.number().int().min(500).max(30000).default(5000),
  degradedThresholdMs: z.coerce.number().int().min(50).max(60000).default(1000),
  enabled: z.boolean().default(true),
  allowPrivateNetwork: z.boolean().default(false),
  assetId: uuid.nullish().transform((v) => v ?? null),
});

export const monitorCreateSchema = monitorBodySchema.superRefine((v, ctx) => {
  if (v.monitorType === "http" && !v.url) {
    ctx.addIssue({ code: "custom", path: ["url"], message: "URL is required for HTTP checks" });
  }
  if (v.monitorType === "tcp") {
    if (!v.host) ctx.addIssue({ code: "custom", path: ["host"], message: "Host is required for TCP checks" });
    if (!v.port) ctx.addIssue({ code: "custom", path: ["port"], message: "Port is required for TCP checks" });
  }
});

export const monitorUpdateSchema = monitorBodySchema
  .omit({ intervalSeconds: true, timeoutMs: true, degradedThresholdMs: true, enabled: true, allowPrivateNetwork: true })
  .partial()
  .extend({
    intervalSeconds: z.coerce.number().int().min(30).max(86400).optional(),
    timeoutMs: z.coerce.number().int().min(500).max(30000).optional(),
    degradedThresholdMs: z.coerce.number().int().min(50).max(60000).optional(),
    enabled: z.boolean().optional(),
    allowPrivateNetwork: z.boolean().optional(),
  });

export const monitorListQuery = paginationQuery.extend({
  search: z.string().trim().max(100).optional(),
  state: z.enum(["healthy", "degraded", "unavailable", "unknown"]).optional(),
  monitorType: z.enum(["http", "tcp"]).optional(),
  sort: z.enum(["name", "status", "lastCheckedAt", "intervalSeconds"]).default("name"),
  order: sortOrder,
});

export const resultsQuery = paginationQuery.extend({
  range: z.enum(["1h", "24h", "7d", "30d"]).default("24h"),
});

/* ---------- security findings ---------- */

export const findingSeverities = ["critical", "high", "medium", "low", "informational"] as const;
export const findingStatuses = ["open", "in_progress", "resolved", "accepted_risk"] as const;

export const findingBodySchema = z.object({
  title: trimmed(200),
  description: trimmed(8000),
  severity: z.enum(findingSeverities),
  assetId: uuid.nullish().transform((v) => v ?? null),
  assigneeId: uuid.nullish().transform((v) => v ?? null),
  remediation: nullableText(8000),
  cveId: z
    .string()
    .trim()
    .max(32)
    .regex(/^(CVE-\d{4}-\d{4,}|)$/, "CVE ID must look like CVE-2024-12345")
    .nullish()
    .transform((v) => (v ? v : null)),
});

export const findingCreateSchema = findingBodySchema;

export const findingUpdateSchema = findingBodySchema.partial().extend({
  status: z.enum(findingStatuses).optional(),
  note: z.string().trim().max(2000).optional(),
});

export const findingListQuery = paginationQuery.extend({
  search: z.string().trim().max(100).optional(),
  severity: z.enum(findingSeverities).optional(),
  status: z.enum(findingStatuses).optional(),
  assetId: uuid.optional(),
  assigneeId: uuid.optional(),
  sort: z.enum(["severity", "createdAt", "updatedAt", "title"]).default("createdAt"),
  order: sortOrder,
});

/* ---------- incidents ---------- */

export const incidentSeverities = ["critical", "high", "medium", "low"] as const;
export const incidentPriorities = ["p1", "p2", "p3", "p4"] as const;
export const incidentStatuses = ["open", "investigating", "in_progress", "resolved", "closed"] as const;

export const incidentCreateSchema = z.object({
  title: trimmed(200),
  description: trimmed(8000),
  severity: z.enum(incidentSeverities),
  priority: z.enum(incidentPriorities),
  assigneeId: uuid.nullish().transform((v) => v ?? null),
  assetIds: z.array(uuid).max(50).default([]),
});

export const incidentUpdateSchema = z
  .object({
    title: trimmed(200).optional(),
    description: trimmed(8000).optional(),
    severity: z.enum(incidentSeverities).optional(),
    priority: z.enum(incidentPriorities).optional(),
    status: z.enum(incidentStatuses).optional(),
    assigneeId: uuid.nullish(),
    assetIds: z.array(uuid).max(50).optional(),
    rootCause: nullableText(8000).optional(),
    resolution: nullableText(8000).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "At least one field is required");

export const commentSchema = z.object({ body: trimmed(4000) });

export const incidentListQuery = paginationQuery.extend({
  search: z.string().trim().max(100).optional(),
  status: z.enum(incidentStatuses).optional(),
  severity: z.enum(incidentSeverities).optional(),
  priority: z.enum(incidentPriorities).optional(),
  assigneeId: uuid.optional(),
  assetId: uuid.optional(),
  active: z.enum(["true", "false"]).optional(),
  sort: z.enum(["openedAt", "severity", "priority", "updatedAt"]).default("openedAt"),
  order: sortOrder,
});

export const statsQuery = z.object({
  days: z.coerce.number().int().min(1).max(365).default(90),
});

/* ---------- maintenance ---------- */

export const maintenanceStatuses = ["scheduled", "in_progress", "completed", "cancelled"] as const;

const maintenanceFields = z.object({
  title: trimmed(200),
  description: trimmed(8000),
  startsAt: isoDate,
  endsAt: isoDate,
  ownerId: uuid.nullish().transform((v) => v ?? null),
  assetIds: z.array(uuid).max(100).default([]),
  notes: nullableText(4000),
});

export const maintenanceCreateSchema = maintenanceFields.refine(
  (v) => new Date(v.endsAt).getTime() > new Date(v.startsAt).getTime(),
  { message: "End time must be after start time", path: ["endsAt"] },
);

export const maintenanceUpdateSchema = maintenanceFields
  .omit({ assetIds: true })
  .partial()
  .extend({ assetIds: z.array(uuid).max(100).optional() })
  .extend({ status: z.enum(maintenanceStatuses).optional() })
  .refine((v) => Object.keys(v).length > 0, "At least one field is required");

export const maintenanceListQuery = paginationQuery.extend({
  search: z.string().trim().max(100).optional(),
  status: z.enum(maintenanceStatuses).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  sort: z.enum(["startsAt", "createdAt"]).default("startsAt"),
  order: z.enum(["asc", "desc"]).default("asc"),
});

/* ---------- change management ---------- */

export const changeRiskLevels = ["low", "medium", "high"] as const;
export const changeStatuses = [
  "draft",
  "pending_approval",
  "approved",
  "rejected",
  "implemented",
  "rolled_back",
  "cancelled",
] as const;

const changeFields = z.object({
  title: trimmed(200),
  description: trimmed(8000),
  reason: trimmed(4000),
  riskLevel: z.enum(changeRiskLevels).default("low"),
  riskAssessment: nullableText(8000),
  rollbackPlan: nullableText(8000),
  plannedStartAt: isoDate.nullish().transform((v) => v ?? null),
  plannedEndAt: isoDate.nullish().transform((v) => v ?? null),
  implementerId: uuid.nullish().transform((v) => v ?? null),
  assetIds: z.array(uuid).max(100).default([]),
});

export const changeCreateSchema = changeFields.refine(
  (v) => !v.plannedStartAt || !v.plannedEndAt || new Date(v.plannedEndAt) > new Date(v.plannedStartAt),
  { message: "Planned end must be after planned start", path: ["plannedEndAt"] },
);

export const changeUpdateSchema = changeFields
  .omit({ riskLevel: true, assetIds: true })
  .partial()
  .extend({
    riskLevel: z.enum(changeRiskLevels).optional(),
    assetIds: z.array(uuid).max(100).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "At least one field is required");

export const changeSubmitSchema = z.object({}).passthrough();

export const approvalSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  comment: nullableText(2000),
});

export const changeTransitionSchema = z
  .object({
    action: z.enum(["implement", "rollback", "cancel"]),
    notes: nullableText(8000),
  })
  .refine((v) => v.action !== "rollback" || !!v.notes, {
    message: "Rollback notes are required",
    path: ["notes"],
  });

export const changeListQuery = paginationQuery.extend({
  search: z.string().trim().max(100).optional(),
  status: z.enum(changeStatuses).optional(),
  riskLevel: z.enum(changeRiskLevels).optional(),
  sort: z.enum(["createdAt", "updatedAt", "plannedStartAt"]).default("createdAt"),
  order: sortOrder,
});

/* ---------- notifications, dashboard, audit ---------- */

export const notificationListQuery = paginationQuery.extend({
  unread: z.enum(["true", "false"]).default("false"),
});

export const dashboardQuery = z.object({
  days: z.coerce.number().int().refine((v) => [1, 7, 30, 90].includes(v), "days must be 1, 7, 30 or 90").default(7),
});

export const auditListQuery = paginationQuery.extend({
  entityType: z.string().trim().max(60).optional(),
  entityId: z.string().trim().max(64).optional(),
  actorId: uuid.optional(),
});

export type AssetInput = z.infer<typeof assetCreateSchema>;
export type MonitorInput = z.infer<typeof monitorCreateSchema>;
export type FindingInput = z.infer<typeof findingCreateSchema>;
export type IncidentCreateInput = z.infer<typeof incidentCreateSchema>;
export type MaintenanceInput = z.infer<typeof maintenanceCreateSchema>;
export type ChangeInput = z.infer<typeof changeCreateSchema>;
