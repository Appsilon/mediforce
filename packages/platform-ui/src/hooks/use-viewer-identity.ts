'use client';

import * as React from 'react';
import { useAuth } from '@/contexts/auth-context';

/**
 * The signed-in user's uid plus their process-domain role (reviewer, PI, …)
 * from the Firebase custom claims. `role` is `null` while the claim loads or
 * when the user has none (workspace admins browsing without a role).
 */
export function useViewerIdentity(): { uid: string | null; role: string | null } {
  const { firebaseUser } = useAuth();
  const [role, setRole] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!firebaseUser) return;
    firebaseUser.getIdTokenResult().then((result) => {
      const roles = result.claims['roles'];
      if (Array.isArray(roles) && roles.length > 0) {
        setRole(String(roles[0]));
      }
    });
  }, [firebaseUser]);

  return { uid: firebaseUser?.uid ?? null, role };
}
