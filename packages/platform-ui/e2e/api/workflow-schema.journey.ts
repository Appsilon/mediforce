import { test, expect } from '../helpers/test-fixtures';

const API_KEY = process.env.PLATFORM_API_KEY ?? 'test-api-key';
const authHeaders = { 'X-Api-Key': API_KEY };

test.describe('Workflow definition JSON Schema API', () => {
  test('serves the live authorable workflow definition schema', async ({ request }) => {
    const res = await request.get('/api/workflow-definitions/schema', { headers: authHeaders });

    expect(res.status(), await res.text()).toBe(200);
    const body = await res.json() as {
      schema: {
        type?: string;
        properties?: Record<string, { type?: string; items?: unknown }>;
      };
    };

    expect(body.schema.type).toBe('object');
    expect(body.schema.properties).toBeDefined();

    const properties = body.schema.properties ?? {};
    expect(properties.steps?.type).toBe('array');
    expect(properties.steps?.items).toBeDefined();
    expect(properties.transitions?.type).toBe('array');
    expect(properties.triggers?.type).toBe('array');

    expect(properties).not.toHaveProperty('namespace');
    expect(properties).not.toHaveProperty('version');
    expect(properties).not.toHaveProperty('createdAt');
  });
});
