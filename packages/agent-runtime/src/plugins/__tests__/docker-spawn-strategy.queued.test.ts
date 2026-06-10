/**
 * QueuedDockerSpawnStrategy ships outputDir contents through Redis (JSON) to a
 * remote worker and writes the worker's output files back. These tests pin the
 * wire format: base64 values keyed by POSIX relative paths, so binary files and
 * nested directories survive the round-trip exactly like on the local path.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { QueuedDockerSpawnStrategy } from '../docker-spawn-strategy';
import type { DockerSpawnRequest } from '../docker-spawn-strategy';
import { enqueueDockerJob } from '@mediforce/container-worker';
import type { DockerJobData, DockerJobResult } from '@mediforce/container-worker';

vi.mock('@mediforce/container-worker', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mediforce/container-worker')>();
  return { ...actual, enqueueDockerJob: vi.fn() };
});

const mockEnqueue = vi.mocked(enqueueDockerJob);

/** Every possible byte value — catches any lossy text-encoding round-trip. */
const allBytes = Buffer.from(Array.from({ length: 256 }, (_, index) => index));

function buildRequest(outputDir: string): DockerSpawnRequest {
  return {
    dockerArgs: ['run', '--rm', 'test-image'],
    stdinPayload: null,
    timeoutMs: 1_000,
    containerName: 'test-container',
    processInstanceId: 'pi-1',
    stepId: 'step-1',
    outputDir,
    logFile: null,
  };
}

function buildResult(overrides: Partial<DockerJobResult> = {}): DockerJobResult {
  return { stdout: '', stderr: '', exitCode: 0, signal: null, ...overrides };
}

describe('QueuedDockerSpawnStrategy file transport', () => {
  let outputDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    outputDir = await mkdtemp(join(tmpdir(), 'queued-strategy-'));
  });

  afterEach(async () => {
    await rm(outputDir, { recursive: true, force: true });
  });

  it('sends binary and nested input files as base64 with POSIX relative-path keys', async () => {
    await writeFile(join(outputDir, 'input.pdf'), allBytes);
    await mkdir(join(outputDir, 'data', 'raw'), { recursive: true });
    await writeFile(join(outputDir, 'data', 'raw', 'samples.bin'), allBytes);
    mockEnqueue.mockResolvedValue(buildResult());

    await new QueuedDockerSpawnStrategy().spawn(buildRequest(outputDir));

    expect(mockEnqueue).toHaveBeenCalledTimes(1);
    const jobData: DockerJobData = mockEnqueue.mock.calls[0][0];
    expect(Object.keys(jobData.inputFiles ?? {}).sort()).toEqual(['data/raw/samples.bin', 'input.pdf']);
    expect(Buffer.from(jobData.inputFiles!['input.pdf'], 'base64').equals(allBytes)).toBe(true);
    expect(Buffer.from(jobData.inputFiles!['data/raw/samples.bin'], 'base64').equals(allBytes)).toBe(true);
  });

  it('writes returned base64 output files back byte-for-byte, recreating nested directories', async () => {
    mockEnqueue.mockResolvedValue(
      buildResult({
        outputFiles: {
          'report.xlsx': allBytes.toString('base64'),
          'charts/q1/plot.png': allBytes.toString('base64'),
        },
      }),
    );

    await new QueuedDockerSpawnStrategy().spawn(buildRequest(outputDir));

    const restoredReport = await readFile(join(outputDir, 'report.xlsx'));
    expect(restoredReport.equals(allBytes)).toBe(true);
    const restoredPlot = await readFile(join(outputDir, 'charts', 'q1', 'plot.png'));
    expect(restoredPlot.equals(allBytes)).toBe(true);
  });

  it('returns the worker result unchanged', async () => {
    mockEnqueue.mockResolvedValue(buildResult({ stdout: 'hello\n', exitCode: 3 }));

    const result = await new QueuedDockerSpawnStrategy().spawn(buildRequest(outputDir));

    expect(result.stdout).toBe('hello\n');
    expect(result.exitCode).toBe(3);
    expect(result.signal).toBeNull();
  });
});
