CREATE TABLE "workflow_definitions" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace" text NOT NULL,
	"name" text NOT NULL,
	"version" integer NOT NULL,
	"title" text,
	"description" text,
	"preamble" text,
	"visibility" text DEFAULT 'private' NOT NULL,
	"steps" jsonb NOT NULL,
	"transitions" jsonb NOT NULL,
	"triggers" jsonb NOT NULL,
	"trigger_input" jsonb,
	"roles" jsonb,
	"env" jsonb,
	"notifications" jsonb,
	"git_workspace" jsonb,
	"metadata" jsonb,
	"repo" jsonb,
	"url" text,
	"copied_from" jsonb,
	"input_for_next_run" jsonb,
	"archived_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_meta" (
	"workspace" text NOT NULL,
	"name" text NOT NULL,
	"default_version" integer,
	"hidden" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_meta_workspace_name_pk" PRIMARY KEY("workspace","name")
);
--> statement-breakpoint
ALTER TABLE "workflow_definitions" ADD CONSTRAINT "workflow_definitions_workspace_workspaces_handle_fk" FOREIGN KEY ("workspace") REFERENCES "workspaces"("handle") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_meta" ADD CONSTRAINT "workflow_meta_workspace_workspaces_handle_fk" FOREIGN KEY ("workspace") REFERENCES "workspaces"("handle") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_definitions_workspace_name_version_unique" ON "workflow_definitions" USING btree ("workspace","name","version");--> statement-breakpoint
CREATE INDEX "workflow_definitions_live_latest_idx" ON "workflow_definitions" USING btree ("workspace","name","version" DESC NULLS LAST) WHERE "workflow_definitions"."deleted_at" is null and "workflow_definitions"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "workflow_definitions_public_idx" ON "workflow_definitions" USING btree ("visibility","workspace","name") WHERE "workflow_definitions"."deleted_at" is null and "workflow_definitions"."visibility" = 'public';--> statement-breakpoint
CREATE TRIGGER workflow_definitions_set_updated_at
	BEFORE UPDATE ON workflow_definitions
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER workflow_meta_set_updated_at
	BEFORE UPDATE ON workflow_meta
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();
