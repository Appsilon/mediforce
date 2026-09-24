-- A synthesized Eval Case records what it changed about its source run's
-- input — the kind of change and why; null on every other case.
ALTER TABLE "eval_cases" ADD COLUMN "perturbation" jsonb;
