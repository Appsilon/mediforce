import { describe, it, expect } from 'vitest';
import { buildStepExecution } from '@mediforce/platform-core/testing';
import { agentVersionsByExecution } from '../process-detail';

describe('agentVersionsByExecution', () => {
  it('matches each retry attempt to the agent version it actually ran, in order', () => {
    const first = buildStepExecution({ stepId: 'deploy', startedAt: '2026-01-01T00:00:00.000Z' });
    const second = buildStepExecution({ stepId: 'deploy', startedAt: '2026-01-02T00:00:00.000Z' });

    const map = agentVersionsByExecution([first, second], [
      { stepId: 'deploy', startedAt: '2026-01-01T00:00:01.000Z', agentId: 'ship-it', agentVersion: 2 },
      { stepId: 'deploy', startedAt: '2026-01-02T00:00:01.000Z', agentId: 'ship-it', agentVersion: 3 },
    ]);

    expect(map.get(first.id)).toEqual({ agentId: 'ship-it', agentVersion: 2 });
    expect(map.get(second.id)).toEqual({ agentId: 'ship-it', agentVersion: 3 });
  });

  it('leaves out a step execution with no matching agent run', () => {
    const execution = buildStepExecution({ stepId: 'script-step', startedAt: '2026-01-01T00:00:00.000Z' });

    const map = agentVersionsByExecution([execution], []);

    expect(map.has(execution.id)).toBe(false);
  });
});
