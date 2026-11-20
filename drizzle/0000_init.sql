CREATE TYPE "public"."approval_decision" AS ENUM('approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."asset_status" AS ENUM('healthy', 'degraded', 'unavailable', 'maintenance', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."asset_type" AS ENUM('physical_server', 'virtual_machine', 'network_device', 'cloud_resource', 'container', 'database', 'application', 'other');--> statement-breakpoint
CREATE TYPE "public"."change_status" AS ENUM('draft', 'pending_approval', 'approved', 'rejected', 'implemented', 'rolled_back', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."comment_kind" AS ENUM('comment', 'system');--> statement-breakpoint
CREATE TYPE "public"."environment" AS ENUM('development', 'testing', 'production');--> statement-breakpoint
CREATE TYPE "public"."finding_severity" AS ENUM('critical', 'high', 'medium', 'low', 'informational');--> statement-breakpoint
CREATE TYPE "public"."finding_status" AS ENUM('open', 'in_progress', 'resolved', 'accepted_risk');--> statement-breakpoint
CREATE TYPE "public"."incident_priority" AS ENUM('p1', 'p2', 'p3', 'p4');--> statement-breakpoint
CREATE TYPE "public"."incident_severity" AS ENUM('critical', 'high', 'medium', 'low');--> statement-breakpoint
CREATE TYPE "public"."incident_status" AS ENUM('open', 'investigating', 'in_progress', 'resolved', 'closed');--> statement-breakpoint
CREATE TYPE "public"."maintenance_status" AS ENUM('scheduled', 'in_progress', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."monitor_type" AS ENUM('http', 'tcp');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('monitoring_unavailable', 'monitoring_recovered', 'critical_finding', 'incident_assigned', 'incident_updated', 'maintenance_scheduled', 'maintenance_reminder', 'change_pending_approval', 'change_decision', 'general');--> statement-breakpoint
CREATE TYPE "public"."risk_level" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."service_state" AS ENUM('healthy', 'degraded', 'unavailable', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'operator', 'viewer');--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(160) NOT NULL,
	"asset_type" "asset_type" NOT NULL,
	"hostname" varchar(255),
	"ip_address" varchar(64),
	"operating_system" varchar(120),
	"environment" "environment" DEFAULT 'development' NOT NULL,
	"location" varchar(160),
	"owner_id" uuid,
	"description" text,
	"status" "asset_status" DEFAULT 'unknown' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"action" varchar(80) NOT NULL,
	"entity_type" varchar(60) NOT NULL,
	"entity_id" varchar(64) NOT NULL,
	"summary" text NOT NULL,
	"metadata" jsonb,
	"ip_address" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "change_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"change_id" uuid NOT NULL,
	"approver_id" uuid,
	"decision" "approval_decision" NOT NULL,
	"comment" text,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "change_assets" (
	"change_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	CONSTRAINT "change_assets_change_id_asset_id_pk" PRIMARY KEY("change_id","asset_id")
);
--> statement-breakpoint
CREATE TABLE "change_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" serial NOT NULL,
	"title" varchar(200) NOT NULL,
	"description" text NOT NULL,
	"reason" text NOT NULL,
	"risk_level" "risk_level" DEFAULT 'low' NOT NULL,
	"risk_assessment" text,
	"rollback_plan" text,
	"status" "change_status" DEFAULT 'draft' NOT NULL,
	"requester_id" uuid,
	"implementer_id" uuid,
	"planned_start_at" timestamp with time zone,
	"planned_end_at" timestamp with time zone,
	"implementation_notes" text,
	"rollback_notes" text,
	"implemented_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "finding_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"finding_id" uuid NOT NULL,
	"actor_id" uuid,
	"from_status" "finding_status",
	"to_status" "finding_status",
	"note" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "incident_assets" (
	"incident_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	CONSTRAINT "incident_assets_incident_id_asset_id_pk" PRIMARY KEY("incident_id","asset_id")
);
--> statement-breakpoint
CREATE TABLE "incident_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"incident_id" uuid NOT NULL,
	"author_id" uuid,
	"kind" "comment_kind" DEFAULT 'comment' NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" serial NOT NULL,
	"title" varchar(200) NOT NULL,
	"description" text NOT NULL,
	"severity" "incident_severity" NOT NULL,
	"priority" "incident_priority" NOT NULL,
	"status" "incident_status" DEFAULT 'open' NOT NULL,
	"assignee_id" uuid,
	"reporter_id" uuid,
	"root_cause" text,
	"resolution" text,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "maintenance_assets" (
	"maintenance_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	CONSTRAINT "maintenance_assets_maintenance_id_asset_id_pk" PRIMARY KEY("maintenance_id","asset_id")
);
--> statement-breakpoint
CREATE TABLE "maintenances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(200) NOT NULL,
	"description" text NOT NULL,
	"status" "maintenance_status" DEFAULT 'scheduled' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"owner_id" uuid,
	"created_by_id" uuid,
	"notes" text,
	"reminder_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "monitoring_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_id" uuid NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"success" boolean NOT NULL,
	"state" "service_state" NOT NULL,
	"response_time_ms" integer,
	"status_code" integer,
	"error_message" text
);
--> statement-breakpoint
CREATE TABLE "monitoring_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(160) NOT NULL,
	"monitor_type" "monitor_type" NOT NULL,
	"url" text,
	"host" varchar(255),
	"port" integer,
	"expected_status_code" integer,
	"interval_seconds" integer DEFAULT 60 NOT NULL,
	"timeout_ms" integer DEFAULT 5000 NOT NULL,
	"degraded_threshold_ms" integer DEFAULT 1000 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"allow_private_network" boolean DEFAULT false NOT NULL,
	"asset_id" uuid,
	"status" "service_state" DEFAULT 'unknown' NOT NULL,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"last_checked_at" timestamp with time zone,
	"next_check_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_response_ms" integer,
	"last_error" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "notification_type" NOT NULL,
	"title" varchar(200) NOT NULL,
	"message" text NOT NULL,
	"link" varchar(300),
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"family_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"replaced_by_id" uuid,
	"user_agent" varchar(255),
	"ip_address" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "security_findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(200) NOT NULL,
	"description" text NOT NULL,
	"severity" "finding_severity" NOT NULL,
	"status" "finding_status" DEFAULT 'open' NOT NULL,
	"asset_id" uuid,
	"assignee_id" uuid,
	"remediation" text,
	"cve_id" varchar(32),
	"created_by_id" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"name" varchar(120) NOT NULL,
	"password_hash" text NOT NULL,
	"role" "user_role" DEFAULT 'viewer' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_approvals" ADD CONSTRAINT "change_approvals_change_id_change_requests_id_fk" FOREIGN KEY ("change_id") REFERENCES "public"."change_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_approvals" ADD CONSTRAINT "change_approvals_approver_id_users_id_fk" FOREIGN KEY ("approver_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_assets" ADD CONSTRAINT "change_assets_change_id_change_requests_id_fk" FOREIGN KEY ("change_id") REFERENCES "public"."change_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_assets" ADD CONSTRAINT "change_assets_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_implementer_id_users_id_fk" FOREIGN KEY ("implementer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finding_events" ADD CONSTRAINT "finding_events_finding_id_security_findings_id_fk" FOREIGN KEY ("finding_id") REFERENCES "public"."security_findings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finding_events" ADD CONSTRAINT "finding_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_assets" ADD CONSTRAINT "incident_assets_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_assets" ADD CONSTRAINT "incident_assets_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_comments" ADD CONSTRAINT "incident_comments_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_comments" ADD CONSTRAINT "incident_comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_assets" ADD CONSTRAINT "maintenance_assets_maintenance_id_maintenances_id_fk" FOREIGN KEY ("maintenance_id") REFERENCES "public"."maintenances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_assets" ADD CONSTRAINT "maintenance_assets_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenances" ADD CONSTRAINT "maintenances_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenances" ADD CONSTRAINT "maintenances_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitoring_results" ADD CONSTRAINT "monitoring_results_target_id_monitoring_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."monitoring_targets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitoring_targets" ADD CONSTRAINT "monitoring_targets_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitoring_targets" ADD CONSTRAINT "monitoring_targets_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_findings" ADD CONSTRAINT "security_findings_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_findings" ADD CONSTRAINT "security_findings_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_findings" ADD CONSTRAINT "security_findings_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assets_type_idx" ON "assets" USING btree ("asset_type");--> statement-breakpoint
CREATE INDEX "assets_environment_idx" ON "assets" USING btree ("environment");--> statement-breakpoint
CREATE INDEX "assets_status_idx" ON "assets" USING btree ("status");--> statement-breakpoint
CREATE INDEX "assets_hostname_idx" ON "assets" USING btree ("hostname");--> statement-breakpoint
CREATE INDEX "assets_name_idx" ON "assets" USING btree ("name");--> statement-breakpoint
CREATE INDEX "assets_archived_idx" ON "assets" USING btree ("archived_at");--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_created_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_actor_idx" ON "audit_logs" USING btree ("actor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "change_approvals_unique_uidx" ON "change_approvals" USING btree ("change_id","approver_id");--> statement-breakpoint
CREATE INDEX "change_assets_asset_idx" ON "change_assets" USING btree ("asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "changes_number_uidx" ON "change_requests" USING btree ("number");--> statement-breakpoint
CREATE INDEX "changes_status_idx" ON "change_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "changes_requester_idx" ON "change_requests" USING btree ("requester_id");--> statement-breakpoint
CREATE INDEX "changes_risk_idx" ON "change_requests" USING btree ("risk_level");--> statement-breakpoint
CREATE INDEX "finding_events_finding_idx" ON "finding_events" USING btree ("finding_id");--> statement-breakpoint
CREATE INDEX "incident_assets_asset_idx" ON "incident_assets" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "incident_comments_incident_idx" ON "incident_comments" USING btree ("incident_id");--> statement-breakpoint
CREATE UNIQUE INDEX "incidents_number_uidx" ON "incidents" USING btree ("number");--> statement-breakpoint
CREATE INDEX "incidents_status_idx" ON "incidents" USING btree ("status");--> statement-breakpoint
CREATE INDEX "incidents_severity_idx" ON "incidents" USING btree ("severity");--> statement-breakpoint
CREATE INDEX "incidents_assignee_idx" ON "incidents" USING btree ("assignee_id");--> statement-breakpoint
CREATE INDEX "incidents_opened_idx" ON "incidents" USING btree ("opened_at");--> statement-breakpoint
CREATE INDEX "maintenance_assets_asset_idx" ON "maintenance_assets" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "maintenances_starts_idx" ON "maintenances" USING btree ("starts_at");--> statement-breakpoint
CREATE INDEX "maintenances_status_idx" ON "maintenances" USING btree ("status");--> statement-breakpoint
CREATE INDEX "monitoring_results_target_time_idx" ON "monitoring_results" USING btree ("target_id","checked_at");--> statement-breakpoint
CREATE INDEX "monitoring_results_time_idx" ON "monitoring_results" USING btree ("checked_at");--> statement-breakpoint
CREATE INDEX "monitoring_targets_next_check_idx" ON "monitoring_targets" USING btree ("enabled","next_check_at");--> statement-breakpoint
CREATE INDEX "monitoring_targets_asset_idx" ON "monitoring_targets" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "monitoring_targets_status_idx" ON "monitoring_targets" USING btree ("status");--> statement-breakpoint
CREATE INDEX "notifications_user_read_idx" ON "notifications" USING btree ("user_id","read_at");--> statement-breakpoint
CREATE INDEX "notifications_created_idx" ON "notifications" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "password_reset_hash_uidx" ON "password_reset_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "password_reset_user_idx" ON "password_reset_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "refresh_tokens_hash_uidx" ON "refresh_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "refresh_tokens_user_idx" ON "refresh_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "refresh_tokens_family_idx" ON "refresh_tokens" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "findings_severity_idx" ON "security_findings" USING btree ("severity");--> statement-breakpoint
CREATE INDEX "findings_status_idx" ON "security_findings" USING btree ("status");--> statement-breakpoint
CREATE INDEX "findings_asset_idx" ON "security_findings" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "findings_assignee_idx" ON "security_findings" USING btree ("assignee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uidx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("role");