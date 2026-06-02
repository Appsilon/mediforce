import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { MeNamespace } from '@mediforce/platform-api/contract';

const replaceMock = vi.fn();

interface AuthState {
  firebaseUser: { uid: string; displayName: string | null; email: string | null } | null;
  loading: boolean;
}
interface NsState {
  namespaces: MeNamespace[];
  loading: boolean;
  isError: boolean;
  error: Error | null;
}

let authState: AuthState;
let nsState: NsState;

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock }),
}));

vi.mock('next/image', () => ({
  default: ({ alt, ...rest }: { alt: string }) => <img alt={alt} {...rest} />,
}));

vi.mock('@/contexts/auth-context', () => ({
  useAuth: () => authState,
}));

vi.mock('@/hooks/use-all-user-namespaces', () => ({
  useAllUserNamespaces: () => nsState,
}));

import WorkspaceSelectionPage from '../page';

function ns(overrides: Partial<MeNamespace> & Pick<MeNamespace, 'handle'>): MeNamespace {
  return { type: 'organization', displayName: overrides.handle, role: 'owner', ...overrides };
}

beforeEach(() => {
  replaceMock.mockClear();
  localStorage.clear();
  authState = {
    firebaseUser: { uid: 'u1', displayName: 'Test User', email: 'test@mediforce.dev' },
    loading: false,
  };
  nsState = { namespaces: [], loading: false, isError: false, error: null };
});

describe('WorkspaceSelectionPage', () => {
  it('[>=2] shows the picker with a card per workspace and does not redirect', async () => {
    nsState.namespaces = [
      ns({ handle: 'me', type: 'personal', displayName: 'Me' }),
      ns({ handle: 'acme-labs', displayName: 'Acme Labs' }),
    ];

    render(<WorkspaceSelectionPage />);

    expect(await screen.findByText('Choose a workspace to continue')).toBeInTheDocument();
    expect(screen.getByText('My workspace')).toBeInTheDocument();
    expect(screen.getByText('Acme Labs')).toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('[=1] redirects straight to the only workspace and never shows the picker', async () => {
    nsState.namespaces = [ns({ handle: 'solo', displayName: 'Solo' })];

    render(<WorkspaceSelectionPage />);

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/solo'));
    expect(screen.queryByText('Choose a workspace to continue')).not.toBeInTheDocument();
  });

  it('[error] surfaces the explicit error message instead of an empty picker', async () => {
    nsState.isError = true;
    nsState.error = new Error('Internal Server Error');

    render(<WorkspaceSelectionPage />);

    expect(await screen.findByText(/Internal Server Error/)).toBeInTheDocument();
    expect(screen.queryByText('Choose a workspace to continue')).not.toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('[0] shows an explicit empty-state message rather than a blank picker', async () => {
    nsState.namespaces = [];

    render(<WorkspaceSelectionPage />);

    expect(await screen.findByText(/no workspaces are associated/i)).toBeInTheDocument();
    expect(screen.queryByText('Choose a workspace to continue')).not.toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
  });
});
