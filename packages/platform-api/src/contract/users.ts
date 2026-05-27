import { z } from 'zod';
import { NamespaceMemberSchema } from '@mediforce/platform-core';

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
