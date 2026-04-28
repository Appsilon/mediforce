import type { Queue, QueueEvents } from 'bullmq';
import { getRedisConnection } from './connection.js';
import { QUEUE_NAME, DockerJobResultSchema } from './schemas.js';
import type { DockerJobData, DockerJobResult } from './schemas.js';

let sharedQueue: Queue | null = null;
let sharedQueueEvents: QueueEvents | null = null;

async function getQueue(): Promise<Queue> {
  if (!sharedQueue) {
    const { Queue } = await import('bullmq');
    sharedQueue = new Queue(QUEUE_NAME, {
      connection: getRedisConnection(),
      defaultJobOptions: {
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 200 },
      },
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
 * Enqueue a Docker job and wait for the worker to complete it.
 *
 * Uses BullMQ's `waitUntilFinished` so callers get a simple Promise<DockerJobResult>
 * — the async queue is invisible to consuming code.
 */
export async function enqueueDockerJob(data: DockerJobData): Promise<DockerJobResult> {
  const queue = await getQueue();
  const queueEvents = await getQueueEvents();

  const jobId = `${data.processInstanceId}:${data.stepId}:${Date.now()}`;

  const job = await queue.add('docker-run', data, {
    jobId,
  });

  // waitUntilFinished resolves with the job's return value or rejects on failure.
  // The ttl ensures we don't wait forever if the worker dies.
  const rawResult = await job.waitUntilFinished(queueEvents, data.timeoutMs + 60_000);

  return DockerJobResultSchema.parse(rawResult);
}

/** Graceful shutdown — close shared connections. */
export async function closeQueueClient(): Promise<void> {
  await sharedQueueEvents?.close();
  await sharedQueue?.close();
  sharedQueueEvents = null;
  sharedQueue = null;
}
