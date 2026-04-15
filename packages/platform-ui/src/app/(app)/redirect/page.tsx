'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Building2, User } from 'lucide-react';
import { useAuth } from '@/contexts/auth-context';
import { useAllUserNamespaces } from '@/hooks/use-all-user-namespaces';
import type { Namespace } from '@mediforce/platform-core';

const SESSION_KEY = 'lastNamespace';

function OrgCard({
  namespace,
  onSelect,
}: {
  namespace: Namespace;
  onSelect: (handle: string) => void;
}) {
  const isPersonal = namespace.type === 'personal';
  const label = isPersonal ? 'My workspace' : namespace.displayName;

  return (
    <button
      type="button"
      onClick={() => onSelect(namespace.handle)}
      className="group flex flex-col items-center gap-3 p-2 rounded-lg transition-transform duration-150 hover:scale-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="relative h-24 w-24 sm:h-28 sm:w-28 rounded-lg overflow-hidden border-2 border-transparent group-hover:border-primary transition-colors duration-150">
        {namespace.avatarUrl !== undefined ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={namespace.avatarUrl}
            alt={label}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="h-full w-full flex items-center justify-center bg-muted">
            {isPersonal ? (
              <User className="h-10 w-10 text-muted-foreground" />
            ) : (
              <Building2 className="h-10 w-10 text-muted-foreground" />
            )}
          </div>
        )}
      </div>
      <span className="text-sm font-medium text-center leading-tight max-w-[7rem] truncate">
        {label}
      </span>
    </button>
  );
}

export default function RedirectPage() {
  const router = useRouter();
  const { firebaseUser } = useAuth();
  const { namespaces, loading } = useAllUserNamespaces(firebaseUser?.uid);
  const [showPicker, setShowPicker] = React.useState(false);

  React.useEffect(() => {
    if (loading) return;

    // Single namespace — skip the picker entirely
    if (namespaces.length <= 1) {
      const target = namespaces[0]?.handle;
      if (target !== undefined) {
        router.replace(`/${target}`);
      }
      return;
    }

    // Multiple namespaces: check if user already chose one this session
    const sessionHandle =
      typeof window !== 'undefined' ? sessionStorage.getItem(SESSION_KEY) : null;

    if (
      sessionHandle !== null &&
      sessionHandle !== '' &&
      namespaces.some((ns) => ns.handle === sessionHandle)
    ) {
      router.replace(`/${sessionHandle}`);
      return;
    }

    // Show the picker
    setShowPicker(true);
  }, [loading, namespaces, router]);

  function handleSelect(handle: string) {
    if (typeof window !== 'undefined') {
      sessionStorage.setItem(SESSION_KEY, handle);
    }
    router.replace(`/${handle}`);
  }

  if (loading || !showPicker) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-sm text-muted-foreground animate-pulse">Loading…</div>
      </div>
    );
  }

  const displayName = firebaseUser?.displayName ?? firebaseUser?.email ?? 'back';

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background px-6 py-12">
      <div className="mb-10 text-center space-y-1">
        <h1 className="text-2xl font-headline font-semibold tracking-tight">
          Welcome back{firebaseUser?.displayName !== null && firebaseUser?.displayName !== undefined ? `, ${displayName}` : ''}
        </h1>
        <p className="text-sm text-muted-foreground">Choose an organization to continue</p>
      </div>

      <div className="flex flex-wrap justify-center gap-6 max-w-2xl">
        {namespaces.map((ns) => (
          <OrgCard key={ns.handle} namespace={ns} onSelect={handleSelect} />
        ))}
      </div>
    </div>
  );
}
