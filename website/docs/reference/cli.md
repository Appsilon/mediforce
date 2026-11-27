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

Almost everything is scoped to a workspace, but the way you name it isn't uniform, and that's worth knowing before you script anything. Workflow, run, secret, skill and eval commands take `--namespace <handle>`. Most of the `namespace` family takes `--handle <handle>`, and the join-link commands and `users invite` take the handle as their first argument instead. Older listing commands such as `workflow list` and `run list` take no workspace at all and return everything the key can see. When in doubt, `--help` on any command prints its real arguments. The tables below name only the ones that are required.

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
| `workflow trigger-export <name>` / `trigger-import <name> <file>` | Move triggers between deployments as a file. Import skips names that already exist unless you pass `--replace` |
| `workflow set-default-version <name> --version <n>` | Choose the version a run executes when it doesn't ask for one |
| `workflow access <name>` | Who may run and who may edit a workflow. Any member can read it |
| `workflow set-access <name> --run <roles> --edit <roles>` | Change that. Pass `""` to open it to every member. Owners and admins only |
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
| `task complete <id> --payload` | Submit a JSON payload, such as `{"kind":"verdict","verdict":"approve"}` |

## Agents and models

| Command | Does |
|---|---|
| `agent list` / `agent get <id>` | Browse agent definitions, by ID |
| `agent create --file` / `agent delete <id>` | Manage them |
| `agent set-visibility <id>` | `public` or `private` |
| `agent run-list` / `agent run-get <id>` | Agent run history |
| `agent versions <id>` | Every configuration an agent was saved or evaluated with, newest first |
| `agent set-image <id> --image <tag>` | The image the agent runs in. `--image ""` goes back to the default |
| `agent set-skills <id> --skills <ns/id,...>` | Replace the agent's Skills. An empty list removes them all |
| `agent assistant-ask "<message>" --namespace` | Ask the Agent Assistant one question about the catalog |
| `model list` / `model get <id>` | The model registry |
| `model sync` | Refresh the registry |
| `model validate <ids>` | Check comma-separated model IDs against the registry |

## Skills and tools

| Command | Does |
|---|---|
| `skill list --namespace` / `skill get <id> --namespace` | The workspace's Skills, and one Skill with its files |
| `skill create --from <folder> --namespace` | Make a Skill from a local folder that holds a `SKILL.md` |
| `skill update <id> --namespace` | Replace its files with `--from`, or change `--visibility` |
| `skill import --repo <github-url> --namespace` | Create or update a Skill for every `<dir>/<name>/SKILL.md` in a public repo. Unchanged Skills are left alone |
| `skill delete <id> --namespace --force` | Remove one. `--force` is required so it can't happen by accident |
| `tool-catalog list --namespace` | The MCP servers agents in the workspace can bind to |
| `tool-catalog add --file <json>` | Add a stdio or HTTP MCP server |
| `tool-catalog discover --namespace --url <url>` | See which tools a public HTTP MCP server offers before you add it |

## Evaluation

Every `eval` command names what it evaluates in one of two ways: a workflow step with `--namespace --workflow --step`, or an agent with `--namespace --agent`. A few commands only make sense for a step and say so in `--help`. [Evaluating agents and steps](../evaluate/) explains the ideas behind these commands.

| Command | Does |
|---|---|
| `eval brief-get` / `eval brief-set --text` or `--file` | Read or write the Evaluation Brief, the plain account of what the step is for |
| `eval case-list` / `eval case-add --file` | The Eval Cases, or add one by hand |
| `eval case-from-run <agent-run-id>` | Turn a real run into an Eval Case. `--expectation negative` marks it as output that should fail |
| `eval case-edit <case-id> --file` / `eval case-archive <case-id>` | Change or retire a case. `--restore` brings one back |
| `eval evaluator-list` / `eval evaluator-create --file` | The Evaluators, or add one from `{ name, rule, check }` |
| `eval evaluator-preview --file <check.json>` | Try a draft check on the Eval Cases and recent outputs. Saves nothing |
| `eval evaluator-version <id> --file` | Save a changed rule or check as a new version |
| `eval evaluator-approve <id> --version <n>` | Approve a code check so it counts. This is a person's act |
| `eval evaluator-production <id> --on` or `--off` | Also score live runs. `--on-error ignore\|escalate` decides what happens when the check can't run |
| `eval run-estimate` / `eval run-prepare` | What an Eval Run would cost, then prepare one. `--variant <file>` runs a Variant instead |
| `eval run-start <eval-run-id> --confirm-budget <usd>` | Start a prepared run. Nothing spends money before this |
| `eval run-list` / `eval run-cancel <eval-run-id>` | Eval Runs, or stop one. Trials already running finish and are scored |
| `eval report <eval-run-id>` / `eval failures <eval-run-id>` | The report, or only the trials that failed |
| `eval trial <eval-run-id> <trial-id>` | One trial in full. `--prompts` adds what each judge was sent and said |
| `eval judge-review <eval-run-id> --trial --evaluator --accept\|--deny` | Sign off on, or overrule, one judge verdict |
| `eval compare-prepare` / `eval compare-start <id> --confirm-budget <usd>` | Compare a baseline with one to four Variants under one budget |
| `eval compare-get <id>` / `eval compare-list` / `eval compare-cancel <id>` | Read, list or stop Comparisons |
| `eval apply-variant <comparison-id> --run <eval-run-id>` | Keep the winner: a new workflow version for a step, a new agent version for an agent. Applying is a person's act, so the API refuses an API key and this command fails until the CLI can sign in as you |
| `eval criteria-get` / `eval criteria-set --file` | The pass rate a subject needs to count as qualified |
| `eval qualification` | Qualified, Stale or Not qualified, and what changed. With only `--namespace`, every agent's status |
| `eval validation --namespace --workflow` | Whether each live version of a workflow is verified, step by step |
| `eval drift --namespace --workflow --step` | Production Evaluators whose mean score has dropped |
| `eval dataset-list` / `eval dataset-save` | Freeze the current Eval Cases as a Dataset version you can rerun later |
| `eval mcp-policy-get` / `eval mcp-policy-set --file` | Whether each MCP server is `live`, `replay` or `deny` during trials |
| `eval agent-runs --namespace --agent <id>` | Finished production runs of the steps that use an agent |
| `eval ask "<message>"` | Ask the Evaluation Assistant. It prints proposals and applies none. It can only start a run on its own if you pass `--unattended-budget <usd>` |
| `score list` | Scores recorded against agent runs, newest first |

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
| `namespace update --handle --output-budget low\|default\|high\|max --default-model <id>\|platform` | Set the workspace's LLM output budget and default model (owners and admins) |
| `namespace set-my-model-settings --handle --output-budget low\|default\|high\|max\|workspace --default-model <id>\|workspace` | Set your own output budget and default model in a workspace, overriding the workspace's |
| `namespace set-member-role --handle --uid --role` | Change someone's role |
| `namespace set-member-roles --handle --uid --roles <r1,r2>` | A member's process roles, such as reviewer. `--workflow` limits them to one workflow. Owners and admins only |
| `namespace remove-member` / `namespace leave --handle` | Membership |
| `users invite <handle> <email>` | Invite someone by email. They get an activation link. `--role admin` for an admin seat |
| `namespace create-join-link <handle>` | A link anyone can use to join an organization workspace as a member. The token is shown once, so copy it then |
| `namespace list-join-links <handle>` / `namespace revoke-join-link <handle> <id>` | See and revoke join links. Revoking doesn't remove people who already joined |
| `namespace reset --handle` | Empty a workspace |
| `namespace delete --handle` | Remove it |
| `users me` | Who the current key authenticates as |
| `users clear-must-change-password --uid` | Release someone stuck in first-password setup |

## Images

See [Container images](../images/) for which path to take.

| Command | Does |
|---|---|
| `images list` / `images show <entry-id> --namespace` | The workspace's Image Catalog, and one entry's versions |
| `images create --namespace --name --intent` + `--repo` / `--reference` / `--workflow` | Catalogue an image |
| `images build --namespace` + `--repo --commit` or `--reference --context` | Build a version from a git repo, or upload a local folder |
| `images pull --namespace --reference --tag` | Pull a registry image and catalogue it |
| `images publish <entry-id> --namespace --version --reference` | Keep a workflow-built image as an entry of its own |
| `images update <entry-id> --namespace` | Change an entry's source, name or description |
| `images delete <entry-id> --namespace` | Remove an entry and its images |
| `images seed --namespace` | Catalogue the five default images |

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
| `assistant instructions-get --namespace` / `instructions-set --file` | Your standing instructions to the workflow assistant in a workspace. `--clear` removes them |
| `processes agent-events <run-id>` | Agent events for a run |

:::note Never point the CLI at production by accident
Commands act on whichever deployment the CLI is configured against. Check with
`users me` before anything destructive.
:::
