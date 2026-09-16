import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assistantInstructionsSetCommand } from '../commands/assistant-instructions-set';
import { assistantInstructionsGetCommand } from '../commands/assistant-instructions-get';
import { captureOutput, jsonResponse } from './test-helpers';

beforeEach(() => {
  vi.restoreAllMocks();
});

const BASE_ENV = { MEDIFORCE_API_KEY: 'k' };
const BASE_ARGV = ['--namespace', 'ns-1', '--uid', 'u-1', '--base-url', 'http://test:9000'];

describe('assistant instructions-set command', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'assistant-instructions-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('sends the contents of --file', async () => {
    const file = join(dir, 'conventions.md');
    await writeFile(file, '# House style\n\nName steps after artefacts.\n', 'utf-8');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ ok: true }));
    const output = captureOutput();

    const code = await assistantInstructionsSetCommand({
      argv: [...BASE_ARGV, '--file', file],
      env: BASE_ENV,
      output,
    });

    expect(code).toBe(0);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toContain('/api/workflow-assistant/instructions');
    expect(init?.method).toBe('PUT');
    expect(JSON.parse(init?.body as string)).toEqual({
      namespace: 'ns-1',
      uid: 'u-1',
      instructions: '# House style\n\nName steps after artefacts.\n',
    });
  });

  it('sends an empty string for --clear', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ ok: true }));
    const output = captureOutput();

    const code = await assistantInstructionsSetCommand({
      argv: [...BASE_ARGV, '--clear'],
      env: BASE_ENV,
      output,
    });

    expect(code).toBe(0);
    const [, init] = fetchSpy.mock.calls[0]!;
    expect(JSON.parse(init?.body as string).instructions).toBe('');
    expect(output.stdoutLines.join('\n')).toMatch(/cleared/);
  });

  it('refuses when no source is given', async () => {
    const output = captureOutput();
    const code = await assistantInstructionsSetCommand({ argv: [...BASE_ARGV], env: BASE_ENV, output });
    expect(code).toBe(2);
  });

  it('refuses two sources at once', async () => {
    const output = captureOutput();
    const code = await assistantInstructionsSetCommand({
      argv: [...BASE_ARGV, '--stdin', '--clear'],
      env: BASE_ENV,
      output,
    });
    expect(code).toBe(2);
  });

  it('treats an empty file as a mistake, not as a clear', async () => {
    // Clearing is destructive and --clear says so; a truncated file should not
    // quietly wipe what someone spent a morning writing.
    const file = join(dir, 'empty.md');
    await writeFile(file, '   \n', 'utf-8');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ ok: true }));
    const output = captureOutput();

    const code = await assistantInstructionsSetCommand({
      argv: [...BASE_ARGV, '--file', file],
      env: BASE_ENV,
      output,
    });

    expect(code).toBe(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('assistant instructions-get command', () => {
  it('prints the stored text', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ instructions: 'Name steps after artefacts.' }),
    );
    const output = captureOutput();

    const code = await assistantInstructionsGetCommand({
      argv: [...BASE_ARGV],
      env: BASE_ENV,
      output,
    });

    expect(code).toBe(0);
    expect(output.stdoutLines.join('\n')).toContain('Name steps after artefacts.');
  });

  it('says so when nothing is saved', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ instructions: '' }));
    const output = captureOutput();

    const code = await assistantInstructionsGetCommand({
      argv: [...BASE_ARGV],
      env: BASE_ENV,
      output,
    });

    expect(code).toBe(0);
    expect(output.stdoutLines.join('\n')).toMatch(/No assistant instructions saved/);
  });
});
