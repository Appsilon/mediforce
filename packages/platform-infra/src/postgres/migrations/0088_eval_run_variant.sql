-- ADR-0024 D3: an Eval Run may run a Variant of its subject — another model
-- or prompt — and records the patch it ran; null on a run of the subject as it is.
ALTER TABLE "eval_runs" ADD COLUMN "variant" jsonb;--> statement-breakpoint
-- An Agent's Variant run also records the ADR-0029 D2 hash of the patched Agent.
ALTER TABLE "eval_runs" ADD COLUMN "variant_agent_hash" text;
