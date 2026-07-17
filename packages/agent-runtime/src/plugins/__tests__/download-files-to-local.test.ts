import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadFilesToLocal, cleanupTempDir } from '../base-container-agent-plugin';

/** Capture the (url, init) each fetch was called with, and serve fixed bytes. */
function stubFetch(bytes = 'hello') {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const impl = vi.fn(async (input: unknown, init?: { headers?: Record<string, string> }) => {
    calls.push({ url: String(input), headers: init?.headers ?? {} });
    return new Response(bytes, { status: 200 });
  });
  vi.stubGlobal('fetch', impl);
  return calls;
}

describe('downloadFilesToLocal', () => {
  const OLD_ENV = { ...process.env };
  let tempDir: string | null = null;

  beforeEach(() => {
    process.env.APP_BASE_URL = 'https://cdisc.mediforce.ai';
    process.env.PLATFORM_API_KEY = 'test-key';
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
    tempDir = null;
    vi.unstubAllGlobals();
    process.env = { ...OLD_ENV };
  });

  it('passes through input with no files unchanged', async () => {
    const input = { foo: 'bar' };
    const { updatedInput, tempDir: td } = await downloadFilesToLocal(input);
    expect(updatedInput).toBe(input);
    expect(td).toBeNull();
  });

  it('resolves a browser-relative attachment URL to absolute and attaches X-Api-Key', async () => {
    const calls = stubFetch('usdm-bytes');
    const { updatedInput, tempDir: td } = await downloadFilesToLocal({
      files: [{ name: 'study.json', downloadUrl: '/api/attachments/abc-123/blob' }],
    });
    tempDir = td;

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://cdisc.mediforce.ai/api/attachments/abc-123/blob');
    expect(calls[0].headers['X-Api-Key']).toBe('test-key');

    const file = (updatedInput as { files: Array<{ localPath: string }> }).files[0];
    expect(file.localPath).toBe(join(td!, 'study.json'));
    expect(await readFile(file.localPath, 'utf8')).toBe('usdm-bytes');
  });

  it('attaches the API key to an already-absolute same-origin URL', async () => {
    const calls = stubFetch();
    const { tempDir: td } = await downloadFilesToLocal({
      files: [{ name: 'y.json', downloadUrl: 'https://cdisc.mediforce.ai/api/attachments/abc-123/blob' }],
    });
    tempDir = td;

    expect(calls[0].url).toBe('https://cdisc.mediforce.ai/api/attachments/abc-123/blob');
    expect(calls[0].headers['X-Api-Key']).toBe('test-key');
  });

  it('does not send the API key to a third-party absolute URL', async () => {
    const calls = stubFetch();
    const { tempDir: td } = await downloadFilesToLocal({
      files: [{ name: 'x.json', downloadUrl: 'https://example.com/x.json' }],
    });
    tempDir = td;

    expect(calls[0].url).toBe('https://example.com/x.json');
    expect(calls[0].headers['X-Api-Key']).toBeUndefined();
  });

  it('throws with the file name when the download responds non-2xx', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })));
    await expect(
      downloadFilesToLocal({
        files: [{ name: 'missing.json', downloadUrl: '/api/attachments/gone/blob' }],
      }),
    ).rejects.toThrow(/missing\.json.*HTTP 404/);
  });
});
