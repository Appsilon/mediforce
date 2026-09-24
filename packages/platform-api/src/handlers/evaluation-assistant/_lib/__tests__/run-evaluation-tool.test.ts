import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { EVALUATION_ASSISTANT_PLATFORM_TOOLS, type StoredAgentTrajectoryEntry } from '@mediforce/platform-core';
import { InMemoryAgentTrajectoryRepository } from '@mediforce/platform-core/testing';
import { createTestScope } from '../../../../repositories/__tests__/create-test-scope';
import { loadEvaluatedStep } from '../../../evaluation/_lib/evaluated-step';
import { createEvalCase } from '../../../evaluation/eval-cases';
import { createEvaluator } from '../../../evaluation/evaluators';
import { labelEvaluatorOutput } from '../../../evaluation/evaluator-trust';
import { freezeEvalDataset } from '../../../evaluation/eval-datasets';
import { prepareEvalRun } from '../../../evaluation/eval-runs';
import { setAcceptanceCriteria } from '../../../evaluation/acceptance-criteria';
import { recordScore } from '../../../scores/record-score';
import { executeEvaluationTool } from '../run-evaluation-tool';
import { addStepRun, evaluationFixture, GRADED_RUN, NAMESPACE, STEP, UNGRADED_RUN } from '../../../evaluation/__tests__/fixture';
import { gitWorkspace } from '../../../evaluation/__tests__/git-workspace';

async function setup(entries?: StoredAgentTrajectoryEntry[]) {
  const fixture = await evaluationFixture();
  let scope = fixture.scope();
  if (entries !== undefined) {
    const agentTrajectoryRepo = new InMemoryAgentTrajectoryRepository(fixture.agentRunRepo);
    await agentTrajectoryRepo.append(GRADED_RUN, entries);
    scope = createTestScope({ ...fixture, agentTrajectoryRepo, caller: scope.caller });
  }
  const { definition, step } = await loadEvaluatedStep(scope, STEP, 'read');
  return { fixture, scope, context: { step: STEP, definition, workflowStep: step } };
}

describe('executeEvaluationTool', () => {
  describe('get_trajectory', () => {
    const source = `${'print("driver step")\n'.repeat(100)}print("driver complete")\n`;
    const entries: StoredAgentTrajectoryEntry[] = Array.from({ length: 273 }, (_, seq) => ({
      seq,
      ts: '2026-09-22T09:00:00.000Z',
      ...(seq === 202
        ? { type: 'tool_use', tool_name: 'Write', input: { file_path: 'driver.py', content: source } }
        : { type: seq % 2 === 0 ? 'system' : 'thinking', text: `Entry ${seq}` }),
    }));
    const pageSchema = z.object({
      entries: z.array(z.unknown()),
      total: z.number(),
      nextOffset: z.number().nullable(),
    });

    it('retrieves all 273 entries in default pages, including the complete Write source at seq 202', async () => {
      const { scope, context } = await setup(entries);
      const collected: unknown[] = [];
      for (const offset of [0, 50, 100, 150, 200, 250]) {
        const args = offset === 0 ? { agentRunId: GRADED_RUN } : { agentRunId: GRADED_RUN, offset };
        const page = pageSchema.parse(await executeEvaluationTool('get_trajectory', args, scope, context));
        expect(page).toEqual({
          entries: entries.slice(offset, offset + 50),
          total: 273,
          nextOffset: offset === 250 ? null : offset + 50,
        });
        collected.push(...page.entries);
      }
      expect(collected).toEqual(entries);
      expect(collected[202]).toMatchObject({ input: { content: source } });
    });

    it('supports the maximum page size and a shorter final page', async () => {
      const { scope, context } = await setup(entries);
      expect(await executeEvaluationTool('get_trajectory', { agentRunId: GRADED_RUN, limit: 150 }, scope, context))
        .toEqual({ entries: entries.slice(0, 150), total: 273, nextOffset: 150 });
      expect(await executeEvaluationTool('get_trajectory', { agentRunId: GRADED_RUN, offset: 150, limit: 150 }, scope, context))
        .toEqual({ entries: entries.slice(150), total: 273, nextOffset: null });
    });

    it.each([272, 273, 300])('ends pagination at offset %i without dropping the last entry', async (offset) => {
      const { scope, context } = await setup(entries);
      expect(await executeEvaluationTool('get_trajectory', { agentRunId: GRADED_RUN, offset, limit: 1 }, scope, context))
        .toEqual({ entries: entries.slice(offset, offset + 1), total: 273, nextOffset: null });
    });

    it('returns an explicit end for an empty trajectory', async () => {
      const { scope, context } = await setup([]);
      expect(await executeEvaluationTool('get_trajectory', { agentRunId: GRADED_RUN }, scope, context))
        .toEqual({ entries: [], total: 0, nextOffset: null });
    });

    it.each([
      { offset: -1 }, { offset: 1.5 }, { offset: '1' }, { offset: null },
      { limit: 0 }, { limit: -1 }, { limit: 151 }, { limit: 1.5 }, { limit: '50' }, { limit: null },
    ])('rejects invalid pagination %j', async (pagination) => {
      const { scope, context } = await setup();
      const args = { agentRunId: GRADED_RUN, ...pagination };
      expect(EVALUATION_ASSISTANT_PLATFORM_TOOLS.get_trajectory.safeParse(args).success).toBe(false);
      await expect(executeEvaluationTool('get_trajectory', args, scope, context)).rejects.toThrow();
    });

    it('exposes pagination instructions and defaults in the model-visible schema', () => {
      const schema = z.toJSONSchema(EVALUATION_ASSISTANT_PLATFORM_TOOLS.get_trajectory, { io: 'input' });
      expect(schema.description).toContain('nextOffset');
      expect(schema.description).toContain('null');
      expect(schema.properties).toMatchObject({
        offset: { type: 'integer', minimum: 0, default: 0, description: expect.stringContaining('zero-based') },
        limit: { type: 'integer', minimum: 1, maximum: 150, default: 50, description: expect.any(String) },
      });
    });

    it.each([
      { namespace: 'pharma-b' }, { workflowName: 'another-workflow' }, { stepId: 'another-step' },
    ])('refuses a trajectory outside the evaluated step: %j', async (mismatch) => {
      const { scope, context } = await setup(entries);
      await expect(executeEvaluationTool('get_trajectory', { agentRunId: GRADED_RUN, offset: 200 }, scope, {
        ...context, step: { ...STEP, ...mismatch },
      })).rejects.toThrow('is not a run of step');
    });
  });

  it('describes what an evaluation plan reads: agent, I/O, tools, MCP servers in production and in trials, upstream steps', async () => {
    const { scope, context } = await setup();
    const workflowStep = {
      ...context.workflowStep,
      agent: { ...context.workflowStep.agent, allowedTools: ['WebFetch'], outputSchema: { required: ['findings'] } },
      mcpRestrictions: { edc: { denyTools: ['write_record'] } },
    };
    const result = await executeEvaluationTool('get_step', {}, scope, { ...context, workflowStep });

    expect(result).toMatchObject({
      agent: { name: 'AE grader', inputDescription: 'Extracted AEs', outputDescription: 'Graded AEs' },
      outputSchema: { required: ['findings'] },
      additionalTools: ['WebFetch'],
      mcpServers: [
        { name: 'edc', inProduction: ['read_record'], inEvalTrials: { mode: 'deny', defaulted: true } },
        { name: 'email', inProduction: 'all tools', inEvalTrials: { mode: 'deny', defaulted: true } },
      ],
      upstreamSteps: [{ id: 'extract-aes', name: 'Extract AEs', executor: 'script' }],
    });
  });

  it('reports MCP access exactly as production resolves it, refusals included', async () => {
    const { scope, context } = await setup();
    const mcpServersWith = async (mcpRestrictions: Record<string, { disable?: boolean; denyTools?: string[] }>) =>
      ((await executeEvaluationTool('get_step', {}, scope, { ...context, workflowStep: { ...context.workflowStep, mcpRestrictions } })) as {
        mcpServers: Array<{ name: string; inProduction: unknown }>;
      }).mcpServers.map(({ name, inProduction }) => [name, inProduction]);

    expect(await mcpServersWith({ edc: { denyTools: ['read_record', 'write_record'] }, email: { disable: true } })).toEqual([
      ['edc', 'none — disabled, or every tool denied, for this step'],
      ['email', 'none — disabled, or every tool denied, for this step'],
    ]);
    expect(await mcpServersWith({ email: { denyTools: ['send'] } })).toEqual([
      ['edc', expect.stringMatching(/^the step does not start: .*email.*no allowedTools/)],
      ['email', expect.stringMatching(/^the step does not start: /)],
    ]);
    expect(await mcpServersWith({ githuub: { disable: true } })).toEqual([
      ['edc', expect.stringContaining('"githuub" which is not defined on the agent')],
      ['email', expect.stringContaining('"githuub" which is not defined on the agent')],
    ]);
  });

  it('lists runs with the reviewer\'s verdict, so the outputs worth labelling can be picked', async () => {
    const { scope, context } = await setup();
    await recordScore({
      subject: { type: 'agent_run', id: UNGRADED_RUN }, name: 'human_verdict', value: 0, label: 'reject', comment: 'No grades.',
      source: 'human', createdBy: 'reviewer-1', metadata: null, namespace: NAMESPACE, processInstanceId: null,
      stepId: 'grade-aes', evaluatorId: null, supersedes: null, basis: 'test',
    }, scope);
    const { runs } = await executeEvaluationTool('list_step_runs', {}, scope, context) as { runs: Array<{ agentRunId: string; reviewVerdict: unknown }> };
    expect(runs.map((run) => [run.agentRunId, run.reviewVerdict])).toEqual([
      [UNGRADED_RUN, { verdict: 'reject', comment: 'No grades.' }],
      [GRADED_RUN, null],
    ]);
  });

  it('lists and reads the workspace a run started from', async () => {
    const { fixture, scope, context } = await setup();
    const workspace = gitWorkspace({ 'data/ae.csv': 'AETERM,AETOXGR\nSepsis,5\n' });
    try {
      await addStepRun(fixture, {
        instanceId: 'run-with-files', agentRunId: 'agent-run-with-files', result: {}, at: '2026-09-22T11:00:00.000Z',
        gitMetadata: { repoUrl: workspace.repoPath, commitSha: workspace.stepCommit },
      });
      expect(await executeEvaluationTool('list_workspace_files', { agentRunId: 'agent-run-with-files' }, scope, context))
        .toEqual({ commit: workspace.seedCommit, files: [{ path: 'data/ae.csv', size: 24 }], total: 1 });
      expect(await executeEvaluationTool('read_workspace_file', { agentRunId: 'agent-run-with-files', path: 'data/ae.csv' }, scope, context))
        .toEqual({ path: 'data/ae.csv', size: 24, content: 'AETERM,AETOXGR\nSepsis,5\n' });
      await expect(executeEvaluationTool('read_workspace_file', { agentRunId: 'agent-run-with-files', path: 'graded.json' }, scope, context))
        .rejects.toThrow("has no file 'graded.json'");
      expect(await executeEvaluationTool('list_workspace_files', { agentRunId: GRADED_RUN }, scope, context))
        .toMatchObject({ files: [], note: expect.stringContaining('no workspace') });
    } finally {
      workspace.remove();
    }
  });

  it('shows a judge\'s labels and what it still needs to count', async () => {
    const { scope, context } = await setup();
    const { evaluator } = await createEvaluator({
      ...STEP, name: 'grades-justified', rule: 'Every grade is justified.', severity: 'major',
      check: { kind: 'llm_judge', model: 'm', rubric: 'r', choices: [{ label: 'yes', value: 1 }, { label: 'no', value: 0 }] },
      origin: 'user',
    }, scope);
    await labelEvaluatorOutput({ evaluatorId: evaluator.id, agentRunId: UNGRADED_RUN, passed: false, comment: 'No grades.' }, scope);

    expect(await executeEvaluationTool('get_calibration', { evaluatorId: evaluator.id }, scope, context)).toEqual({
      name: 'grades-justified',
      version: 1,
      kind: 'llm_judge',
      rule: 'Every grade is justified.',
      labels: [{ agentRunId: UNGRADED_RUN, passed: false, comment: 'No grades.' }],
      needs: { labels: 10, failureLabels: 2, agreement: 0.8 },
      calibration: null,
      counts: false,
      notCountedBecause: 'not calibrated',
    });
    await expect(executeEvaluationTool('get_calibration', { evaluatorId: evaluator.id }, scope, { ...context, step: { ...STEP, stepId: 'extract-aes' } }))
      .rejects.toThrow('is not an Evaluator of this step');
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

  it('prepares a run with challengers, and compares each against the champion', async () => {
    const { scope, context } = await setup();
    await setAcceptanceCriteria({ ...STEP, criteria: { critical: { minPassRate: 0.9 } }, origin: 'user' }, scope);
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

    const prepared = z.object({ prepared: z.object({ evalRunId: z.string(), trials: z.number(), variants: z.array(z.object({ id: z.string() })) }) })
      .parse(await executeEvaluationTool('prepare_eval_run', {
        trialsPerCase: 2, budgetUsd: 2, challengers: [{ label: 'GPT-5', patch: { model: 'openai/gpt-5' } }],
      }, scope, context));
    expect(prepared.prepared).toMatchObject({ trials: 4, variants: [{ id: 'champion' }, { id: 'challenger-1' }] });

    const compared = await executeEvaluationTool('compare_variants', { evalRunId: prepared.prepared.evalRunId }, scope, context);
    expect(compared).toMatchObject({
      status: 'prepared',
      acceptanceCriteria: { critical: { minPassRate: 0.9 } },
      variants: [
        { id: 'champion', trials: { total: 2, inProgress: 2 }, criteria: [{ severity: 'critical', status: 'not_evaluable' }], recommendation: null },
        { id: 'challenger-1', label: 'GPT-5', patch: { model: 'openai/gpt-5' } },
      ],
      comparison: [{ variantId: 'challenger-1', evaluators: [{ name: 'findings-present', verdict: 'no_clear_difference' }] }],
    });
  });

  it('reads the step\'s qualification and the Acceptance Criteria set now', async () => {
    const { scope, context } = await setup();
    await setAcceptanceCriteria({ ...STEP, criteria: { critical: { minPassRate: 0.95, minPassHatK: 0.9 } }, origin: 'user' }, scope);

    expect(await executeEvaluationTool('get_qualification', {}, scope, context)).toEqual({
      status: 'not_qualified',
      changedSinceQualified: [],
      evaluatorsChanged: [],
      qualification: null,
      acceptanceCriteria: { version: 1, critical: { minPassRate: 0.95, minPassHatK: 0.9 } },
    });
  });
});
