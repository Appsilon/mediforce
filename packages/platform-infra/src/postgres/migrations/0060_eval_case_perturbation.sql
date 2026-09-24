-- A synthesized Eval Case records what it changed about its source run's
-- input (ADR-0023 phase 2 case synthesis); null on every other case.
ALTER TABLE "eval_cases" ADD COLUMN "perturbation" jsonb;
