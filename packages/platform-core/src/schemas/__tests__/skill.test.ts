import { describe, it, expect } from 'vitest';
import { SkillFilesSchema, parseSkillFrontmatter, skillManifest } from '../skill';
import { WORKFLOW_ARTIFACTS_MAX_TOTAL_BYTES } from '../workflow-definition';

const manifest = (frontmatter: string, body = '# Body\n') => `---\n${frontmatter}\n---\n${body}`;
const skillMd = manifest('name: sdtm-mapping\ndescription: Map raw clinical data to SDTM domains');

function firstIssue(files: unknown): string {
  const parsed = SkillFilesSchema.safeParse(files);
  if (parsed.success === true) throw new Error('expected the files to be rejected');
  return parsed.error.issues[0]?.message ?? '';
}

describe('parseSkillFrontmatter', () => {
  it('reads name and description', () => {
    expect(parseSkillFrontmatter(skillMd)).toEqual({
      success: true,
      data: { name: 'sdtm-mapping', description: 'Map raw clinical data to SDTM domains' },
    });
  });

  it('accepts CRLF line endings and extra frontmatter keys', () => {
    const markdown = '---\r\nname: ae-grading\r\ndescription: Grade AEs by CTCAE\r\nlicense: MIT\r\n---\r\nBody';
    expect(parseSkillFrontmatter(markdown)).toMatchObject({ success: true, data: { name: 'ae-grading' } });
  });

  it('refuses a file without frontmatter', () => {
    expect(parseSkillFrontmatter('# Just a heading')).toMatchObject({
      success: false,
      message: expect.stringContaining('must open with YAML frontmatter'),
    });
  });

  it('refuses frontmatter that is not YAML', () => {
    expect(parseSkillFrontmatter(manifest('name: [unclosed'))).toMatchObject({
      success: false,
      message: expect.stringContaining('not valid YAML'),
    });
  });

  it('refuses a missing name', () => {
    expect(parseSkillFrontmatter(manifest('description: Something'))).toMatchObject({
      success: false,
      message: expect.stringContaining("'name'"),
    });
  });

  for (const name of ['SDTM-Mapping', 'sdtm_mapping', 'sdtm--mapping', '-sdtm', 'sdtm mapping', 'a'.repeat(65)]) {
    it(`refuses the name '${name.slice(0, 20)}', which is not a kebab-case skill name`, () => {
      expect(parseSkillFrontmatter(manifest(`name: ${name}\ndescription: Something`))).toMatchObject({
        success: false,
        message: expect.stringContaining("'name'"),
      });
    });
  }

  it('refuses a missing or blank description', () => {
    expect(parseSkillFrontmatter(manifest('name: sdtm-mapping'))).toMatchObject({ success: false });
    expect(parseSkillFrontmatter(manifest('name: sdtm-mapping\ndescription: "  "'))).toMatchObject({
      success: false,
      message: expect.stringContaining("'description'"),
    });
  });
});

describe('SkillFilesSchema', () => {
  it('accepts a SKILL.md with references beside it', () => {
    const files = [
      { path: 'SKILL.md', contents: skillMd },
      { path: 'references/domains.md', contents: '# DM, AE, LB\n' },
      { path: 'scripts/check.py', contents: 'print("ok")\n' },
    ];
    expect(SkillFilesSchema.parse(files)).toEqual(files);
    expect(skillManifest(files)).toEqual({ name: 'sdtm-mapping', description: 'Map raw clinical data to SDTM domains' });
  });

  it('refuses a set without SKILL.md at its root', () => {
    expect(firstIssue([{ path: 'docs/SKILL.md', contents: skillMd }])).toContain('needs a SKILL.md at its root');
  });

  it('refuses a SKILL.md whose frontmatter is invalid', () => {
    expect(firstIssue([{ path: 'SKILL.md', contents: manifest('name: Bad_Name\ndescription: x') }])).toContain("'name'");
  });

  for (const path of ['/abs.md', '../escape.md', 'a//b.md', 'a\\b.md', './x.md']) {
    it(`refuses the path '${path}'`, () => {
      expect(SkillFilesSchema.safeParse([{ path: 'SKILL.md', contents: skillMd }, { path, contents: '' }]).success).toBe(false);
    });
  }

  it('refuses a path used twice', () => {
    const files = [{ path: 'SKILL.md', contents: skillMd }, { path: 'SKILL.md', contents: skillMd }];
    expect(firstIssue(files)).toContain('is already used by files[0]');
  });

  it('refuses a path used as both a file and a directory', () => {
    const files = [
      { path: 'SKILL.md', contents: skillMd },
      { path: 'references', contents: '' },
      { path: 'references/x.md', contents: '' },
    ];
    expect(firstIssue(files)).toContain("needs 'references' to be a directory");
  });

  it('refuses a skill over the byte cap, counted in UTF-8 bytes', () => {
    // Four-byte characters: under the cap by character count, over it in bytes.
    const chunk = '😀'.repeat(15 * 1024);
    const files = [
      { path: 'SKILL.md', contents: skillMd },
      ...Array.from({ length: 5 }, (_, index) => ({ path: `references/${String(index)}.md`, contents: chunk })),
    ];
    const characters = files.reduce((sum, file) => sum + file.contents.length, 0);
    expect(characters).toBeLessThan(WORKFLOW_ARTIFACTS_MAX_TOTAL_BYTES);
    expect(firstIssue(files)).toContain(`over the ${String(WORKFLOW_ARTIFACTS_MAX_TOTAL_BYTES)} byte limit`);
  });
});
