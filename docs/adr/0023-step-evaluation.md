---
status: accepted
audience: engineers
last_reviewed: 2026-10-02
---

# 0023 — Step Evaluation: Evaluation Assistant, Evaluators, single-step Eval Runs, Step Qualification

- **Status:** Accepted
- **Date:** 2026-09-22
- **Authors:** Krystian Zielinski (@Griphu), with Claude
- **Supersedes in part:** [ADR-0007](./0007-llm-evaluation-observability.md)
  § Deferred (the entity design for layers 2–4). ADR-0007 D1–D5 stay binding.
- **Research:** [`../research/step-evaluation.md`](../research/step-evaluation.md)
  (landscape, capabilities, phasing), building on
  [`../research/layer2-scores-research.md`](../research/layer2-scores-research.md).
- **Amended 2026-10-01:** optimisation — challengers and applying them (D5's
  variant half), few-shot examples (D12), the fix loop and GEPA (D15) and a
  case's positive/negative expectation — moved to
  [ADR-0024](./0024-optimisation.md) (Proposed) and out of the UI; built-in
  Evaluators and case suites removed (D3); neither a Step Qualification nor
  an Eval Run cites the Evaluation Brief (D10, D16).
- **Amended 2026-10-02:** an `llm_judge` is no longer calibrated against human
  labels; it reads the agent's Trajectory, answers pass/fail with a confidence
  and a rationale, and each verdict is gated by its `minConfidence` and a
  person's review (D3, D9, D15). Labels and written outputs are removed.
- **Amended 2026-10-02 (D17):** an Eval Case carries an expected output with a
  positive/negative expectation, an `expected_output` Evaluator compares it
  exactly or by an agreement score, and a case names the Evaluators that grade
  it. Case notes are removed. The expectation is back from ADR-0024 with a
  meaning evaluation reads.
- **Vocabulary:** Evaluation, Evaluation Assistant, Evaluation Brief, Evaluator, Eval Case, Eval Dataset, Eval Run,
  Agent Trajectory, Step Fingerprint, Acceptance Criteria, Step Qualification
  — all in [`CONTEXT.md`](../../CONTEXT.md) § Evaluation domain.

## Context

ADR-0007 named four layers (Traces → Scores → Eval Datasets → Eval Runs),
shipped layer 1, and deferred the rest. Workflow authors now need to answer,
per agent Step: *can this Step, in this configuration, be trusted for its
context of use?* — and when not, be helped to fix it. The help is an agent
the user works with through the whole Evaluation, not a set of forms. Pharma framing sets the
bar: the FDA AI credibility framework and the FDA–EMA Good AI Practice
principles (2026-01) assess credibility per context of use, proportional to
model risk, against acceptance criteria set in advance.

## Decisions

**D1 — Vocabulary: Evaluation, not validation.** In pharma *validation* means
Computer System Validation of the platform, and in `CONTEXT.md` it already
names schema-shape checking of a Definition. The activity is Evaluation, a rule
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
OpenRouter, as the layer-2 research recommends. _Amended 2026-10-01: the
`builtin` kind (`phi_leak`, `injection_ignored`, `result_stable`) and the
red-team and robustness case suites it graded were removed; what they were and
where their code is is in
[#1441](https://github.com/Appsilon/mediforce/issues/1441)._

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
Editing Step B never touches Step A. _Amended 2026-10-01: variants beside the
step as it is (challengers) and applying one are parked in
[ADR-0024](./0024-optimisation.md); an Eval Run runs the step as its runnable
Definition version has it, and the Fingerprint binding stands._ _Amended 2026-09-24 (Phase 3): the image
enters the Fingerprint as the reference the runtime resolves — its tag, or the
files and commit a build uses — not a registry digest, which would need a
registry lookup per Fingerprint. A tag re-pushed under the same name does not
change the Fingerprint; pin an image by digest (`image@sha256:…`) where that
matters._

**D6 — Default-deny eval policy for MCP servers.** Each MCP server a Step can
use carries an eval policy: `live`, `deny`, or `live` with named tools denied.
Undeclared servers are denied in trials. The policy applies as extra
subtractive `mcpRestrictions`. It is **not** part of the Fingerprint; the Eval
Run report and the Step Qualification state it ("qualified with `edc-write`
denied"). Container network egress is out of scope — trials inherit production's. _Amended 2026-09-28:
a third mode, `replay`. A live trial records, per Eval Case and
server, the tool list and every tool call with its result, through a proxy the
trial's MCP config starts in the server's place. A replayed server is answered
from the newest recordings of that case — the newest recording of each distinct
call, matched on tool and canonical arguments — and is never reached, so a
side-effecting tool is safe to exercise. An unrecorded call, or one made more
often than it was recorded, gets an error result, is kept on the trial, and is
counted in the report; a trial whose unrecorded calls cannot all be read fails
rather than under-count, and a replayed server no live trial of the case
recorded fails the trial closed. The report says when no server was live, i.e.
no trial made a live MCP call. Recordings are keyed by case and server only —
not by variant or Fingerprint — so a challenger replays what any live trial of
the case recorded. The proxy runs inside the agent's container and keeps its
files where the agent can write, so a recording is only as trustworthy as the
agent that ran beside it; isolating it from the agent is a later change
([#1432](https://github.com/Appsilon/mediforce/issues/1432))._ _Amended
2026-10-01: a replayed server no live trial of the case recorded no longer
fails the trial closed — it runs live for that trial and records, so `replay`
means "record each case once, then replay it" and an author never switches a
server from `live` to `replay` by hand. A `replay` server may name denied
tools, which hold while it records. The report counts, per replayed server,
the cases this run recorded that way, and claims no live MCP call only when
there were none and no server was `live`._ _Amended 2026-10-02: default-live.
A server the policy does not name runs `live` in trials (recording each case),
not denied; `deny` and `replay` stay available through the CLI and API. The
Evaluation tab no longer shows the policy._

**D7 — Evaluators are versioned; a version that produced a Score is
immutable.** Eval Runs record the Evaluator versions used; a Step
Qualification cites them. A newer Evaluator version flags the qualification
("evaluators changed since qualification") without making it stale.

**D8 — Agent Trajectories are persisted for every Agent Run.** The tool-call
record the plugins already produce for the step's activity log also becomes a
durable platform artifact keyed by `agentRunId`. The activity log stays the
live view of a running step; the Trajectory is recorded from the same
formatted entries, so the two never disagree. It is stored in the platform's own
database and keeps full content: ADR-0007 D5's switch limits what reaches the
external trace store, and D5 keeps full content in the platform. It is a
table of its own rather than more `agent_events` rows: those are the live
per-step progress feed, children of a process instance and keyed by step,
while a Trajectory belongs to one Agent Run, which an Eval trial needs to read
without reaching into the run's step events.

**D9 — Only trusted Evaluators count toward Acceptance Criteria.**
`schema` is active on creation. `code` needs a recorded human approval of its
source, whoever wrote it. `llm_judge` needs agreement at or above a set level with
at least 10 human-labelled outputs, at least 2 of them failures, per version.
`human` is ground truth. Draft Evaluators appear in reports as "not counted".
_Amended 2026-10-02: judge calibration is removed — labelling enough outputs,
failures above all, cost more than it bought, and agreement on a few labels
said little about the next verdict. An `llm_judge` counts on creation and is
gated verdict by verdict instead. It reads the step's input, its Trajectory
(D8) and its output, and answers pass or fail with a confidence and a rationale
— what decided the verdict and why. A verdict below its version's
`minConfidence` (0.8 by default) is reported but left out of the criteria. A
person reads the rationale in the report and accepts the verdict, so it counts
whatever its confidence, or denies it, so it is left out; a denial never
reverses the verdict. The review is a human Score that a later review
supersedes. Labels, written outputs and the cases seeded from labels went with
calibration. A written output was a person's corrected answer kept to calibrate
a judge against — not an expected output (D17), which grades the agent._

**D10 — Acceptance Criteria are fixed before the run and judged on the pass
rate.** Criteria per severity (critical / major / minor) are frozen into the
Eval Run. The report judges the pass rate itself — passes over graded trials,
so 8 of 10 meets an 80% floor — and reliability by pass^k; the Wilson 95%
interval is reported beside each rate, not judged. A human signs the Step Qualification; signing despite a
missed criterion records a deviation with a written justification. _Amended
2026-10-01: a Step Qualification rests on the Eval Run it was signed from and
nothing else — its Fingerprint, Evaluator versions, MCP policy, criteria and
verdicts. It no longer cites an Evaluation Brief version, and a run prepared
without a Brief can be signed. Beside it, a step's **validation** is derived,
never signed: the newest finished Eval Run of the workflow version, passed or
failed on its criteria, and `not verified` once the step's Fingerprint, its
Evaluators, its Eval Cases or its Acceptance Criteria change since that run.
Until a step's criteria are set, every severity defaults to a 100% floor:
every graded trial passes. Amended again the same day: floors were first
judged on the Wilson 95% lower bound, which made a floor read as something
other than the share of trials that passed (8 of 10 missed an 80% floor);
every floor is now judged on the pass rate itself._

**D11 — Step Qualification is informational.** A badge (Qualified / Stale /
Not qualified) on the Step and in run views. Nothing is blocked: no Control
Mode is refused and no run is downgraded when a qualification is missing or
stale. ADR-0007 D2's example of a model swap "gated on a green Eval Run" is
therefore **not** adopted; a swap shows as Stale.

**D12 — Few-shot examples are a structured, provenance-tracked field.**
_Moved 2026-10-01 to [ADR-0024](./0024-optimisation.md) D5; not binding until
that ADR is accepted._
`agent.examples` holds `{input, output, note?}` pairs rendered as their own
prompt section and included in the Fingerprint. Each records the Eval Case it
came from; that case is excluded from scoring in later Eval Runs of the Step.
Holdout cases are never offered as examples.

**D13 — Production Evaluators are opt-in; only deterministic ones gate.** An
Evaluator marked "also run in production" scores live Agent Runs. `schema` and
`code` run synchronously; a failing critical one triggers the Step's existing
`fallbackBehavior`, as low confidence does. `llm_judge` runs asynchronously and
only writes Scores. Human verdicts on CM3 reviews become Scores automatically,
best-effort until handlers get a cross-repository transaction (#516): the verdict
itself is always on the task and its `task.completed` audit event.
`outputSchema` violations, after one retry with the first violation, follow
the same fallback route; the retry shares the step's timeout.

**D14 — One Evaluation Assistant, built on the workflow assistant's
blocks.** A single assistant per Step covers the whole Evaluation: suggest a
plan, draft Evaluators and Eval Cases, prepare and explain Eval
Runs, diagnose failures, propose fixes. It reuses the workflow editor
assistant's design — an OpenRouter tool-calling loop, Zod tool registries in
`platform-core`, *mutation* tools returned as proposals versus *platform* tools
run server-side as the caller through `CallerScope`, one audit event per
request. That loop moves into a shared assistant core in `platform-api` that
both assistants use. The building blocks move first (audit, tool definitions,
argument parsing, the caller-scoped platform-tool runner); the workflow
assistant keeps its own loop until it can move onto the shared one without
losing its canvas gates and truncation salvage. Heavy work is exposed as platform tools, never done by the
model itself: `preview_evaluator` runs a draft check (in `script-container`
for `code`) against existing outputs of the Step so the assistant sees a check
fail on real outputs before proposing it. Every tool wraps a headless handler
(ADR-0005), so the CLI and the manual UI get the same operations.

**D15 — The assistant's authority is tiered by consequence.**
- *Runs freely:* reads (Step config, SKILL.md, MCPs, runs, trajectories,
  reports, Scores) and `preview_evaluator`.
- *Proposes; the user accepts:* Evaluators, Eval Cases, Acceptance Criteria,
  Evaluation Brief drafts, fix variants, changes to the Step itself.
- *Prepares; the user confirms with the cost shown:* starting an Eval Run.
- *Never:* signing a Step Qualification, approving a `code` Evaluator's
  source, accepting or denying a judge's verdict (amended 2026-10-02; was
  labelling calibration outputs) — D9 and D10 require these to be human.
  Unattended fix attempts (Phase 4) run only under a budget the user grants per
  request.

_Amended 2026-10-01: proposing fixes as challengers (`propose_fix`) and GEPA
optimisation — the two amendment paragraphs below — moved to
[ADR-0024](./0024-optimisation.md) and are not binding until it is accepted.
The assistant no longer has those tools; an unattended budget covers starting
Eval Runs only._

_Amended 2026-09-29 (Phase 5): a GEPA optimisation is such an attempt. Its
budget is granted with the request that starts it — the person's own start, or
an assistant request's unattended budget — and covers both its job, charged at
the reflection model's registry price, and the Eval Run of its candidates, which
starts with that grant as its confirmation. The job runs in its own container
with network egress, for the reflection model, and the workspace's OpenRouter
key; it reflects only on dev-case trials, since holdout cases are what its
candidates are judged on. Applying a winner stays the person's._

_The job runs one round of GEPA's reflective proposal step, not its evolution
loop: each round's candidates become an Eval Run the person can read and stop,
and the next round starts from its winner. A multi-round loop inside one job
would spend without a checkpoint and could not be held to the grant call by
call. For the same reason its input is narrow: the current prompt, the Evaluator
feedback, and the tools a trajectory called — not their inputs and results,
which would multiply the reflection prompt. A start is refused when the job's
worst case (every call on the largest records at its full output allowance)
leaves nothing of the grant. Candidates are ranked by holdout first, as the job
fitted them to dev; since every round that picks a winner by holdout fits the
prompt to it a little, the assistant suggests fresh holdout cases after a few
rounds._

**D16 — An Evaluation Brief states each Step's context of use.** A short,
versioned text per Step — what it is for, who relies on its output, which
failures matter most — written by the user or drafted by the assistant and
accepted. It is sent to the assistant on every turn and seeds the evaluation plan
and the Acceptance Criteria suggestions. _Amended 2026-10-01: a Step
Qualification no longer cites the Brief version (it used to, as its
context-of-use statement); tying the two made a Brief a precondition of
signing and a second thing a qualification could be wrong about. The
qualification is linked to its Eval Run only. An Eval Run no longer records
the Brief version in force at prepare either: nothing read it, and the Brief is
the assistant's context, not part of what a run is judged on. It is shown and
edited from the Evaluation Assistant's header, not as a section of the tab._
The workflow assistant's per-user instructions
are not reused: priorities belong to the Step, not to a person.

**D17 — A case may expect an output, and names the Evaluators that grade it.**
_Added 2026-10-02._ Rules say what any output must do; many steps also have a
known right answer — or a known wrong one — for a given input, which a rule
restates badly. So an Eval Case carries an optional `expectedOutput`, an
`expectation` (`positive`: the output must match it; `negative`: it must not)
and a `comparison`: `exact`, where any difference fails, or `agreement`, where a
model scores 0–1 how far the outputs agree. The comparison is an Evaluator kind,
`expected_output` (`model`, `instructions`, `minAgreement` for positive
cases, `maxAgreement` for negative ones), not a built-in, so
it has a severity, versions, a report row and a place in the Acceptance
Criteria like any other check, and one model choice serves every case; a case
adds its own `agreementInstructions` (what is trivial, what decides). It counts
at once (D9) — an exact match needs no trust; an agreement verdict is a model's,
so like a judge's it is listed in the report for a person to accept or deny
(D9) — never runs in production (D13: production has no
expected output), is never previewed, and its kind is fixed across versions.
A case's `evaluatorIds` (null: every Evaluator of the Step) say which
Evaluators grade it; an Evaluator a case does not select is *not applicable*
to its trials — neither a pass, a failure nor an error — and one that grades no
case of a run is left out of its Acceptance Criteria, like one that does not
count, so an expected-output check before any case has an expected output does
not leave a severity unjudged. The comparison is chosen per case, not on the
Evaluator: editing a case makes a new case, so a run's cases fix what each
comparison measured. A harvested run a person
reviewed brings its output as the expected output: approved positive, rejected
negative. Free-text case notes, which only an `llm_judge` read, are removed: a
rule belongs in an Evaluator, an answer in the expected output. The `llm_judge`
is told neither, so its verdict stays a judgement of the output against its
rubric.

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
- **A container agent (Claude Code + `mediforce-mcp`) as the Evaluation
  Assistant**, or a chat front with container workers behind it. It could
  execute the checks it writes, but it is slow and costly per turn and would be
  a second assistant architecture. D14 gets the same "test before proposing"
  property from a `preview_evaluator` platform tool. Rejected.
- **Forms first, assistant later.** The forms would be built to be bypassed;
  the assistant is the primary surface from Phase 1b. Rejected by D14.
- **Trajectories read from the trace store.** Content is off in production by
  default and the store may not exist. Rejected by D8.
- **Trajectories as `agent_events` rows with an `agentRunId`.** One store
  fewer, but it mixes the Agent Run's record with the step's progress feed and
  its instance-scoped lifecycle. Rejected by D8.

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
- Delivery is phased (1a foundations → 1b Eval Runs with the Evaluation
  Assistant → 2 assistant planning and calibration → 3 qualification → 4 fix
  loop → 5 optimisation and red-team; 4 and 5 parked in
  [ADR-0024](./0024-optimisation.md) and the built-in red-team suites removed
  on 2026-10-01); from 1b on, each phase adds tools to the
  one assistant rather than screens. Tracked in the
  Step Evaluation epic [#1394](https://github.com/Appsilon/mediforce/issues/1394).
