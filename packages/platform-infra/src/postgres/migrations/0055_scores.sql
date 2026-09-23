-- Scores (ADR-0023): external quality judgments on one Agent Run or one
-- Workflow Run — a human verdict on a Control Mode 3 review today, Evaluators
-- later. Shape from docs/research/layer2-scores-research.md § 6.
--
-- Append-only: a revised judgment is a new row whose `supersedes` names the
-- one it replaces, matching audit_events and 21 CFR Part 11. The subject is
-- polymorphic, so it has no foreign key; the correlation columns
-- (process_instance_id, step_id) are copied in on write so lists never join.
CREATE TABLE "scores" (
  "id" uuid PRIMARY KEY NOT NULL,
  "workspace" text NOT NULL REFERENCES "workspaces"("handle") ON DELETE CASCADE,
  "subject_type" text NOT NULL,
  "subject_id" text NOT NULL,
  "name" text NOT NULL,
  "value" double precision NOT NULL,
  "label" text,
  "comment" text,
  "source" text NOT NULL,
  "created_by" text,
  "metadata" jsonb,
  "process_instance_id" text,
  "step_id" text,
  "evaluator_id" text,
  "supersedes" uuid REFERENCES "scores"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "scores_value_range" CHECK ("value" >= 0 AND "value" <= 1)
);--> statement-breakpoint
CREATE INDEX "scores_subject_idx" ON "scores" USING btree ("subject_type","subject_id","created_at" DESC);--> statement-breakpoint
CREATE INDEX "scores_workspace_created_idx" ON "scores" USING btree ("workspace","created_at" DESC);--> statement-breakpoint
CREATE INDEX "scores_instance_step_idx" ON "scores" USING btree ("process_instance_id","step_id");--> statement-breakpoint

COMMENT ON TABLE "scores" IS
  'Scores (ADR-0023): append-only quality judgments on an Agent Run or Workflow Run. Corrections supersede, never update.';
