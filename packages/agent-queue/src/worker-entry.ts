/**
 * Standalone worker process — picks Docker jobs from BullMQ and executes them.
 *
 * Start with: REDIS_URL=redis://localhost:6379 tsx packages/agent-queue/src/worker-entry.ts
 */
import { Worker } from 'bullmq';
import { spawn } from 'node:child_process';
import { getRedisConnection } from './connection.js';
import { QUEUE_NAME, DockerJobDataSchema } from './schemas.js';
import type { DockerJobResult } from './schemas.js';

function processDockerJob(rawData: unknown): Promise<DockerJobResult> {
  const data = DockerJobDataSchema.parse(rawData);

  return new Promise<DockerJobResult>((resolve, reject) => {
    const child = spawn('docker', data.dockerArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let settled = false;
    let containerId: string | null = null;

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

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk);
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

      resolve({
        stdout,
        stderr,
        exitCode: code,
        signal: signal ?? null,
      });
    });

    if (data.stdinPayload !== null) {
      child.stdin.write(data.stdinPayload);
    }
    child.stdin.end();
  });
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
