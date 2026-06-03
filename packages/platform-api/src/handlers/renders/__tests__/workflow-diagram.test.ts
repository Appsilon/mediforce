import { describe, it, expect } from 'vitest';
import { renderWorkflowDiagram, RenderWorkflowDiagramInputSchema } from '../workflow-diagram';

describe('renderWorkflowDiagram', () => {
  const minimalDef = {
    definition: {
      name: 'test-flow',
      description: 'A test workflow',
      steps: [
        { id: 'start', name: 'Start', type: 'creation', executor: 'human' },
        { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
      ],
      transitions: [{ from: 'start', to: 'done' }],
      triggers: [{ type: 'manual', name: 'manual' }],
    },
  };

  it('returns HTML string', () => {
    const html = renderWorkflowDiagram(minimalDef);
    expect(typeof html).toBe('string');
    expect(html).toContain('test-flow');
    expect(html).toContain('Start');
    expect(html).toContain('Done');
  });

  it('color-codes step types', () => {
    const html = renderWorkflowDiagram(minimalDef);
    expect(html).toContain('#bfdbfe'); // creation border
    expect(html).toContain('#d1d5db'); // terminal border
  });

  it('renders executor badges', () => {
    const html = renderWorkflowDiagram(minimalDef);
    expect(html).toContain('Human');
  });

  it('renders verdicts as pills', () => {
    const def = {
      definition: {
        ...minimalDef.definition,
        steps: [
          { id: 'draft', name: 'Draft', type: 'creation', executor: 'agent' },
          {
            id: 'review', name: 'Review', type: 'review', executor: 'human',
            verdicts: { approve: { target: 'done' }, revise: { target: 'draft' } },
          },
          { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
        ],
        transitions: [{ from: 'draft', to: 'review' }],
      },
    };
    const html = renderWorkflowDiagram(def);
    expect(html).toContain('approve');
    expect(html).toContain('revise');
    expect(html).toContain('done');
  });

  it('renders trigger input fields', () => {
    const def = {
      definition: {
        ...minimalDef.definition,
        triggerInput: [
          { name: 'email', type: 'string', required: true, description: 'Target email' },
        ],
      },
    };
    const html = renderWorkflowDiagram(def);
    expect(html).toContain('email');
    expect(html).toContain('Target email');
  });

  it('input schema validates minimal definition', () => {
    const result = RenderWorkflowDiagramInputSchema.safeParse(minimalDef);
    expect(result.success).toBe(true);
  });

  it('input schema rejects missing steps', () => {
    const result = RenderWorkflowDiagramInputSchema.safeParse({
      definition: { transitions: [] },
    });
    expect(result.success).toBe(false);
  });
});
