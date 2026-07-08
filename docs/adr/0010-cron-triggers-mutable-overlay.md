---
status: accepted
---

# Cron Triggers are a mutable overlay decoupled from the Workflow Definition

A **Cron Trigger** — the live, running schedule attached to a Workflow — is a
first-class mutable entity keyed by `(namespace, definitionName, triggerName)`,
stored separately from the immutable, versioned Workflow Definition that
declares it. It owns `enabled` (start/stop), `schedule` (the live cadence), and
`lastTriggeredAt` (fire cursor). The cron `Trigger` entry inside a Definition's
`triggers` array is only a **seed**: on registration it creates the overlay row
if none exists, and is ignored thereafter. The heartbeat enumerates **Cron
Trigger rows** (not Definition trigger arrays) to decide what fires. This is
the extension of today's `CronTriggerState` (`{definitionName, triggerName,
lastTriggeredAt}`) with `namespace`, `enabled`, and `schedule`.

The driver: a Workflow Definition is immutable and versioned, but users need to
add a schedule to an existing workflow, start/stop it, and change its cadence
from both CLI and UI **without registering a new definition version**. Binding
those operations to definition edits would bump the version integer on every
operational toggle and mix operational state into the spec.

## Considered options

- **Edit the Definition (a new version per change).** Rejected: every
  start/stop or cadence tweak becomes a new immutable version, conflating
  operational toggles with spec changes, and forces an ambiguous "which
  version's triggers does the heartbeat honor?" question.
- **Definition stays authoritative for cadence; overlay holds only `enabled`.**
  Rejected: "modify the schedule" would still require a redeploy, only
  half-meeting the goal, and re-registration would silently revert a user's
  live schedule change.
- **Fully separate Cron Trigger aggregate** that no longer lives in the
  Definition at all. Rejected as over-scoped: it forces a migration of the
  `triggers.min(1)` constraint and every registration path for no added
  capability over the overlay.

## Consequences

- **The `.wd.json` schedule is advisory after first seed.** Once the overlay
  row exists, editing the declared `schedule` and re-registering has no effect
  on the running Cron Trigger — the file and the live cadence can diverge
  permanently until someone edits the Cron Trigger directly. This is the
  accepted price of decoupling; registration is idempotent w.r.t. live config
  (seed-if-absent per trigger name, never overwrite an existing row).
- **The heartbeat no longer reads `def.triggers` to decide what fires.** It
  iterates Cron Trigger rows, then resolves the workflow's **default** version
  (fallback: latest) to instantiate. It resolves-and-skips deleted, archived,
  or unresolvable targets so a stale row can never fire a ghost run.
- **A Cron Trigger can outlive a Definition version.** Workflow delete cascades
  row removal; archive does not (it is reversible), and the heartbeat's
  resolve-and-skip keeps archived workflows dormant until unarchived.
- Management (create / update / enable / disable / delete / list) is
  namespace-authorized like other Definition mutations; the heartbeat stays
  apiKey system-actor only.
