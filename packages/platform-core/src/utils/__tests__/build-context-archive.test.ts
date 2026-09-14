import { describe, it, expect } from 'vitest';
import {
  BUILD_CONTEXT_MAX_BYTES,
  buildContextDockerfileProblem,
  checkBuildContextArchive,
  checkBuildContextSize,
  listBuildContextArchive,
  packBuildContextArchive,
  type BuildContextArchiveEntry,
} from '../build-context-archive';

const encoder = new TextEncoder();

function file(path: string, content = 'x', executable = false): BuildContextArchiveEntry {
  return { kind: 'file', path, content: encoder.encode(content), executable };
}

/** A raw ustar header, for the archives a client of ours would never write. */
function rawHeader(name: string, typeflag: string, size = 0, linkname = ''): Uint8Array {
  const block = new Uint8Array(512);
  const put = (offset: number, value: string) => block.set(encoder.encode(value), offset);
  put(0, name);
  put(100, '0000644\0');
  put(108, '0000000\0');
  put(116, '0000000\0');
  put(124, `${size.toString(8).padStart(11, '0')}\0`);
  put(136, '00000000000\0');
  put(148, '        ');
  put(156, typeflag);
  put(157, linkname);
  put(257, 'ustar\0');
  put(263, '00');
  const sum = block.reduce((total, byte) => total + byte, 0);
  put(148, `${sum.toString(8).padStart(6, '0')}\0 `);
  return block;
}

function archiveOf(...blocks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(blocks.reduce((total, block) => total + block.length, 0) + 1024);
  let offset = 0;
  for (const block of blocks) {
    out.set(block, offset);
    offset += block.length;
  }
  return out;
}

describe('packBuildContextArchive / listBuildContextArchive', () => {
  it('round-trips files, directories and symlinks', () => {
    const archive = packBuildContextArchive([
      { kind: 'directory', path: 'scripts' },
      file('scripts/run.sh', 'echo hi\n', true),
      file('Dockerfile', 'FROM alpine\n'),
      { kind: 'symlink', path: 'current', target: 'scripts' },
    ]);

    expect(archive.length % 512).toBe(0);
    expect(listBuildContextArchive(archive)).toEqual([
      { path: 'scripts/', kind: 'directory', size: 0, linkTarget: '' },
      { path: 'scripts/run.sh', kind: 'file', size: 8, linkTarget: '' },
      { path: 'Dockerfile', kind: 'file', size: 12, linkTarget: '' },
      { path: 'current', kind: 'symlink', size: 0, linkTarget: 'scripts' },
    ]);
  });

  it('keeps a path longer than the 100 bytes a ustar name holds', () => {
    const deep = `${'nested/'.repeat(30)}Dockerfile`;
    const archive = packBuildContextArchive([file(deep)]);

    expect(listBuildContextArchive(archive).map((entry) => entry.path)).toEqual([deep]);
  });

  it('writes the executable bit a COPYd entrypoint needs', () => {
    const archive = packBuildContextArchive([file('run.sh', 'x', true), file('data.txt')]);
    const modeOf = (headerOffset: number) =>
      new TextDecoder().decode(archive.subarray(headerOffset + 100, headerOffset + 107));

    expect(modeOf(0)).toBe('0000755');
    expect(modeOf(1024)).toBe('0000644');
  });

  it('refuses bytes that are not a tar archive', () => {
    expect(() => listBuildContextArchive(encoder.encode('FROM alpine\n'.repeat(100)))).toThrow();
  });

  it('refuses an archive cut off mid-file', () => {
    const archive = packBuildContextArchive([file('big.bin', 'y'.repeat(2000))]);

    expect(() => listBuildContextArchive(archive.subarray(0, 1024))).toThrow();
  });
});

describe('checkBuildContextArchive', () => {
  const valid = () =>
    packBuildContextArchive([file('Dockerfile', 'FROM alpine\n'), file('scripts/run.sh')]);

  it('accepts a context holding the Dockerfile it names', () => {
    expect(checkBuildContextArchive(valid(), 'Dockerfile')).toEqual({ ok: true });
    // Empty means the default, as it does for a repo build.
    expect(checkBuildContextArchive(valid(), '')).toEqual({ ok: true });
  });

  it('reads the Dockerfile path from the context root, the way a named repo context does', () => {
    const archive = packBuildContextArchive([file('container/Dockerfile'), file('scripts/run.sh')]);

    expect(checkBuildContextArchive(archive, 'container/Dockerfile')).toEqual({ ok: true });
    expect(checkBuildContextArchive(archive, './container/Dockerfile')).toEqual({ ok: true });
  });

  it('says which Dockerfile is missing', () => {
    const result = checkBuildContextArchive(valid(), 'container/Dockerfile');

    expect(result).toEqual({
      ok: false,
      reason: 'invalid',
      message: expect.stringContaining('container/Dockerfile'),
    });
  });

  it('refuses a Dockerfile path that leaves the context', () => {
    expect(checkBuildContextArchive(valid(), '../Dockerfile')).toMatchObject({
      ok: false,
      reason: 'invalid',
    });
  });

  it('refuses an oversized context before reading a byte of it', () => {
    const oversized = new Uint8Array(BUILD_CONTEXT_MAX_BYTES + 1);

    expect(checkBuildContextArchive(oversized, 'Dockerfile')).toMatchObject({
      ok: false,
      reason: 'too_large',
      message: expect.stringContaining('limit'),
    });
  });

  it('names the largest top-level entries of an oversized context, so the fix is obvious', () => {
    const megabytes = (count: number) => count * 1024 * 1024;
    const result = checkBuildContextSize(megabytes(337), [
      { path: 'sample-data/study-1/dm.xpt', size: megabytes(200) },
      { path: 'sample-data/study-2/ae.xpt', size: megabytes(136) },
      { path: 'scripts/run.sh', size: 2048 },
      { path: 'demo-console/app.js', size: megabytes(1) },
      { path: 'README.md', size: 4096 },
    ]);

    expect(result).toMatchObject({ ok: false, reason: 'too_large' });
    expect(result.ok === false ? result.message : '').toContain(
      'Largest: sample-data/ (336.0 MB), demo-console/ (1.0 MB), README.md (4.0 KB).',
    );
    expect(result.ok === false ? result.message : '').toContain('.dockerignore');
  });

  it('refuses something that is not an archive', () => {
    expect(checkBuildContextArchive(encoder.encode('FROM alpine\n'), 'Dockerfile')).toMatchObject({
      ok: false,
      reason: 'invalid',
    });
  });

  it('refuses an entry that climbs out of the context', () => {
    const archive = archiveOf(
      packBuildContextArchive([file('Dockerfile')]).subarray(0, 1024),
      rawHeader('../../etc/cron.d/x', '0'),
    );

    expect(checkBuildContextArchive(archive, 'Dockerfile')).toMatchObject({
      ok: false,
      reason: 'invalid',
      message: expect.stringContaining('../../etc/cron.d/x'),
    });
  });

  it('refuses an absolute entry path rather than reading it from the context root', () => {
    const archive = archiveOf(
      packBuildContextArchive([file('Dockerfile')]).subarray(0, 1024),
      rawHeader('/etc/cron.d/x', '0'),
    );

    expect(checkBuildContextArchive(archive, 'Dockerfile')).toMatchObject({
      ok: false,
      reason: 'invalid',
      message: expect.stringContaining('/etc/cron.d/x'),
    });
  });

  it('refuses an entry written through a symlink, wherever the link sits in the archive', () => {
    // Extracting `escape -> /` and then `escape/etc/x` writes to the host, so
    // the entry is refused even when the link comes after it.
    const archive = archiveOf(
      packBuildContextArchive([file('Dockerfile')]).subarray(0, 1024),
      rawHeader('escape/etc/x', '0'),
      rawHeader('escape', '2', 0, '/'),
    );

    expect(checkBuildContextArchive(archive, 'Dockerfile')).toMatchObject({
      ok: false,
      reason: 'invalid',
      message: expect.stringContaining('escape'),
    });
  });

  it('refuses a hard link to a file outside the context', () => {
    const archive = archiveOf(
      packBuildContextArchive([file('Dockerfile')]).subarray(0, 1024),
      rawHeader('passwd', '1', 0, '../../etc/passwd'),
    );

    expect(checkBuildContextArchive(archive, 'Dockerfile')).toMatchObject({
      ok: false,
      reason: 'invalid',
    });
  });

  it('refuses a hard link to an absolute path', () => {
    const archive = archiveOf(
      packBuildContextArchive([file('Dockerfile')]).subarray(0, 1024),
      rawHeader('passwd', '1', 0, '/etc/passwd'),
    );

    expect(checkBuildContextArchive(archive, 'Dockerfile')).toMatchObject({
      ok: false,
      reason: 'invalid',
      message: expect.stringContaining('/etc/passwd'),
    });
  });

  it('refuses a device node', () => {
    const archive = archiveOf(
      packBuildContextArchive([file('Dockerfile')]).subarray(0, 1024),
      rawHeader('null', '3'),
    );

    expect(checkBuildContextArchive(archive, 'Dockerfile')).toMatchObject({
      ok: false,
      reason: 'invalid',
      message: expect.stringContaining('null'),
    });
  });
});

describe('buildContextDockerfileProblem', () => {
  it('is nothing when the Dockerfile is among the paths, the default applied', () => {
    expect(buildContextDockerfileProblem('', ['Dockerfile', 'scripts/run.sh'])).toBeNull();
    expect(buildContextDockerfileProblem('./container/Dockerfile', ['container/Dockerfile'])).toBeNull();
  });

  it('names the Dockerfile it could not find, and one outside the context', () => {
    expect(buildContextDockerfileProblem('container/Dockerfile', ['Dockerfile'])).toBe(
      'No Dockerfile at "container/Dockerfile" in the build context.',
    );
    expect(buildContextDockerfileProblem('../Dockerfile', ['Dockerfile'])).toBe(
      'Dockerfile "../Dockerfile" is outside the build context.',
    );
  });
});
