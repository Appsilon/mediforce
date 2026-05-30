CREATE TABLE "handoff_entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace" text NOT NULL,
	"type" text NOT NULL,
	"process_instance_id" text NOT NULL,
	"step_id" text NOT NULL,
	"agent_run_id" text NOT NULL,
	"assigned_role" text NOT NULL,
	"assigned_user_id" text,
	"status" text NOT NULL,
	"agent_work" jsonb,
	"agent_reasoning" text,
	"agent_question" text,
	"payload" jsonb,
	"resolution" jsonb,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "handoff_entities" ADD CONSTRAINT "handoff_entities_workspace_workspaces_handle_fk" FOREIGN KEY ("workspace") REFERENCES "workspaces"("handle") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "handoff_entities_workspace_status_idx" ON "handoff_entities" USING btree ("workspace","status","created_at");--> statement-breakpoint
CREATE INDEX "handoff_entities_role_status_idx" ON "handoff_entities" USING btree ("assigned_role","status");--> statement-breakpoint
CREATE TRIGGER handoff_entities_set_updated_at
	BEFORE UPDATE ON handoff_entities
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();
