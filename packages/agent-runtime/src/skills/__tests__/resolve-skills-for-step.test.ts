import { describe, it, expect, beforeEach } from 'vitest';
import {
  WorkflowStepSchema,
  type AgentSkillRef,
  type AgentVisibility,
  type Skill,
  type WorkflowStep,
} from '@mediforce/platform-core';
import { InMemoryAgentDefinitionRepository } from '@mediforce/platform-core/testing';
import { AgentDefinitionNotFoundError } from '../../mcp/resolve-mcp-for-step';
import { resolveSkillsForStep, RetiredFileSkillError, SkillNotFoundError, type ResolveSkillsForStepDeps } from '../resolve-skills-for-step';

function makeStep(overrides: Partial<WorkflowStep> = {}): WorkflowStep {
  return WorkflowStepSchema.parse({ id: 'map', name: 'Map', type: 'creation', executor: 'agent', ...overrides });
}

function makeSkill(namespace: string, id: string, visibility: Skill['visibility'] = 'private'): Skill {
  return {
    namespace,
    id,
    name: id,
    description: `${id} skill`,
    visibility,
    contentHash: `hash-${namespace}-${id}`,
    files: [{ path: 'SKILL.md', contents: `---\nname: ${id}\ndescription: ${id} skill\n---\n` }],
    createdAt: '2026-10-06T00:00:00.000Z',
    updatedAt: '2026-10-06T00:00:00.000Z',
  };
}

const workflow = { namespace: 'alpha', visibility: 'private' } as const;

describe('resolveSkillsForStep', () => {
  let agentRepo: InMemoryAgentDefinitionRepository;
  let stored: Map<string, Skill>;
  let deps: ResolveSkillsForStepDeps;

  const holdingAgent = async (skills: AgentSkillRef[] | undefined, visibility: AgentVisibility = 'private', namespace: string | undefined = 'alpha') => {
    await agentRepo.upsert('mapper', {
      kind: 'plugin',
      runtimeId: 'claude-code-agent',
      name: 'Mapper',
      iconName: 'Bot',
      description: '',
      foundationModel: 'sonnet',
      systemPrompt: '',
      inputDescription: '',
      outputDescription: '',
      visibility,
      ...(namespace === undefined ? {} : { namespace }),
      ...(skills === undefined ? {} : { skills }),
    });
  };

  const store = (...skills: Skill[]) => {
    for (const skill of skills) stored.set(`${skill.namespace}/${skill.id}`, skill);
  };

  beforeEach(() => {
    agentRepo = new InMemoryAgentDefinitionRepository();
    stored = new Map();
    deps = {
      agentDefinitionRepo: agentRepo,
      skillRepo: { getById: async (namespace, id) => stored.get(`${namespace}/${id}`) ?? null },
    };
  });

  it('[DATA] returns null when the step names no agent', async () => {
    expect(await resolveSkillsForStep(makeStep(), deps, workflow)).toBeNull();
  });

  it('[ERROR] refuses a step still naming a retired file skill before resolving any catalog skill', async () => {
    store(makeSkill('alpha', 'sdtm-mapping'));
    await holdingAgent([{ namespace: 'alpha', id: 'sdtm-mapping' }]);
    const step = makeStep({ agentId: 'mapper', agent: { prompt: 'map', retiredFileSkill: 'sdtm-mapper' } });

    const error = await resolveSkillsForStep(step, deps, workflow).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RetiredFileSkillError);
    expect((error as RetiredFileSkillError).message).toContain("Step 'map' uses the file skill 'sdtm-mapper'");
  });

  it('[ERROR] throws AgentDefinitionNotFoundError for a missing agent', async () => {
    await expect(resolveSkillsForStep(makeStep({ agentId: 'missing' }), deps, workflow))
      .rejects.toThrow(AgentDefinitionNotFoundError);
  });

  it('[DATA] returns [] for an agent that holds no skills', async () => {
    await holdingAgent(undefined);
    expect(await resolveSkillsForStep(makeStep({ agentId: 'mapper' }), deps, workflow)).toEqual([]);
  });

  it('[DATA] resolves each skill in the namespace its reference names, in the agent\'s order', async () => {
    store(makeSkill('alpha', 'sdtm-mapping'), makeSkill('beta', 'meddra-coding', 'public'));
    await holdingAgent([{ namespace: 'beta', id: 'meddra-coding' }, { namespace: 'alpha', id: 'sdtm-mapping' }]);

    const skills = await resolveSkillsForStep(makeStep({ agentId: 'mapper' }), deps, workflow);
    expect(skills?.map((skill) => `${skill.namespace}/${skill.id}`)).toEqual(['beta/meddra-coding', 'alpha/sdtm-mapping']);
  });

  it('[ERROR] names a skill that no longer exists', async () => {
    await holdingAgent([{ namespace: 'alpha', id: 'deleted-skill' }]);

    const error = await resolveSkillsForStep(makeStep({ agentId: 'mapper' }), deps, workflow).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SkillNotFoundError);
    expect((error as SkillNotFoundError).message).toContain("'alpha/deleted-skill'");
    expect((error as SkillNotFoundError).offerer).toEqual({ kind: 'agent', id: 'mapper' });
  });

  it('[ERROR] refuses another workspace\'s private skill', async () => {
    store(makeSkill('beta', 'internal-sop'));
    await holdingAgent([{ namespace: 'beta', id: 'internal-sop' }]);

    await expect(resolveSkillsForStep(makeStep({ agentId: 'mapper' }), deps, workflow)).rejects.toThrow(SkillNotFoundError);
  });

  it('[ERROR] refuses a private skill on a public agent, even from its own workspace', async () => {
    store(makeSkill('alpha', 'sdtm-mapping'));
    await holdingAgent([{ namespace: 'alpha', id: 'sdtm-mapping' }], 'public');

    await expect(resolveSkillsForStep(makeStep({ agentId: 'mapper' }), deps, workflow)).rejects.toThrow(SkillNotFoundError);
  });

  it('[DATA] gives a built-in public agent its public skills', async () => {
    store(makeSkill('alpha', 'sdtm-mapping', 'public'));
    await holdingAgent([{ namespace: 'alpha', id: 'sdtm-mapping' }], 'public', undefined);

    const skills = await resolveSkillsForStep(makeStep({ agentId: 'mapper' }), deps, workflow);
    expect(skills?.map((skill) => skill.id)).toEqual(['sdtm-mapping']);
  });
  describe('skills the step adds', () => {
    const addingStep = (skills: AgentSkillRef[], agentId: string | null = 'mapper') =>
      makeStep({ ...(agentId === null ? {} : { agentId }), agent: { prompt: 'map', skills } });

    it('[DATA] offers them after the agent\'s own', async () => {
      store(makeSkill('alpha', 'sdtm-mapping'), makeSkill('alpha', 'define-xml'));
      await holdingAgent([{ namespace: 'alpha', id: 'sdtm-mapping' }]);

      const skills = await resolveSkillsForStep(addingStep([{ namespace: 'alpha', id: 'define-xml' }]), deps, workflow);
      expect(skills?.map((skill) => skill.id)).toEqual(['sdtm-mapping', 'define-xml']);
    });

    it('[DATA] offers them on a step that names no agent', async () => {
      store(makeSkill('alpha', 'define-xml'));

      const skills = await resolveSkillsForStep(addingStep([{ namespace: 'alpha', id: 'define-xml' }], null), deps, workflow);
      expect(skills?.map((skill) => skill.id)).toEqual(['define-xml']);
    });

    it('[DATA] lists a skill the agent already holds once', async () => {
      store(makeSkill('alpha', 'sdtm-mapping'));
      await holdingAgent([{ namespace: 'alpha', id: 'sdtm-mapping' }]);

      const skills = await resolveSkillsForStep(addingStep([{ namespace: 'alpha', id: 'sdtm-mapping' }]), deps, workflow);
      expect(skills?.map((skill) => `${skill.namespace}/${skill.id}`)).toEqual(['alpha/sdtm-mapping']);
    });

    it('[DATA] replaces the agent\'s skill of the same id from another workspace', async () => {
      store(makeSkill('alpha', 'sdtm-mapping'), makeSkill('beta', 'sdtm-mapping', 'public'));
      await holdingAgent([{ namespace: 'alpha', id: 'sdtm-mapping' }]);

      const skills = await resolveSkillsForStep(addingStep([{ namespace: 'beta', id: 'sdtm-mapping' }]), deps, workflow);
      expect(skills?.map((skill) => `${skill.namespace}/${skill.id}`)).toEqual(['beta/sdtm-mapping']);
    });

    it('[ERROR] names the step when its skill no longer exists', async () => {
      await holdingAgent(undefined);

      const error = await resolveSkillsForStep(addingStep([{ namespace: 'alpha', id: 'deleted-skill' }]), deps, workflow)
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(SkillNotFoundError);
      expect((error as SkillNotFoundError).offerer).toEqual({ kind: 'step', id: 'map' });
    });

    it('[ERROR] refuses another workspace\'s private skill', async () => {
      store(makeSkill('beta', 'internal-sop'));

      await expect(resolveSkillsForStep(addingStep([{ namespace: 'beta', id: 'internal-sop' }], null), deps, workflow))
        .rejects.toThrow(SkillNotFoundError);
    });

    it('[ERROR] refuses a private skill on a public workflow, even from its own workspace', async () => {
      store(makeSkill('alpha', 'sdtm-mapping'));

      await expect(resolveSkillsForStep(
        addingStep([{ namespace: 'alpha', id: 'sdtm-mapping' }], null),
        deps,
        { namespace: 'alpha', visibility: 'public' },
      )).rejects.toThrow(SkillNotFoundError);
    });
  });
});
