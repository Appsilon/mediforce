CREATE TABLE "agent_oauth_tokens" (
	"workspace" text NOT NULL,
	"agent_id" text NOT NULL,
	"server_name" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text,
	"expires_at" bigint,
	"scope" text NOT NULL,
	"provider_user_id" text NOT NULL,
	"account_login" text NOT NULL,
	"connected_at" bigint NOT NULL,
	"connected_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_oauth_tokens_workspace_agent_id_server_name_pk" PRIMARY KEY("workspace","agent_id","server_name")
);
--> statement-breakpoint
ALTER TABLE "agent_oauth_tokens" ADD CONSTRAINT "agent_oauth_tokens_workspace_workspaces_handle_fk" FOREIGN KEY ("workspace") REFERENCES "workspaces"("handle") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE TRIGGER agent_oauth_tokens_set_updated_at
	BEFORE UPDATE ON agent_oauth_tokens
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();