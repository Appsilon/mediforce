---
status: accepted
audience: engineers
last_reviewed: 2026-10-29
---

# ADR-0029: An Agent can own an Evaluation, and an Eval Run assesses one Agent version

**Date:** 2026-10-15
**Deciders:** Krystian Zieliński
**Issue:** [#1521](https://github.com/Appsilon/mediforce/issues/1521) (epic [#1516](https://github.com/Appsilon/mediforce/issues/1516), B1)
**Partially supersedes:** [ADR-0023](./0023-step-evaluation.md) D2 ("owned by
one Step"), and the CONTEXT.md note that an Agent "is not versioned today".
ADR-0023 D3–D17 stay binding for an Agent's Evaluation except where a decision
below names them.

## Context

ADR-0023 evaluates an agent Workflow Step: every Evaluator, Eval Case, Dataset,
Acceptance Criteria, MCP eval policy, Eval Run and Step Qualification is keyed
by `(namespace, workflowName, stepId)`. An Agent powers many Steps, and people
want to know whether the Agent itself can be trusted before any workflow uses
it — with a suite that stays with the Agent while its prompt or model changes,
and a record of exactly which configuration each Eval Run assessed. Agents were
mutable and unversioned, so "the configuration it assessed" had nothing to
point at.

## Decision

1. **An Evaluation is owned by a Step or by an Agent.** Every Evaluation row
   carries an owner: `workflowName` + `stepId`, or `agentId`, never both — in
   the owner's namespace. A request names its subject the same way
   (`EvaluationSubjectRefSchema`); handlers resolve it to an
   `EvaluationSubject` (`kind: 'step' | 'agent'`). In Postgres the unused owner
   columns hold `''`, not null, so the owner stays in the primary keys and
   unique indexes; `<table>_owner_check` enforces exactly one owner. An Agent's
   suite is reusable by living with the Agent: it outlives every edit, and each
   Eval Run of it is read against the Agent version it ran. Reusing it from a
   Step is not part of this decision.

2. **Agents are versioned.** An Agent version is an immutable snapshot of what
   shapes its behaviour — `kind`, `runtimeId`, `foundationModel`,
   `systemPrompt`, MCP bindings, and each Skill it holds by content hash — and
   the SHA-256 of that snapshot. Its name, icon, descriptions and visibility
   are left out: a rename is not a new version. A version is recorded when the
   Agent is created or saved, its MCP bindings change, or an Eval Run of it is
   prepared, whenever the snapshot's hash differs from its newest version's.
   A Skill edited in the catalog therefore becomes a new Agent version at the
   next save or Eval Run. Saving the Agent and recording its version are two
   writes with no transaction across them: a save whose version write fails
   leaves that configuration unrecorded until the next save or prepare, never
   an Eval Run naming a version it did not run. `GET /api/agents/:id/versions` (`mediforce agent
   versions`) lists them and says which one the Agent has now. _Amended
   2026-10-16: the snapshot also holds the Agent's `outputSchema` when it
   declares one (decision 7); an Agent without one keeps the hash it had._
   _Amended 2026-10-21: and its `image` when it names one (decision 9); an
   Agent without one keeps the hash it had._

3. **An Agent's Eval Run assesses one Agent version.** Prepare records the
   version and freezes `agentVersion` on the run (`definitionVersion` is null);
   the run's output carries that version's snapshot (`assessedAgentVersion`),
   so the run shows the exact configuration it assessed whatever the Agent has
   become. The run also carries the Step Fingerprint (ADR-0023 D5) of the
   single step below, and a trial refuses to run when the Agent changed since
   prepare, as a Step's does.

4. **A trial runs the Agent as a single-step Workflow Run (ADR-0023 D4).** The
   trial's Definition is built from the Agent: one agent step `agent` naming it,
   with its runtime as plugin and nothing of its own — no prompt, model, Skills,
   MCP restrictions or preamble. No Workflow stores it: the process instance
   carries it as `evalDefinition`, and the engine, the auto-runner and the agent
   step executor read it from there. Engine, executors, Agent Run, Trajectory,
   cost and audit stay the production path. The Eval Case's `triggerPayload`
   is the Agent's whole input — the trial's step is given it alone, and an
   Agent's case takes no `previousStepOutputs` or `previousRun`; its workspace
   starts empty, so the case takes no workspace seed. _Amended 2026-10-16: the
   one thing the trial's step may add is `env` — the step env a Workflow Step
   would declare, as secret templates such as `{{OPENROUTER_API_KEY}}`, never
   values — since no Step exists to declare it and the run pre-flight would
   otherwise refuse a runtime that needs a key. It changes where the Agent
   runs, not what it is, so it is not part of the Agent version. The Agent's
   Evaluation holds it beside its MCP eval policy (`mcp_eval_policies.env`, set
   from the Evaluation tab or `mediforce eval mcp-policy-set --env`), and each
   Eval Run freezes a copy at prepare (`eval_runs.env`)._ _Amended 2026-10-21:
   the trial's step names the Agent's image, or the golden image when the
   Agent names none (decision 9), so a trial runs with the tools the Agent is
   meant to have rather than in no image at all. Under `ALLOW_LOCAL_AGENTS` an
   Agent that names no image still runs its trial on the host._

5. **Production-only features stay a Step's.** An Agent has no production runs
   of its own — its runs belong to the Steps that use it. Harvesting a case
   from a run, perturbing one, previewing a check on past outputs, drift, and
   production Evaluators (ADR-0023 D13) are refused for an Agent; the
   Evaluation Assistant is told so and writes cases by hand. _Amended
   2026-10-15: it may read the production runs of the Steps that use the Agent
   — in a version that gave the step this Agent — and write the Agent's cases
   from what they were given, flagged as containing production data. They
   stay written cases: nothing is harvested. The assistant is one, with a
   toolset per subject (ADR-0023 D14)._ Only a container
   (`plugin`) Agent of a workspace, with a runtime, is evaluated: a cowork
   Agent has no single output to grade, and a platform-global Agent has no
   workspace for its Evaluation to live in.

6. **Qualification and validation work on the Agent version.** An Agent's
   validation is read from the newest finished Eval Run of its current version,
   and `not_verified` once the Agent changed since; a Qualification of it
   cites `agentVersion` and is signed as for a Step (ADR-0023 D10, D11).
   Reading and changing an Agent's Evaluation follows the Agent: reading needs
   to see it, editing and running need to be allowed to change it. Its rows
   stay in the Agent's workspace, so an Agent that owns any cannot move to
   another workspace.

7. **An Agent may declare its output schema.** _Added 2026-10-16._ An Agent's
   `outputSchema` is the JSON Schema subset `step.agent.outputSchema` uses
   (ADR-0023 D13). A Step that runs the Agent and declares no `outputSchema` of
   its own inherits it, as it inherits the model — so the schema reaches the
   prompt, `AgentRunner` checks `result` against it, and the trial of decision 4
   (which declares nothing) runs under it. It is part of the Step Fingerprint
   through the step config. Without it an Agent is never asked to answer as
   JSON, so a `schema` Evaluator fails every trial on its prose: the Evaluation
   Assistant does not propose one for an Agent that declares no output schema,
   and tells the person to declare it first.

8. **A Workflow Step that runs a validated Agent as it is shares its
   validation.** _Added 2026-10-16._ A Step runs its Agent as it was validated
   when it adds nothing to the trial of decision 4: no other runtime or model,
   no prompt, Skills, output schema or MCP servers of its own, no MCP
   restriction that removes something, and no workflow preamble
   (`agentStepChanges`). What the Step provides around the Agent — params,
   `stepParams` (which map run values onto the Agent's flat input, #1599),
   env, timeout, autonomy, review — is not a change. _Amended 2026-10-21: an
   Agent names an image (decision 9), so a Step that runs another image than
   the Agent's, or builds its own, changes it; the image decides which tools
   the Agent has._ Such a Step with no verdict of its own, in the Agent's own workspace
   (whose tool catalog its trials resolved MCP servers from), reads the
   Agent's validation when the Agent's current version passed, so a workflow
   whose agent steps all do is Verified without an Eval Run of its own; a
   Step's own verdict, once read, stands. The workflow editor marks a
   validated Agent the Step runs as it is, and asks before a change to the
   Step that makes it stop doing so — from then on the Step needs its own
   validation on the workflow's Evaluation tab. A preamble is edited in the
   workflow's settings, which do not ask.

9. **An Agent may name its image.** _Added 2026-10-21; reverses "an Agent
   names no image" in decisions 4 and 8._ A container Agent's `image` is an
   image tag — never a build source; an Agent has no repo or commit of its
   own. Unset means the golden image (`agentImageOf`). It is part of the Agent
   version when set (decision 2) and the trial of decision 4 runs in it. A
   Workflow Step that names neither an image nor a build source is given its
   Agent's image when its Workflow is saved (`registerWorkflow`), so every
   saved Definition still names its image and the CLI, API and editor behave
   alike. The Step records the image: a later change to the Agent's image does
   not move it, and with decision 8 such a Step reads as changing the Agent
   until it is saved with the new image or validated on its own. Picking
   another Agent for a Step in the editor drops the image the previous Agent
   gave it — its image now or in any of its versions — so the next save gives
   it the new Agent's.

10. **A Step that changes its Agent can run the Agent's suite.** _Added
    2026-10-29; narrows "reusing it from a Step is not part of this decision"
    in decision 1 to a Step the Agent still runs unmodified but for the change
    that lost it decision 8 — never an Agent on its own._ From the Step's
    Evaluation tab (`prepareEvalRun`, `useAgentSuite`), a person can prepare
    the Step's Eval Run with the Agent's Evaluators, Eval Cases and Acceptance
    Criteria instead of the Step's own, frozen onto it exactly as the Step's
    own would be. The run stays owned by the Step — its verdict, once it
    finishes, is the Step's own and reads under decision 8 like any other,
    replacing whatever the Step inherited from the Agent. Only the workflow's
    first step may: an Agent's Eval Case carries no `previousStepOutputs`
    (decision 4), so a later step has nothing to give it from earlier steps.
    The run records which Agent its suite came from
    (`eval_runs.suite_agent_id`); a Step's staleness check (ADR-0023 D7) reads
    that Agent's live Evaluators, Eval Cases and Acceptance Criteria for such a
    run, not the Step's own.

## Considered options

- **A reserved pseudo-workflow per Agent (`workflowName = "agent:<id>"`).** No
  schema change, but every access check and listing would special-case the
  prefix, and workflow names are not restricted, so it could collide with a
  real workflow. Rejected for an explicit owner.
- **Storing a hidden single-step Workflow per Agent.** Trials could load it like
  any Definition, but it would surface in workflow lists, catalogs and access
  rules. Rejected for carrying the Definition on the trial's run.
- **Driving `AgentRunner` directly for an Agent's trials.** Rejected by
  ADR-0023 D4: the evaluated path would no longer be the production one.
- **Recording only a snapshot on the Eval Run, without Agent versions.** Answers
  "what did this run assess" but not "is this the same Agent as that run";
  versions make the comparison a number.

## Consequences

- Migration `0082_agent_evaluation` adds `agent_id` to every Evaluation table,
  rebuilds their keys, makes `eval_runs.definition_version` nullable, and adds
  `eval_runs.agent_version`, `process_instances.eval_definition` and
  `agent_versions`.
- Agents created before this decision have no version until their next save or
  Eval Run; the first one recorded is version 1.
- The Agent page gains an Evaluation tab with the Step Evaluation sections and
  the Evaluation Assistant; an Agent's Eval Runs live under
  `/agents/definitions/:id/eval-runs/:evalRunId`. The CLI's `mediforce eval`
  commands take `--agent` in place of `--workflow` and `--step` where an Agent
  can be the subject.
- Migration `0087_eval_run_suite_agent` adds `eval_runs.suite_agent_id`
  (decision 10). `mediforce eval run-estimate`/`run-prepare` and the Step's
  Evaluation tab take `--use-agent-suite`/a checkbox, shown only on a
  workflow's first step that names an Agent.
