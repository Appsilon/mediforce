import { z } from 'zod';
import {
  ImageBuildStepSchema,
  ImageCatalogDeclaredSourceSchema,
  ImageCatalogEntrySchema,
  ImageCatalogSourceSchema,
  ImageCapabilitiesSchema,
} from '@mediforce/platform-core';

const NamespaceQuery = z.object({ namespace: z.string().min(1) });

/** The catalog entry a version was built on, resolved by layer containment. */
export const ImageCatalogVersionBaseSchema = z.object({
  /** Entry owning the base image — what the catalog view groups under. */
  entryId: z.string(),
  imageId: z.string(),
  imageTag: z.string(),
});

/** What one version was built on and what it adds, computed from layers. */
export const ImageVersionLineageSchema = z.object({
  /**
   * The version's nearest ancestor **in this namespace's catalog**, or `null`
   * for a root. Nearest, not the root of the tree: an image built on one that
   * is itself catalogued names the closer of the two.
   */
  base: ImageCatalogVersionBaseSchema.nullable(),
  /**
   * The labels this image sets itself, its immediate ancestor's stripped out —
   * the only form in which `org.opencontainers.image.source` can be trusted,
   * since Docker inherits labels indistinguishably.
   */
  ownLabels: z.record(z.string(), z.string()),
  /**
   * The build steps this image adds over its base, oldest first.
   *
   * **A layer summary, never "the Dockerfile"**: no file contents, no
   * comments, no formatting, no multi-stage, and `<missing>` for every
   * intermediate id. Absent — not empty — on list reads, where computing it
   * would cost a `docker history` call per version; `GET` one entry to get it.
   */
  addedSteps: z.array(ImageBuildStepSchema).optional(),
});

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
  /** Cached probe result. Unknown means the image was not probed or the
   * daemon could not complete the bounded probe; it is never a render error. */
  capabilities: ImageCapabilitiesSchema,
  lineage: ImageVersionLineageSchema,
});

/** Present, absent, or unknown. Unknown means the daemon could not be reached,
 *  never that the entry is broken (ADR-0021 decision 2). */
export const ImageCatalogAvailabilitySchema = z.enum(['present', 'absent', 'unknown']);

/** A stored entry plus the facts recomputed for this read. */
export const ImageCatalogEntryViewSchema = ImageCatalogEntrySchema.extend({
  versions: z.array(ImageCatalogVersionSchema),
  availability: ImageCatalogAvailabilitySchema,
  /**
   * The entry this one's images are built on, or `null` for a root — the
   * grouping key of the catalog view. Taken from the entry's newest version,
   * since that is the one an author is about to pick; an older version built
   * on something else keeps its own `lineage.base`.
   */
  baseEntryId: z.string().nullable(),
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

export type ImageCatalogVersionBase = z.infer<typeof ImageCatalogVersionBaseSchema>;
export type ImageVersionLineage = z.infer<typeof ImageVersionLineageSchema>;
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
