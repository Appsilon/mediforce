import { isDeepStrictEqual } from 'node:util';
import type { z } from 'zod';
import type {
  EVALUATION_ASSISTANT_PROPOSAL_TOOLS,
  EvaluatedStep,
  EvaluationAssistantProposalToolName,
  EvaluatorCheck,
} from '@mediforce/platform-core';
import type { ProposalReview } from '../../../assistant-core';
import type { EvaluatorOutcome } from '../../../contract/evaluation';
import type { CallerScope } from '../../../repositories/index';
import { HandlerError } from '../../../errors';
import { previewEvaluator } from '../../evaluation/preview-evaluator';
import { loadEvaluationSubject } from '../../evaluation/_lib/evaluation-subject';
import { loadCaseSource } from '../../evaluation/_lib/case-source';
import { isSameStep } from '../../evaluation/_lib/evaluated-step';
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
  step: EvaluatedStep,
  check: EvaluatorCheck,
  previewed: readonly PreviewedCheck[],
): Promise<ProposalReview> {
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
 * Checks one Evaluation Assistant proposal against the platform before the
 * person sees it, so a card never offers what accepting would refuse: a name
 * already taken, an Evaluator of another step, an output that is not one of
 * the step's production runs, a perturbation that does not apply to its run,
 * a routing recommendation for a run or variant the step does not have.
 */
export async function reviewEvaluationProposal(
  toolName: string,
  args: unknown,
  scope: CallerScope,
  step: EvaluatedStep,
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
      return selfTest(scope, step, check, previewed);
    }
    case 'propose_evaluator_version': {
      const { evaluatorId, check } = args as Args<'propose_evaluator_version'>;
      const evaluator = await loadStepEvaluator(scope, step, evaluatorId);
      if (evaluator.archived) return { ok: false, error: `Evaluator '${evaluator.name}' is archived` };
      return check === undefined ? { ok: true } : selfTest(scope, step, check, previewed);
    }
    case 'propose_outputs_to_label': {
      const { evaluatorId, outputs } = args as Args<'propose_outputs_to_label'>;
      await loadStepEvaluator(scope, step, evaluatorId);
      const refused: string[] = [];
      for (const { agentRunId } of outputs) {
        try {
          const subject = await loadEvaluationSubject(scope, agentRunId, step);
          if (subject.instance.evalRunId !== undefined) refused.push(`${agentRunId} (an eval trial)`);
        } catch (err) {
          if (err instanceof HandlerError === false) throw err;
          refused.push(`${agentRunId} (${err.message})`);
        }
      }
      return refused.length === 0
        ? { ok: true }
        : { ok: false, error: `Only this step's production runs can be labelled: ${refused.join('; ')}` };
    }
    case 'propose_perturbed_case': {
      const proposal = args as Args<'propose_perturbed_case'>;
      await perturbCase(await loadCaseSource(scope, proposal.baseAgentRunId, step, 'read'), proposal);
      return { ok: true };
    }
    case 'propose_control_settings': {
      const { evalRunId, variantId } = args as Args<'propose_control_settings'>;
      const run = await scope.evaluation.getEvalRun(evalRunId);
      if (run === null || isSameStep(run, step) === false) {
        return { ok: false, error: `Eval Run '${evalRunId}' is not a run of this step` };
      }
      if (run.variants.some((variant) => variant.id === variantId) === false) {
        return { ok: false, error: `Eval Run '${evalRunId}' has no variant '${variantId}'; its variants are ${run.variants.map((variant) => variant.id).join(', ')}` };
      }
      return { ok: true };
    }
    case 'propose_eval_case': {
      const { agentRunId } = args as Args<'propose_eval_case'>;
      if (agentRunId !== undefined) await loadCaseSource(scope, agentRunId, step, 'read');
      return { ok: true };
    }
    default:
      return { ok: true };
  }
}
