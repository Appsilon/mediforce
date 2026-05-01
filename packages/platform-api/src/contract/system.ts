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

export type DockerImageInfo = z.infer<typeof DockerImageInfoSchema>;
export type DockerDiskInfo = z.infer<typeof DockerDiskInfoSchema>;
export type DockerInfoResponse = z.infer<typeof DockerInfoResponseSchema>;
