-- ADR-0023: what a model check answered when it gave no Score, by Evaluator
-- id, so a trial shows why its judge produced no verdict. Trials scored before
-- it have none.
ALTER TABLE "eval_trials" ADD COLUMN "errored_judge_calls" jsonb DEFAULT '{}'::jsonb NOT NULL;
