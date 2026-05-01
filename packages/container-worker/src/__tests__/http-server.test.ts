import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Server } from 'node:http';

vi.mock('../docker-info.js', () => ({
  listImages: vi.fn(),
  getDiskUsage: vi.fn(),
}));

import { listImages, getDiskUsage } from '../docker-info.js';
const mockListImages = vi.mocked(listImages);
const mockGetDiskUsage = vi.mocked(getDiskUsage);

let server: Server | null = null;

async function getServer(): Promise<{ server: Server; port: number }> {
  process.env.WORKER_HTTP_PORT = '0';
  const { startHttpServer } = await import('../http-server.js');
  const srv = startHttpServer();
  await new Promise<void>((resolve) => srv.once('listening', resolve));
  const addr = srv.address();
  const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
  server = srv;
  return { server: srv, port };
}

afterEach(() => {
  if (server) {
    server.close();
    server = null;
  }
  vi.resetModules();
});

describe('HTTP info server', () => {
  it('GET /health returns ok', async () => {
    const { port } = await getServer();
    const res = await fetch(`http://localhost:${port}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('GET /images returns image list', async () => {
    const images = [{ repository: 'test', tag: 'latest', id: 'abc', size: '100MB', created: '1 day ago' }];
    mockListImages.mockReturnValue(images);

    const { port } = await getServer();
    const res = await fetch(`http://localhost:${port}/images`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(images);
  });

  it('GET /disk returns disk usage', async () => {
    const disk = {
      images: { totalCount: 5, size: '2GB' },
      containers: { totalCount: 2, active: 1, size: '100MB' },
      buildCache: { size: '500MB' },
    };
    mockGetDiskUsage.mockReturnValue(disk);

    const { port } = await getServer();
    const res = await fetch(`http://localhost:${port}/disk`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(disk);
  });

  it('returns 404 for unknown routes', async () => {
    const { port } = await getServer();
    const res = await fetch(`http://localhost:${port}/unknown`);
    expect(res.status).toBe(404);
  });

  it('returns 405 for non-GET methods', async () => {
    const { port } = await getServer();
    const res = await fetch(`http://localhost:${port}/health`, { method: 'POST' });
    expect(res.status).toBe(405);
  });

  it('returns 500 when docker command fails', async () => {
    mockListImages.mockImplementation(() => { throw new Error('docker not found'); });

    const { port } = await getServer();
    const res = await fetch(`http://localhost:${port}/images`);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'docker not found' });
  });
});
