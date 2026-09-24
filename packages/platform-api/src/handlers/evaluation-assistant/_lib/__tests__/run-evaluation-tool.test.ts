import { describe, it, expect } from 'vitest';
import { loadEvaluatedStep } from '../../../evaluation/_lib/evaluated-step';
import { createEvalCase } from '../../../evaluation/eval-cases';
import { createEvaluator } from '../../../evaluation/evaluators';
import { freezeEvalDataset } from '../../../evaluation/eval-datasets';
import { prepareEvalRun } from '../../../evaluation/eval-runs';
import { executeEvaluationTool } from '../run-evaluation-tool';
import { evaluationFixture, GRADED_RUN, STEP } from '../../../evaluation/__tests__/fixture';

async function setup() {
  const fixture = await evaluationFixture();
  const scope = fixture.scope();
  const { definition, step } = await loadEvaluatedStep(scope, STEP, 'read');
  return { scope, context: { step: STEP, definition, workflowStep: step } };
}

describe('executeEvaluationTool', () => {
  it('describes the step with its agent and its MCP servers as a trial would see them', async () => {
    const { scope, context } = await setup();
    const result = await executeEvaluationTool('get_step', {}, scope, context) as {
      agent: { name: string }; mcpServers: Array<{ name: string; mode: string }>;
    };
    expect(result.agent.name).toBe('AE grader');
    expect(result.mcpServers.map((server) => [server.name, server.mode])).toEqual([['edc', 'deny'], ['email', 'deny']]);
  });

  it('reads a production run\'s input and result', async () => {
    const { scope, context } = await setup();
    const result = await executeEvaluationTool('get_agent_run', { agentRunId: GRADED_RUN }, scope, context);
    expect(result).toMatchObject({ agentRunId: GRADED_RUN, result: { findings: [{ term: 'Sepsis', grade: 5 }] } });
  });

  it('previews a draft check through the preview handler', async () => {
    const { scope, context } = await setup();
    const result = await executeEvaluationTool('preview_evaluator', {
      check: { kind: 'schema', schema: { required: ['findings'] } },
      agentRunIds: [GRADED_RUN],
    }, scope, context);
    expect(result).toEqual({ results: [{ agentRunId: GRADED_RUN, passed: true, value: 1, label: 'pass', comment: null, error: null }] });
  });

  it('reads the SKILL.md the runtime loads — `<skillsDir>/<skill>` — and none for a prompt-only step', async () => {
    const { scope, context } = await setup();
    const artifacts = [
      { path: 'plugins/other/skills/grade-aes/SKILL.md', contents: 'Wrong plugin.' },
      { path: 'plugins/ae/skills/grade-aes/SKILL.md', contents: 'Grade by CTCAE v5.' },
    ];
    const definition = { ...context.definition, artifacts };
    const withSkill = { ...context.workflowStep, agent: { skill: 'grade-aes', skillsDir: 'plugins/ae/skills/' } };

    const skilled = await executeEvaluationTool('get_step', {}, scope, { ...context, definition, workflowStep: withSkill });
    const promptOnly = await executeEvaluationTool('get_step', {}, scope, { ...context, definition });

    expect(skilled).toMatchObject({ skill: 'Grade by CTCAE v5.' });
    expect(promptOnly).toMatchObject({ skill: null });
  });

  it('refuses the report of an Eval Run of the same step in another namespace', async () => {
    const { scope, context } = await setup();
    await createEvaluator({ ...STEP, name: 'findings-present', rule: 'The result lists findings.', severity: 'critical', check: { kind: 'schema', schema: { required: ['findings'] } }, origin: 'user' }, scope);
    await createEvalCase({
      ...STEP,
      name: 'Grade 5 sepsis',
      input: { triggerPayload: {}, previousStepOutputs: {} },
      workspaceSeedCommit: null,
      expectation: 'positive',
      notes: null,
      split: 'dev',
      containsProductionData: false,
      origin: 'user',
    }, scope);
    await freezeEvalDataset(STEP, scope);
    const { evalRun } = await prepareEvalRun({ ...STEP, trialsPerCase: 1, concurrency: 1, budgetUsd: 1 }, scope);

    await expect(executeEvaluationTool('get_eval_run_report', { evalRunId: evalRun.id }, scope, {
      ...context, step: { ...STEP, namespace: 'pharma-b' },
    })).rejects.toThrow('is not a run of this step');
  });
});
