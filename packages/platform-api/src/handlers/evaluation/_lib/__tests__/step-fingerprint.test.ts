import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { canonicalJson, type WorkflowDefinition, type WorkflowStep } from '@mediforce/platform-core';
import { InMemorySkillRepository } from '@mediforce/platform-core/testing';
import { loadEvaluatedStep } from '../evaluated-step';
import { changedFingerprintComponents, computeStepFingerprint } from '../step-fingerprint';
import { evaluationFixture, NAMESPACE, STEP } from '../../__tests__/fixture';

describe('computeStepFingerprint', () => {
  async function loaded() {
    const fixture = await evaluationFixture();
    const scope = fixture.scope();
    const { definition, step } = await loadEvaluatedStep(scope, STEP, 'read');
    const fingerprint = (patch: { definition?: Partial<WorkflowDefinition>; step?: Partial<WorkflowStep> }) => {
      const patchedStep = { ...step, ...patch.step };
      return computeStepFingerprint(scope, { ...definition, ...patch.definition, steps: [patchedStep] }, patchedStep);
    };
    return { fixture, scope, definition, step, fingerprint };
  }

  it('is stable, and ignores the step\'s name, routing and review', async () => {
    const { fingerprint, step } = await loaded();
    const base = await fingerprint({});

    expect(await fingerprint({})).toEqual(base);
    expect(await fingerprint({
      step: { name: 'Renamed', autonomyLevel: 'L4', review: { type: 'human' } },
    })).toEqual(base);
    // The agent's model, named on the step, is the model it inherited.
    expect(await fingerprint({ step: { agent: { ...step.agent, model: 'anthropic/claude-sonnet-4' } } })).toEqual(base);
  });

  it('names the component that changed', async () => {
    const { fixture, fingerprint, step } = await loaded();
    const base = await fingerprint({});

    expect(changedFingerprintComponents(base, await fingerprint({ step: { agent: { ...step.agent, model: 'openai/gpt-5' } } }))).toEqual(['model']);
    expect(changedFingerprintComponents(base, await fingerprint({ step: { agent: { ...step.agent, prompt: 'Grade every AE.' } } }))).toEqual(['step']);
    expect(changedFingerprintComponents(base, await fingerprint({ definition: { preamble: 'Study CDISCPILOT01.' } }))).toEqual(['preamble']);
    expect(changedFingerprintComponents(base, await fingerprint({ step: { mcpRestrictions: { email: { disable: true } } } })))
      .toEqual(['step', 'mcpServers']);

    const agent = (await fixture.agentDefinitionRepo.getById('ae-grader'))!;
    await fixture.agentDefinitionRepo.upsert('ae-grader', { ...agent, systemPrompt: 'You grade adverse events by CTCAE v5.' });
    expect(changedFingerprintComponents(base, await fingerprint({}))).toEqual(['systemPrompt']);
  });

  it('does not hash why MCP resolution failed, only that it did', async () => {
    const { scope, fingerprint } = await loaded();
    const getById = vi.spyOn(scope.toolCatalog, 'getById');
    getById.mockRejectedValueOnce(new Error('connection reset'));
    const first = await fingerprint({});
    getById.mockRejectedValueOnce(new Error('statement timeout'));
    expect(await fingerprint({})).toEqual(first);
  });

  it('resolves a public agent from another workspace the way the runtime does', async () => {
    const { fixture, scope, definition, step } = await loaded();
    const agent = (await fixture.agentDefinitionRepo.getById('ae-grader'))!;
    await fixture.agentDefinitionRepo.upsert('ae-grader', { ...agent, namespace: 'owner-ws', visibility: 'public' });
    await fixture.toolCatalogRepo.upsert('owner-ws', { id: 'edc', type: 'stdio', command: 'owner-edc-mcp' });
    await fixture.toolCatalogRepo.upsert('owner-ws', { id: 'email', type: 'http', url: 'https://owner.example.com/email' });

    const runtime = await computeStepFingerprint(
      { agentDefinitions: fixture.agentDefinitionRepo, toolCatalog: fixture.toolCatalogRepo, skills: scope.skills },
      definition,
      step,
    );
    expect((await computeStepFingerprint(scope, definition, step)).components.mcpServers).toBe(runtime.components.mcpServers);
  });

  it('opens another workspace\'s catalog only for entries the public agent binds', async () => {
    const { fixture, scope } = await loaded();
    await fixture.toolCatalogRepo.upsert('owner-ws', { id: 'email', type: 'http', url: 'https://owner.example.com/email' });
    await fixture.toolCatalogRepo.upsert('owner-ws', { id: 'billing', type: 'http', url: 'https://owner.example.com/billing' });
    const agent = { ...(await fixture.agentDefinitionRepo.getById('ae-grader'))!, namespace: 'owner-ws' };

    expect(await scope.toolCatalog.getById('owner-ws', 'email', { ...agent, visibility: 'public' })).not.toBeNull();
    expect(await scope.toolCatalog.getById('owner-ws', 'billing', { ...agent, visibility: 'public' })).toBeNull();
    expect(await scope.toolCatalog.getById('owner-ws', 'email', { ...agent, visibility: 'private' })).toBeNull();
    expect(await scope.toolCatalog.getById('owner-ws', 'email')).toBeNull();
  });

  it('folds the agent\'s skills into the skill component, and keeps it as it was for an agent with none', async () => {
    const fixture = await evaluationFixture();
    const skillRepo = new InMemorySkillRepository();
    const scope = fixture.scope(undefined, { skillRepo });
    const { definition, step } = await loadEvaluatedStep(scope, STEP, 'read');
    const fingerprint = () => computeStepFingerprint(scope, definition, step);
    const skill = (contentHash: string) => ({
      namespace: NAMESPACE,
      id: 'ctcae-grading',
      name: 'ctcae-grading',
      description: 'Grade AEs by CTCAE v5',
      visibility: 'private' as const,
      contentHash,
      files: [{ path: 'SKILL.md', contents: '---\nname: ctcae-grading\ndescription: Grade AEs by CTCAE v5\n---\n' }],
    });

    // No skills: the component hashes null, as it always has.
    const withoutSkills = await fingerprint();
    expect(withoutSkills.components.skill).toBe(createHash('sha256').update(canonicalJson(null)).digest('hex'));

    await skillRepo.create(skill('hash-v1'));
    const agent = (await fixture.agentDefinitionRepo.getById('ae-grader'))!;
    await fixture.agentDefinitionRepo.upsert('ae-grader', { ...agent, skills: [{ namespace: NAMESPACE, id: 'ctcae-grading' }] });
    const held = await fingerprint();
    expect(changedFingerprintComponents(withoutSkills, held)).toEqual(['skill']);
    // The shape it had while a step could also name a file skill, so retiring those moved no Fingerprint.
    expect(held.components.skill).toBe(createHash('sha256').update(canonicalJson({
      step: null,
      agentSkills: [{ namespace: NAMESPACE, id: 'ctcae-grading', contentHash: 'hash-v1' }],
    })).digest('hex'));

    await skillRepo.update(skill('hash-v2'));
    const edited = await fingerprint();
    expect(changedFingerprintComponents(held, edited)).toEqual(['skill']);

    await skillRepo.delete(NAMESPACE, 'ctcae-grading');
    const broken = await fingerprint();
    expect(changedFingerprintComponents(edited, broken)).toEqual(['skill']);
    expect(broken.components.skill).not.toBe(withoutSkills.components.skill);
  });

  it('folds the skills the step adds into the skill component', async () => {
    const fixture = await evaluationFixture();
    const skillRepo = new InMemorySkillRepository();
    const scope = fixture.scope(undefined, { skillRepo });
    const { definition, step } = await loadEvaluatedStep(scope, STEP, 'read');
    const addingStep = { ...step, agent: { ...step.agent, skills: [{ namespace: NAMESPACE, id: 'recist-reading' }] } };
    const fingerprint = () => computeStepFingerprint(scope, { ...definition, steps: [addingStep] }, addingStep);
    const skill = (contentHash: string) => ({
      namespace: NAMESPACE,
      id: 'recist-reading',
      name: 'recist-reading',
      description: 'Read tumour response by RECIST 1.1',
      visibility: 'private' as const,
      contentHash,
      files: [{ path: 'SKILL.md', contents: '---\nname: recist-reading\ndescription: Read tumour response by RECIST 1.1\n---\n' }],
    });

    await skillRepo.create(skill('hash-v1'));
    const added = await fingerprint();

    await skillRepo.update(skill('hash-v2'));
    const edited = await fingerprint();
    expect(changedFingerprintComponents(added, edited)).toEqual(['skill']);
  });

  it('covers the skills a step adds without naming an agent', async () => {
    const fixture = await evaluationFixture();
    const skillRepo = new InMemorySkillRepository();
    const scope = fixture.scope(undefined, { skillRepo });
    const { definition, step } = await loadEvaluatedStep(scope, STEP, 'read');
    const { agentId: _agentId, ...agentless } = step;
    const withSkills = (skills: { namespace: string; id: string }[]) => ({ ...agentless, agent: { ...step.agent, skills } });
    const fingerprint = (bare: WorkflowStep) => computeStepFingerprint(scope, { ...definition, steps: [bare] }, bare);
    const skill = (contentHash: string) => ({
      namespace: NAMESPACE,
      id: 'meddra-coding',
      name: 'meddra-coding',
      description: 'Code verbatim AE terms to MedDRA PTs',
      visibility: 'private' as const,
      contentHash,
      files: [{ path: 'SKILL.md', contents: '---\nname: meddra-coding\ndescription: Code verbatim AE terms to MedDRA PTs\n---\n' }],
    });

    const none = await fingerprint(withSkills([]));
    expect(none.components.skill).toBe(createHash('sha256').update(canonicalJson(null)).digest('hex'));

    await skillRepo.create(skill('hash-v1'));
    const added = await fingerprint(withSkills([{ namespace: NAMESPACE, id: 'meddra-coding' }]));
    expect(added.components.skill).not.toBe(none.components.skill);

    await skillRepo.update(skill('hash-v2'));
    const edited = await fingerprint(withSkills([{ namespace: NAMESPACE, id: 'meddra-coding' }]));
    expect(changedFingerprintComponents(added, edited)).toEqual(['skill']);
  });
});
