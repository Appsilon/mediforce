'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/auth-context';
import { useAllUserNamespaces } from '@/hooks/use-all-user-namespaces';

export default function RedirectPage() {
  const router = useRouter();
  const { firebaseUser } = useAuth();
  const { namespaces, loading } = useAllUserNamespaces(firebaseUser?.uid);

  React.useEffect(() => {
    if (loading) return;

    // Try localStorage for last-used namespace
    const lastNamespace = typeof window !== 'undefined'
      ? localStorage.getItem('lastNamespace')
      : null;

    if (lastNamespace !== null && lastNamespace !== '' && lastNamespace !== 'redirect') {
      router.replace(`/${lastNamespace}`);
      return;
    }

    // Fall back to personal namespace
    const personalNamespace = namespaces.find((ns) => ns.type === 'personal');
    if (personalNamespace !== undefined) {
      router.replace(`/${personalNamespace.handle}`);
      return;
    }

    // Fall back to first available namespace
    if (namespaces.length > 0) {
      router.replace(`/${namespaces[0].handle}`);
      return;
    }

    // No namespaces yet — stay on loading state (profile setup likely needed)
  }, [loading, namespaces, router]);

  return (
    <div className="flex h-screen items-center justify-center">
      <div className="text-sm text-muted-foreground animate-pulse">Redirecting...</div>
    </div>
  );
}
