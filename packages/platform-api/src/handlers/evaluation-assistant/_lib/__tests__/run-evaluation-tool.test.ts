import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { EVALUATION_ASSISTANT_PLATFORM_TOOLS, type StoredAgentTrajectoryEntry } from '@mediforce/platform-core';
import { InMemoryAgentTrajectoryRepository } from '@mediforce/platform-core/testing';
import { createTestScope } from '../../../../repositories/__tests__/create-test-scope';
import { loadEvaluatedStep } from '../../../evaluation/_lib/evaluated-step';
import { createEvalCase } from '../../../evaluation/eval-cases';
import { createEvaluator } from '../../../evaluation/evaluators';
import { freezeEvalDataset } from '../../../evaluation/eval-datasets';
import { prepareEvalRun } from '../../../evaluation/eval-runs';
import { executeEvaluationTool } from '../run-evaluation-tool';
import { evaluationFixture, GRADED_RUN, STEP } from '../../../evaluation/__tests__/fixture';

async function setup(entries?: StoredAgentTrajectoryEntry[]) {
  const fixture = await evaluationFixture();
  let scope = fixture.scope();
  if (entries !== undefined) {
    const agentTrajectoryRepo = new InMemoryAgentTrajectoryRepository(fixture.agentRunRepo);
    await agentTrajectoryRepo.append(GRADED_RUN, entries);
    scope = createTestScope({ ...fixture, agentTrajectoryRepo, caller: scope.caller });
  }
  const { definition, step } = await loadEvaluatedStep(scope, STEP, 'read');
  return { scope, context: { step: STEP, definition, workflowStep: step } };
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
