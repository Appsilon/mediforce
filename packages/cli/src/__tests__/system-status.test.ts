import { describe, it, expect, vi } from 'vitest';
import { systemStatusCommand, systemImagesCommand, systemDiskCommand } from '../commands/system-status.js';
import { captureOutput } from './test-helpers.js';

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    execFile: vi.fn((_cmd: string, args: string[], cb: (err: Error | null, result: { stdout: string; stderr: string }) => void) => {
      if (args[0] === 'info') {
        cb(null, { stdout: 'OK', stderr: '' });
        return;
      }
      if (args[0] === 'images') {
        cb(null, {
          stdout: [
            JSON.stringify({ Repository: 'mediforce/agent', Tag: 'latest', ID: 'abc123', Size: '1.2GB', CreatedSince: '2 days ago' }),
            JSON.stringify({ Repository: 'python', Tag: '3.11-slim', ID: 'def456', Size: '200MB', CreatedSince: '3 weeks ago' }),
          ].join('\n'),
          stderr: '',
        });
        return;
      }
      if (args[0] === 'system') {
        cb(null, {
          stdout: [
            JSON.stringify({ Type: 'Images', TotalCount: '5', Active: '2', Size: '4GB' }),
            JSON.stringify({ Type: 'Containers', TotalCount: '3', Active: '1', Size: '500MB' }),
            JSON.stringify({ Type: 'Build Cache', TotalCount: '10', Active: '0', Size: '1.5GB' }),
          ].join('\n'),
          stderr: '',
        });
        return;
      }
      cb(new Error(`unexpected args: ${args.join(' ')}`), { stdout: '', stderr: '' });
    }),
  };
});

describe('system status', () => {
  it('shows images and disk in human mode', async () => {
    const output = captureOutput();
    const code = await systemStatusCommand({ argv: [], env: {}, output });
    expect(code).toBe(0);
    const text = output.stdoutLines.join('\n');
    expect(text).toContain('Docker: connected');
    expect(text).toContain('mediforce/agent');
    expect(text).toContain('Images');
    expect(text).toContain('2 image(s)');
  });

  it('emits JSON when --json', async () => {
    const output = captureOutput();
    const code = await systemStatusCommand({ argv: ['--json'], env: {}, output });
    expect(code).toBe(0);
    const parsed = JSON.parse(output.stdoutLines.join('\n'));
    expect(parsed.available).toBe(true);
    expect(parsed.images).toHaveLength(2);
    expect(parsed.disk).toHaveLength(3);
  });

  it('shows help', async () => {
    const output = captureOutput();
    const code = await systemStatusCommand({ argv: ['--help'], env: {}, output });
    expect(code).toBe(0);
    expect(output.stdoutLines.join('\n')).toContain('Usage:');
  });
});

describe('system images', () => {
  it('lists images in table format', async () => {
    const output = captureOutput();
    const code = await systemImagesCommand({ argv: [], env: {}, output });
    expect(code).toBe(0);
    const text = output.stdoutLines.join('\n');
    expect(text).toContain('mediforce/agent');
    expect(text).toContain('python');
    expect(text).toContain('2 image(s)');
  });

  it('emits JSON when --json', async () => {
    const output = captureOutput();
    const code = await systemImagesCommand({ argv: ['--json'], env: {}, output });
    expect(code).toBe(0);
    const parsed = JSON.parse(output.stdoutLines.join('\n'));
    expect(parsed.images).toHaveLength(2);
  });
});

describe('system disk', () => {
  it('shows disk usage table', async () => {
    const output = captureOutput();
    const code = await systemDiskCommand({ argv: [], env: {}, output });
    expect(code).toBe(0);
    const text = output.stdoutLines.join('\n');
    expect(text).toContain('Images');
    expect(text).toContain('Containers');
    expect(text).toContain('Build Cache');
  });

  it('emits JSON when --json', async () => {
    const output = captureOutput();
    const code = await systemDiskCommand({ argv: ['--json'], env: {}, output });
    expect(code).toBe(0);
    const parsed = JSON.parse(output.stdoutLines.join('\n'));
    expect(parsed.disk).toHaveLength(3);
  });
});
