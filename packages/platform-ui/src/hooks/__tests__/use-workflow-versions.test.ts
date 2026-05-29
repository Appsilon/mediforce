import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import type { WorkflowDefinition } from '@mediforce/platform-core';
import type { WorkflowVersionSummary } from '@mediforce/platform-api/contract';
import { buildWorkflowDefinition } from '@mediforce/platform-core/testing';
import { createQueryWrapper } from '@/test/react-query';

type VersionsResult = {
  versions: WorkflowVersionSummary[];
  defaultVersion: number | null;
};

function summary(version: number, overrides: Partial<WorkflowVersionSummary> = {}): WorkflowVersionSummary {
  return {
    version,
    archived: false,
    stepCount: 1,
    triggerCount: 0,
    ...overrides,
  };
}

const versionsMock = vi.fn<(...args: unknown[]) => Promise<VersionsResult>>();
const getMock = vi.fn<(...args: unknown[]) => Promise<{ definition: WorkflowDefinition }>>();
class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
vi.mock('@/lib/mediforce', () => ({
  mediforce: { workflows: { versions: versionsMock, get: getMock } },
  ApiError,
}));

const { useWorkflowVersions, useWorkflowVersion } = await import('../use-workflow-versions');

describe('useWorkflowVersions', () => {
  beforeEach(() => {
    versionsMock.mockReset();
    getMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not call the API when name or namespace is empty', () => {
    const { wrapper } = createQueryWrapper();
    renderHook(() => useWorkflowVersions('', 'team-a'), { wrapper });
    renderHook(() => useWorkflowVersions('wf', ''), { wrapper });
    expect(versionsMock).not.toHaveBeenCalled();
  });

  it('returns versions sorted DESC by version number', async () => {
    versionsMock.mockResolvedValue({
      versions: [summary(2), summary(5), summary(1), summary(3)],
      defaultVersion: null,
    });
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useWorkflowVersions('wf', 'team-a'), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(versionsMock).toHaveBeenCalledWith({ name: 'wf', namespace: 'team-a' });
    expect(result.current.versions.map((v) => v.version)).toEqual([5, 3, 2, 1]);
    expect(result.current.latestVersion).toBe(5);
  });

  it('computes effectiveVersion = defaultVersion ?? latestVersion', async () => {
    versionsMock.mockResolvedValueOnce({
      versions: [summary(3), summary(1)],
      defaultVersion: 2,
    });
    const { wrapper: w1 } = createQueryWrapper();
    const { result: pinned } = renderHook(() => useWorkflowVersions('wf', 'team-a'), { wrapper: w1 });
    await waitFor(() => expect(pinned.current.loading).toBe(false));
    expect(pinned.current.defaultVersion).toBe(2);
    expect(pinned.current.effectiveVersion).toBe(2);

    versionsMock.mockResolvedValueOnce({
      versions: [summary(7), summary(4)],
      defaultVersion: null,
    });
    const { wrapper: w2 } = createQueryWrapper();
    const { result: floating } = renderHook(() => useWorkflowVersions('wf', 'team-b'), { wrapper: w2 });
    await waitFor(() => expect(floating.current.loading).toBe(false));
    expect(floating.current.defaultVersion).toBeNull();
    expect(floating.current.effectiveVersion).toBe(7);
  });

  it('surfaces 4xx errors immediately, single API call', async () => {
    versionsMock.mockRejectedValue(new ApiError(403, 'forbidden'));
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useWorkflowVersions('wf', 'team-a'), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(versionsMock).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBeInstanceOf(ApiError);
  });

  it('refreshDefault() invalidates and refetches', async () => {
    versionsMock.mockResolvedValue({ versions: [summary(1)], defaultVersion: 1 });
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useWorkflowVersions('wf', 'team-a'), { wrapper });

    await waitFor(() => expect(versionsMock).toHaveBeenCalledTimes(1));

    await act(async () => {
      await result.current.refreshDefault();
    });

    await waitFor(() => expect(versionsMock).toHaveBeenCalledTimes(2));
  });
});

describe('useWorkflowVersion', () => {
  beforeEach(() => {
    versionsMock.mockReset();
    getMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is disabled when version is null', () => {
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useWorkflowVersion('wf', 'team-a', null), { wrapper });
    expect(result.current.definition).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(getMock).not.toHaveBeenCalled();
  });

  it('returns the `definition` field of the result', async () => {
    const def = buildWorkflowDefinition({ name: 'wf' });
    getMock.mockResolvedValue({ definition: def });
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useWorkflowVersion('wf', 'team-a', 3), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(getMock).toHaveBeenCalledWith({ name: 'wf', namespace: 'team-a', version: 3 });
    expect(result.current.definition).toEqual(def);
  });

  it('is disabled when name or namespace is empty even if version is set', () => {
    const { wrapper } = createQueryWrapper();
    renderHook(() => useWorkflowVersion('', 'team-a', 1), { wrapper });
    renderHook(() => useWorkflowVersion('wf', '', 1), { wrapper });
    expect(getMock).not.toHaveBeenCalled();
  });

  it('surfaces 4xx errors and does not retry', async () => {
    getMock.mockRejectedValue(new ApiError(404, 'not found'));
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useWorkflowVersion('wf', 'team-a', 1), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(getMock).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBeInstanceOf(ApiError);
  });
});
