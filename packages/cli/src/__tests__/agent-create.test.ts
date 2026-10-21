import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agentCreateCommand } from '../commands/agent-create';
import { captureOutput, jsonResponse } from './test-helpers';

beforeEach(() => {
  vi.restoreAllMocks();
});

const input = {
  kind: 'plugin',
  name: 'TLF programmer',
  iconName: 'Bot',
  description: '',
  foundationModel: 'sonnet',
  systemPrompt: '',
  inputDescription: '',
  outputDescription: '',
  namespace: 'alpha',
  image: 'r-tools:2',
};

async function run(argv: string[]) {
  const file = join(mkdtempSync(join(tmpdir(), 'agent-create-')), 'agent.json');
  writeFileSync(file, JSON.stringify(input));
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return jsonResponse({ agent: { ...body, id: 'agent-1', createdAt: '2026-10-06T00:00:00Z', updatedAt: '2026-10-06T00:00:00Z' } }, 201);
  });
  const output = captureOutput();
  const code = await agentCreateCommand({
    argv: ['--file', file, ...argv, '--base-url', 'http://localhost:5555'],
    env: { MEDIFORCE_API_KEY: 'k' },
    output,
  });
  return { code, fetchSpy };
}

describe('agent create command', () => {
  it('keeps the file\'s image when --image is not given', async () => {
    const { code, fetchSpy } = await run([]);
    expect(code).toBe(0);
    expect(JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body)).image).toBe('r-tools:2');
  });

  it('replaces the file\'s image with --image', async () => {
    const { code, fetchSpy } = await run(['--image', 'r-tools:3']);
    expect(code).toBe(0);
    expect(JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body)).image).toBe('r-tools:3');
  });

  it('drops the file\'s image on an empty --image, so the agent runs in the golden image', async () => {
    const { code, fetchSpy } = await run(['--image', '']);
    expect(code).toBe(0);
    expect(JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body))).not.toHaveProperty('image');
  });
});
