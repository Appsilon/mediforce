# ADR-0008: Step Executor Model — Separating Agent from Script Execution

> **Note:** The executor model described here is unchanged. The UI now uses **Control Modes** (0–4) as the user-facing abstraction over `executor` + `autonomyLevel`. See [AUTONOMY-LEVELS-REFACTOR.md](../design/AUTONOMY-LEVELS-REFACTOR.md).

**Status:** Accepted  
**Date:** 2026-06-11  
**Deciders:** Filip Stachura  

## Context

The platform supports two fundamentally different executor types for workflow
steps: **agent** (LLM-driven, with autonomy levels L0–L4, review/escalation,
confidence scoring) and **script** (deterministic jobs — `script-container`,
`databricks-job`). Both were forced through the same code path:

- `AgentRunner` dispatched both types
- `AgentOutputEnvelope` wrapped both outputs (script steps emitted meaningless
  `confidence: 1.0`, `model: 'databricks'`)
- `executeAgentStep()` — one 500-line function — used `isScript` guards to
  skip autonomy routing for scripts
- Audit events emitted `agent.*` for script steps
- UI needed `executorType === 'script'` checks to hide LLM metadata

The databricks-job plugin (#681) made this technical debt visible: a
deterministic API call was presented as an "agent" everywhere in the system.

## Decision

Introduce a **Step Executor** strategy pattern that cleanly separates the
shared execution concern from executor-specific behavior.

### Architecture

```
StepExecutor (interface)
├── AgentStepExecutor   — autonomy routing, review/escalation, confidence
└── ScriptStepExecutor  — auto-apply, no autonomy concept

PluginRunner (shared)    — dispatch StepExecutorPlugin, collect output
├── used by AgentStepExecutor (wraps with AgentRunner for autonomy)
└── used by ScriptStepExecutor (directly)

StepOutputEnvelope (base) — result, duration_ms, annotations, git, files
└── AgentOutputEnvelope   — + confidence, model, reasoning, tokenUsage
```

### Key decisions

1. **StepExecutor** is the shared abstraction (strategy pattern, not
   base-wraps-extension). Each executor implements `execute()` with a
   clean contract.

2. **StepOutputEnvelope** is the base result shape. AgentOutputEnvelope
   extends it with LLM-specific fields. Script steps produce the base —
   no fake confidence, no meaningless model field.

3. **Autonomy levels are agent-only.** Script steps have no autonomy level
   (not "L4 by convention"). The script executor flow has no review,
   escalation, or pause paths.

4. **PluginRunner** extracted from AgentRunner — shared by both executors.
   Handles plugin dispatch + output collection. AgentRunner becomes
   agent-only, wrapping PluginRunner with autonomy/audit behavior.

5. **StepExecutorPlugin** replaces `AgentPlugin` as the interface name.
   Same shape (`initialize()` + `run()`), accurate name.

6. **Audit events keep `agent.*` / `script.*` prefixes.** Users filter by
   executor type at the top level — payload-level filtering is less
   discoverable. New executor types get their own prefix.

### Delivery plan (incremental, 4 PRs)

1. `StepOutputEnvelope` base + `AgentOutputEnvelope extends` (platform-core)
2. Extract `PluginRunner` from `AgentRunner` (agent-runtime)
3. `StepExecutor` strategy + `ScriptStepExecutor` / `AgentStepExecutor`
   (platform-ui, replaces `executeAgentStep`)
4. Rename `AgentPlugin` → `StepExecutorPlugin` + remove `isScript` guards

Each PR is shippable independently with no behavior change until PR 3.

## Alternatives considered

- **Single function with `isScript` guards** (status quo): works but
  accumulates guards with every new script plugin. Autonomy concepts leak
  into script paths. Already 4+ sites checking `executorType === 'script'`.

- **Base function + agent wrapper** (extract `executeStep()` called by
  `executeAgentStep()`): fuzzy boundary — hard to define what's "base" vs
  "agent" in a 500-line function. Boundary drifts with each PR.

- **Unified `step.*` audit events**: cleaner namespace but loses the
  instant visual distinction between agent and script in the audit log.
  Users see executor type as a top-level concern.

## Consequences

- Script plugins no longer carry agent baggage (autonomy, confidence, model)
- New executor types (future) implement `StepExecutor` without touching
  agent code
- UI renders what's in the envelope — no executor-type guards needed
- AgentRunner scope shrinks to agent-only concerns
- Migration: existing `AgentOutputEnvelope` records in DB remain valid
  (superset of `StepOutputEnvelope`)
