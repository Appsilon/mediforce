import { describe, expect, it } from 'vitest';
import { fetchFromContainerWorker, fetchFromLocalDocker } from '../_docker';

describe('fetchFromLocalDocker', () => {
  it('parses one-image-per-line JSON and the disk-df rows', async () => {
    const exec = async (file: string, args: readonly string[]) => {
      if (args[0] === 'images') {
        return {
          stdout: [
            JSON.stringify({
              Repository: 'alpine',
              Tag: 'latest',
              ID: 'abc123',
              Size: '7MB',
              CreatedSince: '2 days ago',
            }),
            JSON.stringify({
              Repository: 'nginx',
              Tag: '1.27',
              ID: 'def456',
              Size: '142MB',
              CreatedSince: '1 week ago',
            }),
          ].join('\n'),
          stderr: '',
        };
      }
      // docker system df
      return {
        stdout: [
          JSON.stringify({ Type: 'Images', TotalCount: '2', Size: '149MB' }),
          JSON.stringify({ Type: 'Containers', TotalCount: '1', Active: '1', Size: '0B' }),
          JSON.stringify({ Type: 'Local Volumes', TotalCount: '0', Size: '0B' }),
          JSON.stringify({ Type: 'Build Cache', TotalCount: '0', Size: '0B' }),
        ].join('\n'),
        stderr: '',
      };
    };

    const result = await fetchFromLocalDocker({ exec });

    expect(result.available).toBe(true);
    if (!result.available) throw new Error('unreachable');
    expect(result.images).toHaveLength(2);
    expect(result.images[0]).toEqual({
      repository: 'alpine',
      tag: 'latest',
      id: 'abc123',
      size: '7MB',
      created: '2 days ago',
    });
    expect(result.disk.images).toEqual({ totalCount: 2, size: '149MB' });
    expect(result.disk.containers).toEqual({ totalCount: 1, active: 1, size: '0B' });
    expect(result.disk.buildCache).toEqual({ size: '0B' });
  });

  it('returns {available: false} when image JSON does not validate', async () => {
    const exec = async (file: string, args: readonly string[]) => {
      if (args[0] === 'images') {
        // Missing required Repository field
        return { stdout: JSON.stringify({ Tag: 'latest', ID: 'x' }), stderr: '' };
      }
      return { stdout: JSON.stringify({ Type: 'Images', TotalCount: '0', Size: '0B' }), stderr: '' };
    };

    const result = await fetchFromLocalDocker({ exec });
    expect(result.available).toBe(false);
  });

  it('handles an empty images list', async () => {
    const exec = async (file: string, args: readonly string[]) => {
      if (args[0] === 'images') return { stdout: '', stderr: '' };
      return {
        stdout: [
          JSON.stringify({ Type: 'Images', TotalCount: '0', Size: '0B' }),
          JSON.stringify({ Type: 'Containers', TotalCount: '0', Active: '0', Size: '0B' }),
          JSON.stringify({ Type: 'Build Cache', TotalCount: '0', Size: '0B' }),
        ].join('\n'),
        stderr: '',
      };
    };

    const result = await fetchFromLocalDocker({ exec });
    expect(result.available).toBe(true);
    if (!result.available) throw new Error('unreachable');
    expect(result.images).toEqual([]);
  });
});

describe('fetchFromContainerWorker', () => {
  function makeResponse(body: unknown, ok = true): Response {
    return new Response(JSON.stringify(body), {
      status: ok ? 200 : 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  it('returns parsed payload when both endpoints succeed', async () => {
    const images = [{ repository: 'alpine', tag: 'latest', id: 'abc', size: '7MB', created: '2d' }];
    const disk = {
      images: { totalCount: 1, size: '7MB' },
      containers: { totalCount: 0, active: 0, size: '0B' },
      buildCache: { size: '0B' },
    };

    const calls: string[] = [];
    const fetch = async (url: string | URL | Request) => {
      const u = typeof url === 'string' ? url : url.toString();
      calls.push(u);
      return makeResponse(u.endsWith('/images') ? images : disk);
    };

    const result = await fetchFromContainerWorker({
      fetch: fetch as unknown as typeof globalThis.fetch,
      baseUrl: 'http://worker:3001',
    });

    expect(calls).toEqual(['http://worker:3001/images', 'http://worker:3001/disk']);
    expect(result.available).toBe(true);
    if (!result.available) throw new Error('unreachable');
    expect(result.images).toEqual(images);
    expect(result.disk).toEqual(disk);
  });

  it('returns {available: false} when an endpoint is non-OK', async () => {
    const fetch = async () => makeResponse({}, false);
    const result = await fetchFromContainerWorker({
      fetch: fetch as unknown as typeof globalThis.fetch,
      baseUrl: 'http://worker:3001',
    });
    expect(result.available).toBe(false);
  });

  it('returns {available: false} when payload shape is wrong', async () => {
    const fetch = async (url: string | URL | Request) => {
      const u = typeof url === 'string' ? url : url.toString();
      return makeResponse(u.endsWith('/images') ? [{ wrong: 'shape' }] : { also: 'wrong' });
    };
    const result = await fetchFromContainerWorker({
      fetch: fetch as unknown as typeof globalThis.fetch,
      baseUrl: 'http://worker:3001',
    });
    expect(result.available).toBe(false);
  });
});
