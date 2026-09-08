import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { artifactsDir, materializeArtifacts } from '../workflow-artifacts';

const created: string[] = [];
afterEach(async () => {
  await Promise.all(created.map((dir) => rm(dir, { recursive: true, force: true })));
  created.length = 0;
});

const track = (dir: string): string => {
  created.push(dir);
  return dir;
};

describe('materializeArtifacts', () => {
  it('writes every artifact, nested paths included', async () => {
    const dir = track(await materializeArtifacts([
      { path: 'Dockerfile', contents: 'FROM python:3.12-slim\n' },
      { path: 'scripts/poll.py', contents: 'print("poll")\n' },
      { path: 'skills/validator/SKILL.md', contents: '# Validator\n' },
    ]) as string);

    expect(await readFile(join(dir, 'Dockerfile'), 'utf8')).toBe('FROM python:3.12-slim\n');
    expect(await readFile(join(dir, 'scripts/poll.py'), 'utf8')).toBe('print("poll")\n');
    expect(await readFile(join(dir, 'skills/validator/SKILL.md'), 'utf8')).toBe('# Validator\n');
  });

  it('makes files executable, so a step can name one as its command', async () => {
    const dir = track(await materializeArtifacts([{ path: 'run.sh', contents: '#!/bin/sh\necho hi\n' }]) as string);
    const mode = (await stat(join(dir, 'run.sh'))).mode & 0o777;
    expect(mode & 0o111).not.toBe(0);
  });

  it('has nothing to do when a workflow carries no files', async () => {
    expect(await materializeArtifacts(undefined)).toBeNull();
    expect(await materializeArtifacts([])).toBeNull();
  });

  it('reuses the directory for the same set, so steps and runs share one write', async () => {
    const artifacts = [{ path: 'a.py', contents: 'print(1)\n' }];
    const first = track(await materializeArtifacts(artifacts) as string);
    const second = await materializeArtifacts(artifacts);
    expect(second).toBe(first);
  });

  it('ignores the order the files arrive in, which is not part of the content', async () => {
    const a = { path: 'a.py', contents: '1' };
    const b = { path: 'b.py', contents: '2' };
    const first = track(await materializeArtifacts([a, b]) as string);
    expect(await materializeArtifacts([b, a])).toBe(first);
  });

  it('gives a changed file a directory of its own', async () => {
    const first = track(await materializeArtifacts([{ path: 'a.py', contents: 'print(1)\n' }]) as string);
    const second = track(await materializeArtifacts([{ path: 'a.py', contents: 'print(2)\n' }]) as string);
    expect(second).not.toBe(first);
    expect(await readFile(join(second, 'a.py'), 'utf8')).toBe('print(2)\n');
  });

  it('rewrites a directory an earlier attempt left half-written', async () => {
    // Materializing is not atomic per file, so a crash between two writes would
    // otherwise leave a cache hit on an incomplete directory forever.
    const artifacts = [{ path: 'a.py', contents: 'print(1)\n' }, { path: 'b.py', contents: 'print(2)\n' }];
    const dir = track(artifactsDir(artifacts));
    await materializeArtifacts(artifacts);
    await rm(join(dir, 'b.py'));
    await rm(join(dir, '.mediforce-artifacts-complete'));

    await materializeArtifacts(artifacts);
    expect(await readFile(join(dir, 'b.py'), 'utf8')).toBe('print(2)\n');
  });

  it('leaves nothing of a previous set behind in a reused directory', async () => {
    const artifacts = [{ path: 'a.py', contents: 'print(1)\n' }];
    const dir = track(artifactsDir(artifacts));
    await materializeArtifacts(artifacts);
    // A file that is not in the set: only possible if something else wrote it,
    // but a stale extra file inside a read-only mount is confusing at best and
    // a leak at worst, so a rewrite starts clean.
    await writeFile(join(dir, 'stale.py'), 'print("stale")\n');
    await rm(join(dir, '.mediforce-artifacts-complete'));

    await materializeArtifacts(artifacts);
    expect((await readdir(dir)).sort()).toEqual(['.mediforce-artifacts-complete', 'a.py']);
  });

  it('refuses a path that would escape the directory', async () => {
    // The schema rejects these when a definition registers, so reaching here
    // means the definition was written before that check or around it. Writing
    // outside the directory is not a thing to do on a best guess.
    for (const path of ['../escape.py', '/etc/passwd', 'a/../../escape.py']) {
      await expect(materializeArtifacts([{ path, contents: 'x' }])).rejects.toThrow(/artifact path/i);
    }
  });

  it('names a directory under the system temp dir, which the containers can reach', async () => {
    // Both the orchestrator and the container worker bind-mount /tmp, which is
    // why a host path under it resolves to the same bytes inside a container.
    expect(artifactsDir([{ path: 'a.py', contents: '1' }])).toContain(tmpdir());
  });

  it('does not care where the caller happens to be', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'artifacts-cwd-'));
    created.push(cwd);
    expect(artifactsDir([{ path: 'a.py', contents: '1' }]).startsWith(cwd)).toBe(false);
  });
});
