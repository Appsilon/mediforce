import { describe, it, expect } from 'vitest';
import { getWorkflowSchema } from '../get-workflow-schema';
import { createTestScope } from '../../../repositories/__tests__/create-test-scope';

const scope = createTestScope();

describe('getWorkflowSchema handler', () => {
  it('returns a JSON Schema for the authorable WorkflowDefinition surface', async () => {
    const { schema } = await getWorkflowSchema({}, scope);
    expect(schema.type).toBe('object');

    const properties = schema.properties as Record<string, unknown>;
    expect(properties).toHaveProperty('steps');
    expect(properties).toHaveProperty('transitions');
    expect(properties).toHaveProperty('triggers');

    // Server-managed fields are excluded — authors never supply them.
    expect(properties).not.toHaveProperty('namespace');
    expect(properties).not.toHaveProperty('version');
    expect(properties).not.toHaveProperty('createdAt');
  });

  it('exposes nested step structure (deep schema, not just top-level types)', async () => {
    const { schema } = await getWorkflowSchema({}, scope);
    const steps = (schema.properties as Record<string, { type?: string; items?: unknown }>).steps;
    expect(steps.type).toBe('array');
    expect(steps.items).toBeDefined();
  });
});
