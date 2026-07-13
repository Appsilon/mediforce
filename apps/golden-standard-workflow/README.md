# Golden Standard Workflow

This app is the production-style companion to
[`docs/workflow-authoring-golden-rules.md`](../../docs/workflow-authoring-golden-rules.md).
Use it when the tutorial examples are too small.

It shows:

- `index.json` for Git import browse mode.
- A package README with setup contracts.
- A pinned workflow definition in `src/golden-standard-workflow.wd.json`.
- A Dockerfile that installs runtime dependencies and copies scripts/MCP code.
- Deterministic script steps that run commands from the image.
- Agent steps that use packaged skills.
- Current control-mode mapping after ADR-0006/#783.
- Governable MCP setup via Tool Catalog + Agent Definition.

## Files

```text
apps/golden-standard-workflow/
  index.json
  README.md
  container/Dockerfile
  mcp/readonly_context_mcp.py
  scripts/normalize_request.py
  scripts/quality_gate.py
  setup/agent-definition.json
  setup/tool-catalog-entry.json
  skills/summarize-record/SKILL.md
  src/golden-standard-workflow.wd.json
```

## Dockerfile Pattern

The Dockerfile starts from `mediforce-golden-image`, installs only runtime
dependencies, then copies package-owned files into stable paths under
`/opt/golden-standard`.

```dockerfile
FROM mediforce-golden-image

RUN apt-get update \
    && apt-get install -y --no-install-recommends jq ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir --break-system-packages \
    "pydantic==2.11.7"

COPY scripts/ /opt/golden-standard/scripts/
COPY mcp/ /opt/golden-standard/mcp/

WORKDIR /workspace
```

Rules:

- Install OS packages with `apt-get` and clean `/var/lib/apt/lists`.
- Install Python/R/Node packages with pinned versions.
- Copy deterministic scripts into the image.
- Copy MCP executables into the image only so they can run.
- Do not copy secrets, workflow transitions, permissions, or deployment URLs.

Build locally:

```bash
docker build \
  -t mediforce-golden-standard-workflow:latest \
  -f apps/golden-standard-workflow/container/Dockerfile \
  apps/golden-standard-workflow
```

## Control Modes

Control Mode is UI-only. Workflow JSON still stores `executor` and sometimes
`autonomyLevel`.

| Control mode | Workflow shape | In this workflow |
|--------------|----------------|------------------|
| CM0 No agent | `executor: human`, `script`, or `action` | `collect-intake`, `normalize-request`, `notify-owner` |
| CM1 Assist | old `executor: agent`, `autonomyLevel: L2` | not used; not creatable in the wizard |
| CM2 Cowork | `executor: cowork` | `cowork-refine` |
| CM3 Human review | `executor: agent`, `autonomyLevel: L3` | `agent-review` |
| CM4 Autonomous agent | `executor: agent`, `autonomyLevel: L4` | `autonomous-package` |

`type` is separate from control mode. Most work steps use `type: creation`.
Human business decisions use `type: review` with explicit `verdicts`.

## Env And Secrets

| Name | Secret | Scope | Used by | Meaning | How to set | Example |
|------|--------|-------|---------|---------|------------|---------|
| `APP_BASE_URL` | no | namespace | `normalize-request`, `notify-owner` | Mediforce base URL used in output metadata and notifications. | Namespace env or workflow env. | `https://staging.mediforce.ai` |
| `OPENROUTER_API_KEY` | yes | namespace or workflow | `agent-review`, `autonomous-package` | LLM provider key for Claude-compatible agent runtime. | Namespace secret when shared; workflow secret when specific to this workflow. | `sk-or-v1-...` |
| `CONTEXT_TOKEN` | yes | workflow | `readonly-context` MCP | Token used by the example MCP server. | Workflow secrets panel. | `ctx_...` |

## MCP Governance

The Dockerfile copies `mcp/readonly_context_mcp.py`, so the command exists in
the container. That is not enough. To make the MCP governable:

1. Add `setup/tool-catalog-entry.json` in `/{handle}/admin/tool-catalog`.
2. Add or update an Agent using `setup/agent-definition.json`.
3. Reference that Agent from workflow steps with `agentId`.
4. Narrow step access with `mcpRestrictions`.

The workflow uses:

```json
{
  "agentId": "golden-standard-reviewer",
  "mcpRestrictions": {
    "readonly-context": {
      "denyTools": ["write_context"]
    }
  }
}
```

Do not add `mcpServers` inside workflow step `agent` or `cowork` config.

## Validate

```bash
pnpm --filter @mediforce/golden-standard-workflow test

pnpm exec mediforce workflow register \
  --file apps/golden-standard-workflow/src/golden-standard-workflow.wd.json \
  --namespace appsilon \
  --dry-run
```
