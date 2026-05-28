import { describe, it, expect, vi, beforeEach } from 'vitest';
import { agentGetCommand } from '../commands/agent-get.js';
import { captureOutput, jsonResponse } from './test-helpers.js';

beforeEach(() => {
  vi.restoreAllMocks();
});

const FAKE_AGENT = {
  id: 'agent-1',
  kind: 'plugin',
  runtimeId: 'claude-code-agent',
  name: 'SDTM Rule Author',
  iconName: 'Code',
  description: 'Authors CDISC rules',
  foundationModel: 'anthropic/claude-sonnet-4',
  systemPrompt: 'You author rules.',
  inputDescription: 'Rule ID',
  outputDescription: 'Rule changes',
  skillFileNames: ['skill.md', 'patterns.md'],
  createdAt: '2026-05-01T00:00:00Z',
  updatedAt: '2026-05-01T00:00:00Z',
};

describe('agent get command', () => {
  it('prints help on --help and exits 0', async () => {
    const output = captureOutput();
    const code = await agentGetCommand({
      argv: ['--help'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(0);
    expect(output.stdoutLines.join('\n')).toMatch(/USAGE mediforce agent get/);
  });

  it('exits 2 when no id positional is given', async () => {
    const output = captureOutput();
    const code = await agentGetCommand({
      argv: [],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(2);
    expect(output.stderrLines.join('\n') + output.stdoutLines.join('\n')).toMatch(
      /Missing required positional argument: ID/,
    );
  });

  it('GETs /api/agents/<id> and prints human-readable output', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ agent: FAKE_AGENT }),
    );
    const output = captureOutput();
    const code = await agentGetCommand({
      argv: ['agent-1', '--base-url', 'http://localhost:5555'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(0);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe(
      'http://localhost:5555/api/agents/agent-1',
    );
    const text = output.stdoutLines.join('\n');
    expect(text).toMatch(/Agent agent-1/);
    expect(text).toMatch(/name:\s+SDTM Rule Author/);
    expect(text).toMatch(/model:\s+anthropic\/claude-sonnet-4/);
    expect(text).toMatch(/kind:\s+plugin/);
    expect(text).toMatch(/runtimeId:\s+claude-code-agent/);
    expect(text).toMatch(/skills:\s+skill\.md, patterns\.md/);
  });

  it('omits runtimeId and skills lines when absent/empty', async () => {
    const { runtimeId: _, skillFileNames: __, ...noOptionals } = FAKE_AGENT;
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ agent: { ...noOptionals, skillFileNames: [] } }),
    );
    const output = captureOutput();
    const code = await agentGetCommand({
      argv: ['agent-1'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(0);
    const text = output.stdoutLines.join('\n');
    expect(text).not.toMatch(/runtimeId/);
    expect(text).not.toMatch(/skills/);
  });

  it('emits structured JSON when --json is set', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ agent: FAKE_AGENT }),
    );
    const output = captureOutput();
    const code = await agentGetCommand({
      argv: ['agent-1', '--json'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(0);
    const parsed: unknown = JSON.parse(output.stdoutLines.join('\n'));
    expect(parsed).toMatchObject({ agent: { id: 'agent-1', name: 'SDTM Rule Author' } });
  });

  it('exits 1 with structured error JSON on 404', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ error: 'Not found' }, 404),
    );
    const output = captureOutput();
    const code = await agentGetCommand({
      argv: ['nope', '--json'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(1);
    const parsed: unknown = JSON.parse(output.stdoutLines.join('\n'));
    expect(parsed).toMatchObject({ status: 404 });
  });

  it('exits 2 when API key is missing', async () => {
    const output = captureOutput();
    const code = await agentGetCommand({
      argv: ['agent-1'],
      env: {},
      output,
    });
    expect(code).toBe(2);
  });
});
