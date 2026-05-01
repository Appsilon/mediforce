import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listImages, getDiskUsage } from '../docker-info.js';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

import { execSync } from 'node:child_process';
const mockExecSync = vi.mocked(execSync);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('listImages', () => {
  it('parses docker images NDJSON output', () => {
    mockExecSync.mockReturnValue(Buffer.from(
      [
        JSON.stringify({ Repository: 'mediforce/agent', Tag: 'latest', ID: 'abc123', Size: '1.2GB', CreatedSince: '2 days ago' }),
        JSON.stringify({ Repository: 'node', Tag: '20-slim', ID: 'def456', Size: '200MB', CreatedSince: '3 weeks ago' }),
      ].join('\n'),
    ));

    const result = listImages();

    expect(result).toEqual([
      { repository: 'mediforce/agent', tag: 'latest', id: 'abc123', size: '1.2GB', created: '2 days ago' },
      { repository: 'node', tag: '20-slim', id: 'def456', size: '200MB', created: '3 weeks ago' },
    ]);
    expect(mockExecSync).toHaveBeenCalledWith("docker images --format '{{json .}}'", { stdio: 'pipe' });
  });

  it('returns empty array when no images', () => {
    mockExecSync.mockReturnValue(Buffer.from(''));
    expect(listImages()).toEqual([]);
  });
});

describe('getDiskUsage', () => {
  it('parses docker system df NDJSON output', () => {
    mockExecSync.mockReturnValue(Buffer.from(
      [
        JSON.stringify({ Type: 'Images', TotalCount: '15', Active: '5', Size: '4.2GB' }),
        JSON.stringify({ Type: 'Containers', TotalCount: '8', Active: '3', Size: '500MB' }),
        JSON.stringify({ Type: 'Local Volumes', TotalCount: '2', Active: '1', Size: '100MB' }),
        JSON.stringify({ Type: 'Build Cache', TotalCount: '20', Active: '0', Size: '1.5GB' }),
      ].join('\n'),
    ));

    const result = getDiskUsage();

    expect(result).toEqual({
      images: { totalCount: 15, size: '4.2GB' },
      containers: { totalCount: 8, active: 3, size: '500MB' },
      buildCache: { size: '1.5GB' },
    });
  });

  it('defaults to zero when type missing', () => {
    mockExecSync.mockReturnValue(Buffer.from(
      JSON.stringify({ Type: 'Images', TotalCount: '5', Size: '2GB' }),
    ));

    const result = getDiskUsage();

    expect(result.containers).toEqual({ totalCount: 0, active: 0, size: '0B' });
    expect(result.buildCache).toEqual({ size: '0B' });
  });
});
