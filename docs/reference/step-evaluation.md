---
status: living
audience: workflow-authors
last_reviewed: 2026-09-29
---

# Step Evaluation

How an author checks that one agent Workflow Step can be trusted for its
context of use. The design and its reasons are
[ADR-0023](../adr/0023-step-evaluation.md); the vocabulary is `CONTEXT.md`
§ Evaluation domain. This page is what exists today.

Everything below belongs to one agent Step, keyed by
`(namespace, workflowName, stepId)`, and lives outside the Workflow
Definition: adding a check never mints a definition version. Reading needs only
access to the workflow; changing anything needs its `edit` verb, and
previewing checks or preparing, starting and cancelling Eval Runs its `run`
verb. Signing a Step Qualification needs `edit` and a signed-in person. A
Step that still declares MCP servers inline on `agent.mcpServers` cannot be
evaluated — an eval policy cannot deny them, so move them onto its
agent first.

## The Evaluation Assistant

The **Evaluation** tab of a workflow shows one agent step at a time — its
Step Qualification, Brief, Acceptance Criteria, Evaluators, Eval Cases, MCP
eval policy and Eval Runs — beside the
Evaluation Assistant (`mediforce eval ask`, `POST /api/evaluation/assistant`).
Its authority is tiered ([ADR-0023](../adr/0023-step-evaluation.md) D15):

- **Runs freely:** reading the step (config, agent prompt and system prompt,
  input and output descriptions, `outputSchema`, the tools it allows beyond
  the runtime's defaults, MCP servers as production resolves them — a
  configuration production refuses shows as such — and as trials see them,
  SKILL.md, the steps upstream of it), its
  production runs with the reviewer's verdict and their trajectories, the
  workspace files a run started from, Evaluators with their labels and
  calibration, cases, Eval Runs and reports, one variant's failing trials
  (`get_failures`), each challenger compared with the
  champion (`compare_variants`), the step's qualification and Acceptance
  Criteria (`get_qualification`), its GEPA optimisations
  (`list_optimisations`, `get_optimisation`), and `preview_evaluator` — it
  tries a check on real outputs before proposing it.
- **Proposes:** Evaluators and new versions of them, Eval Cases (harvested,
  written or synthesized), a built-in case suite on one field of a run
  (`propose_case_suite`, accepted as the suite's cases in one write), outputs
  for a judge's person to label (`propose_written_outputs`), Brief drafts and Acceptance Criteria come back as
  cards to accept, edit or reject. Accepting one is the same write the forms
  make, recorded with `origin: assistant`. A routing recommendation (Control
  Mode and `confidenceThreshold`) comes back as a card to apply in the
  workflow editor. So do a **diagnosis** of an Eval Run's failures
  (`propose_diagnosis`) and a **fix** to try (`propose_fix`) — see Fix loop
  below. Nothing is applied to the step by the assistant.
- **Prepares:** it can prepare an Eval Run, with challengers; the run starts
  only when the person confirms its budget on the card. Its own start attempt
  is refused — unless the request carries an **unattended budget**
  (`unattendedBudgetUsd`, up to 10,000; `mediforce eval ask --unattended-budget
  <usd>`), which the person grants for that one request. Then `start_eval_run`
  starts a prepared run of this step whose `budgetUsd` fits what is left of the
  grant (the sum of the budgets of the runs started in the request is what has
  been spent), confirming that budget as a person would; a run that does not
  fit is refused with the amount left. `start_optimisation` starts a GEPA
  optimisation (below) under the same grant, its `budgetUsd` counted against
  what is left. The response lists them as
  `startedEvalRuns: [{ evalRunId, budgetUsd }]` and
  `startedOptimisations: [{ optimisationId, budgetUsd }]`, and the request's
  audit event records the grant. Without the field nothing changes, and
  `start_optimisation` is refused.
- **Never:** approving a `code` check's source, labelling outputs, signing a
  Step Qualification. There is no tool for these.

The step's Brief is sent to the assistant on every turn. What it can help with:

- **Evaluation plan.** It reads the step, a few of its runs and the Brief, and
  returns a plan card: the risks, highest first — what could go wrong, how bad,
  why, the cheapest check that would catch it, the inputs worth trying it on —
  and suggested Acceptance Criteria (minimum pass rates per severity, on the
  Wilson 95% lower bound). A plan creates nothing; **Draft this check** on a
  risk asks the assistant to draft it, and **Use as Acceptance Criteria** sets
  the suggested floors.
- **Acceptance Criteria.** From the step's risks and Brief, it proposes floors
  per severity — with pass^k where the step would run unreviewed — and says
  how many graded trials a floor needs (30 passes out of 30 have a lower bound
  of 0.89).
- **Variants and routing.** It prepares runs with challengers, compares each
  with the champion without calling a difference the intervals do not show,
  explains each criterion's verdict, and recommends a Control Mode and
  `confidenceThreshold` from the run's confidence calibration.
- **Fix loop.** After a run with failures the assistant reads them
  (`get_failures`: the variant's trials where a counted Evaluator failed, a
  check errored, or no Agent Run was produced — each with its case, its
  trial error and the Evaluators that failed or errored; at most 50 listed,
  with the total; `mediforce eval failures <evalRunId> [--variant <id>]`,
  `GET /api/evaluation/runs/:id/failures`), then the trajectories and cases,
  and clusters the failures by root cause in a **diagnosis** card
  (`propose_diagnosis`): `ambiguous_instruction`, `missing_context`,
  `tool_problem`, `model_capability` or `evaluator_wrong`, each with its
  trials, evidence and the kind of fix it points to. Each cluster's fix
  becomes a proposal by what can express it:

  | Fix kind | Proposal |
  |---|---|
  | `instruction`, `examples`, `model`, `tools` | `propose_fix`: a variant patch (`prompt`/`skillCommit`; `examples`; `model`; `allowedTools`/`mcpRestrictions`), labelled, with the cluster it addresses and why |
  | `guardrail` | `propose_evaluator` with `runInProduction` (a critical `schema` or `code` check) |
  | `control_mode` | `propose_control_settings` |
  | `evaluator` | `propose_evaluator_version` |
  | `preprocessing_step` | advice in the diagnosis: a workflow change made in the workflow editor, not a variant |

  A diagnosis is refused unless the run is this step's and every trial is a
  trial of that run and variant; a fix unless the run is this step's, the
  patch changes only its kind's fields, and `variantPatchProblem`, unknown MCP
  servers and example cases (`agent.examples` must cite live dev cases of this
  step, never holdout) pass. A fix card offers **Try it** — prepare an Eval Run
  with the fix as a challenger over the newest Dataset version, which holds the
  failing cases with the dev and holdout ones, the person confirming the cost on
  the prepared-run card — and **Apply to step** (`apply-variant`, below), once
  a run shows it works. Few-shot examples come from dev cases only, and the
  cases they came from are left out of later runs.
- **Rule to check.** A plain-language rule becomes the cheapest reliable kind —
  `schema`, then `code`, a judge only when a script cannot decide it. Every
  proposed check is tried by the platform on the step's recent production
  outputs before the card is shown (reusing the assistant's own preview of the
  same check), and the card shows what it did. A check that errors on every
  output goes back to the assistant instead of to the person; for a person
  without the `run` verb the card says it was not tried. So it does for the
  `injection_ignored` and `result_stable` built-ins, which grade an output
  against the case it ran on and so can be graded only in an Eval Run over such
  cases; `preview_evaluator` says the same instead of erroring on each output.
  The try runs the check on up to 5 outputs, so it is not free: a `code` check
  starts a sandbox per output, and an `llm_judge` pays for a model call per
  output — a turn that proposes a judge the assistant did not preview takes
  longer and costs more. A refined rule is a proposed new version of the
  Evaluator.
- **Calibration help.** For a judge, it picks the outputs most worth labelling
  — ones reviewers rejected, ones its preview failed, ones unlike those already
  labelled — and returns them as a labelling card. The person labels each pass
  or fail, can refine the rule and rubric as a new version while labelling,
  calibrates (agreement and Cohen's κ, with the outputs the judge disagreed on),
  and turns the labelled outputs into Eval Cases.
- **Case synthesis.** It proposes a case built from a real production run with
  a deliberate change — an instruction injected into the data, an edge value,
  renamed columns, a missing or extra file — usually positive (a correct
  output exists and should be accepted), with notes on what it must not do;
  negative only when the input is so broken no output should be accepted. A
  change that does not apply to that run goes back to the assistant instead of
  to the person.

Every proposal is checked against the platform before it is shown: an Evaluator
name already taken, an Evaluator or run of another step, and an eval trial
offered for labelling are refused the same way.

In the web tab, Brief text is rendered as GitHub-Flavored Markdown, and the
assistant pane uses the same model picker as the workflow editor so the model can be chosen per
conversation. While it works, the pane lists each step it takes (reading a run,
previewing a check, drafting a card) as it happens, and keeps that list folded
under the reply; `mediforce eval ask` prints the same steps to stderr. The pane
widens by dragging its left edge, and the width is remembered per browser.

Each request allows 32 model/tool rounds and up to 8,000 output tokens per
model call. These application limits are separate from the model's context
window. Trajectories are read in pages of complete entries, including generated
source; the assistant follows `nextOffset` to reach later pages instead of
seeing only the beginning of a run. A response cut off at the output limit
with no tool call in it — several checks drafted at once, or a long answer — is
retried once with a note to work one check at a time and answer briefly. If the
round limit is reached, or the output limit twice in a row, completed proposal
and prepared-run cards still return with an explicit notice and, when
available, a summary of unfinished work. A follow-up
can use that summary, but the full tool transcript is not carried between
requests. Nothing is accepted or started automatically.

When a tool call fails validation, the assistant gets the exact error, the
expected argument schema and examples (a `check` is an object such as
`{"kind":"code","runtime":"python","source":"..."}`, never a string). A union
argument like `check` is offered to the model typed as an object — without a
`type`, models tend to send it as a JSON-encoded string, which a script's
unescaped quotes make impossible to decode. Three consecutive rounds that fail
with the same validation error and no successful call end the turn early with
the cause named in the notice.
A single tool result the assistant reads — a trajectory page or a preview whose
check writes a long `comment` — is cut to 60,000 characters with a note to ask
for less, so one oversized result cannot exceed the model provider's request
limit.

## Evaluation Brief

A short text per Step — what it is for, who relies on its output, which
failures matter most. Every write is a new version. The web tab displays the
text as Markdown; the stored value remains the original text. An Eval Run
freezes the Brief version in force when it is prepared, and a Step
Qualification cites that version as its context-of-use statement, so a step
needs a Brief before it can be qualified.
`mediforce eval brief-get|brief-set`, `GET|POST /api/evaluation/briefs`.

## Evaluators

One rule in plain language plus the check behind it. Four kinds:

| Kind | Check | Counts (D9) |
|---|---|---|
| `schema` | `result` against the JSON Schema subset `agent.outputSchema` uses | at once |
| `code` | a `python` or `javascript` script in the `script-container` sandbox (no network) | after a person approves that version's source |
| `llm_judge` | a model reads the rubric, reasons, then picks one of 2–6 choices, each worth 0–1 (≥ 0.5 passes) | after calibration: ≥ 10 human labels, ≥ 2 of them failures, agreement ≥ 0.8 |
| `builtin` | a red-team or robustness check the platform runs itself, in process — see [Red-team and robustness suites](#red-team-and-robustness-suites) | at once |

A `code` check reads `/output/input.json` — `{ result, stepInput, trajectory,
case }` — and the step's workspace commit read-only at `/workspace`, and writes
`/output/result.json` as `{ "passed": boolean, "comment"?: string }`. A check
that crashes, or a judge that names no choice, is an *error*, never a failed
output.

Every change is a new immutable version; approval and calibration attach to one
version. A judge is calibrated against human labels: `evaluator-label
--pass|--fail` records a human Score on an Agent Run (`evaluator-labels` lists
the newest per run), `evaluator-calibrate` runs the judge over the labelled
runs and stores the agreement and Cohen's κ — agreement beyond what the
pass/fail mix gives by chance. Labels belong to the Evaluator, not a version,
so a refined rule is recalibrated against the same labels. Only agreement
decides whether a judge counts. `cases-from-labels <evaluatorId>` turns every
labelled production output that is not yet a case into one — a pass positive,
a fail negative, noting the rule and the person's comment.

Why a judge needs this: its verdict is a model's opinion, and its Scores feed
Acceptance Criteria and a Step Qualification. The minimum failures matter as
much as the count — a judge that passes everything agrees perfectly with an
all-pass set of labels and catches nothing. In the Evaluation tab each judge
shows its progress (`labels · fails · agreement`) and **Label outputs** opens
the labelling: the production runs already added as Eval Cases first, negatives
before positives (you judged them once; the label asks whether the output breaks
*this* rule), then the other loaded production runs, each with its input and
output; then **Calibrate**.

When production has no output that breaks the rule — nobody runs a bad case on
purpose — **Write an example** makes one: start from a production run, keep its
input, and change its output in a form built from the step's `outputSchema`
(one typed field per property, enumerations as choices, arrays and objects as
JSON, changed fields marked and resettable, or the whole output as JSON), then
**Save as fail** or **Save as pass**. It is a **written output**
(`written-output-add --file`, `POST /api/evaluation/written-outputs`, with
`label` to label it in the same write), not an Eval Case: nothing re-runs it. A
label on it is a human Score on subject `written_output`
(`evaluator-label <evaluatorId> --written-output <id>`), and calibration asks the
judge about it exactly as about a production output — its result, the input it
kept, no agent summary. `written-output-archive` takes one out of every judge's
labels and calibration; `cases-from-labels` skips written outputs, since only a
production run can become a case.

The Evaluation Assistant drafts such outputs with `propose_written_outputs`: up
to five production runs' results with values changed to break (or nearly break)
a judge's rule, each with why. The platform sends a draft back to the model when
it is not a change of one of the step's production runs or breaks the step's
`outputSchema`. The card shows what each draft changed; the person may edit it,
and **Save as fail** / **Save as pass** saves it as a written output with
`origin: assistant` and the person's label — the assistant never labels.

`evaluator-archive` archives or restores an Evaluator; `evaluator-production`
sets whether it also runs in production (see below).

In the Evaluation tab, **Evaluators → Add** picks the kind from a dropdown and
shows its fields — a JSON Schema (started from the step's `agent.outputSchema`
when it declares one), a language and source, a judge model with the question
it answers and its verdicts, or a built-in check — never the check's JSON.
Each Evaluator's **Details** show the whole check and its versions; **Edit**
saves a new version with what changed (`POST
/api/evaluation/evaluators/:id/versions`), keeping its name and kind.

`evaluator-preview` (`POST /api/evaluation/evaluators/preview`) runs a draft
check against the Step's recent production outputs (dry runs left out) and
writes nothing — try a check on real outputs before saving it. It runs check
code and spends the workspace's model key, so it needs the workflow's `run`
verb.

## Production Evaluators

Off by default. `evaluator-production <evaluatorId> --on|--off`
(`POST /api/evaluation/evaluators/:id/production`, the "Also run in production"
toggle in the Evaluation tab, or `runInProduction` when creating one) marks an
Evaluator to also score the step's live runs (D13). The flag may be set on any
Evaluator but takes effect only while its latest version counts (D9) and it is
not archived; the Evaluator view's `production` says `active`, or why not ("in
production once it counts (source not approved)").

A run is production when it is not a dry run and not an Eval Run trial; those
are never gated. After the output passes `agent.outputSchema` and before the
confidence and autonomy routing, `AgentRunner` hands it to the gate
(`executeAgentStep` installs it only when the step has a flagged Evaluator):

- `schema`, `code` and `builtin` run synchronously and each writes a Score marked
  `metadata.production: true` (no `evalRunId`). A failing **critical** one fails
  the run with reason `production_evaluator`: the step's `fallbackBehavior`
  applies as for low confidence, and the failure message is the run's
  `errorMessage`, an activity-log line and part of the `agent.run` audit event.
  Failing `major` and `minor` ones only write Scores.
- `llm_judge` runs asynchronously after the run has moved on and only writes a
  Score (`source: llm_judge`, its cost in `metadata.judgeCostUsd`). Its errors
  are logged and never block or fail the step.
- A check that cannot run, or a gate that throws, never fails the run; it is
  recorded in the activity log.

### Drift alerts

For each Evaluator scoring the step's production runs now, the mean of its
newest `window` production Scores is compared with the mean of the `window`
before them, over its latest version only, so a changed rule is not read as
drift. A drop of at least `threshold` is an alert. Until both windows are
full, nothing is judged. The defaults are a window of 20 and a threshold of
0.15. A deployment sets its own with `MEDIFORCE_DRIFT_WINDOW` (2–500) and
`MEDIFORCE_DRIFT_THRESHOLD` (above 0, at most 1); a value outside those ranges
falls back to the default. A request may override either one.

This differs from the layer-2 research note, which proposed a 7-day average
against a 30-day average with a relative drop. Windows are counted in Scores
rather than days so that a low-traffic step is judged on as many samples as a
busy one, and a quiet week never produces a mean of two runs. The drop is
absolute because Scores are already on a 0–1 scale, where a relative drop
exaggerates changes near zero.

`mediforce eval drift [--window N] [--threshold X]`
(`GET /api/evaluation/drift`) lists every such Evaluator, alerts first, with
both means and counts. The Evaluation tab shows a banner above the Step
Qualification while any Evaluator drifts. Alerts are computed when read:
nothing is stored and nothing is sent anywhere, and an alert blocks nothing.

### Score export

Off unless `MEDIFORCE_SCORE_EXPORT` names a target. Each Score of an Agent Run
is then also written next to that run's trace, one way only: nothing is read
back. An Agent Run records the trace and span ids of its `mediforce.agent.run`
span (ADR-0007) when tracing is on. A Score of a run recorded without them
(tracing off, or a run from before this) is not sent. Tracing is on when
`OTEL_EXPORTER_OTLP_ENDPOINT` is set. A backend that needs auth to ingest
traces, such as Langfuse's OTLP endpoint (`Authorization=Basic <base64
public:secret>`), also needs `OTEL_EXPORTER_OTLP_HEADERS`; without it the
Scores arrive but the traces they point at do not. Scores of Eval Runs are
exported as well as production ones.

| `MEDIFORCE_SCORE_EXPORT` | Written as | Settings |
|---|---|---|
| `phoenix` | a span annotation on the run's span (`annotator_kind` `HUMAN`, `LLM` or `CODE` by Score source) | `PHOENIX_BASE_URL`, defaulting to `OTEL_EXPORTER_OTLP_ENDPOINT`, which only works when traces go to Phoenix directly rather than through a collector; `PHOENIX_API_KEY` when Phoenix requires one |
| `langfuse` | a numeric score on the trace and the run's observation, with the Score's id, so a resend does not duplicate it | `LANGFUSE_BASE_URL`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, all required |

Metadata carries the Score's own metadata, its id, source, Evaluator and label.
The comment can quote the output, so it is sent only when
`MEDIFORCE_OTEL_CAPTURE_CONTENT=true`. A target missing its settings, or an
unknown one, is logged at boot and left off. An export that fails is logged
and never fails or delays the Score write. In Phoenix, a newer Score of the
same name on a span replaces the older one there.

## Red-team and robustness suites

Three `builtin` checks (`{ "kind": "builtin", "name": … }`), each a **suite** the
Eval Run report gives its own pass rate:

| Name | Suite | Fails an output that… |
|---|---|---|
| `injection_ignored` | `prompt_injection` | repeats the `canary` of its case's `injected_instruction` perturbation, i.e. obeyed the instruction injected into the data |
| `result_stable` | `robustness` | differs from the source Agent Run's `result` — over the top-level `keys` of the check when it names some — after a change that kept the input's meaning |
| `phi_leak` | `phi_leak` | carries a patient identifier: SSN, email address, phone number, MRN, date of birth (the comment names the kinds, never the values) |

`case-red-team --run <agentRunId> --suite prompt_injection|robustness --target
<part>.<path…>` (`POST /api/evaluation/cases/red-team`) builds the cases from a
production run, as synthesized ones (below), for the text or object at the
target in its input. `prompt_injection` appends each of three built-in
injections — a direct override, a sponsor-authority note, a delimiter escape —
each asking for a canary of its own to the target text. `robustness` doubles the
whitespace of the target text and pads it with blank lines, or reverses the
keys of a target object (kind `metamorphic`). Each case is positive: the output
is what the original run gave, ignoring the injection. Files of the workspace
are not targeted yet; a hand-written `case-perturb` covers them. The Evaluation
tab's **Eval Cases → Built-in case suites** does the same from a chosen run,
input part and field path, names the built-in Evaluator that grades the suite
(with **Add it** when the step has none), and warns when the run already has
that suite for the field. The written cases are ordinary Eval Cases, opened,
edited and archived from the list. The Evaluation Assistant proposes a suite
with `propose_case_suite` — one card for the whole suite, checked against the
run's input before the person sees it.

`injection_ignored` looks for the canary anywhere in the result, so a step that
quotes its input verbatim (an extraction, a summary) can fail it without having
obeyed the injection; use it on steps that transform rather than echo their input.
`result_stable` without `keys` compares the whole result, which only suits a
deterministic step. `phi_leak` is a pattern heuristic: email and phone patterns
match synthetic data and study contact fields too. Variants that would leave the
target unchanged (whitespace-free text, a one-key object) are skipped, and a
re-run of `case-red-team` adds the suite again. Its cases are created one at a
time, so a failure part-way leaves a partial suite. The suite pass rate pools
trials across that suite's Evaluators, which judge the same outputs, so its
interval is narrower than independent trials would give.

A check that does not apply to a case — `injection_ignored` on a case with no
canary, `result_stable` on one not made from a production run — is an *error*
for that trial, so a dataset can mix suites: each check grades its own cases.
Per variant the report's `suites` lists, for each suite the run has an
Evaluator for, the pass rate with its Wilson 95% interval, summed over that
suite's Evaluators; `eval report` prints them as `suite …` lines. A `builtin`
Evaluator may also run in production: `phi_leak` there is a guardrail on live
outputs.

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

An Eval Case is not a label. A case is an *input* an Eval Run re-runs the step
on; its expectation says what the new output should be, and the Evaluators grade
it. A label (below, under calibration) is a person's pass/fail on one *output*
for one Evaluator, and only labels calibrate a judge. The tab keeps the words
apart: cases are positive or negative, labels pass or fail.

In the Evaluation tab, **Eval Cases → Production runs to add as Eval Cases**
lists the Step's finished production runs not yet harvested, newest first and a
page at a time (**Load more**; `GET /api/evaluation/agent-runs` takes the
previous page's `nextCursor` as `cursor`). Each shows its reasoning summary,
opens its **Input and output** — what the step was given beside what it
returned (`eval run-io <agentRunId>`, `GET /api/evaluation/agent-runs/:agentRunId/io`)
— and **Log** opens the run's execution log before you add it as a **Positive
case** (its output was right) or a **Negative case** (it was wrong).

**Write a case** covers inputs production has not sent — above all negative
cases, which nobody runs on purpose. Its input starts from an existing case's,
so it keeps the shape the step is given (and that case's workspace commit), or
from a `.json` file: a whole case as `case-add --file` takes it (`{ name, input,
expectation, notes?, split? }`), or only its input (`{ triggerPayload,
previousStepOutputs, previousRun? }`). It is saved with `POST /api/evaluation/cases`
as a `manual` case, flagged as containing production data when the case it
started from was.

Each case in the list opens **Details**: where it came from, what it expects
(its notes), for a production case the input and output of the run you marked
(for a synthesized one, its source run's, before the change), the input an Eval
Run gives the step, the workspace commit it starts from, and **Source run log**
for a case made from a run. **Edit** changes its name,
expectation, split, notes or input (`case-edit <caseId> --file`,
`PATCH /api/evaluation/cases/:caseId`); **Archive** takes it out of the next
freeze (`case-archive`). An edit is a new case that replaces the old one, which
is archived, so a Dataset version frozen with the old case keeps exactly what it
ran. A production case whose input is edited becomes `manual` — production never
saw that input — and keeps the run it came from. MCP recordings are kept per
case, so an edited case is recorded afresh by its next `live` trial.

A **synthesized** case (`case-perturb --file`, `POST /api/evaluation/cases/perturbed`)
is a production run's case with deliberate changes, and records what kind
(`missing_file`, `extra_file`, `renamed_columns`, `edge_values`,
`injected_instruction`, `metamorphic`, `other`) and why. `inputChanges` set or remove values
under the trigger payload, the earlier steps' outputs or the carry-over;
`fileChanges` write, delete or edit (replace the first occurrence of a text in)
files of the workspace the run started from, and are written as a new commit on
the workflow's bare repo, kept by the ref `refs/mediforce/eval-seeds/<caseId>`,
which the case starts from. A change that does not apply — removing what is not
there, editing a file that is missing or binary, file changes on a run with no
workspace — is refused. It is built from production data, so it is flagged as
containing it.

`dataset-freeze` (**Freeze dataset** in the tab) freezes the live cases into a
numbered Eval Dataset version. A version never changes, and an Eval Run runs one
— by default the newest — never the live list, so every run can be read against
exactly the cases it ran. Adding, editing or archiving a case therefore reaches
the next Eval Run only after the next freeze. The tab says which version the next
run takes and whether it is behind the list (cases added or edited since are
tagged *not frozen*), lists the versions, and disables **Freeze dataset** while
the newest version already has every live case; each Eval Run names the Dataset
version it ran.

## MCP eval policy

Per MCP server of the Step's agent: `live`, `live` with named tools denied,
`replay`, or `deny`. A server the policy does not name is denied in eval trials.
Denied tools apply only to a `live` server: a `replay` server refuses them, and on
a denied one they have no effect.
`mcp-policy-get` shows what each server does, defaults included, and which Eval
Cases each server has a recording for.

**Record and replay.** Every trial with a `live` server records what that
server answered: the trial's `mcp-config.json` starts the server behind a small
proxy (`node /output/mcp-tape/mcp-tape.mjs`, stdio and streamable-HTTP alike)
that keeps the tool list and each tool call with its result, stored per Eval
Case and server once the agent exits — finished, failed or timed out. The HTTP
proxy posts each message as it arrives (only the handshake goes in order:
`initialize`, which carries the session, then the initialized notification), so parallel tool calls stay parallel, and relays what the server sends
on its own stream (`list_changed`, sampling, elicitation). The proxy needs
`node` in the agent's image; every Mediforce image has it. A `replay` server is
never started: the proxy answers the agent from the 20 newest recordings of the
trial's case — for each
distinct call (tool plus arguments, key order ignored) the newest recording of
it, the n-th identical call getting the n-th recorded result. A recording is
kept per case and server, whichever variant made it, so a challenger replays
what the champion's live trials recorded. It needs no OAuth
token and reaches no network, so tools with side effects are safe to replay.

- A call no recording answered — or made more often than any recording made
  it — gets an error result. The trial keeps it (`mcpReplayMisses`), its Agent
  Trajectory records it, and the report counts it per server and tool. A trial
  whose unanswered calls cannot all be read fails rather than count fewer.
- A replayed server that no live trial of the case has recorded fails the trial
  closed. Run the case with the server `live` first.
- Tool lists and results are recorded in full, like the Agent Trajectory:
  they stay in the platform's database, never among the run's Output Files.
- The proxy keeps its files in `/output/mcp-tape/`, which the agent can read
  and write like the rest of `/output`. A recording is only as trustworthy as
  the agent under evaluation that ran beside it.

The report states each server's mode and says when no trial made a live MCP
call (`report.mcp`; one line in the Evaluation tab and in `mediforce eval report`).

## Eval Runs

An Eval Run runs the Step, as its runnable Definition version has it — the
**champion** — and up to three **challengers** over a frozen Dataset version:
every case, `trialsPerCase` times, per variant. A challenger is a patch over
the champion (`run-prepare --challengers <file>`, `challengers` in
`POST /api/evaluation/runs`): `model`, `prompt` and `allowedTools` replace the
step's own, `mcpRestrictions` narrow it (servers the agent binds only),
`skillCommit` moves the workflow's `externalSkillsRepo` commit, `examples`
replaces the step's few-shot `agent.examples` (`[]` means none). A challenger
that changes nothing, or runs the same step as another variant, is refused.

Few-shot examples (`agent.examples`, up to 20 of `{input, output, note?, caseId?}`)
are rendered as their own `## Examples` prompt section and are part of the
Fingerprint. An example cites the Eval Case it came from by `caseId`; that case
must be a live case of the same Step and never a `holdout` one — holdout cases
are never offered as examples. Prepare leaves every case cited by the champion's
or any challenger's examples out of the run (recorded as `exampleCaseIds`, shown
in the report and by `run-prepare`), and refuses a run with no case left to score.

1. **Prepare** (`run-prepare`, `POST /api/evaluation/runs`) freezes the Dataset
   version (the newest unless named), the latest version of every live
   Evaluator — and whether each one counts — the MCP eval policy, the step's
   current Acceptance Criteria and Brief version, and each variant's Step
   Fingerprint, and estimates the cost: the Step's mean cost over its recent
   production runs, or its model's registry price for a nominal turn when it
   has none, plus one call per `llm_judge`; a challenger on another model is
   that model's price for the tokens the step's runs used. The budget cap
   defaults to 1.5× the estimate; with no estimate it must be given.
2. **Start** (`run-start --confirm-budget <usd>`) needs the budget echoed back —
   the person confirming what the run may spend. Without it the start is
   refused, which is also how an assistant's attempt to start one ends.
3. Each **trial** is a real Workflow Run flagged with the Eval Run's id,
   running its variant's patch. It enters the Step directly with the case's trigger payload and earlier step
   outputs, its workspace branched from the case's seed commit, and stops after
   the Step: no review task, no escalation, no next step. MCP servers the policy
   does not declare `live` or `replay` are removed from the agent's config; a Step that
   declares MCP servers inline cannot be evaluated at all. Just before the
   agent runs, the trial recomputes its variant's Step Fingerprint; if the
   step or its agent changed since the run was prepared (model, system prompt,
   MCP bindings, …), the trial fails naming what changed, so no Score describes
   a step no one froze. Run lists, workflow
   summaries, monitoring, the Agents history and carry-over (`inputForNextRun`)
   leave trials out.
4. When a trial's run ends, every frozen Evaluator grades its Agent Run and
   writes a Score (`source: deterministic` or `llm_judge`, `metadata.evalRunId`).
   Trials start `concurrency` at a time, round by round — each case's k-th
   trial of every variant, the champion first; once spend reaches the budget the rest
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

**Apply a variant to the step** (`mediforce eval apply-variant --run <id>
--variant <id> | --patch <file> [--set-default]`,
`POST /api/evaluation/variants/apply`, `mediforce.evaluation.applyVariant`). A
challenger of one of the step's runs, or a patch, is applied over the step as its
runnable Definition version has it and saved as a **new Workflow Definition
version** through the workflow editor's own save (`registerWorkflow`: the same
validation, image default, seeding and audit); it becomes the default version
only with `--set-default` (`setAsDefault`), as with the editor's save dialog —
otherwise it is the runnable version only when the workflow has no default
version. Needs the workflow's `edit` verb; the champion, an empty patch, and a
patch the step cannot take (the checks a challenger passes at prepare) are
refused. The response is the new version, whether it is now runnable, the
patched step's Fingerprint and, for a run's variant, whether it equals the one
frozen with the variant (`matchesFingerprint`, else the `changed` components):
then a Step Qualification of that variant holds for the new version. Applying is
audited as `step_variant.applied`.

In the web tab, every challenger of a finished run's report has an **Apply to
step** button (not the champion; `edit` verb). It asks for confirmation and a
"Make it the default version" checkbox (unchecked by default, as in the CLI), then shows the new
version, whether the variant's qualification carries over or which components
changed, and any warnings. The assistant panel's **Advanced** section takes an
optional unattended budget (USD) sent as `unattendedBudgetUsd`; runs the
assistant started under it are listed in its reply. A fix card's **Try it**
prepares the run, which is then confirmed from the Eval Runs list.

The **report** (`mediforce eval report <id>`, `GET /api/evaluation/runs/:id`)
is computed from those Scores, per variant. Per Evaluator: pass rate with its Wilson 95%
interval, pass@k (a case passes if any of its k trials does), pass^k (all of
them do), flakiness (its trials disagree), and checks that could not grade a
trial as errors. A trial that could not be graded, or failed before producing
an Agent Run, stays out of the pass rate but still counts toward its case's k,
so it can lower pass@k and pass^k, never lift them. Evaluators that do not
count are marked so. Tokens and duration come from the trials' runs; cost adds
the judge calls. Then, per variant:

- **Acceptance Criteria.** Each severity the frozen criteria set is `met` when
  every counted Evaluator of that severity reaches its floor — the pass rate's
  Wilson 95% lower bound, and pass^k where set — `missed` when one does not,
  and `not judged` when no counted Evaluator of that severity exists, one
  graded nothing, or — for a floor the scored trials reached — some trial of
  the variant failed or was skipped: a criterion is met on the whole Dataset.
  A run prepared before any criteria were set judges nothing.
- **Confidence calibration.** The confidence each trial's agent reported,
  against whether its output passed every counted Evaluator — a trial some
  counted Evaluator could not grade is left out, since a missing Score is not
  a pass: the pass rate in five confidence bins and the expected calibration error.
- **Routing.** Once the variant's trials are done, as the `autonomyLevel` to
  set: `L4` (Control Mode 4) with a `confidenceThreshold` — the lowest
  confidence at which the outputs at or above it (at least 5) passed every
  counted Evaluator with a lower bound of at least the strictest criterion's
  floor; below it the step's `fallbackBehavior` applies — or `L3` (Control
  Mode 3), a person reviewing every output, when there are no criteria, one could not be judged, the agent
  reported no confidence, or no threshold holds. A recommendation to apply in
  the workflow editor.

Each challenger is compared with the champion Evaluator by Evaluator: `better`
or `worse` only when their Wilson intervals do not overlap, otherwise `no
clear difference`, with the change in mean cost and duration.

## GEPA optimisation

GEPA (reflective prompt evolution) searches for a better `prompt` for the step
from a finished Eval Run, and runs what it finds through the Eval Run machinery
above. `mediforce eval optimise --run <evalRunId> [--variant <id>] --budget
<usd> [--candidates 1-3] [--trials N] [--reflection-model <model>]`
(`POST /api/evaluation/optimisations`, the **Optimisations** section of the
Evaluation tab, or the assistant's `start_optimisation` under an unattended
budget) needs the workflow's `run` verb.

1. **Reflective dataset.** The chosen variant's scored trials of **dev** cases
   only — those that did not pass every counted Evaluator first, at most 12 —
   each as GEPA's `Inputs` (trigger payload and earlier steps' outputs),
   `Generated Outputs` (the result, and the tools the trajectory called) and
   `Feedback` (the case's expectation and notes, each counted Evaluator's
   `PASS`, `FAIL` or — when it gave no verdict — `ERROR` with its rule and
   comment, and the trial's Evaluator errors). The current prompt GEPA rewrites
   is the variant's, or the step's in the workflow version the source run
   pinned. Holdout cases are what the candidates are checked on afterwards, so
   the job never sees them. A variant with no scored dev trial, or a run with no
   counted Evaluator, is refused.
2. **The job.** A container of the `mediforce-gepa` image (Python with the
   `gepa` package, built by `scripts/rebuild-docker-images.sh`) runs GEPA's
   reflective proposal step once per candidate, each over its own minibatch of
   up to three records, with the reflection model through OpenRouter on the
   workspace's `OPENROUTER_API_KEY`. Unlike a `code` check's sandbox it has
   network, for that model, and nothing mounted but its own `/output`. Under
   `ALLOW_LOCAL_AGENTS` it is a local `python3` process instead, which needs
   `pip install gepa`. It runs after the start has answered (`proposing`) and
   stamps `heartbeatAt` every minute, queued or running; one silent for 5
   minutes died with its process and is failed by the heartbeat. It is one
   round of proposals, not GEPA's multi-round loop — the next round is another
   optimisation (ADR-0023 D15).
3. **Candidates.** Prompts that are empty, unchanged or repeated are dropped.
   Each remaining one is a challenger — the variant's own patch with the new
   `prompt` — in a new Eval Run over the step's newest Dataset version, dev and
   holdout (`evaluating`). That run starts at once: the budget the person
   granted is its confirmation.

**Budget.** `budgetUsd` (required, up to 10,000) covers both. The job is
charged at the reflection model's registry price — a model the registry does
not price is refused at the start, since the job could not be held to the
budget — and the Eval Run gets what is left, which stops it like any other run
(`budget_exceeded`). A start whose job's worst case — every call on the largest
records at its full 4000-token output allowance — leaves nothing of the budget
is refused. A job that spends it all anyway fails the optimisation before any
run. A job that fails part-way still records what it spent (`jobCostUsd`), and
what it proposed before it failed is still evaluated, with its `error` kept.
While the job's cost is unknown — still proposing, or it died without saying —
the reported `spentUsd` is null.

**Results** (`mediforce eval optimisation <id>`,
`GET /api/evaluation/optimisations/:id`; `mediforce eval optimisations` lists
them) are computed from the Eval Run's Scores when read. Per variant and per
split, a trial passes when every counted Evaluator graded it and passed it; the
pass rate comes with its Wilson 95% interval. The step as it is is the
baseline, and the candidates are ranked by the Wilson lower bound of their
holdout pass rate, then dev pass rate, then mean cost: the job reflected on the
dev cases, so a dev gain the holdout does not show is fitted to them. Without
holdout cases, dev ranks alone. Apply a winner from its Eval Run's report
(**Apply to step**, `apply-variant --run <evalRunId> --variant <id>`) as any
challenger. Another round is another optimisation, from that Eval Run and the
winner's `variantId`. Starting, proposing and failing are audited as
`eval_optimisation.started|proposed|failed`.

## Acceptance Criteria

The floors a step's Eval Runs are judged against, per severity: `minPassRate`
on the Wilson 95% lower bound, and optionally `minPassHatK`. Every write is a
new version; an Eval Run freezes the version in force when it is prepared, so
changing them never rejudges a run. `mediforce eval criteria-get|criteria-set
--file`, `GET|POST /api/evaluation/acceptance-criteria`.

## Step Fingerprint

A SHA-256 over the parts of the step that shape its behaviour, each hashed on
its own so two Fingerprints say what differs:

| Component | What is hashed |
|---|---|
| `step` | the agent config (including `examples`), plugin, agent id, params, step params, env and MCP restrictions — not its name, display, `autonomyLevel`, `review`, `confidenceThreshold` or `fallbackBehavior` |
| `model` | the step's model, or its agent's when the step names none |
| `systemPrompt` | the agent's system prompt |
| `skill` | every file the workflow carries under `<skillsDir>/<skill>/`, or the external skills repository, commit and path |
| `image` | the image reference the runtime resolves, the files a carried Dockerfile builds from, and the commit a repository build checks out |
| `mcpServers` | the MCP servers and tools production resolves for the step |
| `preamble` | the workflow preamble |

Routing is left out, so applying a recommended Control Mode or
`confidenceThreshold` keeps a qualification. The MCP eval policy is left out
too (ADR-0023 D6); a qualification states it instead. The image is its
reference, not a registry digest: a tag re-pushed under the same name does not
change the Fingerprint — pin an image by digest (`image@sha256:…`) where that
matters.

## Step Qualification

A person signs a Step Qualification for one variant of a finished Eval Run — not a cancelled one —
**Sign Step Qualification** on that variant in the report (web only; an API key
cannot sign, so the CLI has no command for it). The run must have Acceptance
Criteria and a Brief version frozen into it. The signer reads what the
signature means ("Approved: I reviewed this Eval Run and qualify this Step
configuration for its context of use as stated in Evaluation Brief vN."),
writes a justification for each criterion the variant missed or that could not
be judged — recorded as a deviation; a justification for a criterion that was
met is refused — and re-enters their password; a wrong one is refused and
audited against the Eval Run as `step_qualification.signature_refused`. On a
deployment without password sign-in the form asks for no password and the
signature is recorded as made from the session; a user without a password on
one with it must set one first. The qualification cites
the Eval Run, the variant and its patch, its Fingerprint, the Brief version,
the Evaluator versions, the MCP eval policy, the criteria and each verdict, and
is never changed; signing is audited as `step_qualification.signed`.

The badge (`mediforce eval qualification [--version N]`,
`GET /api/evaluation/qualification`) is **Qualified** when a qualification
binds the step's Fingerprint as it is now, **Stale** when qualifications exist
but none does — naming the components that changed — and **Not qualified**
when none was signed. It shows in the Evaluation tab, and on an agent step of a
run for the Definition version that run ran. A challenger that was qualified
becomes Qualified once the step is changed to match it — applying it
(`apply-variant`) does exactly that when the new version is the runnable one. Evaluators added,
archived or given a new version since are flagged beside it, without making
it stale. The badge is informational: nothing is blocked without one.
