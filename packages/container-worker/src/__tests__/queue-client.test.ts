/**
 * Redis is transport for container jobs, not their history. An unbounded queue
 * took production down: retained job hashes and BullMQ's 10,000-entry event
 * stream grew past the container's memory limit, Redis was OOM-killed mid-RDB
 * and started refusing writes. These pin the two bounds that prevent it — what
 * the queue retains, and how large a single job may be.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DockerJobData } from '../schemas';

const queueConstructed = vi.fn<(name: string, options: Record<string, unknown>) => void>();
const jobAdded = vi.fn<(name: string, data: DockerJobData) => void>();

vi.mock('bullmq', () => {
  const redis = new Map<string, string>();
  return {
    Queue: class {
      client = Promise.resolve({
        get: async (key: string) => redis.get(key) ?? null,
        set: async (key: string, value: string) => {
          redis.set(key, value);
          return 'OK';
        },
        del: async (...keys: string[]) => keys.filter((key) => redis.delete(key)).length,
      });
      constructor(name: string, options: Record<string, unknown>) {
        queueConstructed(name, options);
      }
      async add(name: string, data: DockerJobData) {
        jobAdded(name, data);
        return {
          waitUntilFinished: async () => ({ stdout: 'done', stderr: '', exitCode: 0, signal: null }),
        };
      }
      async close() {}
    },
    QueueEvents: class {
      async close() {}
    },
  };
});

function buildJobData(overrides: Partial<DockerJobData> = {}): DockerJobData {
  return {
    jobType: 'agent-container',
    dockerArgs: ['run', '--rm', 'test-image'],
    stdinPayload: null,
    timeoutMs: 60_000,
    containerName: 'test-container',
    processInstanceId: 'pi-1',
    stepId: 'step-1',
    outputDir: '/tmp/out',
    logFile: null,
    ...overrides,
  };
}

async function loadQueueClient() {
  vi.resetModules();
  return import('../queue-client');
}

beforeEach(() => {
  process.env.REDIS_URL = 'redis://localhost:6379';
  queueConstructed.mockClear();
  jobAdded.mockClear();
});

describe('queue client', () => {
  it('bounds what Redis retains — finished jobs by age and count, events by length', async () => {
    const { enqueueDockerJob, closeQueueClient } = await loadQueueClient();
    await enqueueDockerJob(buildJobData());

    expect(queueConstructed).toHaveBeenCalledOnce();
    const [, options] = queueConstructed.mock.calls[0];
    expect(options).toMatchObject({
      defaultJobOptions: {
        removeOnComplete: { count: 10, age: 3600 },
        removeOnFail: { count: 20, age: 86_400 },
      },
      streams: { events: { maxLen: 100 } },
    });

    await closeQueueClient();
  });

  it('rejects a job whose data is too large to belong in Redis, before it is enqueued', async () => {
    const { enqueueDockerJob, JOB_DATA_MAX_BYTES, closeQueueClient } = await loadQueueClient();
    const oversizedArg = 'x'.repeat(JOB_DATA_MAX_BYTES + 1);

    await expect(enqueueDockerJob(buildJobData({ dockerArgs: [oversizedArg] }))).rejects.toThrow(
      /too large for the job queue/,
    );
    expect(jobAdded).not.toHaveBeenCalled();

    await closeQueueClient();
  });

  it('enqueues an oversized prompt by key instead of rejecting it', async () => {
    const { enqueueDockerJob, JOB_DATA_MAX_BYTES, closeQueueClient } = await loadQueueClient();
    const longPrompt = 'x'.repeat(JOB_DATA_MAX_BYTES + 1);

    await enqueueDockerJob(buildJobData({ stdinPayload: longPrompt }));

    expect(jobAdded).toHaveBeenCalledOnce();
    const [, enqueued] = jobAdded.mock.calls[0];
    expect(enqueued.stdinPayload).toBeNull();
    expect(enqueued.stdinPayloadKey).toBeDefined();
    expect(enqueued.payloadKeysSupported).toBe(true);

    await closeQueueClient();
  });
});
