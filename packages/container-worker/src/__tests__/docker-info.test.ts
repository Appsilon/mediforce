import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listImages, getDiskUsage } from '../docker-info';

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

vi.mock('node:util', () => ({
  promisify: (fn: unknown) => fn,
}));

import { execFile } from 'node:child_process';
const mockExecFile = vi.mocked(execFile);

beforeEach(() => {
  vi.clearAllMocks();
});

/** Route `docker images` and `docker image inspect` to separate fixtures. */
function mockDocker(images: string, labels: string | Error = 'null'): void {
  (mockExecFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    async (_file: string, args: string[]) => {
      if (args[0] === 'images') return { stdout: images, stderr: '' };
      if (labels instanceof Error) throw labels;
      return { stdout: labels, stderr: '' };
    },
  );
}

describe('listImages', () => {
  it('parses docker images NDJSON output', async () => {
    mockDocker(
      [
        JSON.stringify({ Repository: 'mediforce/agent', Tag: 'latest', ID: 'abc123', Size: '1.2GB', CreatedSince: '2 days ago' }),
        JSON.stringify({ Repository: 'node', Tag: '20-slim', ID: 'def456', Size: '200MB', CreatedSince: '3 weeks ago' }),
      ].join('\n'),
      ['abc123\tnull', 'def456\tnull'].join('\n'),
    );

    const result = await listImages();

    expect(result).toMatchObject([
      { repository: 'mediforce/agent', tag: 'latest', id: 'abc123', size: '1.2GB', created: '2 days ago' },
      { repository: 'node', tag: '20-slim', id: 'def456', size: '200MB', created: '3 weeks ago' },
    ]);
    // Neither is descended from the other, so neither names a base.
    expect(result.map((image) => image.baseImageId)).toEqual([undefined, undefined]);
    expect(mockExecFile).toHaveBeenCalledWith('docker', ['images', '--format', '{{json .}}']);
  });

  it('attaches the build provenance labels to the image that carries them', async () => {
    mockDocker(
      JSON.stringify({ Repository: 'mediforce-built', Tag: '0a1b2c3d4e5f', ID: 'abc123def456', Size: '6GB', CreatedSince: '2 days ago' }),
      `sha256:abc123def456000000000000000000000000000000000000000000000000\t${JSON.stringify({
        'mediforce.build.repo': 'git@github.com:owner/repo.git',
        'mediforce.build.commit': 'abc123',
        'mediforce.build.workflow': 'sdtm-mapping',
      })}`,
    );

    expect(await listImages()).toMatchObject([
      {
        repository: 'mediforce-built',
        tag: '0a1b2c3d4e5f',
        id: 'abc123def456',
        size: '6GB',
        created: '2 days ago',
        buildRepo: 'git@github.com:owner/repo.git',
        buildCommit: 'abc123',
        buildDockerfile: undefined,
        buildWorkflow: 'sdtm-mapping',
        buildNamespace: undefined,
      },
    ]);
  });

  it('names the base each image descends from, by layer prefix', async () => {
    const layer = (name: string) => `sha256:${name}`;
    mockDocker(
      [
        JSON.stringify({ Repository: 'mediforce-agent', Tag: 'tealflow', ID: 'bbb000000000', Size: '7GB', CreatedSince: '1 day ago' }),
        JSON.stringify({ Repository: 'mediforce-golden-image', Tag: 'latest', ID: 'aaa000000000', Size: '6GB', CreatedSince: '2 days ago' }),
      ].join('\n'),
      [
        `bbb000000000\t${JSON.stringify({ 'mediforce.build.commit': 'abc123' })}\t${JSON.stringify([layer('a'), layer('b')])}`,
        `aaa000000000\t${JSON.stringify(null)}\t${JSON.stringify([layer('a')])}`,
      ].join('\n'),
    );

    const [derived, golden] = await listImages();

    expect(derived.baseImageId).toBe('aaa000000000');
    expect(derived.ownLabels).toEqual({ 'mediforce.build.commit': 'abc123' });
    expect(golden.baseImageId).toBeUndefined();
  });

  it('lists images unannotated when the label inspect fails', async () => {
    mockDocker(
      JSON.stringify({ Repository: 'alpine', Tag: 'latest', ID: 'abc123', Size: '7MB', CreatedSince: '2 days ago' }),
      new Error('Error: No such image: abc123'),
    );

    expect(await listImages()).toEqual([
      { repository: 'alpine', tag: 'latest', id: 'abc123', size: '7MB', created: '2 days ago' },
    ]);
  });

  it('returns empty array when no images', async () => {
    mockDocker('');
    expect(await listImages()).toEqual([]);
  });
});

describe('getDiskUsage', () => {
  it('parses docker system df NDJSON output', async () => {
    const stdout = [
      JSON.stringify({ Type: 'Images', TotalCount: '15', Active: '5', Size: '4.2GB' }),
      JSON.stringify({ Type: 'Containers', TotalCount: '8', Active: '3', Size: '500MB' }),
      JSON.stringify({ Type: 'Local Volumes', TotalCount: '2', Active: '1', Size: '100MB' }),
      JSON.stringify({ Type: 'Build Cache', TotalCount: '20', Active: '0', Size: '1.5GB' }),
    ].join('\n');
    (mockExecFile as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ stdout, stderr: '' });

    const result = await getDiskUsage();

    expect(result).toEqual({
      images: { totalCount: 15, size: '4.2GB' },
      containers: { totalCount: 8, active: 3, size: '500MB' },
      buildCache: { size: '1.5GB' },
    });
  });

  it('defaults to zero when type missing', async () => {
    const stdout = JSON.stringify({ Type: 'Images', TotalCount: '5', Size: '2GB' });
    (mockExecFile as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ stdout, stderr: '' });

    const result = await getDiskUsage();

    expect(result.containers).toEqual({ totalCount: 0, active: 0, size: '0B' });
    expect(result.buildCache).toEqual({ size: '0B' });
  });
});
