import type { AgentDefinition } from '@mediforce/platform-core';
import type { CallerScope } from '../../repositories/index';
import { ValidationError } from '../../errors';

type SkillHolder = Pick<AgentDefinition, 'namespace' | 'visibility' | 'skills'>;

/**
 * Refuse an Agent whose Skills it may not hold (ADR-0025 decision 3). Each
 * reference must name a Skill the caller can read, a private Skill only from
 * the Agent's own workspace, and a public Agent only public Skills. Every
 * offending reference is reported, each as an issue on its `skills` index.
 */
export async function assertAgentMayHoldSkills(agent: SkillHolder, scope: CallerScope): Promise<void> {
  const refs = agent.skills ?? [];
  const skills = await Promise.all(refs.map((ref) => scope.skills.getById(ref.namespace, ref.id)));
  const issues: { code: 'custom'; path: (string | number)[]; message: string }[] = [];
  refs.forEach((ref, index) => {
    const label = `'${ref.namespace}/${ref.id}'`;
    const skill = skills[index] ?? null;
    let message: string | null = null;
    if (skill === null) {
      message = `skill ${label} does not exist`;
    } else if (skill.visibility === 'private' && agent.visibility === 'public') {
      message = `skill ${label} is private, and a public agent may hold only public skills`;
    } else if (skill.visibility === 'private' && skill.namespace !== agent.namespace) {
      message = `skill ${label} is private to workspace '${skill.namespace}'`;
    }
    if (message !== null) issues.push({ code: 'custom', path: ['skills', index], message });
  });
  if (issues.length > 0) {
    throw new ValidationError(`Invalid skills: ${issues.map((issue) => issue.message).join('; ')}`, issues);
  }
}
