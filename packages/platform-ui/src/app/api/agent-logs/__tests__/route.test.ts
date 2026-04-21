import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { GET } from '../route';

const LOGS_DIR = join(tmpdir(), 'mediforce-agent-logs');

function makeRequest(file: string | null): NextRequest {
  const url = new URL('http://localhost/api/agent-logs');
  if (file !== null) url.searchParams.set('file', file);
  return new NextRequest(url);
}

describe('GET /api/agent-logs', () => {
  beforeEach(async () => {
    await mkdir(LOGS_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(LOGS_DIR, { recursive: true, force: true }).catch(() => {});
  });

  it('returns the content of a seeded log file', async () => {
    const filename = 'inst-abc_step-1_2026-04-21T00-00-00-000Z.log';
    const logBody = [
      JSON.stringify({ ts: '2026-04-21T00:00:00.000Z', type: 'assistant', subtype: 'tool_call', tool: 'Read' }),
      JSON.stringify({ ts: '2026-04-21T00:00:01.000Z', type: 'result', subtype: 'success' }),
      '',
    ].join('\n');
    await writeFile(join(LOGS_DIR, filename), logBody, 'utf-8');

    const res = await GET(makeRequest(filename));
    expect(res.status).toBe(200);
    const body = await res.json() as { content: string; path: string };

    expect(body.content).toBe(logBody);
    expect(body.path.endsWith(`mediforce-agent-logs/${filename}`)).toBe(true);
  });

  it('returns empty content with a soft error when the file does not exist', async () => {
    const res = await GET(makeRequest('does-not-exist.log'));
    expect(res.status).toBe(200);
    const body = await res.json() as { content: string; error?: string };
    expect(body.content).toBe('');
    expect(body.error).toBeDefined();
  });

  it('rejects missing file parameter with 400', async () => {
    const res = await GET(makeRequest(null));
    expect(res.status).toBe(400);
  });

  it('rejects path traversal attempts', async () => {
    const res1 = await GET(makeRequest('../etc/passwd'));
    expect(res1.status).toBe(400);

    const res2 = await GET(makeRequest('subdir/file.log'));
    expect(res2.status).toBe(400);
  });
});
