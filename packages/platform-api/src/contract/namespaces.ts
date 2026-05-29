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

/**
 * PATCH /api/namespaces/:handle — workspace metadata edit (owner/admin only).
 * Omitting a field leaves it unchanged; passing an empty string for `bio`
 * clears it.
 */
const UpdateNamespaceFieldsSchema = z.object({
  displayName: z.string().min(1).max(128).optional(),
  bio: z.string().max(2048).optional(),
  icon: z.string().min(1).max(64).optional(),
});
const atLeastOneUpdateField = (v: z.infer<typeof UpdateNamespaceFieldsSchema>): boolean =>
  v.displayName !== undefined || v.bio !== undefined || v.icon !== undefined;
const atLeastOneUpdateFieldMessage = 'At least one of displayName, bio, icon must be provided';

export const UpdateNamespaceBodySchema = UpdateNamespaceFieldsSchema.refine(
  atLeastOneUpdateField,
  { message: atLeastOneUpdateFieldMessage },
);
export const UpdateNamespaceInputSchema = UpdateNamespaceFieldsSchema
  .extend({ handle: HandleSchema })
  .refine(atLeastOneUpdateField, { message: atLeastOneUpdateFieldMessage });
export const UpdateNamespaceOutputSchema = z.object({ namespace: NamespaceSchema });

export type UpdateNamespaceInput = z.infer<typeof UpdateNamespaceInputSchema>;
export type UpdateNamespaceOutput = z.infer<typeof UpdateNamespaceOutputSchema>;

/**
 * DELETE /api/namespaces/:handle — cascade delete (owner only).
 */
export const DeleteNamespaceInputSchema = z.object({ handle: HandleSchema });
export const DeleteNamespaceOutputSchema = z.object({ handle: HandleSchema });
export type DeleteNamespaceInput = z.infer<typeof DeleteNamespaceInputSchema>;
export type DeleteNamespaceOutput = z.infer<typeof DeleteNamespaceOutputSchema>;

/**
 * POST /api/namespaces/:handle/leave — caller removes self from workspace.
 * Owner blocked → 409 `precondition_failed` per ADR-0005 §3.
 */
export const LeaveNamespaceInputSchema = z.object({ handle: HandleSchema });
export const LeaveNamespaceOutputSchema = z.object({ handle: HandleSchema });
export type LeaveNamespaceInput = z.infer<typeof LeaveNamespaceInputSchema>;
export type LeaveNamespaceOutput = z.infer<typeof LeaveNamespaceOutputSchema>;

/**
 * DELETE /api/namespaces/:handle/members/:uid — owner/admin removes member.
 * Removing the owner is rejected — transfer / delete workspace instead.
 */
export const RemoveNamespaceMemberInputSchema = z.object({
  handle: HandleSchema,
  uid: z.string().min(1),
});
export const RemoveNamespaceMemberOutputSchema = z.object({
  handle: HandleSchema,
  uid: z.string().min(1),
});
export type RemoveNamespaceMemberInput = z.infer<typeof RemoveNamespaceMemberInputSchema>;
export type RemoveNamespaceMemberOutput = z.infer<typeof RemoveNamespaceMemberOutputSchema>;

/**
 * PATCH /api/namespaces/:handle/members/:uid — owner flips admin/member role.
 * Promoting / demoting `owner` is rejected at this endpoint.
 */
export const UpdateNamespaceMemberRoleBodySchema = z.object({
  role: z.enum(['admin', 'member']),
});
export const UpdateNamespaceMemberRoleInputSchema = UpdateNamespaceMemberRoleBodySchema.extend({
  handle: HandleSchema,
  uid: z.string().min(1),
});
export const UpdateNamespaceMemberRoleOutputSchema = z.object({
  member: NamespaceMemberSchema,
});
export type UpdateNamespaceMemberRoleInput = z.infer<typeof UpdateNamespaceMemberRoleInputSchema>;
export type UpdateNamespaceMemberRoleOutput = z.infer<typeof UpdateNamespaceMemberRoleOutputSchema>;
