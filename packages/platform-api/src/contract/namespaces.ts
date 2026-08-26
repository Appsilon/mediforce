import { z } from 'zod';
import {
  HandleSchema,
  NamespaceSchema,
  NamespaceMemberSchema,
  BrandColorSchema,
  WorkspaceLogoSchema,
} from '@mediforce/platform-core';

export const GetNamespaceInputSchema = z.object({ handle: HandleSchema });

/**
 * Contact details of the workspace's primary owner (earliest-joined `owner`),
 * exposed to every member so a non-admin can reach someone when a run is
 * blocked or setup is missing. This is the ONE member email a plain member may
 * see — the bulk `listNamespaceMembers` roster gates email/last-sign-in to
 * admins. `null` when the workspace has no owner or no directory is wired.
 */
export const NamespaceAdminContactSchema = z.object({
  displayName: z.string().nullable(),
  email: z.string().nullable(),
});

export const GetNamespaceOutputSchema = z.object({
  namespace: NamespaceSchema,
  members: z.array(NamespaceMemberSchema),
  personalHandles: z.record(z.string(), z.string()).optional(),
  adminContact: NamespaceAdminContactSchema.nullable(),
});

export type GetNamespaceInput = z.infer<typeof GetNamespaceInputSchema>;
export type GetNamespaceOutput = z.infer<typeof GetNamespaceOutputSchema>;
export type NamespaceAdminContact = z.infer<typeof NamespaceAdminContactSchema>;

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
  logo: WorkspaceLogoSchema.optional(),
  brandPrimaryColor: BrandColorSchema.optional(),
  brandAccentColor: BrandColorSchema.optional(),
});
const atLeastOneUpdateField = (v: z.infer<typeof UpdateNamespaceFieldsSchema>): boolean =>
  v.displayName !== undefined ||
  v.bio !== undefined ||
  v.icon !== undefined ||
  v.logo !== undefined ||
  v.brandPrimaryColor !== undefined ||
  v.brandAccentColor !== undefined;
const atLeastOneUpdateFieldMessage =
  'At least one of displayName, bio, icon, logo, brandPrimaryColor, brandAccentColor must be provided';

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
 * DELETE /api/namespaces/:handle — cascade delete (owner only). Personal
 * workspaces are rejected with 409 `precondition_failed`: every user needs
 * one, so `getMe` re-bootstraps a personal namespace the moment it is gone —
 * deleting one wipes its contents instead of removing it. Reset it instead.
 */
export const DeleteNamespaceInputSchema = z.object({ handle: HandleSchema });
export const DeleteNamespaceOutputSchema = z.object({ handle: HandleSchema });
export type DeleteNamespaceInput = z.infer<typeof DeleteNamespaceInputSchema>;
export type DeleteNamespaceOutput = z.infer<typeof DeleteNamespaceOutputSchema>;

/**
 * POST /api/namespaces/:handle/reset — delete every workflow in the workspace
 * (cascading to its runs and tasks) while the workspace, its members, its
 * secrets and its audit trail survive. Owner only. This is the honest version
 * of what deleting a personal workspace used to do by accident.
 */
export const ResetNamespaceInputSchema = z.object({ handle: HandleSchema });
export const ResetNamespaceOutputSchema = z.object({
  handle: HandleSchema,
  deletedWorkflows: z.number().int().nonnegative(),
  deletedRuns: z.number().int().nonnegative(),
});
export type ResetNamespaceInput = z.infer<typeof ResetNamespaceInputSchema>;
export type ResetNamespaceOutput = z.infer<typeof ResetNamespaceOutputSchema>;

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

/**
 * PUT /api/namespaces/:handle/members/:uid/roles — owner/admin replaces a
 * member's process-domain roles in the workspace (ADR-0019).
 *
 * Note the plural. `PATCH .../members/:uid` (singular `role`) is **Membership**
 * — owner / admin / member, who administers the workspace. This is **Roles** —
 * `reviewer`, `PI`, `approver`, what someone does in a process. `CONTEXT.md`
 * draws the same distinction; both live on a member and mean different things.
 *
 * Roles are free-form strings by construction (ADR-0019): the vocabulary is
 * open, so an unknown role is not a validation error. `workflowName: null` —
 * the default — grants across every workflow in the workspace; naming one
 * narrows the grant to it. Full replace: the `grants` array is the member's
 * end state, and an empty array clears their roles.
 */
export const RoleGrantSchema = z.object({
  role: z.string().min(1).max(64),
  workflowName: z.string().min(1).max(128).nullable().default(null),
});

export const SetNamespaceMemberRolesBodySchema = z.object({
  grants: z.array(RoleGrantSchema).max(64),
});
export const SetNamespaceMemberRolesInputSchema = SetNamespaceMemberRolesBodySchema.extend({
  handle: HandleSchema,
  uid: z.string().min(1),
});
export const SetNamespaceMemberRolesOutputSchema = z.object({
  handle: HandleSchema,
  uid: z.string().min(1),
  grants: z.array(RoleGrantSchema),
});

export type RoleGrantInput = z.infer<typeof RoleGrantSchema>;
export type SetNamespaceMemberRolesInput = z.infer<typeof SetNamespaceMemberRolesInputSchema>;
export type SetNamespaceMemberRolesOutput = z.infer<typeof SetNamespaceMemberRolesOutputSchema>;
