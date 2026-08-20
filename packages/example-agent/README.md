# @mediforce/example-agent

Reference implementation of `StepExecutorPlugin`. Copy it as the starting point
for a new plugin.

It is deliberately tiny and deliberately not registered — nothing in the running
platform dispatches to it. It exists to be read, and to be exercised from tests
and ad-hoc scripts.

## The lifecycle it demonstrates

1. `initialize(context)` — receive and store the `AgentContext` (step input,
   config, LLM client).
2. `run(emit)` — do the work, emitting events as you go:
   - `status` — progress updates.
   - `annotation` — findings discovered during execution.
   - `result` — **exactly one**, conforming to `AgentOutputEnvelopeSchema`.
     Required for the step to complete.

## The rule it exists to teach

**Plugins are autonomy-agnostic.** Never read `context.autonomyLevel` and never
decide whether your own confidence was sufficient. `AgentRunner` applies
thresholds, escalation and fallback *after* `run()` returns. Autonomy is a
property of the workflow definition, where it is declared and auditable — a
plugin that second-guesses it moves a governance decision into code.

For plugins that run something in a container, subclass
`BaseContainerAgentPlugin` instead and see
[`../agent-runtime/src/plugins/README.md`](../agent-runtime/src/plugins/README.md).
