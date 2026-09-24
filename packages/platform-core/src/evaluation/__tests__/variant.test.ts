import { describe, it, expect } from 'vitest';
import { buildWorkflowDefinition } from '../../testing/index';
import { applyStepVariant, isEmptyVariantPatch, variantPatchProblem } from '../variant';

const definition = buildWorkflowDefinition({
  name: 'ae-grading',
  namespace: 'pharma-a',
  externalSkillsRepo: { url: 'https://github.com/acme/skills', commit: 'aaaaaaa' },
  steps: [
    {
      id: 'grade-aes', name: 'Grade AEs', type: 'creation', executor: 'agent', agentId: 'ae-grader',
      agent: { model: 'anthropic/claude-sonnet-4', prompt: 'Grade each AE.', confidenceThreshold: 0.7 },
      mcpRestrictions: { edc: { denyTools: ['write_record'] } },
    },
    { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
  ],
  transitions: [{ from: 'grade-aes', to: 'done' }],
});
const step = definition.steps[0]!;

describe('applyStepVariant', () => {
  it('returns the step untouched for an empty patch', () => {
    const applied = applyStepVariant(definition, step, {});
    expect(applied.step).toBe(step);
    expect(applied.definition).toBe(definition);
  });

  it('replaces model, prompt and allowed tools, keeps the rest of the agent config', () => {
    const { step: patched, definition: patchedDefinition } = applyStepVariant(definition, step, {
      model: 'openai/gpt-5', prompt: 'Grade every AE by CTCAE v5.', allowedTools: ['WebFetch'],
    });
    expect(patched.agent).toEqual({
      model: 'openai/gpt-5', prompt: 'Grade every AE by CTCAE v5.', allowedTools: ['WebFetch'], confidenceThreshold: 0.7,
    });
    expect(patchedDefinition.steps[0]).toBe(patched);
    expect(patchedDefinition.steps[1]).toBe(definition.steps[1]);
    expect(step.agent?.model).toBe('anthropic/claude-sonnet-4');
  });

  it('narrows MCP restrictions and moves the skills commit', () => {
    const { step: patched, definition: patchedDefinition } = applyStepVariant(definition, step, {
      mcpRestrictions: { edc: { denyTools: ['delete_record'] }, email: { disable: true } },
      skillCommit: 'bbbbbbb',
    });
    expect(patched.mcpRestrictions).toEqual({
      edc: { denyTools: ['write_record', 'delete_record'] },
      email: { disable: true },
    });
    expect(patchedDefinition.externalSkillsRepo).toEqual({ url: 'https://github.com/acme/skills', commit: 'bbbbbbb' });
  });

  it('refuses a skills commit on a workflow without an external skills repository', () => {
    const carried = { ...definition, externalSkillsRepo: undefined };
    expect(variantPatchProblem(carried, { skillCommit: 'bbbbbbb' })).toMatch(/has none/);
    expect(() => applyStepVariant(carried, step, { skillCommit: 'bbbbbbb' })).toThrow(/has none/);
  });
});

describe('isEmptyVariantPatch', () => {
  it('is empty only when nothing is set', () => {
    expect(isEmptyVariantPatch({})).toBe(true);
    expect(isEmptyVariantPatch({ model: 'openai/gpt-5' })).toBe(false);
  });
});
