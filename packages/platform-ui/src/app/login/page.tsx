'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth, CredentialsSignInError } from '@/contexts/auth-context';

/**
 * `useSearchParams` (below, for the `?error=` bounce-back) opts the whole
 * subtree into client-side rendering, which fails the production build unless
 * it sits under a Suspense boundary.
 */
export default function LoginPage() {
  return (
    <React.Suspense fallback={null}>
      <LoginForm />
    </React.Suspense>
  );
}

function LoginForm() {
  const { signInWithGoogle, signInWithEmail, signInWithMagicLink, user, loading, mustChangePassword, passwordAuthEnabled, googleAuthEnabled, magicLinkEnabled } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const [magicLinkOpen, setMagicLinkOpen] = React.useState(false);
  const [magicLinkEmail, setMagicLinkEmail] = React.useState('');
  const [magicLinkSent, setMagicLinkSent] = React.useState(false);
  const [resendOpen, setResendOpen] = React.useState(false);
  const [resendEmail, setResendEmail] = React.useState('');
  const [resendSent, setResendSent] = React.useState(false);

  // Surface a NextAuth OAuth error bounced back as `?error=` (e.g. the sign-in
  // callback rejected an out-of-allowlist email — ADR-0002 §4a).
  React.useEffect(() => {
    const code = searchParams.get('error');
    if (code !== null) setError(friendlyOAuthError(code));
  }, [searchParams]);

  React.useEffect(() => {
    if (!loading && user) {
      router.replace(mustChangePassword ? '/change-password' : '/workspace-selection');
    }
  }, [loading, user, mustChangePassword, router]);

  function friendlyOAuthError(code: string): string {
    switch (code) {
      case 'AccessDenied':
        return 'This account is not permitted to sign in. Contact your administrator.';
      case 'Configuration':
        return 'Sign-in is misconfigured on the server. Contact your administrator.';
      case 'Verification':
        // Auth.js routes an expired / already-used magic link here.
        return 'This sign-in link is no longer valid — it may have been used or expired. Request a new one.';
      default:
        return 'Sign in failed. Please try again.';
    }
  }

  async function handleGoogleSignIn() {
    setError(null);
    setPending(true);
    try {
      // Full-page redirect through Google; on return the session cookie is set
      // and the redirect effect above routes onward.
      await signInWithGoogle();
    } catch {
      setError('Sign in failed. Please try again.');
      setPending(false);
    }
  }

  async function handleEmailSignIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      // Where to go next is the redirect effect's job — it knows about
      // mustChangePassword, which this path would otherwise skip.
      await signInWithEmail(email.trim(), password);
    } catch (err: unknown) {
      setError(err instanceof CredentialsSignInError ? 'Incorrect email or password.' : 'Sign in failed.');
    } finally {
      setPending(false);
    }
  }

  async function handleMagicLinkSignIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      await signInWithMagicLink(magicLinkEmail.trim());
      // Resolves in place (redirect: false) so we show our own confirmation
      // rather than Auth.js's default verify-request page. The message is
      // identical whether or not an email was actually sent (anti-enumeration —
      // the sender gates on account existence).
      setMagicLinkSent(true);
    } catch {
      setError('Sign in failed. Please try again.');
    } finally {
      setPending(false);
    }
  }

  async function handleResendSetupLink(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      await fetch('/api/auth/resend-setup-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: resendEmail.trim() }),
      });
      // The route always answers with the same generic 200 (anti-enumeration),
      // so the confirmation is identical regardless of whether a link was sent.
      setResendSent(true);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setPending(false);
    }
  }

  // Some email-based method exists whenever password or magic-link login is on;
  // a deployment with no email at all can't deliver a setup link, so hide it.
  const emailBasedMethodEnabled = passwordAuthEnabled === true || magicLinkEnabled === true;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-headline font-semibold tracking-tight">Mediforce</h1>
          <p className="text-sm text-muted-foreground">Sign in to continue</p>
        </div>

        {error !== null && (
          <p className="text-sm text-destructive text-center" role="alert">{error}</p>
        )}

        <div className="space-y-4">
          {googleAuthEnabled === true && (
            <button
              onClick={handleGoogleSignIn}
              disabled={pending}
              className="w-full flex items-center justify-center gap-3 rounded-md border border-input bg-background px-4 py-2.5 text-sm font-medium hover:bg-accent hover:text-accent-foreground disabled:opacity-50 transition-colors"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              {pending ? 'Signing in…' : 'Sign in with Google'}
            </button>
          )}

          {googleAuthEnabled === true && passwordAuthEnabled === true && (
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-border" />
              <span className="text-xs text-muted-foreground">or</span>
              <div className="flex-1 h-px bg-border" />
            </div>
          )}

          {passwordAuthEnabled === true && (
            <form onSubmit={handleEmailSignIn} className="space-y-3">
              <div className="space-y-1.5">
                <label htmlFor="email" className="text-sm font-medium">Email</label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  disabled={pending}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="password" className="text-sm font-medium">Password</label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  disabled={pending}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                />
              </div>
              <button
                type="submit"
                disabled={pending}
                className="w-full rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {pending ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
          )}

          {magicLinkEnabled === true && (
            <div className="space-y-3">
              {magicLinkSent ? (
                <p className="text-sm text-muted-foreground text-center" role="status">
                  Check your email for a sign-in link.
                </p>
              ) : magicLinkOpen ? (
                <form onSubmit={handleMagicLinkSignIn} className="space-y-3">
                  <div className="space-y-1.5">
                    <label htmlFor="magic-link-email" className="text-sm font-medium">Email</label>
                    <input
                      id="magic-link-email"
                      type="email"
                      value={magicLinkEmail}
                      onChange={(e) => setMagicLinkEmail(e.target.value)}
                      placeholder="you@example.com"
                      required
                      disabled={pending}
                      className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={pending}
                    className="w-full rounded-md border border-input bg-background px-4 py-2.5 text-sm font-medium hover:bg-accent hover:text-accent-foreground disabled:opacity-50 transition-colors"
                  >
                    {pending ? 'Sending…' : 'Send sign-in link'}
                  </button>
                </form>
              ) : (
                <button
                  type="button"
                  onClick={() => setMagicLinkOpen(true)}
                  className="w-full text-center text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  Email me a sign-in link
                </button>
              )}
            </div>
          )}

          {emailBasedMethodEnabled && (
            <div className="space-y-3 pt-2">
              {resendSent ? (
                <p className="text-sm text-muted-foreground text-center" role="status">
                  If your account is awaiting setup, we&apos;ve emailed you a link.
                </p>
              ) : resendOpen ? (
                <form onSubmit={handleResendSetupLink} className="space-y-3">
                  <div className="space-y-1.5">
                    <label htmlFor="resend-setup-email" className="text-sm font-medium">Email</label>
                    <input
                      id="resend-setup-email"
                      type="email"
                      value={resendEmail}
                      onChange={(e) => setResendEmail(e.target.value)}
                      placeholder="you@example.com"
                      required
                      disabled={pending}
                      className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={pending}
                    className="w-full rounded-md border border-input bg-background px-4 py-2.5 text-sm font-medium hover:bg-accent hover:text-accent-foreground disabled:opacity-50 transition-colors"
                  >
                    {pending ? 'Sending…' : 'Resend setup link'}
                  </button>
                </form>
              ) : (
                <button
                  type="button"
                  onClick={() => setResendOpen(true)}
                  className="w-full text-center text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Didn&apos;t get your setup link? Resend it
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
