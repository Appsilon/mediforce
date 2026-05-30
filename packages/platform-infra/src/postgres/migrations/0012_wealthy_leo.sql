CREATE TABLE "agents" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace" text,
	"kind" text DEFAULT 'plugin' NOT NULL,
	"runtime_id" text,
	"name" text NOT NULL,
	"icon_name" text NOT NULL,
	"description" text NOT NULL,
	"foundation_model" text NOT NULL,
	"system_prompt" text NOT NULL,
	"input_description" text NOT NULL,
	"output_description" text NOT NULL,
	"skill_file_names" jsonb NOT NULL,
	"mcp_servers" jsonb,
	"namespace" text,
	"visibility" text DEFAULT 'private' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_workspace_workspaces_handle_fk" FOREIGN KEY ("workspace") REFERENCES "workspaces"("handle") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agents_visibility_idx" ON "agents" USING btree ("visibility");--> statement-breakpoint
CREATE INDEX "agents_namespace_idx" ON "agents" USING btree ("namespace") WHERE "agents"."namespace" is not null;--> statement-breakpoint
CREATE TRIGGER agents_set_updated_at
	BEFORE UPDATE ON agents
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();
