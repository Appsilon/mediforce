import { describe, it, expect, vi, beforeEach } from 'vitest';
import { agentSetSkillsCommand } from '../commands/agent-set-skills';
import { captureOutput, jsonResponse } from './test-helpers';

beforeEach(() => {
  vi.restoreAllMocks();
});

const agent = (overrides: Record<string, unknown> = {}) => ({
  id: 'agent-1',
  kind: 'plugin',
  name: 'Mapper',
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
  ...overrides,
});

async function run(argv: string[], getResponse = agent()) {
  const fetchSpy = vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(jsonResponse({ agent: getResponse }))
    .mockImplementationOnce(async (_url, init) =>
      jsonResponse({ agent: { ...getResponse, ...JSON.parse(String(init?.body)) } }));
  const output = captureOutput();
  const code = await agentSetSkillsCommand({
    argv: [...argv, '--base-url', 'http://localhost:5555'],
    env: { MEDIFORCE_API_KEY: 'k' },
    output,
  });
  return { code, output, fetchSpy };
}

describe('agent set-skills command', () => {
  it("PUTs namespaced refs, resolving a bare id to the agent's workspace", async () => {
    const { code, output, fetchSpy } = await run(['agent-1', '--skills', 'sdtm-mapping, shared/ae-grading']);
    expect(code).toBe(0);
    const [url, init] = fetchSpy.mock.calls[1] ?? [];
    expect(url).toBe('http://localhost:5555/api/agents/agent-1');
    expect(init?.method).toBe('PUT');
    expect(JSON.parse(String(init?.body))).toEqual({
      skills: [
        { namespace: 'alpha', id: 'sdtm-mapping' },
        { namespace: 'shared', id: 'ae-grading' },
      ],
    });
    expect(output.stdoutLines.join('\n')).toMatch(/now holds: alpha\/sdtm-mapping, shared\/ae-grading/);
  });

  it('clears the skills on an empty list', async () => {
    const { code, fetchSpy } = await run(['agent-1', '--skills', '']);
    expect(code).toBe(0);
    expect(JSON.parse(String(fetchSpy.mock.calls[1]?.[1]?.body))).toEqual({ skills: [] });
  });

  it('refuses a bare id for an agent without a namespace, without writing', async () => {
    const { code, output, fetchSpy } = await run(['agent-1', '--skills', 'sdtm-mapping'], agent({ namespace: undefined, visibility: 'public' }));
    expect(code).toBe(2);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(output.stderrLines.join('\n')).toMatch(/needs a namespace/);
  });
});
