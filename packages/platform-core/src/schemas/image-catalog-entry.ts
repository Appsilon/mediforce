import { z } from 'zod';
import { ImageCapabilityCacheSchema } from './image-capabilities';

/**
 * Where an entry's image comes from. This is the entry's key (ADR-0021
 * decision 1) — deliberately not the commit, so a rebuild lands as another
 * version of a row the author already chose rather than as a new row.
 */
export const ImageCatalogSourceSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('built'),
      /** Git repo the platform builds the image from. */
      repo: z.string().min(1),
      /**
       * Dockerfile path inside that repo. The empty string is a value, not an
       * absence: it is what `deriveBuildTag` folds in for a step that names
       * none, so two entries differing only in it are two images.
       */
      dockerfile: z.string().default(''),
    })
    .strict(),
  z
    .object({
      kind: z.literal('referenced'),
      /**
       * Image reference with no tag — `mediforce-golden-image`,
       * `registry.example.com/my-agent`. Its versions are tags, not commits.
       * This is the form for anything the platform did not build and holds no
       * build inputs for.
       */
      reference: z.string().min(1),
    })
    .strict(),
]);

/**
 * The one place a human may state provenance instead of the platform deriving
 * it (ADR-0021 decision 2). It exists for a pushed image, where there is no
 * derivable alternative: OCI labels are inherited from the base image, so a
 * local image of ours reports `rocker-versioned2` as its source.
 *
 * Optional, and every consumer must mark it as **declared, not derived**.
 */
export const ImageCatalogDeclaredSourceSchema = z
  .object({
    repo: z.string().min(1).optional(),
    commit: z.string().min(1).optional(),
    dockerfile: z.string().min(1).optional(),
  })
  .strict();

/**
 * One image the platform offers for steps, per namespace.
 *
 * Everything here is either the key or the single declared sentence: versions,
 * availability and lineage are recomputed on read from the daemon, never
 * stored. That is what keeps the catalog from becoming a second source of
 * truth about what an image contains. Capabilities are the one derived fact
 * that is cached rather than recomputed — reading them costs a container, so
 * they are keyed by the immutable image ID the daemon reports and a rebuild
 * under the same tag re-probes rather than reusing the old answer.
 */
export const ImageCatalogEntrySchema = z
  .object({
    /** Derived from `source`; never supplied by a client. */
    id: z.string().min(1),
    /** Human handle, e.g. "TealFlow agent". */
    name: z.string().min(1),
    /** One sentence saying what the image is *for*. Not its contents. */
    intent: z
      .string()
      .min(1, 'intent is required: one sentence saying what this image is for'),
    source: ImageCatalogSourceSchema,
    declaredSource: ImageCatalogDeclaredSourceSchema.optional(),
    capabilities: ImageCapabilityCacheSchema.default({}),
  })
  .strict();

export type ImageCatalogSource = z.infer<typeof ImageCatalogSourceSchema>;
export type ImageCatalogDeclaredSource = z.infer<typeof ImageCatalogDeclaredSourceSchema>;
export type ImageCatalogEntry = z.infer<typeof ImageCatalogEntrySchema>;
