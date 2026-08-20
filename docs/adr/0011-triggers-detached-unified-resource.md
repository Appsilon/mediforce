---
status: accepted
audience: engineers
last_reviewed: 2026-07-27
---

# Triggers are detached resources in a unified table; the Workflow Definition is trigger-free

A **Trigger** (`manual`, `webhook`, `cron`) is a first-class **mutable** resource
keyed by `(namespace, workflowName, name)`, stored in **one unified `triggers`
table** discriminated by `type`, and attached to a Workflow independently of its
immutable versioned Definition. Triggers are managed from CLI and UI and are
portable across instances via an importable/exportable trigger-config file. The
end state of the triggers-detachment epic is that **the Workflow Definition no
longer declares triggers at all** — reached by Issue #932 (see *Rollout status*
below): the `triggers` array is gone from the schema and its DB column is dropped
by migration `0039`.

This ADR records the *target model* and lands the data layer (schema, repo,
Postgres table, authorized wrapper) as pure plumbing. The behavioural flip —
the heartbeat, `ManualTrigger`, and `WebhookRouter` reading the table instead of
`def.triggers`, and `triggers.min(1)` leaving the Definition schema — happens in
later epic issues; **nothing reads or writes the `triggers` table when this ADR
is committed.**

Webhook callable URLs are **derived** from `(host, namespace, workflow, path)`
and never stored, so import re-derives them for the target instance; cron
fire-cursors (`lastTriggeredAt`) anchor to `now` on import so a materialized
schedule never back-fires.

**Driver:** workflows must be portable across instances without baking instance
state into the spec; operators must add / modify / stop any trigger type without
registering a new Definition version; and triggers should behave like Secrets —
detached resources a workflow uses, not fields embedded in the immutable spec.

## Considered options

- **Keep triggers in the Definition (status quo).** Rejected: couples
  operational toggles to immutable versions, is not portable, and bakes
  instance-specific webhook state into the spec.
- **Capability flags in the Definition + detached wiring.** Rejected: confusing
  to declare every type `yes` while only one is wired; still mixes spec and
  operations.
- **Cron-only mutable overlay (PR #870, `feat/cron-trigger-management`, never
  merged).** This branch generalised the `cron_trigger_state` last-fire cursor
  into a live `(namespace, schedule, enabled)` overlay, but only for cron —
  `manual` and `webhook` stayed embedded in the Definition, leaving two
  divergent mechanisms. Superseded by this decision before merge; its shapes are
  the starting point this table generalises. (No ADR was ever committed for that
  branch, so this ADR supersedes a design, not a prior ADR.)
- **One table per trigger type.** Rejected: import/export and the unified
  Triggers tab would fan out across tables for no benefit; partial indexes give
  type-specific constraints on a single table.

## Consequences

- The `cron_trigger_state` overlay (migration `0005`) is **left in place and
  untouched** by this issue; its generalisation into `triggers` and the
  heartbeat cron→trigger rename land in a later epic issue.
- `triggers` is created additively (migration `0030`) with no seed. Seeding from
  existing Definitions happens per-type in later issues.
- `triggers.min(1)` and the triggers array will leave the Definition schema when
  the Definition becomes trigger-free; register / import / validate stop reading
  them and existing definitions' declared triggers migrate into the table.
  **Done in Issue #932:** the array is removed from the schema and migration
  `0039` drops the DB column; register / import / validate no longer read it.
- The persisted resource schema is named `TriggerResource*` because the embedded
  `TriggerSchema` in `process-definition.ts` originally owned the `Trigger` /
  `TriggerSchema` names. With Issue #932 the embedded declaration is gone; the
  resource schema now lives on its own in
  `packages/platform-core/src/schemas/trigger.ts`. See CONTEXT.md "Trigger".
- `listEnabledByType('cron')` is the cross-namespace read the heartbeat will use;
  it runs as a system actor via `scope.system.triggers`. Workspace-scoped callers
  go through `scope.triggers` (the authorized wrapper).

## Rollout status

The epic landed across several issues; the target model above is now fully in
place:

- **#929 / #930 / #931 (PR #1009)** re-homed `cron`, `manual`, and `webhook`
  onto the unified `triggers` table with backfill migrations. The heartbeat,
  `ManualTrigger`, and `WebhookRouter` read the table instead of `def.triggers`.
  The per-workflow `manual` trigger is auto-seeded on register (the hand-start
  gate).
- **#932 (this ADR's final step)** dropped the embedded field entirely: the
  `triggers` array is removed from the `WorkflowDefinition` / `ProcessDefinition`
  schemas, migration `0039` drops the DB column, and register / import / validate
  no longer read or write a definition-level `triggers` field. **Definitions are
  now trigger-free.**

Triggers live solely on the `triggers` table and are managed via
`mediforce workflow trigger-add|trigger-list|trigger-update|trigger-start|trigger-stop|trigger-remove`,
the UI **Triggers** tab, or `POST /api/workflow-definitions/:name/triggers`.
