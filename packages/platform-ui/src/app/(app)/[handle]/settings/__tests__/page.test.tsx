import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { NamespaceMemberWithAuth } from '@mediforce/platform-api/contract';

const listMembersMock = vi.fn();
const resendInviteMock = vi.fn();
const inviteMock = vi.fn();

vi.mock('@/lib/mediforce', () => ({
  // The component reads `err.message` off any Error, so the resend path needs no
  // real ApiError; this stub only has to satisfy the `{ ApiError }` import.
  ApiError: class ApiError extends Error {},
  mediforce: {
    users: {
      listMembers: (...args: unknown[]) => listMembersMock(...args),
      resendInvite: (...args: unknown[]) => resendInviteMock(...args),
      invite: (...args: unknown[]) => inviteMock(...args),
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

// Flipped per test — the danger zone offers a different action per workspace
// type (personal resets, organization deletes).
let namespaceType: 'organization' | 'personal' = 'organization';

vi.mock('@/hooks/use-namespace', () => ({
  useNamespace: () => ({
    namespace: {
      type: namespaceType,
      handle: 'acme',
      displayName: 'Acme Labs',
      bio: '',
      icon: 'Building2',
      ...(namespaceType === 'personal' ? { linkedUserId: 'owner-uid' } : {}),
    },
    personalHandles: new Map<string, string>(),
    loading: false,
  }),
}));

vi.mock('@/hooks/use-namespace-mutations', () => {
  const stub = () => ({ mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false });
  return {
    useDeleteNamespace: stub,
    useResetNamespace: stub,
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
  inviteMock.mockReset();
  listMembersMock.mockResolvedValue({ members: [OWNER, PENDING, ACTIVATED] });
  namespaceType = 'organization';
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

describe('WorkspaceConfigPage — invite', () => {
  it('[refresh] shows the invited member in the table without a reload', async () => {
    const INVITED = member({ uid: 'invited-uid', displayName: 'Invited Person' });
    inviteMock.mockResolvedValue({
      email: 'invited@acme.dev',
      emailSent: true,
      isExisting: false,
    });
    renderPage();

    await screen.findByText('Pending Person');
    expect(screen.queryByText('Invited Person')).not.toBeInTheDocument();

    // The refreshed list carries the new member — the page must re-read it
    // after the invite instead of waiting for a page load.
    listMembersMock.mockResolvedValue({ members: [OWNER, PENDING, ACTIVATED, INVITED] });

    await userEvent.click(screen.getByRole('button', { name: 'Invite user' }));
    await userEvent.type(screen.getByLabelText(/Email/), 'invited@acme.dev');
    await userEvent.click(screen.getByRole('button', { name: 'Send invite' }));

    expect(await screen.findByText('Invited Person')).toBeInTheDocument();
  });
});

describe('WorkspaceConfigPage — danger zone', () => {
  it('[organization] offers Delete workspace to the owner', async () => {
    renderPage();

    expect(await screen.findByRole('button', { name: 'Delete workspace' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reset workspace' })).not.toBeInTheDocument();
  });

  it('[personal] offers Reset workspace instead of Delete — a personal workspace cannot be deleted', async () => {
    namespaceType = 'personal';
    renderPage();

    expect(await screen.findByRole('button', { name: 'Reset workspace' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete workspace' })).not.toBeInTheDocument();
  });
});
