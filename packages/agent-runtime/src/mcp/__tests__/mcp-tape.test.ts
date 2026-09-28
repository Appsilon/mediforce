import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

type RpcMessage = { id?: number; result?: Record<string, unknown>; error?: unknown };

/** Runs the tape script with `args`, feeds it `messages` a line each, and returns what it wrote to stdout. */
function converse(dir: string, args: string[], messages: readonly object[], env: Record<string, string> = {}): Promise<RpcMessage[]> {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [join(dir, 'mcp-tape.mjs'), ...args], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'inherit'] });
    let stdout = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.on('error', reject);
    child.on('close', () => resolve(stdout.split('\n').filter((line) => line !== '').map((line) => JSON.parse(line) as RpcMessage)));
    for (const message of messages) child.stdin.write(`${JSON.stringify(message)}\n`);
    child.stdin.end();
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

  it('replays recorded calls whatever their argument order, and answers an unrecorded one with an error it notes as a miss', async () => {
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
    expect([3, 4, 5].map((id) => answers.find((answer) => answer.id === id)!.result)).toEqual([
      { content: [{ type: 'text', text: 'first' }] },
      { content: [{ type: 'text', text: 'second' }] },
      { content: [{ type: 'text', text: 'second' }] },
    ]);
    expect(answers.find((answer) => answer.id === 6)!.result).toMatchObject({ isError: true });
    expect(await readReplayMisses(missesPath, 'edc')).toEqual([{ server: 'edc', tool: 'read_record', arguments: { subject: '9999' } }]);
  });

  describe('record-http', () => {
    let server: Server;
    let url: string;
    const seen: Array<{ headers: Record<string, unknown>; body: { method?: string } }> = [];

    beforeEach(async () => {
      seen.length = 0;
      server = createServer((request, response) => {
        let body = '';
        request.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        request.on('end', () => {
          const message = JSON.parse(body) as { id?: number; method?: string; params?: { arguments?: { subject?: string } } };
          seen.push({ headers: request.headers, body: message });
          if (message.id === undefined) {
            response.writeHead(202).end();
          } else if (message.method === 'initialize') {
            response.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'session-1' })
              .end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'email', version: '1' } } }));
          } else if (message.method === 'tools/list') {
            response.writeHead(200, { 'content-type': 'application/json' })
              .end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { tools: [{ name: 'read_record' }] } }));
          } else {
            response.writeHead(200, { 'content-type': 'text/event-stream' });
            response.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: `record ${message.params?.arguments?.subject}` }] } })}\n\n`);
            response.end();
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
      expect(seen.slice(1).map((request) => request.headers['mcp-session-id'])).toEqual(['session-1', 'session-1', 'session-1']);
      expect(await readRecordedTape(tapePath)).toEqual({
        tools: [{ name: 'read_record' }],
        calls: [{ tool: 'read_record', arguments: { subject: '1001' }, result: { content: [{ type: 'text', text: 'record 1001' }] } }],
      });
    });
  });
});
