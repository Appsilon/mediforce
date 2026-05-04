import { describe, it, expect, vi, beforeEach } from 'vitest';
import { systemStatusCommand, systemImagesCommand, systemDiskCommand } from '../commands/system-status.js';
import { captureOutput, jsonResponse } from './test-helpers.js';

const DOCKER_INFO_RESPONSE = {
  available: true,
  images: [
    { repository: 'mediforce/agent', tag: 'latest', id: 'abc123', size: '1.2GB', created: '2 days ago' },
    { repository: 'python', tag: '3.11-slim', id: 'def456', size: '200MB', created: '3 weeks ago' },
  ],
  disk: {
    images: { totalCount: 5, size: '4GB' },
    containers: { totalCount: 3, active: 1, size: '500MB' },
    buildCache: { size: '1.5GB' },
  },
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('system status', () => {
  it('shows images and disk in human mode', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(DOCKER_INFO_RESPONSE));
    const output = captureOutput();
    const code = await systemStatusCommand({ argv: [], env: { MEDIFORCE_API_KEY: 'k' }, output });
    expect(code).toBe(0);
    const text = output.stdoutLines.join('\n');
    expect(text).toContain('Docker: connected');
    expect(text).toContain('mediforce/agent');
    expect(text).toContain('2 image(s)');
    expect(text).toContain('Images');
  });

  it('emits JSON when --json', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(DOCKER_INFO_RESPONSE));
    const output = captureOutput();
    const code = await systemStatusCommand({ argv: ['--json'], env: { MEDIFORCE_API_KEY: 'k' }, output });
    expect(code).toBe(0);
    const parsed = JSON.parse(output.stdoutLines.join('\n'));
    expect(parsed.available).toBe(true);
    expect(parsed.images).toHaveLength(2);
  });

  it('handles unavailable docker', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ available: false }));
    const output = captureOutput();
    const code = await systemStatusCommand({ argv: [], env: { MEDIFORCE_API_KEY: 'k' }, output });
    expect(code).toBe(0);
    expect(output.stdoutLines.join('\n')).toContain('unavailable');
  });

  it('shows help', async () => {
    const output = captureOutput();
    const code = await systemStatusCommand({ argv: ['--help'], env: { MEDIFORCE_API_KEY: 'k' }, output });
    expect(code).toBe(0);
    expect(output.stdoutLines.join('\n')).toContain('Usage:');
  });

  it('accepts --base-url', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(DOCKER_INFO_RESPONSE));
    const output = captureOutput();
    await systemStatusCommand({ argv: ['--base-url', 'http://remote:9003'], env: { MEDIFORCE_API_KEY: 'k' }, output });
    expect(fetchSpy.mock.calls[0][0]).toContain('http://remote:9003');
  });
});

describe('system images', () => {
  it('lists images in table format', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(DOCKER_INFO_RESPONSE));
    const output = captureOutput();
    const code = await systemImagesCommand({ argv: [], env: { MEDIFORCE_API_KEY: 'k' }, output });
    expect(code).toBe(0);
    const text = output.stdoutLines.join('\n');
    expect(text).toContain('mediforce/agent');
    expect(text).toContain('python');
    expect(text).toContain('2 image(s)');
  });

  it('emits JSON when --json', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(DOCKER_INFO_RESPONSE));
    const output = captureOutput();
    const code = await systemImagesCommand({ argv: ['--json'], env: { MEDIFORCE_API_KEY: 'k' }, output });
    expect(code).toBe(0);
    const parsed = JSON.parse(output.stdoutLines.join('\n'));
    expect(parsed.images).toHaveLength(2);
  });
});

describe('system disk', () => {
  it('shows disk usage table', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(DOCKER_INFO_RESPONSE));
    const output = captureOutput();
    const code = await systemDiskCommand({ argv: [], env: { MEDIFORCE_API_KEY: 'k' }, output });
    expect(code).toBe(0);
    const text = output.stdoutLines.join('\n');
    expect(text).toContain('Images');
    expect(text).toContain('Containers');
    expect(text).toContain('Build Cache');
  });

  it('emits JSON when --json', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(DOCKER_INFO_RESPONSE));
    const output = captureOutput();
    const code = await systemDiskCommand({ argv: ['--json'], env: { MEDIFORCE_API_KEY: 'k' }, output });
    expect(code).toBe(0);
    const parsed = JSON.parse(output.stdoutLines.join('\n'));
    expect(parsed.disk).toBeDefined();
  });
});
