import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { AgentRun } from '@mediforce/platform-core';
import { buildAgentRun } from '@mediforce/platform-core/testing';
import { createQueryWrapper } from '@/test/react-query';

const listMock = vi.fn<(...args: unknown[]) => Promise<{ runs: AgentRun[] }>>();
const getMock = vi.fn<(...args: unknown[]) => Promise<{ run: AgentRun }>>();
class ApiErrorMock extends Error {
  constructor(public status: number) {
    super(`ApiError ${String(status)}`);
  }
}
vi.mock('@/lib/mediforce', () => ({
  mediforce: { agentRuns: { list: listMock, get: getMock } },
  ApiError: ApiErrorMock,
}));

vi.mock('../use-collection', () => ({
  useCollection: () => ({ data: [], loading: false, error: null }),
}));

const { useAgentRuns, useAgentRunsForStep, useAgentRun } = await import('../use-agent-runs');

beforeEach(() => {
  listMock.mockReset();
  getMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useAgentRuns', () => {
  it('GETs /api/agent-runs with namespace filter and returns runs', async () => {
    listMock.mockResolvedValue({ runs: [buildAgentRun({ id: 'r-1' })] });
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useAgentRuns('team-alpha'), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(listMock).toHaveBeenCalledWith({ namespace: 'team-alpha' });
    expect(result.current.data.map((r) => r.id)).toEqual(['r-1']);
  });

  it('surfaces a 4xx ApiError without retrying or staying stuck loading', async () => {
    const err = new ApiErrorMock(403);
    listMock.mockRejectedValue(err);
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useAgentRuns('team-alpha'), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe(err);
    expect(listMock).toHaveBeenCalledTimes(1);
  });

  it('does not fire while handle is empty (page still resolving URL params)', () => {
    const { wrapper } = createQueryWrapper();
    renderHook(() => useAgentRuns(''), { wrapper });
    expect(listMock).not.toHaveBeenCalled();
  });
});

describe('useAgentRunsForStep', () => {
  it('is disabled until both runId + stepId are provided', () => {
    const { wrapper } = createQueryWrapper();
    renderHook(() => useAgentRunsForStep(null, null), { wrapper });
    expect(listMock).not.toHaveBeenCalled();
  });

  it('GETs with { runId, stepId } when both present', async () => {
    listMock.mockResolvedValue({ runs: [buildAgentRun({ id: 'r-2' })] });
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useAgentRunsForStep('inst-a', 'review'), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(listMock).toHaveBeenCalledWith({ runId: 'inst-a', stepId: 'review' });
    expect(result.current.data.map((r) => r.id)).toEqual(['r-2']);
  });
});

describe('useAgentRun', () => {
  it('returns null without firing when runId is null', () => {
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useAgentRun(null), { wrapper });
    expect(getMock).not.toHaveBeenCalled();
    expect(result.current.data).toBeNull();
  });

  it('GETs /api/agent-runs/:id and unwraps the entity', async () => {
    getMock.mockResolvedValue({ run: buildAgentRun({ id: 'ar-9' }) });
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useAgentRun('ar-9'), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(getMock).toHaveBeenCalledWith({ agentRunId: 'ar-9' });
    expect(result.current.data?.id).toBe('ar-9');
  });
});

describe('useAgentRun polling (CRITICAL LIVE 1.5s)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps polling while the run is non-terminal (running)', async () => {
    getMock.mockResolvedValue({ run: buildAgentRun({ id: 'ar-1', status: 'running' }) });
    const { wrapper } = createQueryWrapper();
    renderHook(() => useAgentRun('ar-1'), { wrapper });

    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(1600);
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(2));
    await vi.advanceTimersByTimeAsync(1600);
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(3));
  });

  it('stops polling once the run reaches a terminal status (completed)', async () => {
    getMock.mockResolvedValueOnce({ run: buildAgentRun({ id: 'ar-1', status: 'running' }) });
    getMock.mockResolvedValue({ run: buildAgentRun({ id: 'ar-1', status: 'completed' }) });
    const { wrapper } = createQueryWrapper();
    renderHook(() => useAgentRun('ar-1'), { wrapper });

    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(1600);
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(2));

    await vi.advanceTimersByTimeAsync(5_000);
    expect(getMock).toHaveBeenCalledTimes(2);
  });

  it('stops polling once the run reaches a terminal status (error)', async () => {
    getMock.mockResolvedValueOnce({ run: buildAgentRun({ id: 'ar-1', status: 'running' }) });
    getMock.mockResolvedValue({ run: buildAgentRun({ id: 'ar-1', status: 'error' }) });
    const { wrapper } = createQueryWrapper();
    renderHook(() => useAgentRun('ar-1'), { wrapper });

    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(1600);
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(2));

    await vi.advanceTimersByTimeAsync(5_000);
    expect(getMock).toHaveBeenCalledTimes(2);
  });
});
