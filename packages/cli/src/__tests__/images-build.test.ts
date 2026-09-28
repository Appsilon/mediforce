import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listBuildContextArchive } from '@mediforce/platform-core';
import { imagesBuildCommand } from '../commands/images';
import { captureOutput, jsonResponse } from './test-helpers';

const BASE_ENV = { MEDIFORCE_API_KEY: 'k' };
let contextDir: string;

beforeEach(() => {
  vi.restoreAllMocks();
  contextDir = mkdtempSync(join(tmpdir(), 'mediforce-cli-context-'));
  mkdirSync(join(contextDir, 'container'));
  mkdirSync(join(contextDir, 'scripts'));
  writeFileSync(join(contextDir, 'container', 'Dockerfile'), 'FROM alpine\nCOPY scripts /s\n');
  writeFileSync(join(contextDir, 'scripts', 'run.sh'), 'echo hi\n');
  chmodSync(join(contextDir, 'scripts', 'run.sh'), 0o755);
  symlinkSync('scripts/run.sh', join(contextDir, 'entrypoint'));
});

afterEach(() => {
  rmSync(contextDir, { recursive: true, force: true });
});

const UPLOAD_ARGV = (dockerfile = 'container/Dockerfile') => [
  '--namespace', 'alpha',
  '--reference', 'alpha/agent',
  '--context', contextDir,
  '--dockerfile', dockerfile,
  '--tag', 'v1',
  '--intent', 'Runs the ADaM checks we have no repo for',
  '--base-url', 'http://test:9000',
];

describe('images build from a local context', () => {
  it('uploads the whole directory as the build context, and says where it landed', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ imageTag: 'alpha/agent:v1', entryId: 'agent-1234abcd' }));
    const output = captureOutput();

    const code = await imagesBuildCommand({ argv: UPLOAD_ARGV(), env: BASE_ENV, output });

    expect(code, output.stderrLines.join('\n')).toBe(0);
    expect(output.stdoutLines.join('\n')).toContain('alpha/agent:v1');
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(String(url)).toBe('http://test:9000/api/image-catalog/upload?namespace=alpha');

    const form = init?.body as FormData;
    expect(JSON.parse(String(form.get('input')))).toMatchObject({
      reference: 'alpha/agent',
      tag: 'v1',
      dockerfile: 'container/Dockerfile',
      intent: 'Runs the ADaM checks we have no repo for',
    });
    const archive = new Uint8Array(await (form.get('context') as File).arrayBuffer());
    const entries = listBuildContextArchive(archive);
    // Everything beside the Dockerfile, not just the Dockerfile: `COPY scripts`
    // needs its siblings, which is the point of uploading a context.
    expect(entries.map((entry) => `${entry.kind}:${entry.path}`)).toEqual([
      'directory:container/',
      'file:container/Dockerfile',
      'symlink:entrypoint',
      'directory:scripts/',
      'file:scripts/run.sh',
    ]);
  });

  it('leaves out what the .dockerignore excludes, and says how much', async () => {
    mkdirSync(join(contextDir, 'sample-data', 'study-1'), { recursive: true });
    // Sparse, so it costs no disk: over the limit on size alone, and never read.
    writeFileSync(join(contextDir, 'sample-data', 'study-1', 'dm.xpt'), '');
    truncateSync(join(contextDir, 'sample-data', 'study-1', 'dm.xpt'), 200 * 1024 * 1024);
    writeFileSync(join(contextDir, '.dockerignore'), 'sample-data\n');
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ imageTag: 'alpha/agent:v1', entryId: 'agent-1234abcd' }));
    const output = captureOutput();

    const code = await imagesBuildCommand({ argv: UPLOAD_ARGV(), env: BASE_ENV, output });

    expect(code, output.stderrLines.join('\n')).toBe(0);
    expect(output.stdoutLines.join('\n')).toContain('.dockerignore applied');
    const form = fetchSpy.mock.calls[0]?.[1]?.body as FormData;
    const archive = new Uint8Array(await (form.get('context') as File).arrayBuffer());
    expect(listBuildContextArchive(archive).map((entry) => `${entry.kind}:${entry.path}`)).toEqual([
      'file:.dockerignore',
      'directory:container/',
      'file:container/Dockerfile',
      'symlink:entrypoint',
      'directory:scripts/',
      'file:scripts/run.sh',
    ]);
  });

  it('reads the ignore file beside the Dockerfile over the root one, as BuildKit does', async () => {
    writeFileSync(join(contextDir, '.dockerignore'), 'scripts\n');
    writeFileSync(join(contextDir, 'container', 'Dockerfile.dockerignore'), 'entrypoint\n');
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ imageTag: 'alpha/agent:v1', entryId: 'agent-1234abcd' }));
    const output = captureOutput();

    const code = await imagesBuildCommand({ argv: UPLOAD_ARGV(), env: BASE_ENV, output });

    expect(code, output.stderrLines.join('\n')).toBe(0);
    const form = fetchSpy.mock.calls[0]?.[1]?.body as FormData;
    const archive = new Uint8Array(await (form.get('context') as File).arrayBuffer());
    const paths = listBuildContextArchive(archive).map((entry) => entry.path);
    expect(paths).toContain('scripts/run.sh');
    expect(paths).toContain('container/Dockerfile.dockerignore');
    expect(paths).not.toContain('entrypoint');
  });

  it('refuses an oversized context by naming what makes it big, before reading or uploading it', async () => {
    mkdirSync(join(contextDir, 'sample-data'));
    writeFileSync(join(contextDir, 'sample-data', 'dm.xpt'), '');
    truncateSync(join(contextDir, 'sample-data', 'dm.xpt'), 200 * 1024 * 1024);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const output = captureOutput();

    const code = await imagesBuildCommand({ argv: UPLOAD_ARGV(), env: BASE_ENV, output });

    expect(code).toBe(1);
    expect(output.stderrLines.join('\n')).toContain('Largest: sample-data/ (200.0 MB)');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses a context with no Dockerfile at the path given, before uploading', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const output = captureOutput();

    const code = await imagesBuildCommand({
      argv: UPLOAD_ARGV('Dockerfile'),
      env: BASE_ENV,
      output,
    });

    expect(code).toBe(1);
    expect(output.stderrLines.join('\n')).toContain('No Dockerfile at "Dockerfile"');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('needs exactly one of --repo or --reference', async () => {
    const output = captureOutput();

    const code = await imagesBuildCommand({
      argv: [...UPLOAD_ARGV(), '--repo', 'Appsilon/tealflow', '--commit', 'abc1234'],
      env: BASE_ENV,
      output,
    });

    expect(code).toBe(2);
    expect(output.stderrLines.join('\n')).toMatch(/--repo.*--reference/);
  });

  it('needs a local --context to upload with --reference', async () => {
    const output = captureOutput();

    const code = await imagesBuildCommand({
      argv: ['--namespace', 'alpha', '--reference', 'alpha/agent', '--intent', 'x'],
      env: BASE_ENV,
      output,
    });

    expect(code).toBe(2);
    expect(output.stderrLines.join('\n')).toContain('--context');
  });

  it('still builds a repo at a commit, as before', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ imageTag: 'mediforce-built:abc123abc123', entryId: 'tealflow-1234abcd' }));
    const output = captureOutput();

    const code = await imagesBuildCommand({
      argv: [
        '--namespace', 'alpha',
        '--repo', 'Appsilon/tealflow',
        '--commit', 'abc1234',
        '--base-url', 'http://test:9000',
      ],
      env: BASE_ENV,
      output,
    });

    expect(code).toBe(0);
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(String(url)).toBe('http://test:9000/api/image-catalog/build?namespace=alpha');
    expect(JSON.parse(String(init?.body))).toEqual({ repo: 'Appsilon/tealflow', commit: 'abc1234', dockerfile: '' });
  });
});
