# Workflow examples

These files are tutorial examples for the workflow definition schema. They are
small on purpose: each example demonstrates one concept, such as review loops,
script variants, action steps, trigger varieties, or validation gates.

They are not complete production Workflow Packages. For production package
standards, use [workflow-authoring-golden-rules.md](../workflow-authoring-golden-rules.md)
and the production-style reference package in
[`apps/golden-standard-workflow`](../../apps/golden-standard-workflow). For the
map of capabilities to the source files that define them, see
[workflow-capabilities.md](../workflow-capabilities.md).

## Index — what each file teaches

| File | Capability |
|------|-----------|
| `01-linear-pipeline.wd.json` | Minimal step → step pipeline |
| `02-review-loop.wd.json` | CM3/L3 agent approve-revise loop |
| `03-conditional-branching.wd.json` | Transition `when` expressions and branches |
| `04-script-variants.wd.json` | Inline vs command scripts; runtimes |
| `04b-script-r-clinical.wd.json` | R runtime script step |
| `05-action-steps.wd.json` | `http`, `reshape`, `email` actions |
| `06-env-secrets-databricks.wd.json` | `env`, secrets, Databricks job step |
| `07-trigger-varieties.wd.json` | `manual`, webhook, cron triggers |
| `08-selection-review.wd.json` | `selection` + human review |
| `09-cowork-step.wd.json` | `cowork` live collaboration step |
| `10-validation-gate.wd.json` | Validation gate with verdicts |
| `11-fan-out-orchestration.wd.json` | `spawn` + `forEach` fan-out, child workflows, `wait` |

Read the file whose capability matches what you are building; the set is small
enough that reading all of them is also fine and gives full schema coverage.

## How they map to the golden rules

- The positive `*.wd.json` files validate with `WorkflowDefinitionSchema` when a
  namespace is injected.
- The `anti-patterns/` files are intentionally invalid fragments used to teach
  common mistakes.
- Inline scripts are acceptable here because the examples teach schema behavior.
  Production packages should put substantial runtime code in package files and
  use pinned Docker build provenance.
- The examples avoid `workspace.remote` because they do not need a persistent
  run worktree.
- MCP examples are not included here. Golden-standard MCP workflows should use
  Agent-bound MCP bindings plus namespace-scoped Tool Catalog entries.

## Environment contract

Examples that reference secrets or env vars:

| Example | Name | Secret | Scope | Used by | Meaning | How to set | Example |
|---------|------|--------|-------|---------|---------|------------|---------|
| `02-review-loop.wd.json` | `OPENROUTER_API_KEY` | yes | workflow or namespace | `generate-draft` | LLM provider API key used by Claude Code through OpenRouter. | Workflow secrets panel, or namespace secret when shared. | `sk-or-v1-...` |
| `02-review-loop.wd.json` | `ANTHROPIC_BASE_URL` | no | workflow or namespace | `generate-draft` | Claude-compatible API base URL. | Workflow env or namespace secret if deployment-specific. | `https://openrouter.ai/api` |
| `06-env-secrets-databricks.wd.json` | `APP_BASE_URL` | no | workflow or namespace | `verify-output` | Mediforce base URL used in generated output metadata. | Workflow env or namespace secret if deployment-specific. | `http://127.0.0.1:9003` |
| `06-env-secrets-databricks.wd.json` | `DATABRICKS_HOST` | yes | workflow | `run-databricks-job` | Databricks workspace URL. | Workflow secrets panel. | `https://dbc-...cloud.databricks.com` |
| `06-env-secrets-databricks.wd.json` | `DATABRICKS_TOKEN` | yes | workflow | `run-databricks-job` | Databricks personal access token or service principal token. | Workflow secrets panel. | `dapi...` |

## Validate examples

Use the workflow register dry run when the CLI can run locally:

```bash
pnpm exec mediforce workflow register \
  --file docs/workflow-examples/01-linear-pipeline.wd.json \
  --namespace docs \
  --dry-run
```

The anti-pattern fixtures are not expected to pass validation.
