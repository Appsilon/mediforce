import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { DockerJobData } from '../schemas';

const addMock = vi.fn();
const waitUntilFinishedMock = vi.fn();

vi.mock('bullmq', () => ({
  Queue: class {
    add = addMock;
    close = vi.fn();
  },
  QueueEvents: class {
    close = vi.fn();
  },
}));

const jobData: DockerJobData = {
  jobType: 'script-container',
  dockerArgs: ['run', '--rm', 'mediforce-built:abc123'],
  stdinPayload: null,
  timeoutMs: 600_000,
  containerName: 'step-fetch-documents',
  processInstanceId: '6d4a144f-b2dd-468f-85cf-de1d88cab1ef',
  stepId: 'fetch-documents',
  outputDir: '/tmp/output',
  logFile: null,
};

beforeEach(() => {
  process.env.REDIS_URL = 'redis://user:pass@redis:6379';
  addMock.mockReset();
  waitUntilFinishedMock.mockReset();
});

afterEach(async () => {
  const { closeQueueClient } = await import('../queue-client');
  await closeQueueClient();
  vi.useRealTimers();
  vi.resetModules();
});

describe('enqueueDockerJob', () => {
  it('rejects with a queue-specific error when Redis is unreachable', async () => {
    // What ioredis throws once the offline queue is disabled and the socket is down.
    addMock.mockRejectedValue(
      new Error("Stream isn't writeable and enableOfflineQueue options is false"),
    );

    const { enqueueDockerJob } = await import('../queue-client');

    await expect(enqueueDockerJob(jobData)).rejects.toThrow(/container queue unavailable/i);
  });

  it('names the step in the dispatch failure so the run is traceable', async () => {
    addMock.mockRejectedValue(new Error('getaddrinfo EAI_AGAIN redis'));

    const { enqueueDockerJob } = await import('../queue-client');

    await expect(enqueueDockerJob(jobData)).rejects.toThrow(/fetch-documents/);
  });

  // BullMQ's `add` awaits a connection promise that settles only on 'ready' or
  // 'end', and its default retry strategy never gives up — so an unreachable
  // Redis leaves `add` pending forever rather than rejecting. That is the shape
  // that produced a silent 600s step timeout instead of a queue error.
  it('rejects rather than hanging when the queue never accepts the job', async () => {
    vi.useFakeTimers();
    addMock.mockReturnValue(new Promise(() => {}));

    const { enqueueDockerJob } = await import('../queue-client');
    const pending = enqueueDockerJob(jobData);
    const assertion = expect(pending).rejects.toThrow(/container queue unavailable/i);

    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
  });

  it('resolves the worker result when the queue is healthy', async () => {
    const workerResult = {
      stdout: 'downloaded 2 document(s)',
      stderr: '',
      exitCode: 0,
      signal: null,
      outputFiles: {},
    };
    addMock.mockResolvedValue({ waitUntilFinished: waitUntilFinishedMock });
    waitUntilFinishedMock.mockResolvedValue(workerResult);

    const { enqueueDockerJob } = await import('../queue-client');

    await expect(enqueueDockerJob(jobData)).resolves.toEqual(workerResult);
  });
});
