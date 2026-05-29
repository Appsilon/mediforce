CREATE TABLE "namespace_secrets" (
	"workspace" text NOT NULL,
	"key" text NOT NULL,
	"encrypted_value" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "namespace_secrets_workspace_key_pk" PRIMARY KEY("workspace","key")
);
--> statement-breakpoint
CREATE TABLE "workflow_secrets" (
	"workspace" text NOT NULL,
	"workflow_name" text NOT NULL,
	"key" text NOT NULL,
	"encrypted_value" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_secrets_workspace_workflow_name_key_pk" PRIMARY KEY("workspace","workflow_name","key")
);
--> statement-breakpoint
ALTER TABLE "namespace_secrets" ADD CONSTRAINT "namespace_secrets_workspace_workspaces_handle_fk" FOREIGN KEY ("workspace") REFERENCES "workspaces"("handle") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_secrets" ADD CONSTRAINT "workflow_secrets_workspace_workspaces_handle_fk" FOREIGN KEY ("workspace") REFERENCES "workspaces"("handle") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE TRIGGER namespace_secrets_set_updated_at
	BEFORE UPDATE ON namespace_secrets
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER workflow_secrets_set_updated_at
	BEFORE UPDATE ON workflow_secrets
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();
