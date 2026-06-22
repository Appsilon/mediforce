import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { AuditEvent } from '@mediforce/platform-core';
import { createQueryWrapper } from '@/test/react-query';

const listAuditMock = vi.fn<(...args: unknown[]) => Promise<{ events: AuditEvent[] }>>();

vi.mock('@/lib/mediforce', () => ({
  mediforce: { processes: { listAuditEvents: listAuditMock } },
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  },
}));

const { useAuditEvents } = await import('../use-audit-events');

function buildEvent(overrides: Partial<AuditEvent>): AuditEvent {
  return {
    actorId: 'system',
    actorType: 'system',
    actorRole: 'engine',
    action: overrides.action ?? 'step_started',
    description: overrides.description ?? '',
    timestamp: overrides.timestamp ?? '2026-01-01T00:00:00.000Z',
    inputSnapshot: {},
    outputSnapshot: {},
    basis: 'transition',
    entityType: 'step',
    entityId: overrides.entityId ?? 'step-1',
    processInstanceId: overrides.processInstanceId,
    ...overrides,
  };
}

describe('useAuditEvents — react-query backed', () => {
  beforeEach(() => {
    listAuditMock.mockReset();
  });

  it('returns events sorted by timestamp ascending', async () => {
    listAuditMock.mockResolvedValue({
      events: [
        buildEvent({ action: 'b', timestamp: '2026-01-01T00:00:02.000Z' }),
        buildEvent({ action: 'a', timestamp: '2026-01-01T00:00:01.000Z' }),
        buildEvent({ action: 'c', timestamp: '2026-01-01T00:00:03.000Z' }),
      ],
    });
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useAuditEvents('run-1'), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data.map((e) => e.action)).toEqual(['a', 'b', 'c']);
  });

  it('does not fire when processInstanceId is null', () => {
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useAuditEvents(null), { wrapper });
    expect(listAuditMock).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
  });

  it('does not retry on 4xx errors', async () => {
    const { ApiError } = await import('@/lib/mediforce');
    listAuditMock.mockRejectedValue(new (ApiError as new (status: number, msg: string) => Error)(403, 'forbidden'));
    const { wrapper } = createQueryWrapper();

    const { result } = renderHook(() => useAuditEvents('run-1'), { wrapper });
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(listAuditMock).toHaveBeenCalledTimes(1);
  });
});
