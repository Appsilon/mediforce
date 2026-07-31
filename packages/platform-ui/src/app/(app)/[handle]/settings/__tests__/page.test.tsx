import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { NamespaceMemberWithAuth } from '@mediforce/platform-api/contract';

const listMembersMock = vi.fn();
const resendInviteMock = vi.fn();

vi.mock('@/lib/mediforce', () => ({
  // The component reads `err.message` off any Error, so the resend path needs no
  // real ApiError; this stub only has to satisfy the `{ ApiError }` import.
  ApiError: class ApiError extends Error {},
  mediforce: {
    users: {
      listMembers: (...args: unknown[]) => listMembersMock(...args),
      resendInvite: (...args: unknown[]) => resendInviteMock(...args),
    },
  },
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ handle: 'acme' }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock('@/contexts/auth-context', () => ({
  useAuth: () => ({
    user: { id: 'owner-uid', name: 'Owner', email: 'owner@acme.dev', image: null },
  }),
}));

vi.mock('@/hooks/use-namespace', () => ({
  useNamespace: () => ({
    namespace: {
      type: 'organization',
      handle: 'acme',
      displayName: 'Acme Labs',
      bio: '',
      icon: 'Building2',
    },
    personalHandles: new Map<string, string>(),
    loading: false,
  }),
}));

vi.mock('@/hooks/use-namespace-mutations', () => {
  const stub = () => ({ mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false });
  return {
    useDeleteNamespace: stub,
    useLeaveNamespace: stub,
    useRemoveMember: stub,
    useUpdateMemberRole: stub,
    useUpdateNamespace: stub,
  };
});

vi.mock('@/components/namespace/namespace-secrets-editor', () => ({
  NamespaceSecretsEditor: () => null,
}));

import WorkspaceConfigPage from '../page';

function member(overrides: Partial<NamespaceMemberWithAuth> & Pick<NamespaceMemberWithAuth, 'uid'>): NamespaceMemberWithAuth {
  return {
    uid: overrides.uid,
    role: 'member',
    displayName: overrides.uid,
    email: `${overrides.uid}@acme.dev`,
    lastSignInTime: null,
    joinedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const OWNER = member({ uid: 'owner-uid', role: 'owner', displayName: 'Owner' });
const PENDING = member({ uid: 'pending-uid', displayName: 'Pending Person', lastSignInTime: null });
const ACTIVATED = member({
  uid: 'active-uid',
  displayName: 'Active Person',
  lastSignInTime: '2026-01-15T09:30:00.000Z',
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<WorkspaceConfigPage />, { wrapper });
}

beforeEach(() => {
  listMembersMock.mockReset();
  resendInviteMock.mockReset();
  listMembersMock.mockResolvedValue({ members: [OWNER, PENDING, ACTIVATED] });
});

describe('WorkspaceConfigPage — resend invite', () => {
  it('[pending] renders the resend button for a member who has never signed in', async () => {
    renderPage();

    expect(await screen.findByLabelText('Resend invite to Pending Person')).toBeInTheDocument();
  });

  it('[activated] hides the resend button for a member who has already signed in', async () => {
    renderPage();

    // Wait for the members table to populate before asserting the absence.
    expect(await screen.findByLabelText('Resend invite to Pending Person')).toBeInTheDocument();
    expect(screen.queryByLabelText('Resend invite to Active Person')).not.toBeInTheDocument();
  });

  it('[precondition] surfaces the backend refusal as a visible message instead of failing silently', async () => {
    resendInviteMock.mockRejectedValue(
      new Error('Cannot resend invite: user has already activated their account'),
    );
    renderPage();

    const button = await screen.findByLabelText('Resend invite to Pending Person');
    await userEvent.click(button);

    await waitFor(() =>
      expect(
        screen.getByText('Cannot resend invite: user has already activated their account'),
      ).toBeInTheDocument(),
    );
  });
});
