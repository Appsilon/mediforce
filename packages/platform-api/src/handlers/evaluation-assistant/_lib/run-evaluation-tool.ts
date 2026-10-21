import type { z } from 'zod';
import {
  DEFAULT_ACCEPTANCE_CRITERIA,
  EVALUATION_ASSISTANT_PLATFORM_TOOLS,
  SKILL_MANIFEST_PATH,
  agentImageOf,
  isOwnedBy,
  type AgentDefinition,
  type Evaluator,
  type EvaluationSubject,
  type EvaluationAssistantPlatformToolName,
  type WorkflowDefinition,
  type WorkflowStep,
} from '@mediforce/platform-core';
import {
  AgentDefinitionNotFoundError,
  RetiredFileSkillError,
  SkillNotFoundError,
  listCommitFiles,
  listRevisionOutputFiles,
  readCommitFile,
  resolveMcpForStep,
  resolveSkillsForStep,
} from '@mediforce/agent-runtime';
import type { CallerScope } from '../../../repositories/index';
import { NotFoundError, ValidationError } from '../../../errors';
import { getMcpEvalPolicy } from '../../evaluation/mcp-eval-policy';
import { listStepAgentRuns } from '../../evaluation/step-agent-runs';
import { isTrialOfAgent, loadScoredRun, type ScoredRun } from '../../evaluation/_lib/scored-run';
import { isProductionRunOfAgent, listAgentProductionRuns } from '../../evaluation/_lib/agent-production-runs';
import { loadCaseSource } from '../../evaluation/_lib/case-source';
import { stepOnly } from '../../evaluation/_lib/evaluation-subject';
import { loadEvaluator } from '../../evaluation/_lib/evaluator-view';
import { isBinary } from '../../evaluation/_lib/workspace-seed';
import { HUMAN_VERDICT_SCORE_NAME } from '../../scores/record-human-verdict';
import { listEvaluators } from '../../evaluation/evaluators';
import { listEvalCases } from '../../evaluation/eval-cases';
import { getEvalRun, listEvalRuns, prepareEvalRun, startEvalRun } from '../../evaluation/eval-runs';
import { getEvalRunFailures } from '../../evaluation/eval-run-failures';
import { previewEvaluator } from '../../evaluation/preview-evaluator';
import { getAcceptanceCriteria } from '../../evaluation/acceptance-criteria';
import { getStepQualification } from '../../evaluation/step-qualification';

type Tools = typeof EVALUATION_ASSISTANT_PLATFORM_TOOLS;
type Args<Name extends EvaluationAssistantPlatformToolName> = z.infer<Tools[Name]>;

/** Keeps one tool result from filling the model's context with a large document. */
function clip(value: unknown, maxChars: number): unknown {
  const text = JSON.stringify(value) ?? 'null';
  return text.length <= maxChars ? value : `${text.slice(0, maxChars)}… (truncated, ${text.length} chars)`;
}

/**
 * The catalog Skills the step is offered — its agent's and its own (ADR-0027)
 * — resolved as the runtime resolves them. `{ refused }` when a Skill the
 * step names is gone, the way the step itself refuses to start.
 */
async function resolveOfferedSkills(scope: CallerScope, definition: WorkflowDefinition, step: WorkflowStep) {
  try {
    return await resolveSkillsForStep(step, { agentDefinitionRepo: scope.agentDefinitions, skillRepo: scope.skills }, definition) ?? [];
  } catch (error) {
    if (error instanceof SkillNotFoundError || error instanceof AgentDefinitionNotFoundError || error instanceof RetiredFileSkillError) {
      return { refused: error.message };
    }
    throw error;
  }
}

/** Offered Skills with each one's SKILL.md. */
async function offeredSkills(scope: CallerScope, definition: WorkflowDefinition, step: WorkflowStep): Promise<unknown> {
  const skills = await resolveOfferedSkills(scope, definition, step);
  if (!Array.isArray(skills)) return skills;
  return skills.map((skill) => ({
    namespace: skill.namespace,
    id: skill.id,
    description: skill.description,
    instructions: clip(skill.files.find((file) => file.path === SKILL_MANIFEST_PATH)?.contents ?? null, 8000),
  }));
}

/** Offered Skills as name + description only, no SKILL.md (F1's get_step_instructions). */
async function offeredSkillNames(scope: CallerScope, definition: WorkflowDefinition, step: WorkflowStep): Promise<unknown> {
  const skills = await resolveOfferedSkills(scope, definition, step);
  if (!Array.isArray(skills)) return skills;
  return skills.map((skill) => ({ name: skill.name, description: skill.description }));
}

/** The steps whose outputs reach this one, nearest first, following transitions back. */
function upstreamSteps(definition: WorkflowDefinition, stepId: string): WorkflowStep[] {
  const found: WorkflowStep[] = [];
  const seen = new Set([stepId]);
  let frontier = [stepId];
  while (frontier.length > 0) {
    const previous = definition.transitions
      .filter((transition) => frontier.includes(transition.to) && seen.has(transition.from) === false)
      .map((transition) => transition.from);
    frontier = [...new Set(previous)];
    for (const id of frontier) {
      seen.add(id);
      const step = definition.steps.find((candidate) => candidate.id === id);
      if (step !== undefined) found.push(step);
    }
  }
  return found;
}

/**
 * What the step's agent may call on each MCP server in production — resolved
 * the way the runtime resolves it at spawn — beside what the eval policy lets
 * a trial do with the server. A configuration production refuses is reported
 * as such: the step does not start.
 */
async function effectiveMcpServers(scope: CallerScope, step: EvaluationSubject, workflowStep: WorkflowStep) {
  const [{ servers }, production] = await Promise.all([
    getMcpEvalPolicy(step, scope),
    resolveMcpForStep(workflowStep, {
      agentDefinitionRepo: scope.agentDefinitions,
      toolCatalogRepo: scope.toolCatalog,
      namespace: step.namespace,
    }).then(
      (config) => ({ config, refusal: null }),
      (error: unknown) => ({ config: null, refusal: error instanceof Error ? error.message : String(error) }),
    ),
  ]);
  return servers.map(({ name, ...evalPolicy }) => {
    const resolved = production.config?.servers[name];
    const inProduction = production.refusal !== null
      ? `the step does not start: ${production.refusal}`
      : resolved === undefined
        ? 'none — disabled, or every tool denied, for this step'
        : resolved.allowedTools ?? 'all tools';
    return { name, inProduction, inEvalTrials: evalPolicy };
  });
}

/** An Evaluator of this step — any other reads as missing. */
export async function loadStepEvaluator(scope: CallerScope, step: EvaluationSubject, evaluatorId: string): Promise<Evaluator> {
  const evaluator = await loadEvaluator(scope, evaluatorId);
  if (isOwnedBy(evaluator, step) === false) {
    throw new NotFoundError(`Evaluator '${evaluatorId}' is not an Evaluator of this step`);
  }
  return evaluator;
}

/** An Eval Run of this step, with its trials and report — any other reads as missing. */
async function loadStepEvalRun(scope: CallerScope, step: EvaluationSubject, evalRunId: string) {
  const output = await getEvalRun({ evalRunId }, scope);
  const { evalRun } = output;
  if (isOwnedBy(evalRun, step) === false) {
    throw new NotFoundError(`Eval Run '${evalRunId}' is not a run of this step`);
  }
  return output;
}

/**
 * An Agent Run the assistant may read: of a Step, one of its own; of an Agent
 * (ADR-0029), one of its eval trials or a production run of a Step that used
 * it — any other reads as refused.
 */
async function loadSubjectRun(scope: CallerScope, subject: EvaluationSubject, agentRunId: string): Promise<ScoredRun> {
  if (subject.kind === 'step') return loadScoredRun(scope, agentRunId, subject);
  const run = await loadScoredRun(scope, agentRunId);
  if (isTrialOfAgent(run.agentRun, run.instance, subject) || await isProductionRunOfAgent(scope, subject, run.agentRun, run.instance)) {
    return run;
  }
  throw new ValidationError(`Agent Run '${agentRunId}' is neither an eval trial of this agent nor a production run of a step that uses it`);
}

/** The reviewer's newest verdict on a run, as the assistant reads it. */
async function reviewVerdict(scope: CallerScope, agentRunId: string) {
  const [verdict] = await scope.scores.list({ agentRunId, name: HUMAN_VERDICT_SCORE_NAME, limit: 1 });
  return verdict === undefined ? null : { verdict: verdict.label, comment: verdict.comment };
}

const MAX_LISTED_FILES = 300;

/**
 * The unattended budget a person granted for one request (D15), and what it
 * has paid for so far — the runs started under it, and what is left.
 */
export interface UnattendedGrant {
  remainingUsd: number;
  readonly started: Array<{ evalRunId: string; budgetUsd: number }>;
}

export interface EvaluationToolContext {
  readonly step: EvaluationSubject;
  readonly definition: WorkflowDefinition;
  readonly workflowStep: WorkflowStep;
  /** The Agent an Agent's Evaluation is about; null for a Step's. */
  readonly agent: AgentDefinition | null;
  /** Present only when the request was granted an unattended budget. */
  readonly unattended?: UnattendedGrant;
}

/**
 * Runs one of the Evaluation Assistant's platform tools as the person asking,
 * through the same handlers the CLI and the Evaluation tab call (D14). The
 * assistant reaches no data and takes no action its caller could not.
 */
export async function executeEvaluationTool(
  toolName: EvaluationAssistantPlatformToolName,
  args: unknown,
  scope: CallerScope,
  context: EvaluationToolContext,
): Promise<unknown> {
  const { step, definition, workflowStep, agent, unattended } = context;
  switch (toolName) {
    case 'get_step': {
      const agent = workflowStep.agentId === undefined ? null : await scope.agentDefinitions.getById(workflowStep.agentId);
      return {
        workflow: { name: definition.name, version: definition.version, description: definition.description ?? null },
        step: clip(workflowStep, 8000),
        agent: agent === null ? null : {
          name: agent.name,
          description: agent.description,
          foundationModel: agent.foundationModel,
          inputDescription: agent.inputDescription,
          outputDescription: agent.outputDescription,
          systemPrompt: clip(agent.systemPrompt, 4000),
        },
        outputSchema: workflowStep.agent?.outputSchema ?? agent?.outputSchema ?? null,
        mcpServers: await effectiveMcpServers(scope, step, workflowStep),
        upstreamSteps: upstreamSteps(definition, workflowStep.id).map((upstream) => ({
          id: upstream.id,
          name: upstream.name,
          executor: upstream.executor,
          description: upstream.description ?? null,
        })),
        skills: await offeredSkills(scope, definition, workflowStep),
      };
    }
    case 'get_step_instructions': {
      const stepAgent = workflowStep.agentId === undefined ? null : await scope.agentDefinitions.getById(workflowStep.agentId);
      return {
        preamble: definition.preamble ?? null,
        stepDescription: workflowStep.description ?? null,
        prompt: clip(workflowStep.agent?.prompt ?? stepAgent?.systemPrompt ?? null, 8000),
        inputDescription: stepAgent?.inputDescription ?? null,
        outputDescription: stepAgent?.outputDescription ?? null,
        outputSchema: workflowStep.agent?.outputSchema ?? stepAgent?.outputSchema ?? null,
        skills: await offeredSkillNames(scope, definition, workflowStep),
      };
    }
    case 'get_agent': {
      if (agent === null) throw new ValidationError('get_agent reads an Agent evaluated on its own; this is a step — read it with get_step');
      return {
        agent: {
          name: agent.name,
          description: agent.description,
          runtimeId: agent.runtimeId ?? null,
          image: agentImageOf(agent),
          foundationModel: agent.foundationModel,
          inputDescription: agent.inputDescription,
          outputDescription: agent.outputDescription,
          systemPrompt: clip(agent.systemPrompt, 8000),
        },
        outputSchema: agent.outputSchema ?? null,
        version: definition.version,
        mcpServers: await effectiveMcpServers(scope, step, workflowStep),
        skills: await offeredSkills(scope, definition, workflowStep),
      };
    }
    case 'list_agent_production_runs': {
      if (step.kind !== 'agent') throw new ValidationError('list_agent_production_runs is for an Agent evaluated on its own; a step lists its runs with list_step_runs');
      const { limit } = args as Args<'list_agent_production_runs'>;
      const { usages, runs } = await listAgentProductionRuns(scope, step, limit ?? 10);
      const reviewed = await Promise.all(runs.map(async ({ usage, agentRun, instance }) => ({
        agentRunId: agentRun.id,
        workflowName: usage.workflowName,
        stepId: usage.stepId,
        status: agentRun.status,
        fallbackReason: agentRun.fallbackReason,
        startedAt: agentRun.startedAt,
        reviewVerdict: await reviewVerdict(scope, agentRun.id),
        triggerPayload: clip(instance.triggerPayload ?? {}, 2000),
        result: clip(agentRun.envelope?.result ?? null, 600),
      })));
      return {
        steps: usages.map((usage) => ({
          workflowName: usage.workflowName,
          stepId: usage.stepId,
          stepName: usage.step.name,
          versions: usage.versions,
          stepAgentConfig: clip(usage.step.agent ?? {}, 2000),
        })),
        runs: reviewed,
      };
    }
    case 'list_step_runs': {
      const { limit } = args as Args<'list_step_runs'>;
      const { runs } = await listStepAgentRuns({ ...stepOnly(step, 'Listing production runs'), limit: limit ?? 10 }, scope);
      return {
        runs: await Promise.all(runs.map(async (run) => ({
          agentRunId: run.id,
          status: run.status,
          fallbackReason: run.fallbackReason,
          startedAt: run.startedAt,
          reviewVerdict: await reviewVerdict(scope, run.id),
          result: clip(run.envelope?.result ?? null, 600),
        }))),
      };
    }
    case 'get_agent_run': {
      const { agentRunId } = args as Args<'get_agent_run'>;
      const subject = await loadSubjectRun(scope, step, agentRunId);
      return {
        agentRunId,
        status: subject.agentRun.status,
        fallbackReason: subject.agentRun.fallbackReason,
        triggerPayload: clip(subject.instance.triggerPayload ?? {}, 6000),
        stepInput: clip(subject.stepInput, 6000),
        result: clip(subject.agentRun.envelope?.result ?? null, 8000),
        confidence: subject.agentRun.envelope?.confidence ?? null,
        reasoningSummary: subject.agentRun.envelope?.reasoning_summary ?? null,
        changedFiles: subject.agentRun.envelope?.gitMetadata?.changedFiles ?? [],
      };
    }
    case 'get_trajectory': {
      const { agentRunId, offset, limit } = EVALUATION_ASSISTANT_PLATFORM_TOOLS.get_trajectory.parse(args);
      const subject = await loadSubjectRun(scope, step, agentRunId);
      const entries = subject.trajectory.slice(offset, offset + limit);
      const total = subject.trajectory.length;
      return {
        entries,
        total,
        nextOffset: offset + entries.length < total ? offset + entries.length : null,
      };
    }
    case 'list_workspace_files': {
      const { agentRunId } = args as Args<'list_workspace_files'>;
      const source = await loadCaseSource(scope, agentRunId, stepOnly(step, 'Reading a production workspace'), 'read');
      if (source.bareRepoPath === null || source.workspaceSeedCommit === null) {
        return { files: [], note: 'This run had no workspace; a case from it starts from an empty one.' };
      }
      const files = await listCommitFiles(source.bareRepoPath, source.workspaceSeedCommit);
      return { commit: source.workspaceSeedCommit, files: files.slice(0, MAX_LISTED_FILES), total: files.length };
    }
    case 'read_workspace_file': {
      const { agentRunId, path } = args as Args<'read_workspace_file'>;
      const source = await loadCaseSource(scope, agentRunId, stepOnly(step, 'Reading a production workspace'), 'read');
      const content = source.bareRepoPath === null || source.workspaceSeedCommit === null
        ? null
        : await readCommitFile(source.bareRepoPath, source.workspaceSeedCommit, path);
      if (content === null) throw new NotFoundError(`The workspace of Agent Run '${agentRunId}' has no file '${path}'`);
      if (isBinary(content)) return { path, size: content.length, binary: true };
      return { path, size: content.length, content: clip(content.toString('utf-8'), 20_000) };
    }
    case 'list_output_files': {
      const { agentRunId } = args as Args<'list_output_files'>;
      const { stepId } = stepOnly(step, 'Reading output files');
      const source = await loadCaseSource(scope, agentRunId, stepOnly(step, 'Reading output files'), 'read');
      const git = source.subject.agentRun.envelope?.gitMetadata;
      if (source.bareRepoPath === null || git == null) {
        return { files: [], note: 'This run committed no Output Files.' };
      }
      const files = (await listRevisionOutputFiles(source.bareRepoPath, git.commitSha))
        .filter((file) => file.stepId === stepId);
      return { files };
    }
    case 'read_output_file': {
      const { agentRunId, path } = args as Args<'read_output_file'>;
      const source = await loadCaseSource(scope, agentRunId, stepOnly(step, 'Reading an output file'), 'read');
      const git = source.subject.agentRun.envelope?.gitMetadata;
      const content = source.bareRepoPath === null || git == null
        ? null
        : await readCommitFile(source.bareRepoPath, git.commitSha, path);
      if (content === null) throw new NotFoundError(`Agent Run '${agentRunId}' has no Output File '${path}'`);
      if (isBinary(content)) return { path, size: content.length, binary: true };
      return { path, size: content.length, content: clip(content.toString('utf-8'), 20_000) };
    }
    case 'list_evaluators': {
      const { evaluators } = await listEvaluators(step, scope);
      return {
        evaluators: evaluators.map((evaluator) => ({
          id: evaluator.id,
          name: evaluator.name,
          version: evaluator.latest.version,
          rule: evaluator.latest.rule,
          check: clip(evaluator.latest.check, 2000),
          counts: evaluator.trust.trusted,
          ...(evaluator.trust.trusted ? {} : { notCountedBecause: evaluator.trust.reason }),
        })),
      };
    }
    case 'list_eval_cases': {
      const { cases } = await listEvalCases(step, scope);
      return {
        cases: cases.map((evalCase) => ({
          id: evalCase.id,
          name: evalCase.name,
          expectation: evalCase.expectation,
          split: evalCase.split,
          source: evalCase.source,
          expectedOutput: clip(evalCase.expectedOutput, 2000),
          comparison: evalCase.comparison,
          agreementInstructions: evalCase.agreementInstructions,
          evaluatorIds: evalCase.evaluatorIds,
        })),
      };
    }
    case 'list_eval_runs': {
      const { evalRuns } = await listEvalRuns(step, scope);
      return {
        evalRuns: evalRuns.map((run) => ({
          id: run.id, status: run.status, createdAt: run.createdAt, budgetUsd: run.budgetUsd, spentUsd: run.spentUsd,
        })),
      };
    }
    case 'get_eval_run_report': {
      const { evalRunId } = args as Args<'get_eval_run_report'>;
      const { evalRun, trials, report } = await loadStepEvalRun(scope, step, evalRunId);
      return {
        status: evalRun.status,
        mcpPolicy: evalRun.mcpPolicy,
        acceptanceCriteria: evalRun.acceptanceCriteria,
        report,
        failedTrials: trials
          .filter((trial) => trial.status === 'failed' || trial.error !== null)
          .map((trial) => ({ caseId: trial.caseId, trialIndex: trial.trialIndex, agentRunId: trial.agentRunId, error: trial.error })),
      };
    }
    case 'get_failures': {
      const { evalRunId } = args as Args<'get_failures'>;
      await loadStepEvalRun(scope, step, evalRunId);
      return getEvalRunFailures({ evalRunId, limit: 50 }, scope);
    }
    case 'preview_evaluator': {
      const { check, agentRunIds } = args as Args<'preview_evaluator'>;
      return previewEvaluator({ ...stepOnly(step, 'A preview'), check, limit: 5, ...(agentRunIds === undefined ? {} : { agentRunIds }) }, scope);
    }
    case 'get_qualification': {
      const [qualification, { criteria }] = await Promise.all([
        getStepQualification(step, scope),
        getAcceptanceCriteria(step, scope),
      ]);
      const shown = qualification.qualification;
      return {
        validation: qualification.validation,
        status: qualification.status,
        changedSinceQualified: qualification.changed,
        evaluatorsChanged: qualification.evaluatorsChanged,
        qualification: shown === null ? null : {
          evalRunId: shown.evalRunId,
          acceptanceCriteria: shown.acceptanceCriteria,
          verdicts: shown.verdicts.map(({ severity, status, reason }) => ({ severity, status, reason })),
          deviations: shown.deviations,
          signedBy: shown.signature.signerName,
          signedAt: shown.signature.signedAt,
        },
        acceptanceCriteria: criteria === null ? { default: true, ...DEFAULT_ACCEPTANCE_CRITERIA } : { version: criteria.version, ...criteria.criteria },
      };
    }
    case 'prepare_eval_run': {
      const { trialsPerCase, budgetUsd } = args as Args<'prepare_eval_run'>;
      const { evalRun } = await prepareEvalRun({
        ...step,
        ...(step.kind === 'step' ? { definitionVersion: definition.version } : {}),
        trialsPerCase: trialsPerCase ?? 3,
        concurrency: 2,
        ...(budgetUsd === undefined ? {} : { budgetUsd }),
      }, scope);
      return {
        prepared: {
          evalRunId: evalRun.id,
          trials: evalRun.caseIds.length * evalRun.trialsPerCase,
          estimate: evalRun.estimate,
          budgetUsd: evalRun.budgetUsd,
          evaluators: evalRun.evaluators.map((evaluator) => ({ name: evaluator.name, counted: evaluator.counted })),
          acceptanceCriteria: evalRun.acceptanceCriteria,
          mcpPolicy: evalRun.mcpPolicy,
        },
        note: 'The person now sees a card to start this run by confirming its budget. Tell them the estimate and the budget; you cannot start it.',
      };
    }
    case 'start_eval_run': {
      const { evalRunId } = args as Args<'start_eval_run'>;
      if (unattended === undefined) {
        // No confirmation is passed — there is none to pass. The handler refuses,
        // and the refusal is what the model is told.
        return startEvalRun({ evalRunId }, scope);
      }
      const run = await scope.evaluation.getEvalRun(evalRunId);
      if (run === null || isOwnedBy(run, step) === false) {
        throw new NotFoundError(`Eval Run '${evalRunId}' is not a run of this step`);
      }
      if (run.budgetUsd > unattended.remainingUsd) {
        throw new ValidationError(
          `This Eval Run may spend up to $${run.budgetUsd}, but only $${unattended.remainingUsd.toFixed(2)} is left of the unattended budget the person granted for this request — prepare a smaller run, or ask the person to confirm this one.`,
        );
      }
      const started = await startEvalRun({ evalRunId, confirmedBudgetUsd: run.budgetUsd }, scope);
      unattended.remainingUsd = Math.round((unattended.remainingUsd - run.budgetUsd) * 100) / 100;
      unattended.started.push({ evalRunId, budgetUsd: run.budgetUsd });
      return {
        started: { evalRunId, status: started.evalRun.status, budgetUsd: run.budgetUsd },
        unattendedBudgetLeftUsd: unattended.remainingUsd,
        note: 'The run is under way. Read its report with get_eval_run_report once it completes.',
      };
    }
  }
}
