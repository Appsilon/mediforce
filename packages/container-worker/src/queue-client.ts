import type { Queue, QueueEvents } from 'bullmq';
import { getRedisConnection } from './connection';
import { QUEUE_NAME, DockerJobResultSchema } from './schemas';
import type { DockerJobData, DockerJobResult } from './schemas';

let sharedQueue: Queue | null = null;
let sharedQueueEvents: QueueEvents | null = null;

/**
 * A job either enters Redis promptly or the queue is not usable. Bounding the
 * dispatch is what makes that distinction observable: `queue.add` first awaits
 * BullMQ's connection promise, which settles only on 'ready' or 'end', and
 * BullMQ's default retry strategy never gives up. A Redis that is unreachable
 * when the Queue is first constructed therefore leaves `add` pending forever
 * — `enableOfflineQueue: false` never gets a say, because the command is never
 * dispatched. Without this deadline the caller waits on a job that was never
 * queued until its step timeout fires, reporting an outage as a script timeout.
 */
const DISPATCH_TIMEOUT_MS = 10_000;

async function withDeadline<T>(work: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} did not settle within ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

async function getQueue(): Promise<Queue> {
  if (!sharedQueue) {
    const { Queue } = await import('bullmq');
    sharedQueue = new Queue(QUEUE_NAME, {
      // enableOfflineQueue: false covers the flapping case: once the
      // connection has been ready, a command issued while it is down rejects
      // instead of being buffered. It does NOT cover a Redis that was already
      // down when the Queue was constructed — see withDeadline above, which
      // is what bounds that path.
      connection: { ...getRedisConnection(), enableOfflineQueue: false },
      // Retention is bounded by age as well as count because job payloads carry
      // base64 file contents — a few hundred retained jobs is enough to outgrow
      // a modest Redis memory cap and get the server OOM-killed mid-run.
      defaultJobOptions: {
        removeOnComplete: { count: 20, age: 60 * 60 },
        removeOnFail: { count: 50, age: 24 * 60 * 60 },
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

  let job: Awaited<ReturnType<Queue['add']>>;
  try {
    job = await withDeadline(
      queue.add('docker-run', data, { jobId }),
      DISPATCH_TIMEOUT_MS,
      'queue.add',
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Container queue unavailable — could not dispatch '${data.stepId}' (job ${jobId}) to Redis: ${reason}`,
      { cause: error },
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
