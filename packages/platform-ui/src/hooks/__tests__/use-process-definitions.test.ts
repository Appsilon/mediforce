import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { buildWorkflowDefinition } from '@mediforce/platform-core/testing';
import { createQueryWrapper } from '@/test/react-query';

const listMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();
class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
vi.mock('@/lib/mediforce', () => ({
  mediforce: { workflows: { list: listMock } },
  ApiError,
}));

const { useProcessDefinitions } = await import('../use-process-definitions');

describe('useProcessDefinitions', () => {
  beforeEach(() => {
    listMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts in loading state then populates definitions, maps and flags', async () => {
    const def = buildWorkflowDefinition({
      name: 'wf-a',
      namespace: 'ns1',
      version: 3,
      title: 'Workflow A',
      description: 'desc',
      triggers: [{ type: 'manual', name: 'Start' }],
    });
    const runSummary = { total: 5, active: 2, latest: [] };
    listMock.mockResolvedValue({
      definitions: [
        { namespace: 'ns1', name: 'wf-a', latestVersion: 3, defaultVersion: 3, definition: def, runSummary },
      ],
    });

    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useProcessDefinitions(), { wrapper });

    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(listMock).toHaveBeenCalledWith({ includeCompletedRuns: true });
    expect(result.current.definitions).toHaveLength(1);
    const group = result.current.definitions[0];
    expect(group.name).toBe('wf-a');
    expect(group.latestVersion).toBe('3');
    expect(group.stepCount).toBe(def.steps.length);
    expect(group.hasManualTrigger).toBe(true);
    expect(group.namespace).toBe('ns1');
    expect(group.runSummary).toEqual(runSummary);

    // latestDocs keyed `${namespace}:${name}` with the full WorkflowDefinition
    const doc = result.current.latestDocs.get('ns1:wf-a');
    expect(doc?.name).toBe('wf-a');
    expect(doc?.namespace).toBe('ns1');
    expect(doc?.version).toBe(3);

    // stepsByDefinition excludes terminal steps
    const steps = result.current.stepsByDefinition.get('wf-a');
    expect(steps).toEqual(['intake', 'review']);
  });

  it('derives hasManualTrigger=false when no trigger has type manual', async () => {
    const def = buildWorkflowDefinition({
      triggers: [{ type: 'webhook', name: 'Hook', config: { method: 'POST', path: '/x' } }],
    });
    listMock.mockResolvedValue({
      definitions: [
        {
          namespace: 'ns1',
          name: 'wf-a',
          latestVersion: 1,
          defaultVersion: 1,
          definition: def,
          runSummary: { total: 0, active: 0, latest: [] },
        },
      ],
    });

    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useProcessDefinitions(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.definitions[0].hasManualTrigger).toBe(false);
  });

  it('forwards includeCompletedRuns=false to the list call', async () => {
    listMock.mockResolvedValue({ definitions: [] });

    const { wrapper } = createQueryWrapper();
    renderHook(() => useProcessDefinitions(false), { wrapper });

    await waitFor(() => expect(listMock).toHaveBeenCalledWith({ includeCompletedRuns: false }));
  });

  it('surfaces 4xx errors without retrying', async () => {
    const err = new ApiError(403, 'forbidden');
    listMock.mockRejectedValue(err);

    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useProcessDefinitions(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe(err);
    expect(listMock).toHaveBeenCalledTimes(1);
    expect(result.current.definitions).toEqual([]);
  });

  it('returns empty maps and arrays for an empty definitions list', async () => {
    listMock.mockResolvedValue({ definitions: [] });

    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useProcessDefinitions(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.definitions).toEqual([]);
    expect(result.current.latestDocs.size).toBe(0);
    expect(result.current.stepsByDefinition.size).toBe(0);
  });

  it('refetches on cache invalidation and surfaces the fresh definitions', async () => {
    listMock.mockResolvedValueOnce({
      definitions: [
        {
          namespace: 'ns1',
          name: 'wf-old',
          latestVersion: 1,
          defaultVersion: 1,
          definition: buildWorkflowDefinition({ name: 'wf-old' }),
          runSummary: { total: 0, active: 0, latest: [] },
        },
      ],
    });

    const { wrapper, queryClient } = createQueryWrapper();
    const { result } = renderHook(() => useProcessDefinitions(), { wrapper });

    await waitFor(() => expect(result.current.definitions.map((g) => g.name)).toEqual(['wf-old']));

    listMock.mockResolvedValueOnce({
      definitions: [
        {
          namespace: 'ns1',
          name: 'wf-fresh',
          latestVersion: 2,
          defaultVersion: 2,
          definition: buildWorkflowDefinition({ name: 'wf-fresh' }),
          runSummary: { total: 0, active: 0, latest: [] },
        },
      ],
    });
    await queryClient.invalidateQueries({ queryKey: ['workflows', 'list'] });

    await waitFor(() => expect(result.current.definitions.map((g) => g.name)).toEqual(['wf-fresh']));
    expect(listMock).toHaveBeenCalledTimes(2);
  });
});
