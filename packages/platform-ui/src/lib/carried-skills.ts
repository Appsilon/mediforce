import type { WorkflowArtifact } from '@mediforce/platform-core';

export interface CarriedSkill {
  /** What `agent.skillsDir` has to be for the runtime to find it. */
  skillsDir: string;
  /** What `agent.skill` has to be. */
  skill: string;
}

/**
 * The skills a workflow carries in its own files, read the way the runtime
 * reads them: a skill is a directory holding a `SKILL.md`, and its parent is
 * the `skillsDir` a step points at.
 *
 * Case-sensitive on purpose — `readSkillFile` joins `<skillsDir>/<skill>/SKILL.md`
 * literally, so offering a `skill.md` here would produce a step that fails at
 * run time looking for a file that is not there.
 */
export function carriedSkills(artifacts: WorkflowArtifact[] | undefined): CarriedSkill[] {
  if (artifacts === undefined) return [];
  const found: CarriedSkill[] = [];
  for (const artifact of artifacts) {
    const segments = artifact.path.split('/');
    if (segments.length < 3 || segments[segments.length - 1] !== 'SKILL.md') continue;
    found.push({
      skillsDir: segments.slice(0, -2).join('/'),
      skill: segments[segments.length - 2],
    });
  }
  return found.sort((a, b) =>
    a.skillsDir === b.skillsDir ? a.skill.localeCompare(b.skill) : a.skillsDir.localeCompare(b.skillsDir),
  );
}
