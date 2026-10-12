import { describe, it, expect } from 'vitest';
import { WORKFLOW_ARTIFACT_MAX_BYTES } from '@mediforce/platform-core';
import { decodeTextFile, mergeUploadedFiles } from '../workflow-file-uploads';

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

describe('decodeTextFile', () => {
  it('decodes a text file', () => {
    expect(decodeTextFile(bytes('print("hi")\n'))).toBe('print("hi")\n');
  });

  it('decodes an empty file, which is a real file to upload', () => {
    expect(decodeTextFile(new Uint8Array())).toBe('');
  });

  it('refuses bytes that are not UTF-8 text', () => {
    // A workflow carries text. A PNG or a wheel uploaded here would be stored
    // mangled and fail at run time, so it is refused at the door.
    expect(decodeTextFile(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBeNull();
  });

  it('refuses a file with a NUL byte, which decodes but is not text', () => {
    expect(decodeTextFile(new Uint8Array([0x61, 0x00, 0x62]))).toBeNull();
  });

  it('keeps non-ASCII text, which is text', () => {
    expect(decodeTextFile(bytes('# Résumé 🧬\n'))).toBe('# Résumé 🧬\n');
  });
});

describe('mergeUploadedFiles', () => {
  it('adds the uploaded files', () => {
    const { artifacts, rejected } = mergeUploadedFiles([], [
      { path: 'scripts/poll.py', contents: 'print(1)\n' },
      { path: 'Dockerfile', contents: 'FROM python:3.12-slim\n' },
    ]);
    expect(rejected).toEqual([]);
    expect(artifacts.map((a) => a.path)).toEqual(['scripts/poll.py', 'Dockerfile']);
  });

  it('replaces a file already at that path, in place', () => {
    const { artifacts } = mergeUploadedFiles(
      [{ path: 'a.py', contents: 'old' }, { path: 'b.py', contents: 'b' }],
      [{ path: 'a.py', contents: 'new' }],
    );
    expect(artifacts).toEqual([{ path: 'a.py', contents: 'new' }, { path: 'b.py', contents: 'b' }]);
  });

  it('rejects a file bigger than one artifact may be, and keeps the rest', () => {
    const { artifacts, rejected } = mergeUploadedFiles([], [
      { path: 'big.csv', contents: 'x'.repeat(WORKFLOW_ARTIFACT_MAX_BYTES + 1) },
      { path: 'small.py', contents: 'print(1)\n' },
    ]);
    expect(artifacts.map((a) => a.path)).toEqual(['small.py']);
    expect(rejected).toEqual([{ path: 'big.csv', reason: 'larger than 64 KB' }]);
  });

  it('rejects a file that would take the set over its limit', () => {
    // The whole set rides in the definition, so the total is what has to fit;
    // an upload that busts it is refused with the reason rather than saved and
    // then refused by the server.
    const half = 'x'.repeat(WORKFLOW_ARTIFACT_MAX_BYTES);
    const existing = Array.from({ length: 3 }, (_, i) => ({ path: `f${String(i)}.py`, contents: half }));
    const { artifacts, rejected } = mergeUploadedFiles(existing, [
      { path: 'one-too-many.py', contents: half },
      { path: 'still-fits.py', contents: 'ok\n' },
    ]);
    expect(artifacts.map((a) => a.path)).toEqual([...existing.map((a) => a.path), 'still-fits.py']);
    expect(rejected).toEqual([{ path: 'one-too-many.py', reason: 'no room left in this workflow' }]);
  });

  it('rejects a path that could not be written', () => {
    const { artifacts, rejected } = mergeUploadedFiles([], [{ path: '../escape.py', contents: 'x' }]);
    expect(artifacts).toEqual([]);
    expect(rejected[0]?.path).toBe('../escape.py');
  });
});
