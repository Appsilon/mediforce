import { describe, expect, it } from 'vitest';
import {
  fetchContainerWorkerImageHistory,
  fetchFromContainerWorker,
  fetchFromLocalDocker,
  fetchImagesFromContainerWorker,
  fetchImagesFromLocalDocker,
  fetchLocalImageHistory,
  probeContainerWorkerImageCapabilities,
  probeLocalImageCapabilities,
} from '../_docker';

describe('fetchFromLocalDocker', () => {
  it('parses one-image-per-line JSON and the disk-df rows', async () => {
    const exec = async (file: string, args: readonly string[]) => {
      if (args[0] === 'images') {
        return {
          stdout: [
            JSON.stringify({ Repository: 'alpine', Tag: 'latest', ID: 'abc123', Size: '7MB', CreatedSince: '2 days ago' }),
            JSON.stringify({ Repository: 'nginx', Tag: '1.27', ID: 'def456', Size: '142MB', CreatedSince: '1 week ago' }),
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

  it('reads build provenance off the images that carry the labels', async () => {
    const exec = async (file: string, args: readonly string[]) => {
      if (args[0] === 'images') {
        return {
          stdout: [
            JSON.stringify({ Repository: 'mediforce-built', Tag: '0a1b2c3d4e5f', ID: 'abc123def456', Size: '6GB', CreatedSince: '2 days ago' }),
            JSON.stringify({ Repository: 'postgres', Tag: '17', ID: 'def456abc123', Size: '667MB', CreatedSince: '1 week ago' }),
          ].join('\n'),
          stderr: '',
        };
      }
      if (args[0] === 'image') {
        return {
          stdout: [
            `sha256:abc123def456000000000000000000000000000000000000000000000000\t${JSON.stringify({
              'mediforce.build.repo': 'git@github.com:owner/repo.git',
              'mediforce.build.commit': 'abc123',
              'mediforce.build.dockerfile': 'container/Dockerfile',
              'mediforce.build.workflow': 'sdtm-mapping',
              'mediforce.build.namespace': 'acme',
            })}`,
            'sha256:def456abc123000000000000000000000000000000000000000000000000\tnull',
          ].join('\n'),
          stderr: '',
        };
      }
      return {
        stdout: [
          JSON.stringify({ Type: 'Images', TotalCount: '2', Size: '7GB' }),
          JSON.stringify({ Type: 'Containers', TotalCount: '0', Active: '0', Size: '0B' }),
          JSON.stringify({ Type: 'Build Cache', TotalCount: '0', Size: '0B' }),
        ].join('\n'),
        stderr: '',
      };
    };

    const result = await fetchFromLocalDocker({ exec });

    expect(result.available).toBe(true);
    if (!result.available) throw new Error('unreachable');
    // The derived tag says nothing; the labels name the repo, commit and workflow.
    expect(result.images[0]).toMatchObject({
      repository: 'mediforce-built',
      buildRepo: 'git@github.com:owner/repo.git',
      buildCommit: 'abc123',
      buildDockerfile: 'container/Dockerfile',
      buildWorkflow: 'sdtm-mapping',
      buildNamespace: 'acme',
    });
    // An image we did not build lists unannotated rather than dropping out.
    expect(result.images[1]).toMatchObject({
      repository: 'postgres',
      tag: '17',
      id: 'def456abc123',
      size: '667MB',
      created: '1 week ago',
    });
    expect(result.images[1].buildRepo).toBeUndefined();
    expect(result.images[1].ownLabels).toEqual({});
  });

  it('annotates each row with the base it descends from and the labels it owns', async () => {
    const base = 'sha256:aaa000000000000000000000000000000000000000000000000000000000';
    const child = 'sha256:bbb000000000000000000000000000000000000000000000000000000000';
    const layer = (name: string) => `sha256:${name}`;
    const exec = async (file: string, args: readonly string[]) => {
      if (args[0] === 'images') {
        return {
          stdout: [
            JSON.stringify({ Repository: 'mediforce-agent', Tag: 'tealflow', ID: 'bbb000000000', Size: '7GB', CreatedSince: '1 day ago' }),
            JSON.stringify({ Repository: 'mediforce-golden-image', Tag: 'latest', ID: 'aaa000000000', Size: '6GB', CreatedSince: '2 days ago' }),
          ].join('\n'),
          stderr: '',
        };
      }
      if (args[0] === 'image') {
        return {
          stdout: [
            `${base}\t${JSON.stringify({ 'org.opencontainers.image.source': 'https://github.com/rocker-org/rocker-versioned2' })}\t${JSON.stringify([layer('a'), layer('b')])}`,
            `${child}\t${JSON.stringify({
              'org.opencontainers.image.source': 'https://github.com/rocker-org/rocker-versioned2',
              'mediforce.build.commit': 'abc123',
            })}\t${JSON.stringify([layer('a'), layer('b'), layer('c')])}`,
          ].join('\n'),
          stderr: '',
        };
      }
      return {
        stdout: [
          JSON.stringify({ Type: 'Images', TotalCount: '2', Size: '13GB' }),
          JSON.stringify({ Type: 'Containers', TotalCount: '0', Active: '0', Size: '0B' }),
          JSON.stringify({ Type: 'Build Cache', TotalCount: '0', Size: '0B' }),
        ].join('\n'),
        stderr: '',
      };
    };

    const result = await fetchFromLocalDocker({ exec });
    expect(result.available).toBe(true);
    if (!result.available) throw new Error('unreachable');

    const [derived, golden] = result.images;
    expect(derived.baseImageId).toBe('aaa000000000');
    expect(golden.baseImageId).toBeUndefined();
    // The rocker label is the base's claim, inherited verbatim; only the commit
    // is this image's own, which is what makes `.source` safe to read (#1296).
    expect(derived.ownLabels).toEqual({ 'mediforce.build.commit': 'abc123' });
  });

  it('lists images unannotated when the label inspect fails', async () => {
    const exec = async (file: string, args: readonly string[]) => {
      if (args[0] === 'images') {
        return {
          stdout: JSON.stringify({ Repository: 'alpine', Tag: 'latest', ID: 'abc123', Size: '7MB', CreatedSince: '2 days ago' }),
          stderr: '',
        };
      }
      if (args[0] === 'image') throw new Error('Error: No such image: abc123');
      return {
        stdout: [
          JSON.stringify({ Type: 'Images', TotalCount: '1', Size: '7MB' }),
          JSON.stringify({ Type: 'Containers', TotalCount: '0', Active: '0', Size: '0B' }),
          JSON.stringify({ Type: 'Build Cache', TotalCount: '0', Size: '0B' }),
        ].join('\n'),
        stderr: '',
      };
    };

    const result = await fetchFromLocalDocker({ exec });

    expect(result.available).toBe(true);
    if (!result.available) throw new Error('unreachable');
    expect(result.images).toHaveLength(1);
    expect(result.images[0].buildCommit).toBeUndefined();
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

describe('the listing without the disk statistics', () => {
  it('never runs `docker system df` — the catalog reads the listing only', async () => {
    const invoked: string[] = [];
    const exec = async (_file: string, args: readonly string[]) => {
      invoked.push(args.join(' '));
      return args[0] === 'images'
        ? {
            stdout: JSON.stringify({
              Repository: 'alpine',
              Tag: 'latest',
              ID: 'abc123',
              Size: '7MB',
              CreatedSince: '2 days ago',
            }),
            stderr: '',
          }
        : { stdout: '', stderr: '' };
    };

    const result = await fetchImagesFromLocalDocker({ exec });

    expect(result.available).toBe(true);
    expect(result.images.map((image) => image.repository)).toEqual(['alpine']);
    expect(invoked.some((call) => call.startsWith('system df'))).toBe(false);
  });

  it('never asks the container worker for /disk', async () => {
    const requested: string[] = [];
    const fetchImpl = (async (url: string) => {
      requested.push(url);
      return { ok: true, json: async () => [] };
    }) as unknown as typeof globalThis.fetch;

    const result = await fetchImagesFromContainerWorker({
      fetch: fetchImpl,
      baseUrl: 'http://worker:3001',
    });

    expect(result).toEqual({ available: true, images: [] });
    expect(requested).toEqual(['http://worker:3001/images']);
  });

  it('reports an unreachable worker as unavailable with no images, never an error', async () => {
    const fetchImpl = (async () => ({ ok: false, json: async () => ({}) })) as unknown as
      typeof globalThis.fetch;

    expect(
      await fetchImagesFromContainerWorker({ fetch: fetchImpl, baseUrl: 'http://worker:3001' }),
    ).toEqual({ available: false, images: [] });
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
    const images = [
      { repository: 'alpine', tag: 'latest', id: 'abc', size: '7MB', created: '2d' },
    ];
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

describe('image capability probes', () => {
  it('normalises the same probe fixture from local Docker and the worker', async () => {
    const local = await probeLocalImageCapabilities('mediforce-golden-image:latest', {
      exec: async () => ({ stdout: '/usr/local/bin/opencode\n/usr/bin/bash\n/usr/bin/node\n', stderr: '' }),
    });
    const worker = await probeContainerWorkerImageCapabilities('mediforce-golden-image:latest', {
      baseUrl: 'http://worker.test',
      fetch: async () => new Response(
        JSON.stringify({ status: 'known', agentCapable: true, runtimes: ['opencode', 'bash', 'node'] }),
      ),
    });

    expect(worker).toEqual(local);
  });

  it('turns a timeout or unavailable worker into explicit unknown capability', async () => {
    const local = await probeLocalImageCapabilities('missing', {
      exec: async () => { throw new Error('timed out'); },
    });
    const worker = await probeContainerWorkerImageCapabilities('missing', {
      fetch: async () => { throw new Error('connection refused'); },
    });

    expect(local).toEqual({ status: 'unknown' });
    expect(worker).toEqual({ status: 'unknown' });
  });
});

describe('image history reads', () => {
  const row = JSON.stringify({ CreatedBy: 'COPY mcp /app/mcp # buildkit', Size: '430kB' });

  it('normalises the same history from local Docker and the worker', async () => {
    const local = await fetchLocalImageHistory('sha-1', {
      exec: async () => ({ stdout: row, stderr: '' }),
    });
    const worker = await fetchContainerWorkerImageHistory('sha-1', {
      baseUrl: 'http://worker.test',
      fetch: async () => new Response(
        JSON.stringify([{ command: 'COPY mcp /app/mcp', size: '430kB' }]),
      ),
    });

    expect(local).toEqual([{ command: 'COPY mcp /app/mcp', size: '430kB' }]);
    expect(worker).toEqual(local);
  });

  it('reports a daemon that could not answer as null, never as an image with no steps', async () => {
    const local = await fetchLocalImageHistory('missing', {
      exec: async () => { throw new Error('timed out'); },
    });
    const refused = await fetchContainerWorkerImageHistory('missing', {
      fetch: async () => { throw new Error('connection refused'); },
    });
    const notFound = await fetchContainerWorkerImageHistory('missing', {
      fetch: async () => new Response('nope', { status: 404 }),
    });

    expect(local).toBeNull();
    expect(refused).toBeNull();
    expect(notFound).toBeNull();
  });

  it('bounds the worker request, so a stalled worker degrades instead of hanging the read', async () => {
    let signal: AbortSignal | undefined;
    await fetchContainerWorkerImageHistory('sha-1', {
      baseUrl: 'http://worker.test',
      fetch: async (_input, init) => {
        signal = init?.signal ?? undefined;
        return new Response('[]');
      },
    });

    expect(signal).toBeInstanceOf(AbortSignal);
  });
});
