import type { DefaultSession } from 'next-auth';

/**
 * Module augmentation for the Mediforce session shape (ADR-0002 PR2).
 *
 * `id` is the user's uid (the migrated Firebase uid, or a fresh uuid for
 * post-cutover users). `roles` are the global process-domain roles read from
 * `user_roles` in the `session` callback — the browser's `useViewerIdentity`
 * consumes them in place of the old Firebase custom claim.
 */
declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      roles: string[];
    } & DefaultSession['user'];
  }
}
