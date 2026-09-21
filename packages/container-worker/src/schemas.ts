import { z } from 'zod';
import { BuildContextSchema } from '@mediforce/platform-core';

/**
 * Payload sent from the API process to the worker via BullMQ.
 *
 * When caller and worker share /tmp (same machine), outputDir paths work directly.
 * When they run on different machines (e.g. Vercel → VPS worker), `inputFiles`
 * carries file contents through Redis and the worker recreates them locally.
 */
export const DockerJobDataSchema = z.object({
  /** Discriminator so the worker can handle future job types. */
  jobType: z.enum(['agent-container', 'script-container', 'build-image']),
  /** Full `docker run` argument list (everything after `docker`). Empty for a
   *  `build-image` job, which builds and runs nothing. */
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
  /** Files from outputDir, keyed by POSIX relative path with base64-encoded
   *  content (see file-payload.ts). Sent through Redis when caller and worker
   *  don't share a filesystem (e.g. Vercel → VPS). */
  inputFiles: z.record(z.string(), z.string()).optional(),
  /** Redis key holding `inputFiles` when they travel beside the job instead of
   *  inside it (see file-payload-store.ts). */
  inputFilesKey: z.string().optional(),
  /** Redis key holding `stdinPayload` when the prompt is too large to sit in
   *  the job (see file-payload-store.ts). */
  stdinPayloadKey: z.string().optional(),
  /** Set by a caller that understands the `*Key` fields in the result. Absent
   *  means a platform older than those keys, so the worker keeps text inline
   *  rather than returning a key the caller would drop on the floor. */
  payloadKeysSupported: z.boolean().optional(),
  /** Image build metadata — when present, worker ensures image exists before
   *  docker run. Either a repo at a commit, or `contextDir`: a host directory
   *  that already holds the build context (the files a workflow carries,
   *  materialized under the shared temp dir both processes see). */
  imageBuild: z.object({
    image: z.string(),
    repoUrl: z.string().optional(),
    /** Pre-normalization repo reference used to pick the clone transport; falls back to `repoUrl`. */
    repoRef: z.string().optional(),
    commit: z.string().optional(),
    dockerfile: z.string().optional(),
    /** Build context from the repo root; `dockerfile` is then read from it. */
    context: BuildContextSchema.optional(),
    repoToken: z.string().optional(),
    contextDir: z.string().optional(),
    /** Content hash of the files in `contextDir`; compared with the image's label on reuse. */
    artifactsHash: z.string().optional(),
    /** Workflow definition whose step triggered the build; written as an image label. */
    workflow: z.string().optional(),
    /** Namespace owning that definition; written as an image label. */
    namespace: z.string().optional(),
  }).optional(),
});

export type DockerJobData = z.infer<typeof DockerJobDataSchema>;

export const DockerJobResultSchema = z.object({
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number().nullable(),
  signal: z.string().nullable(),
  /** Files from the worker's outputDir after docker run completes, keyed by
   *  POSIX relative path with base64-encoded content (see file-payload.ts).
   *  Returned through Redis so the caller can recreate them locally. */
  outputFiles: z.record(z.string(), z.string()).optional(),
  /** Redis key holding `outputFiles` when the job's inputs came by key. */
  outputFilesKey: z.string().optional(),
  /** Redis keys holding `stdout` / `stderr` when the container wrote more than
   *  belongs in a retained job hash and its `completed` event. */
  stdoutKey: z.string().optional(),
  stderrKey: z.string().optional(),
});

export type DockerJobResult = z.infer<typeof DockerJobResultSchema>;

/** BullMQ queue name shared between client and worker. */
export const QUEUE_NAME = 'mediforce-docker-jobs';
