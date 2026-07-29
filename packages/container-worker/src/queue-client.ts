import type { Queue, QueueEvents } from 'bullmq';
import { getRedisConnection } from './connection';
import { QUEUE_NAME, DockerJobResultSchema } from './schemas';
import type { DockerJobData, DockerJobResult } from './schemas';

let sharedQueue: Queue | null = null;
let sharedQueueEvents: QueueEvents | null = null;

/**
 * Retention is bounded by age as well as count because job payloads carry
 * base64 file contents — a few hundred retained jobs is enough to outgrow a
 * modest Redis memory cap and get the server OOM-killed mid-run.
 */
const JOB_RETENTION = {
  removeOnComplete: { count: 20, age: 60 * 60 },
  removeOnFail: { count: 50, age: 24 * 60 * 60 },
} as const;

async function getQueue(): Promise<Queue> {
  if (!sharedQueue) {
    const { Queue } = await import('bullmq');
    sharedQueue = new Queue(QUEUE_NAME, {
      // enableOfflineQueue: false makes `add` reject the moment Redis is
      // unreachable. Buffering instead leaves the caller waiting on a job that
      // was never dispatched until its step timeout fires, which reports the
      // outage as "script execution timed out" with no error attached.
      connection: { ...getRedisConnection(), enableOfflineQueue: false },
      defaultJobOptions: { ...JOB_RETENTION },
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

  let job: Awaited<ReturnType<Queue['add']>>;
  try {
    job = await queue.add('docker-run', data, { jobId });
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Container queue unavailable — could not dispatch '${data.stepId}' (job ${jobId}) to Redis: ${cause}`,
    );
  }

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
