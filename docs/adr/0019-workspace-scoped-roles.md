---
status: proposed
audience: engineers
last_reviewed: 2026-08-21
---

# ADR-0019: Process roles are workspace-scoped

> **Nothing here is built.** This ADR decides how roles *should* work; no part
> of it ships. Today `user_roles` is Deployment-global with no write path, and
> `step.allowedRoles` is declarative — any workspace member can claim and
> complete any human task. Implementation is tracked by the epic,
> [#1246](https://github.com/Appsilon/mediforce/issues/1246); this line changes
> to "Implemented" when the ADR is promoted to `finalized`.

**Date:** 2026-08-21
**Deciders:** Krystian Zieliński
**Issue:** [#1247](https://github.com/Appsilon/mediforce/issues/1247) (epic: [#1246](https://github.com/Appsilon/mediforce/issues/1246))
**On acceptance, partially supersedes:** [ADR-0002](./0002-firebase-auth-to-nextauth.md)
§5, second bullet (the global `user_roles` table). The rest of ADR-0002 stands,
and stays fully binding until this ADR is accepted.
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
2. **`step.allowedRoles` is not enforced.** `RbacService` implements the check
   and `WorkflowEngine.advanceStep` calls it, but `rbacService` is the engine's
   optional 4th constructor argument and production passes `undefined`. Any
   member of a workspace can claim and complete any human task.
3. **Role-based inbox filtering already ships, by accident.** The NextAuth
   `session` callback puts the flat global list on `session.user.roles`,
   `useViewerIdentity` returns **`roles[0]`**, and the Human actions page pivots
   its whole inbox on that one string — so a user holding two roles sees only
   the first one's queue, off a value with no workspace context at all.

Fact 3 is the one ADR-0002 did not weigh, and it is why the scoping question
cannot be deferred any further: the moment roles carry authority, a
namespace-free `roles[0]` is deciding what people see.

## Decision

### A role is held within a workspace

`user_roles` gains a `namespace` column (FK → `workspaces.handle`, cascade
delete); the primary key becomes `(uid, namespace, role)`. `UserDirectoryService`
gains `getUsersByRoleInNamespace(role, namespace)`, and notification targeting
uses it — every Workflow Run carries a `namespace`, so the caller always has one.

Every access question this model answers is *"may this person act on **this**
workflow's step"*, and workflows are owned by a workspace. Deployment-global
roles mean holding `reviewer` in one workspace makes you a reviewer in all of
them — for a platform whose isolation story is the workspace, that is the wrong
default, and the one that gets harder to unwind as roles accumulate.

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
in the workspace, unioned with the `roles` declared on its workflow definitions.

### Where the check lives — confirming ADR-0004, not re-deciding it

This is not a new decision, and is recorded only because five implementation
issues would otherwise each re-derive it. ADR-0004 §4 already keeps roles out of
the `AuthorizedScope` wrapper layer and rejects a combined wrapper (it would
force wrappers to load other entities and build a fragile dependency graph);
§8 already predicts a shared predicate arriving "when role enforcement does".
That reasoning holds unchanged. The division of labour:

- **Wrapper layer** answers *may you see this row* — per-row, workspace reachability.
- **Handlers** answer *may you take this action* — per-action, role capability.

What this ADR adds is only the location: the predicate lands in the existing
`packages/platform-api/src/auth.ts` beside `assertCallerIsNamespaceAdmin`, not in
the new `predicates.ts` file ADR-0004 §8 sketched, because that is where the
first handler-resident gate already lives. `CallerIdentity` carries the caller's
roles per namespace, resolved once per request alongside `namespaceRoles` —
which is the shape ADR-0004 §4 named as its own precondition.

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

- **`session.user.roles` cannot stay a flat array** (fact 3). The `session`
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
  [#1249](https://github.com/Appsilon/mediforce/issues/1249)
- **A typo in `allowedRoles` produces a run nobody can advance** once the gate is
  live. The editor's role pick-list is not polish; it is what keeps the gate from
  becoming a footgun. →
  [#1252](https://github.com/Appsilon/mediforce/issues/1252)
- **Membership removal must drop that user's roles in the workspace.** Roles
  compose with Membership by AND, so a role held by a non-member is unreachable
  — but it is not harmless: it survives `removeNamespaceMember` / `leaveNamespace`
  and silently reactivates if the person is ever re-added. The `namespace` FK
  cascades on workspace *deletion*, which is a different event. Delete the rows
  in the same transaction as the membership. →
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
  by naming a user in the definition. `assignedTo` already pre-assigns a task to
  a person and is unaffected.
- **Role hierarchies or inheritance** (`approver` implies `reviewer`). Flat sets.
- **Hiding workflows a member cannot start.** Listing stays governed by
  `visibility`; this ADR gates actions, not shelves.
- **Renaming `workspace_members.role` to `membership`** — still deferred.
- **The `roles` field on the Workflow Definition envelope**, which declares a
  vocabulary rather than granting anything. Whether it survives now that role
  assignment is real is a question for the implementation issues.
