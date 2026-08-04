import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

/**
 * The "Expected a setup link? Resend" affordance is the only self-service
 * recovery for an invitee whose one-time activation link expired. It used to be
 * gated on the password / magic-link sign-in display flags, which hid it on a
 * Google/OIDC-only deployment — exactly the estate where the invite arrives as a
 * one-time link and the expired-link dead end bites (#1109). Its real
 * precondition is whether the deployment can send mail at all.
 */
interface AuthState {
  user: null;
  loading: boolean;
  mustChangePassword: boolean;
  passwordAuthEnabled: boolean | null;
  googleAuthEnabled: boolean | null;
  magicLinkEnabled: boolean | null;
  emailDeliveryEnabled: boolean | null;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: () => Promise<void>;
  signInWithMagicLink: () => Promise<void>;
}

let authState: AuthState;

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/contexts/auth-context', () => ({
  useAuth: () => authState,
  CredentialsSignInError: class extends Error {},
}));

import LoginPage from '../page';

const RESEND_LABEL = /Expected a setup link\? Resend/i;

beforeEach(() => {
  authState = {
    user: null,
    loading: false,
    mustChangePassword: false,
    passwordAuthEnabled: false,
    googleAuthEnabled: true,
    magicLinkEnabled: false,
    emailDeliveryEnabled: true,
    signInWithGoogle: vi.fn(),
    signInWithEmail: vi.fn(),
    signInWithMagicLink: vi.fn(),
  };
});

describe('LoginPage — setup-link recovery', () => {
  it('offers the resend recovery on a Google-only deployment that can send email', () => {
    render(<LoginPage />);

    expect(screen.getByRole('button', { name: /Sign in with Google/i })).toBeInTheDocument();
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: RESEND_LABEL })).toBeInTheDocument();
  });

  it('hides the resend recovery when the deployment cannot send email', () => {
    authState.emailDeliveryEnabled = false;

    render(<LoginPage />);

    expect(screen.queryByRole('button', { name: RESEND_LABEL })).not.toBeInTheDocument();
  });

  it('keeps offering it on a password deployment', () => {
    authState.passwordAuthEnabled = true;
    authState.googleAuthEnabled = false;

    render(<LoginPage />);

    expect(screen.getByRole('button', { name: RESEND_LABEL })).toBeInTheDocument();
  });

  it('hides it while the provider flags are still loading', () => {
    authState.emailDeliveryEnabled = null;

    render(<LoginPage />);

    expect(screen.queryByRole('button', { name: RESEND_LABEL })).not.toBeInTheDocument();
  });
});
