import { describe, it, expect, vi, beforeEach } from 'vitest';
import { agentListCommand } from '../commands/agent-list.js';
import { captureOutput, jsonResponse } from './test-helpers.js';

beforeEach(() => {
  vi.restoreAllMocks();
});

const FAKE_AGENTS = [
  {
    id: 'agent-1',
    kind: 'plugin',
    name: 'SDTM Rule Author',
    iconName: 'Code',
    description: 'Authors CDISC rules',
    foundationModel: 'anthropic/claude-sonnet-4',
    systemPrompt: 'You author rules.',
    inputDescription: 'Rule ID',
    outputDescription: 'Rule changes',
    skillFileNames: ['skill.md'],
    createdAt: '2026-05-01T00:00:00Z',
    updatedAt: '2026-05-01T00:00:00Z',
  },
  {
    id: 'agent-2',
    kind: 'plugin',
    name: 'Code Reviewer',
    iconName: 'Eye',
    description: 'Reviews code',
    foundationModel: 'deepseek/deepseek-chat',
    systemPrompt: 'You review code.',
    inputDescription: 'PR diff',
    outputDescription: 'Review comments',
    skillFileNames: [],
    createdAt: '2026-05-02T00:00:00Z',
    updatedAt: '2026-05-02T00:00:00Z',
  },
];

describe('agent list command', () => {
  it('prints help on --help and exits 0', async () => {
    const output = captureOutput();
    const code = await agentListCommand({
      argv: ['--help'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(0);
    expect(output.stdoutLines.join('\n')).toMatch(/USAGE mediforce agent list/);
  });

  it('lists agents in human-readable format', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ agents: FAKE_AGENTS }),
    );
    const output = captureOutput();
    const code = await agentListCommand({
      argv: ['--base-url', 'http://localhost:5555'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(0);
    const text = output.stdoutLines.join('\n');
    expect(text).toMatch(/Found 2 agent/);
    expect(text).toMatch(/agent-1/);
    expect(text).toMatch(/SDTM Rule Author/);
    expect(text).toMatch(/anthropic\/claude-sonnet-4/);
  });

  it('emits JSON when --json is set', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ agents: FAKE_AGENTS }),
    );
    const output = captureOutput();
    const code = await agentListCommand({
      argv: ['--json'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(0);
    const parsed: unknown = JSON.parse(output.stdoutLines.join('\n'));
    expect(parsed).toMatchObject({ agents: expect.arrayContaining([expect.objectContaining({ id: 'agent-1' })]) });
  });

  it('prints empty message when no agents exist', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ agents: [] }),
    );
    const output = captureOutput();
    const code = await agentListCommand({
      argv: [],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(0);
    expect(output.stdoutLines.join('\n')).toMatch(/No agent definitions found/);
  });

  it('exits 1 with error on API failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ error: 'Unauthorized' }, 401),
    );
    const output = captureOutput();
    const code = await agentListCommand({
      argv: ['--json'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(1);
    const parsed: unknown = JSON.parse(output.stdoutLines.join('\n'));
    expect(parsed).toMatchObject({ status: 401 });
  });

  it('exits 2 when API key is missing', async () => {
    const output = captureOutput();
    const code = await agentListCommand({
      argv: [],
      env: {},
      output,
    });
    expect(code).toBe(2);
  });
});
