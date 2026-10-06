import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryAuditRepository,
  InMemorySkillRepository,
} from '@mediforce/platform-core/testing';
import { CreateSkillInputSchema, UpdateSkillInputSchema } from '../../../contract/skills';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../../errors';
import {
  createTestScope,
  userCaller,
} from '../../../repositories/__tests__/create-test-scope';
import { createSkill } from '../create-skill';
import { deleteSkill } from '../delete-skill';
import { updateSkill } from '../update-skill';

const skillMd = (name: string, description = 'Map raw data to SDTM') =>
  `---\nname: ${name}\ndescription: ${description}\n---\n# ${name}\n`;

const files = [
  { path: 'SKILL.md', contents: skillMd('sdtm-mapping') },
  { path: 'references/domains.md', contents: '# DM, AE\n' },
];

describe('skill handlers', () => {
  let repo: InMemorySkillRepository;
  let auditRepo: InMemoryAuditRepository;
  const member = () => createTestScope({ skillRepo: repo, auditRepo, caller: userCaller('u-member', ['alpha']) });
  const outsider = () => createTestScope({ skillRepo: repo, auditRepo, caller: userCaller('u-out', ['beta']) });

  beforeEach(() => {
    repo = new InMemorySkillRepository();
    auditRepo = new InMemoryAuditRepository();
  });

  it('creates a skill whose id, name and description come from SKILL.md', async () => {
    const { skill } = await createSkill({ namespace: 'alpha', files }, member());
    expect(skill).toMatchObject({
      namespace: 'alpha',
      id: 'sdtm-mapping',
      name: 'sdtm-mapping',
      description: 'Map raw data to SDTM',
      visibility: 'private',
      files,
    });
    expect(skill.contentHash).toMatch(/^[0-9a-f]{64}$/);
    const events = await auditRepo.getByEntity('skill', 'sdtm-mapping');
    expect(events.map((event) => event.action)).toEqual(['skill.created']);
  });

  it('hashes content independently of file order', async () => {
    const first = await createSkill({ namespace: 'alpha', files }, member());
    await deleteSkill({ namespace: 'alpha', id: 'sdtm-mapping' }, member());
    const second = await createSkill({ namespace: 'alpha', files: [...files].reverse() }, member());
    expect(second.skill.contentHash).toBe(first.skill.contentHash);
  });

  it('refuses a second skill with the same name', async () => {
    await createSkill({ namespace: 'alpha', files }, member());
    await expect(createSkill({ namespace: 'alpha', files }, member())).rejects.toBeInstanceOf(ConflictError);
  });

  it('refuses a create in a workspace the caller is not a member of', async () => {
    await expect(createSkill({ namespace: 'alpha', files }, outsider())).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('accepts a file over the per-artifact cap while the whole Skill stays under its own', () => {
    const big = [...files, { path: 'references/big.md', contents: 'x'.repeat(100 * 1024) }];
    expect(CreateSkillInputSchema.safeParse({ namespace: 'alpha', files: big }).success).toBe(true);
  });

  it('refuses a NUL character in a file, which jsonb cannot store', () => {
    const nul = [...files, { path: 'references/nul.md', contents: 'a\u0000b' }];
    expect(CreateSkillInputSchema.safeParse({ namespace: 'alpha', files: nul }).success).toBe(false);
  });

  it('refuses an update that changes nothing', () => {
    expect(UpdateSkillInputSchema.safeParse({ namespace: 'alpha', id: 'sdtm-mapping' }).success).toBe(false);
    expect(UpdateSkillInputSchema.safeParse({ namespace: 'alpha', id: 'sdtm-mapping', visibility: 'public' }).success).toBe(true);
  });

  it('the contract refuses a name or description sent beside the files', () => {
    expect(CreateSkillInputSchema.safeParse({ namespace: 'alpha', files, name: 'other' }).success).toBe(false);
    expect(CreateSkillInputSchema.safeParse({ namespace: 'alpha', files, description: 'other' }).success).toBe(false);
  });

  it('updates files and visibility, recomputes the hash, and audits', async () => {
    const created = await createSkill({ namespace: 'alpha', files }, member());
    const nextFiles = [{ path: 'SKILL.md', contents: skillMd('sdtm-mapping', 'Map to SDTM v3.4') }];
    const { skill } = await updateSkill({ namespace: 'alpha', id: 'sdtm-mapping', files: nextFiles, visibility: 'public' }, member());
    expect(skill.description).toBe('Map to SDTM v3.4');
    expect(skill.visibility).toBe('public');
    expect(skill.files).toEqual(nextFiles);
    expect(skill.contentHash).not.toBe(created.skill.contentHash);
    const events = await auditRepo.getByEntity('skill', 'sdtm-mapping');
    expect(events.map((event) => event.action).sort()).toEqual(['skill.created', 'skill.updated']);
  });

  it('refuses an update whose SKILL.md renames the skill', async () => {
    await createSkill({ namespace: 'alpha', files }, member());
    await expect(
      updateSkill({ namespace: 'alpha', id: 'sdtm-mapping', files: [{ path: 'SKILL.md', contents: skillMd('renamed') }] }, member()),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('shows another workspace only public skills, and lets it write none', async () => {
    await createSkill({ namespace: 'alpha', files }, member());
    const other = [{ path: 'SKILL.md', contents: skillMd('ae-grading', 'Grade AEs by CTCAE') }];
    await createSkill({ namespace: 'alpha', files: other, visibility: 'public' }, member());

    expect((await outsider().skills.list('alpha')).map((skill) => skill.id)).toEqual(['ae-grading']);
    expect((await outsider().skills.getById('alpha', 'ae-grading'))?.files).toEqual(other);
    expect(await outsider().skills.getById('alpha', 'sdtm-mapping')).toBeNull();
    await expect(updateSkill({ namespace: 'alpha', id: 'sdtm-mapping', visibility: 'public' }, outsider())).rejects.toBeInstanceOf(NotFoundError);
    await expect(updateSkill({ namespace: 'alpha', id: 'ae-grading', visibility: 'private' }, outsider())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(deleteSkill({ namespace: 'alpha', id: 'ae-grading' }, outsider())).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('deletes a skill with an audit entry, and is a silent no-op when absent', async () => {
    await createSkill({ namespace: 'alpha', files }, member());
    await deleteSkill({ namespace: 'alpha', id: 'sdtm-mapping' }, member());
    await deleteSkill({ namespace: 'alpha', id: 'sdtm-mapping' }, member());
    expect(await repo.getById('alpha', 'sdtm-mapping', { publicOnly: false })).toBeNull();
    const events = await auditRepo.getByEntity('skill', 'sdtm-mapping');
    expect(events.map((event) => event.action).sort()).toEqual(['skill.created', 'skill.deleted']);
  });
});
