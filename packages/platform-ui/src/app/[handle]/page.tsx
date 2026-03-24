'use client';

import * as React from 'react';
import { useParams } from 'next/navigation';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useNamespace } from '@/hooks/use-namespace';
import type { Namespace } from '@mediforce/platform-core';

function useMemberCount(handle: string, enabled: boolean): number | null {
  const [count, setCount] = React.useState<number | null>(null);

  React.useEffect(() => {
    if (!enabled || !handle) return;

    const membersRef = collection(db, 'namespaces', handle, 'members');
    getDocs(membersRef)
      .then((snapshot) => {
        setCount(snapshot.size);
      })
      .catch(() => {
        setCount(null);
      });
  }, [handle, enabled]);

  return count;
}

function InitialsAvatar({ displayName }: { displayName: string }) {
  const initials = displayName
    .split(' ')
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

  return (
    <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/10 text-primary text-2xl font-semibold shrink-0">
      {initials}
    </div>
  );
}

function MemberCountBadge({ namespace }: { namespace: Namespace }) {
  const memberCount = useMemberCount(
    namespace.handle,
    namespace.type === 'organization',
  );

  if (namespace.type !== 'organization') return null;
  if (memberCount === null) return null;

  return (
    <p className="text-sm text-muted-foreground mt-2">
      {memberCount} {memberCount === 1 ? 'member' : 'members'}
    </p>
  );
}

export default function ProfilePage() {
  const params = useParams();
  const rawHandle = params.handle;
  const handle = Array.isArray(rawHandle) ? rawHandle[0] : rawHandle;

  const { namespace, loading, error } = useNamespace(handle ?? '');

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-sm text-muted-foreground animate-pulse">Loading…</div>
      </div>
    );
  }

  if (error !== null || namespace === null) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-background px-4">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
          <span className="text-2xl text-muted-foreground">?</span>
        </div>
        <div className="text-center">
          <h1 className="text-xl font-semibold">Profile not found</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {handle !== undefined && handle !== '' ? (
              <>No profile exists for <span className="font-mono">@{handle}</span>.</>
            ) : (
              'The requested profile does not exist.'
            )}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background px-4 py-12">
      <div className="mx-auto max-w-xl">
        <div className="flex items-start gap-5">
          {namespace.avatarUrl !== undefined && namespace.avatarUrl !== '' ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={namespace.avatarUrl}
              alt={namespace.displayName}
              className="h-20 w-20 rounded-full object-cover shrink-0"
            />
          ) : (
            <InitialsAvatar displayName={namespace.displayName} />
          )}

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-semibold">{namespace.displayName}</h1>
              <span
                className={[
                  'rounded-full px-2 py-0.5 text-[11px] font-medium',
                  namespace.type === 'organization'
                    ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                    : 'bg-muted text-muted-foreground',
                ].join(' ')}
              >
                {namespace.type === 'organization' ? 'Organization' : 'Personal'}
              </span>
            </div>

            <p className="text-sm text-muted-foreground mt-0.5">@{namespace.handle}</p>

            {namespace.bio !== undefined && namespace.bio !== '' && (
              <p className="text-sm text-foreground mt-3">{namespace.bio}</p>
            )}

            <MemberCountBadge namespace={namespace} />
          </div>
        </div>
      </div>
    </div>
  );
}
