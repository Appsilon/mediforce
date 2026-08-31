-- Issue #1253 (ADR-0019): who may RUN and who may EDIT a workflow — the first
-- permission `register`, `delete`, `archive`, `transfer`, `set-visibility` and
-- `set-default-version` have ever had beyond workspace membership.
--
-- No backfill and no seed, unlike migration 0042. An absent row means "any
-- workspace member", which is exactly today's behaviour, so every existing
-- workflow keeps working untouched and the gate is opt-in (AGENTS.md §13).
-- See `schema/workflow-access.ts` for why the table is shaped this way.
CREATE TABLE "workflow_access" (
	"workspace" text NOT NULL,
	"name" text NOT NULL,
	"run_roles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"edit_roles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_access_workspace_name_pk" PRIMARY KEY("workspace","name")
);
--> statement-breakpoint
ALTER TABLE "workflow_access" ADD CONSTRAINT "workflow_access_workspace_workspaces_handle_fk" FOREIGN KEY ("workspace") REFERENCES "workspaces"("handle") ON DELETE cascade ON UPDATE no action;
