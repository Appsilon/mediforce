-- ADR-0023 D10: how an Eval Run's champion fared on its Acceptance Criteria,
-- stored on the run when it finishes and rewritten when a late trial or a
-- judge review changes it, so the run list reads it instead of rebuilding
-- every run's report. Null on runs that finished before it.
ALTER TABLE "eval_runs" ADD COLUMN "acceptance" jsonb;
