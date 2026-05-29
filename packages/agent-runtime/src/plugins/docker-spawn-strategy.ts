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
import { appendFile, readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { ensureImage } from './docker-image-builder';
import { createLineStreamReader } from '@mediforce/platform-core';

export interface ImageBuildMeta {
  image: string;
  repoUrl: string;
  commit: string;
  dockerfile?: string;
  /** Resolved token for authenticated HTTPS clone. When absent, falls back to SSH deploy key. */
  repoToken?: string;
}

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
   * When provided, each raw stdout line is passed through this function before being written
   * to the log file. Returns an array of JSONL strings to write (empty = skip the line).
   * Used by LocalDockerSpawnStrategy to write parsed log entries in real-time.
   */
  lineProcessor?: (rawLine: string) => string[];
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

  async spawn(request: DockerSpawnRequest): Promise<DockerSpawnResult> {
    if (request.imageBuild) {
      await ensureImage(request.imageBuild);
    }

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
          if (request.lineProcessor) {
            const entries = request.lineProcessor(trimmed);
            if (entries.length > 0) {
              void logDirReady.then(() => appendFile(logFile, entries.join('\n') + '\n')).catch(() => {});
            }
          } else {
            void logDirReady.then(() => appendFile(logFile, trimmed + '\n')).catch(() => {});
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
 * written back to the caller's outputDir.
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

  async spawn(request: DockerSpawnRequest): Promise<DockerSpawnResult> {
    const { enqueueDockerJob } = await import('@mediforce/container-worker');

    // Collect all files from outputDir to send through Redis
    const inputFiles: Record<string, string> = {};
    try {
      const entries = await readdir(request.outputDir);
      for (const entry of entries) {
        const content = await readFile(join(request.outputDir, entry), 'utf-8');
        inputFiles[entry] = content;
      }
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

    // Write output files from worker back to caller's outputDir
    if (result.outputFiles) {
      await mkdir(request.outputDir, { recursive: true });
      for (const [name, content] of Object.entries(result.outputFiles)) {
        await writeFile(join(request.outputDir, name), content, 'utf-8');
      }
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
