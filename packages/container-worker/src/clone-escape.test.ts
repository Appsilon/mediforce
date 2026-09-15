import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { assertInsideClone } from './docker-image-builder';

/**
 * Real directories and real symlinks: the escape this guards against is a
 * symlink committed to the repo, which only the filesystem can resolve.
 */
describe('assertInsideClone', () => {
  let clone: string;
  let outside: string;

  beforeEach(() => {
    clone = mkdtempSync(join(tmpdir(), 'mediforce-clone-'));
    outside = mkdtempSync(join(tmpdir(), 'mediforce-outside-'));
    writeFileSync(join(outside, 'secret.txt'), 'host file');
    mkdirSync(join(clone, 'container'));
    writeFileSync(join(clone, 'container', 'Dockerfile'), 'FROM alpine\n');
  });

  afterEach(() => {
    rmSync(clone, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  it('accepts the clone itself and a directory inside it', () => {
    expect(() => assertInsideClone(clone, '')).not.toThrow();
    expect(() => assertInsideClone(clone, 'container')).not.toThrow();
    expect(() => assertInsideClone(clone, 'container/Dockerfile')).not.toThrow();
  });

  it('refuses a context that is a symlink to a directory outside the clone', () => {
    symlinkSync(outside, join(clone, 'ctx'));

    expect(() => assertInsideClone(clone, 'ctx')).toThrow(/outside the repository/);
  });

  it('refuses a Dockerfile that is a symlink to a file outside the clone', () => {
    symlinkSync(join(outside, 'secret.txt'), join(clone, 'Dockerfile'));

    expect(() => assertInsideClone(clone, 'Dockerfile')).toThrow(/outside the repository/);
  });

  it('accepts a symlink that stays inside the clone', () => {
    symlinkSync(join(clone, 'container'), join(clone, 'alias'));

    expect(() => assertInsideClone(clone, 'alias')).not.toThrow();
  });

  it('leaves a missing path to docker build, which names it itself', () => {
    expect(() => assertInsideClone(clone, 'nope/Dockerfile')).not.toThrow();
  });
});
