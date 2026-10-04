---
status: proposed
audience: engineers
last_reviewed: 2026-10-04
---

# 0024 — Optimisation: challengers, fix variants, GEPA and case expectations

- **Status:** Proposed
- **Date:** 2026-10-01
- **Authors:** Krystian Zielinski (@Griphu), with Claude
- **Takes out of:** [ADR-0023](./0023-step-evaluation.md) — the variant half of
  D5, D12, the Phase 4 fix loop of D15 and its 2026-09-29 GEPA amendment. The
  positive/negative expectation of an Eval Case was parked here too; on
  2026-10-02 it went back to ADR-0023 (D17) as the expectation of a case's
  expected output. ADR-0023 stays binding for everything else; none of what is listed here is binding until this ADR is
  accepted.
- **Code reference:** every mechanism below was built and tested at commit
  [`aa8ac636`](https://github.com/Appsilon/mediforce/tree/aa8ac636f773342f4fdbd90f5d9529ccdb92d651)
  on `feat/review-of-evaluation`. That commit is the reference implementation to
  reuse — read the code there, not the living docs, which no longer describe it.
- **Amended 2026-10-04:** the parked backend is deleted (the open question
  below); the pinned commit is now the only copy.

## Context

ADR-0023 set out to answer *can this Step be trusted for its context of use?*
and then went on to *and how do we make it better?* — challengers, a fix loop,
GEPA prompt search, few-shot examples, applying a winner back to the step. By
2026-10-01 the Evaluation tab carried both, and the second half crowded out the
first: an author qualifying a step met challenger JSON, an Optimisations
section, fix cards and a positive/negative choice on every Eval Case, none of
which a Step Qualification needs.

So the supported surface was cut back to evaluation: Evaluators, Eval Cases,
Eval Runs of the step as it is, Acceptance Criteria and Step Qualification.
Optimisation is parked here, as a proposal, until there is a reason to bring
it back. Its backend (handlers, REST routes, client methods, CLI commands,
tables, the GEPA job) was at first kept, unreachable from the web tab and the
Evaluation Assistant; on 2026-10-04 it was deleted, with migration
`0072_drop_eval_optimisation.sql` dropping `eval_optimisations` and
`eval_runs.example_case_ids`. Stored rows are not rewritten — a signed Step
Qualification never changes (ADR-0023 D10) — so a variant patch stored with
`examples` keeps it, and the patch schema ignores it on read. Validation of a
step whose newest run left example cases out reads not verified, since that
run no longer covers every live case. A trial of a challenger still pending is
refused rather than run unpatched.

## What is parked, and where it lives at `aa8ac636`

| Mechanism | What it does | Code |
|---|---|---|
| **Variants / challengers** | An Eval Run runs the step as it is (the *champion*) and up to three *challengers*, each a patch (`model`, `prompt`, `skillCommit`, `allowedTools`, `mcpRestrictions`, `examples`) over the pinned Definition version. Each variant has its own Step Fingerprint. | `platform-core/src/evaluation/variant.ts`, `StepVariantPatchSchema` in `platform-core/src/schemas/evaluation.ts`, `challengers` in `PrepareEvalRunInputSchema` (`platform-api/src/contract/evaluation.ts`), `handlers/evaluation/eval-runs.ts`, CLI `eval run-prepare --challengers` |
| **Champion–challenger comparison** | Per Evaluator, `better`/`worse` only when the Wilson 95% intervals do not overlap, plus cost and duration deltas. | `handlers/evaluation/_lib/eval-run-report.ts` (`comparison`) |
| **Apply a variant** | Saves a challenger's patch as a new Workflow Definition version through `registerWorkflow`, optionally as the default, and says whether its Fingerprint (so its qualification) carries over. | `handlers/evaluation/apply-step-variant.ts`, `POST /api/evaluation/variants/apply`, CLI `eval apply-variant` |
| **Few-shot examples from cases** | `agent.examples` (`{input, output, note?, caseId?}`) rendered as a prompt section and hashed into the Fingerprint; an example's case must be a live dev case and is left out of later Eval Runs (`exampleCaseIds`). | `agent.examples` in `WorkflowAgentConfig`, example checks in `eval-runs.ts` |
| **Fix loop** | The assistant clusters an Eval Run's failures by root cause (`propose_diagnosis`, kept) and proposed each fix that a patch can express as a challenger (`propose_fix`), with a **Try it** card that prepared the run. | `ProposeFixToolSchema` in `platform-core/src/schemas/evaluation-assistant-tools.ts`, `FixCard` in `platform-ui/src/components/evaluation/evaluation-assistant-cards.tsx`, L3 `e2e/api/step-evaluation-fix-loop.journey.ts` |
| **GEPA optimisation** | One round of GEPA's reflective proposal step over a finished run's failing **dev** trials, in its own container (`mediforce-gepa`) with network for the reflection model; its candidate prompts run as challengers over dev and holdout and are ranked by holdout Wilson lower bound, then dev, then cost. One budget covers the job and that run. | `agent-runtime/src/plugins/gepa-job.ts`, `container/Dockerfile.gepa`, `handlers/evaluation/optimisations.ts`, `_lib/optimisation-results.ts`, `platform-core/src/schemas/eval-optimisation.ts`, migration `0065_eval_optimisations.sql`, CLI `eval optimise|optimisation|optimisations`, L3 `e2e/api/step-evaluation-optimisation.journey.ts` |
| **Assistant tools** | `compare_variants`, `list_optimisations`, `get_optimisation`, `start_optimisation` (under an unattended budget), `challengers` on `prepare_eval_run`, `propose_fix`. | `EVALUATION_ASSISTANT_PLATFORM_TOOLS` / `…_PROPOSAL_TOOLS`, `handlers/evaluation-assistant/_lib/run-evaluation-tool.ts` |
| **Case expectation** | _Returned to ADR-0023 D17 on 2026-10-02._ Was: an Eval Case is `positive` (a correct output exists) or `negative` (no output should be accepted), used only as GEPA feedback. Now it says whether a case's expected output is one to match or to avoid. | `EvalCaseExpectationSchema` in `platform-core/src/schemas/evaluation.ts` |
| **Web UI** | Challenger JSON on **Eval Runs → Prepare**, the comparison table and **Apply to step** in a run's report, the **Optimisations** section, the **Positive case / Negative case** buttons and the expectation selector on a case. | `platform-ui/src/components/evaluation/step-evaluation-sections.tsx` (`EvalRunsSection`, `OptimisationsSection`, `CasesSection`, `CaseForm`), `eval-run-report.tsx` (`Comparison`, `ApplyVariant`) |

What stays today: an Eval Run and its report still carry a `variants` list,
which now only ever holds the step as it is (`champion`).

## Decisions (proposed)

**D1 — Optimisation is a separate activity from evaluation.** Evaluation
answers whether one Step Fingerprint is fit for its context of use;
optimisation searches for a better one. They share Eval Runs, but not a
screen: optimisation gets its own surface, entered from a finished Eval Run,
so a person qualifying a step never meets it.

**D2 — A variant is an override patch over a pinned Definition version.**
As ADR-0023 D5 first stated: trying a model, prompt, skill commit, tool set or
examples never mints a Definition version. Trust still binds to the Step
Fingerprint (ADR-0023 D5, binding), so a qualified variant's qualification
carries over when applying it produces the same Fingerprint.

**D3 — A difference is called only on non-overlapping intervals.**
Champion against challenger, Evaluator by Evaluator, on Wilson 95% intervals;
otherwise "no clear difference".

**D4 — Applying a winner is a person's act and a normal Definition save.**
Through the workflow editor's save path, never on the assistant's authority.

**D5 — Few-shot examples come from dev cases only** and the cases they come
from are left out of later Eval Runs (ADR-0023 D12 as written).

**D6 — GEPA runs one reflective round per job, under a budget granted with the
request** (ADR-0023 D15's 2026-09-29 amendment as written): each round is an
Eval Run a person can read and stop; the job reflects on dev trials only;
candidates are ranked by holdout first; a start whose worst case leaves nothing
of the grant is refused.

**D7 — Superseded by ADR-0023 D17.** The expectation is now evaluation's: it
says whether a case's expected output is one to match or to avoid. GEPA's
reflective records read it with the expected output.

## Open questions before accepting

- Where optimisation lives in the UI (a section of a finished run's report, a
  tab of its own) and whether the assistant drives it or a form does.
- Whether GEPA should stay one round per job (D6) or run a bounded multi-round
  loop with per-round checkpoints.
- ~~Whether to delete the parked backend instead of keeping it.~~ Deleted
  2026-10-04; the pinned commit makes it recoverable.

## Considered options

- **Leave optimisation in the Evaluation tab, collapsed.** Rejected: it kept
  every concept on the screen and in the assistant's tool list, and the
  assistant kept offering it.
- **Delete the backend now.** Deferred on 2026-10-01, then done on 2026-10-04:
  code nothing reaches still has to be typechecked, migrated and read, and the
  pinned commit keeps it reusable.
