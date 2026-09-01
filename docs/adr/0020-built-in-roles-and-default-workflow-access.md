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

### On a workflow, the default is a floor rather than a starting point

A **gated** verb always admits the built-in roles that carry it. Restricting
`run` to `qa-lead` stores `[executor, workflow-manager, qa-lead]`;
`setWorkflowAccess` raises the list on write, so the CLI and the API cannot
produce a row the Access tab could not, and the tab renders those two as locked
chips.

A seeded default alone was not enough, and the failure was immediate rather
than theoretical: a workflow gated by hand before this landed — or by an admin
who typed one project role and saved — named none of the built-ins, so the
workspace owner could neither run nor change a workflow in the workspace they
own, and the role they had been granted for exactly that purpose did nothing.
A default that any single write silently drops is a suggestion.

**An empty list is left empty in both directions.** That is "any workspace
member", the state of every workflow that predates this ADR and of every one
registered by automation, and raising it would gate what is open today
(AGENTS.md §12) — the one change this must never make. It also means the Access
tab needs an explicit "restrict this verb" control: with the floor unremovable,
clearing chips one at a time can no longer be the way back to open.

**A restricted step has the same floor, narrowed to one role.**
`workflow-manager` can act on any human step whatever its `allowedRoles` say,
because "can act on its manual steps" is what the role means and a workflow
manager who cannot complete a step is not one. Here the floor is applied where
the gate reads (`resolveStepGate`, so the claim gate and the actionable inbox
get it from one place) rather than written into the list, because
`allowedRoles` is authored data inside a versioned document that travels
between deployments (ADR-0013): rewriting it would put this platform's
vocabulary into someone else's package, and would not reach the imported step
naming `engineer` that is the case this exists for.

`reviewer` gets no standing on `act` despite carrying the verb, and this is the
asymmetry the `run`/`edit` floor does not have. `reviewer` is an ordinary
process role that 23 definitions in this repo already name; standing authority
for it would let somebody granted it for one step claim every other one — the
escalation this ADR rejected the override reading over. `workflow-manager` is a
name this platform introduced and nobody held before it existed, so it carries
no such history. `reviewer`'s `act` verb survives where it is honest: as the
role a new human step is seeded to allow.

The cost is real and is accepted: a workflow cannot be restricted to `qa-lead`
*instead of* the built-ins, only in addition to them. Excluding somebody from
one workflow means not granting them `executor`. That is the price of the
guarantee that the tab is readable as the whole answer — the alternative was a
list that means what it says until somebody edits it into a wall.

`workflow-manager` is the union of the other three rather than a fourth kind of
privilege. ADR-0019 rules out role hierarchies, so "may do everything to this
workflow" has to be spelled out as the verbs it covers, and it is.

### Why not the override reading

(The floor above narrows the gap between the two readings, and the distinction
it keeps is the one that matters: an override would grant authority the Access
tab does not name, while a floor is a value written into the list the tab
shows and the gate reads.)

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

- **A workspace's owner holds `workflow-manager`**, and keeps it. Granted when
  the workspace is created — by `createNamespace` for an organization and by the
  `GET /api/users/me` bootstrap for a personal workspace, which is the one
  workspace nobody creates by hand and so has its own write — backfilled for
  existing workspaces by migrations
  0045 (owners and admins) and 0046 (owners), and — because the Roles table
  writes a full replace — re-established by `setNamespaceMemberRoles` on every
  write rather than seeded once. Seeding once was not enough for the same
  reason the access floor exists: a demo workspace lost the grant to a single
  replace from that table and was left with gated workflows nobody could reach
  and nobody able to grant the role back. The owner is the one seat that cannot
  be removed or demoted, which is why the invariant is theirs and an admin's
  identical grant stays ordinary and revocable.
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
- **Seeding `allowedRoles` on steps that are not `executor: 'human'`.** An L3
  agent step's approval is a human task, so the step floor reaches it — a
  workflow manager can approve one — but the editor does not write
  `[reviewer, workflow-manager]` into it. Deciding who may approve agent output
  in every new workflow is a bigger call than "who picks up manual work".
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
- **A workspace owner can now run and change every workflow in it.** They hold
  `workflow-manager`, and every restricted list keeps it. ADR-0019 decided
  there would be "deliberately no owner/admin override", reasoning that an
  admin who needs to act should grant themselves the role and leave an audit
  trail — this reaches the same end state, and is recorded here rather than
  left to be discovered. The difference is the one that reasoning cared about:
  there is no branch in the gate. The owner's authority is a grant anyone can
  see in the Roles table and a name anyone can read on the Access tab, written
  by a handler that audits it, rather than a bypass that appears in neither.
  What is genuinely given up is the ability to lock an owner out of a workflow
  in their own workspace, which was not a state anyone asked for and was, in
  the demo that prompted this, the bug.
- **An admin keeps no such standing.** Migration 0045 seeded them
  `workflow-manager` as a convenience and it is revocable like any other grant.
  Only the owner's is an invariant, because the owner is the one seat that
  cannot be removed or demoted.
- **A workflow already gated on other roles now also admits the built-ins.**
  Migration 0046 raises every non-empty `workflow_access` list to its floor.
  This widens access on rows written between ADR-0019 and this ADR, which is
  the intent — those rows are what left an owner locked out of their own
  workspace — and only rows that already restricted are touched.
- **A human block added in the editor arrives with `allowedRoles` filled in.**
  The author sees it in the step editor and can clear it back to "any member".
- **An existing restricted step now also admits `workflow-manager`.** No
  definition is rewritten — the floor is applied at the gate — so what changes
  is who a restricted step admits, not what any workflow package says.
- **The step editor's unheld-role warning no longer claims a step will block
  when another listed role is held.** It was already inaccurate; the seeded
  pair is what would have made it wrong on nearly every new step.

## Out of scope

- **Verbs beyond ADR-0019's three.** No `read`, no per-operation split of
  `edit`.
- **A reserved vocabulary.** An unknown role is still not a validation error,
  and nothing stops a workspace granting a role of its own named `editor`. The
  four names are protected only in the sense that a *gated* list keeps them —
  which is a property of the list, not of the name.
- **Seeding defaults into existing workflows**, or any screen offering to do it
  in bulk. If it is wanted, it is a migration someone runs knowingly.
- **Role hierarchies.** `workflow-manager` enumerates its verbs; it does not
  inherit them from the other three.
