'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/auth-context';
import { useAllUserNamespaces } from '@/hooks/use-all-user-namespaces';

const SESSION_KEY = 'lastNamespace';
const ALWAYS_KEY = 'alwaysNamespace';

export default function RedirectPage() {
  const router = useRouter();
  const { firebaseUser } = useAuth();
  const { namespaces, loading } = useAllUserNamespaces(firebaseUser?.uid);

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

    // "Always use" localStorage preference
    const alwaysHandle = typeof window !== 'undefined' ? localStorage.getItem(ALWAYS_KEY) : null;
    if (
      alwaysHandle !== null &&
      alwaysHandle !== '' &&
      namespaces.some((ns) => ns.handle === alwaysHandle)
    ) {
      sessionStorage.setItem(SESSION_KEY, alwaysHandle);
      router.replace(`/${alwaysHandle}`);
      return;
    }

    // Session memory: resume last-used namespace in this browser tab session
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

    // Show the org picker
    router.replace('/workspace-selection');
  }, [loading, namespaces, router]);

  return (
    <div className="flex h-screen items-center justify-center">
      <div className="text-sm text-muted-foreground animate-pulse">Loading…</div>
    </div>
  );
}
