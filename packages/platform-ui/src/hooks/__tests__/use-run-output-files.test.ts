import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { RunOutputFileEntry } from '@mediforce/platform-api/contract';
import { createQueryWrapper } from '@/test/react-query';

function file(stepId: string, name: string): RunOutputFileEntry {
  return { stepId, name, path: `.mediforce/output/${stepId}/${name}`, size: 42 };
}

const listOutputFilesMock = vi.fn<(...args: unknown[]) => Promise<{ files: RunOutputFileEntry[] }>>();
class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
vi.mock('@/lib/mediforce', () => ({
  mediforce: { runs: { listOutputFiles: listOutputFilesMock } },
  ApiError,
}));

const { useRunOutputFiles } = await import('../use-run-output-files');

describe('useRunOutputFiles', () => {
  beforeEach(() => {
    listOutputFilesMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('does not call the API when runId is null', () => {
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useRunOutputFiles(null, 'running'), { wrapper });
    expect(result.current.data).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(listOutputFilesMock).not.toHaveBeenCalled();
  });

  it('returns the file listing for a run', async () => {
    const files = [file('intake', 'manifest.json'), file('report', 'summary.pdf')];
    listOutputFilesMock.mockResolvedValue({ files });
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useRunOutputFiles('run-a', 'running'), { wrapper });

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(listOutputFilesMock).toHaveBeenCalledWith({ runId: 'run-a' });
    expect(result.current.data).toEqual(files);
  });

  it('surfaces 4xx errors immediately and stops polling', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    listOutputFilesMock.mockRejectedValue(new ApiError(404, 'not found'));
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useRunOutputFiles('run-a', 'running'), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(listOutputFilesMock).toHaveBeenCalledTimes(1);
    expect(result.current.data).toEqual([]);

    await vi.advanceTimersByTimeAsync(20_000);
    expect(listOutputFilesMock).toHaveBeenCalledTimes(1);
  });

  it('stops polling when instanceStatus is terminal (completed)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    listOutputFilesMock.mockResolvedValue({ files: [] });
    const { wrapper } = createQueryWrapper();
    renderHook(() => useRunOutputFiles('run-a', 'completed'), { wrapper });

    await waitFor(() => expect(listOutputFilesMock).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(20_000);
    expect(listOutputFilesMock).toHaveBeenCalledTimes(1);
  });

  it('keeps polling at STANDARD LIVE cadence while the run is non-terminal', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    listOutputFilesMock.mockResolvedValue({ files: [] });
    const { wrapper } = createQueryWrapper();
    renderHook(() => useRunOutputFiles('run-a', 'running'), { wrapper });

    await waitFor(() => expect(listOutputFilesMock).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(5_500);
    await waitFor(() => expect(listOutputFilesMock.mock.calls.length).toBeGreaterThanOrEqual(2));
  });
});
