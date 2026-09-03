import { z } from 'zod';

/**
 * One row of the Docker daemon's image list, plus the build provenance the
 * platform labels its own images with.
 *
 * Every `build*` field is optional: an image pulled from a registry, or built
 * before the labels existed, carries none of them and lists unannotated.
 */
export const DockerImageInfoSchema = z.object({
  repository: z.string(),
  tag: z.string(),
  id: z.string(),
  size: z.string(),
  created: z.string(),
  /** Git repo the image was built from (`mediforce.build.repo`). */
  buildRepo: z.string().optional(),
  /** Commit the build context was checked out at (`mediforce.build.commit`). */
  buildCommit: z.string().optional(),
  /** Dockerfile path inside that repo (`mediforce.build.dockerfile`). */
  buildDockerfile: z.string().optional(),
  /** Workflow definition whose step triggered the build (`mediforce.build.workflow`). */
  buildWorkflow: z.string().optional(),
  /** Namespace owning that definition (`mediforce.build.namespace`). */
  buildNamespace: z.string().optional(),
  /**
   * The image's nearest ancestor on this daemon, by `RootFS.Layers` prefix
   * containment — exact, and computed rather than parsed out of a `FROM`
   * string. Absent for a root: an image whose base is not on this daemon looks
   * the same as one built from scratch, and the listing does not pretend to
   * tell them apart.
   */
  baseImageId: z.string().optional(),
  /**
   * The labels this image sets itself, its base's stripped out. Docker copies
   * a base's labels onto every child, so the raw set cannot be read as
   * provenance — a local image of ours carries rocker's
   * `org.opencontainers.image.source` until we override it.
   *
   * Absent, like the fields above it, when the listing could not inspect the
   * image — an image removed between the two calls, an old daemon.
   */
  ownLabels: z.record(z.string(), z.string()).optional(),
});

export const DockerDiskInfoSchema = z.object({
  images: z.object({ totalCount: z.number(), size: z.string() }),
  containers: z.object({ totalCount: z.number(), active: z.number(), size: z.string() }),
  buildCache: z.object({ size: z.string() }),
});

export const DockerInfoResponseSchema = z.discriminatedUnion('available', [
  z.object({
    available: z.literal(true),
    images: z.array(DockerImageInfoSchema),
    disk: DockerDiskInfoSchema,
  }),
  z.object({
    available: z.literal(false),
  }),
]);

export const GetDockerInfoInputSchema = z.object({});
export type GetDockerInfoInput = z.infer<typeof GetDockerInfoInputSchema>;

export const OpenRouterCreditsInputSchema = z.object({
  namespace: z.string().min(1),
});

export const OpenRouterCreditsOutputSchema = z.object({
  available: z.boolean(),
  /** Key-level spend cap (OpenRouter `GET /auth/key` `limit`). */
  limit: z.number(),
  /** Key-level usage so far. */
  usage: z.number(),
  /** Key-level headroom under the cap (`limit_remaining`). */
  remaining: z.number(),
  /**
   * Account prepaid credit remaining (`total_credits - total_usage` from
   * `GET /credits`). Omitted when the credits call fails but the key call
   * succeeds.
   */
  accountRemaining: z.number().optional(),
  /**
   * Real spendable budget the runtime enforces per request:
   * `min(remaining, accountRemaining)`. Falls back to `remaining` when the
   * account balance is unknown.
   */
  effectiveRemaining: z.number(),
  error: z.string().optional(),
});

export type DockerImageInfo = z.infer<typeof DockerImageInfoSchema>;
export type DockerDiskInfo = z.infer<typeof DockerDiskInfoSchema>;
export type DockerInfoResponse = z.infer<typeof DockerInfoResponseSchema>;
export type OpenRouterCreditsInput = z.infer<typeof OpenRouterCreditsInputSchema>;
export type OpenRouterCreditsOutput = z.infer<typeof OpenRouterCreditsOutputSchema>;
