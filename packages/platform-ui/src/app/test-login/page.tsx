'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/auth-context';

export default function TestLoginPage() {
  const { signInWithEmail, firebaseUser, loading } = useAuth();
  const router = useRouter();
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  const emulatorsEnabled = process.env.NEXT_PUBLIC_USE_EMULATORS === 'true';

  React.useEffect(() => {
    if (!loading && firebaseUser) {
      router.replace('/workflows');
    }
  }, [loading, firebaseUser, router]);

  if (!emulatorsEnabled) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <p className="text-sm text-muted-foreground">
          Test login is only available when Firebase Emulators are running.
        </p>
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const form = new FormData(e.currentTarget);
    const email = form.get('email') as string;
    const password = form.get('password') as string;
    try {
      await signInWithEmail(email, password);
      router.replace('/workflows');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Sign in failed');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-headline font-semibold tracking-tight">Mediforce</h1>
          <p className="text-sm text-muted-foreground">Test Login (Emulator)</p>
        </div>
        {error && (
          <p className="text-sm text-destructive text-center" role="alert">{error}</p>
        )}
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            name="email"
            type="email"
            placeholder="Email"
            defaultValue="test@mediforce.dev"
            required
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
          <input
            name="password"
            type="password"
            placeholder="Password"
            defaultValue="test123456"
            required
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {pending ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
