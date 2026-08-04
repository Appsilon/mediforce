import { spawn } from 'node:child_process';
import { appendFile, mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DockerJobDataSchema } from './schemas';
import type { DockerJobResult } from './schemas';
import { encodeFilePayload, decodeFilePayload } from './file-payload';
import { ensureImage } from './docker-image-builder';
import { removeStaleContainer } from './docker-cleanup';
import { createLineStreamReader } from '@mediforce/platform-core';

/**
 * If inputFiles are provided (remote caller), create a local temp dir,
 * write the files, and replace the remote outputDir path in dockerArgs
 * with the local path. Returns the local outputDir to read results from.
 */
async function prepareLocalOutputDir(data: { inputFiles?: Record<string, string>; outputDir: string; dockerArgs: string[] }): Promise<{ localOutputDir: string; patchedArgs: string[] }> {
  if (!data.inputFiles || Object.keys(data.inputFiles).length === 0) {
    // Same machine — outputDir already exists locally
    return { localOutputDir: data.outputDir, patchedArgs: data.dockerArgs };
  }

  const localOutputDir = await mkdtemp(join(tmpdir(), 'mediforce-worker-'));
  const fileNames = Object.keys(data.inputFiles);
  console.log(`[worker] Remote caller — recreating ${fileNames.length} input file(s) in ${localOutputDir}: ${fileNames.join(', ')}`);
  await decodeFilePayload(data.inputFiles, localOutputDir);

  // Replace the remote outputDir path in dockerArgs with local path
  const remoteDir = data.outputDir;
  const patchedArgs = data.dockerArgs.map((arg) =>
    arg.includes(remoteDir) ? arg.replace(remoteDir, localOutputDir) : arg,
  );
  console.log(`[worker] Patched outputDir: ${remoteDir} → ${localOutputDir}`);

  return { localOutputDir, patchedArgs };
}

export async function processDockerJob(rawData: unknown): Promise<DockerJobResult> {
  const data = DockerJobDataSchema.parse(rawData);
  const logFile = data.logFile;
  const hasInputFiles = data.inputFiles && Object.keys(data.inputFiles).length > 0;

  // Lazy image build: ensure Docker image exists before running container
  if (data.imageBuild) {
    await ensureImage(data.imageBuild);
  }

  // Remove any stale container holding this name (from a crashed/killed/retried
  // attempt). `docker run --rm` only cleans up on a clean exit, so without this a
  // retry hits `Conflict. The container name "…" is already in use` (exit 125).
  await removeStaleContainer(data.containerName);

  return prepareLocalOutputDir(data).then(({ localOutputDir, patchedArgs }) => new Promise<DockerJobResult>((resolve, reject) => {
    const child = spawn('docker', patchedArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let settled = false;
    let containerId: string | null = null;

    // Ensure log directory exists before first write
    let logDirReady: Promise<void> | null = null;
    if (logFile) {
      logDirReady = mkdir(dirname(logFile), { recursive: true }).then(() => {});
    }

    const timeoutHandle = setTimeout(() => {
      if (settled) return;
      console.error(
        `[worker] Docker timeout (${Math.round(data.timeoutMs / 60_000)} min) — killing ${data.containerName}`,
      );
      child.kill('SIGTERM');
      const killTarget = containerId ?? data.containerName;
      spawn('docker', ['kill', killTarget], { stdio: 'ignore' }).unref();
    }, data.timeoutMs);

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    // Stream stdout lines to log file in realtime via the shared line-buffer helper.
    const stdoutReader = createLineStreamReader((line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      if (logFile && logDirReady) {
        logDirReady.then(() =>
          appendFile(logFile, trimmed + '\n'),
        ).catch(() => {});
      }
    });

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
    });

    child.on('error', (error) => {
      settled = true;
      clearTimeout(timeoutHandle);
      reject(new Error(`Docker process failed: ${error.message}`));
    });

    child.on('close', (code, signal) => {
      settled = true;
      clearTimeout(timeoutHandle);

      const stdout = Buffer.concat(stdoutChunks).toString('utf-8');
      const stderr = Buffer.concat(stderrChunks).toString('utf-8');

      // Flush trailing partial line through the same per-line path.
      stdoutReader.flush();

      // If remote caller sent inputFiles, collect output files to return through Redis
      if (hasInputFiles) {
        encodeFilePayload(localOutputDir).then((outputFiles) => {
          resolve({ stdout, stderr, exitCode: code, signal: signal ?? null, outputFiles });
        }).catch((err) => {
          console.warn(`[worker] Failed to collect output files: ${err instanceof Error ? err.message : err}`);
          resolve({ stdout, stderr, exitCode: code, signal: signal ?? null });
        });
      } else {
        resolve({ stdout, stderr, exitCode: code, signal: signal ?? null });
      }
    });

    if (data.stdinPayload !== null) {
      child.stdin.write(data.stdinPayload);
    }
    child.stdin.end();
  }));
}
