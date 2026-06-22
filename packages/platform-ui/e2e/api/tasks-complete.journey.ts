import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';

/**
 * Full happy-path through the migrated `POST /api/tasks/:taskId/complete`
 * handler — verdict variant. Drives the discriminated-union body shape and
 * the handler-resident audit emits introduced in Phase 3 of the headless-
 * platform-API migration (ADR-0005 §7):
 *   - `task.completed` (preserved from pre-migration shape)
 *   - `process.resumed_after_task` (preserved from pre-migration shape)
 *   plus the engine-side companions visible on the chain.
 *
 * `previous-run-outputs.journey.ts` already covers the `kind: 'params'`
 * variant; this file covers verdict + the new audit assertions.
 */

const API_KEY = process.env.PLATFORM_API_KEY ?? 'test-api-key';

async function pollUntil<T>(
  fn: () => Promise<T | null>,
  {
    timeoutMs = 10_000,
    intervalMs = 200,
    description = 'condition',
  }: { timeoutMs?: number; intervalMs?: number; description?: string } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const last = await fn();
    if (last !== null) return last;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Timed out waiting for ${description} (${timeoutMs}ms)`);
}

test.describe('POST /api/tasks/[taskId]/complete — verdict variant', () => {
  test('drives a run to completion and emits the Phase 3 audit chain', async ({ request }) => {
    const wdName = `e2e-complete-verdict-${Date.now()}`;
    const wd = {
      name: wdName,
      title: 'Complete verdict E2E',
      steps: [
        {
          id: 'review',
          name: 'Review',
          type: 'review',
          executor: 'human',
          allowedRoles: ['operator'],
        },
        { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
      ],
      transitions: [{ from: 'review', to: 'done' }],
      triggers: [{ type: 'manual', name: 'Start' }],
    };
    const createWdRes = await request.post(`/api/workflow-definitions?namespace=${TEST_ORG_HANDLE}`, {
      headers: { 'X-Api-Key': API_KEY, 'Content-Type': 'application/json' },
      data: wd,
    });
    expect(createWdRes.status(), await createWdRes.text()).toBe(201);

    const triggerRes = await request.post('/api/processes', {
      headers: { 'X-Api-Key': API_KEY, 'Content-Type': 'application/json' },
      data: {
        namespace: TEST_ORG_HANDLE,
        definitionName: wdName,
        triggeredBy: 'e2e-test',
        triggerName: 'Start',
      },
    });
    expect(triggerRes.status(), await triggerRes.text()).toBe(201);
    const { run } = (await triggerRes.json()) as { run: { id: string } };
    const instanceId = run.id;

    const task = await pollUntil(
      async () => {
        const res = await request.get(`/api/tasks?instanceId=${instanceId}`, {
          headers: { 'X-Api-Key': API_KEY },
        });
        if (res.status() !== 200) return null;
        const body = (await res.json()) as {
          tasks: Array<{ id: string; stepId: string; status: string }>;
        };
        return body.tasks.find((t) => t.stepId === 'review') ?? null;
      },
      { description: `review task for ${instanceId}` },
    );

    const completeRes = await request.post(`/api/tasks/${task.id}/complete`, {
      headers: { 'X-Api-Key': API_KEY, 'Content-Type': 'application/json' },
      data: { kind: 'verdict', verdict: 'approve', comment: 'lgtm' },
    });
    expect(completeRes.status(), await completeRes.text()).toBe(200);
    const completeBody = (await completeRes.json()) as {
      task: { id: string; status: string };
      run: { id: string };
    };
    expect(completeBody.task.status).toBe('completed');
    expect(completeBody.run.id).toBe(instanceId);

    await pollUntil(
      async () => {
        const res = await request.get(`/api/processes/${instanceId}`, {
          headers: { 'X-Api-Key': API_KEY },
        });
        if (res.status() !== 200) return null;
        const body = (await res.json()) as { status: string };
        return body.status === 'completed' ? body : null;
      },
      { description: `instance ${instanceId} to complete` },
    );

    const auditRes = await request.get(`/api/processes/${instanceId}/audit`, {
      headers: { 'X-Api-Key': API_KEY },
    });
    expect(auditRes.status()).toBe(200);
    const { events } = (await auditRes.json()) as {
      events: Array<{ action: string }>;
    };
    const actions = events.map((e) => e.action);
    // Phase 3 handler-resident bridge emits — both must be on the chain.
    expect(actions).toContain('task.completed');
    expect(actions).toContain('process.resumed_after_task');
    // Engine-side companion the user-facing audit log relies on.
    expect(actions).toContain('task.created');
  });
});
