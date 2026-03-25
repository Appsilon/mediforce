import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

// --- Mock firebase/firestore ---
const mockGetDocs = vi.fn();
const mockGetDoc = vi.fn();
const mockCollection = vi.fn();
const mockQuery = vi.fn();
const mockWhere = vi.fn();
const mockDoc = vi.fn();

vi.mock('firebase/firestore', () => ({
  collection: (...args: unknown[]) => mockCollection(...args),
  query: (...args: unknown[]) => mockQuery(...args),
  where: (...args: unknown[]) => mockWhere(...args),
  getDocs: (...args: unknown[]) => mockGetDocs(...args),
  getDoc: (...args: unknown[]) => mockGetDoc(...args),
  doc: (...args: unknown[]) => mockDoc(...args),
}));

// --- Mock @/lib/firebase ---
vi.mock('@/lib/firebase', () => ({
  db: {},
}));

import { useAllUserNamespaces } from '../use-all-user-namespaces';

function makeFakeDoc(data: Record<string, unknown>, exists = true) {
  return { data: () => data, exists: () => exists };
}

function makeFakeSnapshot(docs: ReturnType<typeof makeFakeDoc>[]) {
  return { docs, empty: docs.length === 0 };
}

const personalNamespace = {
  handle: 'alice',
  displayName: 'Alice',
  type: 'personal' as const,
  linkedUserId: 'uid-1',
  createdAt: '2024-01-01T00:00:00.000Z',
};

const orgNamespace = {
  handle: 'acme-corp',
  displayName: 'Acme Corp',
  type: 'organization' as const,
  createdAt: '2024-01-01T00:00:00.000Z',
};

describe('useAllUserNamespaces', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCollection.mockReturnValue('namespaces-ref');
    mockQuery.mockImplementation((ref: unknown) => ref);
    mockWhere.mockReturnValue('where-clause');
    mockDoc.mockReturnValue('doc-ref');
  });

  it('[DATA] returns empty list when uid is null', async () => {
    const { result } = renderHook(() => useAllUserNamespaces(null));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.namespaces).toEqual([]);
    expect(mockGetDocs).not.toHaveBeenCalled();
  });

  it('[DATA] returns personal namespace when user has no organizations', async () => {
    // getDocs for personal query
    mockGetDocs.mockResolvedValueOnce(makeFakeSnapshot([makeFakeDoc(personalNamespace)]));
    // getDoc for users/{uid} — no organizations field
    mockGetDoc.mockResolvedValueOnce(makeFakeDoc({ email: 'alice@test.com' }));

    const { result } = renderHook(() => useAllUserNamespaces('uid-1'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.namespaces).toHaveLength(1);
    expect(result.current.namespaces[0].handle).toBe('alice');
    expect(result.current.namespaces[0].type).toBe('personal');
  });

  it('[DATA] merges personal and org namespaces from user doc', async () => {
    // getDocs for personal query
    mockGetDocs.mockResolvedValueOnce(makeFakeSnapshot([makeFakeDoc(personalNamespace)]));
    // getDoc for users/{uid} with organizations array
    mockGetDoc
      .mockResolvedValueOnce(makeFakeDoc({ organizations: ['acme-corp', 'alice'] }))
      // getDoc for namespaces/acme-corp (alice already seen from personal)
      .mockResolvedValueOnce(makeFakeDoc(orgNamespace));

    const { result } = renderHook(() => useAllUserNamespaces('uid-1'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.namespaces).toHaveLength(2);
    const handles = result.current.namespaces.map((ns) => ns.handle);
    expect(handles).toContain('alice');
    expect(handles).toContain('acme-corp');
  });

  it('[DATA] returns only org namespaces when no personal namespace found', async () => {
    // getDocs for personal query — empty
    mockGetDocs.mockResolvedValueOnce(makeFakeSnapshot([]));
    // getDoc for users/{uid} with organizations array
    mockGetDoc
      .mockResolvedValueOnce(makeFakeDoc({ organizations: ['acme-corp'] }))
      // getDoc for namespaces/acme-corp
      .mockResolvedValueOnce(makeFakeDoc(orgNamespace));

    const { result } = renderHook(() => useAllUserNamespaces('uid-1'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.namespaces).toHaveLength(1);
    expect(result.current.namespaces[0].handle).toBe('acme-corp');
    expect(result.current.namespaces[0].type).toBe('organization');
  });
});
