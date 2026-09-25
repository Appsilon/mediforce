-- Step Evaluation 4 (ADR-0023 D12, D13). An Evaluator may also score live
-- production Agent Runs of its step. An Eval Run records the cases it left out
-- because a variant's few-shot examples came from them; runs prepared before
-- examples left none out.
ALTER TABLE "evaluators" ADD COLUMN "run_in_production" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "example_case_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;
