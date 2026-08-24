---
title: Triggers
sidebar_label: Triggers
sidebar_position: 6
---

# Triggers

A definition says *what* a workflow does. A **trigger** says *when* it runs, and
lives on the workflow rather than inside the definition — so changing a schedule
does not create a new version.

Manage them on the workflow's **Triggers** tab.

| Type | Starts a run |
|---|---|
| `manual` | When someone presses Start run. Attaching one is what makes a workflow hand-startable |
| `cron` | On a schedule |
| `webhook` | When something calls its URL |

## Manual

A workflow with no manual trigger cannot be started by hand — the button tells
you the manual trigger is stopped and points at the Triggers tab. Stopping the
manual trigger is how you retire a workflow from human use without archiving it.

## Cron

A cron trigger carries a schedule and, optionally, a **static payload** — the
input that every scheduled run receives. One workflow can hold several
schedules with different payloads, which is how a monthly and a weekly variant
of the same process coexist.

The trigger records when it last fired, so you can tell a schedule that never
ran from one that ran and failed.

A payload is validated against the workflow's declared input contract, so a
schedule that would start a run the workflow rejects is refused when you save it,
not at 3am.

## Webhook

A webhook trigger exposes a path and starts a run when called. Paths must start
with `/` and contain URL-safe characters only.

```bash
pnpm exec mediforce config test-webhook
```

## Run input

A workflow can declare **input fields** the starter fills in. Starting such a
workflow from the app opens a form before the run begins, with a field per
declared input: text, number, boolean, date and datetime, single and multi
select, long text, and structured `object` fields for JSON.

Required fields block the start until filled. An `object` field holding text the
validator would reject blocks it too, rather than failing the run with a 400
once it has started.

A cron trigger's static payload is the same contract filled in ahead of time.

## From the CLI

```bash
pnpm exec mediforce workflow trigger my-workflow --namespace acme
pnpm exec mediforce run start my-workflow --namespace acme
```

:::note Triggers are not part of the definition
The assistant cannot create them, importing a workflow does not bring its
schedules, and a new version does not reset them. They belong to the workflow.
:::
