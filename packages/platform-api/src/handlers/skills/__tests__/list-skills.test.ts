import { describe, it, expect, beforeEach } from 'vitest';
import { createSkill } from '../create-skill';
import { listSkills } from '../list-skills';
import { createSkillTestKit, skillMd } from './fixtures';

describe('listSkills', () => {
  let kit: ReturnType<typeof createSkillTestKit>;

  beforeEach(async () => {
    kit = createSkillTestKit();
    const create = (namespace: string, name: string, visibility: 'public' | 'private') =>
      createSkill({ namespace, files: [{ path: 'SKILL.md', contents: skillMd(name) }], visibility }, namespace === 'alpha' ? kit.member() : kit.outsider());
    await create('alpha', 'own-private', 'private');
    await create('alpha', 'own-public', 'public');
    await create('beta', 'beta-private', 'private');
    await create('beta', 'beta-public', 'public');
  });

  const refs = (output: Awaited<ReturnType<typeof listSkills>>) =>
    output.skills.map((skill) => `${skill.namespace}/${skill.id}`);

  it('lists only the namespace by default', async () => {
    expect(refs(await listSkills({ namespace: 'alpha' }, kit.member()))).toEqual(['alpha/own-private', 'alpha/own-public']);
  });

  it('with includePublic, appends other workspaces\' public skills once each', async () => {
    expect(refs(await listSkills({ namespace: 'alpha', includePublic: true }, kit.member()))).toEqual([
      'alpha/own-private',
      'alpha/own-public',
      'beta/beta-public',
    ]);
  });
});
