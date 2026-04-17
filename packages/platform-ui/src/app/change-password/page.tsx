'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { updatePassword } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { useAuth } from '@/contexts/auth-context';

export default function ChangePasswordPage() {
  const { firebaseUser, loading, mustChangePassword, clearMustChangePassword } = useAuth();
  const router = useRouter();

  const [newPassword, setNewPassword] = React.useState('');
  const [confirmPassword, setConfirmPassword] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  React.useEffect(() => {
    if (loading) return;
    if (!firebaseUser) {
      router.replace('/login');
      return;
    }
    // If they don't need to change password, send them in normally
    if (!mustChangePassword) {
      router.replace('/workspace-selection');
    }
  }, [loading, firebaseUser, mustChangePassword, router]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setPending(true);
    try {
      const currentUser = auth.currentUser;
      if (currentUser === null) throw new Error('Not signed in.');
      await updatePassword(currentUser, newPassword);
      await clearMustChangePassword();
      router.replace('/workspace-selection');
    } catch (err: unknown) {
      if (err instanceof Error) {
        const code = (err as { code?: string }).code ?? '';
        if (code === 'auth/requires-recent-login') {
          setError('Session expired. Please sign out and sign in again to change your password.');
        } else if (code === 'auth/weak-password') {
          setError('Password is too weak. Use at least 8 characters with a mix of letters and numbers.');
        } else {
          setError(err.message);
        }
      } else {
        setError('Failed to update password.');
      }
    } finally {
      setPending(false);
    }
  }

  if (loading || !firebaseUser || !mustChangePassword) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-sm text-muted-foreground animate-pulse">Loading…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-headline font-semibold tracking-tight">Set your password</h1>
          <p className="text-sm text-muted-foreground">
            You signed in with a temporary password. Choose a permanent password to continue.
          </p>
        </div>

        {error !== null && (
          <p className="text-sm text-destructive text-center" role="alert">{error}</p>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="newPassword" className="text-sm font-medium">New password</label>
            <input
              id="newPassword"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="At least 8 characters"
              required
              disabled={pending}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="confirmPassword" className="text-sm font-medium">Confirm password</label>
            <input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Repeat your password"
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
            {pending ? 'Saving…' : 'Set password and continue'}
          </button>
        </form>
      </div>
    </div>
  );
}
