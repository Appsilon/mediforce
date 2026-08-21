# Step execution plugins

Every plugin here is a subclass of `BaseContainerAgentPlugin`: same Docker
envelope, same `AgentOutputEnvelopeSchema` result, same audit events. What
differs is the command run inside the container.

That uniformity is the point. A workflow author composes LLM steps and
deterministic steps the same way, and a reviewer reads one shape of audit trail
regardless of what produced it.

## The plugins

| Registered as | File | What it runs |
|---|---|---|
| `claude-code-agent` | `claude-code-agent-plugin.ts` | Claude Code in Docker. The default agent plugin. |
| `opencode-agent` | `opencode-agent-plugin.ts` | OpenCode — local Ollama or cloud providers, same envelope, different CLI. |
| `script-container` | `script-container-plugin.ts` | A command or inline script. No LLM. |
| `databricks-job` | `databricks/databricks-job-plugin.ts` | Triggers an existing Databricks job over the Jobs REST API. No LLM. |
| — | `mock-agent-plugin.ts` | Swapped in for `claude-code-agent` when `MOCK_AGENT=true`. Not separately registered. |

All four are registered in
`packages/platform-api/src/services/platform-services.ts`.

## Writing one

Subclass `BaseContainerAgentPlugin` and implement `getAgentCommand()`,
`getMockDockerArgs()`, and `parseAgentOutput()`. The base class already handles
spawning, mounts, git clone, MCP config assembly, environment resolution, and
output extraction — roughly everything that is hard to get right and identical
across plugins.

`packages/example-agent/` is a minimal reference implementation.

## Deterministic plugins

`script-container` and `databricks-job` are the same execution class: no LLM,
`confidence` pinned to `1.0`, errors fail the step and escalate, autonomy levels
do not apply. They are configured through `executor: 'script'` with step config
under `step.script` / `step.databricks` — **never** `step.agent`, which selects
an LLM plugin.

For `databricks-job`, Mediforce orchestrates runs of a job that already exists
in the customer's workspace; job creation and deployment stay in their own
pipeline. `DATABRICKS_HOST` and `DATABRICKS_TOKEN` come from namespace secrets,
and secrets are deliberately not an interpolation source — a token must never
reach Databricks run parameters or an audit snapshot. v1 supports single-task
jobs only.

## Shared machinery

`base-container-agent-plugin.ts` (spawn, mounts, git, MCP, output),
`docker-spawn-strategy.ts` (local vs queued), `docker-image-builder.ts`,
`git-clone.ts`, `resolve-env.ts`, `container-plugin.ts`.

Execution model in depth:
[`docs/reference/container-steps.md`](../../../../docs/reference/container-steps.md).
