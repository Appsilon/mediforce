import { test, expect } from '../helpers/test-fixtures';

const API_KEY = process.env.PLATFORM_API_KEY ?? 'test-api-key';
const authHeaders = { 'X-Api-Key': API_KEY, 'Content-Type': 'application/json' };

const validTemplate = {
  name: 'api-schema-validation',
  steps: [
    { id: 'start', name: 'Start', type: 'creation', executor: 'human' },
    { id: 'end', name: 'End', type: 'terminal', executor: 'human' },
  ],
  transitions: [{ from: 'start', to: 'end' }],
  triggers: [{ type: 'manual', name: 'manual' }],
};

test.describe('Workflow definition schema validation API', () => {
  test('returns cross-field schema errors as data without persisting', async ({ request }) => {
    const candidate = {
      ...validTemplate,
      name: `api-schema-validation-${Date.now()}`,
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

    const res = await request.post('/api/workflow-definitions/validate', {
      headers: authHeaders,
      data: candidate,
    });

    expect(res.status(), await res.text()).toBe(200);
    const body = await res.json() as {
      valid: boolean;
      errors: Array<{ path: string; message: string }>;
    };
    expect(body.valid).toBe(false);
    expect(body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: expect.stringContaining('verdicts'),
          message: expect.stringContaining('ghost-step'),
        }),
      ]),
    );

    const listRes = await request.get('/api/workflow-definitions', { headers: authHeaders });
    expect(listRes.status(), await listRes.text()).toBe(200);
    const list = await listRes.json() as {
      definitions: Array<{ name: string }>;
    };
    expect(list.definitions.some((definition) => definition.name === candidate.name)).toBe(false);
  });
});
