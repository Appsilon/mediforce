-- ADR-0023 D10: every Evaluator is held to the same Acceptance Criteria, so an
-- Evaluator version no longer has a severity. Stored criteria set per severity
-- are read as the strictest of them; signed qualifications are not rewritten.
ALTER TABLE "evaluator_versions" DROP COLUMN "severity";--> statement-breakpoint
-- A run judged per severity is rejudged on read against the strictest floor, so
-- the acceptance stored when it finished is dropped and rebuilt lazily.
UPDATE "eval_runs" SET "acceptance" = NULL WHERE "acceptance_criteria" ?| array['critical', 'major', 'minor'];
