import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

import { spawn } from 'node:child_process';
import { removeStaleContainer } from '../docker-cleanup';

const mockSpawn = vi.mocked(spawn);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('removeStaleContainer', () => {
  it('spawns docker rm -f with the given container name', async () => {
    const child = new EventEmitter();
    mockSpawn.mockReturnValue(child as never);

    const promise = removeStaleContainer('mediforce-pi-1-step-1');
    child.emit('close', 0);
    await promise;

    expect(mockSpawn).toHaveBeenCalledWith('docker', ['rm', '-f', 'mediforce-pi-1-step-1'], { stdio: 'ignore' });
  });

  it('resolves on close regardless of exit code', async () => {
    const child = new EventEmitter();
    mockSpawn.mockReturnValue(child as never);

    const promise = removeStaleContainer('missing-container');
    child.emit('close', 1);

    await expect(promise).resolves.toBeUndefined();
  });

  it('resolves on error instead of rejecting (best-effort)', async () => {
    const child = new EventEmitter();
    mockSpawn.mockReturnValue(child as never);

    const promise = removeStaleContainer('any-name');
    child.emit('error', new Error('docker not found'));

    await expect(promise).resolves.toBeUndefined();
  });
});
