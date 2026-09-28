import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { McpTapeCallSchema, type McpReplayMiss, type McpTape } from '@mediforce/platform-core';

/** Where an eval trial's MCP record/replay files live, inside the output directory. Never an Output File. */
export const MCP_TAPE_DIR = 'mcp-tape';

/**
 * MCP record/replay for eval trials (ADR-0023 D6): a dependency-free Node
 * script the agent's `mcp-config.json` starts in place of a server. It is
 * written into the output directory, so a container runs it from `/output`.
 *
 *   record <tape.jsonl> <command> [args…]  — proxies a stdio server
 *   record-http <tape.jsonl> <url>         — proxies a streamable-HTTP server;
 *                                            headers from MCP_TAPE_HEADERS (JSON)
 *   replay <tape.json> <misses.jsonl>      — answers from a recording
 *
 * Recording appends the result of every `tools/list` and `tools/call` to the
 * tape. Replay answers `tools/call` by tool and canonical arguments — the n-th
 * identical call gets the n-th recorded result, the last one repeating — and
 * answers an unrecorded call with an `isError` result, noting it as a miss.
 */
export const MCP_TAPE_SCRIPT = String.raw`import { spawn } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const [mode, tapePath, ...rest] = process.argv.slice(2);

function send(message) {
  process.stdout.write(JSON.stringify(message) + '\n');
}

function append(path, entry) {
  appendFileSync(path, JSON.stringify(entry) + '\n');
}

function parseMessages(text) {
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

function isRequest(message) {
  return message.id !== undefined && message.id !== null && typeof message.method === 'string';
}

function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value).filter((key) => value[key] !== undefined).sort();
    return '{' + keys.map((key) => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  }
  const text = JSON.stringify(value);
  return text === undefined ? 'null' : text;
}

function createRecorder() {
  const pending = new Map();
  return {
    request(message) {
      if (isRequest(message) && (message.method === 'tools/list' || message.method === 'tools/call')) {
        pending.set(JSON.stringify(message.id), message);
      }
    },
    response(message) {
      if (message.id === undefined || message.method !== undefined) return;
      const key = JSON.stringify(message.id);
      const request = pending.get(key);
      if (request === undefined) return;
      pending.delete(key);
      if (message.result === undefined || message.result === null) return;
      const params = request.params || {};
      if (request.method === 'tools/list') {
        append(tapePath, { kind: 'tools', tools: message.result.tools || [], cursor: params.cursor || null });
      } else {
        append(tapePath, { kind: 'call', tool: params.name, arguments: params.arguments || {}, result: message.result });
      }
    },
  };
}

function exitAfterFlush(code) {
  process.stdout.write('', () => process.exit(code));
}

function recordStdio(command, args) {
  const recorder = createRecorder();
  const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'inherit'] });
  child.on('error', (error) => {
    process.stderr.write('mcp-tape: cannot start ' + command + ': ' + error.message + '\n');
    process.exit(1);
  });
  child.on('close', (code) => exitAfterFlush(code === null ? 1 : code));
  createInterface({ input: process.stdin })
    .on('line', (line) => {
      for (const message of parseMessages(line)) recorder.request(message);
      child.stdin.write(line + '\n');
    })
    .on('close', () => child.stdin.end());
  createInterface({ input: child.stdout }).on('line', (line) => {
    for (const message of parseMessages(line)) recorder.response(message);
    process.stdout.write(line + '\n');
  });
}

function events(response, onData, more) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const next = async () => {
    while (more()) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const data = buffer.slice(0, boundary).split('\n')
          .filter((field) => field.startsWith('data:'))
          .map((field) => field.slice(5).replace(/^ /, ''))
          .join('\n');
        buffer = buffer.slice(boundary + 2);
        if (data !== '') onData(data);
        boundary = buffer.indexOf('\n\n');
      }
    }
  };
  return next().finally(() => reader.cancel().catch(() => undefined));
}

function recordHttp(url) {
  const headers = JSON.parse(process.env.MCP_TAPE_HEADERS || '{}');
  const recorder = createRecorder();
  const stopped = new AbortController();
  let sessionId = null;
  let protocolVersion = null;
  let listening = false;

  const deliver = (message) => {
    if (message.result && typeof message.result.protocolVersion === 'string') protocolVersion = message.result.protocolVersion;
    recorder.response(message);
    send(message);
  };
  const fail = (messages, reason) => {
    for (const message of messages) {
      if (isRequest(message)) send({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: reason } });
    }
  };
  const requestHeaders = (accept) => {
    const result = { ...headers, accept };
    if (sessionId !== null) result['mcp-session-id'] = sessionId;
    if (protocolVersion !== null) result['mcp-protocol-version'] = protocolVersion;
    return result;
  };

  // The server's own messages — list_changed, sampling, elicitation — arrive on
  // a standing GET stream, once the session is initialized. A server without
  // one answers 405, and then there is nothing to relay.
  async function listen() {
    listening = true;
    try {
      const response = await fetch(url, { method: 'GET', headers: requestHeaders('text/event-stream'), signal: stopped.signal });
      if (!response.ok || !(response.headers.get('content-type') || '').includes('text/event-stream')) return;
      await events(response, (data) => { for (const message of parseMessages(data)) deliver(message); }, () => true);
    } catch {
      // Closed on exit, or the server dropped it: the agent keeps working over POST.
    }
  }

  async function post(line) {
    const messages = parseMessages(line);
    for (const message of messages) recorder.request(message);
    const unanswered = new Set(messages.filter(isRequest).map((message) => JSON.stringify(message.id)));
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { ...requestHeaders('application/json, text/event-stream'), 'content-type': 'application/json' },
        body: line,
      });
      const session = response.headers.get('mcp-session-id');
      if (session !== null) sessionId = session;
      if (!response.ok) {
        const body = await response.text();
        fail(messages, 'MCP server answered HTTP ' + response.status + ': ' + body.slice(0, 500));
        return;
      }
      const receive = (text) => {
        for (const message of parseMessages(text)) {
          unanswered.delete(JSON.stringify(message.id));
          deliver(message);
        }
      };
      if ((response.headers.get('content-type') || '').includes('text/event-stream')) {
        await events(response, receive, () => unanswered.size > 0);
      } else {
        const body = await response.text();
        if (body.trim() !== '') receive(body);
      }
      if (listening === false && messages.some((message) => message.method === 'notifications/initialized')) listen();
    } catch (error) {
      fail(messages, 'MCP server unreachable: ' + (error instanceof Error ? error.message : String(error)));
    }
  }

  // Each message is posted as it arrives, so parallel tool calls stay parallel
  // and the agent's answer to a server request inside a stream is never held
  // behind that stream. Only initialize goes first: its answer carries the session.
  const inFlight = new Set();
  let initialized = Promise.resolve();
  createInterface({ input: process.stdin })
    .on('line', (line) => {
      const initializing = parseMessages(line).some((message) => message.method === 'initialize');
      const posted = (initializing ? post(line) : initialized.then(() => post(line))).finally(() => inFlight.delete(posted));
      if (initializing) initialized = posted;
      inFlight.add(posted);
    })
    .on('close', () => {
      Promise.all(inFlight).then(() => {
        stopped.abort();
        exitAfterFlush(0);
      });
    });
}

function replay(missesPath) {
  const tape = JSON.parse(readFileSync(tapePath, 'utf8'));
  const served = new Map();
  const answer = (message) => {
    if (!isRequest(message)) return;
    const { id, method } = message;
    const params = message.params || {};
    if (method === 'initialize') {
      send({ jsonrpc: '2.0', id, result: {
        protocolVersion: params.protocolVersion || '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'mediforce-mcp-replay', version: '1' },
      } });
    } else if (method === 'ping') {
      send({ jsonrpc: '2.0', id, result: {} });
    } else if (method === 'tools/list') {
      send({ jsonrpc: '2.0', id, result: { tools: tape.tools } });
    } else if (method === 'tools/call') {
      const args = params.arguments || {};
      const key = params.name + ' ' + canonical(args);
      const matches = tape.calls.filter((call) => call.tool + ' ' + canonical(call.arguments) === key);
      if (matches.length === 0) {
        append(missesPath, { ts: new Date().toISOString(), tool: params.name, arguments: args });
        send({ jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text:
          'No recorded response for ' + params.name + ' with these arguments. This eval trial replays the MCP '
          + 'responses a live trial of the same Eval Case recorded, and this call was not among them.' }] } });
        return;
      }
      const occurrence = served.get(key) || 0;
      served.set(key, occurrence + 1);
      send({ jsonrpc: '2.0', id, result: matches[Math.min(occurrence, matches.length - 1)].result });
    } else {
      send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found: ' + method } });
    }
  };
  createInterface({ input: process.stdin }).on('line', (line) => {
    for (const message of parseMessages(line)) answer(message);
  });
}

if (mode === 'replay') replay(rest[0]);
else if (mode === 'record') recordStdio(rest[0], rest.slice(1));
else if (mode === 'record-http') recordHttp(rest[0]);
else {
  process.stderr.write('usage: mcp-tape.mjs record <tape> <command> [args...] | record-http <tape> <url> | replay <tape> <misses>\n');
  process.exit(2);
}
`;

const RecordedLineSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('tools'), tools: z.array(z.record(z.string(), z.unknown())), cursor: z.string().nullable() }),
  McpTapeCallSchema.extend({ kind: z.literal('call') }),
]);

async function readLines(path: string): Promise<unknown[] | null> {
  let text: string;
  try {
    text = await readFile(path, 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  return text.split('\n').flatMap((line) => {
    if (line.trim() === '') return [];
    try {
      return [JSON.parse(line) as unknown];
    } catch {
      return [];
    }
  });
}

/**
 * The tape the `record` modes wrote: the last tool list (its pages joined) and
 * every call in order. Null when the server was never started; a line that does
 * not parse is left out.
 */
export async function readRecordedTape(path: string): Promise<McpTape | null> {
  const lines = await readLines(path);
  if (lines === null) return null;
  const tape: McpTape = { tools: [], calls: [] };
  for (const line of lines) {
    const parsed = RecordedLineSchema.safeParse(line);
    if (!parsed.success) continue;
    if (parsed.data.kind === 'tools') {
      tape.tools = parsed.data.cursor === null ? parsed.data.tools : [...tape.tools, ...parsed.data.tools];
    } else {
      const { kind: _kind, ...call } = parsed.data;
      tape.calls.push(call);
    }
  }
  return tape;
}

const MissLineSchema = z.object({ ts: z.iso.datetime(), tool: z.string().min(1), arguments: z.record(z.string(), z.unknown()) });

/** The calls `replay` could not answer from its tape, each with when it was made. */
export async function readReplayMisses(path: string, server: string): Promise<{ ts: string; miss: McpReplayMiss }[]> {
  return ((await readLines(path)) ?? []).flatMap((line) => {
    const parsed = MissLineSchema.safeParse(line);
    if (!parsed.success) return [];
    const { ts, ...call } = parsed.data;
    return [{ ts, miss: { server, ...call } }];
  });
}
