/**
 * Standalone worker process — picks Docker jobs from BullMQ and executes them.
 *
 * Start with: REDIS_URL=redis://localhost:6379 tsx packages/agent-queue/src/worker-entry.ts
 */
import { Worker } from 'bullmq';
import { spawn } from 'node:child_process';
import { appendFile, mkdir, mkdtemp, writeFile, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { getRedisConnection } from './connection.js';
import { QUEUE_NAME, DockerJobDataSchema } from './schemas.js';
import type { DockerJobResult } from './schemas.js';
import { ensureImage } from './docker-image-builder.js';

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
  const fileCount = Object.keys(data.inputFiles).length;
  console.log(`[worker] Remote caller — recreating ${fileCount} input file(s) in ${localOutputDir}`);
  for (const [name, content] of Object.entries(data.inputFiles)) {
    await writeFile(join(localOutputDir, name), content, 'utf-8');
    console.log(`[worker]   wrote ${name} (${content.length} bytes)`);
  }

  // Replace the remote outputDir path in dockerArgs with local path
  const remoteDir = data.outputDir;
  const patchedArgs = data.dockerArgs.map((arg) =>
    arg.includes(remoteDir) ? arg.replace(remoteDir, localOutputDir) : arg,
  );
  console.log(`[worker] Patched outputDir: ${remoteDir} → ${localOutputDir}`);

  return { localOutputDir, patchedArgs };
}

/** Collect all files from outputDir after docker run completes. */
async function collectOutputFiles(outputDir: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  try {
    const entries = await readdir(outputDir);
    for (const entry of entries) {
      try {
        const content = await readFile(join(outputDir, entry), 'utf-8');
        files[entry] = content;
      } catch (err) {
        console.warn(`[worker] Skipping unreadable output file '${entry}': ${err instanceof Error ? err.message : err}`);
      }
    }
  } catch (err) {
    console.warn(`[worker] Could not read outputDir '${outputDir}': ${err instanceof Error ? err.message : err}`);
  }
  return files;
}

async function processDockerJob(rawData: unknown): Promise<DockerJobResult> {
  const data = DockerJobDataSchema.parse(rawData);
  const logFile = data.logFile;
  const hasInputFiles = data.inputFiles && Object.keys(data.inputFiles).length > 0;

  // Lazy image build: ensure Docker image exists before running container
  if (data.imageBuild) {
    await ensureImage(data.imageBuild);
  }

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

    // Stream stdout lines to log file in realtime
    let stdoutBuffer = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk);

      if (logFile && logDirReady) {
        stdoutBuffer += chunk.toString('utf-8');
        const lines = stdoutBuffer.split('\n');
        stdoutBuffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed) {
            logDirReady.then(() =>
              appendFile(logFile, trimmed + '\n'),
            ).catch(() => {});
          }
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

      const stdout = Buffer.concat(stdoutChunks).toString('utf-8');
      const stderr = Buffer.concat(stderrChunks).toString('utf-8');

      // Flush remaining buffer to log
      if (logFile && logDirReady && stdoutBuffer.trim()) {
        logDirReady.then(() =>
          appendFile(logFile, stdoutBuffer.trim() + '\n'),
        ).catch(() => {});
      }

      // If remote caller sent inputFiles, collect output files to return through Redis
      if (hasInputFiles) {
        collectOutputFiles(localOutputDir).then((outputFiles) => {
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

const connection = getRedisConnection();

const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const label = `${job.data.processInstanceId}/${job.data.stepId}`;
    console.log(`[worker] Processing job ${job.id} (${label})`);

    const result = await processDockerJob(job.data);

    const exitInfo = result.signal
      ? `signal ${result.signal}`
      : `exit ${result.exitCode}`;
    console.log(`[worker] Job ${job.id} done (${exitInfo})`);

    return result;
  },
  {
    connection,
    concurrency: 4,
  },
);

worker.on('ready', () => {
  console.log(`[worker] Ready — listening on queue '${QUEUE_NAME}'`);
});

worker.on('failed', (job, error) => {
  console.error(`[worker] Job ${job?.id} failed:`, error.message);
});

// Graceful shutdown
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    console.log(`[worker] ${sig} received — shutting down`);
    await worker.close();
    process.exit(0);
  });
}
