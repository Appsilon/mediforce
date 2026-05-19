import { test, expect } from '../helpers/test-fixtures';
import {
  apiKeyHeaders,
  bearerHeaders,
  setupMultiNamespaceCallers,
  type MultiNamespaceFixture,
} from '../helpers/multi-namespace';

/**
 * L3 API E2E for GET /api/tasks/[taskId] — migrated to platform-api in #450.
 *
 * Proves end-to-end:
 *   - Happy path: api-key + seeded task → 200 + full HumanTask shape.
 *   - 403 boundary: outsider user (not a member of `test`) is forbidden.
 *     Tasks use `assertNamespaceAccess` (403) — they do NOT 404-anti-enum
 *     here because the task id itself is internal and the existence check
 *     happens before the namespace check; the processes/cowork endpoints
 *     are the ones with the anti-enum collapse, asserted in their journeys.
 *   - 404 missing: bogus id returns "Task not found".
 */

test.describe('GET /api/tasks/[taskId] — API E2E', () => {
  let callers: MultiNamespaceFixture;

  test.beforeAll(async () => {
    callers = await setupMultiNamespaceCallers();
  });

  test('api-key caller fetches a seeded task and gets the full shape', async ({ request }) => {
    const res = await request.get('/api/tasks/task-completed-1', {
      headers: apiKeyHeaders(),
    });
    expect(res.status(), await res.text()).toBe(200);
    const task = await res.json() as {
      id: string;
      processInstanceId: string;
      status: string;
      completionData: unknown;
    };
    expect(task.id).toBe('task-completed-1');
    expect(task.processInstanceId).toBe('proc-completed-1');
    expect(task.status).toBe('completed');
    expect(task.completionData).toEqual({ approved: true, notes: 'All checks passed' });
  });

  test('outsider user (different namespace) is forbidden — 403', async ({ request }) => {
    const res = await request.get('/api/tasks/task-completed-1', {
      headers: bearerHeaders(callers.outsider),
    });
    expect(res.status()).toBe(403);
  });

  test('non-existent task id returns 404 (before namespace check)', async ({ request }) => {
    const res = await request.get('/api/tasks/task-does-not-exist', {
      headers: bearerHeaders(callers.outsider),
    });
    expect(res.status()).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/not found/i);
  });
});
