import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const mockOnSnapshot = vi.fn();
const mockDoc = vi.fn();

vi.mock('firebase/firestore', () => ({
  doc: (...args: unknown[]) => mockDoc(...args),
  onSnapshot: (...args: unknown[]) => mockOnSnapshot(...args),
}));

vi.mock('@/lib/firebase', () => ({ db: {} }));

const mockUseAuth = vi.fn();
vi.mock('@/contexts/auth-context', () => ({
  useAuth: () => mockUseAuth(),
}));

import { useNamespaceRole } from '../use-namespace-role';

function makeFakeDoc(data: Record<string, unknown> | null, exists = true) {
  return { data: () => data, exists: () => exists };
}

function setupSnapshotData(data: Record<string, unknown> | null) {
  mockOnSnapshot.mockImplementation((_ref, onNext) => {
    onNext(makeFakeDoc(data, data !== null));
    return vi.fn();
  });
}

describe('useNamespaceRole', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDoc.mockReturnValue('member-ref');
  });

  it('returns null role when not signed in', async () => {
    mockUseAuth.mockReturnValue({ firebaseUser: null });

    const { result } = renderHook(() => useNamespaceRole('acme'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.role).toBeNull();
    expect(result.current.canAdmin).toBe(false);
    expect(mockOnSnapshot).not.toHaveBeenCalled();
  });

  it('returns null role when handle is empty', async () => {
    mockUseAuth.mockReturnValue({ firebaseUser: { uid: 'uid-1' } });

    const { result } = renderHook(() => useNamespaceRole(''));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.role).toBeNull();
    expect(result.current.canAdmin).toBe(false);
    expect(mockOnSnapshot).not.toHaveBeenCalled();
  });

  it('sets role to owner and canAdmin true when member doc says owner', async () => {
    mockUseAuth.mockReturnValue({ firebaseUser: { uid: 'uid-1' } });
    setupSnapshotData({
      uid: 'uid-1',
      role: 'owner',
      joinedAt: '2026-04-23T00:00:00.000Z',
    });

    const { result } = renderHook(() => useNamespaceRole('acme'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.role).toBe('owner');
    expect(result.current.canAdmin).toBe(true);
  });

  it('sets canAdmin true for admin role', async () => {
    mockUseAuth.mockReturnValue({ firebaseUser: { uid: 'uid-1' } });
    setupSnapshotData({
      uid: 'uid-1',
      role: 'admin',
      joinedAt: '2026-04-23T00:00:00.000Z',
    });

    const { result } = renderHook(() => useNamespaceRole('acme'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.role).toBe('admin');
    expect(result.current.canAdmin).toBe(true);
  });

  it('sets canAdmin false for member role', async () => {
    mockUseAuth.mockReturnValue({ firebaseUser: { uid: 'uid-1' } });
    setupSnapshotData({
      uid: 'uid-1',
      role: 'member',
      joinedAt: '2026-04-23T00:00:00.000Z',
    });

    const { result } = renderHook(() => useNamespaceRole('acme'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.role).toBe('member');
    expect(result.current.canAdmin).toBe(false);
  });

  it('sets role null when member doc does not exist', async () => {
    mockUseAuth.mockReturnValue({ firebaseUser: { uid: 'uid-1' } });
    setupSnapshotData(null);

    const { result } = renderHook(() => useNamespaceRole('acme'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.role).toBeNull();
    expect(result.current.canAdmin).toBe(false);
  });

  it('sets role null when member doc data is invalid', async () => {
    mockUseAuth.mockReturnValue({ firebaseUser: { uid: 'uid-1' } });
    setupSnapshotData({ role: 'bogus' });

    const { result } = renderHook(() => useNamespaceRole('acme'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.role).toBeNull();
  });

  it('handles snapshot error by clearing role', async () => {
    mockUseAuth.mockReturnValue({ firebaseUser: { uid: 'uid-1' } });
    mockOnSnapshot.mockImplementation((_ref, _onNext, onError) => {
      onError(new Error('permission-denied'));
      return vi.fn();
    });

    const { result } = renderHook(() => useNamespaceRole('acme'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.role).toBeNull();
    expect(result.current.canAdmin).toBe(false);
  });

  it('passes correct Firestore path to doc()', async () => {
    mockUseAuth.mockReturnValue({ firebaseUser: { uid: 'uid-1' } });
    setupSnapshotData({
      uid: 'uid-1',
      role: 'owner',
      joinedAt: '2026-04-23T00:00:00.000Z',
    });

    renderHook(() => useNamespaceRole('acme'));

    await waitFor(() => expect(mockDoc).toHaveBeenCalled());

    expect(mockDoc).toHaveBeenCalledWith({}, 'namespaces', 'acme', 'members', 'uid-1');
  });
});
