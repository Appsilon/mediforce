/**
 * processDockerJob must clear a stale container holding the target name before
 * spawning `docker run`, or a retried job hits `Conflict. The container name
 * "…" is already in use` (exit 125). This pins the call order.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChildProcess } from 'node:child_process';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

vi.mock('../docker-cleanup', () => ({
  removeStaleContainer: vi.fn(),
}));

vi.mock('../docker-image-builder', () => ({
  ensureImage: vi.fn(),
}));

import { spawn } from 'node:child_process';
import { removeStaleContainer } from '../docker-cleanup';
import { ensureImage } from '../docker-image-builder';
import { processDockerJob } from '../job-processor';
import type { DockerJobData } from '../schemas';

const mockSpawn = vi.mocked(spawn);
const mockRemoveStaleContainer = vi.mocked(removeStaleContainer);
const mockEnsureImage = vi.mocked(ensureImage);

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
    lineFormat: 'none',
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

describe('realtime activity log', () => {
  let logDir: string;

  beforeEach(async () => {
    logDir = await mkdtemp(join(tmpdir(), 'worker-log-'));
  });

  afterEach(async () => {
    await rm(logDir, { recursive: true, force: true });
  });

  /**
   * The worker is the only process watching the container while it runs — the
   * orchestrator is blocked on the queue. If it writes raw lines, the UI has
   * nothing it can render until the job ends and the whole log lands at once.
   */
  it('writes formatted entries while the container is still running', async () => {
    const child = buildFakeChild();
    mockSpawn.mockReturnValue(child as never);

    const logFile = join(logDir, 'step.log');
    const resultPromise = processDockerJob({
      ...buildJobData(),
      logFile,
      lineFormat: 'claude-stream-json',
    });
    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalled());

    child.stdout!.emit('data', Buffer.from(JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'ls' } }] },
    }) + '\n'));

    // Read before `close` — this is the assertion that matters.
    await vi.waitFor(async () => {
      const written = await readFile(logFile, 'utf-8');
      expect(JSON.parse(written.trim())).toMatchObject({
        type: 'assistant',
        subtype: 'tool_call',
        tool: 'Bash',
      });
    });

    child.emit('close', 0, null);
    await resultPromise;
  });

  it('writes nothing for a job that declares no line format', async () => {
    const child = buildFakeChild();
    mockSpawn.mockReturnValue(child as never);

    const logFile = join(logDir, 'step.log');
    const resultPromise = processDockerJob({ ...buildJobData(), logFile });
    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalled());

    child.stdout!.emit('data', Buffer.from('plain container noise\n'));
    child.emit('close', 0, null);
    await resultPromise;

    await expect(readFile(logFile, 'utf-8')).rejects.toThrow();
  });
});

describe('image build narration', () => {
  let logDir: string;

  beforeEach(async () => {
    logDir = await mkdtemp(join(tmpdir(), 'worker-build-log-'));
  });

  afterEach(async () => {
    await rm(logDir, { recursive: true, force: true });
  });

  /**
   * A cold build is minutes during which no container exists, so nothing can
   * emit anything and the step reads as hung. The stage entries have to land
   * while the build is still running, not after it.
   */
  it('records the build before it starts, not after it finishes', async () => {
    const logFile = join(logDir, 'step.log');
    let sawEntryDuringBuild: unknown = null;
    mockEnsureImage.mockImplementation(async () => {
      sawEntryDuringBuild = JSON.parse((await readFile(logFile, 'utf-8')).trim());
    });

    await processDockerJob({
      ...buildJobData(),
      jobType: 'build-image',
      logFile,
      imageBuild: { image: 'acme:1' },
    });

    expect(sawEntryDuringBuild).toMatchObject({ type: 'stage', text: expect.stringContaining('acme:1') });
    const lines = (await readFile(logFile, 'utf-8')).trim().split('\n').map((l) => JSON.parse(l));
    expect(lines.map((l) => l.text)).toEqual([
      'Preparing container image acme:1',
      'Container image ready',
    ]);
  });

  it('records a build failure instead of leaving the log empty', async () => {
    const logFile = join(logDir, 'step.log');
    mockEnsureImage.mockRejectedValue(new Error('no space left on device'));

    await expect(processDockerJob({
      ...buildJobData(),
      jobType: 'build-image',
      logFile,
      imageBuild: { image: 'acme:1' },
    })).rejects.toThrow('no space left on device');

    const lines = (await readFile(logFile, 'utf-8')).trim().split('\n').map((l) => JSON.parse(l));
    expect(lines[lines.length - 1].text).toContain('no space left on device');
  });
});
