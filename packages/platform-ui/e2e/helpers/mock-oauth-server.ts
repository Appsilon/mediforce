import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';

/** Mock OAuth 2.0 provider for E2E tests.
 *
 *  Serves the four endpoints the platform's OAuth flow touches:
 *    - GET  /authorize   → immediate 302 back to redirect_uri with a dummy
 *                          code and the original state echoed verbatim.
 *    - POST /token       → returns dummy access/refresh tokens. Handles both
 *                          grant_type=authorization_code and refresh_token.
 *    - GET  /userinfo    → returns a GitHub-shaped user payload.
 *    - POST /revoke      → always 200.
 *
 *  Implemented on bare `node:http` — zero dependencies. Binds to an ephemeral
 *  port so parallel test runs on the same host don't collide. Callers start
 *  the server once (Playwright globalSetup), read `baseUrl`, seed that value
 *  into Firestore for the fixture provider, then stop at teardown.
 *
 *  No security semantics — these endpoints echo whatever the client sends.
 *  Tokens carry a timestamp suffix so refresh responses differ from issue
 *  responses, which the unit tests for `resolveOAuthToken` rely on. */

export interface MockOAuthServerHandle {
  baseUrl: string;
  stop: () => Promise<void>;
  /** Number of requests handled per path, useful for smoke assertions. */
  hits: Record<string, number>;
}

function log(msg: string): void {
  // eslint-disable-next-line no-console
  console.log(`[mock-oauth] ${msg}`);
}

async function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Length', Buffer.byteLength(body).toString());
  res.end(body);
}

function sendText(res: ServerResponse, status: number, body: string): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Length', Buffer.byteLength(body).toString());
  res.end(body);
}

function parseFormBody(raw: string): Record<string, string> {
  const params = new URLSearchParams(raw);
  const out: Record<string, string> = {};
  for (const [key, value] of params.entries()) out[key] = value;
  return out;
}

export async function startMockOAuthServer(): Promise<MockOAuthServerHandle> {
  const hits: Record<string, number> = {};

  const server: Server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const method = req.method ?? 'GET';
      const pathname = url.pathname;
      const hitKey = `${method} ${pathname}`;
      hits[hitKey] = (hits[hitKey] ?? 0) + 1;
      log(hitKey);

      // ── /authorize ────────────────────────────────────────────────────
      // GitHub / Google both expose this as GET. Immediately redirect back
      // to the redirect_uri with a dummy code + echoed state. No consent UI.
      if (method === 'GET' && pathname === '/authorize') {
        const redirectUri = url.searchParams.get('redirect_uri');
        const state = url.searchParams.get('state') ?? '';
        if (redirectUri === null || redirectUri === '') {
          sendText(res, 400, 'missing redirect_uri');
          return;
        }
        const code = `mock-code-${Date.now()}`;
        const target = new URL(redirectUri);
        target.searchParams.set('code', code);
        target.searchParams.set('state', state);
        res.statusCode = 302;
        res.setHeader('Location', target.toString());
        res.end();
        return;
      }

      // ── /token ────────────────────────────────────────────────────────
      // Accept either form-encoded (GitHub/Google default) or JSON body.
      // grant_type=authorization_code → issue fresh pair.
      // grant_type=refresh_token      → rotate access token, keep refresh.
      if (method === 'POST' && pathname === '/token') {
        const raw = await readBody(req);
        const contentType = req.headers['content-type'] ?? '';
        const body = contentType.includes('application/json')
          ? (JSON.parse(raw) as Record<string, string>)
          : parseFormBody(raw);
        const grant = body.grant_type ?? 'authorization_code';
        const now = Date.now();
        const payload = {
          access_token: `mock-access-${now}`,
          refresh_token: grant === 'refresh_token'
            ? (body.refresh_token ?? `mock-refresh-${now}`)
            : `mock-refresh-${now}`,
          token_type: 'Bearer',
          expires_in: 3600,
          scope: 'repo read:user',
        };
        sendJson(res, 200, payload);
        return;
      }

      // ── /userinfo ─────────────────────────────────────────────────────
      // Requires a Bearer token. Shape matches GitHub `/user`, which the
      // callback route's `extractUserInfo` recognizes via `id` + `login`.
      if (method === 'GET' && pathname === '/userinfo') {
        const authHeader = req.headers.authorization ?? '';
        if (!authHeader.startsWith('Bearer ') || authHeader.length <= 'Bearer '.length) {
          sendText(res, 401, 'missing bearer token');
          return;
        }
        sendJson(res, 200, {
          id: 424242,
          login: 'mock-user',
          name: 'Mock User',
          email: 'mock-user@example.com',
        });
        return;
      }

      // ── /revoke ───────────────────────────────────────────────────────
      // Always 200. Real providers return 200 with an empty body. The body
      // is ignored by the platform, which only checks HTTP status.
      if (method === 'POST' && pathname === '/revoke') {
        await readBody(req).catch(() => '');
        sendText(res, 200, '');
        return;
      }

      // ── /hits ─────────────────────────────────────────────────────────
      // Debug endpoint — lets the journey inspect which endpoints were hit.
      if (method === 'GET' && pathname === '/hits') {
        sendJson(res, 200, hits);
        return;
      }

      sendText(res, 404, `mock-oauth: no handler for ${method} ${pathname}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      log(`error: ${message}`);
      sendText(res, 500, message);
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  log(`listening on ${baseUrl}`);

  return {
    baseUrl,
    hits,
    stop: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err !== null && err !== undefined) reject(err);
          else {
            log(`stopped (was on ${baseUrl})`);
            resolve();
          }
        });
      }),
  };
}
