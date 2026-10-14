import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryAgentDefinitionRepository, InMemoryAuditRepository, InMemorySkillRepository } from '@mediforce/platform-core/testing';
import { ForbiddenError, ValidationError } from '../../../errors';
import { createStubRepoFileReader, type StubRepoFileReader } from '../../../runtime/repo-file-reader';
import { createTestScope, userCaller } from '../../../repositories/__tests__/create-test-scope';
import { importSkills } from '../import-skills';
import { updateSkill } from '../update-skill';
import { skillMd } from './fixtures';

const SHA = 'a'.repeat(40);
const REPO = 'https://github.com/acme/skills';

describe('importSkills', () => {
  let reader: StubRepoFileReader;
  let skillRepo: InMemorySkillRepository;
  let auditRepo: InMemoryAuditRepository;
  const scopeFor = (namespaces: string[]) => createTestScope({
    skillRepo,
    auditRepo,
    agentDefinitionRepo: new InMemoryAgentDefinitionRepository(),
    repoFileReader: reader,
    caller: userCaller('u-member', namespaces),
  });

  const seed = (files: Record<string, string>) => {
    reader.tree = Object.keys(files).map((path) => ({ path }));
    reader.files = files;
  };

  beforeEach(() => {
    reader = createStubRepoFileReader();
    skillRepo = new InMemorySkillRepository();
    auditRepo = new InMemoryAuditRepository();
    seed({
      'skills/rank-changes/SKILL.md': skillMd('rank-changes', 'Rank merged changes'),
      'skills/rank-changes/references/rubric.md': '# Rubric\n',
      'skills/draft-posts/SKILL.md': skillMd('draft-posts', 'Draft Discord posts'),
      'skills/draft-posts/.DS_Store': 'junk',
      'skills/_registry.yml': 'version: 1\n',
      'skills/notes/README.md': '# not a skill\n',
      'README.md': '# repo\n',
    });
  });

  it('creates a Skill from every <dir>/<name>/SKILL.md folder, read anonymously at the resolved commit', async () => {
    const result = await importSkills({ namespace: 'alpha', repo: REPO, ref: SHA, dir: 'skills/' }, scopeFor(['alpha']));

    expect(result).toEqual({
      source: { url: REPO, commit: SHA, dir: 'skills' },
      skills: [
        { id: 'draft-posts', outcome: 'created' },
        { id: 'rank-changes', outcome: 'created' },
      ],
    });
    const rank = await skillRepo.getById('alpha', 'rank-changes', { publicOnly: false });
    expect(rank?.files).toEqual([
      { path: 'SKILL.md', contents: skillMd('rank-changes', 'Rank merged changes') },
      { path: 'references/rubric.md', contents: '# Rubric\n' },
    ]);
    expect((await skillRepo.getById('alpha', 'draft-posts', { publicOnly: false }))?.files.map((file) => file.path)).toEqual(['SKILL.md']);
    expect(reader.reads.every((read) => read.repo === REPO && read.commit === SHA)).toBe(true);
    const events = await auditRepo.getByEntity('skill', 'rank-changes');
    expect(events[0]?.basis).toBe(`Skill imported from ${REPO}@${SHA} (skills)`);
  });

  it('on re-import leaves identical Skills alone and updates changed ones, keeping their visibility', async () => {
    const scope = scopeFor(['alpha']);
    await importSkills({ namespace: 'alpha', repo: REPO, ref: SHA, dir: 'skills' }, scope);
    await updateSkill({ namespace: 'alpha', id: 'rank-changes', visibility: 'public' }, scope);
    reader.files['skills/rank-changes/references/rubric.md'] = '# Rubric v2\n';

    const result = await importSkills({ namespace: 'alpha', repo: REPO, ref: SHA, dir: 'skills' }, scope);

    expect(result.skills).toEqual([
      { id: 'draft-posts', outcome: 'unchanged' },
      { id: 'rank-changes', outcome: 'updated' },
    ]);
    const rank = await skillRepo.getById('alpha', 'rank-changes', { publicOnly: false });
    expect(rank?.visibility).toBe('public');
    expect(rank?.files.find((file) => file.path === 'references/rubric.md')?.contents).toBe('# Rubric v2\n');
  });

  it('imports nothing when one folder is not a valid skill, and names it', async () => {
    reader.files['skills/draft-posts/SKILL.md'] = '# no frontmatter\n';

    await expect(importSkills({ namespace: 'alpha', repo: REPO, ref: SHA, dir: 'skills' }, scopeFor(['alpha'])))
      .rejects.toThrow(/skills\/draft-posts: .*frontmatter/);
    expect(await skillRepo.getById('alpha', 'rank-changes', { publicOnly: false })).toBeNull();
  });

  it('imports nothing when a folder\'s SKILL.md cannot be read', async () => {
    reader.files['skills/draft-posts/SKILL.md'] = 'x'.repeat(1024 * 1024 + 1);

    await expect(importSkills({ namespace: 'alpha', repo: REPO, ref: SHA, dir: 'skills' }, scopeFor(['alpha'])))
      .rejects.toThrow(/skills\/draft-posts\/SKILL.md is over/);
    expect(await skillRepo.getById('alpha', 'rank-changes', { publicOnly: false })).toBeNull();
  });

  it('refuses a directory with no skill folders', async () => {
    await expect(importSkills({ namespace: 'alpha', repo: REPO, ref: SHA, dir: 'docs' }, scopeFor(['alpha'])))
      .rejects.toBeInstanceOf(ValidationError);
  });

  it('refuses a directory that climbs out of the repository', async () => {
    await expect(importSkills({ namespace: 'alpha', repo: REPO, ref: SHA, dir: '../etc' }, scopeFor(['alpha'])))
      .rejects.toThrow(/climbs out/);
  });

  it('refuses a workspace the caller cannot write before reading the repository', async () => {
    await expect(importSkills({ namespace: 'alpha', repo: REPO, ref: SHA, dir: 'skills' }, scopeFor(['beta'])))
      .rejects.toBeInstanceOf(ForbiddenError);
    expect(reader.reads).toEqual([]);
  });
});
