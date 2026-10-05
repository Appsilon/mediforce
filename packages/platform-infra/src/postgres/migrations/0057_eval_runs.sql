-- Eval Runs (ADR-0023 D4, D10, Step Evaluation 1b). An eval trial is a real
-- single-step Workflow Run flagged with its Eval Run: process_instances gains
-- eval_run_id (run lists, monitoring and carry-over leave those rows out) and
-- the commit its run branch starts from. agent_runs copies eval_run_id from the
-- parent run at write time, as it already does workspace, so the Agents history
-- filters trials without a join.
ALTER TABLE "process_instances" ADD COLUMN "eval_run_id" text;--> statement-breakpoint
ALTER TABLE "process_instances" ADD COLUMN "workspace_start_commit" text;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "eval_run_id" text;--> statement-breakpoint
CREATE TABLE "eval_runs" (
  "id" uuid PRIMARY KEY NOT NULL,
  "workspace" text NOT NULL REFERENCES "workspaces"("handle") ON DELETE CASCADE,
  "workflow_name" text NOT NULL,
  "step_id" text NOT NULL,
  "definition_version" integer NOT NULL,
  "dataset_version_id" uuid NOT NULL REFERENCES "eval_dataset_versions"("id"),
  "case_ids" jsonb NOT NULL,
  "trials_per_case" integer NOT NULL,
  "concurrency" integer NOT NULL,
  "evaluators" jsonb NOT NULL,
  "mcp_policy" jsonb NOT NULL,
  "estimate" jsonb NOT NULL,
  "budget_usd" double precision NOT NULL,
  "spent_usd" double precision DEFAULT 0 NOT NULL,
  "status" text NOT NULL,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone
);--> statement-breakpoint
CREATE INDEX "eval_runs_step_idx" ON "eval_runs" USING btree ("workspace","workflow_name","step_id","created_at" DESC);--> statement-breakpoint
CREATE INDEX "eval_runs_status_idx" ON "eval_runs" USING btree ("status");--> statement-breakpoint
CREATE TABLE "eval_trials" (
  "id" uuid PRIMARY KEY NOT NULL,
  "eval_run_id" uuid NOT NULL REFERENCES "eval_runs"("id") ON DELETE CASCADE,
  "case_id" uuid NOT NULL,
  "trial_index" integer NOT NULL,
  "status" text NOT NULL,
  "process_instance_id" text,
  "agent_run_id" text,
  "cost_usd" double precision,
  "input_tokens" integer,
  "output_tokens" integer,
  "duration_ms" integer,
  "error" text,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone
);--> statement-breakpoint
CREATE INDEX "eval_trials_run_idx" ON "eval_trials" USING btree ("eval_run_id","case_id","trial_index");--> statement-breakpoint
CREATE UNIQUE INDEX "eval_trials_instance_idx" ON "eval_trials" USING btree ("process_instance_id");
