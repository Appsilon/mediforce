-- When a driver claimed an eval trial for scoring (ADR-0023 D10). A claim
-- older than the lease belongs to a driver that died mid-scoring, and another
-- driver takes it over — without it the trial stays `scoring` forever.
ALTER TABLE "eval_trials" ADD COLUMN "scoring_started_at" timestamp with time zone;
