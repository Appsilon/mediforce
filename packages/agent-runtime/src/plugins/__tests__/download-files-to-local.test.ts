import { readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
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
    expect(file.localPath).toBe(join(td!, '0', 'study.json'));
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

  it('keeps a traversing file name inside the temp dir', async () => {
    stubFetch('payload');
    const { updatedInput, tempDir: td } = await downloadFilesToLocal({
      files: [{ name: '../../escape.txt', downloadUrl: '/api/attachments/abc-123/blob' }],
    });
    tempDir = td;

    const file = (updatedInput as { files: Array<{ localPath: string }> }).files[0];
    expect(file.localPath).toBe(join(td!, '0', 'escape.txt'));
    expect(await readFile(file.localPath, 'utf8')).toBe('payload');
  });

  it('gives duplicate file names distinct local paths with their own bytes', async () => {
    let call = 0;
    vi.stubGlobal('fetch', vi.fn(async () => new Response(`bytes-${call++}`, { status: 200 })));
    const { updatedInput, tempDir: td } = await downloadFilesToLocal({
      files: [
        { name: 'data.csv', downloadUrl: '/api/attachments/a/blob' },
        { name: 'data.csv', downloadUrl: '/api/attachments/b/blob' },
      ],
    });
    tempDir = td;

    const files = (updatedInput as { files: Array<{ localPath: string }> }).files;
    expect(files[0].localPath).not.toBe(files[1].localPath);
    expect(await readFile(files[0].localPath, 'utf8')).toBe('bytes-0');
    expect(await readFile(files[1].localPath, 'utf8')).toBe('bytes-1');
  });

  it('removes the temp directory when a later download fails', async () => {
    const before = new Set((await readdir(tmpdir())).filter((entry) => entry.startsWith('mediforce-agent-')));
    let call = 0;
    vi.stubGlobal('fetch', vi.fn(async () => (call++ === 0 ? new Response('ok') : new Response('nope', { status: 500 }))));
    await expect(
      downloadFilesToLocal({
        files: [
          { name: 'one.json', downloadUrl: '/api/attachments/a/blob' },
          { name: 'two.json', downloadUrl: '/api/attachments/b/blob' },
        ],
      }),
    ).rejects.toThrow(/two\.json.*HTTP 500/);

    const leaked = (await readdir(tmpdir())).filter((entry) => entry.startsWith('mediforce-agent-') && !before.has(entry));
    expect(leaked).toEqual([]);
  });
});
