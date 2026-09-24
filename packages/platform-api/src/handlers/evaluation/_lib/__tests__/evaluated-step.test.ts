import { describe, it, expect } from 'vitest';
import { NotFoundError, ValidationError } from '../../../../errors';
import { buildWorkflowDefinition } from '@mediforce/platform-core/testing';
import { userCaller } from '../../../../repositories/__tests__/create-test-scope';
import { loadEvaluatedStep } from '../evaluated-step';
import { evaluationFixture, STEP } from '../../__tests__/fixture';

describe('loadEvaluatedStep', () => {
  it('returns the agent step as the runnable version has it', async () => {
    const fixture = await evaluationFixture();
    const { definition, step } = await loadEvaluatedStep(fixture.scope(), STEP, 'edit');
    expect(definition.name).toBe('ae-grading');
    expect(step).toMatchObject({ id: 'grade-aes', executor: 'agent', agentId: 'ae-grader' });
  });

  it('refuses a step that is not an agent step, and a step that does not exist', async () => {
    const fixture = await evaluationFixture();
    await expect(loadEvaluatedStep(fixture.scope(), { ...STEP, stepId: 'extract-aes' }, 'read')).rejects.toBeInstanceOf(ValidationError);
    await expect(loadEvaluatedStep(fixture.scope(), { ...STEP, stepId: 'nope' }, 'read')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('refuses a step that still declares MCP servers inline — an eval policy cannot deny them', async () => {
    const fixture = await evaluationFixture();
    await fixture.processRepo.saveWorkflowDefinition(buildWorkflowDefinition({
      name: 'legacy-mcp',
      namespace: STEP.namespace,
      steps: [
        { id: 'grade', name: 'Grade', type: 'creation', executor: 'agent', agent: { prompt: 'Grade.', mcpServers: [{ name: 'edc', command: 'edc-mcp', args: [] }] } },
        { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
      ],
      transitions: [{ from: 'grade', to: 'done' }],
    }));
    await expect(loadEvaluatedStep(fixture.scope(), { ...STEP, workflowName: 'legacy-mcp', stepId: 'grade' }, 'read'))
      .rejects.toThrow(/declares MCP servers inline.*edc/);
  });

  it('reads another workspace\'s workflow as missing', async () => {
    const fixture = await evaluationFixture();
    await expect(loadEvaluatedStep(fixture.scope(userCaller('outsider', ['pharma-b'])), STEP, 'read'))
      .rejects.toBeInstanceOf(NotFoundError);
  });
});
