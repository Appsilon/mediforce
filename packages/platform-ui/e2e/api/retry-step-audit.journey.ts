import { test, expect } from '../helpers/test-fixtures';
import { apiKeyHeaders } from '../helpers/multi-namespace';

/**
 * L3 API E2E for the `instance.retried` audit event written by
 * POST /api/processes/[instanceId]/steps/[stepId]/retry (#836).
 *
 * The handler tests stub the engine, so they cannot prove what the real engine
 * + real storage produce. Two claims only an end-to-end run pins down:
 *
 *   1. `outputSnapshot` carries no execution id. It used to carry
 *      `newExecutionId`, which was always the pre-retry FAILED execution's id —
 *      a linkage that never existed, since the retry's execution is created
 *      later by the auto-runner.
 *   2. `inputSnapshot.previousExecutionId` is the failed execution being
 *      replaced. The handler reads executions *before* the engine resumes the
 *      run; read after, the auto-runner can append its own execution first and
 *      the event ends up pointing at the retry instead of the failure.
 *
 * Uses a dedicated instance — `proc-retry-test` is consumed by the L4 UI
 * journey and both projects share one MEDIFORCE_DATA_DIR.
 */

const INSTANCE_ID = 'proc-retry-audit';
const STEP_ID = 'human-review';
const FAILED_EXECUTION_ID = 'exec-retry-audit-fail-1';
const FAILURE_MESSAGE = 'Simulated step failure for retry audit journey';

interface AuditEvent {
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly processInstanceId: string;
  readonly inputSnapshot: Record<string, unknown>;
  readonly outputSnapshot: Record<string, unknown>;
}

test.describe('POST /api/processes/*/steps/*/retry — audit event, API E2E', () => {
  test('instance.retried records the pre-retry failure and no new execution id', async ({ request }) => {
    const retry = await request.post(
      `/api/processes/${INSTANCE_ID}/steps/${STEP_ID}/retry`,
      { headers: apiKeyHeaders() },
    );
    expect(retry.status(), await retry.text()).toBe(200);
    const retried = await retry.json() as { run: { id: string; status: string } };
    expect(retried.run.id).toBe(INSTANCE_ID);

    const audit = await request.get(`/api/processes/${INSTANCE_ID}/audit`, {
      headers: apiKeyHeaders(),
    });
    expect(audit.status(), await audit.text()).toBe(200);
    const { events } = await audit.json() as { events: AuditEvent[] };

    const instanceRetried = events.filter((event) => event.action === 'instance.retried');
    expect(instanceRetried).toHaveLength(1);
    const event = instanceRetried[0]!;

    expect(event.entityType).toBe('processInstance');
    expect(event.entityId).toBe(INSTANCE_ID);
    expect(event.processInstanceId).toBe(INSTANCE_ID);

    // Exact match: any execution id reappearing here is the #836 regression.
    expect(event.outputSnapshot).toEqual({
      resetTo: 'running',
      currentStepId: STEP_ID,
    });

    expect(event.inputSnapshot).toEqual({
      instanceId: INSTANCE_ID,
      stepId: STEP_ID,
      previousExecutionId: FAILED_EXECUTION_ID,
      previousError: FAILURE_MESSAGE,
    });

    // Both audit lanes stay populated — the engine's stepExecution-scoped event
    // alongside the handler's instance-scoped one. Asserted here rather than in
    // its own test so nothing depends on the single retry above having already run.
    const stepRetried = events.filter((auditEvent) => auditEvent.action === 'step.retried');
    expect(stepRetried).toHaveLength(1);
    expect(stepRetried[0]!.entityType).toBe('stepExecution');
    expect(stepRetried[0]!.entityId).toBe(FAILED_EXECUTION_ID);
  });
});
