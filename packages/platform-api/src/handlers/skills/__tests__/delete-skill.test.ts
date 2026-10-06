import { describe, it, expect, beforeEach } from 'vitest';
import { ConflictError, ForbiddenError } from '../../../errors';
import { createSkill } from '../create-skill';
import { deleteSkill } from '../delete-skill';
import { agentInput, createSkillTestKit, files, skillMd } from './fixtures';

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

  it('refuses while agents hold the skill, naming the visible holders and counting the rest', async () => {
    await createSkill({ namespace: 'alpha', files, visibility: 'public' }, kit.member());
    const held = { skills: [{ namespace: 'alpha', id: 'sdtm-mapping' }] };
    await kit.agentRepo.upsert('own', agentInput({ name: 'Own Mapper', ...held }));
    await kit.agentRepo.upsert('foreign', agentInput({ name: 'Foreign Mapper', namespace: 'gamma', ...held }));

    const refusal = await deleteSkill({ namespace: 'alpha', id: 'sdtm-mapping' }, kit.member()).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(ConflictError);
    expect((refusal as ConflictError).message).toContain("'Own Mapper' (alpha), 1 agent you cannot see");
    expect((refusal as ConflictError).message).not.toContain('Foreign Mapper');
    expect((refusal as ConflictError).details).toEqual({
      agents: [{ id: 'own', name: 'Own Mapper', namespace: 'alpha' }],
      hiddenCount: 1,
    });
    expect(await kit.repo.getById('alpha', 'sdtm-mapping', { publicOnly: false })).not.toBeNull();

    await kit.agentRepo.update('own', { skills: [] });
    await kit.agentRepo.update('foreign', { skills: [] });
    await deleteSkill({ namespace: 'alpha', id: 'sdtm-mapping' }, kit.member());
    expect(await kit.repo.getById('alpha', 'sdtm-mapping', { publicOnly: false })).toBeNull();
  });

  it('refuses a caller without write access before revealing any holder', async () => {
    await createSkill({ namespace: 'alpha', files, visibility: 'public' }, kit.member());
    await kit.agentRepo.upsert('own', agentInput({ skills: [{ namespace: 'alpha', id: 'sdtm-mapping' }] }));
    await expect(deleteSkill({ namespace: 'alpha', id: 'sdtm-mapping' }, kit.outsider())).rejects.toBeInstanceOf(ForbiddenError);
  });
});
