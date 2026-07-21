'use client';

import { useAuth } from '@/contexts/auth-context';

/**
 * The signed-in user's uid plus their first process-domain role (reviewer, PI,
 * …). Roles come from the NextAuth session (`session.user.roles`, populated
 * from the global `user_roles` table in the session callback — ADR-0002 §5),
 * replacing the old Firebase custom claim. `role` is `null` when the user has
 * none (e.g. workspace admins browsing without a process role).
 */
export function useViewerIdentity(): { uid: string | null; role: string | null } {
  const { user } = useAuth();
  const roles = user?.roles ?? [];
  return { uid: user?.id ?? null, role: roles.length > 0 ? String(roles[0]) : null };
}
