CREATE TABLE "human_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace" text NOT NULL,
	"process_instance_id" text NOT NULL,
	"step_id" text NOT NULL,
	"assigned_role" text NOT NULL,
	"assigned_user_id" text,
	"status" text NOT NULL,
	"deadline" timestamp with time zone,
	"completion_data" jsonb,
	"completed_at" timestamp with time zone,
	"ui" jsonb,
	"params" jsonb,
	"selection" jsonb,
	"options" jsonb,
	"verdicts" jsonb,
	"creation_reason" text NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "human_tasks" ADD CONSTRAINT "human_tasks_workspace_workspaces_handle_fk" FOREIGN KEY ("workspace") REFERENCES "workspaces"("handle") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "human_tasks_role_queue_idx" ON "human_tasks" USING btree ("assigned_role","status","created_at") WHERE "human_tasks"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "human_tasks_instance_idx" ON "human_tasks" USING btree ("process_instance_id","step_id");--> statement-breakpoint
CREATE TRIGGER human_tasks_set_updated_at
	BEFORE UPDATE ON human_tasks
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();
