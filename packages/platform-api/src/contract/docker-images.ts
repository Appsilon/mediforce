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
