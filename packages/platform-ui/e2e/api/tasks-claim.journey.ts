import { test, expect } from '../helpers/test-fixtures';
import {
  apiKeyHeaders,
  bearerHeaders,
  setupMultiNamespaceCallers,
  type MultiNamespaceFixture,
} from '../helpers/multi-namespace';

test.describe('POST /api/tasks/[taskId]/claim — API E2E', () => {
  // ADR-0001 PR2: this suite depends on Firestore-seeded fixtures
  // ('task-pending-1', 'task-completed-1'). Postgres seed parity ships with
  // the process-instance + human-task fixture mirroring (PLAN-0001 §5.2 #9).
  test.skip(
    process.env.STORAGE_BACKEND === 'postgres',
    'Requires Firestore-seeded human_tasks; Postgres seed parity ships with §5.2 #9',
  );

  let callers: MultiNamespaceFixture;

  test.beforeAll(async () => {
    callers = await setupMultiNamespaceCallers();
  });

  test('apiKey caller is refused with a typed 403 envelope', async ({ request }) => {
    const res = await request.post('/api/tasks/task-pending-1/claim', {
      headers: apiKeyHeaders(),
    });
    expect(res.status(), await res.text()).toBe(403);
    const body = await res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe('forbidden');
    expect(body.error.message).toMatch(/system actor|authenticated user/i);
  });

  test('outsider user gets 404 (anti-enumeration) for a task in another workspace', async ({ request }) => {
    const res = await request.post('/api/tasks/task-pending-1/claim', {
      headers: bearerHeaders(callers.outsider),
    });
    expect(res.status()).toBe(404);
    const body = await res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe('not_found');
  });

  test('non-existent task id returns the same 404 (indistinguishable from cross-namespace)', async ({ request }) => {
    const res = await request.post('/api/tasks/task-does-not-exist/claim', {
      headers: bearerHeaders(callers.outsider),
    });
    expect(res.status()).toBe(404);
    const body = await res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe('not_found');
  });

  test('member claiming a completed task gets a typed 409 precondition_failed', async ({ request }) => {
    const res = await request.post('/api/tasks/task-completed-1/claim', {
      headers: bearerHeaders(callers.member),
    });
    expect(res.status()).toBe(409);
    const body = await res.json() as {
      error: { code: string; message: string; details?: { taskId: string; currentStatus: string } };
    };
    expect(body.error.code).toBe('precondition_failed');
    expect(body.error.details).toMatchObject({
      taskId: 'task-completed-1',
      currentStatus: 'completed',
    });
  });

  // Mutation last: claim a fresh pending task. The seeded `task-pending-1`
  // is not consumed by any other journey (verified via grep at PR1 time).
  test('member claims a pending task → 200 with entity echo in `claimed` state', async ({ request }) => {
    const res = await request.post('/api/tasks/task-pending-1/claim', {
      headers: bearerHeaders(callers.member),
    });
    expect(res.status(), await res.text()).toBe(200);
    const body = await res.json() as { task: { id: string; status: string; assignedUserId: string } };
    expect(body.task.id).toBe('task-pending-1');
    expect(body.task.status).toBe('claimed');
    expect(body.task.assignedUserId).toBe(callers.member.uid);
  });
});
