import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  workflowTriggerExportCommand,
  workflowTriggerImportCommand,
} from '../commands/workflow-trigger';
import { captureOutput, jsonResponse } from './test-helpers';

let tempDir: string;

const portableTriggers = [
  { name: 'nightly', type: 'cron', enabled: true, schedule: '0 2 * * *' },
  { name: 'intake', type: 'webhook', enabled: true, method: 'POST', path: '/intake' },
  { name: 'manual', type: 'manual', enabled: true },
];

beforeEach(async () => {
  vi.restoreAllMocks();
  tempDir = await mkdtemp(path.join(tmpdir(), 'mediforce-trigger-port-'));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe('workflow trigger-export command', () => {
  it('writes the portable file to --out and GETs the export endpoint', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ triggers: portableTriggers }));
    const outFile = path.join(tempDir, 'triggers.json');
    const output = captureOutput();
    const code = await workflowTriggerExportCommand({
      argv: ['flow', '--namespace', 'team-alpha', '--out', outFile, '--base-url', 'http://x'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(0);
    const [url] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('http://x/api/workflow-definitions/flow/triggers/export?namespace=team-alpha');
    const written: unknown = JSON.parse(await readFile(outFile, 'utf-8'));
    expect(written).toEqual(portableTriggers);
    expect(output.stdoutLines.join('\n')).toMatch(/Exported 3 trigger\(s\)/);
  });

  it('prints the file contents to stdout when --out is omitted', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ triggers: portableTriggers }));
    const output = captureOutput();
    const code = await workflowTriggerExportCommand({
      argv: ['flow', '--namespace', 'team-alpha', '--base-url', 'http://x'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(0);
    const parsed: unknown = JSON.parse(output.stdoutLines.join('\n'));
    expect(parsed).toEqual(portableTriggers);
  });
});

describe('workflow trigger-import command', () => {
  it('POSTs the parsed file (with --replace) to the import endpoint', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        results: [
          { name: 'nightly', type: 'cron', outcome: 'created', webhookUrl: null },
          { name: 'intake', type: 'webhook', outcome: 'created', webhookUrl: '/api/triggers/webhook/team-beta/flow/intake' },
          { name: 'manual', type: 'manual', outcome: 'skipped', webhookUrl: null },
        ],
      }),
    );
    const file = path.join(tempDir, 'triggers.json');
    await writeFile(file, JSON.stringify(portableTriggers), 'utf-8');

    const output = captureOutput();
    const code = await workflowTriggerImportCommand({
      argv: ['flow', file, '--namespace', 'team-beta', '--replace', '--base-url', 'http://x'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(0);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('http://x/api/workflow-definitions/flow/triggers/import');
    expect(init?.method).toBe('POST');
    const body = JSON.parse(String(init?.body)) as { namespace: string; replace: boolean; triggers: unknown[] };
    expect(body.namespace).toBe('team-beta');
    expect(body.replace).toBe(true);
    expect(body.triggers).toEqual(portableTriggers);
    const stdout = output.stdoutLines.join('\n');
    expect(stdout).toMatch(/created  cron  nightly/);
    expect(stdout).toMatch(/\/api\/triggers\/webhook\/team-beta\/flow\/intake/);
  });

  it('exits 1 without calling the API when the file is not a valid trigger config', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const file = path.join(tempDir, 'bad.json');
    await writeFile(file, JSON.stringify([{ name: 'x', type: 'cron', enabled: true }]), 'utf-8');
    const output = captureOutput();
    const code = await workflowTriggerImportCommand({
      argv: ['flow', file, '--namespace', 'team-beta', '--base-url', 'http://x'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(output.stderrLines.join('\n')).toMatch(/Invalid trigger-config file/);
  });
});
