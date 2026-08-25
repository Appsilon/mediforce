---
title: CLI reference
sidebar_label: CLI
sidebar_position: 8
---

# CLI reference

The CLI talks to the same API as the app and authenticates with the deployment's
`PLATFORM_API_KEY`. Anything you can do in the app you can script.

```bash
pnpm exec mediforce <command> [options]
```

Almost everything is scoped to a workspace, but the flag that names it is not
uniform: workflow, run and secret commands take `--namespace <handle>`, while the
`namespace` family takes `--handle <handle>`. Listing commands take neither —
they return everything the key can see. Every command accepts `--help`, which
prints its real arguments; the tables below name the ones that are required.

## Workflows

| Command | Does |
|---|---|
| `workflow list` | Every workflow the key can see |
| `workflow get <name>` | One workflow, including its default version |
| `workflow list-versions <name>` | Every version |
| `workflow register --file <path>` | Validate a definition's schema and store a new version |
| `workflow validate <file>` | Schema validation only, stores nothing |
| `workflow schema` | The definition JSON schema |
| `workflow import --repo --path` | Import one definition from a git repo |
| `workflow copy <name> --target-namespace` | Copy into another workspace |
| `workflow trigger-list <name>` | Triggers attached to a workflow |
| `workflow trigger-add <name> --trigger` | Attach a `cron`, `webhook` or `manual` trigger |
| `workflow trigger-update <name> --trigger` | Change a cron schedule or its static payload |
| `workflow trigger-start` / `trigger-stop <name>` | Enable or disable one without deleting it |
| `workflow trigger-remove <name> --trigger` | Delete a trigger |
| `workflow trigger-export` / `trigger-import <name>` | Move triggers between deployments as a file |
| `workflow set-visibility <name>` | `public` or `private` |
| `workflow archive <name>` | Hide without deleting |
| `workflow delete <name>` | Remove |

## Runs

| Command | Does |
|---|---|
| `run start --workflow <name>` | Start a run. `--dry-run` mocks agent and script steps |
| `run list` | Runs, filterable |
| `run get <id>` | One run |
| `run watch <id>` | Follow live |
| `run logs <id>` | Step logs |
| `run files <id>` | Output files |
| `run download <id>` | Download outputs |
| `run cancel <id>` | Stop a run in flight |
| `run archive <id>` | Hide a finished run |
| `run bulk-cancel` / `run bulk-archive <ids>` | Act on comma-separated run IDs |

## Tasks

| Command | Does |
|---|---|
| `task list` | Tasks waiting on people |
| `task get <id>` | One task |
| `task claim <id>` | Take it |
| `task complete <id> --payload` | Submit a JSON payload — `{"kind":"verdict","verdict":"approve"}` |

## Agents and models

| Command | Does |
|---|---|
| `agent list` / `agent get <id>` | Browse agent definitions, by ID |
| `agent create --file` / `agent delete <id>` | Manage them |
| `agent set-visibility <id>` | `public` or `private` |
| `agent run-list` / `agent run-get <id>` | Agent run history |
| `model list` / `model get <id>` | The model registry |
| `model sync` | Refresh the registry |
| `model validate <ids>` | Check comma-separated model IDs against the registry |

## Secrets and config

| Command | Does |
|---|---|
| `secret set --key --value/--stdin` | Store a secret, encrypted at rest |
| `secret list` | Names only, never values |
| `secret delete --key` | Remove |
| `config get` / `config set` | Deployment configuration |
| `config test-webhook` | Send a test notification to the deployment's alert webhook |

## Workspaces and people

| Command | Does |
|---|---|
| `namespace create` / `namespace get --handle` / `namespace update` | Manage workspaces |
| `namespace set-member-role --handle --uid --role` | Change someone's role |
| `namespace remove-member` / `namespace leave --handle` | Membership |
| `namespace reset --handle` | Empty a workspace |
| `namespace delete --handle` | Remove it |
| `users me` | Who the current key authenticates as |
| `users clear-must-change-password --uid` | Release someone stuck in first-password setup |

## Cowork and system

| Command | Does |
|---|---|
| `cowork list` / `cowork get <id>` / `cowork get-by-instance <run-id>` | Cowork sessions |
| `cowork chat <id>` | Talk in a session |
| `system status` | Docker health, images and disk |
| `system images` / `system rmi <id>` / `system disk` | Inspect and prune step images |
| `system credits --namespace` | Model credit remaining |
| `email status` | Which mail transport is configured, and its from address |
| `assistant ask <message> --definition` | Ask the workflow assistant about a canvas |
| `processes agent-events <run-id>` | Agent events for a run |

:::note Never point the CLI at production by accident
Commands act on whichever deployment the CLI is configured against. Check with
`users me` before anything destructive.
:::
