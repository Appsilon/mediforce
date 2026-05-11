# SDTM Rule Migration — staging setup

Two-step workflow:

1. **`verify-and-propose`** (L3, agent) — applies the `sdtm-rule` + `sdtmig-reference` skills to a rule in `Appsilon/core-contributor`, fixes the YAML, writes a `proposedChanges` envelope (branch, PR title/body, full file content) to `result.json`. **github MCP is disabled at the step level** — the agent literally cannot touch the remote repo here. Paused for human review.
2. **`open-pr`** (L4, agent) — on `approve`, reads `proposedChanges` and publishes via the GitHub MCP (`create_branch` → `push_files` → `create_pull_request`). Short-circuits when the upstream proposed no changes.
3. **`done`** — terminal.

`revise` loops back to step 1 with the reviewer's comment; no PR exists yet, so revise is a cheap conversation.

## Prerequisites (one-time, on staging)

- `Mediforce Staging` GitHub App registered on github.com with:
  - **Callback URL**: `https://staging.mediforce.ai/api/oauth/github/callback`
  - **Request user authorization (OAuth) during installation**: enabled
  - **Redirect on update**: enabled (so re-Connect on an existing install returns OAuth code instead of dropping the user on the install settings page)
- `github` OAuth provider in the `appsilon` namespace pointing at the App. `Authorize URL` is `https://github.com/apps/<slug>/installations/new`.
- App installed on `Appsilon/core-contributor` (and on `Appsilon/mediforce` if you also use the other workflow).
- AgentDefinition `GitHub SDTM Bot` (id `9GAXXyjjdMKgw1FxlK0S`) in the `appsilon` namespace with the github MCP binding and OAuth connected. Token persists per (namespace, agentId, serverName); confirm "Connected" in the agent's MCP servers panel.

## Register the workflow on staging

```bash
export MEDIFORCE_API_KEY=$(grep "^MEDIFORCE_API_KEY=" packages/platform-ui/.env.local | cut -d= -f2)

./node_modules/.bin/mediforce workflow register \
  --file apps/sdtm-rule-migration/src/sdtm-rule-migration.wd.json \
  --namespace appsilon \
  --base-url https://staging.mediforce.ai

./node_modules/.bin/mediforce secret set \
  --workflow sdtm-rule-migration --namespace appsilon \
  --key GITHUB_TOKEN --value "$(gh auth token)" \
  --base-url https://staging.mediforce.ai
```

`GITHUB_TOKEN` is used to clone the workspace + skills repos over HTTPS (the platform-ui container has no `ssh` binary). Step 2 pushes via the OAuth-backed MCP, not via this token.

## Trigger a run

```bash
curl -s -X POST -H "X-Api-Key: $MEDIFORCE_API_KEY" -H "Content-Type: application/json" \
  -d '{"namespace":"appsilon","definitionName":"sdtm-rule-migration","triggerName":"manual","triggeredBy":"<your-id>","payload":{"ruleId":"CORE-000127"}}' \
  https://staging.mediforce.ai/api/processes
```

Or via the UI: `https://staging.mediforce.ai/appsilon/workflows/sdtm-rule-migration` → Run.

`ruleId` accepts either `CORE-NNNNNN` or `CGNNNN`.

## Approve / revise the proposal

When step 1 finishes, the run pauses with a `HumanTask`. Open it in the UI or claim + complete via API:

```bash
TASK_ID=$(curl -s -H "X-Api-Key: $MEDIFORCE_API_KEY" \
  "https://staging.mediforce.ai/api/tasks?instanceId=<runId>" \
  | python3 -c "import sys,json; print([t['id'] for t in json.load(sys.stdin)['tasks'] if t['status'] in ('pending','claimed')][0])")

curl -s -X POST -H "X-Api-Key: $MEDIFORCE_API_KEY" -H "Content-Type: application/json" \
  -d '{"userId":"<your-id>"}' "https://staging.mediforce.ai/api/tasks/$TASK_ID/claim"

# Approve → step 2 runs, draft PR opens on Appsilon/core-contributor
curl -s -X POST -H "X-Api-Key: $MEDIFORCE_API_KEY" -H "Content-Type: application/json" \
  -d '{"verdict":"approve","comment":"looks good"}' \
  "https://staging.mediforce.ai/api/tasks/$TASK_ID/complete"

# Or revise → step 1 re-runs with your comment, no PR yet
curl -s -X POST -H "X-Api-Key: $MEDIFORCE_API_KEY" -H "Content-Type: application/json" \
  -d '{"verdict":"revise","comment":"<guidance>"}' \
  "https://staging.mediforce.ai/api/tasks/$TASK_ID/complete"
```

## Status semantics

| Status (from step 1) | What | Step 2 |
|---|---|---|
| `already_verified` | Rule already had the `# verified` marker | Short-circuits, no PR |
| `verified` | Rule was already correct; only marker added | Opens marker-only PR |
| `corrected` | Rule had fixes + marker | Opens full-diff PR |
| `not_found` | `ruleId` doesn't map to a rule in the repo | Short-circuits |
| `invalid_input` | `ruleId` doesn't match expected formats | Short-circuits |
| `failed` | Agent could not produce a coherent proposal | Reviewer investigates; do not approve |

`testResults: "environment-skip: <reason>"` is expected — the `core-contributor` repo declares an `engine/` git submodule that the runtime does not initialise, so `python test.py` typically can't run. The agent's YAML verification doesn't depend on it.

## Iterating skills

Skills live in `Appsilon/mediforce-sdtm-skills` (~2 MB, public). The workflow pins by SHA in `repo.commit`. Loop:

1. Push your change to `Appsilon/mediforce-sdtm-skills`.
2. Get the new SHA: `gh api repos/Appsilon/mediforce-sdtm-skills/commits/<branch> --jq '.sha'`.
3. Update `repo.commit` in `apps/sdtm-rule-migration/src/sdtm-rule-migration.wd.json`.
4. Re-register the workflow with the same CLI command above. No mediforce redeploy needed.

## Auth + clone notes

The runtime clones two repos per run:

- **Skills repo** (`Appsilon/mediforce-sdtm-skills`) via `fetchSkillsFromRepo` — cached by SHA in `/tmp/mediforce-skills-cache/`, auth via `repo.auth` → `env.GITHUB_TOKEN`.
- **Workspace repo** (`Appsilon/core-contributor`) via `WorkspaceManager` — cached as a bare repo per `(namespace, workflow-name)` in `~/.mediforce/bare-repos/`, auth via `workspace.remoteAuth` → `env.GITHUB_TOKEN`.

Both secrets must be templated into the workflow's `env` block (e.g. `"GITHUB_TOKEN": "{{GITHUB_TOKEN}}"`) — `resolveStepEnv` doesn't auto-flatten the workflow secrets bag.

`workspace.remote` resolves to an HTTPS-with-token URL when the secret is set, sidestepping the missing `ssh` binary in the platform-ui container.

## Switching the target repo

`Appsilon/core-contributor` is a fork of `verisianHQ/core-contributor`. To point at upstream once the Mediforce App is installed there, edit `workspace.remote` and the prompt's `proposedChanges.repo` / step-2 `owner=` references in `sdtm-rule-migration.wd.json` from `Appsilon/core-contributor` to `verisianHQ/core-contributor` and re-register.
