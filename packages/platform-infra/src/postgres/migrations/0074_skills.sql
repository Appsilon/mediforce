-- ADR-0025: a Skill — one Claude Code skill folder a workspace owns, stored
-- whole as `files jsonb` ([{ path, contents }]).
--
-- Additive and unseeded. Nothing reads the table at run time yet: no Agent
-- can hold a Skill, so an empty table is exactly today's behaviour.
CREATE TABLE "skills" (
	"workspace" text NOT NULL,
	"id" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"visibility" text DEFAULT 'private' NOT NULL,
	"content_hash" text NOT NULL,
	"files" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skills_workspace_id_pk" PRIMARY KEY("workspace","id")
);
--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_workspace_workspaces_handle_fk" FOREIGN KEY ("workspace") REFERENCES "workspaces"("handle") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE TRIGGER skills_set_updated_at
	BEFORE UPDATE ON skills
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();
