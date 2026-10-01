-- ADR-0023 D16. The Evaluation Brief is the assistant's context only; an Eval
-- Run no longer records the Brief version in force when it was prepared.
ALTER TABLE "eval_runs" DROP COLUMN "brief_version";
