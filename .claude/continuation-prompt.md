# Continue: Re-test local pipeline with git mode fix

## Context

Last session fixed two bugs in `base-container-agent-plugin.ts` that caused
`generate-adam` and `generate-tlg` steps to silently skip git clone/commit/push
in local execution mode:

1. **Git clone failure now throws** — previously fell through silently when
   `~/.ssh/deploy_key` didn't exist (key is at `~/.ssh/mediforce_deploy_key`).
   Agent would run in empty temp dir with no git output.

2. **Git commit/push failure now throws** — was swallowed with "recoverable"
   comment. Git mode steps must produce git output.

## Other changes this session

- **Env vars editor UI** in `step-config-card.tsx`: provider preset dropdown
  (Anthropic/OpenRouter/DeepSeek/Custom), key/value editor with secret badges.
- **start-test-run.sh**: retry loop for Next.js dev mode compilation race.
- **script-container-plugin.e2e.test.ts**: fixed pre-existing typecheck error.

## What to do now

### 1. Restart server

`packages/platform-ui/.env.local` has `ALLOW_LOCAL_AGENTS` and `DEPLOY_KEY_PATH`
set, so just restart:

```bash
cd packages/platform-ui && npx next dev -p 9004
```

User may have already done this.

### 2. Start test run and autoadvance

```bash
bash scripts/start-test-run.sh local-claude http://localhost:9004
bash scripts/autoadvance-run.sh <INSTANCE_ID> http://localhost:9004
```

### 3. Verify git metadata on generate-adam and generate-tlg

After the run completes, check that both steps have `gitMetadata` with
`commitSha`, `branch`, `changedFiles`, and `repoUrl`:

```bash
API_KEY="aad7fee7cb4c68d2966079ab514d6164120c0b258d74fae8749aae94117ce748"
BASE="http://localhost:9004"
curl -s -H "X-Api-Key: $API_KEY" "$BASE/api/tasks?instanceId=<ID>" | \
  python3 -c "
import sys, json
tasks = json.load(sys.stdin).get('tasks', [])
for t in tasks:
    cd = t.get('completionData', {})
    ao = cd.get('agentOutput', {})
    gm = ao.get('gitMetadata')
    print(f'{t[\"stepId\"]:25s} git={gm is not None}  {json.dumps(gm)[:120] if gm else \"null\"}}')
"
```

Expected: `generate-adam` and `generate-tlg` show `git=True` with commit SHA
and branch `run/<instance-id>`.

### 4. If git clone still fails

Check the error message — it now includes the deploy key path and repo URL.
The deploy key at `~/.ssh/mediforce_deploy_key` must have read/write access to
`Appsilon/mediforce-clinical-workspace`.

## Previous successful run (without git)

Instance `127cd0b3-3e80-449e-9c5f-789536ada09b` completed all 6 steps locally
but `generate-adam` and `generate-tlg` had `gitMetadata: null`.

## Key files

- `packages/agent-runtime/src/plugins/base-container-agent-plugin.ts` (the fix)
- `apps/protocol-to-tfl/src/process-config-local.json` (local-claude config)
- `scripts/start-test-run.sh`, `scripts/autoadvance-run.sh`
- Deploy key: `~/.ssh/mediforce_deploy_key`
