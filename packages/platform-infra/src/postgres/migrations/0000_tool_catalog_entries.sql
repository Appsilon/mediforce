CREATE TABLE "tool_catalog_entries" (
	"workspace" text NOT NULL,
	"id" text NOT NULL,
	"command" text NOT NULL,
	"args" jsonb,
	"env" jsonb,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tool_catalog_entries_workspace_id_pk" PRIMARY KEY("workspace","id")
);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
	NEW.updated_at = now();
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER tool_catalog_entries_set_updated_at
	BEFORE UPDATE ON tool_catalog_entries
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();
