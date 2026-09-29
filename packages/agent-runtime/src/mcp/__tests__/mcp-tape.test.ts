import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { canonicalJson } from '@mediforce/platform-core';
import { MCP_TAPE_SCRIPT, readRecordedTape, readReplayMisses } from '../mcp-tape';

/** A stdio MCP server that echoes a tool call's arguments back as its result. */
const FAKE_SERVER = `
import { createInterface } from 'node:readline';
const send = (message) => process.stdout.write(JSON.stringify(message) + '\\n');
createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line);
  if (message.id === undefined) return;
  if (message.method === 'initialize') send({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'edc', version: '1' } } });
  if (message.method === 'tools/list') send({ jsonrpc: '2.0', id: message.id, result: { tools: [{ name: 'read_record', inputSchema: { type: 'object' } }] } });
  if (message.method === 'tools/call') send({ jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: 'record ' + message.params.arguments.subject }] } });
});
`;

const INITIALIZE = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } };
const INITIALIZED = { jsonrpc: '2.0', method: 'notifications/initialized' };
const LIST = { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} };
const callFor = (id: number, subject: string) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'read_record', arguments: { subject } } });

type RpcMessage = { id?: number; method?: string; result?: Record<string, unknown>; error?: unknown };

/**
 * Runs the tape script with `args`, feeds it `messages` a line each, and
 * returns what it wrote to stdout. With `waitFor`, stdin stays open until a
 * message of that method has come out.
 */
function converse(
  dir: string,
  args: string[],
  messages: readonly object[],
  env: Record<string, string> = {},
  waitFor?: string,
): Promise<RpcMessage[]> {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [join(dir, 'mcp-tape.mjs'), ...args], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'inherit'] });
    let stdout = '';
    const parsed = () => stdout.split('\n').filter((line) => line !== '').map((line) => JSON.parse(line) as RpcMessage);
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      if (waitFor !== undefined && parsed().some((message) => message.method === waitFor)) child.stdin.end();
    });
    child.on('error', reject);
    child.on('close', () => resolve(parsed()));
    for (const message of messages) child.stdin.write(`${JSON.stringify(message)}\n`);
    if (waitFor === undefined) child.stdin.end();
  });
}

describe('mcp-tape script (ADR-0023 D6)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mcp-tape-test-'));
    await writeFile(join(dir, 'mcp-tape.mjs'), MCP_TAPE_SCRIPT, 'utf-8');
    await writeFile(join(dir, 'fake-server.mjs'), FAKE_SERVER, 'utf-8');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('records a stdio server\'s tool list and calls while passing every answer through', async () => {
    const tapePath = join(dir, 'edc.tape.jsonl');
    const answers = await converse(dir, ['record', tapePath, 'node', join(dir, 'fake-server.mjs')], [INITIALIZE, INITIALIZED, LIST, callFor(3, '1001')]);

    expect(answers.map((answer) => answer.id)).toEqual([1, 2, 3]);
    expect(answers[2]!.result).toEqual({ content: [{ type: 'text', text: 'record 1001' }] });
    expect(await readRecordedTape(tapePath)).toEqual({
      tools: [{ name: 'read_record', inputSchema: { type: 'object' } }],
      calls: [{ tool: 'read_record', arguments: { subject: '1001' }, result: { content: [{ type: 'text', text: 'record 1001' }] } }],
    });
  });

  it('replays recorded calls whatever their argument order, and answers an unrecorded or extra one with an error it notes as a miss', async () => {
    const tapePath = join(dir, 'edc.replay.json');
    const missesPath = join(dir, 'edc.misses.jsonl');
    await writeFile(tapePath, JSON.stringify({
      tools: [{ name: 'read_record', inputSchema: { type: 'object' } }],
      calls: [
        { tool: 'read_record', arguments: { subject: '1001', visit: 1 }, result: { content: [{ type: 'text', text: 'first' }] } },
        { tool: 'read_record', arguments: { visit: 1, subject: '1001' }, result: { content: [{ type: 'text', text: 'second' }] } },
      ],
    }));
    const call = (id: number, args: Record<string, unknown>) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'read_record', arguments: args } });

    const answers = await converse(dir, ['replay', tapePath, missesPath], [
      INITIALIZE, INITIALIZED, LIST,
      call(3, { visit: 1, subject: '1001' }), call(4, { subject: '1001', visit: 1 }), call(5, { subject: '1001', visit: 1 }),
      call(6, { subject: '9999' }),
    ]);

    expect(answers.find((answer) => answer.id === 2)!.result).toEqual({ tools: [{ name: 'read_record', inputSchema: { type: 'object' } }] });
    expect([3, 4].map((id) => answers.find((answer) => answer.id === id)!.result)).toEqual([
      { content: [{ type: 'text', text: 'first' }] },
      { content: [{ type: 'text', text: 'second' }] },
    ]);
    expect(answers.find((answer) => answer.id === 5)!.result).toMatchObject({ isError: true });
    expect(answers.find((answer) => answer.id === 6)!.result).toMatchObject({ isError: true });
    expect(await readReplayMisses(missesPath, 'edc')).toEqual([
      { ts: expect.any(String), miss: { server: 'edc', tool: 'read_record', arguments: { subject: '1001', visit: 1 } } },
      { ts: expect.any(String), miss: { server: 'edc', tool: 'read_record', arguments: { subject: '9999' } } },
    ]);
  });

  it('refuses to read a misses file with a line it cannot parse, rather than count one miss fewer', async () => {
    const missesPath = join(dir, 'edc.misses.jsonl');
    await writeFile(missesPath, `${JSON.stringify({ ts: '2026-09-28T10:00:00.000Z', tool: 'read_record', arguments: {} })}\n{"ts":"2026-09\n`);

    await expect(readReplayMisses(missesPath, 'edc')).rejects.toThrow();
  });

  it('keys a call as the platform merging recordings does, so the two never disagree on which calls are equal', () => {
    const source = /function canonical\(value\) \{[\s\S]*?\n\}\n/.exec(MCP_TAPE_SCRIPT)?.[0];
    expect(source).toBeDefined();
    const canonical = new Function(`${source}\nreturn canonical;`)() as (value: unknown) => string;
    const samples: unknown[] = [
      { subject: '1001', visit: { day: 1, arm: 'A', notes: undefined } },
      { ids: [3, 1, { b: null, a: [true, 'x'] }], 'key with "quotes"': 1.5 },
      [],
      {},
      null,
      'text',
      0,
    ];
    for (const sample of samples) expect(canonical(sample)).toBe(canonicalJson(sample));
  });

  describe('record-http', () => {
    let server: Server;
    let url: string;
    let serverStream: string | null;
    let holdFirstCall: boolean;
    let requestInCallStream: object | null;
    const seen: Array<{ headers: Record<string, unknown>; body: { method?: string } }> = [];
    const events: string[] = [];

    beforeEach(async () => {
      seen.length = 0;
      events.length = 0;
      serverStream = null;
      holdFirstCall = false;
      requestInCallStream = null;
      let heldCall: (() => void) | null = null;
      server = createServer((request, response) => {
        if (request.method === 'GET') {
          if (serverStream === null) {
            response.writeHead(405).end();
            return;
          }
          response.writeHead(200, { 'content-type': 'text/event-stream' });
          response.write(`data: ${serverStream}\n\n`);
          return;
        }
        let body = '';
        request.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        request.on('end', () => {
          const message = JSON.parse(body) as { id?: number; method?: string; params?: { arguments?: { subject?: string } } };
          seen.push({ headers: request.headers, body: message });
          events.push(`received ${message.method}`);
          if (message.id === undefined) {
            setTimeout(() => {
              events.push(`answered ${message.method}`);
              response.writeHead(202).end();
            }, 50);
          } else if (message.method === 'initialize') {
            response.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'session-1' })
              .end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'email', version: '1' } } }));
          } else if (message.method === 'tools/list') {
            response.writeHead(200, { 'content-type': 'application/json' })
              .end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { tools: [{ name: 'read_record' }] } }));
          } else {
            const answer = () => {
              response.writeHead(200, { 'content-type': 'text/event-stream' });
              const respond = () => {
                response.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: `record ${message.params?.arguments?.subject}` }] } })}\n\n`);
                response.end();
              };
              if (requestInCallStream === null) {
                respond();
              } else {
                response.write(`data: ${JSON.stringify(requestInCallStream)}\n\n`);
                setTimeout(respond, 50);
              }
            };
            if (holdFirstCall && heldCall === null) {
              heldCall = answer;
            } else {
              answer();
              heldCall?.();
            }
          }
        });
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
    });

    afterEach(async () => {
      await new Promise((resolve) => server.close(resolve));
    });

    it('proxies a streamable-HTTP server with its headers and session, and records JSON and SSE answers', async () => {
      const tapePath = join(dir, 'email.tape.jsonl');
      const answers = await converse(dir, ['record-http', tapePath, url], [INITIALIZE, INITIALIZED, LIST, callFor(3, '1001')], {
        MCP_TAPE_HEADERS: JSON.stringify({ 'x-key': 'k-1' }),
      });

      expect(answers.map((answer) => answer.id)).toEqual([1, 2, 3]);
      expect(seen.map((request) => request.headers['x-key'])).toEqual(['k-1', 'k-1', 'k-1', 'k-1']);
      expect(seen[0]!.body.method).toBe('initialize');
      expect(seen.slice(1).map((request) => request.headers['mcp-session-id'])).toEqual(['session-1', 'session-1', 'session-1']);
      expect(await readRecordedTape(tapePath)).toEqual({
        tools: [{ name: 'read_record' }],
        calls: [{ tool: 'read_record', arguments: { subject: '1001' }, result: { content: [{ type: 'text', text: 'record 1001' }] } }],
      });
    });

    it('posts nothing before the server has taken the initialized notification', async () => {
      await converse(dir, ['record-http', join(dir, 'email.tape.jsonl'), url], [INITIALIZE, INITIALIZED, LIST]);

      expect(events.slice(0, 4)).toEqual([
        'received initialize', 'received notifications/initialized', 'answered notifications/initialized', 'received tools/list',
      ]);
    });

    it('keeps reading a call\'s stream past a server request that shares the call\'s id', async () => {
      requestInCallStream = { jsonrpc: '2.0', id: 3, method: 'sampling/createMessage', params: { messages: [] } };
      const answers = await converse(dir, ['record-http', join(dir, 'email.tape.jsonl'), url], [INITIALIZE, INITIALIZED, callFor(3, '1001')]);

      expect(answers).toContainEqual(expect.objectContaining({ id: 3, method: 'sampling/createMessage' }));
      expect(answers).toContainEqual(expect.objectContaining({ id: 3, result: { content: [{ type: 'text', text: 'record 1001' }] } }));
    });

    it('posts calls in parallel, so one the server holds back never blocks the next', async () => {
      holdFirstCall = true;
      const answers = await converse(dir, ['record-http', join(dir, 'email.tape.jsonl'), url], [INITIALIZE, INITIALIZED, callFor(3, '1001'), callFor(4, '1002')]);

      expect(events.filter((event) => event === 'received tools/call')).toHaveLength(2);
      expect(answers.filter((answer) => answer.id === 3 || answer.id === 4).map((answer) => answer.id).sort()).toEqual([3, 4]);
    });

    it('relays what the server sends on its own stream once the session is initialized', async () => {
      serverStream = JSON.stringify({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' });
      const answers = await converse(dir, ['record-http', join(dir, 'email.tape.jsonl'), url], [INITIALIZE, INITIALIZED, LIST], {}, 'notifications/tools/list_changed');

      expect(answers).toContainEqual({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' });
    });
  });
});
