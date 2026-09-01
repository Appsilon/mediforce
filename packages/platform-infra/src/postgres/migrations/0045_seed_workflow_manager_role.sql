-- ADR-0020: every workspace gets at least one `workflow-manager`.
--
-- From here on a workflow's first version is registered with the default
-- access lists (`run: executor, workflow-manager` / `edit: editor,
-- workflow-manager`). That default is only a default if somebody in the
-- workspace can pass it: in a workspace where nobody holds any role it would
-- be a gate with no holders, which is the #816 phantom-actor failure ADR-0019
-- warned the epic to close by seeding rather than by weakening the check.
--
-- `createNamespace` grants the role to the owner of every workspace created
-- after this. This does the same for the ones that already exist — owners and
-- admins, because access is administered by Membership (ADR-0019) and an
-- owner-only seed would leave an admin unable to reach a workflow a member
-- created.
--
-- Plain members are deliberately not seeded: `workflow-manager` carries edit
-- and delete on every workflow in the workspace, and handing that to everyone
-- would make the default gate decorative. A member who creates a workflow is
-- granted `workflow-manager` narrowed to that one workflow at registration
-- time, which is the least privilege that keeps them able to save v2.
--
-- No effect on any existing workflow: rows in `workflow_access` are what gate,
-- and this migration writes none. An unconfigured workflow stays open to every
-- member (AGENTS.md §12).
--
-- The join to `auth_users` is not decoration: `workspace_members.uid` has no
-- foreign key to it and real deployments hold seats for uids that never became
-- auth users (pre-NextAuth Firebase uids, seeded fixtures). `user_roles.uid`
-- does have that key, so seeding straight off the roster fails the whole
-- migration on the first such seat.
INSERT INTO "user_roles" ("uid", "role", "namespace", "workflow_name")
SELECT wm."uid", 'workflow-manager', wm."workspace", NULL
FROM "workspace_members" wm
JOIN "auth_users" au ON au."id" = wm."uid"
WHERE wm."role" IN ('owner', 'admin')
ON CONFLICT DO NOTHING;
