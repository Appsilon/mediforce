import { posix } from 'node:path';
import type { z } from 'zod';
import {
  EVALUATION_ASSISTANT_PLATFORM_TOOLS,
  JUDGE_MIN_AGREEMENT,
  JUDGE_MIN_FAILURE_LABELS,
  JUDGE_MIN_LABELS,
  JUDGE_PASS_VALUE,
  type AgentDefinition,
  type Evaluator,
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
import { loadCaseSource } from '../../evaluation/_lib/case-source';
import { evaluatorView, loadEvaluator } from '../../evaluation/_lib/evaluator-view';
import { isBinary, listWorkspaceFiles, readWorkspaceFile } from '../../evaluation/_lib/workspace-seed';
import { evaluatorLabels } from '../../evaluation/evaluator-trust';
import { HUMAN_VERDICT_SCORE_NAME } from '../../scores/record-human-verdict';
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

/** The steps whose outputs reach this one, nearest first, following transitions back. */
function upstreamSteps(definition: WorkflowDefinition, stepId: string): WorkflowStep[] {
  const found: WorkflowStep[] = [];
  const seen = new Set([stepId]);
  let frontier = [stepId];
  while (frontier.length > 0) {
    const previous = definition.transitions
      .filter((transition) => frontier.includes(transition.to) && !seen.has(transition.from))
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
 * The tools the step's agent may call in production, per MCP server — the
 * binding's `allowedTools` less the step's `mcpRestrictions` — beside what the
 * eval policy lets a trial do with the server.
 */
async function effectiveMcpServers(scope: CallerScope, step: EvaluatedStep, workflowStep: WorkflowStep, agent: AgentDefinition | null) {
  const { servers } = await getMcpEvalPolicy(step, scope);
  const restrictions = workflowStep.mcpRestrictions ?? {};
  return servers.map(({ name, ...evalPolicy }) => {
    const restriction = restrictions[name];
    const denied = new Set(restriction?.denyTools ?? []);
    const allowed = agent?.mcpServers?.[name]?.allowedTools;
    return {
      name,
      inProduction: restriction?.disable === true
        ? 'disabled for this step'
        : allowed === undefined ? 'all tools' : allowed.filter((tool) => !denied.has(tool)),
      inEvalTrials: evalPolicy,
    };
  });
}

/** An Evaluator of this step — any other reads as missing. */
export async function loadStepEvaluator(scope: CallerScope, step: EvaluatedStep, evaluatorId: string): Promise<Evaluator> {
  const evaluator = await loadEvaluator(scope, evaluatorId);
  if (evaluator.namespace !== step.namespace || evaluator.workflowName !== step.workflowName || evaluator.stepId !== step.stepId) {
    throw new NotFoundError(`Evaluator '${evaluatorId}' is not an Evaluator of this step`);
  }
  return evaluator;
}

const MAX_LISTED_FILES = 300;

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
          description: agent.description,
          foundationModel: agent.foundationModel,
          inputDescription: agent.inputDescription,
          outputDescription: agent.outputDescription,
          systemPrompt: clip(agent.systemPrompt, 4000),
        },
        outputSchema: workflowStep.agent?.outputSchema ?? null,
        allowedTools: { default: ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep'], additional: workflowStep.agent?.allowedTools ?? [] },
        mcpServers: await effectiveMcpServers(scope, step, workflowStep, agent),
        upstreamSteps: upstreamSteps(definition, workflowStep.id).map((upstream) => ({
          id: upstream.id,
          name: upstream.name,
          executor: upstream.executor,
          description: upstream.description ?? null,
        })),
        skill: skill === null ? null : clip(skill, 8000),
      };
    }
    case 'list_step_runs': {
      const { limit } = args as Args<'list_step_runs'>;
      const { runs } = await listStepAgentRuns({ ...step, limit: limit ?? 10 }, scope);
      const verdicts = await Promise.all(runs.map(async (run) =>
        (await scope.scores.list({ agentRunId: run.id, name: HUMAN_VERDICT_SCORE_NAME, limit: 1 }))[0] ?? null));
      return {
        runs: runs.map((run, index) => ({
          agentRunId: run.id,
          status: run.status,
          fallbackReason: run.fallbackReason,
          startedAt: run.startedAt,
          reviewVerdict: verdicts[index] === null ? null : { verdict: verdicts[index]!.label, comment: verdicts[index]!.comment },
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
    case 'list_workspace_files': {
      const { agentRunId } = args as Args<'list_workspace_files'>;
      const source = await loadCaseSource(scope, agentRunId, step, 'read');
      if (source.bareRepoPath === null || source.workspaceSeedCommit === null) {
        return { files: [], note: 'This run had no workspace; a case from it starts from an empty one.' };
      }
      const files = await listWorkspaceFiles(source.bareRepoPath, source.workspaceSeedCommit);
      return { commit: source.workspaceSeedCommit, files: files.slice(0, MAX_LISTED_FILES), total: files.length };
    }
    case 'read_workspace_file': {
      const { agentRunId, path } = args as Args<'read_workspace_file'>;
      const source = await loadCaseSource(scope, agentRunId, step, 'read');
      const content = source.bareRepoPath === null || source.workspaceSeedCommit === null
        ? null
        : await readWorkspaceFile(source.bareRepoPath, source.workspaceSeedCommit, path);
      if (content === null) throw new NotFoundError(`The workspace of Agent Run '${agentRunId}' has no file '${path}'`);
      if (isBinary(content)) return { path, size: content.length, binary: true };
      return { path, size: content.length, content: clip(content.toString('utf-8'), 20_000) };
    }
    case 'get_calibration': {
      const { evaluatorId } = args as Args<'get_calibration'>;
      const view = await evaluatorView(scope, await loadStepEvaluator(scope, step, evaluatorId));
      const labels = await evaluatorLabels(scope, view);
      return {
        name: view.name,
        version: view.latest.version,
        kind: view.latest.check.kind,
        rule: view.latest.rule,
        labels: labels.map((label) => ({ agentRunId: label.subject.id, passed: label.value >= JUDGE_PASS_VALUE, comment: label.comment })),
        needs: { labels: JUDGE_MIN_LABELS, failureLabels: JUDGE_MIN_FAILURE_LABELS, agreement: JUDGE_MIN_AGREEMENT },
        calibration: view.latest.calibration,
        counts: view.trust.trusted,
        ...(view.trust.trusted ? {} : { notCountedBecause: view.trust.reason }),
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
