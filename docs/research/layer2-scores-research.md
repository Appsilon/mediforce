---
status: draft
audience: engineers
last_reviewed: 2026-08-19
---

# Research — Layer 2 (Scores), deferred

**Status:** Research note. No code, no PRs. Layer 2 is deferred in
[ADR-0007 § Deferred](../adr/0007-llm-evaluation-observability.md) until layer 1
(traces, shipped in PR #677) produces real data.
**Date:** 2026-06-12 · re-checked against the code 2026-08-19
**Author:** Filip Stachura, with Claude

## Scope of this note

ADR-0007 names the four layers and defers the entity design for 2–4. This note
holds the exploration behind layer 2 — where scores come from, which external
tool is worth using, how a Score joins back to a trace — so the work starts
from informed ground instead of re-deriving it. When it picks up, the decision
becomes a numbered ADR; until then this is a map, not a commitment.

Nothing here has shipped: no `Score` schema, no repository, no handler.

## 1. Where Scores come from

Three sources, matching ADR-0007's layer 2 definition: human review,
deterministic checks, LLM-as-judge.

### 1a. Human verdict = ground truth

The L3 approval flow (`buildVerdictStepOutput()` in `complete-human-task.ts`)
already captures a domain expert's judgment on agent output. That is the
highest-quality Score source available, and it needs no new operator behavior:
auto-create a Score when a HumanTask with `creationReason: 'agent_review_l3'`
completes.

```
Score {
  subject:   { type: 'agent_run', id: agentRunId }
  name:      'human_verdict'
  source:    'human'
  label:     payload.verdict           // verdict key, e.g. 'approve' | 'reject' | 'revise'
  value:     intent === 'success' ? 1.0 : intent === 'danger' ? 0.0 : 0.5
  comment:   payload.comment
  createdBy: actorId
  agentRunId, processInstanceId, namespace, stepId   // correlation
}
```

`intent` is **not** on the completion payload — the payload carries
`{verdict, comment, selectedIndex?}`. Resolve it from the task's own verdict
descriptors (`task.verdicts[].intent`, defaulted by `defaultVerdictIntent()`),
which is where workflow-defined verdict vocabularies land. The numeric mapping
is lossy on purpose, to normalize across those vocabularies for aggregation;
`label` preserves the original key.

### 1b. Deterministic checks

Cheap, instant, and the only quality signal available on L0–L2/L4 autonomous
runs where nobody reviews the output. Two fire against config that exists
today:

- **Has result** — `envelope.result !== null`.
- **Confidence threshold** — `envelope.confidence >= agent.confidenceThreshold`
  (`WorkflowAgentConfigSchema.confidenceThreshold`).
- **Duration** — `envelope.duration_ms <= agent.timeoutMs`.

Two more are commonly wanted but have **no config field and no data to check
against** — proposing them means adding the field first:

- **Token budget** — there is no `maxTokens` on the agent config, and
  `envelope.tokenUsage` is optional with no `total`; a budget check must sum
  `inputTokens + outputTokens` against a new field.
- **Schema compliance** — steps declare no per-step output JSON Schema.
  `StepOutputSchema` types the envelope wrapper, not the agent's `result`.

### 1c. LLM-as-judge

`ReviewPlugin.review()` already returns
`{verdict: 'approve'|'reject'|'revise', reasoning, feedback?, confidence}` —
an LLM-as-judge interface that exists and is not wired to scoring.

```
ReviewPluginResult → Score {
  name:     'llm_judge'
  source:   'llm_judge'
  label:    verdict
  value:    verdict === 'approve' ? 1.0 : verdict === 'reject' ? 0.0 : 0.5
  comment:  reasoning
  metadata: { judgeModel, confidence, feedback }
}
```

Opt-in per workflow step — cost and latency mean not every run wants a judge.

## 2. Who reads them

**Operators** see scores where they already look: the run step detail view and
the L3 review flow. No separate "evaluation" area.

**Agent developers** get the loop that is missing today — run, score, change
prompt/model, re-run, compare. Side-by-side comparison is the precursor to
layer 4; plain aggregation ("average `human_verdict` for agent X over 30 days")
is layer 2.

**Compliance/QA** get the audit trail for free if every Score write appends an
AuditEvent: `actorType` user/agent/system per source, `action: 'score.created'`,
`entityType: 'score'`, `inputSnapshot` = the output being judged,
`outputSnapshot` = value + reasoning, `basis` = the scoring rule. That is
ADR-0007 D2's GxP requirement satisfied by an existing mechanism.

Scores are **append-only**. A revised judgment writes a new Score with a
`supersedes` pointer — matching AuditEvent and 21 CFR Part 11.

**Aggregations that matter:**

| Dimension | Question |
|---|---|
| Per agent | Is agent X getting better or worse? |
| Per model | Is the cheaper model good enough to swap in? |
| Per workflow | Which workflow has the lowest quality? |
| Per step | Which step fails most? |
| Per scorer | Which criterion fails most? |
| Over time | Quality trend for agent X over 30 days |

**Drift detection = a score trend going down.** Rolling average per
(agent, scorer), alert when the 7-day average drops below the 30-day average by
more than N%. No new entity — the complexity is the query and the threshold,
not the data model.

Layer 2 delivers per-run score detail on existing detail pages, a per-agent
summary, and a time series. Custom queries and drill-downs are layers 3–4.

## 3. External tools

ADR-0007 D2 puts eval entities in-platform. The question is what to use
*around* that.

| Tool | Verdict | Reason |
|---|---|---|
| **Phoenix** | **USE** | Trace viz + score overlay via `POST /v1/span_annotations`. Already in `docker-compose.yml`. |
| Langfuse | INTEGRATE | Valid optional OTLP target per D3. Don't adopt its scoring. |
| promptfoo | WATCH | TypeScript, good assertion model; possible future CLI tool. |
| Braintrust | IGNORE | Cloud-only. Borrow Score shape + classifier pattern. |
| autoevals | IGNORE | Borrow `LLMClassifier` + `choiceScores`. |
| Humanloop | IGNORE | Sunset Sept 2025. Borrow the Code/AI/Human evaluator taxonomy — it maps exactly to our three sources. |
| RAGAS · DeepEval | IGNORE | Python-only. Borrow multi-vote and CoT patterns. |
| LangSmith | IGNORE | LangChain ecosystem; not our stack. |

**Phoenix.** Stores annotations in a separate `span_annotations` table keyed by
`span_id`, not inside OTel span attributes — a mutable overlay on immutable
trace data, upserted on `(name, span_id, identifier)`. That is the right model
and the one to copy. Sync is write-only, platform → Phoenix:

```typescript
await phoenix.POST("/v1/span_annotations", {
  body: { data: [{
    span_id: agentRun.otelSpanId,
    name: score.name,
    annotator_kind: score.source === 'human' ? 'HUMAN'
                  : score.source === 'llm_judge' ? 'LLM' : 'CODE',
    result: { label: score.label, score: score.value, explanation: score.comment },
    metadata: score.metadata ?? {},
  }]}
});
```

Not the system of record: Phoenix datasets have no namespace, no audit trail,
no authz. And Phoenix OSS has **no score drift detection or alerting** — only
embedding drift (UMAP/HDBSCAN) and time-series charts without thresholds. We
own drift.

**Langfuse** — the ADR-0007 "don't adopt the SDK" call still holds: projects
are not our namespace/workspace/membership model, score writes are unaudited
(fails 21 CFR Part 11), a second system doubles GxP qualification scope, v3
self-host is ClickHouse + Redis + S3 + Postgres, and the platform can't gate
model swaps on data it doesn't own.

**LLM-as-judge patterns worth adopting** (consistent across RAGAS, DeepEval,
promptfoo, autoevals, LangSmith):

1. Rubric is a free-text string — every framework accepts plain English.
2. Normalize to a 0–1 float. Universal; no reason to diverge.
3. Multi-criteria = N independent scorers, not one multi-output scorer.
4. Always store the reasoning next to the number.
5. Reasoning field precedes the score in the LLM schema, forcing CoT
   (+10–20% consistency).
6. Discrete classification beats asking for a 1–10 rating — map choices to
   numbers (`choiceScores`).

Build the judge in TypeScript on the existing `ReviewPlugin` +
`OpenRouterLlmClient`; don't take a runtime dependency on an eval framework.

## 4. Joining Scores to Layer 1 traces

**The join key is `agentRunId`, not `traceId`.** D4 already puts
`mediforce.agent_run.id` on every span, so a Score → traces lookup works
against any trace backend, and a trace → Scores lookup is a platform query on
`subjectId`. OTel IDs are wrong for this: they're generated outside the
platform, they're ephemeral under trace retention, and their format varies by
backend. The platform owns identity; the trace store is a view. Workflow
run-level Scores join on `processInstanceId`, same logic.

**Phoenix sync needs a span ID the platform doesn't store.** The span is
created by `withAgentRunSpan()` in `agent-runner.ts` and never persisted.

| Option | Tradeoff |
|---|---|
| **A. Store `otelSpanId?` on AgentRun** | Clean join, one field, set in the code path that already creates the span. **Recommended.** |
| B. Query Phoenix by the `agentRunId` attribute | Works, but couples the sync path to Phoenix's query API. |
| C. Don't sync | Loses "quality alongside traces". |

Sync is one-way and async — never read Scores back from Phoenix (D2), never
block Score creation on Phoenix availability. Fire-and-forget first; an outbox
only if scores actually go missing.

**Content for the judge** comes from the `AgentOutputEnvelope`, not the trace
store. It has `result`, `reasoning_summary`, `reasoning_chain`, `confidence`,
and the step's input via `WorkflowAgentContext.stepInput` — enough for
"given this input, is this output good?", which is most criteria. It does
*not* have the raw prompt/completion. Criteria that need those (e.g. safety
screening of what the LLM literally said) must read the trace store when
`MEDIFORCE_OTEL_CAPTURE_CONTENT=true` and degrade gracefully when it's off —
which is the production default (D5). Advanced path, not MVP.

## 5. What layer 3 needs layer 2 to carry

For "add this agent run to an eval dataset" to work later:

| Needed | Where it lives | Layer 2 action |
|---|---|---|
| Input | `StepExecution.input` / `WorkflowAgentContext.stepInput` | reachable via `agentRunId` |
| Output | `AgentOutputEnvelope` on AgentRun | same join |
| Model | `AgentOutputEnvelope.model` | already there |
| Quality judgment | `Score.value` + `Score.label` | this IS the Score |
| Expected output | doesn't exist | layer 3 — but a human verdict Score is implicit ground truth |
| Correlation | namespace, workflow name+version, stepId | Score carries these |

A `human_verdict` Score with `intent: 'success'` is an implicit "this output is
correct" signal, so layer 3 can offer *"a human approved this run — add it as a
golden case?"*. The Score stores no input/output, only the join key.

## 6. Proposed Score schema (sketch)

```typescript
const ScoreSchema = z.object({
  id: z.string().uuid(),

  subject: z.discriminatedUnion('type', [
    z.object({ type: z.literal('agent_run'), id: z.string() }),
    z.object({ type: z.literal('workflow_run'), id: z.string() }),
  ]),

  name: z.string().min(1),           // 'human_verdict' | 'llm_judge' | 'has_result' | ...
  value: z.number().min(0).max(1),   // normalized
  label: z.string().nullable(),      // categorical, e.g. 'approve'
  comment: z.string().nullable(),    // reasoning

  source: z.enum(['human', 'llm_judge', 'deterministic']),
  createdBy: z.string().nullable(),  // userId for human, null for automated

  // source-specific: { judgeModel, confidence, rubric } | { rule, threshold, actual } | { verdictKey, intent }
  metadata: z.record(z.string(), z.unknown()).nullable(),

  namespace: z.string(),
  processInstanceId: z.string().nullable(), // null for a standalone agent run
  stepId: z.string().nullable(),

  supersedes: z.string().uuid().nullable(), // append-only revision pointer
  configId: z.string().uuid().nullable(),   // Score Config, if it lands in layer 2

  createdAt: z.string().datetime(),
});
```

Follows the existing entity conventions: Zod, namespace-scoped, denormalized
correlation fields, append-only.

## 7. Open questions

1. **Deterministic scores auto-fire or opt-in per step?** Proposal: auto-fire
   `has_result` and `confidence_threshold` always, everything else opt-in via
   step config.
2. **LLM judge blocking or async?** On L3 the human is already blocking, so
   judging during the wait is free. On autonomous steps async is the only sane
   option.
3. **Score Config entity in layer 2, or 2.5?** It makes scoring declarative
   (rubric, judge model, threshold, on/off) but adds an entity, a UI and a
   handler. Could ship with hardcoded score names first.
4. **Denormalize workflow name+version on Score?** Start with the join through
   ProcessInstance; denormalize only if aggregation queries demand it.
5. **Phoenix sync: fire-and-forget or BullMQ job?** Fire-and-forget for MVP;
   a job (and the Redis dependency) only if scores are observed missing.
6. **`otelSpanId` on AgentRun — in layer 2 or a standalone prep PR?** Needs a
   Postgres migration and a change to `withAgentRunSpan()`. Small and low-risk
   either way.
7. **Single `scores` table with JSONB `metadata`, or a table per source?**
   Proposal: single table, matching AuditEvent's pattern; `source`
   discriminates.
8. **Auto-create a Score from `envelope.confidence`?** No. ADR-0007 and
   `CONTEXT.md` separate them deliberately — confidence is the agent's
   self-assessment, a Score is an external judgment. Mixing them pollutes the
   distribution.
9. **MVP scope.** Proposal: Score schema + repo + handler, `human_verdict`
   auto-created from L3 approvals, 2–3 deterministic scores, a per-agent
   aggregation endpoint. Defer the judge pipeline, Score Config, Phoenix sync,
   dashboard UI, drift alerting.
10. **CLI.** `mediforce score list --agent-run <id>` and `score create` land in
    the same PR as the handler (CLI > REST).
