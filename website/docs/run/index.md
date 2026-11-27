---
title: Running workflows
sidebar_label: Running workflows
sidebar_position: 4
---

# Running workflows

A **run** is one execution of one workflow definition. It tracks the current step, status, accumulated variables, the trigger payload and total cost.

## Starting a run

**Start run** on the workflow page runs the readiness check, shows what's missing, and offers **Start anyway**. Warnings inform; they don't block.

**Save & Start Run** and **Save & Dry Run** in the editor save the version first and then start, so you never run a version you didn't mean to save.

From the CLI:

```bash
pnpm exec mediforce run start --workflow my-workflow --namespace acme
pnpm exec mediforce run start --workflow my-workflow --namespace acme --dry-run
```

## Statuses

| Status | Means |
|---|---|
| `in_progress` | Running |
| `waiting_for_human` | Blocked on a person: a task is waiting, or an agent escalated |
| `completed` | Reached a terminal step |
| `error` | A step failed |
| `cancelled` | Someone stopped it |

An agent that escalates rather than failing shows as `waiting_for_human` with the reason, and can be retried.

## Tasks

A step whose executor is `human` becomes a **task** for whoever holds that role. The run waits. The assignee claims it, does the work, and submits a **verdict** from the ones the step offers, with a comment when the step asks for one.

The **Human actions** item in the sidebar shows how many tasks in this workspace are waiting on you, counting the ones assigned to you and the ones open to a role you hold. It disappears when there's nothing to do.

```bash
pnpm exec mediforce task list --role medical-writer
pnpm exec mediforce task claim <task-id>
pnpm exec mediforce task complete <task-id> \
  --payload '{"kind":"verdict","verdict":"approve"}'
```

Reviewers can attach files to a task. `MEDIFORCE_ATTACHMENT_MAX_BYTES` caps the size, 100 MiB by default. That's a guard for the disk, not a design limit.

## Following a run

The run page lists the steps that have actually run, the variables collected so far, per-step cost, and agent events for agent steps. Expanding a step shows what it produced, any error, and which way it went next.

Above the steps sit four buttons that open a side panel: **Log**, **Audit**, **Diagram** and, once the run has finished, **Report**.

```bash
pnpm exec mediforce run watch <run-id>
pnpm exec mediforce run logs <run-id>
pnpm exec mediforce run files <run-id>
pnpm exec mediforce run download <run-id>
```

Container steps commit their work per step, so a later step sees the files an earlier one produced and the run's branch carries the full history.

### What a step produced

Every step's output opens in one viewer. A dropdown starts on `result.json`, the step's result, and then lists each file the step saved, with its size. JSON opens in a **Formatted** view that labels fields and renders text properly, with **Raw** a click away. Markdown, HTML, images, PDFs, CSV and plain text preview in place; anything else, or a text file over 5 MiB, is a **Download**. Large CSVs preview their first 100 rows.

A failed agent run still shows whatever files it saved, which is usually where you'll find out what went wrong.

When a run completes, a **Results** panel at the top shows the output of the last agent step, so the answer is the first thing you see.

### The audit trail

**Audit** records who did what, when, in what role and on what basis. Switch it from **Timeline** to **Table** for a view you can search, widen with **Expand table**, and save with **Download CSV**. The CSV always holds the whole trail, not only what your search matched. If the run started other runs, their records are in the table too, each linking to its own run, so one table tells the whole story. Only runs this run started directly are included, not runs those runs went on to start.

### Watching it back

**Diagram** draws the workflow with the path this run took. **Replay run** sends a marker along that path, step by step. With **Proportional** pacing it lingers where the real run spent its time, which makes slow steps obvious at a glance; **Path only** gives every step the same short beat. Speed goes up to 4×.

When a step started another workflow, **Show child workflow** opens that child's steps under it, with their status. If the step started several, pick one from the list.

## Cancelling and archiving

```bash
pnpm exec mediforce run cancel <run-id>
pnpm exec mediforce run archive <run-id>
```

Cancelling stops a run in flight. Archiving hides a finished run from the default list without deleting it.

To find every run a run started, use `run list --parent <run-id>`.

## Carrying values into the next run

A workflow can read what its previous run produced, which is how a monthly process picks up where the last one stopped.

Next: [Verifying a workflow](verify): the four gates, and which question each one actually answers.
