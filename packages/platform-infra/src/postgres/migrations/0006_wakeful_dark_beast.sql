CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace" text NOT NULL,
	"process_instance_id" uuid NOT NULL,
	"step_id" text NOT NULL,
	"plugin_id" text NOT NULL,
	"autonomy_level" text NOT NULL,
	"status" text NOT NULL,
	"fallback_reason" text,
	"confidence" numeric,
	"model" text,
	"duration_ms" integer,
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"cost_usd" numeric(12, 6),
	"envelope_payload" jsonb,
	"executor_type" text,
	"reviewer_type" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_workspace_workspaces_handle_fk" FOREIGN KEY ("workspace") REFERENCES "workspaces"("handle") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_runs_instance_idx" ON "agent_runs" USING btree ("process_instance_id","step_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "agent_runs_cost_idx" ON "agent_runs" USING btree ("model","started_at") WHERE "agent_runs"."cost_usd" is not null;