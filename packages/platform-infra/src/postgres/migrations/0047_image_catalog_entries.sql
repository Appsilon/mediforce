-- ADR-0021 / issue #1294: the Image Catalog entry — one image the workspace
-- offers for steps, keyed on its source rather than on any built artifact.
--
-- Additive and unseeded. Nothing reads the table at run time: a step still
-- stores an image string, and no Workflow Definition points at an entry, so
-- an empty table is exactly today's behaviour (AGENTS.md §12/§13).
--
-- See `schema/image-catalog.ts` for why `source` is jsonb and why there is
-- no `versions` column.
CREATE TABLE "image_catalog_entries" (
	"workspace" text NOT NULL,
	"id" text NOT NULL,
	"name" text NOT NULL,
	"intent" text NOT NULL,
	"source" jsonb NOT NULL,
	"declared_source" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "image_catalog_entries_workspace_id_pk" PRIMARY KEY("workspace","id")
);
--> statement-breakpoint
ALTER TABLE "image_catalog_entries" ADD CONSTRAINT "image_catalog_entries_workspace_workspaces_handle_fk" FOREIGN KEY ("workspace") REFERENCES "workspaces"("handle") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE TRIGGER image_catalog_entries_set_updated_at
	BEFORE UPDATE ON image_catalog_entries
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();
