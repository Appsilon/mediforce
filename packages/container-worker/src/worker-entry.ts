/**
 * Standalone worker process — picks Docker jobs from BullMQ and executes them.
 *
 * Start with: REDIS_URL=redis://localhost:6379 tsx packages/container-worker/src/worker-entry.ts
 */
import { Worker } from 'bullmq';
import { getRedisConnection } from './connection';
import { DockerJobDataSchema, QUEUE_NAME } from './schemas';
import { offloadOutputFiles, restoreInputFiles } from './file-payload-store';
import { startHttpServer } from './http-server';
import { processDockerJob } from './job-processor';

const connection = getRedisConnection();
// The caller reads output files the moment the job completes and then deletes
// them; this only bounds a caller that died while waiting.
const OUTPUT_FILES_TTL_SECONDS = 3600;

const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const label = `${job.data.processInstanceId}/${job.data.stepId}`;
    console.log(`[worker] Processing job ${job.id} (${label})`);

    if (job.id === undefined) throw new Error(`Job for ${label} has no id`);
    const client = await worker.client;
    const data = DockerJobDataSchema.parse(job.data);
    const processed = await processDockerJob(await restoreInputFiles(client, data));
    const result = await offloadOutputFiles(client, job.id, data, processed, OUTPUT_FILES_TTL_SECONDS);

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
