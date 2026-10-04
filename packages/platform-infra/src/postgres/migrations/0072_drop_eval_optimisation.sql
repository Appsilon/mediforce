-- ADR-0024: GEPA optimisations and few-shot examples are gone. A stored
-- variant patch or qualification loses its `examples`, since the strict patch
-- schema would refuse to read it.
DROP TABLE "eval_optimisations";--> statement-breakpoint
ALTER TABLE "eval_runs" DROP COLUMN "example_case_ids";--> statement-breakpoint
UPDATE "eval_runs" SET "variants" = (
  SELECT jsonb_agg(jsonb_set("variant", '{patch}', ("variant" -> 'patch') - 'examples') ORDER BY "position")
  FROM jsonb_array_elements("variants") WITH ORDINALITY AS "element"("variant", "position")
) WHERE EXISTS (SELECT 1 FROM jsonb_array_elements("variants") AS "element"("variant") WHERE "variant" -> 'patch' ? 'examples');--> statement-breakpoint
UPDATE "step_qualifications" SET "record" = jsonb_set("record", '{patch}', ("record" -> 'patch') - 'examples')
WHERE "record" -> 'patch' ? 'examples';
