import { z } from 'zod';
import {
  HandleSchema,
  NamespaceSchema,
  NamespaceMemberSchema,
} from '@mediforce/platform-core';

export const GetNamespaceInputSchema = z.object({ handle: HandleSchema });
export const GetNamespaceOutputSchema = z.object({
  namespace: NamespaceSchema,
  members: z.array(NamespaceMemberSchema),
});

export type GetNamespaceInput = z.infer<typeof GetNamespaceInputSchema>;
export type GetNamespaceOutput = z.infer<typeof GetNamespaceOutputSchema>;

export const CreateNamespaceInputSchema = z.object({
  handle: HandleSchema,
  displayName: z.string().min(1).max(128),
  bio: z.string().max(2048).optional(),
});

export const CreateNamespaceOutputSchema = z.object({
  namespace: NamespaceSchema,
});

export type CreateNamespaceInput = z.infer<typeof CreateNamespaceInputSchema>;
export type CreateNamespaceOutput = z.infer<typeof CreateNamespaceOutputSchema>;
