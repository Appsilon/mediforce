import { z } from 'zod';

/**
 * Payload sent from the API process to the worker via BullMQ.
 *
 * When caller and worker share /tmp (same machine), outputDir paths work directly.
 * When they run on different machines (e.g. Vercel → VPS worker), `inputFiles`
 * carries file contents through Redis and the worker recreates them locally.
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
  /** Host-side log file path for realtime activity streaming (null = no logging). */
  logFile: z.string().nullable(),
  /** Files from outputDir, keyed by filename. Sent through Redis when caller
   *  and worker don't share a filesystem (e.g. Vercel → VPS). */
  inputFiles: z.record(z.string(), z.string()).optional(),
});

export type DockerJobData = z.infer<typeof DockerJobDataSchema>;

export const DockerJobResultSchema = z.object({
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number().nullable(),
  signal: z.string().nullable(),
  /** Files from the worker's outputDir after docker run completes.
   *  Returned through Redis so the caller can recreate them locally. */
  outputFiles: z.record(z.string(), z.string()).optional(),
});

export type DockerJobResult = z.infer<typeof DockerJobResultSchema>;

/** BullMQ queue name shared between client and worker. */
export const QUEUE_NAME = 'mediforce-docker-jobs';
