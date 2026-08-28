-- Issue #1248 (ADR-0019): a process-domain role is held WITHIN a workspace,
-- optionally narrowed to a single workflow.
--
-- `user_roles` was deployment-global `(uid, role)` (ADR-0002 §5): holding
-- `reviewer` anywhere made you a reviewer everywhere. This adds `namespace`
-- (FK -> workspaces.handle, cascade) and a nullable `workflow_name`, where
-- NULL means "every workflow in the workspace" and is the default a grant
-- gets unless narrowed.
--
-- `workflow_name` has NO foreign key on purpose: a workflow is identified by
-- `(namespace, name)` across its versions, so there is no single row to point
-- at. The cascade that would have come for free is done in the handler
-- (`deleteWorkflow`) instead.

ALTER TABLE "user_roles" ADD COLUMN "namespace" text;--> statement-breakpoint
ALTER TABLE "user_roles" ADD COLUMN "workflow_name" text;--> statement-breakpoint

-- The old PK blocks the fan-out below (one global row becomes N per-workspace
-- rows sharing `(uid, role)`), and cannot be re-created over the nullable
-- `workflow_name` anyway. `UNIQUE NULLS NOT DISTINCT` (Postgres 15+) is the
-- replacement: it treats two workspace-wide grants of the same role as the
-- same row, which a plain UNIQUE would not.
ALTER TABLE "user_roles" DROP CONSTRAINT "user_roles_uid_role_pk";--> statement-breakpoint

-- Backfill per ADR-0019: fan each existing global row across the namespaces
-- that user belongs to, scope NULL. A role holder who IS a member of the run's
-- workspace keeps every notification they receive today. A holder who is NOT a
-- member stops being notified — accepted deliberately in the ADR (notifying
-- someone about a run in a workspace they cannot open is a leak, not a
-- feature).
INSERT INTO "user_roles" ("uid", "role", "namespace", "workflow_name")
SELECT DISTINCT ur."uid", ur."role", wm."workspace", NULL
FROM "user_roles" ur
JOIN "workspace_members" wm ON wm."uid" = ur."uid"
WHERE ur."namespace" IS NULL;--> statement-breakpoint

DELETE FROM "user_roles" WHERE "namespace" IS NULL;--> statement-breakpoint

ALTER TABLE "user_roles" ALTER COLUMN "namespace" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_namespace_workspaces_handle_fk" FOREIGN KEY ("namespace") REFERENCES "workspaces"("handle") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_uid_namespace_role_workflow_name_unique" UNIQUE NULLS NOT DISTINCT ("uid","namespace","role","workflow_name");--> statement-breakpoint

-- `user_roles_role_idx` stays (it still serves the deployment-wide read);
-- `(namespace, role)` serves `getUsersByRoleInNamespace`, the query every
-- notification and every enforcement check now runs.
CREATE INDEX "user_roles_namespace_role_idx" ON "user_roles" USING btree ("namespace","role");--> statement-breakpoint

-- Seed, so the gate #1249 adds has someone to pass it. `user_roles` is empty
-- in every deployment (nothing writes it) while workflow definitions already
-- declare `allowedRoles`; an empty table on the day enforcement lands makes
-- every one of those steps unactionable — the #816 phantom-actor failure by a
-- different route, and a violation of AGENTS.md §13. The gate must fail
-- closed, so this is fixed by seeding rather than by weakening the check.
--
-- Every role named by a live workflow definition in a workspace is granted,
-- workspace-wide, to that workspace's owner and admins. It hands them nothing
-- they could not grant themselves thirty seconds later — it only means the
-- first run after the epic lands does not strand.
--
-- The grant and its audit event are one statement so the event reports exactly
-- what was inserted: `RETURNING` sees only the new rows, so a workspace whose
-- owner already held every declared role gets no event, and the backfilled
-- rows above are never miscounted as seeded ones.
WITH declared AS (
	SELECT DISTINCT wd."workspace", role_name."role"
	FROM "workflow_definitions" wd
	CROSS JOIN LATERAL jsonb_array_elements(wd."steps") AS step
	CROSS JOIN LATERAL jsonb_array_elements_text(
		CASE WHEN jsonb_typeof(step->'allowedRoles') = 'array'
			THEN step->'allowedRoles'
			ELSE '[]'::jsonb
		END
	) AS role_name("role")
	WHERE wd."deleted_at" IS NULL
		AND wd."archived_at" IS NULL
		AND jsonb_typeof(wd."steps") = 'array'
		AND role_name."role" <> ''
), seeded AS (
	INSERT INTO "user_roles" ("uid", "role", "namespace", "workflow_name")
	SELECT DISTINCT wm."uid", declared."role", declared."workspace", NULL
	FROM declared
	JOIN "workspace_members" wm
		ON wm."workspace" = declared."workspace"
		AND wm."role" IN ('owner', 'admin')
	-- `user_roles.uid` has an FK to `auth_users`; a membership row for a uid
	-- that never got an auth row (pre-ADR-0002 leftovers) would abort the
	-- whole migration.
	JOIN "auth_users" au ON au."id" = wm."uid"
	ON CONFLICT DO NOTHING
	RETURNING "uid", "role", "namespace"
), granted AS (
	SELECT
		"namespace",
		array_agg(DISTINCT "role") AS "roles",
		array_agg(DISTINCT "uid") AS "uids"
	FROM seeded
	GROUP BY "namespace"
)
INSERT INTO "audit_events" (
	"workspace",
	"actor_id",
	"actor_type",
	"actor_role",
	"action",
	"entity_type",
	"entity_id",
	"timestamp",
	"payload"
)
SELECT
	granted."namespace",
	'system',
	'system',
	'system',
	'namespace.member_roles_seeded',
	'namespace',
	granted."namespace",
	now(),
	jsonb_build_object(
		'description', format(
			'Migration 0042 granted %s process role(s) to %s owner/admin(s) in ''%s''',
			cardinality(granted."roles"), cardinality(granted."uids"), granted."namespace"
		),
		'basis', 'ADR-0019 migration seed: every role declared by this workspace''s workflow definitions, granted workspace-wide to its owner and admins so the role gate has holders on the day it goes live',
		'inputSnapshot', jsonb_build_object('handle', granted."namespace", 'migration', '0042_workspace_scoped_user_roles'),
		'outputSnapshot', jsonb_build_object('roles', to_jsonb(granted."roles"), 'uids', to_jsonb(granted."uids"))
	)
FROM granted;
