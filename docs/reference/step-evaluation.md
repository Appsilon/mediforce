---
status: living
audience: workflow-authors
last_reviewed: 2026-09-24
---

# Step Evaluation

How an author checks that one agent Workflow Step can be trusted for its
context of use. The design and its reasons are
[ADR-0023](../adr/0023-step-evaluation.md); the vocabulary is `CONTEXT.md`
§ Evaluation domain. This page is what exists today (phase 1b).

Everything below belongs to one agent Step, keyed by
`(namespace, workflowName, stepId)`, and lives outside the Workflow
Definition: adding a check never mints a definition version. Reading needs only
access to the workflow; changing anything needs its `edit` verb, and
previewing checks or preparing, starting and cancelling Eval Runs its `run`
verb. A Step that still declares MCP servers inline on `agent.mcpServers`
cannot be evaluated — an eval policy cannot deny them, so move them onto its
agent first.

## The Evaluation Assistant

The **Evaluation** tab of a workflow shows one agent step at a time — its
Brief, Evaluators, Eval Cases, MCP eval policy and Eval Runs — beside the
Evaluation Assistant (`mediforce eval ask`, `POST /api/evaluation/assistant`).
Its authority is tiered ([ADR-0023](../adr/0023-step-evaluation.md) D15):

- **Runs freely:** reading the step (config, agent prompt, SKILL.md, MCP
  servers), its production runs and their trajectories, Evaluators, cases,
  Eval Runs and reports, and `preview_evaluator` — it tries a check on real
  outputs before proposing it.
- **Proposes:** Evaluators, Eval Cases and Brief drafts come back as cards to
  accept, edit or reject. Accepting one is the same write the forms make,
  recorded with `origin: assistant`.
- **Prepares:** it can prepare an Eval Run; the run starts only when the person
  confirms its budget on the card. Its own start attempt is refused.
- **Never:** approving a `code` check's source, labelling outputs, signing.
  There is no tool for these.

The step's Brief is sent to the assistant on every turn. In the web tab, Brief
text is rendered as GitHub-Flavored Markdown, and the assistant pane uses the
same model picker as the workflow editor so the model can be chosen per
conversation.

Each request allows 32 model/tool rounds and up to 8,000 output tokens per
model call. These application limits are separate from the model's context
window. Trajectories are read in pages of complete entries, including generated
source; the assistant follows `nextOffset` to reach later pages instead of
seeing only the beginning of a run. If the round or text-output limit is
reached, completed proposal and prepared-run cards still return with an
explicit notice and, when available, a summary of unfinished work. A follow-up
can use that summary, but the full tool transcript is not carried between
requests. Nothing is accepted or started automatically.

When a tool call fails validation, the assistant gets the exact error, the
expected argument schema and examples (a `check` is an object such as
`{"kind":"code","runtime":"python","source":"..."}`, never a string). Three
consecutive rounds that fail with the same validation error and no successful
call end the turn early with the cause named in the notice.
A single tool result the assistant reads — a trajectory page or a preview whose
check writes a long `comment` — is cut to 60,000 characters with a note to ask
for less, so one oversized result cannot exceed the model provider's request
limit.

## Evaluation Brief

A short text per Step — what it is for, who relies on its output, which
failures matter most. Every write is a new version. The web tab displays the
text as Markdown; the stored value remains the original text.
`mediforce eval brief-get|brief-set`, `GET|POST /api/evaluation/briefs`.

## Evaluators

One rule in plain language plus the check behind it. Three kinds:

| Kind | Check | Counts (D9) |
|---|---|---|
| `schema` | `result` against the JSON Schema subset `agent.outputSchema` uses | at once |
| `code` | a `python` or `javascript` script in the `script-container` sandbox (no network) | after a person approves that version's source |
| `llm_judge` | a model reads the rubric, reasons, then picks one of 2–6 choices, each worth 0–1 (≥ 0.5 passes) | after calibration: ≥ 10 human labels, ≥ 2 of them failures, agreement ≥ 0.8 |

A `code` check reads `/output/input.json` — `{ result, stepInput, trajectory,
case }` — and the step's workspace commit read-only at `/workspace`, and writes
`/output/result.json` as `{ "passed": boolean, "comment"?: string }`. A check
that crashes, or a judge that names no choice, is an *error*, never a failed
output.

Every change is a new immutable version; approval and calibration attach to one
version. A judge is calibrated against human labels: `evaluator-label
--pass|--fail` records a human Score on an Agent Run, `evaluator-calibrate`
runs the judge over the labelled runs and stores the agreement.

`evaluator-preview` (`POST /api/evaluation/evaluators/preview`) runs a draft
check against the Step's recent production outputs (dry runs left out) and
writes nothing — try a check on real outputs before saving it. It runs check
code and spends the workspace's model key, so it needs the workflow's `run`
verb.

## Eval Cases and Datasets

An Eval Case is one input for the Step — the trigger payload, the outputs of the
steps before it, and the workspace commit it starts from — plus whether its
output should be accepted (`positive`) or not (`negative`), with notes on what
it must or must not contain. `case-from-run <agentRunId>` harvests one from a
production run: an approved run is positive, a rejected one negative with the
reviewer's comment; a run nobody reviewed, or one sent back for revision or a
recheck, needs `--expectation`. Cases are `dev` or
`holdout`, carry a *contains production data* flag, and an `origin` — `user`,
or `assistant` for an accepted Evaluation Assistant proposal.

`dataset-freeze` freezes the live cases into a numbered Eval Dataset version.
A version never changes.

## MCP eval policy

Per MCP server of the Step's agent: `live`, `live` with named tools denied, or
`deny`. A server the policy does not name is denied in eval trials.
`mcp-policy-get` shows what each server does, defaults included.

## Eval Runs

An Eval Run runs the Step, as its runnable Definition version has it, over a
frozen Dataset version: every case, `trialsPerCase` times.

1. **Prepare** (`run-prepare`, `POST /api/evaluation/runs`) freezes the Dataset
   version (the newest unless named), the latest version of every live
   Evaluator — and whether each one counts — and the MCP eval policy, and
   estimates the cost: the Step's mean cost over its recent production runs, or
   its model's registry price for a nominal turn when it has none, plus one call
   per `llm_judge`. The budget cap defaults to 1.5× the estimate; with no
   estimate it must be given.
2. **Start** (`run-start --confirm-budget <usd>`) needs the budget echoed back —
   the person confirming what the run may spend. Without it the start is
   refused, which is also how an assistant's attempt to start one ends.
3. Each **trial** is a real Workflow Run flagged with the Eval Run's id. It
   enters the Step directly with the case's trigger payload and earlier step
   outputs, its workspace branched from the case's seed commit, and stops after
   the Step: no review task, no escalation, no next step. MCP servers the policy
   does not declare `live` are removed from the agent's config; a Step that
   declares MCP servers inline cannot be evaluated at all. Run lists, workflow
   summaries, monitoring, the Agents history and carry-over (`inputForNextRun`)
   leave trials out.
4. When a trial's run ends, every frozen Evaluator grades its Agent Run and
   writes a Score (`source: deterministic` or `llm_judge`, `metadata.evalRunId`).
   Trials start `concurrency` at a time; once spend reaches the budget the rest
   are skipped and the run ends `budget_exceeded`. A trial's cost is its Agent
   Run plus the LLM judge calls that graded it (at the model registry's price;
   a judge model it does not price is noted on the trial and not counted), each
   charged to the budget as it is spent; a judge Score keeps its cost in
   `metadata.judgeCostUsd`. **Cancel** skips the pending trials; the
   ones already running still finish and are scored. The heartbeat moves on
   every running Eval Run, and any cancelled one with trials in flight, so a
   restart does not strand one: a driver that died after claiming a trial —
   before creating its run, or mid-scoring — leaves a claim that another takes
   over once it is 15 minutes old, without re-running Evaluators that already
   scored the trial. A trial whose scoring was abandoned three times fails.

The **report** (`mediforce eval report <id>`, `GET /api/evaluation/runs/:id`)
is computed from those Scores. Per Evaluator: pass rate with its Wilson 95%
interval, pass@k (a case passes if any of its k trials does), pass^k (all of
them do), flakiness (its trials disagree), and checks that could not grade a
trial as errors. A trial that could not be graded, or failed before producing
an Agent Run, stays out of the pass rate but still counts toward its case's k,
so it can lower pass@k and pass^k, never lift them. Evaluators that do not
count are marked so. Tokens and duration come from the trials' runs; cost adds
the judge calls.
