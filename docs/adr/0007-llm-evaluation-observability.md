# 0007 — LLM evaluation & observability: layered model, hybrid system of record

- **Status:** Proposed
- **Date:** 2026-06-10
- **Authors:** Filip Stachura (@filipstachura)
- **Relates to:**
  - Builds on the workflow/agent domain model in [`CONTEXT.md`](../../CONTEXT.md)
    (Agent Run, Step Execution, Agent Output Envelope, Audit Event).
  - Complements [`ADR-0001`](./0001-firestore-to-postgres.md) — new evaluation
    entities land as Postgres tables following the same repo conventions.
  - Platform entities follow the headless handler pattern from
    [`ADR-0005`](./0005-headless-platform-api-ui-separation.md).

## Context

Agents run in production workflows, but we cannot answer: *is agent X getting
better or worse over time?* and *is a cheaper model good enough to swap into
an existing workflow?* (the "challenger" scenario). In pharma, the answer to
the second question is itself a compliance artifact — "model M passed eval
suite S before being deployed into workflow W" must be auditable.

What exists today:

- `AgentOutputEnvelope` already persists, per Agent Run: model, token usage
  (optional), duration, confidence (agent self-assessment), reasoning chain,
  result. Immutable.
- `AgentEventLog` is in-memory and transient — intermediate `status` /
  `annotation` events are discarded once the envelope is built.
- No OpenTelemetry / tracing SDK anywhere in the repo. No eval datasets, no
  eval runs, no external quality scores.
- `ProcessInstance.totalCostUsd` is computed
  (envelope.tokenUsage × `ModelRegistryEntry.pricing` via
  `estimateCostField`) and accumulated per run, but the logic lives in
  `platform-ui/execute-agent-step.ts` (a Server Action), so it is
  unavailable to CLI / agents / tests until migrated to the headless
  handler layer (ADR-0005).
- `ReviewPlugin.review()` returns `{verdict, reasoning, confidence}` — a
  ready-made LLM-as-judge interface, not yet wired into the engine.
- Model is already swappable per step (`step.agent.model`) and per agent
  (`foundationModel`), all LLM calls go through OpenRouter.
- At least one customer has asked for OpenTelemetry integration.

## Conceptual model: four layers

The vocabulary for everything in this space, regardless of where each piece
is implemented:

1. **Traces** — telemetry record of every agent execution: span tree of LLM
   calls and tool invocations with model, tokens, latency, cost attributes.
2. **Scores** — external quality judgments attached to executions. Three
   sources: deterministic checks, LLM-as-judge, human review. Aggregated
   over time, scores per workflow/agent/model ARE the quality-tracking and
   practical drift-detection story.
3. **Eval Datasets** — selected production executions frozen as golden /
   regression cases (input → accepted output).
4. **Eval Runs** — executing a dataset against a configuration (different
   model, prompt, agent version) and scoring the results; champion vs
   challenger comparison before swapping a model in a workflow.

Each layer feeds the next; production traces close the loop by replenishing
datasets.

## Decision

### D1. Unit of evaluation = Agent Run

Scores attach primarily to **Agent Runs** (immutable, self-contained: input,
envelope, model). The `Score.subject` is polymorphic
(`agent_run | workflow_run`) from day one, because production monitoring
yields Workflow-Run-level scores for free (e.g. the final human verdict of a
run is ground truth nobody has to produce separately) — but **offline replay
of whole workflows is out of scope**: simulating the human decisions inside
mixed workflows is a separate, research-grade problem. Challenger evals
compare per Agent Run.

### D2. Hybrid system of record, cut along the layers

- **Traces (layer 1) live in an external trace store**, outside the
  platform. They are operational telemetry: high volume, short retention,
  best served by purpose-built viewers we should not rebuild.
- **Scores, Eval Datasets, Eval Runs (layers 2–4) live in the platform** as
  first-class entities in `platform-core` (Zod schema + repository + headless
  handler, per ADR-0005), because they are quasi-regulatory records: they
  need Namespace scoping, Audit Events, and single-system GxP qualification.
  The platform can then enforce invariants on its own data (e.g. a model
  swap gated on a green Eval Run).

### D3. OpenTelemetry is the emission contract; the trace store is a deployment option

The hard, lock-in commitment is the **instrumentation format**: agent-runtime
and workflow-engine emit OTel spans following the **GenAI semantic
conventions**. Where those spans flow is per-deployment configuration (an
OTLP exporter endpoint), not architecture:

- Default battery included for dev/demo: **Arize Phoenix** (OTel-native,
  single container + Postgres, strong drift visualization). ELv2 license
  needs a one-time legal check before bundling in customer deployments.
  **Testing starts here** — lightest self-host footprint, OTel-native
  ingestion, no additional infrastructure.
- A customer with an existing OTLP-capable observability stack (SigNoz,
  Grafana Tempo, Datadog, …) points the exporter at it instead — zero new
  systems to qualify.
- Langfuse remains a valid target (it ingests OTLP) for customers who want
  it; we do not adopt its SDK or its dataset/eval features (those are
  platform-owned per D2).

The topology supports fan-out: application → **OTel Collector** → N
backends in parallel (one pipeline, multiple exporters in Collector YAML).
Langfuse evaluation happens later via this fan-out — add an exporter,
compare both UIs on the same live traffic, drop whichever loses.

### D4. Correlation contract

Every span carries the platform IDs as attributes: `agentRunId`,
`processInstanceId` (workflow run), `namespace`, workflow `name` + `version`,
`stepId`, `model`. All of these are already present in
`WorkflowAgentContext`. Without this, layers 2–4 can never join back to
their traces, and "add this trace to a dataset" is impossible. Cheap now,
unbackfillable later.

### D5. Content capture is a per-deployment switch, default off in production

Prompts and completions may contain patient data. The OTel GenAI conventions
make content capture opt-in; we expose it as deployment configuration:
**off by default in production deployments, on in dev/demo**. With content
off, the external store sees only metadata (tokens, latency, model, status,
correlation IDs) and full content remains exclusively in the platform
(envelope). The decision about a given customer's data therefore lands in
that customer's deployment config, not in the architecture.

## Considered options

- **External tool (e.g. Langfuse) as system of record for everything** —
  fastest time-to-value (trace viewer, dashboards, annotation queues,
  experiments UI out of the box), but: eval results become compliance
  artifacts living in a second system the customer must qualify separately;
  Namespace scoping has no counterpart there; the platform cannot enforce
  invariants (eval-gated model swaps) on data it does not own; Langfuse v3
  self-host means ClickHouse + Redis + S3 + Postgres per single-tenant
  on-prem deployment. Rejected.
- **Platform as system of record for everything, traces included** — full
  audit/permission coverage, but we would build and maintain a trace viewer,
  dashboards and drift analytics ourselves; months of product work to reach
  a fraction of what purpose-built tools ship today, and embedding-based
  drift analysis would realistically never get built. Rejected.
- **Direct vendor SDK instead of OTel** (Langfuse/Phoenix SDK in
  agent-runtime) — marginally richer integration today, but couples the
  codebase to one vendor's wire format; swapping later means re-touching all
  instrumentation. OTel costs little extra now and makes the trace store a
  config value. Rejected.

## Consequences

- agent-runtime gets OTel instrumentation (`OpenRouterLlmClient` spans, agent
  run root span in `AgentRunner`, step/run spans in workflow-engine), with
  the correlation attributes from D4 and the content switch from D5.
- Known caveat: the OTel GenAI semantic conventions are still marked
  experimental upstream; attribute names may shift. Accepted — they are the
  only emerging standard, renames are mechanical, and the alternative
  (vendor wire format) is strictly worse lock-in.
- Token usage should become required (not optional) in the envelope.
  Cost computation already exists (`estimateCostField`) but lives in
  `platform-ui`; migrating it to the headless handler layer alongside
  layer 1 makes it available to CLI, agents, and eval runs.
- `ReviewPlugin`'s `{verdict, reasoning, confidence}` shape is the intended
  basis for LLM-as-judge scoring in layer 2 — do not invent a parallel
  abstraction when that layer lands.

## Deferred (deliberately undecided)

Layers 2–4 entity design — `Score` / `EvalDataset` / `EvalRun` schemas,
judge calibration, annotation UX, drift methodology beyond score
time-series, dataset versioning — is deferred until layer 1 ships and real
production traces inform it. The reserved names and their semantics are in
[`CONTEXT.md`](../../CONTEXT.md) so the vocabulary stays stable meanwhile.
