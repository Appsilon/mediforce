'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/auth-context';

export default function LoginPage() {
  const { signInWithGoogle, signInWithEmail, sendPasswordReset, firebaseUser, loading, emailAuthEnabled } = useAuth();
  const router = useRouter();

  const [mode, setMode] = React.useState<'signin' | 'forgot'>('signin');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [resetEmail, setResetEmail] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [info, setInfo] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  React.useEffect(() => {
    if (!loading && firebaseUser) {
      router.replace('/workspace-selection');
    }
  }, [loading, firebaseUser, router]);

  function friendlyAuthError(err: unknown): string {
    const code = (err !== null && typeof err === 'object' && 'code' in err)
      ? String((err as { code: unknown }).code)
      : '';
    switch (code) {
      case 'auth/invalid-credential':
      case 'auth/wrong-password':
        return 'Incorrect email or password.';
      case 'auth/user-not-found':
        return 'No account found with this email.';
      case 'auth/user-disabled':
        return 'This account has been disabled. Contact your administrator.';
      case 'auth/too-many-requests':
        return 'Too many failed attempts. Please wait a moment and try again.';
      case 'auth/network-request-failed':
        return 'Connection error. Check your internet connection and try again.';
      case 'auth/invalid-email':
        return 'Invalid email address.';
      case 'auth/popup-closed-by-user':
        return 'Sign-in window was closed. Please try again.';
      default:
        return err instanceof Error
          ? err.message.replace('Firebase: ', '').replace(/\(auth\/.*\)\.?/, '').trim()
          : 'Sign in failed.';
    }
  }

  async function handleGoogleSignIn() {
    setError(null);
    setPending(true);
    try {
      await signInWithGoogle();
      router.replace('/workspace-selection');
    } catch (err: unknown) {
      setError(friendlyAuthError(err));
    } finally {
      setPending(false);
    }
  }

  async function handleEmailSignIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      await signInWithEmail(email.trim(), password);
      router.replace('/workspace-selection');
    } catch (err: unknown) {
      setError(friendlyAuthError(err));
    } finally {
      setPending(false);
    }
  }

  async function handleForgotPassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setInfo(null);
    setPending(true);
    try {
      await sendPasswordReset(resetEmail.trim());
      setInfo('Password reset email sent. Check your inbox.');
      setResetEmail('');
    } catch (err: unknown) {
      setError(friendlyAuthError(err));
    } finally {
      setPending(false);
    }
  }

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
        {info !== null && (
          <p className="text-sm text-green-600 dark:text-green-400 text-center" role="status">{info}</p>
        )}

        {mode === 'signin' ? (
          <div className="space-y-4">
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

            {emailAuthEnabled === true && (
              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-border" />
                <span className="text-xs text-muted-foreground">or</span>
                <div className="flex-1 h-px bg-border" />
              </div>
            )}

            {emailAuthEnabled === true && (
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

            {emailAuthEnabled === true && (
            <p className="text-center">
              <button
                type="button"
                onClick={() => { setMode('forgot'); setError(null); setInfo(null); }}
                className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
              >
                Forgot password?
              </button>
            </p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <form onSubmit={handleForgotPassword} className="space-y-3">
              <p className="text-sm text-muted-foreground">Enter your email to receive a password reset link.</p>
              <div className="space-y-1.5">
                <label htmlFor="resetEmail" className="text-sm font-medium">Email</label>
                <input
                  id="resetEmail"
                  type="email"
                  value={resetEmail}
                  onChange={(e) => setResetEmail(e.target.value)}
                  placeholder="you@example.com"
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
                {pending ? 'Sending…' : 'Send reset link'}
              </button>
            </form>
            <p className="text-center">
              <button
                type="button"
                onClick={() => { setMode('signin'); setError(null); setInfo(null); }}
                className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
              >
                Back to sign in
              </button>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
