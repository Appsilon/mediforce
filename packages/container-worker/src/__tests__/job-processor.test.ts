/**
 * processDockerJob must clear a stale container holding the target name before
 * spawning `docker run`, or a retried job hits `Conflict. The container name
 * "…" is already in use` (exit 125). This pins the call order.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

vi.mock('../docker-cleanup', () => ({
  removeStaleContainer: vi.fn(),
}));

import { spawn } from 'node:child_process';
import { removeStaleContainer } from '../docker-cleanup';
import { processDockerJob } from '../job-processor';
import type { DockerJobData } from '../schemas';

const mockSpawn = vi.mocked(spawn);
const mockRemoveStaleContainer = vi.mocked(removeStaleContainer);

function buildJobData(): DockerJobData {
  return {
    jobType: 'agent-container',
    dockerArgs: ['run', '--rm', '--name', 'test-container', 'test-image'],
    stdinPayload: null,
    timeoutMs: 60_000,
    containerName: 'test-container',
    processInstanceId: 'pi-1',
    stepId: 'step-1',
    outputDir: '/tmp/out',
    logFile: null,
  };
}

function buildFakeChild(): EventEmitter & Pick<ChildProcess, 'stdout' | 'stderr' | 'stdin'> {
  const child = new EventEmitter() as EventEmitter & Pick<ChildProcess, 'stdout' | 'stderr' | 'stdin'>;
  child.stdout = new EventEmitter() as never;
  child.stderr = new EventEmitter() as never;
  child.stdin = { write: vi.fn(), end: vi.fn() } as never;
  return child;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('processDockerJob', () => {
  it('removes any stale container before spawning docker run', async () => {
    const callOrder: string[] = [];
    mockRemoveStaleContainer.mockImplementation(async () => {
      callOrder.push('rm');
    });

    const child = buildFakeChild();
    mockSpawn.mockImplementation(() => {
      callOrder.push('run');
      return child as never;
    });

    const jobData = buildJobData();
    const resultPromise = processDockerJob(jobData);
    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalled());
    child.emit('close', 0, null);
    await resultPromise;

    expect(callOrder).toEqual(['rm', 'run']);
    expect(mockRemoveStaleContainer).toHaveBeenCalledWith('test-container');
    expect(mockSpawn).toHaveBeenCalledWith('docker', jobData.dockerArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
  });
});
