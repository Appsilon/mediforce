-- Issue #929 (ADR-0011): re-home cron onto the unified `triggers` table and
-- retire the cron-only `cron_trigger_state` overlay (migration 0005).
--
-- One-time back-fill: create a `type='cron'` row in `triggers` for every cron
-- trigger declared on each workflow's latest LIVE (non-deleted, non-archived)
-- definition version, so existing schedules keep firing across the cutover. The
-- fire cursor (`last_triggered_at`) anchors to `now()` so a materialized
-- schedule never back-fires. `ON CONFLICT DO NOTHING` makes the back-fill
-- idempotent and never clobbers a row already managed via the API.
INSERT INTO "triggers" (
	"namespace",
	"workflow_name",
	"trigger_name",
	"type",
	"enabled",
	"config",
	"last_triggered_at",
	"created_at",
	"updated_at"
)
SELECT
	latest."workspace",
	latest."name",
	elem->>'name',
	'cron',
	true,
	jsonb_build_object('schedule', elem->>'schedule'),
	now(),
	now(),
	now()
FROM (
	SELECT DISTINCT ON ("workspace", "name")
		"workspace", "name", "triggers"
	FROM "workflow_definitions"
	WHERE "deleted_at" IS NULL AND "archived_at" IS NULL
	ORDER BY "workspace", "name", "version" DESC
) AS latest
CROSS JOIN LATERAL jsonb_array_elements(latest."triggers") AS elem
WHERE jsonb_typeof(latest."triggers") = 'array'
	AND elem->>'type' = 'cron'
	AND elem->>'name' IS NOT NULL
	AND elem->>'schedule' IS NOT NULL
	AND elem->>'schedule' <> ''
ON CONFLICT DO NOTHING;
--> statement-breakpoint
DROP TABLE "cron_trigger_state";
