---
title: Workspaces and administration
sidebar_label: Workspaces and admin
sidebar_position: 8
---

# Workspaces and administration

A **workspace** owns workflows, agents, secrets and members. Everything is scoped
to one, so the same workflow name can exist in two workspaces without collision.

## Settings

Workspace settings covers the profile and branding (display name, bio, icon),
plus preferences, members, secrets and the danger zone. Setting a **default
workspace** sends you straight there on your next visit instead of the picker.

The **Models** section holds the workspace's default model and output budget. Owners and admins set the workspace's; any member of a shared workspace, organization or personal, can override either for the calls they start, and picking the workspace's value again follows it.

- **Default model**: pick a vendor, then one of its live models. The assistants, cowork chat and cowork's voice use it, and new agents, steps and judges start on it; saved ones keep their model. Unset, it's the platform default, the newest Claude Sonnet, and the same happens if the model you picked is retired or can't use tools, so a stale setting never breaks anything.
- **Output budget**: how much LLMs can write per call. Low halves each call's default, High doubles it, and Max gives the model its full limit. Raise it if eval checks fail because the judge ran out of room. A raise stops at the model's own limit, and doesn't apply to models the registry doesn't know. Under the slider, settings show what calls on the chosen model actually get. The evaluation assistant shows the budget in effect, with a link to change it.

```bash
pnpm exec mediforce namespace update --handle acme --output-budget high --default-model anthropic/claude-sonnet-5.5
pnpm exec mediforce namespace set-my-model-settings --handle acme --output-budget low --default-model workspace
```

`--default-model platform` clears the workspace's choice. For a member, `workspace` as either value means "follow the workspace again". Work with no person behind it, such as API-key calls, triggered evaluations and production checks, always uses the workspace's settings.

## Members and roles

Membership is per workspace: someone can own one workspace and be a plain member of another. Each person is an **owner**, an **admin** or a **member**. Invite from settings, and a newly invited person appears in the members table without a reload. For a workshop or pilot where you don't have everyone's address yet, a [join link](../install/#inviting-a-room-at-once) lets people add themselves as members.

```bash
pnpm exec mediforce users invite acme new.colleague@example.com
pnpm exec mediforce namespace set-member-role --handle acme --uid <uid> --role admin
pnpm exec mediforce namespace remove-member --handle acme --uid <uid>
pnpm exec mediforce namespace leave --handle acme
```

Separately from membership, people hold **process roles**, which decide what they may do in workflows. Any name works (`medical-writer`, `pi`), and a role can be held across the workspace or for one workflow only. Four are built in:

| Role | May |
|---|---|
| `editor` | Edit workflows |
| `executor` | Start runs |
| `reviewer` | Pick up human review tasks |
| `workflow-manager` | All three. It's a combination, not a rank above them |

A new workflow lets executors and workflow managers run it and editors and workflow managers edit it; a new human step goes to reviewers and workflow managers. Each workflow's **Access** tab changes that. An empty list means any member, which is how older workflows behave. The workspace owner is always a workflow manager, and so is whoever registers a workflow, for that workflow.

Grant process roles in the **Roles** table under Members, or:

```bash
pnpm exec mediforce namespace set-member-roles --handle acme --uid <uid> --roles reviewer,medical-writer
pnpm exec mediforce workflow set-access intake --namespace acme --run executor,pi --edit editor
```

## Arranging the workspace page

Drag a workflow card by its grip, or focus the grip and use the arrow keys, to put the workflows you use most where you want them. The order is yours alone and is kept in this browser, so it won't follow you to another machine. Workflows you haven't placed come after, the ones with runs in progress first, then alphabetically.

## Sharing workflows

A workflow is `private`, for members only, or `public`, discoverable read-only from
other workspaces. Share by link explains what the recipient will and will not be
able to see before you hand the link over.

```bash
pnpm exec mediforce workflow set-visibility my-workflow --visibility public --namespace acme
pnpm exec mediforce workflow copy my-workflow --target-namespace beta
```

Copying brings the definition into another workspace. It does not bring the
workflow's triggers or its secrets. Those belong where they were set.

## Monitoring

The monitoring view reports what the deployment is actually doing, per workspace:
runs by state with click-to-filter cards, agent activity, the people doing the
work, task throughput, and which integrations are configured. Counts come from the
database rather than the rows currently loaded, so a card total does not change as
you page through the table.

## Exporting and importing

A workflow exports to a portable file and imports back, which is how a definition
moves between deployments: staging to production, or a customer instance. Each
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
