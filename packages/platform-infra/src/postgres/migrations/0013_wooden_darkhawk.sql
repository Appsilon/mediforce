CREATE TABLE "model_registry_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"canonical_slug" text,
	"name" text NOT NULL,
	"provider" text NOT NULL,
	"context_length" integer NOT NULL,
	"max_completion_tokens" integer,
	"pricing" jsonb NOT NULL,
	"modality" text NOT NULL,
	"input_modalities" jsonb NOT NULL,
	"output_modalities" jsonb NOT NULL,
	"supports_tools" boolean NOT NULL,
	"supports_vision" boolean NOT NULL,
	"source" text NOT NULL,
	"request_count" integer,
	"last_synced_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_registry_meta" (
	"id" text PRIMARY KEY NOT NULL,
	"rankings_updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TRIGGER model_registry_entries_set_updated_at
	BEFORE UPDATE ON model_registry_entries
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();
