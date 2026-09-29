-- ADR-0023 D15. A GEPA optimisation of one Step's
-- prompt: the job's candidates, what it cost, and the Eval Run that runs them.
CREATE TABLE "eval_optimisations" (
  "id" uuid PRIMARY KEY NOT NULL,
  "workspace" text NOT NULL REFERENCES "workspaces"("handle") ON DELETE CASCADE,
  "workflow_name" text NOT NULL,
  "step_id" text NOT NULL,
  "status" text NOT NULL,
  "record" jsonb NOT NULL,
  "created_at" timestamp with time zone NOT NULL
);--> statement-breakpoint
CREATE INDEX "eval_optimisations_step_idx" ON "eval_optimisations" ("workspace", "workflow_name", "step_id", "created_at" DESC);--> statement-breakpoint
CREATE INDEX "eval_optimisations_status_idx" ON "eval_optimisations" ("status", "created_at");
