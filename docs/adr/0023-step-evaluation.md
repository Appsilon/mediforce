---
status: proposed
audience: engineers
last_reviewed: 2026-09-22
---

# 0023 — Step Evaluation: Evaluators, single-step Eval Runs, Step Qualification

- **Status:** Proposed
- **Date:** 2026-09-22
- **Authors:** Krystian Zielinski (@Griphu), with Claude
- **Supersedes in part:** [ADR-0007](./0007-llm-evaluation-observability.md)
  § Deferred (the entity design for layers 2–4). ADR-0007 D1–D5 stay binding.
- **Research:** [`../research/step-evaluation.md`](../research/step-evaluation.md)
  (landscape, capabilities, phasing), building on
  [`../research/layer2-scores-research.md`](../research/layer2-scores-research.md).
- **Vocabulary:** Evaluation, Evaluator, Eval Case, Eval Dataset, Eval Run,
  Agent Trajectory, Step Fingerprint, Acceptance Criteria, Step Qualification
  — all in [`CONTEXT.md`](../../CONTEXT.md) § Evaluation domain.

## Context

ADR-0007 named four layers (Traces → Scores → Eval Datasets → Eval Runs),
shipped layer 1, and deferred the rest. Workflow authors now need to answer,
per agent Step: *can this Step, in this configuration, be trusted for its
context of use?* — and when not, be helped to fix it. Pharma framing sets the
bar: the FDA AI credibility framework and the FDA–EMA Good AI Practice
principles (2026-01) assess credibility per context of use, proportional to
model risk, against acceptance criteria set in advance.

## Decisions

**D1 — Vocabulary: Evaluation, not validation.** In pharma *validation* means
Computer System Validation of the platform. The activity is Evaluation, a rule
is an Evaluator, the signed outcome is a Step Qualification.

**D2 — Evaluators and Eval Datasets are platform entities owned by one Step.**
Keyed by `(namespace, workflow name, stepId)`, outside the immutable Workflow
Definition, so adding a check never mints a Definition version. Exportable to
an `evals/` folder of the workflow package (ADR-0013). Reuse is by copy —
from another Step or from a namespace template library — never by reference,
so an edit elsewhere cannot change what an existing qualification means.

**D3 — Own grader layer; no eval framework as a runtime dependency.** No
framework can execute our subject (a container agent with workspace, MCPs and
skills), and one as system of record contradicts ADR-0007 D2. We borrow
promptfoo's assertion vocabulary, Inspect AI's task/scorer/epoch model, and
EvalGen's calibration loop. `code` Evaluators run in the existing
`script-container` sandbox; `llm_judge` builds on `ReviewPlugin` +
OpenRouter, as the layer-2 research recommends.

**D4 — An eval trial is a real single-step Workflow Run.** Each trial is a
`ProcessInstance` flagged with its `evalRunId`, entering the target Step
directly with the Eval Case's input, previous step outputs and workspace seed
(a commit on the workflow's bare repo), and stopping after it. It reuses the
engine, executors, `AgentRun`, tracing, cost and audit unchanged. What was
evaluated is what runs in production — the credibility argument depends on
it. Monitoring, run lists and Agents history exclude eval trials by default,
the way they filter `dryRun`.

**D5 — Variants are override patches; trust binds to the Step Fingerprint.**
A variant (model, prompt, skill commit, tools, examples) is a patch applied to
the target Step at trial time over a pinned Definition version. A Step
Qualification binds to the **Step Fingerprint** — a hash of the patched Step
config, the SKILL.md content, the Agent's `systemPrompt`, the image digest,
the effective MCP set, `outputSchema` and the workflow preamble — not to a
Definition version. Applying a winning variant creates a Definition version as
usual; if the Step's Fingerprint matches, the qualification carries over.
Editing Step B never touches Step A.

**D6 — Default-deny eval policy for MCP servers.** Each MCP server a Step can
use carries an eval policy: `live`, `deny`, or `live` with named tools denied.
Undeclared servers are denied in trials. The policy applies as extra
subtractive `mcpRestrictions`. It is **not** part of the Fingerprint; the Eval
Run report and the Step Qualification state it ("qualified with `edc-write`
denied"). Record/replay of MCP responses is a later phase. Container network
egress is out of scope — trials inherit production's.

**D7 — Evaluators are versioned; a version that produced a Score is
immutable.** Eval Runs record the Evaluator versions used; a Step
Qualification cites them. A newer Evaluator version flags the qualification
("evaluators changed since qualification") without making it stale.

**D8 — Agent Trajectories are persisted for every Agent Run.** The tool-call
record the plugins already produce (today a host temp file) becomes a durable
platform artifact keyed by `agentRunId`. Content follows ADR-0007 D5: with
capture off, only shape is kept (tool names, redacted or truncated arguments,
result sizes). Eval trials capture full content unless the Eval Dataset is
flagged as containing production data, in which case the deployment setting
applies.

**D9 — Only trusted Evaluators count toward Acceptance Criteria.**
`schema` is active on creation. `code` needs a recorded human approval of its
source, whoever wrote it. `llm_judge` needs agreement above a set level with
at least 10 human-labelled outputs, at least 2 of them failures, per version.
`human` is ground truth. Draft Evaluators appear in reports as "not counted".

**D10 — Acceptance Criteria are fixed before the run and judged on interval
bounds.** Criteria per severity (critical / major / minor) are frozen into the
Eval Run. The report judges pass rates by their Wilson 95% lower bound and
reliability by pass^k. A human signs the Step Qualification; signing despite a
missed criterion records a deviation with a written justification.

**D11 — Step Qualification is informational.** A badge (Qualified / Stale /
Not qualified) on the Step and in run views. Nothing is blocked: no Control
Mode is refused and no run is downgraded when a qualification is missing or
stale. ADR-0007 D2's example of a model swap "gated on a green Eval Run" is
therefore **not** adopted; a swap shows as Stale.

**D12 — Few-shot examples are a structured, provenance-tracked field.**
`agent.examples` holds `{input, output, note?}` pairs rendered as their own
prompt section and included in the Fingerprint. Each records the Eval Case it
came from; that case is excluded from scoring in later Eval Runs of the Step.
Holdout cases are never offered as examples.

**D13 — Production Evaluators are opt-in; only deterministic ones gate.** An
Evaluator marked "also run in production" scores live Agent Runs. `schema` and
`code` run synchronously; a failing critical one triggers the Step's existing
`fallbackBehavior`, as low confidence does. `llm_judge` runs asynchronously and
only writes Scores. Human verdicts on CM3 reviews become Scores automatically.
`outputSchema` violations, after one retry with the errors, follow the same
fallback route.

## Considered options

- **An eval framework as the runtime (promptfoo, Inspect AI, DeepEval).**
  Rejected by D3: none executes our container agents, Inspect and DeepEval are
  Python, and each would be a second system of record.
- **Driving `AgentRunner` directly for trials.** Avoids the engine but forks
  the execution path; the evaluated path would no longer be the production
  one. Rejected by D4.
- **Each variant as a real Definition version; qualification bound to the
  Definition version.** Floods version history, and any edit to any Step
  would stale every Step's qualification. Rejected by D5.
- **Enforcing qualification** (refusing CM4 or downgrading to CM3 when stale).
  Considered as an opt-in namespace policy; rejected for now by D11. Revisit
  when a customer asks for it — the Fingerprint makes it a small change.
- **Trajectories read from the trace store.** Content is off in production by
  default and the store may not exist. Rejected by D8.

## Consequences

- New engine capability: start a Workflow Run at a named Step with seeded
  state and no transitions. `createRunWorkspace` gains a starting commit.
- New `outputSchema` on `WorkflowAgentConfig`, mirroring cowork steps.
- Langfuse stays what ADR-0007 D3 made it: an optional OTLP trace sink, plus
  an optional one-way Score export beside the Phoenix sync. Its datasets,
  experiments and judges are not adopted.
- Eval Runs multiply container runs (cases × variants × trials); a pre-run
  cost estimate from model-registry pricing and a budget cap are part of the
  Eval Run, not an afterthought.
- Delivery is phased (1a foundations → 1b Eval Runs → 2 assistant → 3
  qualification → 4 fix loop → 5 optimisation and red-team), tracked in the
  Step Evaluation epic [#1394](https://github.com/Appsilon/mediforce/issues/1394).
