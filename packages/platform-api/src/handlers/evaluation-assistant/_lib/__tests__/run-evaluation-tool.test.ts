import { describe, it, expect } from 'vitest';
import { loadEvaluatedStep } from '../../../evaluation/_lib/evaluated-step';
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
});
