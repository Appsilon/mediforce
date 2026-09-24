---
status: living
audience: workflow-authors
last_reviewed: 2026-09-24
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
  calibration, cases, Eval Runs and reports, each challenger compared with the
  champion (`compare_variants`), the step's qualification and Acceptance
  Criteria (`get_qualification`), and `preview_evaluator` — it tries a check
  on real outputs before proposing it.
- **Proposes:** Evaluators and new versions of them, Eval Cases (harvested,
  written or synthesized), Brief drafts and Acceptance Criteria come back as
  cards to accept, edit or reject. Accepting one is the same write the forms
  make, recorded with `origin: assistant`. A routing recommendation (Control
  Mode and `confidenceThreshold`) comes back as a card to apply in the
  workflow editor.
- **Prepares:** it can prepare an Eval Run, with challengers; the run starts
  only when the person confirms its budget on the card. Its own start attempt
  is refused.
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
- **Rule to check.** A plain-language rule becomes the cheapest reliable kind —
  `schema`, then `code`, a judge only when a script cannot decide it. Every
  proposed check is tried by the platform on the step's recent production
  outputs before the card is shown (reusing the assistant's own preview of the
  same check), and the card shows what it did. A check that errors on every
  output goes back to the assistant instead of to the person; for a person
  without the `run` verb the card says it was not tried. The try runs the check
  on up to 5 outputs, so it is not free: a `code` check starts a sandbox per
  output, and an `llm_judge` pays for a model call per output — a turn that
  proposes a judge the assistant did not preview takes longer and costs more. A
  refined rule is a proposed new version of the Evaluator.
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
--pass|--fail` records a human Score on an Agent Run (`evaluator-labels` lists
the newest per run), `evaluator-calibrate` runs the judge over the labelled
runs and stores the agreement and Cohen's κ — agreement beyond what the
pass/fail mix gives by chance. Labels belong to the Evaluator, not a version,
so a refined rule is recalibrated against the same labels. Only agreement
decides whether a judge counts. `cases-from-labels <evaluatorId>` turns every
labelled production output that is not yet a case into one — a pass positive,
a fail negative, noting the rule and the person's comment.

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

A **synthesized** case (`case-perturb --file`, `POST /api/evaluation/cases/perturbed`)
is a production run's case with deliberate changes, and records what kind
(`missing_file`, `extra_file`, `renamed_columns`, `edge_values`,
`injected_instruction`, `other`) and why. `inputChanges` set or remove values
under the trigger payload, the earlier steps' outputs or the carry-over;
`fileChanges` write, delete or edit (replace the first occurrence of a text in)
files of the workspace the run started from, and are written as a new commit on
the workflow's bare repo, kept by the ref `refs/mediforce/eval-seeds/<caseId>`,
which the case starts from. A change that does not apply — removing what is not
there, editing a file that is missing or binary, file changes on a run with no
workspace — is refused. It is built from production data, so it is flagged as
containing it.

`dataset-freeze` freezes the live cases into a numbered Eval Dataset version.
A version never changes.

## MCP eval policy

Per MCP server of the Step's agent: `live`, `live` with named tools denied, or
`deny`. A server the policy does not name is denied in eval trials.
`mcp-policy-get` shows what each server does, defaults included.

## Eval Runs

An Eval Run runs the Step, as its runnable Definition version has it — the
**champion** — and up to three **challengers** over a frozen Dataset version:
every case, `trialsPerCase` times, per variant. A challenger is a patch over
the champion (`run-prepare --challengers <file>`, `challengers` in
`POST /api/evaluation/runs`): `model`, `prompt` and `allowedTools` replace the
step's own, `mcpRestrictions` narrow it (servers the agent binds only),
`skillCommit` moves the workflow's `externalSkillsRepo` commit. A challenger
that changes nothing, or runs the same step as another variant, is refused.
Few-shot examples come with `agent.examples` in phase 4.

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
   does not declare `live` are removed from the agent's config; a Step that
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
| `step` | the agent config, plugin, agent id, params, step params, env and MCP restrictions — not its name, display, `autonomyLevel`, `review`, `confidenceThreshold` or `fallbackBehavior` |
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
becomes Qualified once the step is changed to match it. Evaluators added,
archived or given a new version since are flagged beside it, without making
it stale. The badge is informational: nothing is blocked without one.
