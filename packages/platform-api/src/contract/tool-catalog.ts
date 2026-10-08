import { z } from 'zod';
import {
  HttpAuthConfigSchema,
  HttpToolCatalogEntrySchema,
  StdioToolCatalogEntrySchema,
  ToolCatalogEntrySchema,
} from '@mediforce/platform-core';

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

/** POST input: id is optional — the server derives it from the command
 *  (stdio) or the URL host (http) when absent. `type` defaults to `stdio`, so
 *  entry files written before HTTP entries existed still create stdio servers. */
export const CreateToolCatalogEntryInputApiSchema = z.preprocess(
  (value) =>
    typeof value === 'object' && value !== null && !('type' in value) ? { ...value, type: 'stdio' } : value,
  z.discriminatedUnion('type', [
    NamespaceQuery.extend(StdioToolCatalogEntrySchema.partial({ id: true }).shape).strict(),
    NamespaceQuery.extend(HttpToolCatalogEntrySchema.partial({ id: true }).shape).strict(),
  ]),
);
export const CreateToolCatalogEntryOutputSchema = z.object({
  entry: ToolCatalogEntrySchema,
});

/** PATCH input: id from URL, partial body. Neither id nor type can change —
 *  bindings reference the id and promise the type. An optional field left out
 *  keeps its value; sent as `null` it is cleared. Fields of the other
 *  transport are rejected by the handler. */
const stdioFields = StdioToolCatalogEntrySchema.shape;
const httpFields = HttpToolCatalogEntrySchema.shape;
export const UpdateToolCatalogEntryInputApiSchema = NamespaceQuery
  .extend({ id: z.string().min(1) })
  .merge(z.object({
    command: stdioFields.command.optional(),
    args: stdioFields.args.nullable(),
    env: stdioFields.env.nullable(),
    url: httpFields.url.optional(),
    auth: HttpAuthConfigSchema.nullable().optional(),
    description: stdioFields.description.nullable(),
  }).strict());
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
