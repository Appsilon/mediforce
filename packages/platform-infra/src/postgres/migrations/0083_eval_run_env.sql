-- An Agent's Evaluation holds the step env its trials run with (secret templates, never values); each Eval Run freezes a copy.
ALTER TABLE "mcp_eval_policies" ADD COLUMN "env" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "env" jsonb DEFAULT '{}'::jsonb NOT NULL;
