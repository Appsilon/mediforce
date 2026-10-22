import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';

/**
 * The workflow catalog previews each card's newest runs. It ships them slim —
 * only what the preview row renders — so a run's variables and trigger payload
 * never ride along on `GET /api/workflow-definitions`.
 */

const API_KEY = process.env.PLATFORM_API_KEY ?? 'test-api-key';
const HEADERS = { 'X-Api-Key': API_KEY, 'Content-Type': 'application/json' };

const PREVIEW_KEYS = [
  'createdAt',
  'currentStepId',
  'definitionName',
  'definitionVersion',
  'error',
  'id',
  'pauseReason',
  'status',
  'totalCostUsd',
];

test.describe('GET /api/workflow-definitions — run preview', () => {
  test('previews a run with only the card fields, not its trigger payload', async ({ request }) => {
    const definitionName = `e2e-run-preview-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const registerRes = await request.post(`/api/workflow-definitions?namespace=${TEST_ORG_HANDLE}`, {
      headers: HEADERS,
      data: {
        name: definitionName,
        title: 'Run preview',
        triggerInput: [{ name: 'report', type: 'string', required: true }],
        steps: [
          { id: 'review', name: 'Review', type: 'review', executor: 'human', allowedRoles: ['operator'] },
          { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
        ],
        transitions: [{ from: 'review', to: 'done' }],
      },
    });
    expect(registerRes.status(), await registerRes.text()).toBe(201);

    const startRes = await request.post('/api/processes', {
      headers: HEADERS,
      data: {
        namespace: TEST_ORG_HANDLE,
        definitionName,
        triggeredBy: 'e2e-test',
        triggerName: 'Start',
        payload: { report: 'x'.repeat(10_000) },
      },
    });
    expect(startRes.status(), await startRes.text()).toBe(201);
    const { run } = (await startRes.json()) as { run: { id: string } };

    const listRes = await request.get('/api/workflow-definitions', { headers: HEADERS });
    expect(listRes.status(), await listRes.text()).toBe(200);
    const list = (await listRes.json()) as {
      definitions: Array<{ name: string; runSummary: { latest: Array<Record<string, unknown>> } }>;
    };
    const group = list.definitions.find((definition) => definition.name === definitionName);
    expect(group, `${definitionName} should be in the list`).toBeDefined();

    const [preview] = group!.runSummary.latest;
    expect(preview?.id).toBe(run.id);
    expect(preview).not.toHaveProperty('triggerPayload');
    expect(preview).not.toHaveProperty('variables');
    for (const key of Object.keys(preview ?? {})) {
      expect(PREVIEW_KEYS, `unexpected preview field '${key}'`).toContain(key);
    }
  });
});
