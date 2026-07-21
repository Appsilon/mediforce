'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/auth-context';
import { ApiError, mediforce } from '@/lib/mediforce';
import { queryKeys } from '@/lib/query-keys';
import { snapshotCache } from '@/lib/optimistic';
import { HANDLE_MAX_LENGTH, HANDLE_REGEX } from '@mediforce/platform-core';
import type {
  CreateNamespaceInput,
  CreateNamespaceOutput,
  GetMeOutput,
  MeNamespace,
} from '@mediforce/platform-api/contract';

type FormErrors = {
  handle?: string;
  displayName?: string;
  bio?: string;
};

export default function NewWorkspacePage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { user, loading: authLoading } = useAuth();

  const [handle, setHandle] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  // List-affecting optimistic update per ADR-0006 §6: prepend an optimistic
  // namespace entry to the cached `['users','me']` so the sidebar shows the
  // new workspace immediately. On success the server-echoed entity replaces
  // the placeholder; on failure the snapshot rolls back.
  const create = useMutation<
    CreateNamespaceOutput,
    Error,
    CreateNamespaceInput,
    { restore: () => void }
  >({
    mutationFn: (input) => mediforce.namespaces.create(input),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: queryKeys.users.me() });
      const { restore } = snapshotCache(qc, [queryKeys.users.me()]);

      qc.setQueryData<GetMeOutput | undefined>(queryKeys.users.me(), (prev) => {
        if (prev === undefined) return prev;
        const placeholder: MeNamespace = {
          handle: input.handle,
          type: 'organization',
          displayName: input.displayName,
          role: 'owner',
        };
        return { ...prev, namespaces: [placeholder, ...prev.namespaces] };
      });

      return { restore };
    },
    onError: (_err, _input, ctx) => {
      ctx?.restore();
    },
    onSuccess: (data) => {
      qc.setQueryData<GetMeOutput | undefined>(queryKeys.users.me(), (prev) => {
        if (prev === undefined) return prev;
        const echo: MeNamespace = {
          handle: data.namespace.handle,
          type: data.namespace.type,
          displayName: data.namespace.displayName,
          role: 'owner',
          ...(data.namespace.avatarUrl !== undefined ? { avatarUrl: data.namespace.avatarUrl } : {}),
          ...(data.namespace.icon !== undefined ? { icon: data.namespace.icon } : {}),
        };
        const others = prev.namespaces.filter((n) => n.handle !== data.namespace.handle);
        return { ...prev, namespaces: [echo, ...others] };
      });
      router.push(`/${data.namespace.handle}`);
    },
  });

  if (authLoading) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="text-sm text-muted-foreground animate-pulse">Loading…</div>
      </div>
    );
  }

  if (user === null) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
        <p className="text-sm text-muted-foreground">Sign in to create a workspace.</p>
      </div>
    );
  }

  function validate(): FormErrors {
    const nextErrors: FormErrors = {};

    if (handle.trim() === '') {
      nextErrors.handle = 'Handle is required.';
    } else if (!HANDLE_REGEX.test(handle) || handle.length > HANDLE_MAX_LENGTH) {
      nextErrors.handle =
        `Handle must be lowercase alphanumeric with internal hyphens (max ${HANDLE_MAX_LENGTH} characters).`;
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

    setErrors({});

    try {
      await create.mutateAsync({
        handle,
        displayName,
        ...(bio.trim() !== '' ? { bio: bio.trim() } : {}),
      });
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 409) {
        setErrors({ handle: 'This handle is already taken.' });
        return;
      }
      setSubmitError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    }
  }

  const submitting = create.isPending;

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
        <h1 className="text-xl font-headline font-semibold">New Workspace</h1>
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
            maxLength={HANDLE_MAX_LENGTH}
            placeholder="my-workspace"
            className="rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            disabled={submitting}
          />
          {errors.handle !== undefined ? (
            <p className="text-xs text-destructive">{errors.handle}</p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Your workspace will be at @{handle !== '' ? handle : 'handle'}
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
            placeholder="My Workspace"
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
            placeholder="A short description of your workspace"
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
            {submitting ? 'Creating…' : 'Create workspace'}
          </button>
        </div>
      </form>
    </div>
  );
}
