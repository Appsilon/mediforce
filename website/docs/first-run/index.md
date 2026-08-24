---
title: Your first run
sidebar_label: First run
sidebar_position: 2
---

# Your first run

Mediforce is installed and answering on your domain. This page takes you from an
empty deployment to a workflow that has run once.

## Sign in and create a workspace

Open your domain. With no workspace yet, Mediforce sends you to workspace
creation rather than an empty dashboard.

A **workspace** — a namespace — owns workflows, agents, secrets and members.
Everything is scoped to one, and the same workflow name can exist in two
workspaces without collision. Most deployments start with one workspace per team
or per study.

Your first account signs in with whichever method you configured. With the
default password sign-in, you register an email and password directly.

## Invite people

Workspace settings → **Members** → *Invite user*. Each member holds a role in
that workspace, and roles are per-workspace: someone can own one and merely read
another.

Two things worth knowing before you invite anyone:

- With **no mail transport configured**, the account and membership are still
  created, but the invite reports *"Email not sent — let them know to sign in"*.
  You tell them out of band.
- On a **password deployment**, a newly invited person who has never signed in is
  put through a create-password step on first sign-in. On a Google or OIDC-only
  deployment they are not, because forcing a password they cannot use would
  strand them.

## Get a workflow

Three ways, easiest first.

**Import an example.** An empty workspace offers **Import example workflows**
beside **New workflow**. It opens the Mediforce examples as a card grid with tag
filters — no repository to type in. This is the fastest way to see a real,
working definition.

**Import from git.** Point Mediforce at a repository and pick the workflows to
import.

**Ask the assistant.** The workflow editor has an AI assistant beside the canvas:
describe the workflow you want and it builds the steps for you, which you then
edit by hand. See [the assistant](../build/#the-ai-assistant).

**Write one.** See [Building workflows](../build/).

## Register from the CLI

The CLI talks to the same API as the app and authenticates with the
`PLATFORM_API_KEY` you set at install.

```bash
pnpm exec mediforce workflow register ./my-workflow.wd.json --namespace acme
```

Registering **validates the definition's schema** and stores a new immutable
version. It executes nothing. That is the first of four gates — see
[Verifying a workflow](../run/verify).

```bash
pnpm exec mediforce workflow list --namespace acme
pnpm exec mediforce workflow get my-workflow --namespace acme
```

## Run it

In the app, open the workflow and press **Start run**. Mediforce runs a
[readiness check](../run/verify#2-workflow-readiness-check) first and shows
anything missing — an image that is not on the platform, a secret that is not
set, an unknown model, low credits — each with the fix. Warnings do not block
you; **Start anyway** is offered.

From the CLI:

```bash
pnpm exec mediforce run start my-workflow --namespace acme
pnpm exec mediforce run watch <run-id>
```

:::note The CLI skips the readiness check
`mediforce run start` and `POST /api/runs` do not run it — it runs in the app.
Start from the UI the first time so you see what it reports.
:::

## Follow the run

The run page shows the current step, execution history, accumulated variables and
cost. A step assigned to a person appears as a **task** for whoever holds that
role, and the run waits on it.

Next: [Building workflows](../build/), or [Gotchas](../gotchas/) for the traps
that cost people an afternoon.
