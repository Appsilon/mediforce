-- Eval Cases record who put them there, as Evaluators and Briefs already do
-- (ADR-0023 D14): a person, or an Evaluation Assistant proposal a person accepted.
ALTER TABLE "eval_cases" ADD COLUMN "origin" text DEFAULT 'user' NOT NULL;
