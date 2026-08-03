-- Trigger Context: the transport metadata of the firing that started a run
-- (ADR-0012). `trigger_payload` becomes the *validated, trigger-agnostic* input
-- conforming to the definition's `triggerInput`, so the webhook envelope it used
-- to carry (`headers`/`query`/`method`/`path`) and the cron tick fields
-- (`schedule`/`firedAt`) move here, where a step reaching for them
-- (`${triggerContext.*}`) is visibly re-coupling itself to one trigger kind.
--
-- Nullable with no backfill: runs created before this migration keep their old
-- `trigger_payload` shape verbatim. Rewriting historical payloads would falsify
-- the audit record of what a firing actually sent, and no live code path reads
-- an old run's payload for interpolation (steps interpolate from the run they
-- are executing, which is created post-migration).

ALTER TABLE "process_instances" ADD COLUMN "trigger_context" jsonb;
