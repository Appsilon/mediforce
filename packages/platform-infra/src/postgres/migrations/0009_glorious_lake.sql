CREATE TABLE "cowork_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace" text NOT NULL,
	"process_instance_id" text NOT NULL,
	"step_id" text NOT NULL,
	"assigned_role" text NOT NULL,
	"assigned_user_id" text,
	"status" text NOT NULL,
	"agent" text NOT NULL,
	"model" text,
	"system_prompt" text,
	"output_schema" jsonb,
	"voice_config" jsonb,
	"mcp_servers" jsonb,
	"artifact" jsonb,
	"finalized_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cowork_turns" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"idx" integer NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"artifact_delta" jsonb,
	"timestamp" timestamp with time zone NOT NULL,
	"tool_name" text,
	"tool_args" jsonb,
	"tool_result" text,
	"tool_status" text,
	"server_name" text
);
--> statement-breakpoint
ALTER TABLE "cowork_sessions" ADD CONSTRAINT "cowork_sessions_workspace_workspaces_handle_fk" FOREIGN KEY ("workspace") REFERENCES "workspaces"("handle") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cowork_turns" ADD CONSTRAINT "cowork_turns_session_id_cowork_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "cowork_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cowork_sessions_workspace_status_idx" ON "cowork_sessions" USING btree ("workspace","status","created_at");--> statement-breakpoint
CREATE INDEX "cowork_sessions_role_status_idx" ON "cowork_sessions" USING btree ("assigned_role","status","created_at");--> statement-breakpoint
CREATE INDEX "cowork_sessions_instance_step_idx" ON "cowork_sessions" USING btree ("process_instance_id","step_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cowork_turns_session_idx_unique" ON "cowork_turns" USING btree ("session_id","idx");--> statement-breakpoint
CREATE TRIGGER cowork_sessions_set_updated_at
	BEFORE UPDATE ON cowork_sessions
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();
