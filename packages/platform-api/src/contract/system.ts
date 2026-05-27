import { z } from 'zod';

export const DockerImageInfoSchema = z.object({
  repository: z.string(),
  tag: z.string(),
  id: z.string(),
  size: z.string(),
  created: z.string(),
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
  limit: z.number(),
  usage: z.number(),
  remaining: z.number(),
  error: z.string().optional(),
});

export type DockerImageInfo = z.infer<typeof DockerImageInfoSchema>;
export type DockerDiskInfo = z.infer<typeof DockerDiskInfoSchema>;
export type DockerInfoResponse = z.infer<typeof DockerInfoResponseSchema>;
export type OpenRouterCreditsInput = z.infer<typeof OpenRouterCreditsInputSchema>;
export type OpenRouterCreditsOutput = z.infer<typeof OpenRouterCreditsOutputSchema>;
