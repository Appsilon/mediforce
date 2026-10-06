import type { CreateAgentDefinitionInput } from '@mediforce/platform-core';
import {
  InMemoryAgentDefinitionRepository,
  InMemoryAuditRepository,
  InMemorySkillRepository,
} from '@mediforce/platform-core/testing';
import {
  createTestScope,
  userCaller,
} from '../../../repositories/__tests__/create-test-scope';

export const skillMd = (name: string, description = 'Map raw data to SDTM') =>
  `---\nname: ${name}\ndescription: ${description}\n---\n# ${name}\n`;

export const files = [
  { path: 'SKILL.md', contents: skillMd('sdtm-mapping') },
  { path: 'references/domains.md', contents: '# DM, AE\n' },
];

export const agentInput = (overrides: Partial<CreateAgentDefinitionInput> = {}): CreateAgentDefinitionInput => ({
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
  ...overrides,
});

export function createSkillTestKit() {
  const repo = new InMemorySkillRepository();
  const agentRepo = new InMemoryAgentDefinitionRepository();
  const auditRepo = new InMemoryAuditRepository();
  const scopeFor = (uid: string, namespaces: string[]) =>
    createTestScope({ skillRepo: repo, agentDefinitionRepo: agentRepo, auditRepo, caller: userCaller(uid, namespaces) });
  return {
    repo,
    agentRepo,
    auditRepo,
    member: () => scopeFor('u-member', ['alpha']),
    outsider: () => scopeFor('u-out', ['beta']),
  };
}
