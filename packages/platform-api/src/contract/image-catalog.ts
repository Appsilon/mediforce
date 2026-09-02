import { z } from 'zod';
import {
  ImageCatalogDeclaredSourceSchema,
  ImageCatalogEntrySchema,
  ImageCatalogSourceSchema,
} from '@mediforce/platform-core';

const NamespaceQuery = z.object({ namespace: z.string().min(1) });

/** One built artifact of an entry's source, as the daemon currently holds it.
 *  Recomputed on every read — see `handlers/image-catalog/_versions.ts`. */
export const ImageCatalogVersionSchema = z.object({
  /** `repository:tag` — for a built entry, what `deriveBuildTag` minted. */
  imageTag: z.string(),
  imageId: z.string(),
  /** Commit the build context was checked out at, from the build labels. */
  commit: z.string().optional(),
  /** The daemon's own relative age string, e.g. "2 days ago". */
  created: z.string(),
  /** The daemon's own human size string, e.g. "1.24GB". */
  size: z.string(),
  /** Workflow whose step triggered the build, from the build labels. */
  workflow: z.string().optional(),
  /** Namespace owning that workflow, from the build labels. */
  namespace: z.string().optional(),
});

/** Present, absent, or unknown. Unknown means the daemon could not be reached,
 *  never that the entry is broken (ADR-0021 decision 2). */
export const ImageCatalogAvailabilitySchema = z.enum(['present', 'absent', 'unknown']);

/** A stored entry plus the facts recomputed for this read. */
export const ImageCatalogEntryViewSchema = ImageCatalogEntrySchema.extend({
  versions: z.array(ImageCatalogVersionSchema),
  availability: ImageCatalogAvailabilitySchema,
});

export const ListImageCatalogEntriesInputSchema = NamespaceQuery;
export const ListImageCatalogEntriesOutputSchema = z.object({
  entries: z.array(ImageCatalogEntryViewSchema),
});

export const GetImageCatalogEntryInputSchema = NamespaceQuery.extend({
  id: z.string().min(1),
});
export const GetImageCatalogEntryOutputSchema = z.object({
  entry: ImageCatalogEntryViewSchema,
});

/** POST input: no `id`. The id is derived from `source`, so accepting one
 *  would let two rows describe the same image. `intent` is required here, not
 *  just in a form — an entry whose sentence is optional is a row nobody can
 *  read (ADR-0021 decision 2). */
export const CreateImageCatalogEntryInputApiSchema = NamespaceQuery.extend({
  name: z.string().min(1),
  intent: z
    .string()
    .min(1, 'intent is required: one sentence saying what this image is for'),
  source: ImageCatalogSourceSchema,
  declaredSource: ImageCatalogDeclaredSourceSchema.optional(),
}).strict();

export const CreateImageCatalogEntryOutputSchema = z.object({
  entry: ImageCatalogEntryViewSchema,
});

/** PATCH input: id from URL. `source` is absent by design — it is the key, so
 *  changing it is creating a different entry, not editing this one. */
export const UpdateImageCatalogEntryInputApiSchema = NamespaceQuery.extend({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  intent: z
    .string()
    .min(1, 'intent is required: one sentence saying what this image is for')
    .optional(),
  declaredSource: ImageCatalogDeclaredSourceSchema.optional(),
}).strict();

export const UpdateImageCatalogEntryOutputSchema = z.object({
  entry: ImageCatalogEntryViewSchema,
});

export const DeleteImageCatalogEntryInputSchema = NamespaceQuery.extend({
  id: z.string().min(1),
});
export const DeleteImageCatalogEntryOutputSchema = z.object({
  success: z.literal(true),
});

export type ImageCatalogVersion = z.infer<typeof ImageCatalogVersionSchema>;
export type ImageCatalogAvailability = z.infer<typeof ImageCatalogAvailabilitySchema>;
export type ImageCatalogEntryView = z.infer<typeof ImageCatalogEntryViewSchema>;
export type ListImageCatalogEntriesInput = z.infer<typeof ListImageCatalogEntriesInputSchema>;
export type ListImageCatalogEntriesOutput = z.infer<typeof ListImageCatalogEntriesOutputSchema>;
export type GetImageCatalogEntryInput = z.infer<typeof GetImageCatalogEntryInputSchema>;
export type GetImageCatalogEntryOutput = z.infer<typeof GetImageCatalogEntryOutputSchema>;
export type CreateImageCatalogEntryInputApi = z.infer<
  typeof CreateImageCatalogEntryInputApiSchema
>;
export type CreateImageCatalogEntryOutput = z.infer<typeof CreateImageCatalogEntryOutputSchema>;
export type UpdateImageCatalogEntryInputApi = z.infer<
  typeof UpdateImageCatalogEntryInputApiSchema
>;
export type UpdateImageCatalogEntryOutput = z.infer<typeof UpdateImageCatalogEntryOutputSchema>;
export type DeleteImageCatalogEntryInput = z.infer<typeof DeleteImageCatalogEntryInputSchema>;
export type DeleteImageCatalogEntryOutput = z.infer<typeof DeleteImageCatalogEntryOutputSchema>;
