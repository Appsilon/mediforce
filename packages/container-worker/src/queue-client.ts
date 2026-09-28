import type { Queue, QueueEvents } from 'bullmq';
import { getRedisConnection } from './connection';
import { QUEUE_NAME, DockerJobResultSchema } from './schemas';
import type { DockerJobData, DockerJobResult } from './schemas';
import { deleteJobPayloads, offloadJobPayload, restoreResultPayload } from './file-payload-store';

let sharedQueue: Queue | null = null;
let sharedQueueEvents: QueueEvents | null = null;

async function getQueue(): Promise<Queue> {
  if (!sharedQueue) {
    const { Queue } = await import('bullmq');
    sharedQueue = new Queue(QUEUE_NAME, {
      connection: getRedisConnection(),
      // Bulk payloads travel beside the job (file-payload-store.ts), so a
      // retained job is small — but it is retained in the hash and again in
      // the `completed` event, so keep only enough to debug the last few runs.
      defaultJobOptions: {
        removeOnComplete: { count: 10, age: 3600 },
        removeOnFail: { count: 20, age: 86_400 },
      },
      streams: { events: { maxLen: 100 } },
    });
  }
  return sharedQueue;
}

async function getQueueEvents(): Promise<QueueEvents> {
  if (!sharedQueueEvents) {
    const { QueueEvents } = await import('bullmq');
    sharedQueueEvents = new QueueEvents(QUEUE_NAME, {
      connection: getRedisConnection(),
    });
  }
  return sharedQueueEvents;
}

/**
 * Ceiling on one job's serialized data. Files and an oversized prompt already
 * travel under their own keys, so nothing legitimate comes near this — it is
 * the backstop that turns a pathological payload into one failed step instead
 * of a Redis that fills, stops accepting writes, and takes every run with it.
 */
export const JOB_DATA_MAX_BYTES = 256 * 1024;

/**
 * Enqueue a Docker job and wait for the worker to complete it.
 *
 * Uses BullMQ's `waitUntilFinished` so callers get a simple Promise<DockerJobResult>
 * — the async queue is invisible to consuming code.
 */
export async function enqueueDockerJob(data: DockerJobData): Promise<DockerJobResult> {
  const queue = await getQueue();
  const queueEvents = await getQueueEvents();

  const jobId = `${data.processInstanceId}:${data.stepId}:${Date.now()}`;
  // The caller stops waiting after this long, so nothing reads the files later.
  const waitTtlMs = data.timeoutMs + 60_000;
  const client = await queue.client;

  try {
    const jobData = await offloadJobPayload(
      client,
      jobId,
      { ...data, payloadKeysSupported: true },
      Math.ceil(waitTtlMs / 1000) + 60,
    );

    const jobDataBytes = Buffer.byteLength(JSON.stringify(jobData), 'utf-8');
    if (jobDataBytes > JOB_DATA_MAX_BYTES) {
      throw new Error(
        `Job ${jobId} is too large for the job queue: ${String(jobDataBytes)} bytes against a ${String(JOB_DATA_MAX_BYTES)}-byte limit. ` +
          'Workspace files and the prompt already travel outside the job, so something else in the job data is oversized.',
      );
    }

    const job = await queue.add('docker-run', jobData, {
      jobId,
    });

    // waitUntilFinished resolves with the job's return value or rejects on failure.
    // The ttl ensures we don't wait forever if the worker dies.
    const rawResult = await job.waitUntilFinished(queueEvents, waitTtlMs);

    return await restoreResultPayload(client, DockerJobResultSchema.parse(rawResult));
  } finally {
    await deleteJobPayloads(client, jobId);
  }
}

/** Graceful shutdown — close shared connections. */
export async function closeQueueClient(): Promise<void> {
  await sharedQueueEvents?.close();
  await sharedQueue?.close();
  sharedQueueEvents = null;
  sharedQueue = null;
}
