import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

vi.mock('../docker-image-builder.js', () => ({
  ensureImage: vi.fn().mockResolvedValue(undefined),
}));

import { spawn } from 'node:child_process';
import { LocalDockerSpawnStrategy } from '../docker-spawn-strategy.js';

const spawnMock = vi.mocked(spawn);

interface FakeStream extends EventEmitter {
  push(chunk: string): void;
}

function makeStream(): FakeStream {
  const stream = new EventEmitter() as FakeStream;
  stream.push = (chunk: string) => stream.emit('data', Buffer.from(chunk, 'utf-8'));
  return stream;
}

function makeFakeChild(): { child: EventEmitter & { stdout: FakeStream; stderr: FakeStream; stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> }; kill: ReturnType<typeof vi.fn> }; close(code: number): void } {
  const child = new EventEmitter() as EventEmitter & {
    stdout: FakeStream;
    stderr: FakeStream;
    stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdout = makeStream();
  child.stderr = makeStream();
  child.stdin = { write: vi.fn(), end: vi.fn() };
  child.kill = vi.fn();
  return {
    child,
    close: (code: number) => child.emit('close', code, null),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('LocalDockerSpawnStrategy — onStdoutLine streaming', () => {
  it('invokes onStdoutLine for each complete line while the process is still running', async () => {
    const fake = makeFakeChild();
    spawnMock.mockReturnValue(fake.child as unknown as ReturnType<typeof spawn>);

    const seen: string[] = [];
    const strategy = new LocalDockerSpawnStrategy();
    const pending = strategy.spawn({
      dockerArgs: ['run', '--rm', 'busybox'],
      stdinPayload: null,
      timeoutMs: 60_000,
      containerName: 'test-container',
      processInstanceId: 'pi-1',
      stepId: 'step-1',
      outputDir: '/tmp/out',
      logFile: null,
      onStdoutLine: (line) => { seen.push(line); },
    });

    // Ensure the spawn handler wired up the listeners before we push data.
    await Promise.resolve();

    fake.child.stdout.push('line one\n');
    await Promise.resolve();
    expect(seen).toEqual(['line one']);

    fake.child.stdout.push('line two\nline ');
    await Promise.resolve();
    expect(seen).toEqual(['line one', 'line two']);

    fake.child.stdout.push('three\n');
    await Promise.resolve();
    expect(seen).toEqual(['line one', 'line two', 'line three']);

    fake.close(0);
    const result = await pending;

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('line one\nline two\nline three\n');
  });

  it('flushes a trailing unterminated line on close', async () => {
    const fake = makeFakeChild();
    spawnMock.mockReturnValue(fake.child as unknown as ReturnType<typeof spawn>);

    const seen: string[] = [];
    const strategy = new LocalDockerSpawnStrategy();
    const pending = strategy.spawn({
      dockerArgs: ['run', '--rm', 'busybox'],
      stdinPayload: null,
      timeoutMs: 60_000,
      containerName: 'test-container',
      processInstanceId: 'pi-2',
      stepId: 'step-2',
      outputDir: '/tmp/out',
      logFile: null,
      onStdoutLine: (line) => { seen.push(line); },
    });

    await Promise.resolve();
    fake.child.stdout.push('partial line with no newline');
    await Promise.resolve();
    expect(seen).toEqual([]);

    fake.close(0);
    await pending;

    expect(seen).toEqual(['partial line with no newline']);
  });

  it('does not invoke onStdoutLine on blank lines', async () => {
    const fake = makeFakeChild();
    spawnMock.mockReturnValue(fake.child as unknown as ReturnType<typeof spawn>);

    const seen: string[] = [];
    const strategy = new LocalDockerSpawnStrategy();
    const pending = strategy.spawn({
      dockerArgs: ['run', '--rm', 'busybox'],
      stdinPayload: null,
      timeoutMs: 60_000,
      containerName: 'test-container',
      processInstanceId: 'pi-3',
      stepId: 'step-3',
      outputDir: '/tmp/out',
      logFile: null,
      onStdoutLine: (line) => { seen.push(line); },
    });

    await Promise.resolve();
    fake.child.stdout.push('\n\n   \nhello\n\n');
    await Promise.resolve();

    fake.close(0);
    await pending;

    expect(seen).toEqual(['hello']);
  });

  it('still returns full stdout when onStdoutLine is not provided', async () => {
    const fake = makeFakeChild();
    spawnMock.mockReturnValue(fake.child as unknown as ReturnType<typeof spawn>);

    const strategy = new LocalDockerSpawnStrategy();
    const pending = strategy.spawn({
      dockerArgs: ['run', '--rm', 'busybox'],
      stdinPayload: null,
      timeoutMs: 60_000,
      containerName: 'test-container',
      processInstanceId: 'pi-4',
      stepId: 'step-4',
      outputDir: '/tmp/out',
      logFile: null,
    });

    await Promise.resolve();
    fake.child.stdout.push('alpha\nbeta\n');
    fake.close(0);
    const result = await pending;

    expect(result.stdout).toBe('alpha\nbeta\n');
  });

  it('swallows errors thrown inside onStdoutLine so the spawn still resolves', async () => {
    const fake = makeFakeChild();
    spawnMock.mockReturnValue(fake.child as unknown as ReturnType<typeof spawn>);

    const strategy = new LocalDockerSpawnStrategy();
    const pending = strategy.spawn({
      dockerArgs: ['run', '--rm', 'busybox'],
      stdinPayload: null,
      timeoutMs: 60_000,
      containerName: 'test-container',
      processInstanceId: 'pi-5',
      stepId: 'step-5',
      outputDir: '/tmp/out',
      logFile: null,
      onStdoutLine: () => { throw new Error('boom'); },
    });

    await Promise.resolve();
    fake.child.stdout.push('hello\n');
    fake.close(0);
    const result = await pending;

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('hello\n');
  });
});
