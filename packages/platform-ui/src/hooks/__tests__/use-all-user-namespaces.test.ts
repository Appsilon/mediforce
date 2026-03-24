import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

// --- Mock firebase/firestore ---
const mockGetDocs = vi.fn();
const mockGetDoc = vi.fn();
const mockCollection = vi.fn();
const mockCollectionGroup = vi.fn();
const mockQuery = vi.fn();
const mockWhere = vi.fn();
const mockDoc = vi.fn();

vi.mock('firebase/firestore', () => ({
  collection: (...args: unknown[]) => mockCollection(...args),
  collectionGroup: (...args: unknown[]) => mockCollectionGroup(...args),
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

// Helper to build a fake Firestore doc snapshot
function makeFakeDoc(data: Record<string, unknown>) {
  return { data: () => data, exists: () => true };
}

// Helper to build a fake Firestore query snapshot
function makeFakeSnapshot(docs: ReturnType<typeof makeFakeDoc>[]) {
  return { docs };
}

// Helper to build a fake member doc with a parent.parent ref pointing to a path
function makeFakeMemberDoc(parentPath: string) {
  return {
    data: () => ({ uid: 'uid-1', role: 'member', joinedAt: '2024-01-01T00:00:00.000Z' }),
    ref: {
      parent: {
        parent: { path: parentPath },
      },
    },
  };
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
    // Default: query/collection/where return stable sentinel values
    mockCollection.mockReturnValue('namespaces-ref');
    mockCollectionGroup.mockReturnValue('members-group-ref');
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

  it('[DATA] returns personal namespace when linkedUserId matches', async () => {
    mockGetDocs
      .mockResolvedValueOnce(makeFakeSnapshot([makeFakeDoc(personalNamespace)])) // personal query
      .mockResolvedValueOnce(makeFakeSnapshot([])); // members query

    const { result } = renderHook(() => useAllUserNamespaces('uid-1'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.namespaces).toHaveLength(1);
    expect(result.current.namespaces[0].handle).toBe('alice');
    expect(result.current.namespaces[0].type).toBe('personal');
  });

  it('[DATA] merges personal and org namespaces, deduplicates by handle', async () => {
    // personal query returns alice
    // members query returns two memberships: acme-corp (new) and alice (duplicate)
    mockGetDocs
      .mockResolvedValueOnce(makeFakeSnapshot([makeFakeDoc(personalNamespace)])) // personal
      .mockResolvedValueOnce(
        makeFakeSnapshot([
          makeFakeMemberDoc('namespaces/acme-corp'),
          makeFakeMemberDoc('namespaces/alice'), // duplicate handle
        ]),
      ); // members

    // First org doc: acme-corp
    mockGetDoc
      .mockResolvedValueOnce(makeFakeDoc(orgNamespace))
      // Second org doc: alice (duplicate)
      .mockResolvedValueOnce(makeFakeDoc(personalNamespace));

    const { result } = renderHook(() => useAllUserNamespaces('uid-1'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // alice from personal + acme-corp from org — alice duplicate from org is deduped
    expect(result.current.namespaces).toHaveLength(2);
    const handles = result.current.namespaces.map((ns) => ns.handle);
    expect(handles).toContain('alice');
    expect(handles).toContain('acme-corp');
  });

  it('[DATA] returns only org namespaces when no personal namespace found', async () => {
    mockGetDocs
      .mockResolvedValueOnce(makeFakeSnapshot([])) // personal: empty
      .mockResolvedValueOnce(makeFakeSnapshot([makeFakeMemberDoc('namespaces/acme-corp')])); // members

    mockGetDoc.mockResolvedValueOnce(makeFakeDoc(orgNamespace));

    const { result } = renderHook(() => useAllUserNamespaces('uid-1'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.namespaces).toHaveLength(1);
    expect(result.current.namespaces[0].handle).toBe('acme-corp');
    expect(result.current.namespaces[0].type).toBe('organization');
  });
});
