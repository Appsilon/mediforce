import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Server } from 'node:http';

vi.mock('../docker-info', () => ({
  listImages: vi.fn(),
  getDiskUsage: vi.fn(),
  getImageHistory: vi.fn(),
  probeImageCapabilities: vi.fn(),
}));

import { listImages, getDiskUsage, getImageHistory, probeImageCapabilities } from '../docker-info';
const mockListImages = vi.mocked(listImages);
const mockGetDiskUsage = vi.mocked(getDiskUsage);
const mockGetImageHistory = vi.mocked(getImageHistory);
const mockProbeImageCapabilities = vi.mocked(probeImageCapabilities);

let server: Server | null = null;

async function getServer(): Promise<{ server: Server; port: number }> {
  process.env.WORKER_HTTP_PORT = '0';
  const { startHttpServer } = await import('../http-server');
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
  delete process.env.CONTAINER_WORKER_SECRET;
  vi.clearAllMocks();
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
    mockListImages.mockResolvedValue(images);

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
    mockGetDiskUsage.mockResolvedValue(disk);

    const { port } = await getServer();
    const res = await fetch(`http://localhost:${port}/disk`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(disk);
  });

  it('GET /images/:image/capabilities returns the bounded probe result', async () => {
    mockProbeImageCapabilities.mockResolvedValue({
      status: 'known', agentCapable: true, runtimes: ['claude', 'bash'],
    });

    const { port } = await getServer();
    const res = await fetch(`http://localhost:${port}/images/mediforce-golden-image%3Alatest/capabilities`);

    expect(res.status).toBe(200);
    expect(mockProbeImageCapabilities).toHaveBeenCalledWith('mediforce-golden-image:latest');
    expect(await res.json()).toEqual({
      status: 'known', agentCapable: true, runtimes: ['claude', 'bash'],
    });
  });

  it('GET /images/:image/capabilities needs the worker secret once one is set', async () => {
    process.env.CONTAINER_WORKER_SECRET = 'worker-secret';
    mockProbeImageCapabilities.mockResolvedValue({ status: 'unknown' });

    const { port } = await getServer();
    const url = `http://localhost:${port}/images/alpine%3A3.24/capabilities`;

    const unauthorized = await fetch(url);
    expect(unauthorized.status).toBe(401);
    expect(mockProbeImageCapabilities).not.toHaveBeenCalled();

    const authorized = await fetch(url, { headers: { 'X-Worker-Secret': 'worker-secret' } });
    expect(authorized.status).toBe(200);
    expect(mockProbeImageCapabilities).toHaveBeenCalledWith('alpine:3.24');
  });

  it('GET /images/:image/history returns the layer summary, ungated', async () => {
    // No secret header, and one is set: reading history starts no container,
    // so it is gated like `/images`, not like the capability probe.
    process.env.CONTAINER_WORKER_SECRET = 'worker-secret';
    const steps = [{ command: 'RUN apt-get update', size: '87MB' }];
    mockGetImageHistory.mockResolvedValue(steps);

    const { port } = await getServer();
    const res = await fetch(`http://localhost:${port}/images/mediforce-golden-image%3Alatest/history`);

    expect(res.status).toBe(200);
    expect(mockGetImageHistory).toHaveBeenCalledWith('mediforce-golden-image:latest');
    expect(await res.json()).toEqual(steps);
  });

  it('GET /images/:image/history answers 500 when the daemon refuses', async () => {
    mockGetImageHistory.mockRejectedValue(new Error('No such image'));

    const { port } = await getServer();
    const res = await fetch(`http://localhost:${port}/images/gone%3Alatest/history`);

    expect(res.status).toBe(500);
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
    mockListImages.mockRejectedValue(new Error('docker not found'));

    const { port } = await getServer();
    const res = await fetch(`http://localhost:${port}/images`);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'docker not found' });
  });
});
