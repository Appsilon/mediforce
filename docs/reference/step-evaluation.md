---
status: living
audience: workflow-authors
last_reviewed: 2026-10-01
---

# Step Evaluation

How an author checks that one agent Workflow Step can be trusted for its
context of use. The design and its reasons are
[ADR-0023](../adr/0023-step-evaluation.md); the vocabulary is `CONTEXT.md`
§ Evaluation domain. This page is what exists today. Optimisation — challenger
variants, applying them, fix variants, GEPA and a case's positive/negative
expectation — is parked in [ADR-0024](../adr/0024-optimisation.md) (Proposed):
its REST routes and CLI commands still exist but are outside the supported
surface, and neither the tab nor the assistant offers them.

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
Acceptance Criteria with whether it is validated against them,
Evaluators, Eval Cases, MCP eval policy and Eval Runs — beside the
Evaluation Assistant (`mediforce eval ask`, `POST /api/evaluation/assistant`),
whose header holds the step's Brief.
Its authority is tiered ([ADR-0023](../adr/0023-step-evaluation.md) D15):

- **Runs freely:** reading the step (config, agent prompt and system prompt,
  input and output descriptions, `outputSchema`, the tools it allows beyond
  the runtime's defaults, MCP servers as production resolves them — a
  configuration production refuses shows as such — and as trials see them,
  SKILL.md, the steps upstream of it), its
  production runs with the reviewer's verdict and their trajectories, the
  workspace files a run started from, Evaluators with their labels and
  calibration, cases, Eval Runs and reports, a run's failing trials
  (`get_failures`), the step's qualification and Acceptance
  Criteria (`get_qualification`), and `preview_evaluator` — it
  tries a check on real outputs before proposing it.
- **Proposes:** Evaluators and new versions of them, Eval Cases (harvested,
  written or synthesized), outputs
  for a judge's person to label (`propose_written_outputs`), Brief drafts and Acceptance Criteria come back as
  cards to accept, edit or reject. Accepting one is the same write the forms
  make, recorded with `origin: assistant`. A routing recommendation (Control
  Mode and `confidenceThreshold`) comes back as a card to apply in the
  workflow editor. So does a **diagnosis** of an Eval Run's failures
  (`propose_diagnosis`) — see below. Nothing is applied to the step by the
  assistant.
- **Prepares:** it can prepare an Eval Run of the step; the run starts
  only when the person confirms its budget on the card. Its own start attempt
  is refused — unless the request carries an **unattended budget**
  (`unattendedBudgetUsd`, up to 10,000; `mediforce eval ask --unattended-budget
  <usd>`), which the person grants for that one request. Then `start_eval_run`
  starts a prepared run of this step whose `budgetUsd` fits what is left of the
  grant (the sum of the budgets of the runs started in the request is what has
  been spent), confirming that budget as a person would; a run that does not
  fit is refused with the amount left. The response lists them as
  `startedEvalRuns: [{ evalRunId, budgetUsd }]`, and the request's
  audit event records the grant. Without the field nothing changes.
- **Never:** approving a `code` check's source, labelling outputs, signing a
  Step Qualification. There is no tool for these.

The step's Brief is sent to the assistant on every turn. What it can help with:

- **Evaluation plan.** It reads the step, a few of its runs and the Brief, and
  returns a plan card: the risks, highest first — what could go wrong, how bad,
  why, the cheapest check that would catch it, the inputs worth trying it on —
  and suggested Acceptance Criteria (minimum pass rates per severity). A plan creates nothing; **Draft this check** on a
  risk asks the assistant to draft it, and **Use as Acceptance Criteria** sets
  the suggested floors.
- **Acceptance Criteria.** From the step's risks and Brief, it proposes floors
  per severity — with pass^k where the step would run unreviewed — and says
  how many graded trials a floor needs to mean something (8 passes out of 10
  meet a 0.8 floor, but their Wilson 95% interval runs from 0.49 to 0.94).
- **Routing.** It explains each criterion's verdict and recommends a Control
  Mode and `confidenceThreshold` from the run's confidence calibration.
- **Diagnosis.** After a run with failures the assistant reads them
  (`get_failures`: the run's trials where a counted Evaluator failed, a
  check errored, or no Agent Run was produced — each with its case, its
  trial error and the Evaluators that failed or errored; at most 50 listed,
  with the total; `mediforce eval failures <evalRunId> [--variant <id>]`,
  `GET /api/evaluation/runs/:id/failures`), then the trajectories and cases,
  and clusters the failures by root cause in a **diagnosis** card
  (`propose_diagnosis`): `ambiguous_instruction`, `missing_context`,
  `tool_problem`, `model_capability` or `evaluator_wrong`, each with its
  trials, evidence and the fix it points to, in words. A fix the platform can
  take as a proposal comes as one: a guardrail as `propose_evaluator` with
  `runInProduction`, a routing change as `propose_control_settings`, a wrong
  Evaluator as `propose_evaluator_version`. A change to the step's prompt,
  model, tools or workflow is made by the person in the workflow editor. A
  diagnosis is refused unless the run is this step's and every trial is a
  trial of that run.
- **Rule to check.** A plain-language rule becomes the cheapest reliable kind —
  `schema`, then `code`, a judge only when a script cannot decide it. Every
  proposed check is tried by the platform on the step's recent production
  outputs before the card is shown (reusing the assistant's own preview of the
  same check), and the card shows what it did. A check that errors on every
  output goes back to the assistant instead of to the person; for a person
  without the `run` verb the card says it was not tried. The try runs the check on up to 5 outputs, so it is not free: a `code` check
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
  renamed columns, a missing or extra file — with notes on what the output
  must or must not do. A change that does not apply to that run goes back to the assistant instead of
  to the person.

Every proposal is checked against the platform before it is shown: an Evaluator
name already taken, an Evaluator or run of another step, and an eval trial
offered for labelling are refused the same way.

The assistant pane uses the same model picker as the workflow editor so the model can be chosen per
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
text as GitHub-Flavored Markdown behind the file icon in the Evaluation
Assistant's header, which carries a dot once a Brief is written; the stored
value remains the original text. The Brief is shared by everyone evaluating the
step, unlike the workflow editor assistant's per-user instructions. It guides
the assistant and nothing else: it is not a precondition of anything, an Eval
Run does not record it, and a Step Qualification does not cite it.
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
--pass|--fail` records a human Score on an Agent Run (`evaluator-labels` lists
the newest per run), `evaluator-calibrate` runs the judge over the labelled
runs and stores the agreement and Cohen's κ — agreement beyond what the
pass/fail mix gives by chance. Labels belong to the Evaluator, not a version,
so a refined rule is recalibrated against the same labels. Only agreement
decides whether a judge counts. `cases-from-labels <evaluatorId>` turns every
labelled production output that is not yet a case into one, noting the rule,
the label and the person's comment.

Why a judge needs this: its verdict is a model's opinion, and its Scores feed
Acceptance Criteria and a Step Qualification. The minimum failures matter as
much as the count — a judge that passes everything agrees perfectly with an
all-pass set of labels and catches nothing. In the Evaluation tab each judge
shows its progress (`labels · fails · agreement`) and **Label outputs** opens
the labelling: the production runs already added as Eval Cases first, each with
its case's notes (the label asks whether the output breaks *this* rule), then the
other loaded production runs, each with its input and
output; then **Calibrate**.

When production has no output that breaks the rule — nobody runs a bad case on
purpose — **Write an example** makes one: start from a production run, keep its
input, and change its output in a form built from the step's `outputSchema`
(one typed field per property, enumerations as choices, arrays and objects as
JSON, changed fields marked and resettable, or the whole output as JSON), then
**Save as fail** or **Save as pass**. With no run to start from (**Nothing —
write the input and output**), the input is written as JSON too, laid out empty
in the shape the run route gives the step: the previous step's `outputSchema`
fields at the top level, and every step that can run before it under `steps`
(a step without an `outputSchema` as `{}`). It is a **written output**
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
it answers and its verdicts — never the check's JSON.
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

- `schema` and `code` run synchronously and each writes a Score marked
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
both means and counts. The Evaluation tab shows a banner at its top while any
Evaluator drifts. Alerts are computed when read:
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

## Eval Cases and Datasets

An Eval Case is one input for the Step — the trigger payload, the outputs of the
steps before it, and the workspace commit it starts from — with notes on what
its output must or must not contain. `case-from-run <agentRunId>` harvests one
from a production run. Cases are `dev` or
`holdout`, carry a *contains production data* flag, and an `origin` — `user`,
or `assistant` for an accepted Evaluation Assistant proposal.

An Eval Case is not a label. A case is an *input* an Eval Run re-runs the step
on; the Evaluators grade the new output. A label (below, under calibration) is a
person's pass/fail on one *output* for one Evaluator, and only labels calibrate
a judge. An `llm_judge` grading an Eval Run trial is given the case's notes, so
write them as what to look for — "the fatal event must be grade 5" — not as a
verdict on the output.

In the Evaluation tab, **Eval Cases → Production runs to add as Eval Cases**
lists the Step's finished production runs not yet harvested, newest first and a
page at a time (**Load more**; `GET /api/evaluation/agent-runs` takes the
previous page's `nextCursor` as `cursor`). Each shows its reasoning summary,
opens its **Input and output** — what the step was given beside what it
returned (`eval run-io <agentRunId>`, `GET /api/evaluation/agent-runs/:agentRunId/io`;
its `caseInput` is the same input as an Eval Case made from the run holds it)
— and **Log** opens the run's execution log before you **Add as case**.

**Write a case** covers inputs production has not sent — an input the step must
refuse, a record that should trip a rule. Its input starts from an existing case's,
so it keeps the shape the step is given (and that case's workspace commit), or
from a `.json` file: a whole case as `case-add --file` takes it (`{ name, input,
notes?, split? }`), or only its input (`{ triggerPayload,
previousStepOutputs, previousRun? }`). It is saved with `POST /api/evaluation/cases`
as a `manual` case, flagged as containing production data when the case it
started from was.

Each case in the list opens **Details**: where it came from, what it expects
(its notes), for a production case the input and output of its source run
(for a synthesized one, its source run's, before the change), the input an Eval
Run gives the step, the workspace commit it starts from, and **Source run log**
for a case made from a run. **Edit** changes its name,
split, notes or input (`case-edit <caseId> --file`,
`PATCH /api/evaluation/cases/:caseId`); **Archive** takes it out of the next
freeze (`case-archive`). An edit is a new case that replaces the old one, which
is archived, so a Dataset version frozen with the old case keeps exactly what it
ran. A production case whose input is edited becomes `manual` — production never
saw that input — and keeps the run it came from. MCP recordings are kept per
case, so an edited case is recorded afresh by its next trial, `live` or `replay`.

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
Denied tools apply to a `live` server, and to a `replay` server while it runs
live to record a case; on a denied server they have no effect.
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
`node` in the agent's image; every Mediforce image has it. A `replay` server
records first, per case: a trial whose case has no recording of it yet runs it
live and records it, exactly as a `live` server, so the case's next trial
replays — no need to run once with `live` and switch. For a case with a
recording, the server is never started: the proxy answers the agent from the
20 newest recordings of the trial's case — for each
distinct call (tool plus arguments, key order ignored) the newest recording of
it, the n-th identical call getting the n-th recorded result. A recording is
kept per case and server. It needs no OAuth
token and reaches no network, so tools with side effects are safe to replay
once recorded.

- A call no recording answered — or made more often than any recording made
  it — gets an error result. The trial keeps it (`mcpReplayMisses`), its Agent
  Trajectory records it, and the report counts it per server and tool. A trial
  whose unanswered calls cannot all be read fails rather than count fewer.
- Recording first reaches the real server, side effects included, once per
  case — deny the side-effecting tools on the `replay` server to keep them out
  of that run. A trial records when the agent exits, so trials of a new case running
  side by side in one Eval Run each run live; the next Eval Run replays them.
- Tool lists and results are recorded in full, like the Agent Trajectory:
  they stay in the platform's database, never among the run's Output Files.
- The proxy keeps its files in `/output/mcp-tape/`, which the agent can read
  and write like the rest of `/output`. A recording is only as trustworthy as
  the agent under evaluation that ran beside it.

The report states each server's mode, how many cases each `replay` server ran
live to record (`recordedFirst`), and says when no trial made a live MCP call
(`report.mcp`; one line in the Evaluation tab and in `mediforce eval report`).
A Step Qualification cites the policy's modes only.

## Eval Runs

An Eval Run runs the Step, as its runnable Definition version has it, over a
frozen Dataset version: every case, `trialsPerCase` times. A case cited by the
step's few-shot `agent.examples` is left out of the run (`exampleCaseIds`;
[ADR-0024](../adr/0024-optimisation.md) D5).

1. **Prepare** (`run-prepare`, `POST /api/evaluation/runs`) freezes the Dataset
   version (the newest unless named), the latest version of every live
   Evaluator — and whether each one counts — the MCP eval policy, the step's
   current Acceptance Criteria, and the Step Fingerprint,
   and estimates the cost: the Step's mean cost over its recent production
   runs, or its model's registry price for a nominal turn when it has none,
   plus one call per `llm_judge`. The budget cap
   defaults to 1.5× the estimate; with no estimate it must be given.
2. **Start** (`run-start --confirm-budget <usd>`) needs the budget echoed back —
   the person confirming what the run may spend. Without it the start is
   refused, which is also how an assistant's attempt to start one ends.
3. Each **trial** is a real Workflow Run flagged with the Eval Run's id. It
   enters the Step directly with the case's trigger payload and earlier step
   outputs, its workspace branched from the case's seed commit, and stops after
   the Step: no review task, no escalation, no next step. MCP servers the policy
   does not declare `live` or `replay` are removed from the agent's config; a Step that
   declares MCP servers inline cannot be evaluated at all. Just before the
   agent runs, the trial recomputes the Step Fingerprint; if the
   step or its agent changed since the run was prepared (model, system prompt,
   MCP bindings, …), the trial fails naming what changed, so no Score describes
   a step no one froze. Run lists, workflow
   summaries, monitoring, the Agents history and carry-over (`inputForNextRun`)
   leave trials out.
4. When a trial's run ends, every frozen Evaluator grades its Agent Run and
   writes a Score (`source: deterministic` or `llm_judge`, `metadata.evalRunId`).
   Trials start `concurrency` at a time, round by round — each case's k-th
   trial; once spend reaches the budget the rest
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

The assistant panel's **Advanced** section takes an optional unattended budget
(USD) sent as `unattendedBudgetUsd`; runs the assistant started under it are
listed in its reply.

The **report** (`mediforce eval report <id>`, `GET /api/evaluation/runs/:id`)
is computed from those Scores. Per Evaluator: pass rate with its Wilson 95%
interval, pass@k (a case passes if any of its k trials does), pass^k (all of
them do), flakiness (its trials disagree), and checks that could not grade a
trial as errors. A trial that could not be graded, or failed before producing
an Agent Run, stays out of the pass rate but still counts toward its case's k,
so it can lower pass@k and pass^k, never lift them. Evaluators that do not
count are marked so. Tokens and duration come from the trials' runs; cost adds
the judge calls. Then:

- **Acceptance Criteria.** Each severity the frozen criteria set is `met` when
  every counted Evaluator of that severity reaches its floor — the pass rate
  itself, passes over graded trials (8 of 10 meets 80%), and pass^k where
  set — `missed` when one does not,
  and `not judged` when no counted Evaluator of that severity exists, one
  graded nothing, or — for a floor the scored trials reached — some trial
  failed or was skipped: a criterion is met on the whole Dataset.
  A run prepared before any criteria were set freezes the default — every
  severity at 100%; one prepared before that default existed judges nothing.
- **Confidence calibration.** The confidence each trial's agent reported,
  against whether its output passed every counted Evaluator — a trial some
  counted Evaluator could not grade is left out, since a missing Score is not
  a pass: the pass rate in five confidence bins and the expected calibration error.
- **Routing.** Once the trials are done, as the `autonomyLevel` to
  set: `L4` (Control Mode 4) with a `confidenceThreshold` — the lowest
  confidence at which the outputs at or above it (at least 5) passed every
  counted Evaluator at a rate of at least the strictest criterion's floor; below it the step's `fallbackBehavior` applies — or `L3` (Control
  Mode 3), a person reviewing every output, when there are no criteria, one could not be judged, the agent
  reported no confidence, or no threshold holds. A recommendation to apply in
  the workflow editor.

## Acceptance Criteria

The floors a step's Eval Runs are judged against, per severity: `minPassRate`
on the pass rate itself — 8 of 10 meets a `minPassRate` of 0.8, and 1 needs
every graded trial to pass — and optionally `minPassHatK`. Until
a step's criteria are set, `DEFAULT_ACCEPTANCE_CRITERIA` applies: every
severity at 100%. Every write is a new version; an Eval Run freezes the
version in force when it is prepared, so changing them never rejudges a run.
`mediforce eval criteria-get|criteria-set --file`,
`GET|POST /api/evaluation/acceptance-criteria`.

In the Evaluation tab, the top row is the step's validation status (see
Validation below) and **Set the threshold**, whose tooltip lists the floors in
force. The button opens a dialog with a slider per severity — critical, major,
minor — from 0% to 100% and a checkbox for whether the severity is judged.
Nothing is saved until **Save**, which writes one new version and keeps each
severity's `minPassHatK`, which only the CLI, the API and the assistant set.
The tab shows no version. The last severity judged cannot be unchecked:
criteria judge at least one.

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

A person signs a Step Qualification from a finished Eval Run — not a cancelled one —
with **Sign Step Qualification** in its report (web only; an API key
cannot sign, so the CLI has no command for it). The run must have Acceptance
Criteria frozen into it; the Evaluation Brief plays no part. The signer reads
what the signature means ("Approved: I reviewed this Eval Run and qualify this
Step configuration as it ran in it."),
writes a justification for each criterion the run missed or that could not
be judged — recorded as a deviation; a justification for a criterion that was
met is refused — and re-enters their password; a wrong one is refused and
audited against the Eval Run as `step_qualification.signature_refused`. On a
deployment without password sign-in the form asks for no password and the
signature is recorded as made from the session; a user without a password on
one with it must set one first. The qualification cites
the Eval Run and what was frozen into it — its Fingerprint,
the Evaluator versions, the MCP eval policy, the criteria and each verdict, and
is never changed; signing is audited as `step_qualification.signed`.

The badge (`mediforce eval qualification [--version N]`,
`GET /api/evaluation/qualification`) is **Qualified** when a qualification
binds the step's Fingerprint as it is now, **Stale** when qualifications exist
but none does — naming the components that changed — and **Not qualified**
when none was signed. On an agent step of a run it shows for the Definition
version that run ran. Evaluators added,
archived or given a new version since are flagged beside it, without making
it stale. The badge is informational: nothing is blocked without one.

## Validation

Separate from signing, every step has a **validation** status for its runnable
workflow version (or the version asked for), read from the newest finished
Eval Run of that version (`completed` or `budget_exceeded`; a cancelled run
does not count) on the champion:

- **Passed** — that run met every Acceptance Criterion frozen into it.
- **Failed** — a criterion was missed or could not be judged.
- **Not verified** — no Eval Run of the version has finished, or something the
  run rested on changed since: the step's Fingerprint, an Evaluator (added,
  archived or given a new version), the live Eval Cases (added, edited or
  archived — compared with the cases the run ran), or the Acceptance Criteria.
  Run the step again to verify it.

It comes with `GET /api/evaluation/qualification` as `validation: { status,
evalRunId, reason, runInProgress }`, as the first line of `mediforce eval
qualification`, and in the assistant's `get_qualification`. In the Evaluation
tab it is the status at the top — **Validation passed**,
**Validation failed** or **Not verified**, with the reason on hover; clicking it
also shows the signed Step Qualification, if any. The tab reads it again every
few seconds while an Eval Run of the step is running. A signed qualification
does not change it, and it blocks nothing.
