import { createServer, type Server } from 'node:http';
import { listImages, getDiskUsage } from './docker-info.js';

const WORKER_HTTP_PORT = process.env.WORKER_HTTP_PORT !== undefined
  ? Number(process.env.WORKER_HTTP_PORT)
  : 3001;

function jsonResponse(res: import('node:http').ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

export function startHttpServer(): Server {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${WORKER_HTTP_PORT}`);

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
