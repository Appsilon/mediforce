CREATE TABLE "oauth_providers" (
	"workspace" text NOT NULL,
	"id" text NOT NULL,
	"name" text NOT NULL,
	"client_id" text NOT NULL,
	"client_secret" text,
	"authorize_url" text NOT NULL,
	"token_url" text NOT NULL,
	"revoke_url" text,
	"user_info_url" text,
	"scopes" jsonb NOT NULL,
	"token_endpoint_auth_method" text,
	"issuer" text,
	"registration_endpoint" text,
	"resource_url" text,
	"icon_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_providers_workspace_id_pk" PRIMARY KEY("workspace","id")
);
--> statement-breakpoint
ALTER TABLE "oauth_providers" ADD CONSTRAINT "oauth_providers_workspace_workspaces_handle_fk" FOREIGN KEY ("workspace") REFERENCES "workspaces"("handle") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE TRIGGER oauth_providers_set_updated_at
	BEFORE UPDATE ON oauth_providers
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();