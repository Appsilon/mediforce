import { describe, it, expect, beforeEach } from 'vitest';
import { ForbiddenError } from '../../../errors';
import { createSkill } from '../create-skill';
import { deleteSkill } from '../delete-skill';
import { createSkillTestKit, files, skillMd } from './fixtures';

describe('deleteSkill', () => {
  let kit: ReturnType<typeof createSkillTestKit>;

  beforeEach(() => {
    kit = createSkillTestKit();
  });

  it('deletes a skill with an audit entry, and is a silent no-op when absent', async () => {
    await createSkill({ namespace: 'alpha', files }, kit.member());
    await deleteSkill({ namespace: 'alpha', id: 'sdtm-mapping' }, kit.member());
    await deleteSkill({ namespace: 'alpha', id: 'sdtm-mapping' }, kit.member());
    expect(await kit.repo.getById('alpha', 'sdtm-mapping', { publicOnly: false })).toBeNull();
    const events = await kit.auditRepo.getByEntity('skill', 'sdtm-mapping');
    expect(events.map((event) => event.action).sort()).toEqual(['skill.created', 'skill.deleted']);
  });

  it('shows another workspace only public skills, and lets it delete none', async () => {
    await createSkill({ namespace: 'alpha', files }, kit.member());
    const other = [{ path: 'SKILL.md', contents: skillMd('ae-grading', 'Grade AEs by CTCAE') }];
    await createSkill({ namespace: 'alpha', files: other, visibility: 'public' }, kit.member());

    expect((await kit.outsider().skills.list('alpha')).map((skill) => skill.id)).toEqual(['ae-grading']);
    expect((await kit.outsider().skills.getById('alpha', 'ae-grading'))?.files).toEqual(other);
    expect(await kit.outsider().skills.getById('alpha', 'sdtm-mapping')).toBeNull();
    await expect(deleteSkill({ namespace: 'alpha', id: 'ae-grading' }, kit.outsider())).rejects.toBeInstanceOf(ForbiddenError);
  });
});
