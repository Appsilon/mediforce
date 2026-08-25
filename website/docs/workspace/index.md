---
title: Workspaces and administration
sidebar_label: Workspaces and admin
sidebar_position: 8
---

# Workspaces and administration

A **workspace** owns workflows, agents, secrets and members. Everything is scoped
to one, so the same workflow name can exist in two workspaces without collision.

## Settings

Workspace settings covers the profile and branding — display name, bio, icon —
plus preferences, members, secrets and the danger zone. Setting a **default
workspace** sends you straight there on your next visit instead of the picker.

## Members and roles

Roles are per-workspace: someone can own one workspace and merely read another.
Invite from settings; a newly invited person appears in the members table without
a reload.

```bash
pnpm exec mediforce namespace set-member-role --handle acme --uid <uid> --role admin
pnpm exec mediforce namespace remove-member --handle acme --uid <uid>
pnpm exec mediforce namespace leave --handle acme
```

## Sharing workflows

A workflow is `private` — members only — or `public`, discoverable read-only from
other workspaces. Share by link explains what the recipient will and will not be
able to see before you hand the link over.

```bash
pnpm exec mediforce workflow set-visibility my-workflow --visibility public --namespace acme
pnpm exec mediforce workflow copy my-workflow --target-namespace beta
```

Copying brings the definition into another workspace. It does not bring the
workflow's triggers or its secrets — those belong where they were set.

## Monitoring

The monitoring view reports what the deployment is actually doing, per workspace:
runs by state with click-to-filter cards, agent activity, the people doing the
work, task throughput, and which integrations are configured. Counts come from the
database rather than the rows currently loaded, so a card total does not change as
you page through the table.

## Exporting and importing

A workflow exports to a portable file and imports back, which is how a definition
moves between deployments — staging to production, or a customer instance. Each
deployment is a peer: you register a workflow into each rather than promoting it
between them.

```bash
pnpm exec mediforce workflow import --repo https://github.com/Appsilon/mediforce \
  --path docs/workflow-examples/01-linear-pipeline.wd.json --namespace acme
```

## Command palette

`Cmd`/`Ctrl` + `K` opens a command palette for jumping around and filing a bug
without leaving the page. `?` shows the keyboard shortcuts.

## Danger zone

Resetting a workspace empties it. Deleting removes it. Both are in settings, both
ask first.

```bash
pnpm exec mediforce namespace reset --handle acme
pnpm exec mediforce namespace delete --handle acme
```
