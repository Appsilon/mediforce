import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryAgentDefinitionRepository,
  InMemorySkillRepository,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import type { AgentDefinition } from '@mediforce/platform-core';
import { createTestScope, userCaller } from '../../../../repositories/__tests__/create-test-scope';
import { currentAgentVersion, recordAgentVersion, upcomingAgentVersion } from '../agent-version';

const SKILL_MD = '---\nname: ctcae-grading\ndescription: Grades by CTCAE\n---\nGrade every event.';

describe('recordAgentVersion (ADR-0029)', () => {
  let agentDefinitionRepo: InMemoryAgentDefinitionRepository;
  let skillRepo: InMemorySkillRepository;
  let agent: AgentDefinition;

  beforeEach(async () => {
    resetFactorySequence();
    agentDefinitionRepo = new InMemoryAgentDefinitionRepository();
    skillRepo = new InMemorySkillRepository();
    await skillRepo.create({
      namespace: 'team-alpha', id: 'ctcae-grading', name: 'ctcae-grading', description: 'Grades by CTCAE', visibility: 'private',
      contentHash: 'hash-v1', files: [{ path: 'SKILL.md', contents: SKILL_MD }],
    });
    agent = await agentDefinitionRepo.create({
      kind: 'plugin', runtimeId: 'claude-code-agent', name: 'AE grader', iconName: 'Bot', description: '',
      foundationModel: 'anthropic/claude-sonnet-4', systemPrompt: 'Grade AEs.', inputDescription: '', outputDescription: '',
      namespace: 'team-alpha', visibility: 'private', skills: [{ namespace: 'team-alpha', id: 'ctcae-grading' }],
    });
  });

  const scope = () => createTestScope({ agentDefinitionRepo, skillRepo, caller: userCaller('u-1', ['team-alpha']) });

  it('keeps the version while nothing changed, and records one when a Skill the agent holds is edited', async () => {
    const first = await recordAgentVersion(scope(), agent);
    expect(first).toMatchObject({ version: 1, config: { skills: [{ namespace: 'team-alpha', id: 'ctcae-grading', contentHash: 'hash-v1' }] } });
    expect(await recordAgentVersion(scope(), agent)).toEqual(first);

    await skillRepo.update({
      namespace: 'team-alpha', id: 'ctcae-grading', name: 'ctcae-grading', description: 'Grades by CTCAE', visibility: 'private',
      contentHash: 'hash-v2', files: [{ path: 'SKILL.md', contents: `${SKILL_MD}\nAlso grade lab values.` }],
    });
    expect(await currentAgentVersion(scope(), agent)).toBeNull();
    expect(await recordAgentVersion(scope(), agent)).toMatchObject({ version: 2, config: { skills: [{ contentHash: 'hash-v2' }] } });
  });

  it('versions the agent on its output schema, and an agent without one keeps the hash it had before Agents could declare one', async () => {
    const first = await recordAgentVersion(scope(), agent);
    expect('outputSchema' in first.config).toBe(false);

    const outputSchema = { type: 'object' as const, required: ['classification'] };
    const withSchema = await agentDefinitionRepo.update(agent.id, { outputSchema });
    expect(await recordAgentVersion(scope(), withSchema)).toMatchObject({ version: 2, config: { outputSchema } });

    const cleared = await agentDefinitionRepo.update(agent.id, { outputSchema: null });
    expect(cleared.outputSchema).toBeUndefined();
    const third = await recordAgentVersion(scope(), cleared);
    expect(third.version).toBe(3);
    expect(third.hash).toBe(first.hash);
  });

  it('versions the agent on its image, and an agent without one keeps the hash it had before Agents could name one', async () => {
    const first = await recordAgentVersion(scope(), agent);
    expect('image' in first.config).toBe(false);

    const withImage = await agentDefinitionRepo.update(agent.id, { image: 'r-tools:2' });
    expect(await recordAgentVersion(scope(), withImage)).toMatchObject({ version: 2, config: { image: 'r-tools:2' } });

    const golden = await agentDefinitionRepo.update(agent.id, { image: 'mediforce-golden-image:latest' });
    expect((await recordAgentVersion(scope(), golden)).hash).toBe(first.hash);

    const cleared = await agentDefinitionRepo.update(agent.id, { image: null });
    expect(cleared.image).toBeUndefined();
    expect((await recordAgentVersion(scope(), cleared)).hash).toBe(first.hash);
  });

  it('hashes a private Skill the same for a caller outside its namespace, so the version does not depend on who asks', async () => {
    const first = await recordAgentVersion(scope(), agent);
    const outsider = createTestScope({ agentDefinitionRepo, skillRepo, caller: userCaller('u-2', ['team-beta']) });
    await agentDefinitionRepo.update(agent.id, { visibility: 'public' });
    const publicAgent = { ...agent, visibility: 'public' as const };
    expect(await currentAgentVersion(outsider, publicAgent)).toEqual(first);
  });

  it('refuses to record a version of an agent the caller may not write, whatever agent it says the version is for', async () => {
    const outsider = createTestScope({ agentDefinitionRepo, skillRepo, caller: userCaller('u-2', ['team-beta']) });
    const version = await recordAgentVersion(scope(), agent);
    await expect(outsider.agentDefinitions.appendVersion({ ...version, version: 2 })).rejects.toThrow();
    expect(await agentDefinitionRepo.listVersions(agent.id)).toHaveLength(1);
  });

  it('names the version recording would give, without recording it', async () => {
    expect(await upcomingAgentVersion(scope(), agent)).toBe(1);
    await recordAgentVersion(scope(), agent);
    expect(await upcomingAgentVersion(scope(), agent)).toBe(1);
    expect(await upcomingAgentVersion(scope(), { ...agent, systemPrompt: 'Grade AEs by CTCAE v6.' })).toBe(2);
    expect(await agentDefinitionRepo.listVersions(agent.id)).toHaveLength(1);
  });

  it('records a Skill that no longer resolves as missing, so the version still says the agent named it', async () => {
    await skillRepo.delete('team-alpha', 'ctcae-grading');
    expect((await recordAgentVersion(scope(), agent)).config.skills).toEqual([{ namespace: 'team-alpha', id: 'ctcae-grading', contentHash: 'missing' }]);
  });

  it('reads the winner back when another caller recorded the same new version first', async () => {
    const [winner, loser] = await Promise.all([recordAgentVersion(scope(), agent), recordAgentVersion(scope(), agent)]);
    expect(loser).toEqual(winner);
    expect(await agentDefinitionRepo.listVersions(agent.id)).toHaveLength(1);
  });
});
