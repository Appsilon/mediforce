-- ADR-0011: the unified, detached `triggers` resource. One row per
-- (namespace, workflow_name, trigger_name), discriminated by `type`, with the
-- type payload in `config` jsonb. This is pure plumbing: nothing reads or
-- writes the table yet — later epic issues seed and cut over per type. The
-- cron-only `cron_trigger_state` overlay is left untouched here (see ADR-0011).
CREATE TABLE "triggers" (
	"namespace" text NOT NULL,
	"workflow_name" text NOT NULL,
	"trigger_name" text NOT NULL,
	"type" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"config" jsonb NOT NULL,
	"last_triggered_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "triggers_namespace_workflow_name_trigger_name_pk" PRIMARY KEY("namespace","workflow_name","trigger_name")
);
--> statement-breakpoint
ALTER TABLE "triggers" ADD CONSTRAINT "triggers_namespace_workspaces_handle_fk" FOREIGN KEY ("namespace") REFERENCES "workspaces"("handle") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- One webhook per (namespace, workflow, path): the path discriminates when a
-- workflow has multiple webhook triggers.
CREATE UNIQUE INDEX "triggers_webhook_path_uq" ON "triggers" USING btree ("namespace","workflow_name",("config"->>'path')) WHERE "type" = 'webhook';--> statement-breakpoint
-- Backs the heartbeat's `listEnabledByType('cron')` sweep.
CREATE INDEX "triggers_enabled_type_idx" ON "triggers" USING btree ("type") WHERE "enabled";
