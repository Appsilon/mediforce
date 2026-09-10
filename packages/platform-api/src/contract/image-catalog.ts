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
 *  never that the entry is broken (ADR-0022 decision 2). */
export const ImageCatalogAvailabilitySchema = z.enum(['present', 'absent', 'unknown']);

/** Whether anybody has described this entry yet.
 *
 * `discovered` is an entry the platform derived from an image it built for
 * this namespace and nobody has written a sentence about — every other field
 * on it is as derived as a catalogued entry's, and it is not a stored row.
 * The distinction exists so a reader is never shown a blank `intent` with no
 * explanation of why it is blank. */
export const ImageCatalogOriginSchema = z.enum(['catalogued', 'discovered']);

/** A stored entry plus the facts recomputed for this read. */
export const ImageCatalogEntryViewSchema = ImageCatalogEntrySchema.extend({
  origin: ImageCatalogOriginSchema,
  /** Empty for a discovered entry — the one field no build can derive. Stored
   *  entries still require it; only the view admits the empty case. */
  intent: z.string(),
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
 *  read (ADR-0022 decision 2). */
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

/**
 * PATCH input: id from URL, every writable field optional.
 *
 * `source` **re-keys** the entry rather than editing a column. The id derives
 * from the source (decision 1), so a corrected repo or Dockerfile is a
 * different id: the handler writes the row at the new key and removes the old
 * one, which is safe by the property that makes deleting safe — no Workflow
 * Definition references an entry. A source that only *spells* the same key
 * differently (`Appsilon/x` for `git@github.com:Appsilon/x.git`) canonicalises
 * to the same id and stays in place.
 */
export const UpdateImageCatalogEntryInputApiSchema = NamespaceQuery.extend({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  intent: z
    .string()
    .min(1, 'intent is required: one sentence saying what this image is for')
    .optional(),
  source: ImageCatalogSourceSchema.optional(),
  declaredSource: ImageCatalogDeclaredSourceSchema.optional(),
}).strict();

export const UpdateImageCatalogEntryOutputSchema = z.object({
  entry: ImageCatalogEntryViewSchema,
});

/**
 * POST input for a build: the source and one commit.
 *
 * No `image` field. The tag is `deriveBuildTag`'s output for these exact
 * inputs, so accepting one would let a caller mint an image that no step
 * pinning this commit can find — the cache key and the catalog key would
 * disagree (ADR-0022 decision 1).
 */
export const BuildImageCatalogVersionInputSchema = NamespaceQuery.extend({
  repo: z.string().min(1),
  commit: z.string().min(1),
  /** Empty is a value, not an absence — it is what the entry is keyed on. */
  dockerfile: z.string().default(''),
}).strict();

export const BuildImageCatalogVersionOutputSchema = z.object({
  /** The tag the image was built under, which a step pinning this commit hits. */
  imageTag: z.string(),
  /** The entry this build belongs to — catalogued or discovered, same id. */
  entryId: z.string(),
});

/**
 * DELETE input: id from URL.
 *
 * `withImages` extends the act from "remove an offer" to "remove the artifacts
 * too", and the two are gated differently on purpose. Removing an entry is a
 * member's right, because it destroys nothing — no Workflow Definition
 * references an entry (decision 3). Removing an image acts on the
 * **deployment-wide** daemon, where a tag can back steps in namespaces the
 * caller cannot see, so it carries Infrastructure's admin gate and audits
 * under `_system`. Optional, and absent means no: the destructive half is
 * always asked for, never assumed, and a caller that does not care about it
 * need not mention it.
 */
export const DeleteImageCatalogEntryInputSchema = NamespaceQuery.extend({
  id: z.string().min(1),
  withImages: z.boolean().optional(),
});
export const DeleteImageCatalogEntryOutputSchema = z.object({
  success: z.literal(true),
  /** Tags removed from the daemon — empty unless `withImages` was set, and
   *  empty when the entry had no version on the daemon to remove. */
  deletedImages: z.array(z.string()),
});

export type ImageCatalogVersionBase = z.infer<typeof ImageCatalogVersionBaseSchema>;
export type ImageVersionLineage = z.infer<typeof ImageVersionLineageSchema>;
export type ImageCatalogVersion = z.infer<typeof ImageCatalogVersionSchema>;
export type ImageCatalogAvailability = z.infer<typeof ImageCatalogAvailabilitySchema>;
export type ImageCatalogOrigin = z.infer<typeof ImageCatalogOriginSchema>;
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
export type BuildImageCatalogVersionInput = z.infer<typeof BuildImageCatalogVersionInputSchema>;
export type BuildImageCatalogVersionOutput = z.infer<typeof BuildImageCatalogVersionOutputSchema>;
export type DeleteImageCatalogEntryInput = z.infer<typeof DeleteImageCatalogEntryInputSchema>;
export type DeleteImageCatalogEntryOutput = z.infer<typeof DeleteImageCatalogEntryOutputSchema>;
