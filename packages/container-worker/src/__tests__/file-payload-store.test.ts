/**
 * Bulk payloads must travel beside a BullMQ job, not inside it: whatever sits
 * in job data or a return value is retained by BullMQ (job hash, events stream)
 * and filled a 256 MiB Redis. This pins the round trip caller → worker → caller
 * for both workspace files and oversized stdin/stdout/stderr.
 */
import { describe, it, expect } from 'vitest';
import {
  TEXT_INLINE_MAX_BYTES,
  deleteJobPayloads,
  offloadJobPayload,
  offloadResultPayload,
  restoreJobPayload,
  restoreResultPayload,
  type FilePayloadRedisClient,
} from '../file-payload-store';
import type { DockerJobData, DockerJobResult } from '../schemas';

function buildInMemoryClient(): FilePayloadRedisClient & { store: Map<string, string>; ttls: Map<string, number> } {
  const store = new Map<string, string>();
  const ttls = new Map<string, number>();
  return {
    store,
    ttls,
    async get(key) {
      return store.get(key) ?? null;
    },
    async set(key, value, options) {
      store.set(key, value);
      ttls.set(key, options.EX);
      return 'OK';
    },
    async del(...keys) {
      return keys.filter((key) => store.delete(key)).length;
    },
  };
}

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
    payloadKeysSupported: true,
    ...overrides,
  };
}

const jobId = 'pi-1:step-1:1';
const inputFiles = { 'input.pdf': Buffer.from('input bytes').toString('base64') };
const outputFiles = { 'charts/plot.png': Buffer.from('output bytes').toString('base64') };
const oversizedText = 'x'.repeat(TEXT_INLINE_MAX_BYTES + 1);

describe('job payload store', () => {
  it('carries files through Redis keys, never through the job data or return value', async () => {
    const client = buildInMemoryClient();

    const enqueued = await offloadJobPayload(client, jobId, buildJobData({ inputFiles }), 600);
    expect(enqueued.inputFiles).toBeUndefined();
    expect(enqueued.inputFilesKey).toBeDefined();
    expect(client.ttls.get(enqueued.inputFilesKey!)).toBe(600);

    const processed = await restoreJobPayload(client, enqueued);
    expect(processed.inputFiles).toEqual(inputFiles);

    const workerResult: DockerJobResult = { stdout: 'ok', stderr: '', exitCode: 0, signal: null, outputFiles };
    const returned = await offloadResultPayload(client, jobId, enqueued, workerResult, 3600);
    expect(returned.outputFiles).toBeUndefined();
    expect(returned.outputFilesKey).toBeDefined();

    const received = await restoreResultPayload(client, returned);
    expect(received).toEqual(workerResult);

    await deleteJobPayloads(client, jobId);
    expect(client.store.size).toBe(0);
  });

  it('returns output files inline to a caller that sent its input files inline', async () => {
    const client = buildInMemoryClient();
    const legacyData = buildJobData({ inputFiles, payloadKeysSupported: undefined });
    const workerResult: DockerJobResult = { stdout: '', stderr: '', exitCode: 0, signal: null, outputFiles };

    expect(await restoreJobPayload(client, legacyData)).toEqual(legacyData);
    expect(await offloadResultPayload(client, jobId, legacyData, workerResult, 3600)).toEqual(workerResult);
    expect(client.store.size).toBe(0);
  });

  it('writes nothing to Redis for a job without files or oversized text', async () => {
    const client = buildInMemoryClient();
    const data = buildJobData({ stdinPayload: 'short prompt' });

    expect(await offloadJobPayload(client, jobId, data, 600)).toEqual(data);
    expect(client.store.size).toBe(0);
  });

  it('fails loudly when the worker finds the input files gone', async () => {
    const client = buildInMemoryClient();
    const enqueued = await offloadJobPayload(client, jobId, buildJobData({ inputFiles }), 600);
    await deleteJobPayloads(client, jobId);

    await expect(restoreJobPayload(client, enqueued)).rejects.toThrow(/missing from Redis/);
  });

  it('carries an oversized prompt by key and hands the worker the whole thing back', async () => {
    const client = buildInMemoryClient();

    const enqueued = await offloadJobPayload(client, jobId, buildJobData({ stdinPayload: oversizedText }), 600);
    expect(enqueued.stdinPayload).toBeNull();
    expect(enqueued.stdinPayloadKey).toBeDefined();

    expect((await restoreJobPayload(client, enqueued)).stdinPayload).toBe(oversizedText);
  });

  it('carries oversized stdout and stderr by key and hands the caller the whole thing back', async () => {
    const client = buildInMemoryClient();
    const data = buildJobData();
    const workerResult: DockerJobResult = {
      stdout: oversizedText,
      stderr: oversizedText,
      exitCode: 0,
      signal: null,
    };

    const returned = await offloadResultPayload(client, jobId, data, workerResult, 3600);
    expect(returned.stdout).toBe('');
    expect(returned.stderr).toBe('');
    expect(returned.stdoutKey).toBeDefined();
    expect(returned.stderrKey).toBeDefined();

    expect(await restoreResultPayload(client, returned)).toEqual(workerResult);

    await deleteJobPayloads(client, jobId);
    expect(client.store.size).toBe(0);
  });

  it('keeps stdout inline for a caller that predates the result keys', async () => {
    const client = buildInMemoryClient();
    const legacyData = buildJobData({ payloadKeysSupported: undefined });
    const workerResult: DockerJobResult = { stdout: oversizedText, stderr: '', exitCode: 0, signal: null };

    expect(await offloadResultPayload(client, jobId, legacyData, workerResult, 3600)).toEqual(workerResult);
    expect(client.store.size).toBe(0);
  });
});
