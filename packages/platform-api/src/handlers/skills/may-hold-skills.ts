import {
  mayHoldSkill,
  type SkillHolder,
  type AgentDefinition,
  type AgentSkillRef,
  type WorkflowDefinition,
} from '@mediforce/platform-core';
import type { CallerScope } from '../../repositories/index';
import { ValidationError } from '../../errors';

type Issue = { code: 'custom'; path: (string | number)[]; message: string };

/** One issue per reference that names a Skill the caller cannot read, or one
 *  the holder may not reach (ADR-0025 decision 3, ADR-0027 decision 4). */
async function skillIssues(
  holder: SkillHolder,
  holderKind: 'agent' | 'workflow',
  refs: AgentSkillRef[],
  path: (string | number)[],
  scope: CallerScope,
): Promise<Issue[]> {
  const skills = await Promise.all(refs.map((ref) => scope.skills.getById(ref.namespace, ref.id)));
  const issues: Issue[] = [];
  refs.forEach((ref, index) => {
    const label = `'${ref.namespace}/${ref.id}'`;
    const skill = skills[index] ?? null;
    let message: string | null = null;
    if (skill === null) {
      message = `skill ${label} does not exist`;
    } else if (mayHoldSkill(holder, skill) === false) {
      message = holder.visibility === 'public'
        ? `skill ${label} is private, and a public ${holderKind} may ${holderKind === 'agent' ? 'hold' : 'add'} only public skills`
        : `skill ${label} is private to workspace '${skill.namespace}'`;
    }
    if (message !== null) issues.push({ code: 'custom', path: [...path, index], message });
  });
  return issues;
}

function refuse(issues: Issue[]): void {
  if (issues.length > 0) {
    throw new ValidationError(`Invalid skills: ${issues.map((issue) => issue.message).join('; ')}`, issues);
  }
}

/** Refuse an Agent whose Skills it may not hold. Every offending reference is
 *  reported, each as an issue on its `skills` index. */
export async function assertAgentMayHoldSkills(
  agent: Pick<AgentDefinition, 'namespace' | 'visibility' | 'skills'>,
  scope: CallerScope,
): Promise<void> {
  refuse(await skillIssues(agent, 'agent', agent.skills ?? [], ['skills'], scope));
}

/** Refuse a Workflow whose Steps add Skills it may not reach: a private
 *  Workflow its own Namespace's and public ones, a public Workflow public ones
 *  only. Each issue sits on `steps[i].agent.skills[j]` and names the Step. */
export async function assertStepsMayAddSkills(
  workflow: Pick<WorkflowDefinition, 'namespace' | 'visibility' | 'steps'>,
  scope: CallerScope,
): Promise<void> {
  const perStep = await Promise.all(workflow.steps.map(async (step, stepIndex) => {
    const issues = await skillIssues(workflow, 'workflow', step.agent?.skills ?? [], ['steps', stepIndex, 'agent', 'skills'], scope);
    return issues.map((issue) => ({ ...issue, message: `step '${step.id}': ${issue.message}` }));
  }));
  refuse(perStep.flat());
}
