import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { toolCatalogAddCommand } from '../commands/tool-catalog-add';
import { captureOutput, jsonResponse } from './test-helpers';

const BASE_ENV = { MEDIFORCE_API_KEY: 'k' };

beforeEach(() => {
  vi.restoreAllMocks();
});

function entryFile(command: string): string {
  const file = join(mkdtempSync(join(tmpdir(), 'catalog-')), 'entry.json');
  writeFileSync(file, JSON.stringify({ id: 'biomcp', command, args: ['serve'] }));
  return file;
}

async function add(command: string, commandCheck: Response | Error, extraArgs: string[] = []) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    if (String(input).includes('/api/image-catalog/command-check')) {
      if (commandCheck instanceof Error) throw commandCheck;
      return commandCheck;
    }
    return jsonResponse({ entry: { id: 'biomcp', type: 'stdio', command, args: ['serve'] } }, 201);
  });
  const output = captureOutput();
  const code = await toolCatalogAddCommand({
    argv: ['--file', entryFile(command), '--namespace', 'alpha', '--base-url', 'http://test:9000', ...extraArgs],
    env: BASE_ENV,
    output,
  });
  return { code, text: output.stdoutLines.join('\n'), warnings: output.stderrLines.join('\n') };
}

describe('tool-catalog add', () => {
  it('warns when the default agent image does not provide the command', async () => {
    const { code, text, warnings } = await add('uvx', jsonResponse({ status: 'known', available: false }));

    expect(code).toBe(0);
    expect(text).toContain("Added 'biomcp' to the alpha Tool Catalog.");
    expect(warnings).toContain('Warning: `uvx` is not available in the default agent image (mediforce-golden-image)');
  });

  it('says nothing extra when the command is there', async () => {
    const { warnings } = await add('npx', jsonResponse({ status: 'known', available: true, path: '/usr/bin/npx' }));

    expect(warnings).not.toContain('Warning');
  });

  it('never fails the add because the check could not run', async () => {
    const { code, text, warnings } = await add('uvx', new Error('daemon down'));

    expect(code).toBe(0);
    expect(text).toContain("Added 'biomcp'");
    expect(warnings).not.toContain('Warning');
  });

  it('still warns under --json, on stderr, leaving stdout a single JSON document', async () => {
    const { text, warnings } = await add('uvx', jsonResponse({ status: 'known', available: false }), ['--json']);

    expect(JSON.parse(text)).toEqual({ entry: { id: 'biomcp', type: 'stdio', command: 'uvx', args: ['serve'] } });
    expect(warnings).toContain('Warning: `uvx` is not available in the default agent image');
  });
});

describe('tool-catalog add — http', () => {
  it('sends an http entry and skips the image command check', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'catalog-')), 'entry.json');
    writeFileSync(file, JSON.stringify({ type: 'http', url: 'https://api.githubcopilot.com/mcp/' }));
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      jsonResponse({ entry: { id: 'api-githubcopilot-com', type: 'http', url: 'https://api.githubcopilot.com/mcp/' } }, 201),
    );
    const output = captureOutput();

    const code = await toolCatalogAddCommand({
      argv: ['--file', file, '--namespace', 'alpha', '--base-url', 'http://test:9000'],
      env: BASE_ENV,
      output,
    });

    expect(code).toBe(0);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetchSpy.mock.calls[0][1]?.body))).toEqual({
      type: 'http',
      url: 'https://api.githubcopilot.com/mcp/',
    });
    expect(output.stdoutLines.join('\n')).toContain("Added 'api-githubcopilot-com' to the alpha Tool Catalog.");
  });
});
