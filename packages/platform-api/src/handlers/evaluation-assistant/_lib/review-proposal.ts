import { isDeepStrictEqual } from 'node:util';
import type { z } from 'zod';
import {
  isOwnedBy,
  taskCompletionEvaluator,
  type EVALUATION_ASSISTANT_PROPOSAL_TOOLS,
  type EvaluationSubject,
  type EvaluationAssistantProposalToolName,
  type EvaluatorCheck,
} from '@mediforce/platform-core';
import type { ProposalReview } from '../../../assistant-core';
import type { EvaluatorOutcome } from '../../../contract/evaluation';
import type { EvaluatorSelfTest } from '../../../contract/evaluation-assistant';
import type { CallerScope } from '../../../repositories/index';
import { HandlerError } from '../../../errors';
import { AGENT_NOT_PREVIEWED, EXPECTED_OUTPUT_NOT_PREVIEWED, previewEvaluator } from '../../evaluation/preview-evaluator';
import { loadCaseSource } from '../../evaluation/_lib/case-source';
import { liveSchemaEvaluatorName } from '../../evaluation/evaluators';
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
async function trySelfTest(
  scope: CallerScope,
  step: EvaluationSubject,
  check: EvaluatorCheck,
  previewed: readonly PreviewedCheck[],
  limit = 5,
): Promise<{ ok: true; selfTest: EvaluatorSelfTest } | { ok: false; error: string }> {
  if (check.kind === 'expected_output') return { ok: true, selfTest: { unavailable: EXPECTED_OUTPUT_NOT_PREVIEWED } };
  if (step.kind === 'agent') return { ok: true, selfTest: { unavailable: AGENT_NOT_PREVIEWED } };
  let results = previewed.find((preview) => isDeepStrictEqual(preview.check, check))?.results;
  if (results === undefined) {
    try {
      results = (await previewEvaluator({ ...step, check, limit }, scope)).results;
    } catch (err) {
      if (err instanceof HandlerError && err.code === 'forbidden') return { ok: true, selfTest: { unavailable: err.message } };
      throw err;
    }
  }
  if (results.length > 0 && results.every((outcome) => outcome.error !== null)) {
    return {
      ok: false,
      error: `The check errored on every output it was tried on (${results.length}) — fix it before proposing it. First error: ${results[0]!.error}`,
    };
  }
  return { ok: true, selfTest: { results: [...results] } };
}

async function selfTest(
  scope: CallerScope,
  step: EvaluationSubject,
  check: EvaluatorCheck,
  previewed: readonly PreviewedCheck[],
): Promise<ProposalReview> {
  const tried = await trySelfTest(scope, step, check, previewed);
  return tried.ok ? { ok: true, evidence: { selfTest: tried.selfTest } } : tried;
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

/** A suite may draft many judges, each a model call per output tried, so each is tried on fewer outputs. */
const TASK_COMPLETION_JUDGE_SELF_TEST_LIMIT = 2;

/**
 * Each drafted task-completion Evaluator is its own Evaluator, so each is
 * checked as creating it would check it: a name the step already uses, a
 * second output-schema check (a step has one), or a check that errors on
 * every output goes back to the model naming which.
 */
async function reviewTaskCompletionEvaluators(
  scope: CallerScope,
  step: EvaluationSubject,
  { evaluators }: Args<'propose_task_completion_evaluators'>,
  previewed: readonly PreviewedCheck[],
): Promise<ProposalReview> {
  const existing = await scope.evaluation.listEvaluators(step);
  const drafted = evaluators.map(taskCompletionEvaluator);
  const taken = drafted.filter((evaluator) => existing.some((candidate) => candidate.name === evaluator.name));
  if (taken.length > 0) {
    return { ok: false, error: `This step has Evaluators named ${taken.map((evaluator) => `'${evaluator.name}'`).join(', ')} already (an archived Evaluator keeps its name) — choose other names, or leave those requirements out.` };
  }
  if (new Set(drafted.map((evaluator) => evaluator.name)).size !== drafted.length) {
    return { ok: false, error: 'Two evaluators\' names are the same once prefixed and shortened to 63 characters — shorten them so they differ.' };
  }
  const schemaDrafts = drafted.filter((evaluator) => evaluator.check.kind === 'schema');
  if (schemaDrafts.length > 1) {
    return { ok: false, error: `A step has one output-schema check, and ${schemaDrafts.map((evaluator) => `'${evaluator.name}'`).join(', ')} are all schema checks — merge them into one, or check the others with code.` };
  }
  const liveSchema = schemaDrafts.length === 0 ? null : await liveSchemaEvaluatorName(scope, step);
  if (liveSchema !== null) {
    return { ok: false, error: `This step already has its output-schema check ('${liveSchema}'), so '${schemaDrafts[0]!.name}' cannot be a schema check — check it with code, or leave it out if '${liveSchema}' already covers it.` };
  }
  const reviews = await Promise.all(drafted.map((evaluator) => trySelfTest(
    scope, step, evaluator.check, previewed,
    evaluator.check.kind === 'llm_judge' ? TASK_COMPLETION_JUDGE_SELF_TEST_LIMIT : undefined,
  )));
  const errors = reviews.flatMap((review, index) => (review.ok === false ? [`${drafted[index]!.name}: ${review.error}`] : []));
  if (errors.length > 0) return { ok: false, error: errors.join('\n') };
  return { ok: true, evidence: { selfTests: reviews.flatMap((review) => (review.ok ? [review.selfTest] : [])) } };
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
    case 'propose_task_completion_evaluators':
      return reviewTaskCompletionEvaluators(scope, step, args as Args<'propose_task_completion_evaluators'>, previewed);
    default:
      return { ok: true };
  }
}
