CREATE TABLE "agent_events" (
	"id" text PRIMARY KEY NOT NULL,
	"process_instance_id" text NOT NULL,
	"step_id" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb,
	"sequence" bigint NOT NULL,
	"timestamp" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "process_instances" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace" text NOT NULL,
	"definition_name" text NOT NULL,
	"definition_version" text NOT NULL,
	"status" text NOT NULL,
	"current_step_id" text,
	"variables" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"trigger_type" text NOT NULL,
	"trigger_payload" jsonb,
	"pause_reason" text,
	"error" text,
	"assigned_roles" text[],
	"previous_run" jsonb,
	"previous_run_source_id" text,
	"total_cost_usd" numeric(12, 6),
	"created_by" text,
	"archived_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "step_executions" (
	"id" text PRIMARY KEY NOT NULL,
	"process_instance_id" text NOT NULL,
	"step_id" text NOT NULL,
	"status" text NOT NULL,
	"iteration_number" integer DEFAULT 1 NOT NULL,
	"input" jsonb,
	"output" jsonb,
	"verdict" text,
	"gate_result" jsonb,
	"error" text,
	"review_verdicts" jsonb,
	"agent_output" jsonb,
	"executed_by" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_events" ADD CONSTRAINT "agent_events_process_instance_id_process_instances_id_fk" FOREIGN KEY ("process_instance_id") REFERENCES "process_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_instances" ADD CONSTRAINT "process_instances_workspace_workspaces_handle_fk" FOREIGN KEY ("workspace") REFERENCES "workspaces"("handle") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_instances" ADD CONSTRAINT "process_instances_previous_run_source_id_process_instances_id_fk" FOREIGN KEY ("previous_run_source_id") REFERENCES "process_instances"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step_executions" ADD CONSTRAINT "step_executions_process_instance_id_process_instances_id_fk" FOREIGN KEY ("process_instance_id") REFERENCES "process_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_events_instance_step_sequence_idx" ON "agent_events" USING btree ("process_instance_id","step_id","sequence");--> statement-breakpoint
CREATE INDEX "process_instances_workspace_status_idx" ON "process_instances" USING btree ("workspace","status","created_at" DESC NULLS LAST) WHERE "process_instances"."deleted_at" is null and "process_instances"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "process_instances_workspace_def_status_idx" ON "process_instances" USING btree ("workspace","definition_name","status","updated_at" DESC NULLS LAST) WHERE "process_instances"."deleted_at" is null and "process_instances"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "step_executions_instance_step_started_idx" ON "step_executions" USING btree ("process_instance_id","step_id","started_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_process_instance_id_process_instances_id_fk" FOREIGN KEY ("process_instance_id") REFERENCES "process_instances"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_process_instance_id_process_instances_id_fk" FOREIGN KEY ("process_instance_id") REFERENCES "process_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "human_tasks" ADD CONSTRAINT "human_tasks_process_instance_id_process_instances_id_fk" FOREIGN KEY ("process_instance_id") REFERENCES "process_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoff_entities" ADD CONSTRAINT "handoff_entities_process_instance_id_process_instances_id_fk" FOREIGN KEY ("process_instance_id") REFERENCES "process_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cowork_sessions" ADD CONSTRAINT "cowork_sessions_process_instance_id_process_instances_id_fk" FOREIGN KEY ("process_instance_id") REFERENCES "process_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE TRIGGER process_instances_set_updated_at
	BEFORE UPDATE ON process_instances
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();
