-- ADR-0010: Cron Trigger rows become live, mutable config (namespace + schedule
-- + enabled), keyed by (namespace, definition_name, trigger_name), not just a
-- last-fire cache. Pre-existing rows are bare last-fire cursors with no schedule
-- or namespace, so they are dropped and rebuilt from the workflow definitions
-- below (the authoritative source of each declared schedule). Discarding the old
-- cursors is safe under the heartbeat's at-least-once semantics.
TRUNCATE TABLE "cron_trigger_state";--> statement-breakpoint
ALTER TABLE "cron_trigger_state" DROP CONSTRAINT "cron_trigger_state_definition_name_trigger_name_pk";--> statement-breakpoint
ALTER TABLE "cron_trigger_state" ADD COLUMN "namespace" text NOT NULL;--> statement-breakpoint
ALTER TABLE "cron_trigger_state" ADD COLUMN "schedule" text NOT NULL;--> statement-breakpoint
ALTER TABLE "cron_trigger_state" ADD COLUMN "enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "cron_trigger_state" ALTER COLUMN "last_triggered_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "cron_trigger_state" ADD CONSTRAINT "cron_trigger_state_namespace_definition_name_trigger_name_pk" PRIMARY KEY("namespace","definition_name","trigger_name");--> statement-breakpoint
-- Backfill live schedules so existing cron workflows keep firing across the cutover
-- to row-driven heartbeat evaluation (ADR-0010). Seed one enabled row per cron
-- trigger declared in the latest non-deleted, non-archived version of each workflow.
-- last_triggered_at is anchored to now() so the schedule resumes at its next slot
-- rather than backfiring history on the first post-deploy heartbeat.
INSERT INTO "cron_trigger_state" ("namespace", "definition_name", "trigger_name", "schedule", "enabled", "last_triggered_at")
SELECT wd."workspace", wd."name", t->>'name', t->>'schedule', true, now()
FROM "workflow_definitions" wd
CROSS JOIN LATERAL jsonb_array_elements(wd."triggers") AS t
WHERE wd."deleted_at" IS NULL
  AND wd."archived_at" IS NULL
  AND t->>'type' = 'cron'
  AND t->>'name' IS NOT NULL
  AND t->>'schedule' IS NOT NULL
  AND wd."version" = (
    SELECT MAX(w2."version")
    FROM "workflow_definitions" w2
    WHERE w2."workspace" = wd."workspace"
      AND w2."name" = wd."name"
      AND w2."deleted_at" IS NULL
      AND w2."archived_at" IS NULL
  )
ON CONFLICT DO NOTHING;
