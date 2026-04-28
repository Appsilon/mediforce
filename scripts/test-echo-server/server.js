#!/usr/bin/env node
// Local echo server used by spike #9 (and downstream http-action tests).
// Mirrors httpbin.org/anything: echoes the parsed body, headers, query, and
// method as JSON so callers can deep-equal-assert their request shape end-to-end.
//
// Usage:
//   node scripts/test-echo-server/server.js [--port 9099]
//
// In tests, prefer instantiating createEchoServer() directly (see exports).

import { createServer } from 'node:http';
import { URL } from 'node:url';

export function createEchoServer() {
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      let json = null;
      if (raw.length > 0) {
        try {
          json = JSON.parse(raw);
        } catch {
          json = null;
        }
      }

      const baseUrl = `http://${req.headers.host ?? 'localhost'}`;
      const url = new URL(req.url ?? '/', baseUrl);
      const args = {};
      url.searchParams.forEach((value, key) => {
        args[key] = value;
      });

      const responseBody = {
        method: req.method,
        url: url.toString(),
        path: url.pathname,
        args,
        json,
        data: raw,
        headers: req.headers,
      };

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(responseBody));
    });
  });

  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const portArgIndex = process.argv.indexOf('--port');
  const port = portArgIndex !== -1
    ? Number(process.argv[portArgIndex + 1])
    : Number(process.env.PORT ?? 9099);
  const server = createEchoServer();
  server.listen(port, () => {
    console.log(`[echo-server] listening on port ${port}`);
  });
}
