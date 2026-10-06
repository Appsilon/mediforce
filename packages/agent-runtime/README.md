# @mediforce/agent-runtime

Executes a step that runs code — an LLM agent in a container, a deterministic
script, or a Databricks job. Owns the `StepExecutorPlugin` contract, plugin dispatch,
the output envelope, autonomy enforcement, and fallback handling.

The engine decides *which* step runs next; this package decides *how* that step
actually executes and whether its result is trustworthy enough to continue.

## What lives here

| Directory | Holds |
|---|---|
| `src/runner/` | `AgentRunner`, `PluginRegistry`, `FallbackHandler`, step executors, `OpenRouterLlmClient`, the `LlmJudgeReviewPlugin` behind `llm_judge` Evaluators (reads the step's input, Trajectory and output; answers pass/fail, confidence and rationale) and `judgeOutputAgreement` behind `expected_output` agreement checks (scores 0–1 how far an output agrees with an Eval Case's expected output) — each builds its messages with `llmJudgeMessages` / `outputAgreementMessages`, exported so a reviewer sees what the judge was sent, OTel tracing |
| `src/plugins/` | `BaseContainerAgentPlugin` and the concrete plugins, and the code-check container Step Evaluation runs — see [`src/plugins/README.md`](src/plugins/README.md) |
| `src/interfaces/` | `StepExecutorPlugin`, review and step-executor contracts |
| `src/mcp/` | Per-step MCP resolution (`resolveMcpForStep`); the record/replay proxy an eval trial runs in an MCP server's place (`mcp-tape.ts`, ADR-0023 D6) |
| `src/skills/` | Per-step agent Skill resolution (`resolveSkillsForStep`) and the content-hashed Claude Code plugin folder they are delivered in (`materializeAgentSkillsPlugin`, ADR-0025) |
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

`agent.outputSchema` is the runner's check too: it validates `result`, reruns
the plugin once with the violation in `context.outputSchemaViolation` — within
what is left of the one step timeout — then falls back with reason
`output_schema` (ADR-0023 D13).

**An optional `context.outputGate` checks a result that passed `outputSchema`.**
It runs before the confidence and autonomy routing, receives the Agent Run id,
context and envelope, and returns `{ failure, errors }`. A `failure` falls back
with reason `production_evaluator`, like low confidence; `errors` (and a gate
that throws) are only logged to the activity log. The runner stays free of
platform-api: `executeAgentStep` supplies the gate for real, non-trial runs of
steps with production Evaluators.

**Every Agent Run keeps an Agent Trajectory through `context.trajectory`.**
The runner hands each Agent Run a `TrajectoryRecorder`; the base plugin records
the same entries it writes to the step's activity log (`agentLogEntries` for its
`logFormat`), and the recorder persists them with full content (ADR-0023 D8) —
`captureContent` governs exported spans only (ADR-0007 D5). The activity log is
the live view; the trajectory is the durable record Step Evaluation, the CLI and
the API read.

## Rules

**Register plugins in one place.** `PluginRegistry` is populated in
`packages/platform-api/src/services/platform-services.ts` — that is the
composition root for the whole platform. Nothing self-registers on import.
Register a factory, not an instance: `get()` builds a fresh plugin per run,
because plugins keep run state on `this` between `initialize` and `run` and a
shared instance lets concurrent runs overwrite each other's context.

**Spawn strategy is chosen for you.** `LocalDockerSpawnStrategy` by default;
setting `REDIS_URL` switches to `QueuedDockerSpawnStrategy`, which hands work to
[`@mediforce/container-worker`](../container-worker/README.md). Plugins are
written against the strategy interface and never shell out to `docker` directly.

**The agent CLI spawns stdio MCP servers, not the platform.** The plugin only
writes `mcp-config.json`; `claude` starts each server inside the container and
holds the agent's first turn until it connects, for at most `MCP_TIMEOUT` (the
CLI version pinned in [`Dockerfile.base`](container/Dockerfile.base) does).
`ClaudeCodeAgentPlugin` sets it to 120s when the step binds a stdio server — the
CLI's own 30s is shorter than a cold `uvx`/`npx` install — unless the workflow
or step `env` sets `MCP_TIMEOUT` itself. In local mode that also overrides one
exported in the host shell, and the host's own `claude` decides whether it
waits at all. A server the CLI reports `failed` or still `pending` at start
becomes a status warning on the run, never a step failure; for a stdio server
the warning says to raise `MCP_TIMEOUT` in the step's `env`.

**`MOCK_AGENT=true` replaces `claude-code-agent` with `MockAgentPlugin`,**
returning fixture data instantly. This is what makes UI development and E2E runs
possible without API keys or Docker.
