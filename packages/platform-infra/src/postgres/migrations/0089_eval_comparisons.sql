-- ADR-0024 D4: a Comparison groups a baseline Eval Run and one to four Variant
-- runs of one subject on one Eval Dataset version, started with one budget.
CREATE TABLE "eval_comparisons" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace" text NOT NULL,
	"workflow_name" text NOT NULL,
	"step_id" text NOT NULL,
	"agent_id" text DEFAULT '' NOT NULL,
	"dataset_version_id" uuid NOT NULL,
	"trials_per_case" integer NOT NULL,
	"baseline_eval_run_id" uuid NOT NULL,
	"baseline_reused" boolean NOT NULL,
	"status" text NOT NULL,
	"budget_usd" double precision NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	CONSTRAINT "eval_comparisons_owner_check" CHECK (("agent_id" <> '' AND "workflow_name" = '' AND "step_id" = '') OR ("agent_id" = '' AND "workflow_name" <> '' AND "step_id" <> ''))
);
--> statement-breakpoint
ALTER TABLE "eval_comparisons" ADD CONSTRAINT "eval_comparisons_workspace_workspaces_handle_fk" FOREIGN KEY ("workspace") REFERENCES "workspaces"("handle") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_comparisons" ADD CONSTRAINT "eval_comparisons_dataset_version_id_eval_dataset_versions_id_fk" FOREIGN KEY ("dataset_version_id") REFERENCES "eval_dataset_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "eval_comparisons_subject_idx" ON "eval_comparisons" USING btree ("workspace","workflow_name","step_id","agent_id","created_at" DESC);--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "comparison_id" uuid;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_comparison_id_eval_comparisons_id_fk" FOREIGN KEY ("comparison_id") REFERENCES "eval_comparisons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "eval_runs_comparison_idx" ON "eval_runs" USING btree ("comparison_id");
