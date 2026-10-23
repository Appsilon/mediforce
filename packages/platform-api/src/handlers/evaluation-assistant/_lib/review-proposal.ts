import { isDeepStrictEqual } from 'node:util';
import type { z } from 'zod';
import {
  DEFAULT_JUDGE_MIN_CONFIDENCE,
  FALLBACK_PINNED_MODEL,
  TASK_COMPLETION_EVALUATOR_NAME,
  extractionCheckSource,
  filePresetCheckSource,
  isOwnedBy,
  taskCompletionRubric,
  type EVALUATION_ASSISTANT_PROPOSAL_TOOLS,
  type EvaluationSubject,
  type EvaluationAssistantProposalToolName,
  type EvaluatorCheck,
} from '@mediforce/platform-core';
import type { ProposalReview } from '../../../assistant-core';
import type { EvaluatorOutcome } from '../../../contract/evaluation';
import type { CallerScope } from '../../../repositories/index';
import { HandlerError } from '../../../errors';
import { AGENT_NOT_PREVIEWED, EXPECTED_OUTPUT_NOT_PREVIEWED, previewEvaluator } from '../../evaluation/preview-evaluator';
import { loadCaseSource } from '../../evaluation/_lib/case-source';
import { stepOnly } from '../../evaluation/_lib/evaluation-subject';
import { perturbCase } from '../../evaluation/_lib/perturb-case';
import { loadStepEvaluator } from './run-evaluation-tool';

type Args<Name extends EvaluationAssistantProposalToolName> = z.infer<(typeof EVALUATION_ASSISTANT_PROPOSAL_TOOLS)[Name]>;

/** A check the assistant already previewed this turn, and what it did. */
export interface PreviewedCheck {
  readonly check: EvaluatorCheck;
  readonly results: readonly EvaluatorOutcome[];
}

/**
 * A proposed check is tried on the step's real outputs before the person sees
 * it (ADR-0023 D14): the assistant's own preview of that exact check this
 * turn, or a fresh one. A check that errors on every output it is tried on
 * does not run at all, so it goes back to the model instead of to the person.
 * A caller who may not run checks still gets the proposal, marked untested.
 */
async function selfTest(
  scope: CallerScope,
  step: EvaluationSubject,
  check: EvaluatorCheck,
  previewed: readonly PreviewedCheck[],
): Promise<ProposalReview> {
  if (check.kind === 'expected_output') {
    return { ok: true, evidence: { selfTest: { unavailable: EXPECTED_OUTPUT_NOT_PREVIEWED } } };
  }
  if (step.kind === 'agent') {
    return { ok: true, evidence: { selfTest: { unavailable: AGENT_NOT_PREVIEWED } } };
  }
  let results = previewed.find((preview) => isDeepStrictEqual(preview.check, check))?.results;
  if (results === undefined) {
    try {
      results = (await previewEvaluator({ ...step, check, limit: 5 }, scope)).results;
    } catch (err) {
      if (err instanceof HandlerError && err.code === 'forbidden') {
        return { ok: true, evidence: { selfTest: { unavailable: err.message } } };
      }
      throw err;
    }
  }
  if (results.length > 0 && results.every((outcome) => outcome.error !== null)) {
    return {
      ok: false,
      error: `The check errored on every output it was tried on (${results.length}) — fix it before proposing it. First error: ${results[0]!.error}`,
    };
  }
  return { ok: true, evidence: { selfTest: { results } } };
}

/**
 * A schema check on an Agent that declares no output schema grades text the
 * agent was never asked to write as JSON, so it fails every trial.
 */
async function reviewAgentSchemaCheck(
  scope: CallerScope,
  step: EvaluationSubject,
  check: EvaluatorCheck | undefined,
): Promise<ProposalReview> {
  if (step.kind !== 'agent' || check?.kind !== 'schema') return { ok: true };
  const agent = await scope.agentDefinitions.getById(step.agentId);
  if (agent?.outputSchema !== undefined) return { ok: true };
  return {
    ok: false,
    error: 'This agent declares no Output schema, so it is never asked to answer as JSON and a schema check fails every trial. Do not propose one: tell the person to set the agent\'s Output schema on its page first, or check the rule with code or a judge.',
  };
}

/**
 * An Agent's case is written, never harvested (ADR-0029 D5), and is given its
 * trigger payload alone (D4) — what accepting it would refuse goes back to the
 * model with how to write it from a production run instead.
 */
function reviewAgentCase(agentRunId: string | undefined, input: Args<'propose_eval_case'>['input']): ProposalReview {
  if (agentRunId !== undefined) {
    return {
      ok: false,
      error: 'An agent\'s case is not harvested from a run: write its input from what get_agent_run shows the run was given — the trigger payload, with what the agent used from earlier steps folded into it — and set containsProductionData to true.',
    };
  }
  if (input !== undefined && (Object.keys(input.previousStepOutputs).length > 0 || input.previousRun !== undefined)) {
    return {
      ok: false,
      error: 'An agent\'s case is given its trigger payload alone: put what the agent needs into triggerPayload, and leave previousStepOutputs empty and previousRun out.',
    };
  }
  return { ok: true };
}

/**
 * Checks one Evaluation Assistant proposal against the platform before the
 * person sees it, so a card never offers what accepting would refuse: a name
 * already taken, an Evaluator of another step, an output that is not one of
 * the step's production runs, a perturbation that does not apply to its run,
 * a routing recommendation for a run the step does not have.
 */
export async function reviewEvaluationProposal(
  toolName: string,
  args: unknown,
  scope: CallerScope,
  step: EvaluationSubject,
  previewed: readonly PreviewedCheck[],
): Promise<ProposalReview> {
  switch (toolName as EvaluationAssistantProposalToolName) {
    case 'propose_evaluator': {
      const { name, check } = args as Args<'propose_evaluator'>;
      const taken = (await scope.evaluation.listEvaluators(step)).find((evaluator) => evaluator.name === name);
      if (taken !== undefined) {
        return {
          ok: false,
          error: `This step has an Evaluator named '${name}' already (${taken.id}${taken.archived ? ', archived' : ''}) — propose a new version of it with propose_evaluator_version, or choose another name.`,
        };
      }
      const schemaReview = await reviewAgentSchemaCheck(scope, step, check);
      if (schemaReview.ok === false) return schemaReview;
      return selfTest(scope, step, check, previewed);
    }
    case 'propose_evaluator_version': {
      const { evaluatorId, check } = args as Args<'propose_evaluator_version'>;
      const evaluator = await loadStepEvaluator(scope, step, evaluatorId);
      if (evaluator.archived) return { ok: false, error: `Evaluator '${evaluator.name}' is archived` };
      const schemaReview = await reviewAgentSchemaCheck(scope, step, check);
      if (schemaReview.ok === false) return schemaReview;
      return check === undefined ? { ok: true } : selfTest(scope, step, check, previewed);
    }
    case 'propose_perturbed_case': {
      const proposal = args as Args<'propose_perturbed_case'>;
      await perturbCase(await loadCaseSource(scope, proposal.baseAgentRunId, stepOnly(step, 'A perturbed case'), 'read'), proposal);
      return { ok: true };
    }
    case 'propose_control_settings': {
      const { evalRunId } = args as Args<'propose_control_settings'>;
      const run = await scope.evaluation.getEvalRun(evalRunId);
      if (run === null || isOwnedBy(run, step) === false) {
        return { ok: false, error: `Eval Run '${evalRunId}' is not a run of this step` };
      }
      return { ok: true };
    }
    case 'propose_diagnosis': {
      const { evalRunId, clusters } = args as Args<'propose_diagnosis'>;
      const run = await scope.evaluation.getEvalRun(evalRunId);
      if (run === null || isOwnedBy(run, step) === false) {
        return { ok: false, error: `Eval Run '${evalRunId}' is not a run of this step` };
      }
      const known = new Set((await scope.evaluation.listTrials(evalRunId)).map((trial) => trial.id));
      const unknown = clusters.flatMap((cluster) => cluster.trialIds).filter((trialId) => known.has(trialId) === false);
      return unknown.length === 0
        ? { ok: true }
        : { ok: false, error: `Not trials of Eval Run '${evalRunId}': ${[...new Set(unknown)].join(', ')} — take trial ids from get_failures` };
    }
    case 'propose_eval_case': {
      const { agentRunId, input } = args as Args<'propose_eval_case'>;
      if (step.kind === 'agent') return reviewAgentCase(agentRunId, input);
      if (agentRunId !== undefined) await loadCaseSource(scope, agentRunId, step, 'read');
      return { ok: true };
    }
    case 'propose_task_completion_judge': {
      const { requirements } = args as Args<'propose_task_completion_judge'>;
      const taken = (await scope.evaluation.listEvaluators(step)).find((evaluator) => evaluator.name === TASK_COMPLETION_EVALUATOR_NAME && evaluator.archived === false);
      if (taken !== undefined) {
        return { ok: false, error: `This step already has a live '${TASK_COMPLETION_EVALUATOR_NAME}' Evaluator (${taken.id}) — edit it directly instead of drafting a new one.` };
      }
      const check: EvaluatorCheck = { kind: 'llm_judge', model: FALLBACK_PINNED_MODEL, rubric: taskCompletionRubric(requirements), minConfidence: DEFAULT_JUDGE_MIN_CONFIDENCE };
      return selfTest(scope, step, check, previewed);
    }
    case 'propose_preset_evaluator': {
      const { preset } = args as Args<'propose_preset_evaluator'>;
      const { stepId } = stepOnly(step, 'A deterministic preset');
      const source = preset.kind === 'extraction' ? extractionCheckSource(preset) : filePresetCheckSource(preset, stepId);
      const check: EvaluatorCheck = { kind: 'code', runtime: 'python', source };
      return selfTest(scope, step, check, previewed);
    }
    default:
      return { ok: true };
  }
}
