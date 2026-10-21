import { describe, it, expect, vi, beforeEach } from 'vitest';
import { agentSetImageCommand } from '../commands/agent-set-image';
import { captureOutput, jsonResponse } from './test-helpers';

beforeEach(() => {
  vi.restoreAllMocks();
});

const agent = {
  id: 'agent-1',
  kind: 'plugin',
  name: 'TLF programmer',
  iconName: 'Bot',
  description: '',
  foundationModel: 'sonnet',
  systemPrompt: '',
  inputDescription: '',
  outputDescription: '',
  namespace: 'alpha',
  visibility: 'private',
  createdAt: '2026-10-06T00:00:00Z',
  updatedAt: '2026-10-06T00:00:00Z',
};

async function run(argv: string[]) {
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async (_url, init) => {
    const { image } = JSON.parse(String(init?.body)) as { image: string | null };
    return jsonResponse({ agent: image === null ? agent : { ...agent, image } });
  });
  const output = captureOutput();
  const code = await agentSetImageCommand({
    argv: [...argv, '--base-url', 'http://localhost:5555'],
    env: { MEDIFORCE_API_KEY: 'k' },
    output,
  });
  return { code, output, fetchSpy };
}

describe('agent set-image command', () => {
  it('PUTs the image', async () => {
    const { code, output, fetchSpy } = await run(['agent-1', '--image', 'r-tools:2']);
    expect(code).toBe(0);
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe('http://localhost:5555/api/agents/agent-1');
    expect(init?.method).toBe('PUT');
    expect(JSON.parse(String(init?.body))).toEqual({ image: 'r-tools:2' });
    expect(output.stdoutLines.join('\n')).toMatch(/now runs in r-tools:2/);
  });

  it('clears the image on an empty one, so the agent runs in the golden image', async () => {
    const { code, output, fetchSpy } = await run(['agent-1', '--image', '']);
    expect(code).toBe(0);
    expect(JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body))).toEqual({ image: null });
    expect(output.stdoutLines.join('\n')).toMatch(/now runs in mediforce-golden-image/);
  });
});
