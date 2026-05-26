CREATE TABLE "workspace_members" (
	"workspace" text NOT NULL,
	"uid" text NOT NULL,
	"role" text NOT NULL,
	"display_name" text,
	"avatar_url" text,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_members_workspace_uid_pk" PRIMARY KEY("workspace","uid")
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"handle" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"display_name" text NOT NULL,
	"avatar_url" text,
	"icon" text,
	"linked_user_id" text,
	"bio" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_workspaces_handle_fk" FOREIGN KEY ("workspace") REFERENCES "public"."workspaces"("handle") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workspace_members_uid_idx" ON "workspace_members" USING btree ("uid");--> statement-breakpoint
CREATE TRIGGER workspaces_set_updated_at
	BEFORE UPDATE ON workspaces
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();