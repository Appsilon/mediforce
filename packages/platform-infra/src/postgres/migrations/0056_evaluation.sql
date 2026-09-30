-- The Evaluation domain of ADR-0023 (Step Evaluation 1b): Evaluation Briefs,
-- Evaluators and their versions, Eval Cases, frozen Eval Dataset versions and
-- per-Step MCP eval policies. Every table is keyed by the Step it evaluates,
-- (workspace, workflow_name, step_id), with no foreign key to a Workflow
-- Definition: Evaluation lives outside the immutable definition (D2).
CREATE TABLE "evaluation_briefs" (
  "workspace" text NOT NULL REFERENCES "workspaces"("handle") ON DELETE CASCADE,
  "workflow_name" text NOT NULL,
  "step_id" text NOT NULL,
  "version" integer NOT NULL,
  "text" text NOT NULL,
  "origin" text NOT NULL,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "evaluation_briefs_pk" PRIMARY KEY ("workspace","workflow_name","step_id","version")
);--> statement-breakpoint
CREATE TABLE "evaluators" (
  "id" uuid PRIMARY KEY NOT NULL,
  "workspace" text NOT NULL REFERENCES "workspaces"("handle") ON DELETE CASCADE,
  "workflow_name" text NOT NULL,
  "step_id" text NOT NULL,
  "name" text NOT NULL,
  "archived" boolean DEFAULT false NOT NULL,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX "evaluators_step_name_idx" ON "evaluators" USING btree ("workspace","workflow_name","step_id","name");--> statement-breakpoint
-- Append-only (D7): a change is a new version. source_approval and calibration
-- are the only in-place writes — they describe a version, not what it checks.
CREATE TABLE "evaluator_versions" (
  "evaluator_id" uuid NOT NULL REFERENCES "evaluators"("id") ON DELETE CASCADE,
  "version" integer NOT NULL,
  "rule" text NOT NULL,
  "severity" text NOT NULL,
  "check" jsonb NOT NULL,
  "origin" text NOT NULL,
  "source_approval" jsonb,
  "calibration" jsonb,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "evaluator_versions_pk" PRIMARY KEY ("evaluator_id","version")
);--> statement-breakpoint
CREATE TABLE "eval_cases" (
  "id" uuid PRIMARY KEY NOT NULL,
  "workspace" text NOT NULL REFERENCES "workspaces"("handle") ON DELETE CASCADE,
  "workflow_name" text NOT NULL,
  "step_id" text NOT NULL,
  "name" text NOT NULL,
  "input" jsonb NOT NULL,
  "workspace_seed_commit" text,
  "expectation" text NOT NULL,
  "notes" text,
  "source" text NOT NULL,
  "source_agent_run_id" text,
  "split" text NOT NULL,
  "contains_production_data" boolean NOT NULL,
  "archived" boolean DEFAULT false NOT NULL,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "eval_cases_step_idx" ON "eval_cases" USING btree ("workspace","workflow_name","step_id","created_at" DESC);--> statement-breakpoint
CREATE TABLE "eval_dataset_versions" (
  "id" uuid PRIMARY KEY NOT NULL,
  "workspace" text NOT NULL REFERENCES "workspaces"("handle") ON DELETE CASCADE,
  "workflow_name" text NOT NULL,
  "step_id" text NOT NULL,
  "version" integer NOT NULL,
  "case_ids" jsonb NOT NULL,
  "contains_production_data" boolean NOT NULL,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX "eval_dataset_versions_step_version_idx" ON "eval_dataset_versions" USING btree ("workspace","workflow_name","step_id","version");--> statement-breakpoint
CREATE TABLE "mcp_eval_policies" (
  "workspace" text NOT NULL REFERENCES "workspaces"("handle") ON DELETE CASCADE,
  "workflow_name" text NOT NULL,
  "step_id" text NOT NULL,
  "servers" jsonb NOT NULL,
  "updated_by" text NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "mcp_eval_policies_pk" PRIMARY KEY ("workspace","workflow_name","step_id")
);
