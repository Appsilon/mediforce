-- Issue #931 (ADR-0011): re-home webhook onto the unified `triggers` table. The
-- catch-all webhook endpoint now resolves an enabled `type='webhook'` row by
-- exact path + method instead of scanning the definition's advisory
-- `triggers[]`.
--
-- One-time back-fill: create a `type='webhook'` row for every webhook trigger
-- declared on each workflow's latest LIVE (non-deleted, non-archived)
-- definition version, so existing endpoints keep resolving across the cutover.
-- Opt-in — only declared webhooks are backfilled, never auto-seeded. Webhook
-- rows carry no fire cursor. `ON CONFLICT DO NOTHING` makes the back-fill
-- idempotent and never clobbers a row already managed via the API (nor a path
-- already taken by another webhook on the same workflow).
--
-- `manual` is reserved for the hand-start singleton the previous migration
-- (0037) writes under that primary key. A legacy workflow that declares a
-- webhook trigger literally named `manual` would collide with it and be dropped
-- by `ON CONFLICT DO NOTHING`, silently retiring that endpoint. Migrate such a
-- row to `manual-webhook` instead — the endpoint resolves by config path, never
-- by name, so only the label changes.
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
	CASE WHEN elem->>'name' = 'manual' THEN 'manual-webhook' ELSE elem->>'name' END,
	'webhook',
	true,
	jsonb_build_object(
		'method', elem->'config'->>'method',
		'path', elem->'config'->>'path'
	),
	NULL,
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
	AND elem->>'type' = 'webhook'
	AND elem->>'name' IS NOT NULL
	AND elem->'config'->>'method' IS NOT NULL
	AND elem->'config'->>'path' IS NOT NULL
ON CONFLICT DO NOTHING;
