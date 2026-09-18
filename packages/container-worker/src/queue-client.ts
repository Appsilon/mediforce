import type { Queue, QueueEvents } from 'bullmq';
import { getRedisConnection } from './connection';
import { QUEUE_NAME, DockerJobResultSchema } from './schemas';
import type { DockerJobData, DockerJobResult } from './schemas';
import { deleteJobFiles, offloadInputFiles, restoreOutputFiles } from './file-payload-store';

let sharedQueue: Queue | null = null;
let sharedQueueEvents: QueueEvents | null = null;

async function getQueue(): Promise<Queue> {
  if (!sharedQueue) {
    const { Queue } = await import('bullmq');
    sharedQueue = new Queue(QUEUE_NAME, {
      connection: getRedisConnection(),
      // Workspace files travel beside the job (file-payload-store.ts), but
      // stdout/stderr still sit in every return value and `completed` event.
      // Retain only enough history to debug the last few runs.
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
    const jobData = await offloadInputFiles(client, jobId, data, Math.ceil(waitTtlMs / 1000) + 60);
    const job = await queue.add('docker-run', jobData, {
      jobId,
    });

    // waitUntilFinished resolves with the job's return value or rejects on failure.
    // The ttl ensures we don't wait forever if the worker dies.
    const rawResult = await job.waitUntilFinished(queueEvents, waitTtlMs);

    return await restoreOutputFiles(client, DockerJobResultSchema.parse(rawResult));
  } finally {
    await deleteJobFiles(client, jobId);
  }
}

/** Graceful shutdown — close shared connections. */
export async function closeQueueClient(): Promise<void> {
  await sharedQueueEvents?.close();
  await sharedQueue?.close();
  sharedQueueEvents = null;
  sharedQueue = null;
}
