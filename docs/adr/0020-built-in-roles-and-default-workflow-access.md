---
status: accepted
audience: engineers
last_reviewed: 2026-09-01
---

# ADR-0020: Built-in roles carry their privilege as a default, not as an override

**Date:** 2026-09-01
**Deciders:** Krystian Zieliński
**Extends:** [ADR-0019](./0019-workspace-scoped-roles.md). Nothing in ADR-0019
is superseded: roles stay free-form strings, the gate stays one predicate, and
absent or empty role lists still mean "any workspace member".

## Context

ADR-0019 shipped the machinery for role-based access and deliberately shipped
no roles. A deployment starts with an empty `user_roles` table, every
`workflow_access` row absent, and `step.allowedRoles` written only by whoever
authored the workflow package. Every gate the epic built is opt-in, which is
what made it deployable — and also what leaves an operator with four screens
and no idea what to type into them.

The ask is a starting set: **Editor** may edit a workflow, **Executor** may run
it, **Reviewer** may pick up its manual steps, **Workflow manager** may do all
three.

The obstacle is that in ADR-0019's model a role carries nothing. A role is a
name; privilege lives on the object — `workflow_access.run` / `.edit` on the
workflow, `step.allowedRoles` on the step — and the gate only ever asks "is a
role you hold in this list". So "Editor may edit" has no place to live until we
choose one.

Two readings, and they are not close:

- **The name carries the privilege.** The predicate itself recognises `editor`
  and admits it for `edit` on every workflow in the workspace, whatever the
  lists say.
- **The name is written into the lists by default.** A new workflow is
  registered with `edit: [editor, workflow-manager]` already in it, and the
  ordinary gate does the rest.

## Decision

**The second.** A built-in role is an ordinary role that the platform writes
into the ordinary places, at the one moment those places are empty.

`BUILTIN_ROLES` in `platform-core` is a table of four `(id, label,
description, verbs)` rows. `DEFAULT_WORKFLOW_ACCESS` and
`DEFAULT_STEP_ALLOWED_ROLES` are derived from it rather than written beside it,
so a role's stated privilege and its seeded privilege cannot drift.

| Role | `run` | `edit` | `act` |
|---|---|---|---|
| `executor` | ✓ | | |
| `editor` | | ✓ | |
| `reviewer` | | | ✓ |
| `workflow-manager` | ✓ | ✓ | ✓ |

Three writes, and nothing else:

1. **Registering v1 of a workflow** seeds its `workflow_access` with
   `run: [executor, workflow-manager]`, `edit: [editor, workflow-manager]`.
2. **Adding a human block in the editor** starts its `allowedRoles` at
   `[reviewer, workflow-manager]`.
3. **The pick-lists** offer the four names with their descriptions, always —
   the vocabulary union of ADR-0019 gains them unconditionally.

`workflow-manager` is the union of the other three rather than a fourth kind of
privilege. ADR-0019 rules out role hierarchies, so "may do everything to this
workflow" has to be spelled out as the verbs it covers, and it is.

### Why not the override reading

It is the smaller diff — one `verb` parameter through `resolveRoleGrant` — and
it was rejected on evidence rather than on taste.

`reviewer` is not a new name. Twenty-three workflow definitions in this repo
already list it in `step.allowedRoles` as an ordinary process role, beside
`biostatistician`, `operator` and `author`. Making the predicate treat
`reviewer` as "may act on any human step in the workspace" would silently widen
every one of those grants the day it deployed: a person granted `reviewer` so
they could sign off a TFL step would also be able to claim the step restricted
to `biostatistician`. That is a privilege escalation on existing data, and
AGENTS.md §12 does not let one arrive as a side effect of a feature.

The override reading also costs the property that makes the gate teachable. A
list is the whole answer today — read the Access tab and you know who may run
the workflow. Under an override the tab would be a partial answer, silently
plus whoever holds a name the predicate happens to know, and the only way to
find out would be to read the source.

The default reading keeps the lists true. What it buys is visible and editable:
an admin opens the Access tab of a new workflow and finds two lists already
filled in, which they can widen, narrow, or empty back to "any member".

### Two grants, because a default that locks people out is not a default

The seeded lists name roles the people involved need not hold. Two grants close
that, and they are part of the decision rather than implementation detail:

- **A workspace's owner holds `workflow-manager`** from the moment the
  workspace is created, and migration 0045 backfills owners and admins of
  workspaces that already exist. Without it a workspace's first seeded gate
  would have no holder at all — ADR-0019's own warning that a declared role
  with zero holders strands every run that reaches it, arriving through the
  front door this time.
- **Whoever registers a workflow holds `workflow-manager` narrowed to that
  workflow.** Seeding `edit: [editor, workflow-manager]` for an author who
  holds neither would refuse them their own second Save. The narrowed grant is
  the least privilege that prevents it, it is visible in the Roles table, an
  admin can revoke it, and it dies with the workflow through the cascade every
  narrowed grant already has.

The second grant is close to the workflow ownership ADR-0019 put out of scope,
and stops short of it deliberately: no `createdBy` field, no ownership concept,
nothing that outlives a revoke. It is one row in `user_roles` that an admin
administers like every other row.

`grantRole(uid, namespace, grant)` is added to `UserDirectoryService` for these
two callers. `setRolesForUser` cannot serve them — it is a full replace, so
adding one grant through it means read-modify-write, which re-opens exactly the
interleaving its lock exists to close and can resurrect grants a concurrent
membership removal has just cascaded away.

### What is deliberately not seeded

- **Existing workflows.** No `workflow_access` row is written by the migration.
  A workflow that has never opened its Access tab stays open to every member,
  which is what it was yesterday (AGENTS.md §12). The consequence is worth
  stating plainly: granting somebody `executor` changes nothing about a
  workflow that predates this, because that workflow is open to them already.
  The defaults bite on what is created from now on.
- **Workflows registered by a system actor.** The CLI, imports and the seeded
  builtins register with an API key, which has no uid to grant, so a gate
  seeded there would name roles nobody in the workspace holds. They stay open
  (AGENTS.md §13).
- **Plain members.** `workflow-manager` carries edit and delete across the
  whole workspace; seeding it to everyone would make the gate decorative.
- **Steps that are not `executor: 'human'`.** An L3 agent step's approval is a
  human task and `allowedRoles` would gate it, but defaulting that would decide
  who may approve agent output in every new workflow — a bigger call than "who
  picks up manual work" and not the one being made here.
- **Copies.** A copy that stays in the workspace already inherits its source's
  access (ADR-0019); one that leaves carries nothing and lands open, for the
  reason grants do not travel across workspaces.
- **Anything a deployment renames.** The four names are free-form strings like
  every other role. A workspace that already granted `editor` inherits this
  meaning, which is the cost of not introducing the reserved vocabulary
  ADR-0019 rejected — and the reason the names were chosen to mean what they
  already appear to mean.

## Consequences

Binding:

- A role's privilege is always readable from the object it applies to. If the
  Access tab does not name a role, that role cannot run or edit the workflow.
- The built-in table is the single source for both the defaults and the
  pick-list. Adding a verb to a role changes what new workflows are seeded
  with; it never changes an existing workflow.
- Every workspace has at least one `workflow-manager`, and every workflow at
  least one person who can edit it.

User-visible changes (AGENTS.md §12), accepted deliberately:

- **A workflow created in the UI is no longer open to every member.** Its
  author and the holders of `editor` / `executor` / `workflow-manager` can
  reach it; other members are refused, with the refusal naming the role to ask
  for. This is the feature, and it applies only to workflows created after
  this lands.
- **A human block added in the editor arrives with `allowedRoles` filled in.**
  The author sees it in the step editor and can clear it back to "any member".
- **The step editor's unheld-role warning no longer claims a step will block
  when another listed role is held.** It was already inaccurate; the seeded
  pair is what would have made it wrong on nearly every new step.

## Out of scope

- **Verbs beyond ADR-0019's three.** No `read`, no per-operation split of
  `edit`.
- **A reserved vocabulary.** The built-ins are suggestions with defaults, not
  protected names; an unknown role is still not a validation error.
- **Seeding defaults into existing workflows**, or any screen offering to do it
  in bulk. If it is wanted, it is a migration someone runs knowingly.
- **Role hierarchies.** `workflow-manager` enumerates its verbs; it does not
  inherit them from the other three.
