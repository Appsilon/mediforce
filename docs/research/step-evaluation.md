---
status: draft
audience: engineers
last_reviewed: 2026-09-22
---

# Research — Step Evaluation (ADR-0007 layers 2–4)

**Status:** Research note. No code. The binding decisions are in
[ADR-0023](../adr/0023-step-evaluation.md), which supersedes the Deferred
section of [ADR-0007](../adr/0007-llm-evaluation-observability.md). This note
keeps the landscape and the capability sketch behind them.
**Date:** 2026-09-22
**Author:** Krystian Zielinski, with Claude
**Builds on:** [ADR-0007](../adr/0007-llm-evaluation-observability.md),
[`layer2-scores-research.md`](layer2-scores-research.md) (Score schema, judge
patterns, Phoenix sync).

## Goal

Let a workflow author answer, per agent step: *can this step, in this
configuration, be trusted for its context of use?* — and when the answer is
no, be walked to a fix rather than only shown the failures.

## Decisions

Settled in a grill session on 2026-09-22 and recorded as
[ADR-0023](../adr/0023-step-evaluation.md) D1–D13: vocabulary, Step-owned
Evaluators reused by copy, own grader layer, eval trial as a single-step
Workflow Run, variants as patches bound to a Step Fingerprint, default-deny MCP
eval policy, immutable Evaluator versions, persisted Agent Trajectories, trust
gate per Evaluator kind, pre-set Acceptance Criteria on interval bounds,
informational Step Qualification, provenance-tracked few-shot examples, opt-in
production Evaluators — and D14–D16: one Evaluation Assistant built on the
workflow editor assistant's blocks, its tiered authority, and a per-Step
Evaluation Brief.

## What exists today (checked against source 2026-09-22)

- **Output shape.** An agent step yields `result.json` — an untyped
  `Record<string, unknown>` in `AgentOutputEnvelopeSchema.result` — plus files
  committed on the run branch (`gitMetadata.changedFiles`). Agent steps have
  **no output schema**; only cowork steps carry `outputSchema`.
- **Trajectory.** The Claude Code plugin writes `tool_call` / `tool_result`
  JSONL to a host log file (`formatLogEntries` in
  `claude-code-agent-plugin.ts`). Not persisted in Postgres.
- **Prompt assembly.** `buildPrompt()` in `base-container-agent-plugin.ts`
  concatenates preamble → agent `systemPrompt` → SKILL.md → `prompt` → time
  budget → confidence instructions → workspace → input data → previous
  outputs. An eval-derived section (few-shot examples, guidance) slots in here.
- **Replay seed.** The run branch gets one commit per step, so the parent
  commit of a production step is the exact workspace that step saw. With
  `StepExecution.input` and previous step outputs, a production Agent Run is
  a complete Eval Case seed.
- **Autonomy.** `confidenceThreshold` gates escalation at runtime; nothing
  checks whether the agent's self-reported confidence is calibrated.
- **Run flags.** `dryRun` + `MockAgentPlugin` show the pattern for tagging a
  run as non-production.

## External landscape

| Tool | Take |
|---|---|
| promptfoo (MIT; OpenAI since 2026-03) | Borrow the assertion vocabulary (`is-json`+schema, `javascript`/`python`, `llm-rubric`, `g-eval`, `select-best`) and red-team plugin catalogue. Possible YAML import/export. |
| Inspect AI (UK AISI) | Copy the concepts — Task / Solver / Scorer, epochs, sandboxed scoring. It wants to own execution, so not the runtime. |
| DeepEval | Borrow G-Eval, DAG metric, tool-correctness patterns. |
| Braintrust / LangSmith | SaaS. Borrow the experiment-diff UX. |
| Phoenix | Already deployed; trace view of eval trials, Score overlay via span annotations. |
| Langfuse (MIT; ClickHouse since 2026-01) | Optional OTLP trace sink only — see [Langfuse](#langfuse). |
| GEPA / DSPy | Reflective prompt optimisation from traces (ICLR 2026). Engine for the automated fix loop, run as a container job. |
| EvalGen (UIST'24) | Generated checks must be calibrated against a few human-graded outputs; criteria drift while grading. |
| τ-bench | `pass^k` — all k trials succeed — as the reliability metric for autonomous steps. |
| Anthropic, *Demystifying evals for AI agents* (2026-01) | Grade outcome and end state first; the transcript explains why. |
| FDA AI credibility framework + FDA–EMA Good AI Practice (2026-01) | Credibility per **context of use**, rigour proportional to **model risk**. Drives acceptance-criteria design. |

## Proposed model

```
Evaluator        one rule: plain-language statement + executable check
  kind:      schema | code | llm_judge | reference | trajectory | human
  severity:  critical | major | minor
  status:    draft → calibrated → active
  origin:    user | assistant-suggested | generated-from-rule
Eval Case        input fixture + expectations
  input:     stepInput, previousStepOutputs, previousRun, workspaceSeed (commit | files)
  expect:    reference outputs / must pairs, must-NOT pairs (negative cases)
  source:    production | synthetic | manual;   split: dev | holdout
Eval Dataset     versioned, frozen set of Eval Cases for one step
Eval Run         step config × variants × dataset version × n trials
  trial      = an AgentRun tagged {evalRunId, caseId, variantId, trialIndex}
Score            one Evaluator × one trial (layer-2 schema + evaluatorId)
Step Qualification  config hash + evalRunId + acceptance criteria + decision + e-signature
```

## The Evaluation Assistant

Every capability below is delivered **through one Evaluation Assistant** per
Workflow Step — the agent the user works with from "what should I check?" to
"apply this fix". It reuses the workflow editor assistant's blocks (tool loop,
Zod tool registries, mutation-vs-platform tools, caller-scoped execution,
audit), extracted into a shared assistant core. Heavy work is platform tools —
`preview_evaluator` runs a draft check against the Step's existing outputs so
the assistant tests before it proposes. Reads run freely; Evaluators, cases,
criteria and fixes are proposals the user accepts; Eval Runs need a cost
confirmation; signing, approving check source and calibration labels stay
human. The user's priorities live in the Step's **Evaluation Brief**, which
the Step Qualification cites as its context of use.

## Capabilities

1. **Rule → check.** Plain-language rule; the Evaluation Assistant picks the cheapest
   reliable kind (code check in the `script-container` sandbox first, LLM judge
   only for subjective rules); the user reviews it and grades 5–10 outputs;
   agreement (rate, κ) gates `draft → active`.
2. **Input/output pairs, green and red.** Harvest approved L3 runs (green) and
   rejected ones (red; reviewer comment → must-NOT); synthesise perturbations
   (missing/extra file, renamed columns, edge values, injected instruction);
   manual entry. Code-producing steps get execution-based checks: run the
   script, compare output datasets to reference.
3. **Structured output.** New `outputSchema` on `WorkflowAgentConfig`:
   injected into the prompt, validated on `result.json`, one retry with the
   errors, and auto-registered as a critical `schema` Evaluator.
4. **Evaluation plan.** The Evaluation Assistant reads prompt, SKILL.md, agent
   `systemPrompt`, input/output descriptions, effective MCPs and
   `allowedTools`, upstream outputs, sample runs and the Evaluation Brief → a
   risk-ranked plan of Evaluators, cases and thresholds, as proposals the user
   accepts.
5. **Matrix runs and report.** Variants: model, prompt override, skill
   commit, tools/MCP restrictions; n trials each. Per Evaluator: pass rate +
   Wilson 95% CI, pass@k, pass^k, flakiness. Per variant: cost, tokens,
   duration, champion-vs-challenger diff, drill-down to output, files,
   trajectory. User-defined acceptance criteria → signed Step Qualification
   bound to a config hash; any config change marks it **stale**. Pre-run
   cost estimate and budget cap.
6. **Fixes.** The Evaluation Assistant clusters failures by root cause (ambiguous instruction,
   missing context, tool denied/missing, model capability, evaluator wrong);
   propose fixes — instruction diff, few-shot examples (`agent.examples`),
   deterministic guardrail, model swap, tool/MCP change, preprocessing step,
   lower Control Mode, evaluator fix. Each proposal runs as a variant against
   the failing cases, the dev set and a holdout set before the user applies
   it. Later: GEPA automates the loop.

Additional methods:

- **Trajectory evals** — required/forbidden tool calls, out-of-scope reads,
  wasted steps.
- **Confidence calibration** — self-reported confidence vs actual pass rate
  (reliability curve, ECE) → recommended `confidenceThreshold` and Control
  Mode.
- **Robustness / metamorphic tests** — semantics-preserving input changes
  must not change the result.
- **Safety / red-team** — prompt injection in input documents, PHI in
  outputs, MCP side effects.
- **Online evaluators** — cheap Evaluators run on production Agent Runs and
  write Scores; a critical failure triggers the existing fallback.
- **Drift** — rolling Score average drop (layer-2 note §2).
- **Side-effect isolation** — per-Eval-Run MCP policy (read-only, deny-write,
  recorded replay). A blocker: without it an eval trial can email or write to
  real systems.

## Langfuse

Since ADR-0007, Langfuse moved every feature (LLM-as-judge, annotation
queues, experiments) to MIT and was acquired by ClickHouse (2026-01, no
licence change announced). Neither changes the ADR-0007 call:

- **Integrate as an optional OTLP trace sink** — configuration, not code:
  point `OTEL_EXPORTER_OTLP_ENDPOINT` (or an OTel Collector exporter) at
  Langfuse's OTLP endpoint. Langfuse accepts OTLP over HTTP only; our exporter
  already speaks HTTP (Phoenix receives it the same way).
- **Optionally, one-way Score export** behind the same adapter as the Phoenix
  span-annotation sync, so a customer who already lives in Langfuse sees our
  Scores next to traces. Write-only; never read back.
- **Do not adopt** its datasets, experiments, evaluators or prompt
  management: its projects are not our namespaces, its score writes are not
  audited, its experiments cannot execute our container agents, and it would
  be a second system to qualify. Self-host remains ClickHouse + Redis + S3 +
  Postgres.

## Phasing

| Phase | Scope |
|---|---|
| 0 | ADR-0023; glossary terms in `CONTEXT.md` |
| 1a — Foundations | `outputSchema` on agent steps (prompt, validation, one retry, fallback); Agent Trajectory persistence; Score entity with automatic `human_verdict` Scores |
| 1b — Eval Runs + Evaluation Assistant | Shared assistant core extracted from the workflow assistant; Evaluation tab = Step view + assistant panel; Evaluation Brief; Evaluators (`schema`, `code`, `llm_judge`) with the trust gate; Eval Cases (production + manual) and Datasets; single-step eval Workflow Run with MCP eval policy; one variant × n trials; report with CI and pass^k; `mediforce eval` CLI. Assistant tools: reads, propose Evaluator / Eval Case, `preview_evaluator`, prepare Eval Run with cost, explain report |
| 2 — Assistant planning | Assistant tools: evaluation plan from Step config + Brief; rule → self-tested check; calibration help (choose outputs to label); case synthesis incl. negative cases |
| 3 — Qualification | Variant matrix, champion/challenger, Acceptance Criteria, signed Step Qualification citing the Brief, Fingerprint and staleness badge, confidence calibration. Assistant tools: propose criteria from risk, compare variants, recommend `confidenceThreshold` / Control Mode |
| 4 — Fix loop | Assistant tools: diagnose failure clusters, propose and run fix variants, per-request budget for unattended attempts; `agent.examples` with exclusion; production Evaluators |
| 5 | GEPA optimisation, MCP record/replay, red-team and robustness suites, drift alerts |
