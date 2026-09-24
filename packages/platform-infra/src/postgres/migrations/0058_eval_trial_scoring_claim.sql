-- When a driver claimed an eval trial for scoring, and how many drivers have
-- (ADR-0023 D10). A claim older than the lease belongs to a driver that died
-- mid-scoring and another takes it over — without it the trial stays `scoring`
-- forever; after a few attempts the trial fails rather than pay for judges again.
ALTER TABLE "eval_trials" ADD COLUMN "scoring_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "eval_trials" ADD COLUMN "scoring_attempts" integer DEFAULT 0 NOT NULL;
