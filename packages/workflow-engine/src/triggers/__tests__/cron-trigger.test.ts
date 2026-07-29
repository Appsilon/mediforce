import { describe, it, expect, vi } from 'vitest';
import {
  InMemoryAuditRepository,
  InMemoryProcessInstanceRepository,
  InMemoryProcessRepository,
} from '@mediforce/platform-core';
import type { WorkflowDefinition } from '@mediforce/platform-core';
import { CronTrigger } from '../cron-trigger';
import { WorkflowEngine } from '../../engine/workflow-engine';

function createMockEngine(): WorkflowEngine {
  return {
    createInstance: vi.fn().mockResolvedValue({ id: 'inst-123' }),
    startInstance: vi.fn().mockResolvedValue(undefined),
  } as unknown as WorkflowEngine;
}

const firing = {
  namespace: 'test',
  definitionName: 'community-digest',
  definitionVersion: 1,
  triggerName: 'weekly-cron',
  triggeredBy: 'cron-heartbeat',
};

describe('CronTrigger', () => {
  it('creates and starts an instance with triggerType cron', async () => {
    const engine = createMockEngine();
    const trigger = new CronTrigger(engine);

    const result = await trigger.fireWorkflow({ ...firing, payload: { region: 'eu' } });

    expect(result).toEqual({ instanceId: 'inst-123', status: 'created' });

    expect(engine.createInstance).toHaveBeenCalledWith(
      'test',
      'community-digest',
      1,
      'cron-heartbeat',
      'cron',
      { region: 'eu' },
      // No transport metadata on this firing, so no opts at all — a payload-only
      // cron call is byte-identical to the pre-ADR-0012 one.
      undefined,
    );

    expect(engine.startInstance).toHaveBeenCalledWith('inst-123');
  });

  /**
   * A cron firing splits into two namespaces (ADR-0012): the row's static input
   * becomes the trigger-agnostic `triggerPayload`, and the tick's own
   * `schedule`/`firedAt` become `triggerContext`. Before this they were fused
   * into one payload, so `${triggerPayload.schedule}` in a step encoded "a cron
   * started me".
   */
  describe('payload / context split', () => {
    const definition: WorkflowDefinition = {
      name: 'regional-report',
      version: 1,
      namespace: 'test',
      visibility: 'private',
      steps: [
        { id: 'start', name: 'Start', type: 'creation', executor: 'human' },
        { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
      ],
      transitions: [{ from: 'start', to: 'done' }],
      triggerInput: [{ name: 'region', type: 'string', required: true }],
    };

    async function fire(
      overrides: { payload?: Record<string, unknown>; context?: Record<string, unknown> },
    ) {
      const processRepo = new InMemoryProcessRepository();
      const instanceRepo = new InMemoryProcessInstanceRepository();
      await processRepo.saveWorkflowDefinition(definition);
      const trigger = new CronTrigger(
        new WorkflowEngine(processRepo, instanceRepo, new InMemoryAuditRepository()),
      );
      const result = await trigger.fireWorkflow({
        ...firing,
        definitionName: 'regional-report',
        ...overrides,
      });
      return instanceRepo.getById(result.instanceId);
    }

    it('lands the row payload on triggerPayload and the tick on triggerContext', async () => {
      const instance = await fire({
        payload: { region: 'eu' },
        context: { schedule: '0 3 * * *', firedAt: '2026-07-28T03:00:00.000Z' },
      });

      expect(instance?.triggerType).toBe('cron');
      expect(instance?.triggerPayload).toEqual({ region: 'eu' });
      expect(instance?.triggerContext).toEqual({
        schedule: '0 3 * * *',
        firedAt: '2026-07-28T03:00:00.000Z',
      });
      // The tick's own fields must not leak into the contract namespace, or a
      // step reading `${triggerPayload.*}` would behave differently under cron.
      expect(instance?.triggerPayload).not.toHaveProperty('schedule');
      expect(instance?.triggerPayload).not.toHaveProperty('firedAt');
    });

    it('leaves triggerContext unset when the firing carries none', async () => {
      const instance = await fire({ payload: { region: 'eu' } });
      expect(instance?.triggerContext).toBeUndefined();
    });
  });
});
