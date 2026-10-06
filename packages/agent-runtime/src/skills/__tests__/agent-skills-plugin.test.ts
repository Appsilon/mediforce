import { describe, it, expect, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Skill } from '@mediforce/platform-core';
import { materializeAgentSkillsPlugin } from '../agent-skills-plugin';

/** Each test gets skills of its own content, so the shared cache under the
 *  system temp dir never serves one test another's folder. */
function makeSkill(id: string, files: Skill['files'], namespace = 'alpha'): Skill {
  return {
    namespace,
    id,
    name: id,
    description: `${id} skill`,
    visibility: 'private',
    contentHash: randomUUID(),
    files,
    createdAt: '2026-10-06T00:00:00.000Z',
    updatedAt: '2026-10-06T00:00:00.000Z',
  };
}

const skillMd = (id: string, body = '') => `---\nname: ${id}\ndescription: ${id} skill\n---\n${body}`;

const scratch: string[] = [];

/** A step plugin root on disk: `<root>/<relative path>` for each entry. */
async function stepPluginRoot(entries: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'agent-skills-step-'));
  scratch.push(root);
  for (const [path, contents] of Object.entries(entries)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), contents);
  }
  return root;
}

afterEach(async () => {
  await Promise.all(scratch.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('materializeAgentSkillsPlugin', () => {
  it('[DATA] writes a Claude Code plugin with each skill as a folder under skills/', async () => {
    const mapping = makeSkill('sdtm-mapping', [
      { path: 'SKILL.md', contents: skillMd('sdtm-mapping') },
      { path: 'references/domains.md', contents: '# DM, AE\n' },
    ]);
    const coding = makeSkill('meddra-coding', [{ path: 'SKILL.md', contents: skillMd('meddra-coding') }]);

    const { dir, clashes } = await materializeAgentSkillsPlugin([mapping, coding], null);

    expect(clashes).toEqual([]);
    expect(JSON.parse(await readFile(join(dir, '.claude-plugin', 'plugin.json'), 'utf-8'))).toEqual({ name: 'mediforce-agent-skills' });
    expect((await readdir(join(dir, 'skills'))).sort()).toEqual(['meddra-coding', 'sdtm-mapping']);
    expect(await readFile(join(dir, 'skills', 'sdtm-mapping', 'references', 'domains.md'), 'utf-8')).toBe('# DM, AE\n');
  });

  it('[DATA] is deterministic: the same skills in any order give the same folder', async () => {
    const mapping = makeSkill('sdtm-mapping', [{ path: 'SKILL.md', contents: skillMd('sdtm-mapping') }]);
    const coding = makeSkill('meddra-coding', [{ path: 'SKILL.md', contents: skillMd('meddra-coding') }]);

    const first = await materializeAgentSkillsPlugin([mapping, coding], null);
    const second = await materializeAgentSkillsPlugin([coding, mapping], null);

    expect(second.dir).toBe(first.dir);
  });

  it('[DATA] gives an edited skill a folder of its own, leaving the old one in place', async () => {
    const before = makeSkill('sdtm-mapping', [{ path: 'SKILL.md', contents: skillMd('sdtm-mapping', 'v1\n') }]);
    const after = { ...before, contentHash: randomUUID(), files: [{ path: 'SKILL.md', contents: skillMd('sdtm-mapping', 'v2\n') }] };

    const old = await materializeAgentSkillsPlugin([before], null);
    const edited = await materializeAgentSkillsPlugin([after], null);

    expect(edited.dir).not.toBe(old.dir);
    expect(await readFile(join(old.dir, 'skills', 'sdtm-mapping', 'SKILL.md'), 'utf-8')).toContain('v1');
    expect(await readFile(join(edited.dir, 'skills', 'sdtm-mapping', 'SKILL.md'), 'utf-8')).toContain('v2');
  });

  it('[DATA] concurrent writes of the same skills settle on one complete folder', async () => {
    const mapping = makeSkill('sdtm-mapping', [{ path: 'SKILL.md', contents: skillMd('sdtm-mapping') }]);

    const results = await Promise.all(Array.from({ length: 5 }, () => materializeAgentSkillsPlugin([mapping], null)));

    expect(new Set(results.map((result) => result.dir)).size).toBe(1);
    expect(existsSync(join(results[0]!.dir, 'skills', 'sdtm-mapping', 'SKILL.md'))).toBe(true);
  });

  it('[DATA] merges the step skills in, and the step wins a name clash', async () => {
    const root = await stepPluginRoot({
      'skills/sdtm-mapping/SKILL.md': skillMd('sdtm-mapping', 'step version\n'),
      'skills/define-xml/SKILL.md': skillMd('define-xml'),
    });
    const agentMapping = makeSkill('sdtm-mapping', [{ path: 'SKILL.md', contents: skillMd('sdtm-mapping', 'agent version\n') }]);
    const agentCoding = makeSkill('meddra-coding', [{ path: 'SKILL.md', contents: skillMd('meddra-coding') }]);

    const { dir, clashes } = await materializeAgentSkillsPlugin([agentMapping, agentCoding], join(root, 'skills'));

    expect(clashes).toEqual(['sdtm-mapping']);
    expect((await readdir(join(dir, 'skills'))).sort()).toEqual(['define-xml', 'meddra-coding', 'sdtm-mapping']);
    expect(await readFile(join(dir, 'skills', 'sdtm-mapping', 'SKILL.md'), 'utf-8')).toContain('step version');
  });

  it('[DATA] keeps the manifest, commands and agents of a step plugin root', async () => {
    const root = await stepPluginRoot({
      '.claude-plugin/plugin.json': '{"name":"cdisc-toolkit"}\n',
      'commands/validate.md': '# validate\n',
      'agents/reviewer.md': '# reviewer\n',
      'skills/define-xml/SKILL.md': skillMd('define-xml'),
    });
    const agentCoding = makeSkill('meddra-coding', [{ path: 'SKILL.md', contents: skillMd('meddra-coding') }]);

    const { dir } = await materializeAgentSkillsPlugin([agentCoding], join(root, 'skills'));

    expect(JSON.parse(await readFile(join(dir, '.claude-plugin', 'plugin.json'), 'utf-8'))).toEqual({ name: 'cdisc-toolkit' });
    expect(existsSync(join(dir, 'commands', 'validate.md'))).toBe(true);
    expect(existsSync(join(dir, 'agents', 'reviewer.md'))).toBe(true);
    expect((await readdir(join(dir, 'skills'))).sort()).toEqual(['define-xml', 'meddra-coding']);
  });

  it('[DATA] keeps the commands and agents of a step plugin root without a manifest, and nothing else from it', async () => {
    const root = await stepPluginRoot({
      'commands/validate.md': '# validate\n',
      'agents/reviewer.md': '# reviewer\n',
      'README.md': '# a repo checkout, not a plugin\n',
      'skills/define-xml/SKILL.md': skillMd('define-xml'),
    });
    const agentCoding = makeSkill('meddra-coding', [{ path: 'SKILL.md', contents: skillMd('meddra-coding') }]);

    const { dir } = await materializeAgentSkillsPlugin([agentCoding], join(root, 'skills'));

    expect((await readdir(dir)).sort()).toEqual(['.claude-plugin', 'agents', 'commands', 'skills']);
    expect(JSON.parse(await readFile(join(dir, '.claude-plugin', 'plugin.json'), 'utf-8'))).toEqual({ name: 'mediforce-agent-skills' });
  });

  it('[DATA] follows a symlinked folder in the step skills, as the copy does', async () => {
    const shared = await stepPluginRoot({ 'SKILL.md': skillMd('shared-glossary') });
    const root = await stepPluginRoot({ 'skills/define-xml/SKILL.md': skillMd('define-xml') });
    await symlink(shared, join(root, 'skills', 'shared-glossary'));
    const agentCoding = makeSkill('meddra-coding', [{ path: 'SKILL.md', contents: skillMd('meddra-coding') }]);

    const { dir } = await materializeAgentSkillsPlugin([agentCoding], join(root, 'skills'));

    expect(await readFile(join(dir, 'skills', 'shared-glossary', 'SKILL.md'), 'utf-8')).toBe(skillMd('shared-glossary'));
  });

  it('[DATA] makes only scripts/ executable', async () => {
    const mapping = makeSkill('sdtm-mapping', [
      { path: 'SKILL.md', contents: skillMd('sdtm-mapping') },
      { path: 'scripts/check.py', contents: 'print("ok")\n' },
    ]);

    const { dir } = await materializeAgentSkillsPlugin([mapping], null);

    expect((await stat(join(dir, 'skills', 'sdtm-mapping', 'SKILL.md'))).mode & 0o777).toBe(0o644);
    expect((await stat(join(dir, 'skills', 'sdtm-mapping', 'scripts', 'check.py'))).mode & 0o777).toBe(0o755);
  });

  it('[DATA] a changed step skill gives a new folder', async () => {
    const root = await stepPluginRoot({ 'skills/define-xml/SKILL.md': skillMd('define-xml', 'v1\n') });
    const agentCoding = makeSkill('meddra-coding', [{ path: 'SKILL.md', contents: skillMd('meddra-coding') }]);

    const first = await materializeAgentSkillsPlugin([agentCoding], join(root, 'skills'));
    await writeFile(join(root, 'skills', 'define-xml', 'SKILL.md'), skillMd('define-xml', 'v2\n'));
    const second = await materializeAgentSkillsPlugin([agentCoding], join(root, 'skills'));

    expect(second.dir).not.toBe(first.dir);
  });

  it('[DATA] ignores a step skills folder that does not exist', async () => {
    const agentCoding = makeSkill('meddra-coding', [{ path: 'SKILL.md', contents: skillMd('meddra-coding') }]);

    const { dir } = await materializeAgentSkillsPlugin([agentCoding], join(tmpdir(), `absent-${randomUUID()}`, 'skills'));

    expect(await readdir(join(dir, 'skills'))).toEqual(['meddra-coding']);
  });

  it('[ERROR] refuses a file path that would escape the skill folder', async () => {
    const escaping = makeSkill('sdtm-mapping', [{ path: '../../escape.md', contents: 'x' }]);

    await expect(materializeAgentSkillsPlugin([escaping], null)).rejects.toThrow("skill file '../../escape.md' does not name a file inside skill 'alpha/sdtm-mapping'");
  });
});
