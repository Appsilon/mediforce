/**
 * Workspace files must travel beside a BullMQ job, not inside it: whatever sits
 * in job data or a return value is retained by BullMQ (job hash, events stream)
 * and filled a 256 MiB Redis. This pins the round trip caller → worker → caller.
 */
import { describe, it, expect } from 'vitest';
import {
  deleteJobFiles,
  offloadInputFiles,
  offloadOutputFiles,
  restoreInputFiles,
  restoreOutputFiles,
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

function buildJobData(inputFiles: Record<string, string> | undefined): DockerJobData {
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
    inputFiles,
  };
}

const jobId = 'pi-1:step-1:1';
const inputFiles = { 'input.pdf': Buffer.from('input bytes').toString('base64') };
const outputFiles = { 'charts/plot.png': Buffer.from('output bytes').toString('base64') };

describe('file payload store', () => {
  it('carries files through Redis keys, never through the job data or return value', async () => {
    const client = buildInMemoryClient();

    const enqueued = await offloadInputFiles(client, jobId, buildJobData(inputFiles), 600);
    expect(enqueued.inputFiles).toBeUndefined();
    expect(enqueued.inputFilesKey).toBeDefined();
    expect(client.ttls.get(enqueued.inputFilesKey!)).toBe(600);

    const processed = await restoreInputFiles(client, enqueued);
    expect(processed.inputFiles).toEqual(inputFiles);

    const workerResult: DockerJobResult = { stdout: 'ok', stderr: '', exitCode: 0, signal: null, outputFiles };
    const returned = await offloadOutputFiles(client, jobId, enqueued, workerResult, 3600);
    expect(returned.outputFiles).toBeUndefined();
    expect(returned.outputFilesKey).toBeDefined();

    const received = await restoreOutputFiles(client, returned);
    expect(received).toEqual(workerResult);

    await deleteJobFiles(client, jobId);
    expect(client.store.size).toBe(0);
  });

  it('returns output files inline to a caller that sent its input files inline', async () => {
    const client = buildInMemoryClient();
    const legacyData = buildJobData(inputFiles);
    const workerResult: DockerJobResult = { stdout: '', stderr: '', exitCode: 0, signal: null, outputFiles };

    expect(await restoreInputFiles(client, legacyData)).toEqual(legacyData);
    expect(await offloadOutputFiles(client, jobId, legacyData, workerResult, 3600)).toEqual(workerResult);
    expect(client.store.size).toBe(0);
  });

  it('writes nothing to Redis for a job without files', async () => {
    const client = buildInMemoryClient();
    const data = buildJobData(undefined);

    expect(await offloadInputFiles(client, jobId, data, 600)).toEqual(data);
    expect(client.store.size).toBe(0);
  });

  it('fails loudly when the worker finds the input files gone', async () => {
    const client = buildInMemoryClient();
    const enqueued = await offloadInputFiles(client, jobId, buildJobData(inputFiles), 600);
    await deleteJobFiles(client, jobId);

    await expect(restoreInputFiles(client, enqueued)).rejects.toThrow(/missing from Redis/);
  });
});
