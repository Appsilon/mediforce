-- Step Evaluation 5c (ADR-0023 D6). What a live eval trial's MCP servers
-- answered, one row per trial and server, for a later trial of the same Eval
-- Case to replay. A trial records the calls to a replayed server no recording
-- answered; trials run before replay had none.
CREATE TABLE "eval_mcp_recordings" (
  "id" uuid PRIMARY KEY NOT NULL,
  "workspace" text NOT NULL REFERENCES "workspaces"("handle") ON DELETE CASCADE,
  "workflow_name" text NOT NULL,
  "step_id" text NOT NULL,
  "case_id" uuid NOT NULL,
  "server" text NOT NULL,
  "tape" jsonb NOT NULL,
  "eval_run_id" uuid NOT NULL REFERENCES "eval_runs"("id") ON DELETE CASCADE,
  "trial_id" uuid NOT NULL REFERENCES "eval_trials"("id") ON DELETE CASCADE,
  "recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "eval_mcp_recordings_case_idx" ON "eval_mcp_recordings" ("workspace", "workflow_name", "step_id", "case_id", "server", "recorded_at");--> statement-breakpoint
ALTER TABLE "eval_trials" ADD COLUMN "mcp_replay_misses" jsonb DEFAULT '[]'::jsonb NOT NULL;
