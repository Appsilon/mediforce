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

Most commands take `--namespace <handle>`, since almost everything is scoped to a
workspace.

## Workflows

| Command | Does |
|---|---|
| `workflow list` | Workflows in a workspace |
| `workflow get <name>` | One workflow, including its default version |
| `workflow list-versions <name>` | Every version |
| `workflow register <file>` | Validate a definition's schema and store a new version |
| `workflow validate <file>` | Schema validation only, stores nothing |
| `workflow schema` | The definition JSON schema |
| `workflow import` | Import from git |
| `workflow copy <name>` | Copy into another workspace |
| `workflow trigger <name>` | Manage triggers |
| `workflow set-visibility <name>` | `public` or `private` |
| `workflow archive <name>` | Hide without deleting |
| `workflow delete <name>` | Remove |

## Runs

| Command | Does |
|---|---|
| `run start <workflow>` | Start a run. `--dry-run` mocks agent and script steps |
| `run list` | Runs, filterable |
| `run get <id>` | One run |
| `run watch <id>` | Follow live |
| `run logs <id>` | Step logs |
| `run files <id>` | Output files |
| `run download <id>` | Download outputs |
| `run cancel <id>` | Stop a run in flight |
| `run archive <id>` | Hide a finished run |
| `run bulk` | Act on many runs |

## Tasks

| Command | Does |
|---|---|
| `task list` | Tasks waiting on people |
| `task get <id>` | One task |
| `task claim <id>` | Take it |
| `task complete <id>` | Submit a verdict |

## Agents and models

| Command | Does |
|---|---|
| `agent list` / `agent get <name>` | Browse agent definitions |
| `agent create` / `agent delete <name>` | Manage them |
| `agent set-visibility <name>` | `public` or `private` |
| `agent run-list` / `agent run-get <id>` | Agent run history |
| `model list` / `model get <id>` | The model registry |
| `model sync` | Refresh the registry |
| `model validate <workflow>` | Check a workflow's models are known |

## Secrets and config

| Command | Does |
|---|---|
| `secret set <key>` | Store a secret, encrypted at rest |
| `secret list` | Names only, never values |
| `secret delete <key>` | Remove |
| `config get` / `config set` | Deployment configuration |
| `config test-webhook` | Prove a webhook target answers |

## Workspaces and people

| Command | Does |
|---|---|
| `namespace create` / `namespace get <handle>` / `namespace update` | Manage workspaces |
| `namespace set-member-role` | Change someone's role |
| `namespace remove-member` / `namespace leave` | Membership |
| `namespace reset` | Empty a workspace |
| `namespace delete <handle>` | Remove it |
| `users me` | Who the current key authenticates as |
| `users clear-must-change-password` | Release someone stuck in first-password setup |

## Cowork and system

| Command | Does |
|---|---|
| `cowork list` / `cowork get <id>` / `cowork get-by-instance <run-id>` | Cowork sessions |
| `cowork chat <id>` | Talk in a session |
| `system status` | Deployment health |
| `system credits` | Model credit remaining |
| `email status` | Whether a mail transport is configured and working |
| `assistant ask` | Ask the workflow assistant |
| `processes agent-events <run-id>` | Agent events for a run |

:::note Never point the CLI at production by accident
Commands act on whichever deployment the CLI is configured against. Check with
`users me` before anything destructive.
:::
