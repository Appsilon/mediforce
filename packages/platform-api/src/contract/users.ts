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
