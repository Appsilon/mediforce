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
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ensureImage } from './docker-image-builder.js';

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
  /** When present, strategy ensures the image exists (lazy build) before docker run. */
  imageBuild?: ImageBuildMeta;
  /** Called for each stdout line as soon as it is observable.
   *  LocalDockerSpawnStrategy invokes this in real time while the container runs.
   *  QueuedDockerSpawnStrategy invokes it once per line after the job completes
   *  (the worker ran remotely; real-time streaming is not available). */
  onStdoutLine?: (line: string) => void | Promise<void>;
}

export interface DockerSpawnResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
}

export interface DockerSpawnStrategy {
  spawn(request: DockerSpawnRequest): Promise<DockerSpawnResult>;
}

/**
 * Executes `docker run` directly as a child process.
 * This is the current behavior — extracted into a strategy for swapability.
 */
export class LocalDockerSpawnStrategy implements DockerSpawnStrategy {
  async spawn(request: DockerSpawnRequest): Promise<DockerSpawnResult> {
    if (request.imageBuild) {
      await ensureImage(request.imageBuild);
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
      let lineBuffer = '';

      child.stdout.on('data', (chunk: Buffer) => {
        stdoutChunks.push(chunk);

        if (!request.onStdoutLine) return;
        lineBuffer += chunk.toString('utf-8');
        const lines = lineBuffer.split('\n');
        lineBuffer = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const maybe = request.onStdoutLine(trimmed);
            if (maybe && typeof (maybe as Promise<void>).then === 'function') {
              (maybe as Promise<void>).catch(() => {});
            }
          } catch {
            // swallow — streaming log writes must not crash the spawn
          }
        }
      });

      child.stderr.on('data', (chunk: Buffer) => {
        stderrChunks.push(chunk);
        if (!containerId) {
          const text = chunk.toString('utf-8');
          const cidMatch = text.match(/^([0-9a-f]{12,64})\s*$/m);
          if (cidMatch) containerId = cidMatch[1];
        }
      });

      child.on('error', (error) => {
        settled = true;
        clearTimeout(timeoutHandle);
        reject(new Error(`Docker process failed: ${error.message}`));
      });

      child.on('close', (code, signal) => {
        settled = true;
        clearTimeout(timeoutHandle);

        // Flush any trailing unterminated line to the streaming callback.
        if (request.onStdoutLine && lineBuffer.trim()) {
          try {
            const maybe = request.onStdoutLine(lineBuffer.trim());
            if (maybe && typeof (maybe as Promise<void>).then === 'function') {
              (maybe as Promise<void>).catch(() => {});
            }
          } catch {
            // swallow
          }
          lineBuffer = '';
        }

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
 * Requires REDIS_URL to be set and @mediforce/agent-queue to be installed.
 */
export class QueuedDockerSpawnStrategy implements DockerSpawnStrategy {
  async spawn(request: DockerSpawnRequest): Promise<DockerSpawnResult> {
    const { enqueueDockerJob } = await import('@mediforce/agent-queue');

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

    // Write output files from worker back to caller's outputDir
    if (result.outputFiles) {
      await mkdir(request.outputDir, { recursive: true });
      for (const [name, content] of Object.entries(result.outputFiles)) {
        await writeFile(join(request.outputDir, name), content, 'utf-8');
      }
    }

    // Queued mode can't stream in real time — replay stdout lines through the
    // callback after completion so the log file still gets populated.
    if (request.onStdoutLine && result.stdout) {
      for (const line of result.stdout.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        await request.onStdoutLine(trimmed);
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
