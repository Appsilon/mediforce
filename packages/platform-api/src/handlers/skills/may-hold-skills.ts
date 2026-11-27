import {
  mayHoldSkill,
  type SkillHolder,
  type AgentDefinition,
  type AgentSkillRef,
  type WorkflowDefinition,
} from '@mediforce/platform-core';
import type { CallerScope } from '../../repositories/index';
import { ValidationError } from '../../errors';
import { type ReferenceIssue as Issue } from '../../contract/skills';

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
    if (skill === null) {
      issues.push({
        code: 'custom', path: [...path, index], kind: 'skill', reason: 'missing',
        id: ref.id, namespace: ref.namespace,
        message: `skill ${label} does not exist`,
      });
      return;
    }
    if (mayHoldSkill(holder, skill) === false) {
      const message = holder.visibility === 'public'
        ? `skill ${label} is private, and a public ${holderKind} may ${holderKind === 'agent' ? 'hold' : 'add'} only public skills`
        : `skill ${label} is private to workspace '${skill.namespace}'`;
      issues.push({
        code: 'custom', path: [...path, index], kind: 'skill', reason: 'private',
        id: ref.id, namespace: ref.namespace, name: skill.name,
        message,
      });
    }
  });
  return issues;
}

function refuse(issues: Issue[]): void {
  if (issues.length > 0) {
    throw new ValidationError(`Invalid references: ${issues.map((issue) => issue.message).join('; ')}`, issues);
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

/** One issue per Step adding a Skill it may not reach, named and attributed to
 *  that Step: a private Workflow its own Namespace's and public ones, a public
 *  Workflow public ones only. */
async function collectStepSkillIssues(
  workflow: Pick<WorkflowDefinition, 'namespace' | 'visibility' | 'steps'>,
  scope: CallerScope,
): Promise<Issue[]> {
  const perStep = await Promise.all(workflow.steps.map(async (step, stepIndex) => {
    const issues = await skillIssues(workflow, 'workflow', step.agent?.skills ?? [], ['steps', stepIndex, 'agent', 'skills'], scope);
    return issues.map((issue) => ({
      ...issue,
      stepId: step.id,
      stepName: step.name,
      message: `step '${step.id}': ${issue.message}`,
    }));
  }));
  return perStep.flat();
}

/** Refuse a Workflow whose Steps add Skills it may not reach. Each issue sits
 *  on `steps[i].agent.skills[j]` and names the Step. */
export async function assertStepsMayAddSkills(
  workflow: Pick<WorkflowDefinition, 'namespace' | 'visibility' | 'steps'>,
  scope: CallerScope,
): Promise<void> {
  refuse(await collectStepSkillIssues(workflow, scope));
}

/** One issue per Step running an Agent it may not reach: same rule as Skills
 *  (ADR-0025 decision 3) — a private Agent only by its own Namespace, a
 *  public one by every Workflow. */
async function collectStepAgentIssues(
  workflow: Pick<WorkflowDefinition, 'namespace' | 'visibility' | 'steps'>,
  scope: CallerScope,
): Promise<Issue[]> {
  const perStep = await Promise.all(workflow.steps.map(async (step, stepIndex) => {
    if (step.executor !== 'agent' || step.agentId === undefined) return [];
    const agent = await scope.agentDefinitions.getById(step.agentId);
    if (agent === null) {
      return [{
        code: 'custom' as const,
        path: ['steps', stepIndex, 'agentId'],
        kind: 'agent' as const,
        reason: 'missing' as const,
        id: step.agentId,
        stepId: step.id,
        stepName: step.name,
        message: `step '${step.id}': agent '${step.agentId}' does not exist`,
      }];
    }
    const reachable = agent.visibility === 'public'
      || (workflow.visibility === 'private' && workflow.namespace === agent.namespace);
    if (reachable === false) {
      return [{
        code: 'custom' as const,
        path: ['steps', stepIndex, 'agentId'],
        kind: 'agent' as const,
        reason: 'private' as const,
        id: agent.id,
        namespace: agent.namespace,
        name: agent.name,
        stepId: step.id,
        stepName: step.name,
        message: `step '${step.id}': agent "${agent.name}" is private to workspace '${agent.namespace}'`,
      }];
    }
    return [];
  }));
  return perStep.flat();
}

/** Refuse a Copy/Transfer target that cannot reach a Step's Skills or Agent.
 *  Gathers both kinds in one failure, so the caller sees every blocking
 *  reference at once instead of hitting them one at a time across retries. */
export async function assertStepsMayUseReferences(
  workflow: Pick<WorkflowDefinition, 'namespace' | 'visibility' | 'steps'>,
  scope: CallerScope,
): Promise<void> {
  const [skills, agents] = await Promise.all([
    collectStepSkillIssues(workflow, scope),
    collectStepAgentIssues(workflow, scope),
  ]);
  refuse([...skills, ...agents]);
}
