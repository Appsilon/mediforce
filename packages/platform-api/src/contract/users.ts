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
     * its own, so it must name the user whose `me` view it wants. Bearer-token
     * callers always derive the uid from the verified token; if `uid` is set
     * for a user caller it MUST match `caller.uid` or the handler 403s.
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
  }),
  namespaces: z.array(MeNamespaceSchema),
});

export type GetMeInput = z.infer<typeof GetMeInputSchema>;
export type GetMeOutput = z.infer<typeof GetMeOutputSchema>;
export type MeNamespace = z.infer<typeof MeNamespaceSchema>;

const NamespaceQuery = z.object({ namespace: z.string().min(1) });

export const ListNamespaceMembersInputSchema = NamespaceQuery;

export const NamespaceMemberWithAuthSchema = NamespaceMemberSchema.extend({
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
  temporaryPassword: z.string(),
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
  temporaryPassword: z.string(),
  emailSent: z.boolean(),
});

export type ResendInviteInput = z.infer<typeof ResendInviteInputSchema>;
export type ResendInviteOutput = z.infer<typeof ResendInviteOutputSchema>;
