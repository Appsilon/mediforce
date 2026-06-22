import { z } from 'zod';
import {
  PublicOAuthProviderConfigSchema,
  CreateOAuthProviderInputSchema,
  UpdateOAuthProviderInputSchema,
} from '@mediforce/platform-core';

const NamespaceQuery = z.object({ namespace: z.string().min(1) });

export const ListOAuthProvidersInputSchema = NamespaceQuery;
export const ListOAuthProvidersOutputSchema = z.object({
  providers: z.array(PublicOAuthProviderConfigSchema),
});

export const GetOAuthProviderInputSchema = NamespaceQuery.extend({
  id: z.string().min(1),
});
export const GetOAuthProviderOutputSchema = z.object({
  provider: PublicOAuthProviderConfigSchema,
});

export const CreateOAuthProviderInputApiSchema = NamespaceQuery.merge(CreateOAuthProviderInputSchema);
export const CreateOAuthProviderOutputSchema = z.object({
  provider: PublicOAuthProviderConfigSchema,
});

export const UpdateOAuthProviderInputApiSchema = NamespaceQuery.extend({
  id: z.string().min(1),
}).merge(UpdateOAuthProviderInputSchema);
export const UpdateOAuthProviderOutputSchema = z.object({
  provider: PublicOAuthProviderConfigSchema,
});

export const DeleteOAuthProviderInputSchema = NamespaceQuery.extend({
  id: z.string().min(1),
});
export const DeleteOAuthProviderOutputSchema = z.object({
  success: z.literal(true),
});

export type ListOAuthProvidersInput = z.infer<typeof ListOAuthProvidersInputSchema>;
export type ListOAuthProvidersOutput = z.infer<typeof ListOAuthProvidersOutputSchema>;
export type GetOAuthProviderInput = z.infer<typeof GetOAuthProviderInputSchema>;
export type GetOAuthProviderOutput = z.infer<typeof GetOAuthProviderOutputSchema>;
export type CreateOAuthProviderInputApi = z.infer<typeof CreateOAuthProviderInputApiSchema>;
export type CreateOAuthProviderOutput = z.infer<typeof CreateOAuthProviderOutputSchema>;
export type UpdateOAuthProviderInputApi = z.infer<typeof UpdateOAuthProviderInputApiSchema>;
export type UpdateOAuthProviderOutput = z.infer<typeof UpdateOAuthProviderOutputSchema>;
export type DeleteOAuthProviderInput = z.infer<typeof DeleteOAuthProviderInputSchema>;
export type DeleteOAuthProviderOutput = z.infer<typeof DeleteOAuthProviderOutputSchema>;
