-- Issue #930 (ADR-0011): make `manual` a table-backed trigger resource,
-- completely detached from the workflow definition. Hand-starting a workflow is
-- gated on an enabled `manual` row in `triggers`, not on the definition's
-- `triggers[]`.
--
-- One-time back-fill: every live (non-deleted, non-archived) workflow gets a
-- single enabled `manual` trigger named `manual` — the per-workflow singleton
-- switch that makes it hand-startable — regardless of what its definition
-- declares. Created only where the workflow has no manual row yet, so a row
-- already managed via the API (e.g. one a user stopped) is never clobbered.
-- Manual rows carry an empty config and no fire cursor.
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
	'manual',
	'manual',
	true,
	'{}'::jsonb,
	NULL,
	now(),
	now()
FROM (
	SELECT DISTINCT ON ("workspace", "name")
		"workspace", "name"
	FROM "workflow_definitions"
	WHERE "deleted_at" IS NULL AND "archived_at" IS NULL
	ORDER BY "workspace", "name", "version" DESC
) AS latest
WHERE NOT EXISTS (
	SELECT 1 FROM "triggers" t
	WHERE t."namespace" = latest."workspace"
		AND t."workflow_name" = latest."name"
		AND t."type" = 'manual'
)
ON CONFLICT DO NOTHING;
