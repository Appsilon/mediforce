import { createServer, type IncomingMessage, type Server } from 'node:http';

/**
 * Mock OpenRouter chat-completions endpoint for E2E. The e2e server points its
 * `OPENROUTER_BASE_URL` here (playwright.config.ts), so assistant turns and
 * LLM judges answer from a script instead of a model.
 *
 * A journey scripts its turns under a key — the first user message of the
 * conversation it will send — so journeys running in parallel never draw from
 * each other's script:
 *
 *   POST /__script   { key, turns: [{ content?, toolCalls?: [{ name, arguments }] }] }
 *   GET  /__requests?key=…   every chat request received under that key
 *
 * A string argument `"$tool:<dotted.path>"` is replaced by that path in the
 * request's latest tool result, which is how a turn can name an id the
 * platform created a moment earlier (a prepared Eval Run).
 */

export const MOCK_OPENROUTER_PORT = Number(process.env.E2E_OPENROUTER_MOCK_PORT ?? 9019);
export const MOCK_OPENROUTER_URL = `http://127.0.0.1:${MOCK_OPENROUTER_PORT}`;

export interface ScriptedTurn {
  content?: string;
  toolCalls?: Array<{ name: string; arguments: Record<string, unknown> }>;
}

interface ChatRequest {
  messages: Array<{ role: string; content: string }>;
}

export interface MockOpenRouterHandle {
  stop: () => Promise<void>;
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  return text === '' ? {} : JSON.parse(text);
}

function valueAt(source: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) =>
    current !== null && typeof current === 'object' ? (current as Record<string, unknown>)[key] : undefined, source);
}

function resolveArguments(value: unknown, lastToolResult: unknown): unknown {
  if (typeof value === 'string' && value.startsWith('$tool:')) return valueAt(lastToolResult, value.slice('$tool:'.length));
  if (Array.isArray(value)) return value.map((item) => resolveArguments(item, lastToolResult));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveArguments(item, lastToolResult)]));
  }
  return value;
}

export async function startMockOpenRouter(): Promise<MockOpenRouterHandle> {
  const scripts = new Map<string, ScriptedTurn[]>();
  const received = new Map<string, ChatRequest[]>();

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const send = (status: number, body: unknown) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(body));
    };
    try {
      if (req.method === 'POST' && url.pathname === '/__script') {
        const { key, turns } = (await readJson(req)) as { key: string; turns: ScriptedTurn[] };
        scripts.set(key, [...turns]);
        received.set(key, []);
        send(200, { ok: true });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/__requests') {
        send(200, { requests: received.get(url.searchParams.get('key') ?? '') ?? [] });
        return;
      }
      if (req.method === 'POST' && url.pathname.endsWith('/chat/completions')) {
        const request = (await readJson(req)) as ChatRequest;
        const key = request.messages.find((message) => message.role === 'user')?.content ?? '';
        received.get(key)?.push(request);
        const turn = scripts.get(key)?.shift() ?? { content: 'No scripted reply.' };
        const lastTool = [...request.messages].reverse().find((message) => message.role === 'tool');
        const lastToolResult = lastTool === undefined ? null : JSON.parse(lastTool.content) as unknown;
        send(200, {
          choices: [{
            message: {
              content: turn.content ?? '',
              tool_calls: (turn.toolCalls ?? []).map((call, index) => ({
                id: `mock-call-${Date.now()}-${index}`,
                type: 'function',
                function: { name: call.name, arguments: JSON.stringify(resolveArguments(call.arguments, lastToolResult)) },
              })),
            },
            finish_reason: 'stop',
          }],
        });
        return;
      }
      send(404, { error: `mock-openrouter: no route for ${req.method} ${url.pathname}` });
    } catch (err) {
      send(500, { error: String(err) });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(MOCK_OPENROUTER_PORT, '127.0.0.1', () => resolve());
  });
  // eslint-disable-next-line no-console
  console.log(`[mock-openrouter] listening on ${MOCK_OPENROUTER_URL}`);
  return { stop: () => new Promise((resolve) => server.close(() => resolve())) };
}

/** Scripts the turns a conversation opening with `key` will get. */
export async function scriptOpenRouter(key: string, turns: ScriptedTurn[]): Promise<void> {
  const res = await fetch(`${MOCK_OPENROUTER_URL}/__script`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, turns }),
  });
  if (!res.ok) throw new Error(`mock-openrouter script failed: ${res.status}`);
}

/** The chat requests the platform sent for a conversation opening with `key`. */
export async function openRouterRequests(key: string): Promise<ChatRequest[]> {
  const res = await fetch(`${MOCK_OPENROUTER_URL}/__requests?key=${encodeURIComponent(key)}`);
  return ((await res.json()) as { requests: ChatRequest[] }).requests;
}
