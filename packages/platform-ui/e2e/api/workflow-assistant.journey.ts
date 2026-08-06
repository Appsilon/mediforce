import { test, expect } from '../helpers/test-fixtures';

// L3 route journey for POST /api/workflow-assistant.
//
// Covers the route adapter's auth, request parsing, and error mapping — every
// path that fails BEFORE the handler calls OpenRouter, so no model/network is
// needed. The happy path (a prompt applying a canvas mutation) requires a mock
// OpenRouter server and is tracked separately.

const API_KEY = process.env.PLATFORM_API_KEY ?? 'test-api-key';
const authHeaders = { 'X-Api-Key': API_KEY, 'Content-Type': 'application/json' };
const namespace = 'tenant-a';

const validGraph = {
  steps: [
    { id: 'start', name: 'Start', type: 'creation', executor: 'human' },
    { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
  ],
  transitions: [{ from: 'start', to: 'done' }],
};

test.describe('POST /api/workflow-assistant — API E2E', () => {
  test('unauthenticated request is rejected (401)', async ({ request }) => {
    const res = await request.post(`/api/workflow-assistant?namespace=${namespace}`, {
      headers: { 'Content-Type': 'application/json' },
      data: { messages: [{ role: 'user', content: 'hi' }], workflowDefinition: validGraph },
    });
    expect(res.status()).toBe(401);
  });

  test('empty messages array fails schema validation (400)', async ({ request }) => {
    const res = await request.post(`/api/workflow-assistant?namespace=${namespace}`, {
      headers: authHeaders,
      data: { messages: [], workflowDefinition: validGraph },
    });
    expect(res.status(), await res.text()).toBe(400);
  });

  test('an over-long message is rejected by the size cap (400)', async ({ request }) => {
    const res = await request.post(`/api/workflow-assistant?namespace=${namespace}`, {
      headers: authHeaders,
      data: {
        messages: [{ role: 'user', content: 'x'.repeat(20_001) }],
        workflowDefinition: validGraph,
      },
    });
    expect(res.status(), await res.text()).toBe(400);
  });
});
