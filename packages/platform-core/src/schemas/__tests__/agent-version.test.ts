import { describe, it, expect } from 'vitest';
import { agentStepChanges } from '../agent-version';

const agent = { runtimeId: 'claude-code-agent', foundationModel: 'anthropic/claude-sonnet-5' };

describe('agentStepChanges', () => {
  it('finds nothing in a step that runs the agent as it is, whatever it provides around it', () => {
    expect(agentStepChanges({
      plugin: 'claude-code-agent',
      agent: { model: 'anthropic/claude-sonnet-5', image: 'custom-image:1', dockerfile: 'Dockerfile', timeoutMinutes: 30 },
      mcpRestrictions: { edc: {} },
    }, agent)).toEqual([]);
    expect(agentStepChanges({}, agent)).toEqual([]);
  });

  it('names every part of the agent the step changes', () => {
    expect(agentStepChanges({
      plugin: 'opencode-agent',
      agent: {
        model: 'openai/gpt-5',
        prompt: 'Grade each AE by its CTCAE grade.',
        skills: [{ namespace: 'pharma-a', id: 'ctcae' }],
        outputSchema: { type: 'object', properties: {} },
        mcpServers: [{ name: 'edc', command: 'edc-mcp', args: [] }],
      },
      mcpRestrictions: { edc: { denyTools: ['write_record'] } },
    }, agent, 'Answer as a pharmacovigilance reviewer.')).toEqual([
      'plugin', 'model', 'step prompt', 'skills', 'output schema', 'MCP servers', 'MCP restrictions', 'workflow preamble',
    ]);
  });
});
