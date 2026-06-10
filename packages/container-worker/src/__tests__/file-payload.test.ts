import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodeFilePayload, decodeFilePayload } from '../file-payload';

/** Every possible byte value — catches any lossy text-encoding round-trip. */
const allBytes = Buffer.from(Array.from({ length: 256 }, (_, index) => index));

describe('encodeFilePayload / decodeFilePayload', () => {
  let sourceDir: string;
  let targetDir: string;

  beforeEach(async () => {
    sourceDir = await mkdtemp(join(tmpdir(), 'file-payload-src-'));
    targetDir = await mkdtemp(join(tmpdir(), 'file-payload-dst-'));
  });

  afterEach(async () => {
    await rm(sourceDir, { recursive: true, force: true });
    await rm(targetDir, { recursive: true, force: true });
  });

  it('round-trips binary content byte-for-byte', async () => {
    await writeFile(join(sourceDir, 'report.pdf'), allBytes);

    const payload = await encodeFilePayload(sourceDir);
    await decodeFilePayload(payload, targetDir);

    const restored = await readFile(join(targetDir, 'report.pdf'));
    expect(restored.equals(allBytes)).toBe(true);
  });

  it('survives JSON serialization (the BullMQ/Redis transit format)', async () => {
    await writeFile(join(sourceDir, 'archive.zip'), allBytes);

    const payload = await encodeFilePayload(sourceDir);
    const afterRedisTransit = JSON.parse(JSON.stringify(payload)) as Record<string, string>;
    await decodeFilePayload(afterRedisTransit, targetDir);

    const restored = await readFile(join(targetDir, 'archive.zip'));
    expect(restored.equals(allBytes)).toBe(true);
  });

  it('round-trips nested directories using POSIX relative-path keys', async () => {
    await mkdir(join(sourceDir, 'charts', 'q1'), { recursive: true });
    await writeFile(join(sourceDir, 'charts', 'q1', 'plot.png'), allBytes);
    await writeFile(join(sourceDir, 'summary.txt'), 'plain text', 'utf-8');

    const payload = await encodeFilePayload(sourceDir);
    expect(Object.keys(payload).sort()).toEqual(['charts/q1/plot.png', 'summary.txt']);

    await decodeFilePayload(payload, targetDir);

    const restoredPlot = await readFile(join(targetDir, 'charts', 'q1', 'plot.png'));
    expect(restoredPlot.equals(allBytes)).toBe(true);
    expect(await readFile(join(targetDir, 'summary.txt'), 'utf-8')).toBe('plain text');
  });

  it('returns an empty payload for an empty directory', async () => {
    expect(await encodeFilePayload(sourceDir)).toEqual({});
  });

  it('creates the target directory even for an empty payload', async () => {
    const nestedTarget = join(targetDir, 'not-yet-created');
    await decodeFilePayload({}, nestedTarget);
    await expect(readFile(nestedTarget)).rejects.toMatchObject({ code: 'EISDIR' });
  });

  it('rejects payload keys that escape the target directory', async () => {
    const harmless = Buffer.from('hi').toString('base64');
    await expect(decodeFilePayload({ '../escape.txt': harmless }, targetDir)).rejects.toThrow(/escapes/);
    await expect(decodeFilePayload({ '/etc/escape.txt': harmless }, targetDir)).rejects.toThrow(/escapes/);
  });

  it('rejects a missing source directory so callers can decide how to degrade', async () => {
    await expect(encodeFilePayload(join(sourceDir, 'does-not-exist'))).rejects.toThrow();
  });
});
