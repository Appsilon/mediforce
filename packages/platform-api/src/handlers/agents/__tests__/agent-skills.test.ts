import { describe, it, expect, beforeEach } from 'vitest';
import { ForbiddenError, NotFoundError, ValidationError } from '../../../errors';
import { createAgent } from '../create-agent';
import { updateAgent } from '../update-agent';
import { createSkill } from '../../skills/create-skill';
import { agentInput, createSkillTestKit, skillMd } from '../../skills/__tests__/fixtures';
import { createTestScope, userCaller } from '../../../repositories/__tests__/create-test-scope';

const skillFiles = (name: string) => [{ path: 'SKILL.md', contents: skillMd(name) }];

describe('agent skills (ADR-0025 decision 3)', () => {
  let kit: ReturnType<typeof createSkillTestKit>;
  const betaMember = () =>
    createTestScope({ skillRepo: kit.repo, agentDefinitionRepo: kit.agentRepo, auditRepo: kit.auditRepo, caller: userCaller('u-beta', ['beta']) });
  const bothMember = () =>
    createTestScope({ skillRepo: kit.repo, agentDefinitionRepo: kit.agentRepo, auditRepo: kit.auditRepo, caller: userCaller('u-both', ['alpha', 'beta']) });

  beforeEach(async () => {
    kit = createSkillTestKit();
    await createSkill({ namespace: 'alpha', files: skillFiles('own-private') }, kit.member());
    await createSkill({ namespace: 'alpha', files: skillFiles('own-public'), visibility: 'public' }, kit.member());
    await createSkill({ namespace: 'beta', files: skillFiles('beta-private') }, betaMember());
    await createSkill({ namespace: 'beta', files: skillFiles('beta-public'), visibility: 'public' }, betaMember());
  });

  async function rejection(promise: Promise<unknown>): Promise<ValidationError> {
    const error = await promise.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ValidationError);
    return error as ValidationError;
  }

  it('lets a private agent hold its own workspace\'s skills and another workspace\'s public ones', async () => {
    const skills = [
      { namespace: 'alpha', id: 'own-private' },
      { namespace: 'beta', id: 'beta-public' },
    ];
    const { agent } = await createAgent(agentInput({ skills }), kit.member());
    expect(agent.skills).toEqual(skills);
  });

  it('names every reference that does not exist or is out of reach', async () => {
    const error = await rejection(createAgent(agentInput({
      skills: [
        { namespace: 'alpha', id: 'missing' },
        { namespace: 'alpha', id: 'own-public' },
        { namespace: 'beta', id: 'beta-private' },
      ],
    }), kit.member()));
    expect(error.message).toContain("'alpha/missing' does not exist");
    // A non-member cannot tell another workspace's private skill from a missing one.
    expect(error.message).toContain("'beta/beta-private' does not exist");
    expect(error.message).not.toContain('own-public');
    expect((error.details as { path: unknown[] }[]).map((issue) => issue.path)).toEqual([['skills', 0], ['skills', 2]]);
  });

  it('refuses another workspace\'s private skill even when the caller can read it', async () => {
    const error = await rejection(createAgent(agentInput({ skills: [{ namespace: 'beta', id: 'beta-private' }] }), bothMember()));
    expect(error.message).toContain("'beta/beta-private' is private to workspace 'beta'");
  });

  it('lets a public agent hold only public skills', async () => {
    const error = await rejection(createAgent(agentInput({
      visibility: 'public',
      skills: [{ namespace: 'alpha', id: 'own-private' }, { namespace: 'beta', id: 'beta-public' }],
    }), kit.member()));
    expect(error.message).toContain("'alpha/own-private' is private, and a public agent may hold only public skills");
    expect(error.message).not.toContain('beta-public');
  });

  it('refuses making an agent public while it holds a private skill', async () => {
    const { agent } = await createAgent(agentInput({ skills: [{ namespace: 'alpha', id: 'own-private' }] }), kit.member());
    await rejection(updateAgent({ id: agent.id, body: { visibility: 'public' } }, kit.member()));
    expect((await kit.agentRepo.getById(agent.id))?.visibility).toBe('private');
  });

  it('validates skills on update and leaves an edit that does not touch them alone', async () => {
    const { agent } = await createAgent(agentInput(), kit.member());
    await rejection(updateAgent({ id: agent.id, body: { skills: [{ namespace: 'alpha', id: 'missing' }] } }, kit.member()));

    const { agent: updated } = await updateAgent(
      { id: agent.id, body: { skills: [{ namespace: 'alpha', id: 'own-public' }] } },
      kit.member(),
    );
    expect(updated.skills).toEqual([{ namespace: 'alpha', id: 'own-public' }]);

    const { agent: renamed } = await updateAgent({ id: agent.id, body: { name: 'Renamed' } }, kit.member());
    expect(renamed.skills).toEqual([{ namespace: 'alpha', id: 'own-public' }]);
  });

  it('refuses a caller without write access before looking at the skills', async () => {
    await expect(createAgent(agentInput({ namespace: 'gamma', skills: [{ namespace: 'alpha', id: 'missing' }] }), kit.member()))
      .rejects.toBeInstanceOf(ForbiddenError);
    const { agent } = await createAgent(agentInput({ namespace: 'beta' }), betaMember());
    await expect(updateAgent({ id: agent.id, body: { skills: [{ namespace: 'alpha', id: 'missing' }] } }, kit.member()))
      .rejects.toBeInstanceOf(NotFoundError);
  });
});

