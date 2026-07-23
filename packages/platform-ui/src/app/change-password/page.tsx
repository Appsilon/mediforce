'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { mediforce } from '@/lib/mediforce';
import { useAuth } from '@/contexts/auth-context';
import { useUserMe } from '@/hooks/use-user-me';

export default function ChangePasswordPage() {
  const { user, loading, mustChangePassword, clearMustChangePassword } = useAuth();
  const router = useRouter();
  // `hasPassword` decides whether this is a replacement (re-authentication
  // required) or a first-time set. Fail closed: until `me` resolves we assume
  // a password exists, so the field is asked for rather than silently skipped.
  const userMe = useUserMe({ enabled: user !== null });
  const hasPassword = userMe.data?.user.hasPassword !== false;

  const [currentPassword, setCurrentPassword] = React.useState('');
  const [newPassword, setNewPassword] = React.useState('');
  const [confirmPassword, setConfirmPassword] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  React.useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace('/login');
      return;
    }
    // If they don't need to change password, send them in normally
    if (!mustChangePassword) {
      router.replace('/workspace-selection');
    }
  }, [loading, user, mustChangePassword, router]);

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

    if (hasPassword && currentPassword === '') {
      setError('Enter your current password.');
      return;
    }

    setPending(true);
    try {
      // Set the bcrypt password hash server-side (ADR-0002 §4), then clear the
      // forced-change flag. The NextAuth session cookie rides both calls — the
      // handler revokes the user's OTHER sessions only, so this one survives.
      await mediforce.users.setPassword({
        newPassword,
        ...(hasPassword ? { currentPassword } : {}),
      });
      await clearMustChangePassword();
      router.replace('/workspace-selection');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update password.');
    } finally {
      setPending(false);
    }
  }

  if (loading || !user || !mustChangePassword) {
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
            Choose a password to continue.
          </p>
        </div>

        {error !== null && (
          <p className="text-sm text-destructive text-center" role="alert">{error}</p>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {hasPassword && (
            <div className="space-y-1.5">
              <label htmlFor="currentPassword" className="text-sm font-medium">Current password</label>
              <input
                id="currentPassword"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Your current password"
                autoComplete="current-password"
                required
                disabled={pending}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
              />
            </div>
          )}
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
