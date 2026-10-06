import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readSkillFolder, skillCreateCommand } from '../commands/skill';
import { captureOutput, jsonResponse } from './test-helpers';

const skillMd = '---\nname: sdtm-mapping\ndescription: Map raw data to SDTM\n---\n# SDTM\n';

function skillFolder(): string {
  const dir = mkdtempSync(join(tmpdir(), 'skill-'));
  writeFileSync(join(dir, 'SKILL.md'), skillMd);
  mkdirSync(join(dir, 'references'));
  writeFileSync(join(dir, 'references', 'domains.md'), '# DM, AE — Grade ≥ 3\n');
  writeFileSync(join(dir, '.DS_Store'), Buffer.from([0x00, 0xff]));
  return dir;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('readSkillFolder', () => {
  it('reads every text file as a forward-slash path, skipping hidden entries', () => {
    expect(readSkillFolder(skillFolder())).toEqual([
      { path: 'SKILL.md', contents: skillMd },
      { path: 'references/domains.md', contents: '# DM, AE — Grade ≥ 3\n' },
    ]);
  });

  it('refuses a file that is not UTF-8, naming it', () => {
    const dir = skillFolder();
    writeFileSync(join(dir, 'references', 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe]));
    expect(() => readSkillFolder(dir)).toThrow('references/logo.png is not UTF-8 text');
  });

  it('refuses a symlink, naming it, rather than following it out of the folder', () => {
    const dir = skillFolder();
    symlinkSync(tmpdir(), join(dir, 'references', 'outside'));
    expect(() => readSkillFolder(dir)).toThrow('references/outside is a symlink');
  });
});

describe('skill create', () => {
  it('uploads the folder as files[] and reports the created skill', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        skill: {
          namespace: 'alpha',
          id: 'sdtm-mapping',
          name: 'sdtm-mapping',
          description: 'Map raw data to SDTM',
          visibility: 'private',
          contentHash: 'abc',
          files: [{ path: 'SKILL.md', contents: skillMd }],
          createdAt: '2026-10-05T00:00:00.000Z',
          updatedAt: '2026-10-05T00:00:00.000Z',
        },
      }, 201),
    );
    const output = captureOutput();
    const code = await skillCreateCommand({
      argv: ['--from', skillFolder(), '--namespace', 'alpha', '--base-url', 'http://test:9000'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });

    expect(code).toBe(0);
    expect(output.stdoutLines.join('\n')).toContain("Created skill 'sdtm-mapping' in 'alpha'");
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(String(url)).toBe('http://test:9000/api/skills?namespace=alpha');
    expect(JSON.parse(String(init?.body))).toEqual({
      files: [
        { path: 'SKILL.md', contents: skillMd },
        { path: 'references/domains.md', contents: '# DM, AE — Grade ≥ 3\n' },
      ],
    });
  });

  it('fails before calling the API when the folder holds a binary file', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const dir = skillFolder();
    writeFileSync(join(dir, 'data.bin'), Buffer.from([0xc3, 0x28]));
    const output = captureOutput();
    const code = await skillCreateCommand({
      argv: ['--from', dir, '--namespace', 'alpha', '--base-url', 'http://test:9000'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });

    expect(code).toBe(1);
    expect(output.stderrLines.join('\n')).toContain('data.bin is not UTF-8 text');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
