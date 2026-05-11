export interface AvailableSkill {
  name: string;
  description: string;
}

/**
 * Render the OpenCode `## Available Skills` prompt block. OpenCode does not
 * read SKILL.md frontmatter natively (no `--plugin-dir` equivalent), so we
 * surface each skill's name + description inline and point the agent at
 * `/plugin/skills/<name>/` where the files are mounted.
 *
 * Returns the empty string when there are no skills, which keeps callers
 * branch-free — they can `parts.push(buildAvailableSkillsBlock(skills))` and
 * filter empties at join time.
 */
export function buildAvailableSkillsBlock(skills: readonly AvailableSkill[]): string {
  if (skills.length === 0) return '';
  const lines: string[] = [];
  lines.push('## Available Skills');
  lines.push('');
  lines.push(
    'These skills are available at /plugin/skills/<name>/. Each has a SKILL.md ' +
      'describing when to use it. Read SKILL.md before using a skill.',
  );
  lines.push('');
  for (const skill of skills) {
    lines.push(`- ${skill.name}: ${skill.description}`);
  }
  return lines.join('\n');
}
