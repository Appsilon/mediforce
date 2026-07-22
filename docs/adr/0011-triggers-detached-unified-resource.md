---
status: proposed
---

# Triggers are detached resources in a unified table; the Workflow Definition is trigger-free

A **Trigger** (`manual`, `webhook`, `cron`) is a first-class **mutable** resource
keyed by `(namespace, workflowName, name)`, stored in **one unified `triggers`
table** discriminated by `type`, and attached to a Workflow independently of its
immutable versioned Definition. Triggers are managed from CLI and UI and are
portable across instances via an importable/exportable trigger-config file. The
end state of the triggers-detachment epic is that **the Workflow Definition no
longer declares triggers at all**.

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
- The persisted resource schema is named `TriggerResource*` for now because the
  embedded `TriggerSchema` in `process-definition.ts` still owns the `Trigger` /
  `TriggerSchema` names; the rename-back happens when the embedded declaration is
  removed. See CONTEXT.md "Trigger".
- `listEnabledByType('cron')` is the cross-namespace read the heartbeat will use;
  it runs as a system actor via `scope.system.triggers`. Workspace-scoped callers
  go through `scope.triggers` (the authorized wrapper).
