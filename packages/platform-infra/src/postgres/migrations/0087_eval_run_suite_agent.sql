-- A Step's Eval Run may freeze its Agent's Evaluators, Eval Cases and Acceptance Criteria instead of its own (ADR-0029 D10, #1552).
ALTER TABLE "eval_runs" ADD COLUMN "suite_agent_id" text;
