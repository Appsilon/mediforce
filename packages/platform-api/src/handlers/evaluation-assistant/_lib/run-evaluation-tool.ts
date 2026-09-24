import { posix } from 'node:path';
import type { z } from 'zod';
import {
  EVALUATION_ASSISTANT_PLATFORM_TOOLS,
  type EvaluatedStep,
  type EvaluationAssistantPlatformToolName,
  type WorkflowDefinition,
  type WorkflowStep,
} from '@mediforce/platform-core';
import type { CallerScope } from '../../../repositories/index';
import { NotFoundError } from '../../../errors';
import { getMcpEvalPolicy } from '../../evaluation/mcp-eval-policy';
import { listStepAgentRuns } from '../../evaluation/step-agent-runs';
import { loadEvaluationSubject } from '../../evaluation/_lib/evaluation-subject';
import { listEvaluators } from '../../evaluation/evaluators';
import { listEvalCases } from '../../evaluation/eval-cases';
import { getEvalRun, listEvalRuns, prepareEvalRun, startEvalRun } from '../../evaluation/eval-runs';
import { previewEvaluator } from '../../evaluation/preview-evaluator';

type Tools = typeof EVALUATION_ASSISTANT_PLATFORM_TOOLS;
type Args<Name extends EvaluationAssistantPlatformToolName> = z.infer<Tools[Name]>;

/** Keeps one tool result from filling the model's context with a large document. */
function clip(value: unknown, maxChars: number): unknown {
  const text = JSON.stringify(value) ?? 'null';
  return text.length <= maxChars ? value : `${text.slice(0, maxChars)}… (truncated, ${text.length} chars)`;
}

/**
 * The SKILL.md the runtime loads for the step — `<skillsDir>/<skill>/SKILL.md`,
 * read only when both are set — when the workflow carries it (`artifacts`).
 */
function skillContent(definition: WorkflowDefinition, step: WorkflowStep): string | null {
  const skill = step.agent?.skill;
  const skillsDir = step.agent?.skillsDir;
  if (skill === undefined || skill === '' || skillsDir === undefined || skillsDir === '') return null;
  const skillPath = posix.normalize(posix.join(skillsDir, skill, 'SKILL.md'));
  const found = (definition.artifacts ?? []).find((artifact) => posix.normalize(artifact.path) === skillPath);
  return found?.contents ?? null;
}

export interface EvaluationToolContext {
  readonly step: EvaluatedStep;
  readonly definition: WorkflowDefinition;
  readonly workflowStep: WorkflowStep;
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
  const { step, definition, workflowStep } = context;
  switch (toolName) {
    case 'get_step': {
      const agent = workflowStep.agentId === undefined ? null : await scope.agentDefinitions.getById(workflowStep.agentId);
      const skill = skillContent(definition, workflowStep);
      return {
        workflow: { name: definition.name, version: definition.version, description: definition.description ?? null },
        step: clip(workflowStep, 8000),
        agent: agent === null ? null : {
          name: agent.name,
          foundationModel: agent.foundationModel,
          systemPrompt: clip(agent.systemPrompt, 4000),
        },
        mcpServers: (await getMcpEvalPolicy(step, scope)).servers,
        skill: skill === null ? null : clip(skill, 8000),
      };
    }
    case 'list_step_runs': {
      const { limit } = args as Args<'list_step_runs'>;
      const { runs } = await listStepAgentRuns({ ...step, limit: limit ?? 10 }, scope);
      return {
        runs: runs.map((run) => ({
          agentRunId: run.id,
          status: run.status,
          fallbackReason: run.fallbackReason,
          startedAt: run.startedAt,
          result: clip(run.envelope?.result ?? null, 600),
        })),
      };
    }
    case 'get_agent_run': {
      const { agentRunId } = args as Args<'get_agent_run'>;
      const subject = await loadEvaluationSubject(scope, agentRunId, step);
      return {
        agentRunId,
        status: subject.agentRun.status,
        fallbackReason: subject.agentRun.fallbackReason,
        stepInput: clip(subject.stepInput, 6000),
        result: clip(subject.agentRun.envelope?.result ?? null, 8000),
        confidence: subject.agentRun.envelope?.confidence ?? null,
        reasoningSummary: subject.agentRun.envelope?.reasoning_summary ?? null,
        changedFiles: subject.agentRun.envelope?.gitMetadata?.changedFiles ?? [],
      };
    }
    case 'get_trajectory': {
      const { agentRunId, offset, limit } = EVALUATION_ASSISTANT_PLATFORM_TOOLS.get_trajectory.parse(args);
      const subject = await loadEvaluationSubject(scope, agentRunId, step);
      const entries = subject.trajectory.slice(offset, offset + limit);
      const total = subject.trajectory.length;
      return {
        entries,
        total,
        nextOffset: offset + entries.length < total ? offset + entries.length : null,
      };
    }
    case 'list_evaluators': {
      const { evaluators } = await listEvaluators(step, scope);
      return {
        evaluators: evaluators.map((evaluator) => ({
          id: evaluator.id,
          name: evaluator.name,
          version: evaluator.latest.version,
          rule: evaluator.latest.rule,
          severity: evaluator.latest.severity,
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
          notes: evalCase.notes,
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
      const { evalRun, trials, report } = await getEvalRun({ evalRunId }, scope);
      if (
        evalRun.namespace !== step.namespace
        || evalRun.workflowName !== step.workflowName
        || evalRun.stepId !== step.stepId
      ) {
        throw new NotFoundError(`Eval Run '${evalRunId}' is not a run of this step`);
      }
      return {
        status: evalRun.status,
        mcpPolicy: evalRun.mcpPolicy,
        report,
        failedTrials: trials
          .filter((trial) => trial.status === 'failed' || trial.error !== null)
          .map((trial) => ({ caseId: trial.caseId, trialIndex: trial.trialIndex, agentRunId: trial.agentRunId, error: trial.error })),
      };
    }
    case 'preview_evaluator': {
      const { check, agentRunIds } = args as Args<'preview_evaluator'>;
      return previewEvaluator({ ...step, check, limit: 5, ...(agentRunIds === undefined ? {} : { agentRunIds }) }, scope);
    }
    case 'prepare_eval_run': {
      const { trialsPerCase, budgetUsd } = args as Args<'prepare_eval_run'>;
      const { evalRun } = await prepareEvalRun({
        ...step,
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
          mcpPolicy: evalRun.mcpPolicy,
        },
        note: 'The person now sees a card to start this run by confirming its budget. Tell them the estimate and the budget; you cannot start it.',
      };
    }
    case 'start_eval_run': {
      const { evalRunId } = args as Args<'start_eval_run'>;
      // No confirmation is passed — there is none to pass. The handler refuses,
      // and the refusal is what the model is told.
      return startEvalRun({ evalRunId }, scope);
    }
  }
}
