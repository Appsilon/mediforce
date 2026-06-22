import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { NamespaceMember } from '@mediforce/platform-core';

const useNamespaceMock = vi.fn();
vi.mock('../use-namespace', () => ({
  useNamespace: (handle: string) => useNamespaceMock(handle),
}));

const { useUserProfiles, useUserDisplayNames } = await import('../use-users');

function namespaceResult(members: Partial<NamespaceMember>[] | null) {
  if (members === null) {
    return { namespace: null, members: [], personalHandles: new Map<string, string>(), loading: false, error: null };
  }
  return {
    namespace: { handle: 'ns1' },
    members,
    personalHandles: new Map<string, string>(),
    loading: false,
    error: null,
  };
}

describe('useUserProfiles', () => {
  beforeEach(() => {
    useNamespaceMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns an empty Map when handle is null', () => {
    useNamespaceMock.mockReturnValue(namespaceResult(null));
    const { result } = renderHook(() => useUserProfiles(null));
    expect(result.current.size).toBe(0);
    expect(useNamespaceMock).toHaveBeenCalledWith('');
  });

  it('projects namespace members into a uid → info Map', () => {
    useNamespaceMock.mockReturnValue(
      namespaceResult([
        { uid: 'u1', displayName: 'Alice', avatarUrl: 'https://x/a.png' },
        { uid: 'u2', displayName: 'Bob' },
      ]),
    );
    const { result } = renderHook(() => useUserProfiles('ns1'));
    expect(result.current.get('u1')).toEqual({
      displayName: 'Alice',
      photoURL: 'https://x/a.png',
      personalHandle: undefined,
    });
    expect(result.current.get('u2')).toEqual({ displayName: 'Bob', photoURL: undefined, personalHandle: undefined });
  });

  it('falls back to uid when displayName is missing', () => {
    useNamespaceMock.mockReturnValue(namespaceResult([{ uid: 'u1' }]));
    const { result } = renderHook(() => useUserProfiles('ns1'));
    expect(result.current.get('u1')?.displayName).toBe('u1');
  });

  it('normalises empty-string avatarUrl to undefined photoURL', () => {
    useNamespaceMock.mockReturnValue(namespaceResult([{ uid: 'u1', displayName: 'Alice', avatarUrl: '' }]));
    const { result } = renderHook(() => useUserProfiles('ns1'));
    expect(result.current.get('u1')?.photoURL).toBeUndefined();
  });
});

describe('useUserDisplayNames', () => {
  it('returns a Map<uid, displayName> derived from useUserProfiles', () => {
    useNamespaceMock.mockReturnValue(
      namespaceResult([
        { uid: 'u1', displayName: 'Alice' },
        { uid: 'u2', displayName: 'Bob' },
      ]),
    );
    const { result } = renderHook(() => useUserDisplayNames('ns1'));
    expect(result.current.get('u1')).toBe('Alice');
    expect(result.current.get('u2')).toBe('Bob');
  });
});
