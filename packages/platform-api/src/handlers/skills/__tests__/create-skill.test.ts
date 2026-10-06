import { describe, it, expect, beforeEach } from 'vitest';
import { CreateSkillInputSchema } from '../../../contract/skills';
import { ConflictError, ForbiddenError } from '../../../errors';
import { createSkill } from '../create-skill';
import { deleteSkill } from '../delete-skill';
import { createSkillTestKit, files } from './fixtures';

describe('createSkill', () => {
  let kit: ReturnType<typeof createSkillTestKit>;

  beforeEach(() => {
    kit = createSkillTestKit();
  });

  it('creates a skill whose id, name and description come from SKILL.md', async () => {
    const { skill } = await createSkill({ namespace: 'alpha', files }, kit.member());
    expect(skill).toMatchObject({
      namespace: 'alpha',
      id: 'sdtm-mapping',
      name: 'sdtm-mapping',
      description: 'Map raw data to SDTM',
      visibility: 'private',
      files,
    });
    expect(skill.contentHash).toMatch(/^[0-9a-f]{64}$/);
    const events = await kit.auditRepo.getByEntity('skill', 'sdtm-mapping');
    expect(events.map((event) => event.action)).toEqual(['skill.created']);
  });

  it('hashes content independently of file order', async () => {
    const first = await createSkill({ namespace: 'alpha', files }, kit.member());
    await deleteSkill({ namespace: 'alpha', id: 'sdtm-mapping' }, kit.member());
    const second = await createSkill({ namespace: 'alpha', files: [...files].reverse() }, kit.member());
    expect(second.skill.contentHash).toBe(first.skill.contentHash);
  });

  it('refuses a second skill with the same name', async () => {
    await createSkill({ namespace: 'alpha', files }, kit.member());
    await expect(createSkill({ namespace: 'alpha', files }, kit.member())).rejects.toBeInstanceOf(ConflictError);
  });

  it('refuses a create in a workspace the caller is not a member of', async () => {
    await expect(createSkill({ namespace: 'alpha', files }, kit.outsider())).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('accepts a file over the per-artifact cap while the whole Skill stays under its own', () => {
    const big = [...files, { path: 'references/big.md', contents: 'x'.repeat(100 * 1024) }];
    expect(CreateSkillInputSchema.safeParse({ namespace: 'alpha', files: big }).success).toBe(true);
  });

  it('refuses a NUL character in a file, which jsonb cannot store', () => {
    const nul = [...files, { path: 'references/nul.md', contents: 'a\u0000b' }];
    expect(CreateSkillInputSchema.safeParse({ namespace: 'alpha', files: nul }).success).toBe(false);
  });

  it('the contract refuses a name or description sent beside the files', () => {
    expect(CreateSkillInputSchema.safeParse({ namespace: 'alpha', files, name: 'other' }).success).toBe(false);
    expect(CreateSkillInputSchema.safeParse({ namespace: 'alpha', files, description: 'other' }).success).toBe(false);
  });
});
