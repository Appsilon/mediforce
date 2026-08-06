import { describe, it, expect } from 'vitest';
import { validateWorkflow } from '../validate-workflow';
import { createTestScope } from '../../../repositories/__tests__/create-test-scope';

const scope = createTestScope();

const validTemplate = {
  name: 'sample-flow',
  steps: [
    { id: 'start', name: 'Start', type: 'creation', executor: 'human' },
    { id: 'end', name: 'End', type: 'terminal', executor: 'human' },
  ],
  transitions: [{ from: 'start', to: 'end' }],
};

describe('validateWorkflow handler', () => {
  it('accepts a structurally valid template', async () => {
    await expect(validateWorkflow(validTemplate, scope)).resolves.toEqual({ valid: true, errors: [] });
  });

  it('strips server-managed fields so an edit-mode definition validates as a template', async () => {
    const fullDefinition = {
      ...validTemplate,
      namespace: 'team-alpha',
      version: 3,
      createdAt: '2026-01-01T00:00:00Z',
    };
    await expect(validateWorkflow(fullDefinition, scope)).resolves.toEqual({ valid: true, errors: [] });
  });

  it('reports a cross-field error the shallow checks would miss (unknown verdict target)', async () => {
    const candidate = {
      ...validTemplate,
      steps: [
        {
          id: 'start',
          name: 'Start',
          type: 'review',
          executor: 'human',
          verdicts: { approve: { target: 'ghost-step' } },
        },
        { id: 'end', name: 'End', type: 'terminal', executor: 'human' },
      ],
    };

    const result = await validateWorkflow(candidate, scope);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path.includes('verdicts') && /ghost-step/.test(e.message))).toBe(true);
  });

  it('reports an executor/plugin mismatch (script config on a non-script step)', async () => {
    const candidate = {
      ...validTemplate,
      steps: [
        {
          id: 'start',
          name: 'Start',
          type: 'creation',
          executor: 'human',
          script: { inlineScript: 'noop', runtime: 'javascript' },
        },
        { id: 'end', name: 'End', type: 'terminal', executor: 'human' },
      ],
    };

    const result = await validateWorkflow(candidate, scope);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('returns structured errors for an empty candidate rather than throwing', async () => {
    const result = await validateWorkflow({}, scope);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('rejects a structurally-invalid graph that passes the schema (unreachable step)', async () => {
    const candidate = {
      ...validTemplate,
      steps: [
        { id: 'start', name: 'Start', type: 'creation', executor: 'human' },
        { id: 'orphan', name: 'Orphan', type: 'creation', executor: 'human' },
        { id: 'end', name: 'End', type: 'terminal', executor: 'human' },
      ],
      transitions: [
        { from: 'start', to: 'end' },
        { from: 'orphan', to: 'end' },
      ],
    };

    const result = await validateWorkflow(candidate, scope);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /unreachable/i.test(e.message))).toBe(true);
  });

  it('rejects a definition with a broken step reference (${steps.<nonexistent>})', async () => {
    const candidate = {
      ...validTemplate,
      steps: [
        {
          id: 'start',
          name: 'Start',
          type: 'creation',
          executor: 'human',
          assignedTo: '${steps.ghost.value}',
        },
        { id: 'end', name: 'End', type: 'terminal', executor: 'human' },
      ],
    };

    const result = await validateWorkflow(candidate, scope);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /ghost/.test(e.message))).toBe(true);
  });
});
