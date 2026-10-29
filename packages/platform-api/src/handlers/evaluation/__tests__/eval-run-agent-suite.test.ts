import { describe, it, expect, beforeEach } from 'vitest';
import { buildWorkflowDefinition } from '@mediforce/platform-core/testing';
import { createEvaluator } from '../evaluators';
import { createEvalCase } from '../eval-cases';
import { saveEvalDataset } from '../eval-datasets';
import { prepareEvalRun } from '../eval-runs';
import { CreateEvalCaseInputSchema } from '../../../contract/evaluation';
import { evaluationFixture, NAMESPACE, type EvaluationFixture } from './fixture';

/**
 * A Step that changes its Agent gets no use of the Agent's suite under D8
 * (ADR-0029); this lets `prepareEvalRun` read it from the Agent instead of
 * rebuilding it on the Step (D10, #1552) — only for the workflow's first
 * step, since an Agent's Eval Cases carry no `previousStepOutputs`.
 */
describe("A Step's Eval Run from its Agent's suite (ADR-0029 D10, #1552)", () => {
  const WORKFLOW = 'ae-grading-first';
  const AGENT_ID = 'ae-grader-first';
  const AGENT = { kind: 'agent', namespace: NAMESPACE, agentId: AGENT_ID } as const;
  const STEP = { kind: 'step', namespace: NAMESPACE, workflowName: WORKFLOW, stepId: 'grade-aes', agentId: null } as const;
  let fixture: EvaluationFixture;

  beforeEach(async () => {
    fixture = await evaluationFixture();
    await fixture.agentDefinitionRepo.upsert(AGENT_ID, {
      kind: 'plugin', name: 'AE grader', iconName: 'bot', description: 'Grades adverse events',
      runtimeId: 'claude-code-agent', foundationModel: 'anthropic/claude-sonnet-4', systemPrompt: 'You grade adverse events.',
      inputDescription: 'Extracted AEs', outputDescription: 'Graded AEs', namespace: NAMESPACE, visibility: 'private',
    });
    // Unlike the shared fixture's `ae-grading` (where `grade-aes` is second), here it is the first step.
    await fixture.processRepo.saveWorkflowDefinition(buildWorkflowDefinition({
      name: WORKFLOW,
      namespace: NAMESPACE,
      steps: [
        { id: 'grade-aes', name: 'Grade AEs', type: 'creation', executor: 'agent', agentId: AGENT_ID, agent: { prompt: 'Grade with extra care.' } },
        { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
      ],
      transitions: [{ from: 'grade-aes', to: 'done' }],
    }));

    await createEvaluator({ ...AGENT, name: 'findings-present', rule: 'The result lists findings.', check: { kind: 'schema', schema: { required: ['findings'] } }, origin: 'user' }, fixture.scope());
    await createEvalCase(CreateEvalCaseInputSchema.parse({
      ...AGENT, name: 'Grade 5 sepsis', input: { triggerPayload: { studyId: 'CDISCPILOT01' }, previousStepOutputs: {} },
    }), fixture.scope());
    await saveEvalDataset(AGENT, fixture.scope());
  });

  it("prepares a Step-owned run from the Agent's suite", async () => {
    const { evalRun } = await prepareEvalRun({ ...STEP, trialsPerCase: 1, concurrency: 1, useAgentSuite: true, budgetUsd: 1 }, fixture.scope());
    expect(evalRun.suiteAgentId).toBe(AGENT_ID);
    expect(evalRun.workflowName).toBe(WORKFLOW);
    expect(evalRun.stepId).toBe('grade-aes');
    expect(evalRun.definitionVersion).not.toBeNull();
    expect(evalRun.agentVersion).toBeNull();
    expect(evalRun.caseIds).toHaveLength(1);
    expect(evalRun.evaluators.map((evaluator) => evaluator.name)).toEqual(['findings-present']);
  });

  it('refuses a step that is not its workflow\'s first', async () => {
    await fixture.processRepo.saveWorkflowDefinition(buildWorkflowDefinition({
      name: 'ae-grading-second',
      namespace: NAMESPACE,
      steps: [
        { id: 'extract-aes', name: 'Extract AEs', type: 'creation', executor: 'script', script: { runtime: 'python', inlineScript: 'print(1)' } },
        { id: 'grade-aes', name: 'Grade AEs', type: 'creation', executor: 'agent', agentId: AGENT_ID, agent: { prompt: 'Grade with extra care.' } },
      ],
      transitions: [{ from: 'extract-aes', to: 'grade-aes' }],
    }));
    await expect(prepareEvalRun({
      namespace: NAMESPACE, workflowName: 'ae-grading-second', stepId: 'grade-aes',
      trialsPerCase: 1, concurrency: 1, useAgentSuite: true,
    }, fixture.scope())).rejects.toMatchObject({ code: 'validation' });
  });
});
