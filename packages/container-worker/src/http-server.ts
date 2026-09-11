import { createServer, type Server } from 'node:http';
import {
  listImages,
  getDiskUsage,
  getImageHistory,
  probeImageCapabilities,
  removeImage,
} from './docker-info';

const WORKER_HTTP_PORT = process.env.WORKER_HTTP_PORT !== undefined
  ? Number(process.env.WORKER_HTTP_PORT)
  : 3001;

function jsonResponse(res: import('node:http').ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

const WORKER_SECRET = process.env.CONTAINER_WORKER_SECRET ?? '';

function requireSecret(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse): boolean {
  if (WORKER_SECRET === '') return true;
  const provided = req.headers['x-worker-secret'];
  if (provided === WORKER_SECRET) return true;
  jsonResponse(res, 401, { error: 'Unauthorized — invalid or missing X-Worker-Secret' });
  return false;
}

export function startHttpServer(): Server {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${WORKER_HTTP_PORT}`);

    if (req.method === 'DELETE' && url.pathname.startsWith('/images/')) {
      if (!requireSecret(req, res)) return;
      const imageId = decodeURIComponent(url.pathname.slice('/images/'.length));
      if (imageId.length === 0) {
        jsonResponse(res, 400, { error: 'Missing image ID' });
        return;
      }
      try {
        const output = await removeImage(imageId);
        jsonResponse(res, 200, { deleted: imageId, output });
      } catch (err) {
        jsonResponse(res, 500, { error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }

    if (req.method !== 'GET') {
      jsonResponse(res, 405, { error: 'Method not allowed' });
      return;
    }

    if (url.pathname === '/health') {
      jsonResponse(res, 200, { status: 'ok' });
      return;
    }

    if (url.pathname === '/images') {
      try {
        const images = await listImages();
        jsonResponse(res, 200, images);
      } catch (err) {
        jsonResponse(res, 500, { error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }

    if (url.pathname.startsWith('/images/') && url.pathname.endsWith('/capabilities')) {
      // Reading this route starts a container from a caller-supplied
      // reference, so it is gated like the destructive DELETE rather than
      // like the read-only listings above it.
      if (!requireSecret(req, res)) return;
      const image = decodeURIComponent(
        url.pathname.slice('/images/'.length, -'/capabilities'.length),
      );
      if (image.length === 0) {
        jsonResponse(res, 400, { error: 'Missing image reference' });
        return;
      }
      jsonResponse(res, 200, await probeImageCapabilities(image));
      return;
    }

    if (url.pathname.startsWith('/images/') && url.pathname.endsWith('/history')) {
      // Ungated, unlike the capability probe: this reads metadata the daemon
      // already holds and starts nothing, which is the same class of read as
      // the `/images` listing above.
      const image = decodeURIComponent(
        url.pathname.slice('/images/'.length, -'/history'.length),
      );
      if (image.length === 0) {
        jsonResponse(res, 400, { error: 'Missing image reference' });
        return;
      }
      try {
        jsonResponse(res, 200, await getImageHistory(image));
      } catch (err) {
        jsonResponse(res, 500, { error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }

    if (url.pathname === '/disk') {
      try {
        const disk = await getDiskUsage();
        jsonResponse(res, 200, disk);
      } catch (err) {
        jsonResponse(res, 500, { error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }

    jsonResponse(res, 404, { error: 'Not found' });
  });

  server.listen(WORKER_HTTP_PORT, () => {
    console.log(`[worker] HTTP info server listening on port ${WORKER_HTTP_PORT}`);
  });

  return server;
}
