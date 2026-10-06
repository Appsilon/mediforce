import { describe, it, expect } from 'vitest';
import { AgentDefinitionSchema, UpdateAgentDefinitionInputSchema } from '../agent-definition';

const baseAgent = {
  id: 'agent-1',
  name: 'Mapper',
  iconName: 'Bot',
  description: '',
  foundationModel: 'sonnet',
  systemPrompt: '',
  inputDescription: '',
  outputDescription: '',
  namespace: 'acme',
  createdAt: '2026-10-06T00:00:00.000Z',
  updatedAt: '2026-10-06T00:00:00.000Z',
};

describe('UpdateAgentDefinitionInputSchema', () => {
  it('leaves fields the patch omits unset, so an update cannot reset kind or visibility', () => {
    expect(UpdateAgentDefinitionInputSchema.parse({ description: 'changed' })).toEqual({ description: 'changed' });
  });
});

describe('AgentDefinitionSchema.skills', () => {
  it('leaves an agent without skills unchanged', () => {
    const parsed = AgentDefinitionSchema.parse(baseAgent);
    expect(parsed.skills).toBeUndefined();
  });

  it('accepts skills from different namespaces with distinct ids', () => {
    const parsed = AgentDefinitionSchema.parse({
      ...baseAgent,
      skills: [
        { namespace: 'acme', id: 'sdtm-mapping' },
        { namespace: 'shared', id: 'adam-derivation' },
      ],
    });
    expect(parsed.skills).toHaveLength(2);
  });

  it('refuses two skills with the same id, even from different namespaces', () => {
    const result = UpdateAgentDefinitionInputSchema.safeParse({
      skills: [
        { namespace: 'acme', id: 'sdtm-mapping' },
        { namespace: 'shared', id: 'sdtm-mapping' },
      ],
    });
    expect(result.success).toBe(false);
    if (result.success === false) {
      expect(result.error.issues[0]?.path).toEqual(['skills', 1, 'id']);
      expect(result.error.issues[0]?.message).toContain("'sdtm-mapping'");
    }
  });

  it('refuses a reference without a namespace', () => {
    const result = UpdateAgentDefinitionInputSchema.safeParse({ skills: [{ id: 'sdtm-mapping' }] });
    expect(result.success).toBe(false);
  });
});
