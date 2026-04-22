import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';

/**
 * End-to-end verification of previous-run-outputs (inputForNextRun) through
 * the HTTP API only — no browser.
 *
 * Uses a Docker-free WD (single params-form human step) so the journey runs
 * fast and on CI without a daemon. The shipped `docs/examples/previous-run-example.wd.json`
 * uses a proper script + form pair; this journey asserts the core mechanism,
 * not the fancier demo.
 *
 * Chain:
 *   Run 1 — trigger → task is a params form with a `message` field → operator
 *   fills `message = "hello from run 1"` and submits via /resolve. Run completes.
 *   Run 2 — trigger → previousRun must equal { message: "hello from run 1" } and
 *   previousRunSourceId must point to run 1.
 *   Run 3 — trigger after a second submission → previousRun chains to run 2's
 *   message.
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
  let last: T | null = null;
  while (Date.now() < deadline) {
    last = await fn();
    if (last !== null) return last;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Timed out waiting for ${description} (${timeoutMs}ms)`);
}

test.describe('Previous run outputs — API E2E', () => {
  test('user-typed message round-trips across runs via inputForNextRun', async ({
    request,
  }) => {
    const wdName = `e2e-prev-run-${Date.now()}`;

    // -------- 1. Register WD --------
    const wd = {
      name: wdName,
      title: 'E2E Previous Run',
      steps: [
        {
          id: 'set-next',
          name: 'Set next message',
          type: 'creation',
          executor: 'human',
          allowedRoles: ['operator'],
          params: [
            {
              name: 'message',
              type: 'string',
              required: true,
              description: 'Message for the next run',
            },
          ],
        },
        {
          id: 'done',
          name: 'Done',
          type: 'terminal',
          executor: 'human',
        },
      ],
      transitions: [{ from: 'set-next', to: 'done' }],
      triggers: [{ type: 'manual', name: 'Start' }],
      inputForNextRun: [
        { stepId: 'set-next', output: 'message', as: 'message' },
      ],
    };

    const createWdRes = await request.post(
      `/api/workflow-definitions?namespace=${TEST_ORG_HANDLE}`,
      {
        headers: { 'X-Api-Key': API_KEY, 'Content-Type': 'application/json' },
        data: wd,
      },
    );
    expect(createWdRes.status(), await createWdRes.text()).toBe(201);

    async function driveRun(messageForNext: string): Promise<string> {
      const triggerRes = await request.post('/api/processes', {
        headers: { 'X-Api-Key': API_KEY, 'Content-Type': 'application/json' },
        data: {
          definitionName: wdName,
          triggeredBy: 'e2e-test',
          triggerName: 'Start',
        },
      });
      expect(triggerRes.status(), await triggerRes.text()).toBe(201);
      const { instanceId } = (await triggerRes.json()) as { instanceId: string };

      const task = await pollUntil(
        async () => {
          const res = await request.get(`/api/tasks?instanceId=${instanceId}`, {
            headers: { 'X-Api-Key': API_KEY },
          });
          if (res.status() !== 200) return null;
          const body = (await res.json()) as {
            tasks: Array<{ id: string; stepId: string; status: string }>;
          };
          return (
            body.tasks.find(
              (t) => t.stepId === 'set-next' && t.status !== 'completed',
            ) ?? null
          );
        },
        { description: `pending task on set-next for ${instanceId}` },
      );

      const submitRes = await request.post(`/api/tasks/${task.id}/resolve`, {
        headers: { 'X-Api-Key': API_KEY, 'Content-Type': 'application/json' },
        data: { paramValues: { message: messageForNext } },
      });
      expect(submitRes.status(), await submitRes.text()).toBe(200);

      await pollUntil(
        async () => {
          const res = await request.get(`/api/processes/${instanceId}`, {
            headers: { 'X-Api-Key': API_KEY },
          });
          if (res.status() !== 200) return null;
          const body = (await res.json()) as { status: string };
          return body.status === 'completed' ? body : null;
        },
        { description: `run ${instanceId} to complete` },
      );

      return instanceId;
    }

    async function fetchInstance(instanceId: string) {
      const res = await request.get(`/api/processes/${instanceId}`, {
        headers: { 'X-Api-Key': API_KEY },
      });
      expect(res.status(), await res.text()).toBe(200);
      return (await res.json()) as {
        status: string;
        previousRun?: Record<string, unknown>;
        previousRunSourceId?: string;
      };
    }

    // -------- 2. Run 1 — no predecessor, operator types "from run 1" --------
    const run1Id = await driveRun('from run 1');
    const run1 = await fetchInstance(run1Id);
    // On run 1, inputForNextRun is declared but no predecessor exists → {}.
    expect(run1.previousRun).toEqual({});
    expect(run1.previousRunSourceId).toBeUndefined();

    // -------- 3. Run 2 — should see run 1's message; operator types next --------
    const run2Trigger = await request.post('/api/processes', {
      headers: { 'X-Api-Key': API_KEY, 'Content-Type': 'application/json' },
      data: {
        definitionName: wdName,
        triggeredBy: 'e2e-test',
        triggerName: 'Start',
      },
    });
    expect(run2Trigger.status(), await run2Trigger.text()).toBe(201);
    const run2Id = (await run2Trigger.json()).instanceId as string;

    const run2Initial = await fetchInstance(run2Id);
    expect(run2Initial.previousRun).toEqual({ message: 'from run 1' });
    expect(run2Initial.previousRunSourceId).toBe(run1Id);

    // Now finish run 2 with a new message for run 3.
    const run2Task = await pollUntil(
      async () => {
        const res = await request.get(`/api/tasks?instanceId=${run2Id}`, {
          headers: { 'X-Api-Key': API_KEY },
        });
        if (res.status() !== 200) return null;
        const body = (await res.json()) as {
          tasks: Array<{ id: string; stepId: string; status: string }>;
        };
        return (
          body.tasks.find(
            (t) => t.stepId === 'set-next' && t.status !== 'completed',
          ) ?? null
        );
      },
      { description: 'pending task on set-next for run 2' },
    );
    await request.post(`/api/tasks/${run2Task.id}/resolve`, {
      headers: { 'X-Api-Key': API_KEY, 'Content-Type': 'application/json' },
      data: { paramValues: { message: 'from run 2' } },
    });
    await pollUntil(
      async () => {
        const res = await fetchInstance(run2Id);
        return res.status === 'completed' ? res : null;
      },
      { description: 'run 2 completed' },
    );

    // -------- 4. Run 3 — chain should advance to run 2's message --------
    const run3Trigger = await request.post('/api/processes', {
      headers: { 'X-Api-Key': API_KEY, 'Content-Type': 'application/json' },
      data: {
        definitionName: wdName,
        triggeredBy: 'e2e-test',
        triggerName: 'Start',
      },
    });
    expect(run3Trigger.status(), await run3Trigger.text()).toBe(201);
    const run3Id = (await run3Trigger.json()).instanceId as string;

    const run3 = await fetchInstance(run3Id);
    expect(run3.previousRun).toEqual({ message: 'from run 2' });
    expect(run3.previousRunSourceId).toBe(run2Id);
  });
});
