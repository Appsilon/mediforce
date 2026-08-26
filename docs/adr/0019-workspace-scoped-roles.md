---
status: accepted
audience: engineers
last_reviewed: 2026-08-27
---

# ADR-0019: Process roles are workspace-scoped

> **Partly built.** The storage model below ships as of
> [#1248](https://github.com/Appsilon/mediforce/issues/1248): `user_roles` is
> workspace-scoped with an optional `workflow_name`, owner/admin can grant
> roles via workspace settings, CLI and API, notification targeting is namespace- and
> workflow-scoped, and all three cascades (membership removal, workflow
> deletion, workflow transfer) are in place — membership is checked by the
> write itself, under the lock that also serializes concurrent replaces.
> [#1250](https://github.com/Appsilon/mediforce/issues/1250) adds the screen: a
> **Roles** table in workspace settings (`Member | Role | Workflows`, one row
> per assignment), editable by owner/admin, offering the pick-list described
> below (roles held in the workspace, unioned with the `roles` its workflow
> definitions declare). The **`act` verb** ships as of
> [#1249](https://github.com/Appsilon/mediforce/issues/1249):
> `assertCallerHoldsRole` lives in `packages/platform-api/src/auth.ts` and gates
> task claim and complete, reading `allowedRoles` off the run's pinned
> definition; `RbacService` is deleted rather than switched on. The **`run` and
> `edit` verbs are not gated yet** — any member can still start, register,
> delete or transfer any workflow in the workspace (fact 3 below). The rest of
> the epic is [#1246](https://github.com/Appsilon/mediforce/issues/1246); this
> line changes to "Implemented" when those land and the ADR is promoted to
> `finalized`.

**Date:** 2026-08-21
**Deciders:** Krystian Zieliński
**Issue:** [#1247](https://github.com/Appsilon/mediforce/issues/1247) (epic: [#1246](https://github.com/Appsilon/mediforce/issues/1246))
**Partially supersedes:** [ADR-0002](./0002-firebase-auth-to-nextauth.md)
§5, second bullet (the global `user_roles` table). The rest of ADR-0002 stands
and remains fully binding.
**Answers:** [ADR-0004](./0004-scoped-data-access-authorization.md) §4 and its
"Out of scope — role enforcement at the HTTP API layer", which deferred this to
"a later ADR that lands alongside or after ADR-0002".

## Context

Process-domain Roles (`reviewer`, `PI`, `approver` — `CONTEXT.md`) live in a
deployment-global `user_roles(uid, role)` table. ADR-0002 §5 chose global
deliberately, to protect `getUsersByRole(role)` — the engine's `task_assigned`
and `agent_escalation` notification targeting, called with no namespace in hand.
Scoping it would have been "a regression dressed as a migration". That ADR left the door open:
"per-workspace functional roles can return later as a real product decision if
asked." They have been asked for ([#1246](https://github.com/Appsilon/mediforce/issues/1246)).

Three facts about the current implementation shaped this decision, all verified
against source:

1. **No one can grant a role.** The table is written by the one-time
   `seed-user-roles` migration and by `PostgresInviteService.seedInvite`, whose
   only caller — the `inviteUser` handler — passes `roles: []` hardcoded.
   *(Resolved by [#1248](https://github.com/Appsilon/mediforce/issues/1248):
   `setNamespaceMemberRoles` + `mediforce namespace set-member-roles`.)*
2. **`step.allowedRoles` is not enforced.** `RbacService` implements the check
   and `WorkflowEngine.advanceStep` calls it, but `rbacService` is the engine's
   optional 4th constructor argument and production passes `undefined`. Any
   member of a workspace can claim and complete any human task. *(Resolved by
   [#1249](https://github.com/Appsilon/mediforce/issues/1249): the gate is
   `assertCallerHoldsRole`, and `RbacService` and its constructor slot are
   gone.)*
3. **No workflow mutation is gated.** `register-workflow`, `delete-workflow`,
   `archive-workflow`, `transfer-workflow`, `set-visibility` and `copy-workflow`
   check workspace membership and nothing else — not even owner/admin. Any
   member can delete or re-register any workflow in the workspace.
4. **Role-based inbox filtering already ships, by accident.** The NextAuth
   `session` callback puts the flat global list on `session.user.roles`,
   `useViewerIdentity` returns **`roles[0]`**, and the Human actions page pivots
   its whole inbox on that one string — so a user holding two roles sees only
   the first one's queue, off a value with no workspace context at all.

Fact 4 is the one ADR-0002 did not weigh, and it is why the scoping question
cannot be deferred any further: the moment roles carry authority, a
namespace-free `roles[0]` is deciding what people see.

## Decision

### A role is held within a workspace, optionally narrowed to workflows

`user_roles` gains a `namespace` column (FK → `workspaces.handle`, cascade
delete) and a nullable `workflow_name`, uniquely keyed on
`(uid, namespace, role, workflow_name)` with `NULLS NOT DISTINCT` (Postgres 16).
`NULL` means *every workflow in the workspace* and is the default; a value
narrows the grant to one workflow. `UserDirectoryService` gains
`getUsersByRoleInNamespace(role, namespace, workflowName)`.

Every access question this model answers is *"may this person act on **this**
workflow's step"*, and workflows are owned by a workspace. Deployment-global
roles mean holding `reviewer` in one workspace makes you a reviewer in all of
them — for a platform whose isolation story is the workspace, that is the wrong
default, and the one that gets harder to unwind as roles accumulate.

The narrowing exists because the alternative is worse. "Alice reviews this
workflow but not that one" can be expressed by naming roles more specifically —
`tfl-reviewer`, `protocol-reviewer` — but that pushes one deployment's org chart
into an artifact meant to travel: under
[ADR-0013](./0013-workflow-packages-outside-platform-repo.md) a workflow package
is imported elsewhere, and a WD naming `tfl-reviewer` has baked in a local
convention where `reviewer` would have stated a functional requirement. It also
scales badly — twenty workflows times three roles is sixty role names, and
granting one person rights on five workflows becomes five grants of five
different roles.

Scoping inverts that at the cost of one nullable column: the definition stays
generic and portable, the workspace stays specific. It also **degrades to the
simple case** — the default grant is workspace-wide, so nothing about the model
gets more complicated until someone actually needs narrowing.

Two consequences follow from the scope column and are easy to miss:

- **Notification targeting must carry the workflow**, or a grant scoped to
  workflow A emails its holder about runs of workflow B — enforcement would be
  narrowed while notifications leak.
- **Deleting a workflow must drop grants scoped to it**, for the same reason
  membership removal must drop the workspace's grants: an invisible row that
  silently reactivates when the name is reused.

ADR-0002's regression objection is real, and the migration narrows it rather
than eliminating it. **Backfill each existing global row across the namespaces
that user belongs to.** Then:

- A role holder who **is** a member of the run's workspace keeps every
  notification they receive today. This covers the ordinary case and is what
  [#1248](https://github.com/Appsilon/mediforce/issues/1248) must prove with a
  migration test.
- A role holder who is **not** a member of that workspace stops being notified.
  Today's global query happily emails them; after this it does not.

That second bullet is a behaviour change on existing data, so it is a regression
under AGENTS.md §12 and is accepted here deliberately rather than discovered
later: notifying someone about a run in a workspace they cannot open is a leak,
not a feature. Going forward, a role granted after this lands reaches only its
own workspace — which is the point of the ADR.

Roles stay **free-form strings**: no vocabulary table, no screen to manage one.
An unknown role therefore cannot be a validation error — the vocabulary is open
by construction. The pick-list the UI offers is computed from roles already held
in the workspace, unioned with the `roles` declared on its workflow definitions,
which already answers "what roles exist here" without new storage.

A curated list was considered and rejected on the same portability ground as
role-naming above. Its prize is typo prevention, which the computed pick-list
(a grant can only pick a role that exists) and the authoring-time warning
already deliver. Its cost is that an imported WD naming a role the deployment
has never heard of — 23 definitions in this repo already use 8 such names — must
be rejected, imported broken, or silently auto-create the entry, which is
free-form with extra ceremony.

### Three verbs are gated by roles; `read` is not one of them

The same role predicate gates three actions, at two levels:

| Verb | Level | Gate |
|---|---|---|
| `run` — start a run | workflow | workflow `allowedRoles` |
| `edit` — register a version, archive, delete, transfer, set visibility | workflow | workflow `allowedRoles` |
| `act` — claim and complete a human task | step | `step.allowedRoles` |

**`read` is deliberately not gated.** Every member of a workspace sees every
workflow in it, and `visibility` keeps its existing meaning as the
*cross-workspace* shelf. Hiding a workflow intra-workspace would mean hiding
everything that hangs off it — its runs, tasks, and audit events — across three
wrapper classes, which is a large surface where a missed query leaks rather than
merely annoys. The value did not justify it: a member who can see a workflow but
cannot run or edit it is a legible state, and an unreadable one is not worth the
blast radius.

Step-level gating stays **on the Workflow Definition**, where the author writes
it, and accepts multiple free-form roles. This keeps a workflow package portable
under [ADR-0013](./0013-workflow-packages-outside-platform-repo.md): the WD
declares *"a `reviewer` does this step"* and travels with that intent, while the
workspace separately binds `reviewer` to people. An operational override that
contradicted the definition would give the same step two answers and make the WD
stop describing the process it runs — unacceptable in a regulated audit trail.

Workflow-level `run`/`edit` access is **not** on the definition. Like
`visibility` it is mutable and operational, so it lives in a side table keyed by
`(namespace, workflow)`. Putting it in the versioned document would mean
registering v8 silently rewrites permissions, and would hand the design LLM a
field that grants authority.

Both levels grant through **roles, never by naming a user** — a role with one
member expresses "only Krystian may edit this" without a second mechanism.
Administering workflow access is a Membership privilege (owner/admin), so no
workflow-ownership concept is introduced; `WorkflowDefinition` has no `createdBy`
and nothing exists to backfill one from.

### Where the check lives — confirming ADR-0004, not re-deciding it

This is not a new decision, and is recorded only because five implementation
issues would otherwise each re-derive it. ADR-0004 §4 already keeps roles out of
the `AuthorizedScope` wrapper layer and rejects a combined wrapper (it would
force wrappers to load other entities and build a fragile dependency graph);
§8 already predicts a shared predicate arriving "when role enforcement does".
That reasoning holds unchanged. The division of labour:

- **Wrapper layer** answers *may you see this row* — per-row, workspace reachability.
- **Handlers** answer *may you take this action* — per-action, role capability.

What this ADR adds is only the location and the shape:
`assertCallerHoldsRole(caller, namespace, workflow, allowedRoles)` lands in the
existing `packages/platform-api/src/auth.ts` beside
`assertCallerIsNamespaceAdmin`, not in the new `predicates.ts` file ADR-0004 §8
sketched, because that is where the first handler-resident gate already lives.
One predicate serves all three verbs; `workflow` is what lets a scoped grant be
honoured. `CallerIdentity` carries the caller's roles per namespace, resolved
once per request alongside `namespaceRoles` — which is the shape ADR-0004 §4
named as its own precondition.

## Considered options

- **Keep roles global, add only a write path.** Cheapest, and it would make the
  demo work. Rejected: it bakes "reviewer everywhere" into the first release
  where roles carry real authority, and every workspace added afterwards
  inherits the wrong default. Migrating later means revoking roles people
  already rely on.
- **Put roles on `workspace_members.roles[]`** (ADR-0002's rejected draft
  shape). Rejected again, for the reason ADR-0002 gave and one more: an array
  column cannot be indexed for `getUsersByRoleInNamespace` as cleanly as a join
  table, and role membership is a set with its own lifecycle, not an attribute
  of a seat.
- **Scope roles to the workflow rather than the workspace.** Rejected: it makes
  granting a role an N-times-per-workflow chore for the admin, and the roles
  people actually hold (`reviewer`, `PI`) are organisational, not per-process.
- **A `deployment_admin` override on the enforcement gate.** Rejected for now.
  An admin who needs to act grants themselves the role, which leaves an audit
  trail a silent bypass does not. ADR-0002 §5 dropped the `deployment_admin`
  column for want of a reader; this is not the feature that resurrects it.

## Consequences

Binding:

- Absent or empty `allowedRoles` continues to mean "any workspace member", so
  existing steps and workflows keep working untouched. The gate is opt-in.
- One predicate gates every level the epic adds — workflow start, task claim,
  task complete — so there is a single rule to learn.
- `CONTEXT.md`'s **Roles** entry becomes workspace-scoped. Membership vs Roles
  stays the distinction it already draws, and now matters more: both
  `workspace_members.role` and `user_roles.role` are per-workspace and mean
  different things. The rename to `membership` that ADR-0002 §5 deferred is
  worth more than it was — still out of scope here.

Implications the implementation issues must resolve, not decided here:

- **`session.user.roles` cannot stay a flat array** (fact 4). The `session`
  callback runs on every session read with no route params, so it has nothing to
  scope to. Either it carries a `handle → roles` map, or the browser reads roles
  per workspace instead. Whichever wins, the current `roles[0]` inbox pivot
  changes behaviour, making it user-visible (AGENTS.md §12) rather than a
  refactor. → [#1248](https://github.com/Appsilon/mediforce/issues/1248) /
  [#1251](https://github.com/Appsilon/mediforce/issues/1251)
- **Where enforcement reads `allowedRoles` from.** `HumanTask.assignedRole` holds
  only `allowedRoles[0]`, so gating on it would enforce a rule the author did not
  write; the run's pinned Workflow Definition carries the full array and needs no
  `human_tasks` migration. →
  [#1249](https://github.com/Appsilon/mediforce/issues/1249)
- **`RbacService` is superseded rather than switched on.** It resolves the caller
  through the client-side `AuthService` (wrong side of the ADR-0005 boundary for
  a server authorization decision) and gates `advanceStep` — engine machinery
  running as the system actor — rather than the human action. →
  [#1249](https://github.com/Appsilon/mediforce/issues/1249) *(deleted, along
  with the `AuthService` port it was the only consumer of)*
- **A typo in `allowedRoles` produces a run nobody can advance** once the gate is
  live. The editor's role pick-list is not polish; it is what keeps the gate from
  becoming a footgun. →
  [#1252](https://github.com/Appsilon/mediforce/issues/1252)
- **Membership removal must drop that user's roles in the workspace.** Roles
  compose with Membership by AND, so a role held by a non-member is unreachable
  — but it is not harmless: it survives `removeNamespaceMember` / `leaveNamespace`
  and silently reactivates if the person is ever re-added. The `namespace` FK
  cascades on workspace *deletion*, which is a different event. Delete the rows
  in the same transaction as the membership — and refuse to write the same row
  from the other end: `setRolesForUser` takes the member's `workspace_members`
  row `FOR UPDATE` before it replaces anything, so a removal committing
  mid-request cannot recreate the grant the cascade just deleted. That lock is
  also what makes "full replace" mean what it says. Under READ COMMITTED two
  admins editing the same member each delete the set they read and insert their
  own, leaving the union — a set neither of them asked for, holding roles
  neither of them granted. →
  [#1248](https://github.com/Appsilon/mediforce/issues/1248)
- **A workflow leaving a workspace must drop the grants narrowed to it.**
  Deletion is one way the name comes free; transferring the workflow to another
  workspace is the other. Grants do not travel with it — their holders need not
  be members of the destination, and copying them there is the cross-workspace
  leak this ADR exists to prevent — so `transferWorkflowNamespace` clears them
  in the source, exactly as `deleteWorkflow` does. →
  [#1248](https://github.com/Appsilon/mediforce/issues/1248)
- **A declared role with zero holders strands every run that reaches it.** Today
  23 workflow definitions in this repo already declare `allowedRoles` across 8
  role names (`reviewer`, `biostatistician`, `operator`, `author`, …), and
  `user_roles` is empty, so on the day enforcement lands every one of those steps
  becomes unactionable — the #816 phantom-actor failure mode, reintroduced by a
  different route. The gate must **fail closed** (an unheld role is not an open
  step; silently un-gating an approval control is the worse failure in a
  regulated context), so the deployability requirement of AGENTS.md §13 has to be
  met by seeding rather than by weakening the check. →
  [#1248](https://github.com/Appsilon/mediforce/issues/1248) /
  [#1249](https://github.com/Appsilon/mediforce/issues/1249)

## Out of scope

- **Per-user ACLs on workflows or steps.** Access is granted through roles, never
  by naming a user; a single-member role covers the "only this person" case.
  `assignedTo` already pre-assigns a task to a person and is unaffected.
- **Role hierarchies or inheritance** (`approver` implies `reviewer`). Flat sets.
- **Workflow ownership / `createdBy`.** Not introduced; workflow access is
  administered by workspace owner/admin. Revisit only if per-creator control is
  actually asked for.
- **Renaming `workspace_members.role` to `membership`** — still deferred.
- **The `roles` field on the Workflow Definition envelope**, which declares a
  vocabulary rather than granting anything. Whether it survives now that role
  assignment is real is a question for the implementation issues.
