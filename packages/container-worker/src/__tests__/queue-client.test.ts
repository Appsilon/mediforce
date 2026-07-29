import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { DockerJobData } from '../schemas';

const addMock = vi.fn();
const waitUntilFinishedMock = vi.fn();
const queueOptions: Array<Record<string, unknown>> = [];

vi.mock('bullmq', () => ({
  Queue: class {
    add = addMock;
    close = vi.fn();
    constructor(_name: string, options: Record<string, unknown>) {
      queueOptions.push(options);
    }
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
  queueOptions.length = 0;
  addMock.mockReset();
  waitUntilFinishedMock.mockReset();
});

afterEach(async () => {
  const { closeQueueClient } = await import('../queue-client');
  await closeQueueClient();
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

  it('disables the offline queue so a dead Redis fails fast instead of buffering', async () => {
    addMock.mockResolvedValue({ waitUntilFinished: waitUntilFinishedMock });
    waitUntilFinishedMock.mockResolvedValue({
      stdout: '',
      stderr: '',
      exitCode: 0,
      signal: null,
      outputFiles: {},
    });

    const { enqueueDockerJob } = await import('../queue-client');
    await enqueueDockerJob(jobData);

    const connection = queueOptions[0]?.connection as Record<string, unknown>;
    expect(connection.enableOfflineQueue).toBe(false);
  });

  it('bounds retained jobs so queue payloads cannot grow the dataset unchecked', async () => {
    addMock.mockResolvedValue({ waitUntilFinished: waitUntilFinishedMock });
    waitUntilFinishedMock.mockResolvedValue({
      stdout: '',
      stderr: '',
      exitCode: 0,
      signal: null,
      outputFiles: {},
    });

    const { enqueueDockerJob } = await import('../queue-client');
    await enqueueDockerJob(jobData);

    const defaults = queueOptions[0]?.defaultJobOptions as {
      removeOnComplete: { count: number; age: number };
      removeOnFail: { count: number; age: number };
    };
    expect(defaults.removeOnComplete.age).toBeGreaterThan(0);
    expect(defaults.removeOnFail.age).toBeGreaterThan(0);
  });
});
