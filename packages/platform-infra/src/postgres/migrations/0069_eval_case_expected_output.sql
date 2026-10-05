-- ADR-0023 D17: an Eval Case carries an expected output — one to match
-- (positive) or one to avoid (negative) — how an `expected_output` check
-- compares it, and which Evaluators grade the case. Case notes go: what a case
-- expects is its expected output and the Evaluators it selects.
ALTER TABLE "eval_cases" ADD COLUMN "expected_output" jsonb;--> statement-breakpoint
ALTER TABLE "eval_cases" ADD COLUMN "comparison" text DEFAULT 'exact' NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_cases" ADD COLUMN "agreement_instructions" text;--> statement-breakpoint
ALTER TABLE "eval_cases" ADD COLUMN "evaluator_ids" jsonb;--> statement-breakpoint
ALTER TABLE "eval_cases" DROP COLUMN "notes";
