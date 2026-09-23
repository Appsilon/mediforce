/**
 * Strategy abstraction for Docker container execution.
 *
 * Two implementations:
 * - LocalDockerSpawnStrategy: spawns `docker run` as a child process (default)
 * - QueuedDockerSpawnStrategy: enqueues to BullMQ, worker executes on remote machine
 *
 * The queued strategy is activated when REDIS_URL is set.
 */
import { spawn } from 'node:child_process';
import { appendFile, mkdir, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { ensureImage } from './docker-image-builder';

/** Bytes currently in the step's log, or 0 when there is no log to compare. */
async function logFileSize(logFile: string | null): Promise<number> {
  if (logFile === null) return 0;
  try {
    return (await stat(logFile)).size;
  } catch {
    return 0;
  }
}
import { appendStageEntry, createLineStreamReader, formatAgentLogLine } from '@mediforce/platform-core';
import type { AgentLogFormat } from '@mediforce/platform-core';

/**
 * How to get the image if it is not there. Either a git repo at a commit, or a
 * host directory that already holds the build context — the materialized files
 * a workflow carries, which need no clone. Exactly one of the two is set.
 */
export interface ImageBuildMeta {
  image: string;
  repoUrl?: string;
  /** User-supplied repo reference (pre-normalization), used to pick the clone transport.
   *  `repoUrl` stays the SSH-normalized form so it remains the cache-tag identity. */
  repoRef?: string;
  commit?: string;
  dockerfile?: string;
  /** Build context from the repo root; `dockerfile` is then read from it. */
  context?: string;
  /** Resolved token for authenticated HTTPS clones; SSH refs without a token use the deploy key. */
  repoToken?: string;
  /** Host path to build from, instead of a clone. Reachable from the worker as
   *  well as the orchestrator: it lives under the shared temp directory, the
   *  same assumption the skills cache and the `/artifacts` mount already make. */
  contextDir?: string;
  /** Content hash of the files in `contextDir`, labelled on the image and
   *  compared on reuse, so a tag the step named is rebuilt after an edit. */
  artifactsHash?: string;
  /** Workflow definition whose step triggered the build. Recorded as an image
   *  label so a derived `mediforce-built:<hash>` tag can name what it is for. */
  workflow?: string;
  /** Namespace owning that definition. Recorded as an image label. */
  namespace?: string;
}

/** A first image build is minutes of `docker build`, not seconds of container
 *  start, so it gets its own budget rather than a step's timeout. */
const IMAGE_BUILD_TIMEOUT_MS = 30 * 60 * 1000;

export interface DockerSpawnRequest {
  dockerArgs: string[];
  stdinPayload: string | null;
  timeoutMs: number;
  containerName: string;
  processInstanceId: string;
  stepId: string;
  outputDir: string;
  logFile: string | null;
  /**
   * How to turn each raw stdout line into activity-log entries. Named, not a
   * function, so the queued path can carry it through Redis and the worker can
   * write the same entries live — the orchestrator never sees a line until the
   * container has exited.
   */
  lineFormat?: AgentLogFormat;
  /**
   * When provided, called once for each complete stdout line. The local strategy invokes
   * this live (as the line arrives from the container); the queued strategy invokes it
   * after exit by replaying the buffered stdout through the same line-reader, so callers
   * see byte-identical event payloads on both paths (only the timing differs). Lines are
   * trimmed; empty lines are skipped.
   */
  onStdoutLine?: (line: string) => void;
  /** Same as onStdoutLine but for stderr. The standalone container-ID line that `docker
   *  run` writes before the container's own output is filtered out — it's noise. */
  onStderrLine?: (line: string) => void;
  /** When present, strategy ensures the image exists (lazy build) before docker run. */
  imageBuild?: ImageBuildMeta;
}

export interface DockerSpawnResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
}

export interface DockerSpawnStrategy {
  spawn(request: DockerSpawnRequest): Promise<DockerSpawnResult>;
  /**
   * Build the image without running anything. A dry run uses this: execution is
   * mocked, but whether the image compiles is the one thing a mock can never
   * answer, and it is the part that takes minutes and fails.
   */
  ensureImage(build: ImageBuildMeta): Promise<void>;
  /**
   * `true` when `onStdoutLine`/`onStderrLine` are invoked live during execution.
   * `false` when they are invoked after exit (queued strategy replays buffered output).
   * Plugins don't need to branch on this for correctness — events are identical either
   * way — but it's exposed for diagnostics and UI hints.
   */
  readonly supportsLiveStreaming: boolean;
}

/** The container-ID line `docker run` writes to stderr before forwarding the container's
 *  own output. We filter it from `onStderrLine` so it doesn't pollute activity feeds. */
const CONTAINER_ID_LINE = /^[0-9a-f]{12,64}$/;

/**
 * Executes `docker run` directly as a child process.
 * This is the current behavior — extracted into a strategy for swapability.
 */
export class LocalDockerSpawnStrategy implements DockerSpawnStrategy {
  readonly supportsLiveStreaming = true;

  async ensureImage(build: ImageBuildMeta): Promise<void> {
    await ensureImage(build);
  }

  async spawn(request: DockerSpawnRequest): Promise<DockerSpawnResult> {
    if (request.imageBuild) {
      // Bracketed with stage entries: a cold build is minutes during which no
      // container exists to emit anything, and the step just looks hung.
      await appendStageEntry(request.logFile, `Preparing container image ${request.imageBuild.image}`);
      try {
        await ensureImage(request.imageBuild);
      } catch (error) {
        await appendStageEntry(request.logFile, `Container image failed: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
      }
      await appendStageEntry(request.logFile, 'Container image ready');
    }

    // Remove any stale container holding this name (crashed/killed/retried
    // attempt). `docker run --rm` only cleans up on a clean exit, so without this
    // a retry hits `Conflict. The container name "…" is already in use` (exit 125).
    const { removeStaleContainer } = await import('@mediforce/container-worker');
    await removeStaleContainer(request.containerName);

    const { logFile } = request;
    let logDirReady: Promise<void> | null = null;
    if (logFile) {
      logDirReady = mkdir(dirname(logFile), { recursive: true }).then(() => {});
    }

    return new Promise<DockerSpawnResult>((resolve, reject) => {
      const child = spawn('docker', request.dockerArgs, {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let settled = false;
      let containerId: string | null = null;

      const timeoutHandle = setTimeout(() => {
        if (settled) return;
        console.error(
          `[docker-local] Timeout (${Math.round(request.timeoutMs / 60_000)} min) — killing ${request.containerName}`,
        );
        child.kill('SIGTERM');
        const killTarget = containerId ?? request.containerName;
        spawn('docker', ['kill', killTarget], { stdio: 'ignore' }).unref();
      }, request.timeoutMs);

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];

      // Per-line handler: surface to plugin via callback (live activity events) and,
      // when a logFile is configured, append the processed/raw line to disk. Log writes
      // are fire-and-forget — a hung disk must not stall the spawn() resolution.
      const handleStdoutLine = (line: string): void => {
        const trimmed = line.trim();
        if (trimmed.length === 0) return;
        if (request.onStdoutLine) {
          try {
            request.onStdoutLine(trimmed);
          } catch (err) {
            // Never let a callback failure tear down the container; emit a
            // breadcrumb so the issue isn't silent.
            console.warn('[docker-local] onStdoutLine callback threw:', err);
          }
        }
        if (logFile && logDirReady) {
          const entries = formatAgentLogLine(request.lineFormat ?? 'none', trimmed);
          if (entries.length > 0) {
            void logDirReady.then(() => appendFile(logFile, entries.join('\n') + '\n')).catch(() => {});
          }
        }
      };

      const handleStderrLine = (line: string): void => {
        const trimmed = line.trim();
        if (trimmed.length === 0) return;
        if (CONTAINER_ID_LINE.test(trimmed)) return; // docker-run preamble — not container output
        if (request.onStderrLine) {
          try {
            request.onStderrLine(trimmed);
          } catch (err) {
            console.warn('[docker-local] onStderrLine callback threw:', err);
          }
        }
      };

      const stdoutReader = createLineStreamReader(handleStdoutLine);
      const stderrReader = createLineStreamReader(handleStderrLine);

      child.stdout.on('data', (chunk: Buffer) => {
        stdoutChunks.push(chunk);
        stdoutReader.push(chunk);
      });

      child.stderr.on('data', (chunk: Buffer) => {
        stderrChunks.push(chunk);
        if (!containerId) {
          const text = chunk.toString('utf-8');
          const cidMatch = text.match(/^([0-9a-f]{12,64})\s*$/m);
          if (cidMatch) containerId = cidMatch[1];
        }
        stderrReader.push(chunk);
      });

      child.on('error', (error) => {
        settled = true;
        clearTimeout(timeoutHandle);
        reject(new Error(`Docker process failed: ${error.message}`));
      });

      child.on('close', (code, signal) => {
        settled = true;
        clearTimeout(timeoutHandle);

        // Flush trailing partial lines (no newline at EOF) through the same per-line
        // path so logging + onStdoutLine/onStderrLine see them too.
        stdoutReader.flush();
        stderrReader.flush();

        resolve({
          stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
          stderr: Buffer.concat(stderrChunks).toString('utf-8'),
          exitCode: code,
          signal: signal ?? null,
        });
      });

      if (request.stdinPayload !== null) {
        child.stdin.write(request.stdinPayload);
      }
      child.stdin.end();
    });
  }
}

/**
 * Enqueues the Docker job to BullMQ. A separate worker process picks it up
 * and executes `docker run`. Uses `waitUntilFinished` for a synchronous-feeling
 * API (the caller still awaits a Promise).
 *
 * Files from outputDir are sent through Redis as inputFiles so the worker can
 * recreate them locally (caller and worker may not share a filesystem).
 * Output files produced by the container are returned through Redis and
 * written back to the caller's outputDir. File contents cross the queue as
 * base64 keyed by POSIX relative path (see container-worker's file-payload.ts),
 * so binary files and nested directories survive intact.
 *
 * Function callbacks (`onStdoutLine`, `onStderrLine`) cannot cross the Redis
 * boundary, so live streaming is unavailable. The strategy compensates by replaying
 * the buffered stdout/stderr through the same `createLineStreamReader` the local
 * strategy uses — callers see byte-identical event payloads on both paths.
 *
 * Requires REDIS_URL to be set and @mediforce/container-worker to be installed.
 */
export class QueuedDockerSpawnStrategy implements DockerSpawnStrategy {
  readonly supportsLiveStreaming = false;

  async ensureImage(build: ImageBuildMeta): Promise<void> {
    // Through the queue, because the worker is where Docker is: a build-image
    // job ensures the image and returns without running a container.
    const { enqueueDockerJob } = await import('@mediforce/container-worker');
    await enqueueDockerJob({
      jobType: 'build-image',
      dockerArgs: [],
      stdinPayload: null,
      timeoutMs: IMAGE_BUILD_TIMEOUT_MS,
      containerName: `mediforce-build-${build.image.replace(/[^a-zA-Z0-9_.-]/g, '-')}`.slice(0, 63),
      processInstanceId: 'build-image',
      stepId: 'build-image',
      outputDir: '',
      logFile: null,
      lineFormat: 'none',
      imageBuild: build,
    });
  }

  async spawn(request: DockerSpawnRequest): Promise<DockerSpawnResult> {
    const { enqueueDockerJob, encodeFilePayload, decodeFilePayload } = await import('@mediforce/container-worker');

    const logSizeBefore = await logFileSize(request.logFile);

    // Collect all files from outputDir (base64, nested paths included) to send through Redis
    let inputFiles: Record<string, string> = {};
    try {
      inputFiles = await encodeFilePayload(request.outputDir);
      console.log(`[queued-strategy] Collected ${Object.keys(inputFiles).length} input file(s) from ${request.outputDir}: ${Object.keys(inputFiles).join(', ')}`);
    } catch (err) {
      console.warn(`[queued-strategy] Could not read outputDir '${request.outputDir}': ${err instanceof Error ? err.message : err}`);
    }

    const result = await enqueueDockerJob({
      jobType: 'agent-container',
      dockerArgs: request.dockerArgs,
      stdinPayload: request.stdinPayload,
      timeoutMs: request.timeoutMs,
      containerName: request.containerName,
      processInstanceId: request.processInstanceId,
      stepId: request.stepId,
      outputDir: request.outputDir,
      logFile: request.logFile,
      lineFormat: request.lineFormat ?? 'none',
      inputFiles,
      imageBuild: request.imageBuild,
    });

    // Replay buffered output through the same per-line reader the local strategy uses,
    // so event payloads (trim, empty-line skip, container-ID filter) match byte-for-byte.
    if (request.onStdoutLine) {
      const reader = createLineStreamReader((line) => {
        const trimmed = line.trim();
        if (trimmed.length === 0) return;
        try {
          request.onStdoutLine!(trimmed);
        } catch (err) {
          console.warn('[queued-strategy] onStdoutLine callback threw:', err);
        }
      });
      reader.push(result.stdout);
      reader.flush();
    }
    if (request.onStderrLine) {
      const reader = createLineStreamReader((line) => {
        const trimmed = line.trim();
        if (trimmed.length === 0) return;
        if (CONTAINER_ID_LINE.test(trimmed)) return;
        try {
          request.onStderrLine!(trimmed);
        } catch (err) {
          console.warn('[queued-strategy] onStderrLine callback threw:', err);
        }
      });
      reader.push(result.stderr);
      reader.flush();
    }

    // The worker writes the log live, but to its own disk. Whether this process
    // shares that disk is answered by looking: if the file grew while the job
    // ran, the worker's writes landed here and repeating them would double
    // every entry. Only a log that did not grow is reconstructed from stdout.
    // `inputFiles` used to stand in for this and was always non-empty — a step
    // ships at least its own `input.json`, so every queued run duplicated.
    const workerLogLanded = (await logFileSize(request.logFile)) > logSizeBefore;
    if (request.logFile !== null && !workerLogLanded) {
      const entries = result.stdout
        .split('\n')
        .flatMap((line) => formatAgentLogLine(request.lineFormat ?? 'none', line));
      if (entries.length > 0) {
        await mkdir(dirname(request.logFile), { recursive: true });
        await appendFile(request.logFile, entries.join('\n') + '\n');
      }
    }

    // Write output files from worker back to caller's outputDir
    if (result.outputFiles) {
      await decodeFilePayload(result.outputFiles, request.outputDir);
    }

    return result;
  }
}

let cachedStrategy: DockerSpawnStrategy | null = null;

/**
 * Returns the appropriate spawn strategy based on environment.
 * - REDIS_URL set → QueuedDockerSpawnStrategy (BullMQ worker)
 * - Otherwise → LocalDockerSpawnStrategy (child process, current behavior)
 */
export function getDockerSpawnStrategy(): DockerSpawnStrategy {
  if (cachedStrategy) return cachedStrategy;

  if (process.env.REDIS_URL) {
    console.log('[docker-strategy] Using queued strategy (BullMQ via REDIS_URL)');
    cachedStrategy = new QueuedDockerSpawnStrategy();
  } else {
    cachedStrategy = new LocalDockerSpawnStrategy();
  }

  return cachedStrategy;
}
