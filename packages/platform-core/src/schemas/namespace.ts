import { z } from 'zod';

export const NamespaceTypeSchema = z.enum(['personal', 'organization']);

export const NamespaceSchema = z.object({
  handle: z.string().min(1),
  type: NamespaceTypeSchema,
  displayName: z.string().min(1),
  avatarUrl: z.string().url().optional(),
  icon: z.string().optional(),
  linkedUserId: z.string().optional(),
  bio: z.string().optional(),
  createdAt: z.string().datetime(),
});

export const NamespaceMemberSchema = z.object({
  uid: z.string().min(1),
  role: z.enum(['owner', 'admin', 'member']),
  displayName: z.string().optional(),
  avatarUrl: z.string().url().optional(),
  joinedAt: z.string().datetime(),
});

export type NamespaceType = z.infer<typeof NamespaceTypeSchema>;
export type Namespace = z.infer<typeof NamespaceSchema>;
export type NamespaceMember = z.infer<typeof NamespaceMemberSchema>;
