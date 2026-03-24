'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/auth-context';

const HANDLE_REGEX = /^[a-z0-9][a-z0-9-]{0,38}$/;

type FormErrors = {
  handle?: string;
  displayName?: string;
  bio?: string;
};

export default function NewOrgPage() {
  const router = useRouter();
  const { firebaseUser, loading: authLoading } = useAuth();

  const [handle, setHandle] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  if (authLoading) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="text-sm text-muted-foreground animate-pulse">Loading…</div>
      </div>
    );
  }

  if (firebaseUser === null) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
        <p className="text-sm text-muted-foreground">Sign in to create an organization.</p>
      </div>
    );
  }

  function validate(): FormErrors {
    const nextErrors: FormErrors = {};

    if (handle.trim() === '') {
      nextErrors.handle = 'Handle is required.';
    } else if (!HANDLE_REGEX.test(handle)) {
      nextErrors.handle =
        'Handle must start with a letter or number and contain only lowercase letters, numbers, or hyphens (max 39 characters).';
    }

    if (displayName.trim() === '') {
      nextErrors.displayName = 'Display name is required.';
    } else if (displayName.length > 100) {
      nextErrors.displayName = 'Display name must be 100 characters or fewer.';
    }

    if (bio.length > 280) {
      nextErrors.bio = 'Bio must be 280 characters or fewer.';
    }

    return nextErrors;
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitError(null);

    const nextErrors = validate();
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    if (firebaseUser === null) return;

    setErrors({});
    setSubmitting(true);

    try {
      const namespaceRef = doc(db, 'namespaces', handle);
      const existing = await getDoc(namespaceRef);

      if (existing.exists()) {
        setErrors({ handle: 'This handle is already taken.' });
        setSubmitting(false);
        return;
      }

      const now = new Date().toISOString();
      const currentUid = firebaseUser.uid;

      await setDoc(namespaceRef, {
        handle,
        displayName,
        ...(bio.trim() !== '' ? { bio: bio.trim() } : {}),
        type: 'organization',
        createdAt: now,
      });

      await setDoc(doc(db, 'namespaces', handle, 'members', currentUid), {
        uid: currentUid,
        role: 'owner',
        joinedAt: now,
      });

      router.push(`/${handle}`);
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-6 p-6 max-w-3xl">
      <div>
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Home
        </Link>
        <h1 className="text-xl font-headline font-semibold">New Organization</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Create a shared namespace for your team.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="handle" className="text-sm font-medium">
            Handle
          </label>
          <input
            id="handle"
            type="text"
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            maxLength={39}
            placeholder="my-org"
            className="rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            disabled={submitting}
          />
          {errors.handle !== undefined ? (
            <p className="text-xs text-destructive">{errors.handle}</p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Your org will be at @{handle !== '' ? handle : 'handle'}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="displayName" className="text-sm font-medium">
            Display name
          </label>
          <input
            id="displayName"
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={100}
            placeholder="My Organization"
            className="rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            disabled={submitting}
          />
          {errors.displayName !== undefined && (
            <p className="text-xs text-destructive">{errors.displayName}</p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="bio" className="text-sm font-medium">
            Bio{' '}
            <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <textarea
            id="bio"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            maxLength={280}
            rows={3}
            placeholder="A short description of your organization"
            className="rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 resize-none"
            disabled={submitting}
          />
          {errors.bio !== undefined && (
            <p className="text-xs text-destructive">{errors.bio}</p>
          )}
        </div>

        {submitError !== null && (
          <p className="text-sm text-destructive">{submitError}</p>
        )}

        <div>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {submitting ? 'Creating…' : 'Create organization'}
          </button>
        </div>
      </form>
    </div>
  );
}
