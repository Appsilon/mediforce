import { z } from 'zod';
import { ToolCatalogEntrySchema } from '@mediforce/platform-core';

const NamespaceQuery = z.object({ namespace: z.string().min(1) });

export const ListToolCatalogEntriesInputSchema = NamespaceQuery;
export const ListToolCatalogEntriesOutputSchema = z.object({
  entries: z.array(ToolCatalogEntrySchema),
});

export const GetToolCatalogEntryInputSchema = NamespaceQuery.extend({
  id: z.string().min(1),
});
export const GetToolCatalogEntryOutputSchema = z.object({
  entry: ToolCatalogEntrySchema,
});

/** POST input: id is optional — server derives via `slugifyCommand(command)`
 *  when absent. Strict + partial on `id` keeps the wire schema honest about
 *  what the client may send while letting the create handler reject empty
 *  derivations as a validation error. */
export const CreateToolCatalogEntryInputApiSchema = NamespaceQuery.merge(ToolCatalogEntrySchema.partial({ id: true }));
export const CreateToolCatalogEntryOutputSchema = z.object({
  entry: ToolCatalogEntrySchema,
});

/** PATCH input: id from URL, partial body, id cannot be renamed (bindings
 *  reference it). */
export const UpdateToolCatalogEntryInputApiSchema = NamespaceQuery.extend({ id: z.string().min(1) }).merge(
  ToolCatalogEntrySchema.omit({ id: true }).partial().strict(),
);
export const UpdateToolCatalogEntryOutputSchema = z.object({
  entry: ToolCatalogEntrySchema,
});

export const DeleteToolCatalogEntryInputSchema = NamespaceQuery.extend({
  id: z.string().min(1),
});
export const DeleteToolCatalogEntryOutputSchema = z.object({
  success: z.literal(true),
});

export type ListToolCatalogEntriesInput = z.infer<typeof ListToolCatalogEntriesInputSchema>;
export type ListToolCatalogEntriesOutput = z.infer<typeof ListToolCatalogEntriesOutputSchema>;
export type GetToolCatalogEntryInput = z.infer<typeof GetToolCatalogEntryInputSchema>;
export type GetToolCatalogEntryOutput = z.infer<typeof GetToolCatalogEntryOutputSchema>;
export type CreateToolCatalogEntryInputApi = z.infer<typeof CreateToolCatalogEntryInputApiSchema>;
export type CreateToolCatalogEntryOutput = z.infer<typeof CreateToolCatalogEntryOutputSchema>;
export type UpdateToolCatalogEntryInputApi = z.infer<typeof UpdateToolCatalogEntryInputApiSchema>;
export type UpdateToolCatalogEntryOutput = z.infer<typeof UpdateToolCatalogEntryOutputSchema>;
export type DeleteToolCatalogEntryInput = z.infer<typeof DeleteToolCatalogEntryInputSchema>;
export type DeleteToolCatalogEntryOutput = z.infer<typeof DeleteToolCatalogEntryOutputSchema>;
