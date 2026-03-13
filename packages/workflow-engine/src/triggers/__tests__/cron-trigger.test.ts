import { describe, it, expect, vi } from 'vitest';
import { CronTrigger } from '../cron-trigger.js';
import type { WorkflowEngine } from '../../engine/workflow-engine.js';

function createMockEngine(): WorkflowEngine {
  return {
    createInstance: vi.fn().mockResolvedValue({ id: 'inst-123' }),
    startInstance: vi.fn().mockResolvedValue(undefined),
  } as unknown as WorkflowEngine;
}

describe('CronTrigger', () => {
  it('creates and starts an instance with triggerType cron', async () => {
    const engine = createMockEngine();
    const trigger = new CronTrigger(engine);

    const result = await trigger.fire({
      definitionName: 'community-digest',
      definitionVersion: 'v1',
      triggerName: 'weekly-cron',
      triggeredBy: 'cron-heartbeat',
      payload: { schedule: '0 9 * * 1' },
      configName: 'default',
      configVersion: 'v1',
    });

    expect(result).toEqual({ instanceId: 'inst-123', status: 'created' });

    expect(engine.createInstance).toHaveBeenCalledWith(
      'community-digest',
      'v1',
      'cron-heartbeat',
      'cron',
      { schedule: '0 9 * * 1' },
      'default',
      'v1',
    );

    expect(engine.startInstance).toHaveBeenCalledWith('inst-123');
  });
});
