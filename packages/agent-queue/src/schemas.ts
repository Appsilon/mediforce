import { z } from 'zod';

/**
 * Payload sent from the API process to the worker via BullMQ.
 *
 * The caller builds the full `docker run` argument list — the worker is a thin
 * executor that spawns the container and returns stdout/stderr/exit info.
 *
 * `outputDir` is a real filesystem path because the worker runs on the same
 * machine (shared /tmp). For multi-machine scaling, this would need to move to
 * a shared volume or object store.
 */
export const DockerJobDataSchema = z.object({
  /** Discriminator so the worker can handle future job types. */
  jobType: z.enum(['agent-container', 'script-container']),
  /** Full `docker run` argument list (everything after `docker`). */
  dockerArgs: z.array(z.string()),
  /** Prompt piped to container stdin (null = no stdin). */
  stdinPayload: z.string().nullable(),
  /** Max execution time in milliseconds. */
  timeoutMs: z.number(),
  /** Container name — used for `docker kill` on timeout. */
  containerName: z.string(),
  /** Tracing context. */
  processInstanceId: z.string(),
  /** Tracing context. */
  stepId: z.string(),
  /** Host-side output directory mounted at /output in the container. */
  outputDir: z.string(),
});

export type DockerJobData = z.infer<typeof DockerJobDataSchema>;

export const DockerJobResultSchema = z.object({
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number().nullable(),
  signal: z.string().nullable(),
});

export type DockerJobResult = z.infer<typeof DockerJobResultSchema>;

/** BullMQ queue name shared between client and worker. */
export const QUEUE_NAME = 'mediforce:docker-jobs';
