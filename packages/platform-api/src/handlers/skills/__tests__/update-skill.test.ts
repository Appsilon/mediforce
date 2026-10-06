import { describe, it, expect, beforeEach } from 'vitest';
import { UpdateSkillInputSchema } from '../../../contract/skills';
import { ForbiddenError, NotFoundError, ValidationError } from '../../../errors';
import { createSkill } from '../create-skill';
import { updateSkill } from '../update-skill';
import { createSkillTestKit, files, skillMd } from './fixtures';

describe('updateSkill', () => {
  let kit: ReturnType<typeof createSkillTestKit>;

  beforeEach(() => {
    kit = createSkillTestKit();
  });

  it('refuses an update that changes nothing', () => {
    expect(UpdateSkillInputSchema.safeParse({ namespace: 'alpha', id: 'sdtm-mapping' }).success).toBe(false);
    expect(UpdateSkillInputSchema.safeParse({ namespace: 'alpha', id: 'sdtm-mapping', visibility: 'public' }).success).toBe(true);
  });

  it('updates files and visibility, recomputes the hash, and audits', async () => {
    const created = await createSkill({ namespace: 'alpha', files }, kit.member());
    const nextFiles = [{ path: 'SKILL.md', contents: skillMd('sdtm-mapping', 'Map to SDTM v3.4') }];
    const { skill } = await updateSkill({ namespace: 'alpha', id: 'sdtm-mapping', files: nextFiles, visibility: 'public' }, kit.member());
    expect(skill.description).toBe('Map to SDTM v3.4');
    expect(skill.visibility).toBe('public');
    expect(skill.files).toEqual(nextFiles);
    expect(skill.contentHash).not.toBe(created.skill.contentHash);
    const events = await kit.auditRepo.getByEntity('skill', 'sdtm-mapping');
    expect(events.map((event) => event.action).sort()).toEqual(['skill.created', 'skill.updated']);
  });

  it('refuses an update whose SKILL.md renames the skill', async () => {
    await createSkill({ namespace: 'alpha', files }, kit.member());
    await expect(
      updateSkill({ namespace: 'alpha', id: 'sdtm-mapping', files: [{ path: 'SKILL.md', contents: skillMd('renamed') }] }, kit.member()),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('hides another workspace\'s private skill and refuses writes to its public one', async () => {
    await createSkill({ namespace: 'alpha', files }, kit.member());
    const other = [{ path: 'SKILL.md', contents: skillMd('ae-grading', 'Grade AEs by CTCAE') }];
    await createSkill({ namespace: 'alpha', files: other, visibility: 'public' }, kit.member());

    await expect(updateSkill({ namespace: 'alpha', id: 'sdtm-mapping', visibility: 'public' }, kit.outsider())).rejects.toBeInstanceOf(NotFoundError);
    await expect(updateSkill({ namespace: 'alpha', id: 'ae-grading', visibility: 'private' }, kit.outsider())).rejects.toBeInstanceOf(ForbiddenError);
  });
});
