-- ADR-0023 D9, as amended: an LLM judge is no longer calibrated against
-- human labels. It counts from creation; each verdict is gated by its
-- confidence and a person's review. Written outputs existed only to calibrate
-- judges, so they go, with the labels Scores recorded on them.
DELETE FROM "scores" WHERE "subject_type" = 'written_output';--> statement-breakpoint
DROP TABLE "eval_written_outputs";--> statement-breakpoint
ALTER TABLE "evaluator_versions" DROP COLUMN "calibration";
