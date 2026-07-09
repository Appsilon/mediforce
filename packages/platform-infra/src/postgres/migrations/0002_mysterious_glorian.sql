CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace" text NOT NULL,
	"actor_id" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_role" text NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"process_instance_id" text,
	"step_id" text,
	"process_definition_version" text,
	"executor_type" text,
	"reviewer_type" text,
	"timestamp" timestamp with time zone NOT NULL,
	"server_timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_workspace_workspaces_handle_fk" FOREIGN KEY ("workspace") REFERENCES "workspaces"("handle") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_entity_idx" ON "audit_events" USING btree ("workspace","entity_type","entity_id","timestamp" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_events_process_idx" ON "audit_events" USING btree ("workspace","process_instance_id","timestamp");