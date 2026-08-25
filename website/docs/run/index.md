---
title: Running workflows
sidebar_label: Running workflows
sidebar_position: 4
---

# Running workflows

A **run** is one execution of one workflow definition. It tracks the current
step, status, accumulated variables, the trigger payload and total cost.

## Starting a run

**Start run** on the workflow page runs the readiness check, shows what is
missing, and offers **Start anyway** — warnings inform, they do not block.

**Save & Start Run** and **Save & Dry Run** on the editor save the version first
and then start, so you never run a version you did not mean to save.

From the CLI:

```bash
pnpm exec mediforce run start --workflow my-workflow --namespace acme
pnpm exec mediforce run start --workflow my-workflow --namespace acme --dry-run
```

## Statuses

| Status | Means |
|---|---|
| `in_progress` | Running |
| `waiting_for_human` | Blocked on a person — a task is waiting, or an agent escalated |
| `completed` | Reached a terminal step |
| `error` | A step failed |
| `cancelled` | Someone stopped it |

An agent that escalates rather than failing shows as `waiting_for_human` with the
reason, and is retryable.

## Tasks

A step whose executor is `human` becomes a **task** for whoever holds that role.
The run waits. The assignee claims it, does the work, and submits a **verdict**
from the ones the step declares — with a comment when the step requires one.

```bash
pnpm exec mediforce task list --role medical-writer
pnpm exec mediforce task claim <task-id>
pnpm exec mediforce task complete <task-id> \
  --payload '{"kind":"verdict","verdict":"approve"}'
```

Reviewers can attach files to a task. `MEDIFORCE_ATTACHMENT_MAX_BYTES` caps the
size, 100 MiB by default — a disk guard, not a design limit.

## Following a run

The run page shows execution history for steps that have actually run, the
variables accumulated so far, per-step cost, and agent events for agent steps.

```bash
pnpm exec mediforce run watch <run-id>
pnpm exec mediforce run logs <run-id>
pnpm exec mediforce run files <run-id>
pnpm exec mediforce run download <run-id>
```

Container steps commit their work per step, so a later step sees the files an
earlier one produced and the run's branch carries the full history.

## Cancelling and archiving

```bash
pnpm exec mediforce run cancel <run-id>
pnpm exec mediforce run archive <run-id>
```

Cancelling stops a run in flight. Archiving hides a finished run from the default
list without deleting it.

## Carrying values into the next run

A workflow can read what its previous run produced, which is how a monthly
process picks up where the last one stopped.

Next: [Verifying a workflow](verify) — the four gates, and which question each
one actually answers.
