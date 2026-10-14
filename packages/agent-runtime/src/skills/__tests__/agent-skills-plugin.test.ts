import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
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

describe('materializeAgentSkillsPlugin', () => {
  it('[DATA] writes a Claude Code plugin with each skill as a folder under skills/', async () => {
    const mapping = makeSkill('sdtm-mapping', [
      { path: 'SKILL.md', contents: skillMd('sdtm-mapping') },
      { path: 'references/domains.md', contents: '# DM, AE\n' },
    ]);
    const coding = makeSkill('meddra-coding', [{ path: 'SKILL.md', contents: skillMd('meddra-coding') }]);

    const dir = await materializeAgentSkillsPlugin([mapping, coding]);

    expect(JSON.parse(await readFile(join(dir, '.claude-plugin', 'plugin.json'), 'utf-8'))).toEqual({ name: 'mediforce-agent-skills' });
    expect((await readdir(join(dir, 'skills'))).sort()).toEqual(['meddra-coding', 'sdtm-mapping']);
    expect(await readFile(join(dir, 'skills', 'sdtm-mapping', 'references', 'domains.md'), 'utf-8')).toBe('# DM, AE\n');
  });

  it('[DATA] is deterministic: the same skills in any order give the same folder', async () => {
    const mapping = makeSkill('sdtm-mapping', [{ path: 'SKILL.md', contents: skillMd('sdtm-mapping') }]);
    const coding = makeSkill('meddra-coding', [{ path: 'SKILL.md', contents: skillMd('meddra-coding') }]);

    const first = await materializeAgentSkillsPlugin([mapping, coding]);
    const second = await materializeAgentSkillsPlugin([coding, mapping]);

    expect(second).toBe(first);
  });

  it('[DATA] gives an edited skill a folder of its own, leaving the old one in place', async () => {
    const before = makeSkill('sdtm-mapping', [{ path: 'SKILL.md', contents: skillMd('sdtm-mapping', 'v1\n') }]);
    const after = { ...before, contentHash: randomUUID(), files: [{ path: 'SKILL.md', contents: skillMd('sdtm-mapping', 'v2\n') }] };

    const old = await materializeAgentSkillsPlugin([before]);
    const edited = await materializeAgentSkillsPlugin([after]);

    expect(edited).not.toBe(old);
    expect(await readFile(join(old, 'skills', 'sdtm-mapping', 'SKILL.md'), 'utf-8')).toContain('v1');
    expect(await readFile(join(edited, 'skills', 'sdtm-mapping', 'SKILL.md'), 'utf-8')).toContain('v2');
  });

  it('[DATA] concurrent writes of the same skills settle on one complete folder', async () => {
    const mapping = makeSkill('sdtm-mapping', [{ path: 'SKILL.md', contents: skillMd('sdtm-mapping') }]);

    const results = await Promise.all(Array.from({ length: 5 }, () => materializeAgentSkillsPlugin([mapping])));

    expect(new Set(results).size).toBe(1);
    expect(existsSync(join(results[0]!, 'skills', 'sdtm-mapping', 'SKILL.md'))).toBe(true);
  });

  it('[DATA] makes only scripts/ executable', async () => {
    const mapping = makeSkill('sdtm-mapping', [
      { path: 'SKILL.md', contents: skillMd('sdtm-mapping') },
      { path: 'scripts/check.py', contents: 'print("ok")\n' },
    ]);

    const dir = await materializeAgentSkillsPlugin([mapping]);

    expect((await stat(join(dir, 'skills', 'sdtm-mapping', 'SKILL.md'))).mode & 0o777).toBe(0o644);
    expect((await stat(join(dir, 'skills', 'sdtm-mapping', 'scripts', 'check.py'))).mode & 0o777).toBe(0o755);
  });

  it('[ERROR] refuses a file path that would escape the skill folder', async () => {
    const escaping = makeSkill('sdtm-mapping', [{ path: '../../escape.md', contents: 'x' }]);

    await expect(materializeAgentSkillsPlugin([escaping])).rejects.toThrow("skill file '../../escape.md' does not name a file inside skill 'alpha/sdtm-mapping'");
  });
});
