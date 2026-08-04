/**
 * Standalone worker process — picks Docker jobs from BullMQ and executes them.
 *
 * Start with: REDIS_URL=redis://localhost:6379 tsx packages/container-worker/src/worker-entry.ts
 */
import { Worker } from 'bullmq';
import { getRedisConnection } from './connection';
import { QUEUE_NAME } from './schemas';
import { startHttpServer } from './http-server';
import { processDockerJob } from './job-processor';

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

const httpServer = startHttpServer();

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
    httpServer.close();
    await worker.close();
    process.exit(0);
  });
}
