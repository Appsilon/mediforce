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
--
-- The manual singleton is a reserved resource keyed on the fixed name `manual`.
-- A legacy workflow may declare a cron trigger literally named `manual`, which
-- the cron back-fill (0036) will already have written under that primary key.
-- Left in place it would swallow the singleton INSERT below via
-- `ON CONFLICT DO NOTHING`, leaving the workflow un-hand-startable. Migrate the
-- colliding row to `manual-cron` first so the reserved name is free. Cron fires
-- by `type`, never by name, so only the label changes; the guard skips the
-- rename in the (vanishingly unlikely) case that `manual-cron` is itself taken.
UPDATE "triggers" AS c
SET "trigger_name" = 'manual-cron', "updated_at" = now()
WHERE c."type" = 'cron'
	AND c."trigger_name" = 'manual'
	AND NOT EXISTS (
		SELECT 1 FROM "triggers" other
		WHERE other."namespace" = c."namespace"
			AND other."workflow_name" = c."workflow_name"
			AND other."trigger_name" = 'manual-cron'
	);
--> statement-breakpoint
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
