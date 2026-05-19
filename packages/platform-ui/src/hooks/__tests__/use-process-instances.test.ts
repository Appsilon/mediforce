import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { ProcessInstance } from '@mediforce/platform-core';
import { buildProcessInstance } from '@mediforce/platform-core/testing';

const useCollectionMock = vi.fn<(...args: unknown[]) => { data: ProcessInstance[]; loading: boolean; error: Error | null }>();

vi.mock('../use-collection', () => ({
  useCollection: (...args: unknown[]) => useCollectionMock(...args),
}));

vi.mock('@/lib/firebase', () => ({ db: {} }));

vi.mock('firebase/firestore', () => ({
  where: (field: string, op: string, value: unknown) => ({ field, op, value }),
  orderBy: (field: string, dir: string) => ({ orderBy: field, dir }),
  doc: vi.fn(),
  onSnapshot: vi.fn(),
  collection: vi.fn(),
}));

const { useProcessInstances } = await import('../use-process-instances');

describe('useProcessInstances — namespace filter (regression for PR #424)', () => {
  beforeEach(() => {
    useCollectionMock.mockReset();
  });

  it('only returns instances matching the requested namespace', () => {
    useCollectionMock.mockReturnValue({
      data: [
        buildProcessInstance({ id: 'a-1', namespace: 'appsilon', definitionName: 'daily-weather' }),
        buildProcessInstance({ id: 'f-1', namespace: 'filip',    definitionName: 'daily-weather' }),
        buildProcessInstance({ id: 'a-2', namespace: 'appsilon', definitionName: 'community-digest' }),
        buildProcessInstance({ id: 'm-1', namespace: 'mediforce', definitionName: 'workflow-designer' }),
      ],
      loading: false,
      error: null,
    });

    const { result } = renderHook(() => useProcessInstances('all', undefined, false, 'appsilon'));

    expect(result.current.data.map((i) => i.id)).toEqual(['a-1', 'a-2']);
  });

  it('returns empty list when no instance matches the namespace', () => {
    useCollectionMock.mockReturnValue({
      data: [
        buildProcessInstance({ id: 'f-1', namespace: 'filip' }),
        buildProcessInstance({ id: 'm-1', namespace: 'mediforce' }),
      ],
      loading: false,
      error: null,
    });

    const { result } = renderHook(() => useProcessInstances('all', undefined, false, 'appsilon'));

    expect(result.current.data).toEqual([]);
  });

  it('treats a missing namespace field on an instance as not matching (no implicit bypass)', () => {
    useCollectionMock.mockReturnValue({
      data: [
        buildProcessInstance({ id: 'no-ns', namespace: undefined as unknown as string }),
        buildProcessInstance({ id: 'appsilon-1', namespace: 'appsilon' }),
      ],
      loading: false,
      error: null,
    });

    const { result } = renderHook(() => useProcessInstances('all', undefined, false, 'appsilon'));

    expect(result.current.data.map((i) => i.id)).toEqual(['appsilon-1']);
  });

  it('combines namespace filter with deleted + archived filters', () => {
    useCollectionMock.mockReturnValue({
      data: [
        buildProcessInstance({ id: 'a-active',   namespace: 'appsilon' }),
        buildProcessInstance({ id: 'a-deleted',  namespace: 'appsilon', deleted: true }),
        buildProcessInstance({ id: 'a-archived', namespace: 'appsilon', archived: true }),
        buildProcessInstance({ id: 'f-active',   namespace: 'filip' }),
      ],
      loading: false,
      error: null,
    });

    const { result } = renderHook(() => useProcessInstances('all', undefined, false, 'appsilon'));

    expect(result.current.data.map((i) => i.id)).toEqual(['a-active']);
  });

  it('keeps archived instances when showArchived=true but still scopes by namespace', () => {
    useCollectionMock.mockReturnValue({
      data: [
        buildProcessInstance({ id: 'a-active',   namespace: 'appsilon' }),
        buildProcessInstance({ id: 'a-archived', namespace: 'appsilon', archived: true }),
        buildProcessInstance({ id: 'f-archived', namespace: 'filip',    archived: true }),
      ],
      loading: false,
      error: null,
    });

    const { result } = renderHook(() => useProcessInstances('all', undefined, true, 'appsilon'));

    expect(result.current.data.map((i) => i.id).sort()).toEqual(['a-active', 'a-archived']);
  });
});
