---
status: living
audience: workflow-authors
last_reviewed: 2026-09-23
---

# Step Evaluation

How an author checks that one agent Workflow Step can be trusted for its
context of use. The design and its reasons are
[ADR-0023](../adr/0023-step-evaluation.md); the vocabulary is `CONTEXT.md`
§ Evaluation domain. This page is what exists today (phase 1b).

Everything below belongs to one agent Step, keyed by
`(namespace, workflowName, stepId)`, and lives outside the Workflow
Definition: adding a check never mints a definition version. Reading needs only
access to the workflow; changing anything needs its `edit` verb.

## Evaluation Brief

A short text per Step — what it is for, who relies on its output, which
failures matter most. Every write is a new version.
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
check against the Step's recent production outputs and writes nothing — try a
check on real outputs before saving it.

## Eval Cases and Datasets

An Eval Case is one input for the Step — the trigger payload, the outputs of the
steps before it, and the workspace commit it starts from — plus whether its
output should be accepted (`positive`) or not (`negative`), with notes on what
it must or must not contain. `case-from-run <agentRunId>` harvests one from a
production run: an approved run is positive, a rejected one negative with the
reviewer's comment; an unreviewed run needs `--expectation`. Cases are `dev` or
`holdout` and carry a *contains production data* flag.

`dataset-freeze` freezes the live cases into a numbered Eval Dataset version.
A version never changes.

## MCP eval policy

Per MCP server of the Step's agent: `live`, `live` with named tools denied, or
`deny`. A server the policy does not name is denied in eval trials.
`mcp-policy-get` shows what each server does, defaults included.
