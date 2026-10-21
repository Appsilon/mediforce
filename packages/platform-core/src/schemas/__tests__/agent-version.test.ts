import { describe, it, expect } from 'vitest';
import { DEFAULT_AGENT_IMAGE } from '../../utils/container-defaults';
import { agentEvalDefinition, agentStepChanges } from '../agent-version';

const agent = { runtimeId: 'claude-code-agent', foundationModel: 'anthropic/claude-sonnet-5' };

describe('agentStepChanges', () => {
  it('finds nothing in a step that runs the agent as it is, whatever it provides around it', () => {
    expect(agentStepChanges({
      plugin: 'claude-code-agent',
      agent: { model: 'anthropic/claude-sonnet-5', image: DEFAULT_AGENT_IMAGE, timeoutMinutes: 30 },
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
        image: 'custom-image:1',
        skills: [{ namespace: 'pharma-a', id: 'ctcae' }],
        outputSchema: { type: 'object', properties: {} },
        mcpServers: [{ name: 'edc', command: 'edc-mcp', args: [] }],
      },
      mcpRestrictions: { edc: { denyTools: ['write_record'] } },
    }, agent, { preamble: 'Answer as a pharmacovigilance reviewer.' })).toEqual([
      'plugin', 'model', 'image', 'step prompt', 'skills', 'output schema', 'MCP servers', 'MCP restrictions', 'workflow preamble',
    ]);
  });

  it('compares the image the step runs with the one the agent runs in, golden when it names none', () => {
    expect(agentStepChanges({ agent: { image: `${DEFAULT_AGENT_IMAGE}:latest` } }, agent)).toEqual([]);
    expect(agentStepChanges({ agent: { image: 'r-tools:2' } }, agent)).toEqual(['image']);

    const rAgent = { ...agent, image: 'r-tools:2' };
    expect(agentStepChanges({ agent: { image: 'r-tools:2' } }, rAgent)).toEqual([]);
    expect(agentStepChanges({ agent: {} }, rAgent)).toEqual([]);
    expect(agentStepChanges({ agent: { image: DEFAULT_AGENT_IMAGE } }, rAgent)).toEqual(['image']);
  });

  it('counts a step that builds its own image as a change, whatever tag it names', () => {
    expect(agentStepChanges({ agent: { repo: 'https://github.com/acme/tools', commit: 'abc123', image: DEFAULT_AGENT_IMAGE } }, agent)).toEqual(['image']);
  });

  it('ignores a leftover build field the runtime ignores too, and compares the ready image', () => {
    expect(agentStepChanges({ agent: { dockerfile: 'Dockerfile', image: DEFAULT_AGENT_IMAGE } }, agent)).toEqual([]);
    expect(agentStepChanges({ agent: { repo: 'https://github.com/acme/tools', image: DEFAULT_AGENT_IMAGE } }, agent)).toEqual([]);
  });
});

describe('agentEvalDefinition', () => {
  const evaluated = { id: 'ae-grader', name: 'AE grader', namespace: 'team-alpha', runtimeId: 'claude-code-agent' };

  it('runs the trial in the agent\'s image, or the golden image when it names none', () => {
    expect(agentEvalDefinition(evaluated, 1).steps[0]!.agent).toEqual({ image: DEFAULT_AGENT_IMAGE });
    expect(agentEvalDefinition({ ...evaluated, image: 'r-tools:2' }, 1).steps[0]!.agent).toEqual({ image: 'r-tools:2' });
  });

  it('runs an agent that names no image on the host when local execution is allowed', () => {
    expect(agentEvalDefinition(evaluated, 1, {}, { localExecution: true }).steps[0]!.agent).toEqual({});
    expect(agentEvalDefinition({ ...evaluated, image: 'r-tools:2' }, 1, {}, { localExecution: true }).steps[0]!.agent).toEqual({ image: 'r-tools:2' });
  });
});
