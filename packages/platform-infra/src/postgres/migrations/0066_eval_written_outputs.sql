-- ADR-0023 D9. A person's written example of a Step's output, labelled pass or
-- fail to calibrate a judge. The record is `record` whole; the columns beside
-- it are what a Step's examples are listed by.
CREATE TABLE "eval_written_outputs" (
  "id" uuid PRIMARY KEY NOT NULL,
  "workspace" text NOT NULL REFERENCES "workspaces"("handle") ON DELETE CASCADE,
  "workflow_name" text NOT NULL,
  "step_id" text NOT NULL,
  "archived" boolean DEFAULT false NOT NULL,
  "record" jsonb NOT NULL,
  "created_at" timestamp with time zone NOT NULL
);--> statement-breakpoint
CREATE INDEX "eval_written_outputs_step_idx" ON "eval_written_outputs" ("workspace", "workflow_name", "step_id", "created_at" DESC);
