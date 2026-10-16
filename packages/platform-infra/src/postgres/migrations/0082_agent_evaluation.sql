-- ADR-0029: an Agent can own an Evaluation and is versioned.
--
-- Every Evaluation table gains `agent_id`. A Step's rows keep it '', an
-- Agent's keep `workflow_name` and `step_id` '' — empty rather than null, so
-- the owner stays in the primary keys and unique indexes, which are rebuilt to
-- include it. `<table>_owner_check` holds exactly one owner per row.
ALTER TABLE "evaluation_briefs" ADD COLUMN "agent_id" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "evaluators" ADD COLUMN "agent_id" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_cases" ADD COLUMN "agent_id" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_dataset_versions" ADD COLUMN "agent_id" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "mcp_eval_policies" ADD COLUMN "agent_id" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_acceptance_criteria" ADD COLUMN "agent_id" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "agent_id" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_mcp_recordings" ADD COLUMN "agent_id" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "step_qualifications" ADD COLUMN "agent_id" text DEFAULT '' NOT NULL;--> statement-breakpoint

ALTER TABLE "evaluation_briefs" DROP CONSTRAINT "evaluation_briefs_pk";--> statement-breakpoint
ALTER TABLE "evaluation_briefs" ADD CONSTRAINT "evaluation_briefs_pk" PRIMARY KEY ("workspace","workflow_name","step_id","agent_id","version");--> statement-breakpoint
ALTER TABLE "mcp_eval_policies" DROP CONSTRAINT "mcp_eval_policies_pk";--> statement-breakpoint
ALTER TABLE "mcp_eval_policies" ADD CONSTRAINT "mcp_eval_policies_pk" PRIMARY KEY ("workspace","workflow_name","step_id","agent_id");--> statement-breakpoint
ALTER TABLE "eval_acceptance_criteria" DROP CONSTRAINT "eval_acceptance_criteria_pk";--> statement-breakpoint
ALTER TABLE "eval_acceptance_criteria" ADD CONSTRAINT "eval_acceptance_criteria_pk" PRIMARY KEY ("workspace","workflow_name","step_id","agent_id","version");--> statement-breakpoint

DROP INDEX "evaluators_step_name_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "evaluators_step_name_idx" ON "evaluators" USING btree ("workspace","workflow_name","step_id","agent_id","name");--> statement-breakpoint
DROP INDEX "eval_dataset_versions_step_version_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "eval_dataset_versions_step_version_idx" ON "eval_dataset_versions" USING btree ("workspace","workflow_name","step_id","agent_id","version");--> statement-breakpoint
DROP INDEX "eval_cases_step_idx";--> statement-breakpoint
CREATE INDEX "eval_cases_step_idx" ON "eval_cases" USING btree ("workspace","workflow_name","step_id","agent_id","created_at" DESC);--> statement-breakpoint
DROP INDEX "eval_runs_step_idx";--> statement-breakpoint
CREATE INDEX "eval_runs_step_idx" ON "eval_runs" USING btree ("workspace","workflow_name","step_id","agent_id","created_at" DESC);--> statement-breakpoint
DROP INDEX "eval_mcp_recordings_case_idx";--> statement-breakpoint
CREATE INDEX "eval_mcp_recordings_case_idx" ON "eval_mcp_recordings" USING btree ("workspace","workflow_name","step_id","agent_id","case_id","server","recorded_at");--> statement-breakpoint
DROP INDEX "step_qualifications_step_idx";--> statement-breakpoint
CREATE INDEX "step_qualifications_step_idx" ON "step_qualifications" USING btree ("workspace","workflow_name","step_id","agent_id","signed_at" DESC);--> statement-breakpoint

ALTER TABLE "evaluation_briefs" ADD CONSTRAINT "evaluation_briefs_owner_check" CHECK (("agent_id" <> '' AND "workflow_name" = '' AND "step_id" = '') OR ("agent_id" = '' AND "workflow_name" <> '' AND "step_id" <> ''));--> statement-breakpoint
ALTER TABLE "evaluators" ADD CONSTRAINT "evaluators_owner_check" CHECK (("agent_id" <> '' AND "workflow_name" = '' AND "step_id" = '') OR ("agent_id" = '' AND "workflow_name" <> '' AND "step_id" <> ''));--> statement-breakpoint
ALTER TABLE "eval_cases" ADD CONSTRAINT "eval_cases_owner_check" CHECK (("agent_id" <> '' AND "workflow_name" = '' AND "step_id" = '') OR ("agent_id" = '' AND "workflow_name" <> '' AND "step_id" <> ''));--> statement-breakpoint
ALTER TABLE "eval_dataset_versions" ADD CONSTRAINT "eval_dataset_versions_owner_check" CHECK (("agent_id" <> '' AND "workflow_name" = '' AND "step_id" = '') OR ("agent_id" = '' AND "workflow_name" <> '' AND "step_id" <> ''));--> statement-breakpoint
ALTER TABLE "mcp_eval_policies" ADD CONSTRAINT "mcp_eval_policies_owner_check" CHECK (("agent_id" <> '' AND "workflow_name" = '' AND "step_id" = '') OR ("agent_id" = '' AND "workflow_name" <> '' AND "step_id" <> ''));--> statement-breakpoint
ALTER TABLE "eval_acceptance_criteria" ADD CONSTRAINT "eval_acceptance_criteria_owner_check" CHECK (("agent_id" <> '' AND "workflow_name" = '' AND "step_id" = '') OR ("agent_id" = '' AND "workflow_name" <> '' AND "step_id" <> ''));--> statement-breakpoint
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_owner_check" CHECK (("agent_id" <> '' AND "workflow_name" = '' AND "step_id" = '') OR ("agent_id" = '' AND "workflow_name" <> '' AND "step_id" <> ''));--> statement-breakpoint
ALTER TABLE "eval_mcp_recordings" ADD CONSTRAINT "eval_mcp_recordings_owner_check" CHECK (("agent_id" <> '' AND "workflow_name" = '' AND "step_id" = '') OR ("agent_id" = '' AND "workflow_name" <> '' AND "step_id" <> ''));--> statement-breakpoint
ALTER TABLE "step_qualifications" ADD CONSTRAINT "step_qualifications_owner_check" CHECK (("agent_id" <> '' AND "workflow_name" = '' AND "step_id" = '') OR ("agent_id" = '' AND "workflow_name" <> '' AND "step_id" <> ''));--> statement-breakpoint

-- A Step's Eval Run names its Definition version, an Agent's its Agent version.
ALTER TABLE "eval_runs" ALTER COLUMN "definition_version" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "agent_version" integer;--> statement-breakpoint

-- An Agent's eval trial carries the single-step Definition it runs, which no stored Workflow holds.
ALTER TABLE "process_instances" ADD COLUMN "eval_definition" jsonb;--> statement-breakpoint

-- No foreign key to "agents": an Eval Run or Qualification outlives its Agent
-- (ADR-0023 D2) and still shows the configuration it assessed.
CREATE TABLE "agent_versions" (
  "agent_id" text NOT NULL,
  "version" integer NOT NULL,
  "hash" text NOT NULL,
  "config" jsonb NOT NULL,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "agent_versions_agent_id_version_pk" PRIMARY KEY ("agent_id","version")
);
