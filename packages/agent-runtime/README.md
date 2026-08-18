# @mediforce/agent-runtime

Executes a step that runs code — an LLM agent in a container, a deterministic
script, or a Databricks job. Owns the `AgentPlugin` contract, plugin dispatch,
the output envelope, autonomy enforcement, and fallback handling.

The engine decides *which* step runs next; this package decides *how* that step
actually executes and whether its result is trustworthy enough to continue.

## What lives here

| Directory | Holds |
|---|---|
| `src/runner/` | `AgentRunner`, `PluginRegistry`, `FallbackHandler`, step executors, `OpenRouterLlmClient`, OTel tracing |
| `src/plugins/` | `BaseContainerAgentPlugin` and the concrete plugins — see [`src/plugins/README.md`](src/plugins/README.md) |
| `src/interfaces/` | `AgentPlugin`, review and step-executor plugin contracts |
| `src/mcp/` | Per-step MCP resolution (`resolveMcpForStep`) |
| `src/oauth/` | MCP OAuth — discovery, dynamic client registration, token resolution |
| `src/workspace/` | Run workspace paths, output-file collection, workspace reads |
| `src/testing/` | `InMemoryAgentEventLog`, `NoopLlmClient`, recording tracer |

## The contract

A plugin implements `initialize(context)` then `run(emit)`, and emits **exactly
one `result` event** conforming to `AgentOutputEnvelopeSchema`. The envelope
carries `confidence` (0.0–1.0) and `confidence_rationale`.

**Plugins do not implement autonomy.** `AgentRunner` applies it *after* `run`
returns: it compares `confidence` against the step's threshold and fires the
fallback — escalate to a human, retry, or fail the step. A plugin that decides
for itself whether its answer was good enough has taken a governance decision
out of the workflow definition, where it is auditable, and buried it in code.

The same rule covers timeouts and errors: they are envelope outcomes handled by
`FallbackHandler`, not exceptions a plugin swallows.

## Rules

**Register plugins in one place.** `PluginRegistry` is populated in
`packages/platform-api/src/services/platform-services.ts` — that is the
composition root for the whole platform. Nothing self-registers on import.

**Spawn strategy is chosen for you.** `LocalDockerSpawnStrategy` by default;
setting `REDIS_URL` switches to `QueuedDockerSpawnStrategy`, which hands work to
[`@mediforce/container-worker`](../container-worker/README.md). Plugins are
written against the strategy interface and never shell out to `docker` directly.

**`MOCK_AGENT=true` replaces `claude-code-agent` with `MockAgentPlugin`,**
returning fixture data instantly. This is what makes UI development and E2E runs
possible without API keys or Docker.
