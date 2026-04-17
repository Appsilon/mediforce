'use client';

import * as React from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { Building2, User } from 'lucide-react';
import { useAuth } from '@/contexts/auth-context';
import { useAllUserNamespaces } from '@/hooks/use-all-user-namespaces';
import type { Namespace } from '@mediforce/platform-core';

const ALWAYS_KEY = 'alwaysNamespace';

function OrgCard({
  namespace,
  alwaysHandle,
  onSelect,
  onAlwaysChange,
}: {
  namespace: Namespace;
  alwaysHandle: string | null;
  onSelect: (handle: string) => void;
  onAlwaysChange: (handle: string, checked: boolean) => void;
}) {
  const isPersonal = namespace.type === 'personal';
  const label = isPersonal ? 'My workspace' : namespace.displayName;
  const isAlways = alwaysHandle === namespace.handle;

  return (
    <div className="flex flex-col items-center gap-3">
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
        <span className="text-sm font-medium text-center leading-tight w-28 break-words whitespace-normal">
          {label}
        </span>
      </button>

      <label className="flex items-center gap-1.5 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={isAlways}
          onChange={(e) => onAlwaysChange(namespace.handle, e.target.checked)}
          className="h-3.5 w-3.5 rounded border-input accent-primary cursor-pointer"
        />
        <span className="text-xs text-muted-foreground">Always use this</span>
      </label>
    </div>
  );
}

export default function WorkspaceSelectionPage() {
  const router = useRouter();
  const { firebaseUser, loading: authLoading } = useAuth();
  const { namespaces, loading: nsLoading } = useAllUserNamespaces(firebaseUser?.uid);
  const [alwaysHandle, setAlwaysHandle] = React.useState<string | null>(null);
  const [ready, setReady] = React.useState(false);

  // Read localStorage once on mount (SSR-safe)
  React.useEffect(() => {
    setAlwaysHandle(localStorage.getItem(ALWAYS_KEY));
    setReady(true);
  }, []);

  React.useEffect(() => {
    if (authLoading || nsLoading || !ready) return;

    if (!firebaseUser) {
      router.replace('/login');
      return;
    }

    // Single namespace — no choice needed, go straight there
    if (namespaces.length <= 1) {
      const target = namespaces[0]?.handle;
      if (target !== undefined) {
        router.replace(`/${target}`);
      }
      return;
    }

    // Preferred workspace set — skip the picker
    const preferred = localStorage.getItem(ALWAYS_KEY);
    if (preferred !== null && preferred !== '' && namespaces.some((ns) => ns.handle === preferred)) {
      router.replace(`/${preferred}`);
    }
  }, [authLoading, nsLoading, ready, firebaseUser, namespaces, router]);

  function handleSelect(handle: string) {
    router.replace(`/${handle}`);
  }

  function handleAlwaysChange(handle: string, checked: boolean) {
    if (checked) {
      localStorage.setItem(ALWAYS_KEY, handle);
      setAlwaysHandle(handle);
    } else {
      localStorage.removeItem(ALWAYS_KEY);
      setAlwaysHandle(null);
    }
  }

  const loading = authLoading || nsLoading || !ready;

  if (loading || !firebaseUser) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-sm text-muted-foreground animate-pulse">Loading…</div>
      </div>
    );
  }

  const displayName = firebaseUser.displayName ?? firebaseUser.email ?? null;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background px-6 py-12">
      {/* Logo */}
      <div className="flex items-center gap-2 mb-10">
        <Image src="/logo.png" alt="Mediforce logo" width={32} height={32} className="shrink-0" />
        <span className="font-headline text-lg font-semibold text-primary">Mediforce</span>
      </div>

      <div className="mb-10 text-center space-y-1">
        <h1 className="text-2xl font-headline font-semibold tracking-tight">
          Welcome back{displayName !== null ? `, ${displayName}` : ''}
        </h1>
        <p className="text-sm text-muted-foreground">Choose a workspace to continue</p>
      </div>

      <div className="flex flex-wrap justify-center gap-8 max-w-2xl">
        {namespaces.map((ns) => (
          <OrgCard
            key={ns.handle}
            namespace={ns}
            alwaysHandle={alwaysHandle}
            onSelect={handleSelect}
            onAlwaysChange={handleAlwaysChange}
          />
        ))}
      </div>
    </div>
  );
}
