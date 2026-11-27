import { z } from 'zod';

export const DeleteDockerImageInputSchema = z.object({
  imageId: z.string().min(1, 'imageId is required'),
});

/**
 * `output` is populated when the deletion ran locally (the platform was
 * configured for `ALLOW_LOCAL_AGENTS` mode) and the `docker rmi` stdout was
 * non-empty. Worker-mediated deletes omit it — the worker's response body is
 * not surfaced. The pre-headless route returned the same shape.
 */
export const DeleteDockerImageOutputSchema = z.object({
  deleted: z.string(),
  output: z.string().optional(),
});

export type DeleteDockerImageInput = z.infer<typeof DeleteDockerImageInputSchema>;
export type DeleteDockerImageOutput = z.infer<typeof DeleteDockerImageOutputSchema>;

/** Minimum age, in days, an image must reach before the prune sweep may delete
 *  it — the window a freshly built image gets before anything has to name it. */
export const DEFAULT_IMAGE_PRUNE_MIN_AGE_DAYS = 14;

export const PruneDockerImagesInputSchema = z.object({
  /** Report what would be deleted and delete nothing. */
  dryRun: z.boolean().default(false),
  minAgeDays: z.number().int().min(0).default(DEFAULT_IMAGE_PRUNE_MIN_AGE_DAYS),
  /** Narrow the sweep to these `repository:tag` images; every candidate when absent. */
  images: z.array(z.string().min(1)).optional(),
});

/**
 * Why a candidate survived the sweep:
 * - `workflow`: the version runs start from names it, or some version names
 *   it with nothing to rebuild it from.
 * - `agent`: an agent definition names it.
 * - `run`: a run that is not finished — or failed recently enough to be
 *   resumed — is on a version that names it.
 * - `recent`: younger than `minAgeDays`.
 * - `age-unknown`: the daemon did not report when it was created.
 */
export const ImagePruneKeepReasonSchema = z.enum(['workflow', 'agent', 'run', 'recent', 'age-unknown']);

const PruneImageRowSchema = z.object({
  image: z.string(),
  size: z.string(),
  createdAt: z.string().optional(),
});

export const PruneDockerImagesOutputSchema = z.object({
  /** `false` when the daemon listing could not be read; nothing is deleted then. */
  available: z.boolean(),
  dryRun: z.boolean(),
  /** Deleted — or, on a dry run, what would be. */
  pruned: z.array(PruneImageRowSchema),
  kept: z.array(PruneImageRowSchema.extend({ reason: ImagePruneKeepReasonSchema })),
  /** Candidates the daemon refused to remove, e.g. one a container still uses. */
  failed: z.array(z.object({ image: z.string(), error: z.string() })),
});

export type PruneDockerImagesInput = z.infer<typeof PruneDockerImagesInputSchema>;
/** What a client sends: the defaults are filled in on parse. */
export type PruneDockerImagesInputApi = z.input<typeof PruneDockerImagesInputSchema>;
export type ImagePruneKeepReason = z.infer<typeof ImagePruneKeepReasonSchema>;
export type PruneDockerImagesOutput = z.infer<typeof PruneDockerImagesOutputSchema>;
