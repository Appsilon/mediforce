-- ADR-0024: GEPA optimisations and the cases few-shot examples left out of a
-- run are gone. Stored variant patches keep any `examples` key; reads ignore it.
DROP TABLE "eval_optimisations";--> statement-breakpoint
ALTER TABLE "eval_runs" DROP COLUMN "example_case_ids";
