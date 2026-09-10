import { describe, it, expect } from 'vitest';
import { carriedSkills } from '../carried-skills';

describe('carriedSkills', () => {
  it('finds a skill from the SKILL.md the workflow carries', () => {
    expect(carriedSkills([
      { path: 'skills/data-validator/SKILL.md', contents: '# Data validator\n' },
    ])).toEqual([{ skillsDir: 'skills', skill: 'data-validator' }]);
  });

  it('finds every skill in a directory, and every directory', () => {
    expect(carriedSkills([
      { path: 'skills/validator/SKILL.md', contents: '' },
      { path: 'skills/reporter/SKILL.md', contents: '' },
      { path: 'plugins/landing-zone/skills/router/SKILL.md', contents: '' },
    ])).toEqual([
      { skillsDir: 'plugins/landing-zone/skills', skill: 'router' },
      { skillsDir: 'skills', skill: 'reporter' },
      { skillsDir: 'skills', skill: 'validator' },
    ]);
  });

  it('ignores the other files a skill directory holds', () => {
    // A skill is a directory with a SKILL.md; its references and scripts are
    // part of it, not skills of their own.
    expect(carriedSkills([
      { path: 'skills/validator/SKILL.md', contents: '' },
      { path: 'skills/validator/references/rules.md', contents: '' },
      { path: 'skills/validator/check.py', contents: '' },
    ])).toEqual([{ skillsDir: 'skills', skill: 'validator' }]);
  });

  it('finds nothing when no file is a SKILL.md', () => {
    expect(carriedSkills([
      { path: 'Dockerfile', contents: '' },
      { path: 'skills/validator/readme.md', contents: '' },
      { path: 'SKILL.md', contents: '' },
    ])).toEqual([]);
  });

  it('is case-sensitive, the way the runtime reads it', () => {
    // `readSkillFile` joins `<skillsDir>/<skill>/SKILL.md` literally, so a
    // `skill.md` would be offered here and then not found at run time.
    expect(carriedSkills([{ path: 'skills/validator/skill.md', contents: '' }])).toEqual([]);
  });

  it('has nothing to offer when the workflow carries no files', () => {
    expect(carriedSkills(undefined)).toEqual([]);
    expect(carriedSkills([])).toEqual([]);
  });
});
