---
status: accepted
audience: engineers
last_reviewed: 2026-11-03
---

# 0024 — Optimisation: Variants, Comparisons, and learning from reviewed runs

- **Status:** Accepted
- **Date:** 2026-10-01 (parked); rewritten and accepted 2026-11-03
- **Authors:** Krystian Zielinski (@Griphu), with Claude
- **Epic:** [#1650](https://github.com/Appsilon/mediforce/issues/1650)
- **Amends:** [ADR-0023](./0023-step-evaluation.md) D5 (variants come back, one
  per Eval Run) and D10 (a validation can rest on a run of the same
  Fingerprint); D12 (few-shot examples) and the GEPA amendment of D15 stay
  deferred (D9 below). Applies to an Agent's Evaluation as
  [ADR-0029](./0029-agent-evaluation.md) and
  [ADR-0031](./0031-agent-cases-from-workflow-runs.md) define it.
- **Code reference:** challengers, the champion–challenger comparison, applying
  a variant, few-shot examples and the GEPA job were built and then deleted;
  commit [`aa8ac636`](https://github.com/Appsilon/mediforce/tree/aa8ac636f773342f4fdbd90f5d9529ccdb92d651)
  holds them (`platform-core/src/evaluation/variant.ts`,
  `handlers/evaluation/apply-step-variant.ts`, `agent-runtime/src/plugins/gepa-job.ts`).
  Read that code, not this ADR's 2026-10-01 version, for how they worked.

## Context

An Evaluation answers *is this subject, in this configuration, fit for its
context of use?* It cannot answer the two questions authors ask next:

1. *What happens to quality and cost if I change the model, the prompt, the
   Skills?* Today an author edits the step, runs an Eval Run, edits again, runs
   again, and compares two reports by eye.
2. *My reviewers keep sending this step's output back — how do I make it stop?*
   A reviewed run already becomes Eval Cases (ADR-0023 D17: each round sent
   back a negative case with the reviewer's comment, the approved output a
   positive one), but one run at a time, and nothing turns those cases into a
   better configuration.

The 2026-10-01 version of this ADR parked an answer to the first: challengers
run inside the champion's Eval Run, compared on non-overlapping Wilson
intervals. It made one Eval Run hold several Fingerprints, gave the report and
the qualification a per-variant level, and crowded the qualification screen.
This rewrite keeps one Fingerprint per Eval Run and moves optimisation onto its
own sub-tab.

## Decisions

**D1 — Optimisation is part of an Evaluation, on its own sub-tab.** A Step's
and an Agent's Evaluation tab gains **Optimization** beside Eval Runs, Eval
Cases and Evaluators. Optimisation reuses the subject's Eval Cases, Eval
Datasets and Evaluators — it has none of its own. The Eval Runs sub-tab lists
runs of the subject as it is; a variant's run is shown only under its
Comparison, so a person qualifying a step never meets one.

**D2 — A Variant is a patch over the subject as it is.** It changes:

| | Step | Agent |
|---|---|---|
| `model` | replaces `step.agent.model` | replaces the Agent's `foundationModel` in the trial |
| `prompt` | replaces `step.agent.prompt` | replaces the Agent's `systemPrompt` in the trial |

Skills, allowed tools and MCP restrictions are added to the same patch later
(D9). A patch never mints a Workflow Definition version or an Agent version; an
empty patch is the **baseline**. A `~` moving-alias model is refused, as
ADR-0023 D5 refuses it for the step itself.

**D3 — A variant runs as an ordinary Eval Run.** The run records its patch
(`variant`), its Step Fingerprint is the Fingerprint of the patched step, and
each trial runs the patched Definition — a Step's through the same
`evalDefinition` an Agent's trial already carries (ADR-0029 D4). Everything
else — trials, Scores, report, Acceptance Criteria, judge reviews — is the
Eval Run's as ADR-0023 has it. A run with a patch is never the subject's
validation while the subject's Fingerprint differs from it, which the
Fingerprint already guarantees.

**D4 — A Comparison runs a baseline and its variants on the same ground.** One
Comparison holds a baseline Eval Run and one to four variant Eval Runs, all on
one Eval Dataset version, the same frozen Evaluator versions, trials per case,
MCP policy and Acceptance Criteria. It is prepared as a whole, its budget is the
sum of its runs' budgets, and a person confirms that sum once (ADR-0023 D15).
The baseline may reuse a finished Eval Run of the subject as it is when that
run has the same Fingerprint, dataset version and Evaluator versions, rather
than spend on it again.

**D5 — A difference is called on paired cases.** Every run of a Comparison
grades the same cases, so the report compares each variant with the baseline
case by case: per counted Evaluator, a case is a *win* when the variant's pass
rate over its trials is higher, a *loss* when lower, a *tie* otherwise.
`better` or `worse` is called only when a two-sided exact sign test over the
wins and losses gives p < 0.05; otherwise *no clear difference*. Beside it: each
run's pass rate with its Wilson 95% interval, mean cost per trial (agent and
judge apart), mean duration and tokens, and whether it met its Acceptance
Criteria. When the dataset has holdout cases the report reads holdout and dev
apart, and the recommendation reads holdout. This replaces the 2026-10-01 rule
of non-overlapping intervals, which on the 10–30 cases a step usually has
almost never calls a difference.

**D6 — Applying a variant is a person's act.** A Step's variant is saved as a
new Workflow Definition version through `registerWorkflow`, made the default
only when the person asks; an Agent's is saved to the Agent, which records a
new Agent version (ADR-0029 D2). Neither assistant applies one. When the
subject's Fingerprint after applying equals the variant run's, that run counts
as the subject's newest finished Eval Run for its validation — it ran exactly
that configuration — and can be signed as a Step Qualification. This amends
ADR-0023 D10, which read validation only from runs of the current Definition
version.

**D7 — Reviewed runs become Eval Cases in bulk.** A list of a subject's
reviewed production runs not yet a case — for an Agent, runs of the Steps that
used it (ADR-0031) — filtered by verdict, version and period, imports the
chosen ones with ADR-0023 D17's labelling. Imported cases are split into dev
and holdout, stratified by expectation, about 70/30, and a run round already
imported is skipped.

**D8 — The Evaluation Assistant guides optimisation from dev cases only.** It
gains, within ADR-0023 D14's one assistant:
- *Runs freely:* a **readiness** check (enough cases; negative cases and an
  `expected_output` Evaluator to grade them; a holdout split; a baseline run)
  and **feedback themes** — reviewer comments on dev cases grouped by what
  they correct, each theme citing its runs.
- *Proposes:* Variants — a model to try, or a prompt rewritten to address the
  themes and the dev failures.
- *Prepares, the person confirms the cost:* a Comparison (D4).
- *Never:* applies a Variant (D6).

What the assistant reads to write a prompt Variant — expected outputs,
reviewer comments, failing trials — comes from dev cases only; holdout cases
are what the Variant is judged on.

**D9 — Deferred.** Few-shot examples from cases (ADR-0023 D12), GEPA's
reflective search as a generator of prompt Variants (the D15 amendment, under
D8's dev-only rule), and Skill, tool and MCP Variants. The reference code is at
`aa8ac636`.

**D10 — Production review monitoring is separate.** Acceptance trends,
correction themes and reviewer statistics over a step's production runs are a
monitoring feature. They may link into optimisation ("optimise this step");
optimisation does not depend on them.

## Considered options

- **Challengers inside one Eval Run** (this ADR's 2026-10-01 version, built at
  `aa8ac636`). Rejected: one run with several Fingerprints needs a per-variant
  report, validation and qualification, and a winner's run could not back its
  own validation (D6).
- **Non-overlapping Wilson intervals as the test.** Rejected for D5: it ignores
  that the runs share cases and calls almost nothing on small datasets.
- **A top-level Optimization tab beside Evaluation.** Rejected: it would repeat
  the subject's cases and Evaluators, which optimisation only reads.
- **A section of a finished Eval Run's report.** Rejected: a Comparison spans
  several runs, and a person starts one before any run exists.
- **GEPA in the first release.** Deferred (D9): the assistant drafting a
  Variant answers the same need with no container job, and GEPA can come back
  as one more generator of Variants.

## Consequences

- `eval_runs` gains `variant` (the patch, null on a run of the subject as it is)
  and `comparison_id`; a new `eval_comparisons` table groups the runs.
  `eval_trials.variant_id` stays a legacy column.
- The Eval Runs list and the subject's validation leave out runs with a
  patch, except a run whose Fingerprint the subject now has (D6).
- An Agent's trial needs a way to run with another `systemPrompt` than the
  Agent's own; today the executor reads it from the Agent by `agentId`.
- CLI: `mediforce eval run-prepare --variant`, `mediforce eval compare`,
  `mediforce eval apply-variant`.
