import { test, expect } from '../helpers/test-fixtures';
import {
  apiKeyHeaders,
  sessionCookieHeaders,
  setupMultiNamespaceCallers,
  type MultiNamespaceFixture,
} from '../helpers/multi-namespace';

test.describe('POST /api/tasks/[taskId]/viewed — API E2E', () => {
  let callers: MultiNamespaceFixture;

  test.beforeAll(async () => {
    callers = await setupMultiNamespaceCallers();
  });

  test('apiKey caller is refused with a typed 403 envelope', async ({ request }) => {
    const res = await request.post('/api/tasks/task-completed-1/viewed', {
      headers: apiKeyHeaders(),
    });
    expect(res.status(), await res.text()).toBe(403);
    const body = await res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe('forbidden');
    expect(body.error.message).toMatch(/system actor|view/i);
  });

  test('outsider user gets 404 (anti-enumeration) for a task in another workspace', async ({ request }) => {
    const res = await request.post('/api/tasks/task-completed-1/viewed', {
      headers: sessionCookieHeaders(callers.outsider),
    });
    expect(res.status()).toBe(404);
    const body = await res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe('not_found');
  });

  test('non-existent task id returns the same 404 (indistinguishable from cross-namespace)', async ({ request }) => {
    const res = await request.post('/api/tasks/task-does-not-exist/viewed', {
      headers: sessionCookieHeaders(callers.outsider),
    });
    expect(res.status()).toBe(404);
    const body = await res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe('not_found');
  });

  // `task-completed-1` is used read-only here — recording a view never
  // changes task state, so reusing the same completed, already-terminal
  // fixture other journeys read (tasks-get, tasks-claim's 409 case) is safe.
  test('member views a task → 200 with recorded: true', async ({ request }) => {
    const res = await request.post('/api/tasks/task-completed-1/viewed', {
      headers: sessionCookieHeaders(callers.member),
    });
    expect(res.status(), await res.text()).toBe(200);
    const body = await res.json() as { recorded: boolean };
    expect(body.recorded).toBe(true);
  });
});
