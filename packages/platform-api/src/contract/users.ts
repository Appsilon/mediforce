import { z } from 'zod';
import {
  HandleSchema,
  NamespaceMemberSchema,
  NamespaceTypeSchema,
} from '@mediforce/platform-core';

export const GetMeInputSchema = z
  .object({
    /**
     * Server-to-server escape hatch: an apiKey caller has no user identity of
     * its own, so it must name the user whose `me` view it wants. User callers
     * always derive the uid from the verified session; if `uid` is set for a
     * user caller it MUST match `caller.uid` or the handler 403s.
     */
    uid: z.string().min(1).optional(),
  })
  .strict();

export const MeNamespaceSchema = z.object({
  handle: HandleSchema,
  type: NamespaceTypeSchema,
  displayName: z.string(),
  role: z.enum(['owner', 'admin', 'member']),
  avatarUrl: z.string().url().optional(),
  icon: z.string().optional(),
});

export const GetMeOutputSchema = z.object({
  user: z.object({
    uid: z.string(),
    email: z.string().email().nullable(),
    displayName: z.string().nullable(),
    /**
     * `true` when the user must change their password before continuing.
     * Defaults to `false` when no `users/{uid}` profile doc exists yet — see
     * `UserProfileRepository.getProfile`. Cleared via
     * `POST /api/users/me/clear-must-change-password`.
     */
    mustChangePassword: z.boolean(),
    /**
     * `true` when the user already has a password credential. The
     * change-password form uses it to decide whether to ask for the current
     * password — `false` means first-time set (seeded invite, OAuth-only
     * account), which `POST /api/users/set-password` accepts without one.
     */
    hasPassword: z.boolean(),
  }),
  namespaces: z.array(MeNamespaceSchema),
});

export type GetMeInput = z.infer<typeof GetMeInputSchema>;
export type GetMeOutput = z.infer<typeof GetMeOutputSchema>;
export type MeNamespace = z.infer<typeof MeNamespaceSchema>;

const NamespaceQuery = z.object({ namespace: z.string().min(1) });

export const ListNamespaceMembersInputSchema = NamespaceQuery;

export const NamespaceMemberWithAuthSchema = NamespaceMemberSchema.extend({
  /**
   * Resolved display name for the member: the workspace-scoped `displayName`
   * on the member doc when set, otherwise the `auth_users` profile name
   * looked up via `userDirectory.getUserMetadata`, otherwise `null`. UI
   * chains `?? member.uid` to render a stable fallback.
   */
  displayName: z.string().nullable(),
  email: z.string().nullable(),
  lastSignInTime: z.string().nullable(),
});

export const ListNamespaceMembersOutputSchema = z.object({
  members: z.array(NamespaceMemberWithAuthSchema),
});

export type ListNamespaceMembersInput = z.infer<typeof ListNamespaceMembersInputSchema>;
export type ListNamespaceMembersOutput = z.infer<typeof ListNamespaceMembersOutputSchema>;
export type NamespaceMemberWithAuth = z.infer<typeof NamespaceMemberWithAuthSchema>;

export const InviteUserInputSchema = z.object({
  email: z.string().email(),
  displayName: z.string().min(1).optional(),
  namespaceHandle: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/, 'namespaceHandle must be lowercase alphanumeric with hyphens only'),
  role: z.enum(['member', 'admin']).optional().default('member'),
  inviterName: z.string().min(1).optional(),
});

export const InviteUserOutputSchema = z.object({
  uid: z.string(),
  email: z.string(),
  emailSent: z.boolean(),
  isExisting: z.boolean(),
});

export type InviteUserInput = z.infer<typeof InviteUserInputSchema>;
export type InviteUserOutput = z.infer<typeof InviteUserOutputSchema>;

export const ResendInviteInputSchema = z.object({
  uid: z.string().min(1),
  namespaceHandle: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/, 'namespaceHandle must be lowercase alphanumeric with hyphens only'),
});

export const ResendInviteOutputSchema = z.object({
  uid: z.string(),
  email: z.string(),
  emailSent: z.boolean(),
});

export type ResendInviteInput = z.infer<typeof ResendInviteInputSchema>;
export type ResendInviteOutput = z.infer<typeof ResendInviteOutputSchema>;

export const ClearMustChangePasswordInputSchema = z
  .object({
    /**
     * Server-to-server escape hatch: when an apiKey caller invokes this
     * endpoint (e.g. CLI `mediforce users clear-must-change-password`), it
     * must name the target uid since the system actor has no implicit
     * identity. User callers always derive the uid from the verified token;
     * if `uid` is set for a user caller it MUST match `caller.uid` or the
     * handler 403s.
     */
    uid: z.string().min(1).optional(),
  })
  .strict();

export const ClearMustChangePasswordOutputSchema = z.object({
  user: z.object({
    uid: z.string(),
    mustChangePassword: z.literal(false),
  }),
});

export type ClearMustChangePasswordInput = z.infer<typeof ClearMustChangePasswordInputSchema>;
export type ClearMustChangePasswordOutput = z.infer<typeof ClearMustChangePasswordOutputSchema>;

export const SetPasswordInputSchema = z
  .object({
    newPassword: z.string().min(8, 'Password must be at least 8 characters.'),
    /**
     * Re-authentication for a user caller who already has a password: the
     * handler bcrypt-compares this against the stored hash and 403s on a
     * mismatch, so a stolen session cookie cannot be converted into a
     * permanent password credential.
     *
     * Omitted in exactly two cases, both asymmetric on purpose:
     *  - the target has no `password_hash` yet (invite / first-time set /
     *    `mustChangePassword` on a seeded account) — there is nothing to
     *    re-authenticate against;
     *  - the caller is an apiKey (admin / system path) — it has already
     *    proven operator-level trust at the auth boundary and by definition
     *    does not know the user's password.
     */
    currentPassword: z.string().min(1).optional(),
    /**
     * Server-to-server escape hatch, same rule as
     * `ClearMustChangePasswordInputSchema`: an apiKey caller must name the
     * target uid, a user caller must either omit it or pass their own.
     */
    uid: z.string().min(1).optional(),
  })
  .strict();

export const SetPasswordOutputSchema = z.object({
  user: z.object({ uid: z.string() }),
});

export type SetPasswordInput = z.infer<typeof SetPasswordInputSchema>;
export type SetPasswordOutput = z.infer<typeof SetPasswordOutputSchema>;
