/**
 * LocalDockerSpawnStrategy must clear a stale container holding the target name
 * before spawning `docker run`, or a retried step hits `Conflict. The container
 * name "…" is already in use` (exit 125). This pins the call order.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

vi.mock('@mediforce/container-worker', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mediforce/container-worker')>();
  return { ...actual, removeStaleContainer: vi.fn() };
});

import { spawn } from 'node:child_process';
import { removeStaleContainer } from '@mediforce/container-worker';
import { LocalDockerSpawnStrategy } from '../docker-spawn-strategy';
import type { DockerSpawnRequest } from '../docker-spawn-strategy';

const mockSpawn = vi.mocked(spawn);
const mockRemoveStaleContainer = vi.mocked(removeStaleContainer);

function buildRequest(): DockerSpawnRequest {
  return {
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

describe('LocalDockerSpawnStrategy', () => {
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

    const request = buildRequest();
    const resultPromise = new LocalDockerSpawnStrategy().spawn(request);
    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalled());
    child.emit('close', 0, null);
    await resultPromise;

    expect(callOrder).toEqual(['rm', 'run']);
    expect(mockRemoveStaleContainer).toHaveBeenCalledWith('test-container');
    expect(mockSpawn).toHaveBeenCalledWith('docker', request.dockerArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
  });
});
