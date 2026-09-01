-- ADR-0020, second pass: the built-in roles are a floor a gated list cannot
-- drop below, not just the value a new workflow starts at.
--
-- Migration 0045 seeded `workflow-manager` and left it revocable, and the
-- defaults were seeded only into workflows created after it. Both gaps had the
-- same shape in practice: a workspace whose owner's grants were replaced from
-- the Roles table, and a workflow gated by hand before this landed, ended up
-- with a gate nobody in the workspace could pass.
--
-- `setWorkflowAccess` and `setNamespaceMemberRoles` now hold both invariants on
-- every write. This brings the rows written before they did into line.

-- 1. Every workspace owner holds `workflow-manager`, workspace-wide.
--
-- Owners only, unlike 0045 — an admin's grant is ordinary and revoking it is a
-- decision this must not undo. The owner's is the invariant: it is the one
-- seat that cannot be removed or demoted, so it is the only one that can
-- guarantee somebody is left to grant the others back.
INSERT INTO "user_roles" ("uid", "role", "namespace", "workflow_name")
SELECT wm."uid", 'workflow-manager', wm."workspace", NULL
FROM "workspace_members" wm
JOIN "auth_users" au ON au."id" = wm."uid"
WHERE wm."role" = 'owner'
ON CONFLICT DO NOTHING;--> statement-breakpoint

-- 2. A gated verb admits the built-in roles that carry it.
--
-- `run_roles = []` and `edit_roles = []` are left alone in both directions:
-- an empty list is "any workspace member", and raising it would gate what is
-- open today (AGENTS.md §12). Only a list that already restricts is raised.
UPDATE "workflow_access"
SET "run_roles" = (
      SELECT jsonb_agg(DISTINCT role ORDER BY role)
      FROM jsonb_array_elements_text(
        "run_roles" || '["executor", "workflow-manager"]'::jsonb
      ) AS role
    )
WHERE jsonb_array_length("run_roles") > 0;--> statement-breakpoint

UPDATE "workflow_access"
SET "edit_roles" = (
      SELECT jsonb_agg(DISTINCT role ORDER BY role)
      FROM jsonb_array_elements_text(
        "edit_roles" || '["editor", "workflow-manager"]'::jsonb
      ) AS role
    )
WHERE jsonb_array_length("edit_roles") > 0;
