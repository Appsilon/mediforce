import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { WorkflowStep } from '@mediforce/platform-core';
import {
  InMemoryAgentDefinitionRepository,
  InMemoryAuditRepository,
  InMemoryProcessInstanceRepository,
  InMemoryProcessRepository,
  InMemorySkillRepository,
  InMemoryTriggerRepository,
  buildWorkflowDefinition,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import type { ReferenceIssue } from '../../../contract/skills';
import { ValidationError } from '../../../errors';
import { createTestScope, userCaller } from '../../../repositories/__tests__/create-test-scope';
import { createAgent } from '../../agents/create-agent';
import { createSkill } from '../../skills/create-skill';
import { agentInput, skillMd } from '../../skills/__tests__/fixtures';
import { copyWorkflow } from '../copy-workflow';
import { registerWorkflow } from '../register-workflow';
import { setWorkflowVisibility } from '../set-visibility';
import { transferWorkflowNamespace } from '../transfer-workflow';

vi.mock('../../system/_docker', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../system/_docker')>();
  return {
    ...actual,
    isLocalAgentMode: vi.fn().mockReturnValue(false),
    fetchFromContainerWorker: vi.fn().mockResolvedValue({ available: false }),
  };
});

const skillFiles = (name: string) => [{ path: 'SKILL.md', contents: skillMd(name) }];

describe('step skills on workflow writes (ADR-0027 decision 4)', () => {
  let processRepo: InMemoryProcessRepository;
  let skillRepo: InMemorySkillRepository;
  let agentRepo: InMemoryAgentDefinitionRepository;
  let auditRepo: InMemoryAuditRepository;
  let triggerRepo: InMemoryTriggerRepository;

  const scopeFor = (namespaces: string[]) => createTestScope({
    processRepo, skillRepo, agentDefinitionRepo: agentRepo, auditRepo, triggerRepo, caller: userCaller('u-member', namespaces),
  });

  beforeEach(async () => {
    resetFactorySequence();
    processRepo = new InMemoryProcessRepository();
    skillRepo = new InMemorySkillRepository();
    agentRepo = new InMemoryAgentDefinitionRepository();
    auditRepo = new InMemoryAuditRepository(new InMemoryProcessInstanceRepository());
    triggerRepo = new InMemoryTriggerRepository();
    await createSkill({ namespace: 'alpha', files: skillFiles('own-private') }, scopeFor(['alpha']));
    await createSkill({ namespace: 'beta', files: skillFiles('beta-private') }, scopeFor(['beta']));
    await createSkill({ namespace: 'beta', files: skillFiles('beta-public'), visibility: 'public' }, scopeFor(['beta']));
  });

  function workflowInput(name: string, skills: { namespace: string; id: string }[], visibility: 'public' | 'private' = 'private') {
    const body = buildWorkflowDefinition({ name, namespace: 'alpha', visibility });
    const agentStep = body.steps[1] as WorkflowStep;
    agentStep.agent = { image: 'test-image', prompt: 'Map the domains.', skills };
    const { version: _version, createdAt: _createdAt, namespace: _namespace, ...input } = body;
    return { ...input, namespace: 'alpha', agentStepId: agentStep.id };
  }

  async function rejection(promise: Promise<unknown>): Promise<ValidationError> {
    const error = await promise.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ValidationError);
    return error as ValidationError;
  }

  it('lets a private workflow add its own workspace\'s skills and public ones', async () => {
    const { agentStepId: _stepId, ...input } = workflowInput('mapping', [
      { namespace: 'alpha', id: 'own-private' },
      { namespace: 'beta', id: 'beta-public' },
    ]);
    await expect(registerWorkflow(input, scopeFor(['alpha']))).resolves.toMatchObject({ version: 1 });
  });

  it('names the step and every reference it may not add', async () => {
    const { agentStepId, ...input } = workflowInput('mapping', [
      { namespace: 'alpha', id: 'missing' },
      { namespace: 'beta', id: 'beta-public' },
      { namespace: 'beta', id: 'beta-private' },
    ]);
    const error = await rejection(registerWorkflow(input, scopeFor(['alpha', 'beta'])));

    expect(error.message).toContain(`step '${agentStepId}': skill 'alpha/missing' does not exist`);
    expect(error.message).toContain(`step '${agentStepId}': skill 'beta/beta-private' is private to workspace 'beta'`);
    expect(error.message).not.toContain('beta-public');
    expect((error.details as { path: unknown[] }[]).map((issue) => issue.path))
      .toEqual([['steps', 1, 'agent', 'skills', 0], ['steps', 1, 'agent', 'skills', 2]]);
    expect(await processRepo.getWorkflowDefinition('alpha', 'mapping', 1)).toBeNull();
  });

  it('lets a public workflow add only public skills', async () => {
    const { agentStepId: _stepId, ...input } = workflowInput('mapping', [{ namespace: 'alpha', id: 'own-private' }], 'public');
    const error = await rejection(registerWorkflow(input, scopeFor(['alpha'])));
    expect(error.message).toContain("'alpha/own-private' is private, and a public workflow may add only public skills");
  });

  it('refuses making a workflow public while a step adds a private skill', async () => {
    const { agentStepId: _stepId, ...input } = workflowInput('mapping', [{ namespace: 'alpha', id: 'own-private' }]);
    await registerWorkflow(input, scopeFor(['alpha']));

    await rejection(setWorkflowVisibility({ namespace: 'alpha', name: 'mapping', visibility: 'public' }, scopeFor(['alpha'])));
    expect((await processRepo.getWorkflowDefinition('alpha', 'mapping', 1))?.visibility).toBe('private');
  });

  it('refuses copying or transferring a workflow to where its private skills are out of reach', async () => {
    const { agentStepId: _stepId, ...input } = workflowInput('mapping', [{ namespace: 'alpha', id: 'own-private' }]);
    await registerWorkflow(input, scopeFor(['alpha']));
    const both = scopeFor(['alpha', 'beta']);

    await rejection(copyWorkflow({ name: 'mapping', sourceNamespace: 'alpha', targetNamespace: 'beta' }, both));
    await rejection(transferWorkflowNamespace({ name: 'mapping', sourceNamespace: 'alpha', targetNamespace: 'beta' }, both));
    expect(await processRepo.getLatestWorkflowVersion('beta', 'mapping')).toBe(0);

    await expect(copyWorkflow({ name: 'mapping', sourceNamespace: 'alpha', targetNamespace: 'alpha', targetName: 'mapping-2' }, both))
      .resolves.toMatchObject({ name: 'mapping-2' });
  });

  it('names both the private skill and the private agent a copy or transfer cannot reach, with namespace and step', async () => {
    const { agent } = await createAgent(agentInput({ namespace: 'alpha', name: 'Mastery planner' }), scopeFor(['alpha']));
    const { agentStepId, ...input } = workflowInput('mastery', [{ namespace: 'alpha', id: 'own-private' }]);
    const agentStep = input.steps.find((step) => step.id === agentStepId) as WorkflowStep;
    agentStep.agentId = agent.id;
    await registerWorkflow(input, scopeFor(['alpha']));
    const both = scopeFor(['alpha', 'beta']);

    for (const result of [
      await copyWorkflow({ name: 'mastery', sourceNamespace: 'alpha', targetNamespace: 'beta' }, both).catch((e) => e),
      await transferWorkflowNamespace({ name: 'mastery', sourceNamespace: 'alpha', targetNamespace: 'beta' }, both).catch((e) => e),
    ]) {
      expect(result).toBeInstanceOf(ValidationError);
      const issues = (result as ValidationError).details as ReferenceIssue[];
      expect(issues).toEqual(expect.arrayContaining([
        expect.objectContaining({
          kind: 'skill', reason: 'private', id: 'own-private', namespace: 'alpha', name: 'own-private', stepId: agentStepId,
        }),
        expect.objectContaining({
          kind: 'agent', reason: 'private', id: agent.id, namespace: 'alpha', name: 'Mastery planner', stepId: agentStepId,
        }),
      ]));
    }
  });
});
