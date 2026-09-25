-- Step Evaluation 3 (ADR-0023 D5, D10, D11). An Eval Run runs variants of its
-- Step — the champion, then challengers patched over it — and freezes the
-- Acceptance Criteria and Brief version it is judged against; runs prepared
-- before variants ran the champion alone. Each trial belongs to one variant and
-- keeps the confidence its agent reported. Acceptance Criteria are versioned
-- per Step like Briefs; a Step Qualification is a signed record, never changed.
ALTER TABLE "eval_runs" ADD COLUMN "variants" jsonb DEFAULT '[{"id":"champion","label":"Current step","patch":{},"fingerprint":null}]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_runs" ALTER COLUMN "variants" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "acceptance_criteria" jsonb;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "brief_version" integer;--> statement-breakpoint
ALTER TABLE "eval_trials" ADD COLUMN "variant_id" text DEFAULT 'champion' NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_trials" ALTER COLUMN "variant_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "eval_trials" ADD COLUMN "confidence" double precision;--> statement-breakpoint
DROP INDEX "eval_trials_run_idx";--> statement-breakpoint
CREATE INDEX "eval_trials_run_idx" ON "eval_trials" USING btree ("eval_run_id","case_id","variant_id","trial_index");--> statement-breakpoint
CREATE TABLE "eval_acceptance_criteria" (
  "workspace" text NOT NULL REFERENCES "workspaces"("handle") ON DELETE CASCADE,
  "workflow_name" text NOT NULL,
  "step_id" text NOT NULL,
  "version" integer NOT NULL,
  "criteria" jsonb NOT NULL,
  "origin" text NOT NULL,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "eval_acceptance_criteria_pk" PRIMARY KEY ("workspace","workflow_name","step_id","version")
);--> statement-breakpoint
CREATE TABLE "step_qualifications" (
  "id" uuid PRIMARY KEY NOT NULL,
  "workspace" text NOT NULL REFERENCES "workspaces"("handle") ON DELETE CASCADE,
  "workflow_name" text NOT NULL,
  "step_id" text NOT NULL,
  "eval_run_id" uuid NOT NULL REFERENCES "eval_runs"("id"),
  "variant_id" text NOT NULL,
  "fingerprint" text NOT NULL,
  "record" jsonb NOT NULL,
  "signed_by" text NOT NULL,
  "signed_at" timestamp with time zone NOT NULL
);--> statement-breakpoint
CREATE INDEX "step_qualifications_step_idx" ON "step_qualifications" USING btree ("workspace","workflow_name","step_id","signed_at" DESC);
