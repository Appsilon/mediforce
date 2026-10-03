---
status: living
audience: workflow-authors
last_reviewed: 2026-10-02
---

# Step Evaluation

How an author checks that one agent Workflow Step can be trusted for its
context of use. The design and its reasons are
[ADR-0023](../adr/0023-step-evaluation.md); the vocabulary is `CONTEXT.md`
§ Evaluation domain. This page is what exists today. Optimisation — challenger
variants, applying them, fix variants and GEPA — is parked in [ADR-0024](../adr/0024-optimisation.md) (Proposed):
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

The **Evaluation** tab of a workflow shows one agent step of one workflow
version at a time — picked with the **Version** selector (the runnable version
unless `?version=` names another live one; archived versions are not offered)
and then the **Step** selector (`?step=`), each option marked with its
validation (see Validation below) — its Acceptance Criteria with whether it is
validated against them, Evaluators, Eval Cases and that version's finished Eval
Runs, plus any prepared or running run of another version, tagged with it —
beside the Evaluation Assistant (`mediforce eval ask`,
`POST /api/evaluation/assistant`), whose header holds the step's Brief. The
assistant reads and prepares runs of the step as the selected version has it
(`definitionVersion`, `mediforce eval ask --version N`; the runnable version
when absent). A step's Evaluators, cases, Brief and criteria are the step's,
not a version's: they stay readable and editable from an older version even
once the runnable version no longer has the step.
Its authority is tiered ([ADR-0023](../adr/0023-step-evaluation.md) D15):

- **Runs freely:** reading the step (config, agent prompt and system prompt,
  input and output descriptions, `outputSchema`, the tools it allows beyond
  the runtime's defaults, MCP servers as production resolves them — a
  configuration production refuses shows as such — and as trials see them,
  SKILL.md, the steps upstream of it), its
  production runs with the reviewer's verdict and their trajectories, the
  workspace files a run started from, Evaluators, cases, Eval Runs and
  reports — with every judge verdict's rationale and review — a run's failing trials
  (`get_failures`), the step's qualification and Acceptance
  Criteria (`get_qualification`), and `preview_evaluator` — it
  tries a check on real outputs before proposing it.
- **Proposes:** Evaluators and new versions of them, Eval Cases (harvested,
  written or synthesized), Brief drafts and Acceptance Criteria come back as
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
- **Never:** approving a `code` check's source, accepting or denying a judge's
  verdict, signing a Step Qualification. There is no tool for these.

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
- **Judges.** It writes a rubric that names what passes, what fails and the
  evidence that decides it. After a run it reads the judge verdicts a person
  denied or the judge was unsure of, says what the person seems to mean by the
  rule, and proposes a sharper rubric as a new version.
- **Case synthesis.** It proposes a case built from a real production run with
  a deliberate change — an instruction injected into the data, an edge value,
  renamed columns, a missing or extra file — with an expected output when it
  knows one: the source run's for a change that keeps the meaning, or a
  negative case's output the agent must not return. A change that does not
  apply to that run goes back to the assistant instead of to the person.

Every proposal is checked against the platform before it is shown: an Evaluator
name already taken, or an Evaluator or run of another step, is refused the same
way.

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

One rule in plain language plus the check behind it. Four kinds:

| Kind | Check | Counts (D9) |
|---|---|---|
| `schema` | `result` against the JSON Schema subset `agent.outputSchema` uses | at once |
| `code` | a `python` or `javascript` script in the `script-container` sandbox (no network) | after a person approves that version's source |
| `llm_judge` | a model reads the step's input, the agent's Trajectory and its output, explains its judgment, then answers pass or fail with a confidence 0–1 | at once; each verdict below its `minConfidence` is left out unless a person accepts it |
| `expected_output` | `result` against the Eval Case's expected output — an exact match, or an agreement score 0–1 from its model; see [Expected outputs](#expected-outputs) | at once |

A `code` check reads `/output/input.json` — `{ result, stepInput, trajectory,
case }` — and the step's workspace commit read-only at `/workspace`, and writes
`/output/result.json` as `{ "passed": boolean, "comment"?: string }`. A check
that crashes, or a judge that gives no usable verdict, is an *error*, never a
failed output.

Every change is a new immutable version; a `code` version's source approval
attaches to it.

An `llm_judge` check is `{ kind, model, rubric, minConfidence }`
(`minConfidence` 0–1, 0.8 when not set). The judge is given the step's input,
the agent's whole Trajectory — its reasoning, every tool call and tool result,
numbered, long logs cut in the middle — its output and its own summary. It is
not told a case's expected output or whether the case is negative. It must explain its judgment — what exactly decided the
verdict and why, citing the input, the output and log entries by number — and
answer `{ "rationale", "passed", "confidence" }`. The Score is `1`/`0` with
label `pass`/`fail`, the rationale as its comment, and
`metadata.judgeConfidence` and `metadata.judgeMinConfidence`.

A verdict whose confidence is below its `minConfidence` is shown in the report
but left out of the pass rate the Acceptance Criteria read. A person reads each
verdict's rationale in the report and reviews it:

- **Accept** — the verdict counts, however unsure the judge was.
- **Deny** — the verdict is left out, however confident the judge was. It is
  never reversed into the opposite verdict.

A review is a human Score (`judge_review`, label `accepted` or `denied`, the
person's optional comment) that a later review supersedes
(`mediforce eval judge-review <evalRunId> --trial <id> --evaluator <id>
--accept|--deny [--comment …]`, `POST /api/evaluation/runs/:id/judge-reviews`,
`edit` verb; an API key names the reviewer with `uid`). A judge Score recorded
before judges reported a confidence counts as it did. An `expected_output`
check's agreement score is a model's verdict too, reviewed the same way; an
exact comparison is not reviewable.

`evaluator-archive` archives or restores an Evaluator; `evaluator-production`
sets whether it also runs in production (see below).

### Expected outputs

An `expected_output` check is `{ kind, model, instructions?, minAgreement }`
(`minAgreement` 0–1, 0.8 when not set) and grades only Eval Run trials of a
case that has an expected output. The case says how it is compared:

- **`exact`** — the output must equal the expected output; object key order is
  ignored, anything else that differs fails, and the comment lists the first
  differing paths (`findings.0.grade: expected 5, got 4`). No model is called.
- **`agreement`** — the check's `model` reads only the expected output and the
  output, with the check's `instructions` (for every case) and the case's
  `agreementInstructions` (this case only, e.g. "differences in the narrative
  are trivial; a changed grade means low agreement"), explains which
  differences mattered and answers `{ "rationale", "agreement" }`. It passes at
  `minAgreement`. The Score keeps the agreement in `metadata.agreement` and is
  written with source `llm_judge`; its judge cost is charged to the run. A
  person can accept or deny it like a judge's verdict (see the judge review
  above): 0.81 against a floor of 0.8 counts until someone reading the
  rationale denies it.

A **negative** case's expected output is one the step must not return, so the
verdict reverses: it passes when the output differs (exact) or agrees below
`minAgreement` (agreement). A comparison that gives no usable agreement is an
error, never a failed output. The check cannot be previewed (`evaluator-preview`
refuses it: a production output has no expected output) and never runs in
production — `runInProduction` is refused for it — and a version keeps its kind:
an `expected_output` Evaluator stays one, and no other kind becomes one. In the
tab, a case whose expected output no Expected output check grades says so.

In the Evaluation tab, **Evaluators → Add** picks the kind from a dropdown and
shows its fields — a JSON Schema (started from the step's `agent.outputSchema`
when it declares one), a language and source, a judge model with the question
it answers and its minimum confidence — never the check's JSON.
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
  Score (`source: llm_judge`, its cost in `metadata.judgeCostUsd`, its
  confidence as in an Eval Run). Its errors
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
steps before it, and the workspace commit it starts from — and optionally the
output expected of it. `case-from-run <agentRunId>` harvests one from a
production run. Cases are `dev` or `holdout`, carry a *contains production
data* flag, and an `origin` — `user`, or `assistant` for an accepted Evaluation
Assistant proposal.

A case is an *input* an Eval Run re-runs the step on; the Evaluators grade the
new output. What a case expects of that output:

- `expectedOutput` — JSON the output is compared with by an
  [`expected_output`](#expected-outputs) check, or `null` for none.
- `expectation` — `positive` (the output must match it) or `negative` (the
  output must not); it matters only with an expected output.
- `comparison` — `exact` or `agreement`, with `agreementInstructions` for an
  agreement on this case.
- `evaluatorIds` — the Evaluators that grade the case, or `null` for every
  Evaluator of the step, including ones added later. A case selects only
  live (not archived) Evaluators of its own step. An Evaluator a case does not select — or an
  `expected_output` check on a case with no expected output — does not grade its
  trials: the report leaves them out of that Evaluator's pass rate, errors and
  pass@k/pass^k, failures do not list it, and a trial passes when every counted
  Evaluator that grades its case passed.

A harvested case takes the run's output as its expected output when a person
reviewed the run: approved, a positive case; rejected, a negative one. A run
sent back for revision or never reviewed gives none. An `expectedOutput` in the
request (`null` for none) replaces the run's output and is positive unless
`expectation` says otherwise — the verdict labels only the run's own output. `case-from-run` takes `--expectation`, `--comparison` and `--input-file` (a case input other than the run's makes a `manual` case that keeps the run).

In the Evaluation tab, **Eval Cases → Add case** is the one way to add a case:
a dialog that starts from a production run, an existing case's input, a `.json`
file, or an empty input. **Start from** lists the Step's finished production
runs, newest first and a page at a time (**Load more runs**; `GET
/api/evaluation/agent-runs` takes the previous page's `nextCursor` as `cursor`),
marking runs that already have a case; it starts on the newest run that has none. Starting from a run fills the **Input**
with what its step was given and the **Expected output** with what it returned
(`eval run-io <agentRunId>`, `GET /api/evaluation/agent-runs/:agentRunId/io`; its
`caseInput` is the same input as an Eval Case made from the run holds it, and its
`verdictExpectation` is what a person's review makes of the output: approved
positive, rejected negative, `null` unreviewed). The case then starts positive or
negative from that review. Each side is marked **As the source run** or
**Edited**, with **Use the source run's input** / **output** to put the run's
back, and **Source run log** opens the run's execution log inline. It is saved
with `POST /api/evaluation/cases/from-agent-run` carrying the form's `input`:
an input other than the run's makes a `manual` case that keeps the run it came
from.

Starting from anything else covers inputs production has not sent — an input
the step must refuse, a record that should trip a rule. An existing case's input
keeps the shape the step is given (and that case's workspace commit); a `.json`
file is a whole case as `case-add --file` takes it (`{ name, input,
expectedOutput?, expectation?, comparison?, agreementInstructions?, split? }` —
`evaluatorIds` from a file is ignored, as they belong to the step it was written
for), or only its input (`{ triggerPayload, previousStepOutputs, previousRun?
}`). It is saved with `POST /api/evaluation/cases` as a `manual` case, flagged as
containing production data when the case it started from was.

Either way the form shows the **Input** beside the **Expected output** (left
empty for none), whether the case is **positive** or **negative**, how it is
**compared** — exact match or output agreement score, with instructions for this
case — and under **Graded by** **All evaluators** or **Selected evaluators**,
which opens a checkbox per Evaluator.

Each case in the list shows its labels (positive or negative, split, source),
for a case made from a run whether it is **as run** or **edited** — its input
differs from what the run was given, or its expected output (none included)
from what the run returned — and **Edit** and **Archive** beside them. Its
**Details** show only what the case gives the step and what it expects: its
input, its expected output and how it is compared, and the Evaluators that grade
it — plus **Source run log** for a case made from a run, synthesized ones
included. **Edit** opens the same dialog to
change its name, split, input, expected output and how it is compared, or the
Evaluators that grade it (`case-edit <caseId> --file`, `PATCH
/api/evaluation/cases/:caseId`). Ticking cases in the list and **Set
evaluators…** sets the Evaluators of all of them at once, one edit per case that
changes; **Archive** takes it out of the next freeze (`case-archive`). An edit
is a new case that replaces the old one, which is archived, so a Dataset version
frozen with the old case keeps exactly what it ran. A production case whose input is edited becomes `manual` — production never
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
containing it. It takes the same expected output, expectation, comparison and
Evaluators as a written case.

`dataset-freeze` (**Save** in the tab) freezes the live cases into a
numbered Eval Dataset version. A version never changes, and an Eval Run runs one
— by default the newest — never the live list, so every run can be read against
exactly the cases it ran. Adding, editing or archiving a case therefore reaches
the next Eval Run only after the next freeze. The tab says which version the next
run takes and whether it is behind the list (cases added or edited since are
tagged *unsaved*), lists the versions, and disables **Save** while the newest
version already has every live case; while it does not, leaving or reloading the
page asks first (the same guard as the workflow definition editor). Each Eval Run
names the Dataset version it ran.

## MCP eval policy

Per MCP server of the Step's agent: `live`, `live` with named tools denied,
`replay`, or `deny`. A server the policy does not name runs live in eval trials.
Denied tools apply to a `live` server, and to a `replay` server while it runs
live to record a case; on a denied server they have no effect.
`mcp-policy-get` shows what each server does, defaults included, and which Eval
Cases each server has a recording for. The policy is set through the CLI
(`mcp-policy-set`) or `PUT /api/evaluation/mcp-policy`; the Evaluation tab does
not show it.

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

An Eval Run runs the Step, as its runnable Definition version has it — or the
version named (`run-prepare --version N`, `definitionVersion`; the tab prepares
for the version selected), never an archived one — over a frozen Dataset
version: every case, `trialsPerCase` times. Starting, stopping and reviewing a
run go by the version it was prepared for. A case cited by the
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
   A run whose trials the auto-runner would pause on a model — one the
   registry does not list or has retired, in the version or a challenger — is
   refused, at prepare and again at start, naming the model.
2. **Start** (`run-start --confirm-budget <usd>`) needs the budget echoed back —
   the person confirming what the run may spend. Without it the start is
   refused, which is also how an assistant's attempt to start one ends.
3. Each **trial** is a real Workflow Run flagged with the Eval Run's id. It
   enters the Step directly with the case's trigger payload and earlier step
   outputs, its workspace branched from the case's seed commit, and stops after
   the Step: no review task, no escalation, no next step. MCP servers the policy
   declares `deny` are removed from the agent's config; a Step that
   declares MCP servers inline cannot be evaluated at all. Just before the
   agent runs, the trial recomputes the Step Fingerprint; if the
   step or its agent changed since the run was prepared (model, system prompt,
   MCP bindings, …), the trial fails naming what changed, so no Score describes
   a step no one froze. Run lists, workflow
   summaries, monitoring, the Agents history and carry-over (`inputForNextRun`)
   leave trials out.
4. When a trial's run ends, every frozen Evaluator grades its Agent Run and
   writes a Score (`source: deterministic` or `llm_judge`, `metadata.evalRunId`).
   A trial whose run pauses before its Step starts — a missing secret, an
   unknown or retired model — fails with the run's error, and the next trial starts.
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
trial as errors, and judge verdicts left out (below `minConfidence` and not
accepted, or denied) as *left out*. A trial that could not be graded, whose
judge verdict was left out, or that failed before producing an Agent Run, stays
out of the pass rate but still counts toward its case's k,
so it can lower pass@k and pass^k, never lift them. Evaluators that do not
count are marked so. Tokens and duration come from the trials' runs; cost adds
the judge calls. Then:

- **Acceptance Criteria.** Each severity the frozen criteria set is `met` when
  every counted Evaluator of that severity reaches its floor — the pass rate
  itself, passes over graded trials (8 of 10 meets 80%), and pass^k where
  set — `missed` when one does not,
  and `not judged` when no counted Evaluator of that severity exists, one
  graded nothing it counts (a judge whose every verdict was left out), or — for a floor the scored trials reached — some trial
  failed or was skipped: a criterion is met on the whole Dataset. An Evaluator
  that grades no case of the run — an `expected_output` check while no case
  has an expected output, or one every case leaves unselected — is left out of
  the criteria, like one that does not count.
  A run prepared before any criteria were set freezes the default — every
  severity at 100%; one prepared before that default existed judges nothing.
- **Model verdicts.** Every judge verdict and agreement score per trial — case,
  pass or fail, the judge's confidence against its minimum or the agreement,
  whether it counts, the rationale
  and any review — with **Accept** and **Deny** for a person with `edit`
  (`report.judgeVerdicts`; `mediforce eval report` lists those left out).
- **Confidence calibration.** Whether the agent's own confidence can be
  trusted: the confidence each trial's agent reported,
  against whether its output passed every counted Evaluator — a trial some
  counted Evaluator could not grade is left out, since a missing Score is not
  a pass: the pass rate in five confidence bins and the expected calibration
  error (the count-weighted gap between stated confidence and pass rate; 0 is
  a perfect match). It is what lets routing send only low-confidence outputs
  to a person.
- **Routing.** Once the trials are done, as the `autonomyLevel` to
  set: `L4` (Control Mode 4) with a `confidenceThreshold` — the lowest
  confidence at which the outputs at or above it (at least 5) passed every
  counted Evaluator at a rate of at least the strictest criterion's floor; below it the step's `fallbackBehavior` applies — or `L3` (Control
  Mode 3), a person reviewing every output, when there are no criteria, one could not be judged, the agent
  reported no confidence, or no threshold holds. A recommendation to apply in
  the workflow editor.

- **Trial results.** Every trial with each of its case's Evaluators' grade —
  `pass`, `fail`, `excluded` (a model verdict left out) or `errored` — and
  comment, and whether it passed every counted Evaluator (`report.trialResults`).

### Reading an Eval Run

The Evaluation tab lists the step's Eval Runs as a table — ID, created,
status, cost against budget, Dataset version, **Acceptance** (how the champion
fared on the criteria frozen into the run: Met, Missed, Not judged or No
criteria; `acceptance` on `GET /api/evaluation/runs` and in `mediforce eval
run-list`) — and **Details** opens the run on its own page
(`/<workspace>/workflows/<name>/eval-runs/<evalRunId>`): its header (status,
acceptance, Dataset, trials, cost, Cancel while it runs, Start while
prepared) and five views, from the whole run to one trial:

- **Summary** — the report per variant: Evaluators, criteria, a challenger
  against the champion, confidence calibration and routing, and **Sign Step
  Qualification**.
- **Trials** — every trial with each Evaluator's grade, the agent's
  confidence, cost and time; filters for failed trials and trials with
  problems.
- **Evaluators** — per Evaluator, what it looks for (its rule) and how it
  checks, its numbers per variant, and its grade and comment on every trial.
- **Model verdicts** — every judge verdict and agreement score to **Accept**
  or **Deny**, each linking to what the judge read.
- **Problems** — trials that failed or that a check could not grade, with why,
  and replayed MCP calls no recording answered.

Each trial opens on its own page (`…/eval-runs/<evalRunId>/trials/<trialId>`;
`mediforce eval trial <evalRunId> <trialId> [--prompts]`,
`GET /api/evaluation/runs/:id/trials/:trialId`): the case's input and expected
output, the output and the agent's own summary, the agent's whole log as the
judges read it, links to the trial's Workflow Run and step execution, and per
Evaluator of the case what it looks for — a judge's question, or the rule —
and what it reads, its verdict and comment or why it could not grade, a
person's review, and for a model judge the exact messages it was sent. Those
messages are rebuilt from the Evaluator version frozen into the run and the
trial's input, log and output by the code that sent them
(`llmJudgeMessages`, `outputAgreementMessages`); the case is read as it is
now, so an agreement comparison's expected output reflects any later edit to
the case. Log entries a judge's rationale cites as `[n]` link to the entry,
which is marked in the log.

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
  Run the step again to verify it. A step that declares MCP servers inline
  cannot be evaluated, so it stays not verified until they move onto its agent.

It comes with `GET /api/evaluation/qualification` as `validation: { status,
evalRunId, reason, runInProgress }`, as the first line of `mediforce eval
qualification`, and in the assistant's `get_qualification`. In the Evaluation
tab it is the status at the top — **Validation passed**,
**Validation failed** or **Not verified**, with the reason on hover; clicking it
also shows the signed Step Qualification, if any. The tab reads it again every
few seconds while an Eval Run of the step is running. A signed qualification
does not change it, and it blocks nothing.

A **workflow version** is **Verified** when every agent step's validation in it
passed, **Failed** when any failed, and **Not verified** otherwise (also with
no agent step, where no badge is shown). `mediforce eval validation`,
`GET /api/evaluation/workflow-validation?namespace=&workflowName=` list every
live version, newest first, with each agent step's validation; archived
versions are left out. The **Definitions** tab shows the badge on each version,
linking to that version on the Evaluation tab on its first failed step, else
its first not verified one; in the workflow editor, each agent step's box
carries its validation icon for the version being edited, linking to the
Evaluation tab on that step and version. The icon speaks of the step as saved:
a step added or edited since carries none until the version is saved and run.
