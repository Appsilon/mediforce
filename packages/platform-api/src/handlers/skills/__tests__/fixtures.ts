import {
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

export function createSkillTestKit() {
  const repo = new InMemorySkillRepository();
  const auditRepo = new InMemoryAuditRepository();
  return {
    repo,
    auditRepo,
    member: () => createTestScope({ skillRepo: repo, auditRepo, caller: userCaller('u-member', ['alpha']) }),
    outsider: () => createTestScope({ skillRepo: repo, auditRepo, caller: userCaller('u-out', ['beta']) }),
  };
}
