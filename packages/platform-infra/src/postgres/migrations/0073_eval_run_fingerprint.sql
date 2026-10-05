-- ADR-0024: an Eval Run runs the Step alone, so it carries the Step's
-- Fingerprint itself instead of a list of variants. `eval_trials.variant_id`
-- stays as a legacy column that new trials default; no challenger trial was
-- ever run, so every row is the step's own. Signed qualifications are not rewritten; only the lookup
-- column beside the record goes, and reads ignore its old variant keys.
ALTER TABLE "eval_runs" ADD COLUMN "fingerprint" jsonb;--> statement-breakpoint
UPDATE "eval_runs" SET "fingerprint" = NULLIF((
  SELECT "variant" -> 'fingerprint' FROM jsonb_array_elements("variants") AS "element"("variant")
  WHERE "variant" ->> 'id' = 'champion'
), 'null'::jsonb);--> statement-breakpoint
ALTER TABLE "eval_runs" DROP COLUMN "variants";--> statement-breakpoint
ALTER TABLE "eval_trials" ALTER COLUMN "variant_id" SET DEFAULT 'champion';--> statement-breakpoint
ALTER TABLE "step_qualifications" DROP COLUMN "variant_id";
