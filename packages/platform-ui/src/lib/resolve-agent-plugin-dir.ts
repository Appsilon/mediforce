import type {
  AgentDefinitionRepository,
  SkillRegistryRepository,
  SkillRegistry,
} from '@mediforce/platform-core';
import { resolveAgentSkills, type ResolvedAgentSkills, type SkillRegistryRef } from '@mediforce/agent-runtime';

export interface ResolveAgentPluginDirDeps {
  agentDefinitionRepo: AgentDefinitionRepository;
  skillRegistryRepo: SkillRegistryRepository;
}

/**
 * For an agent referenced by `step.agentId`, load its skill bindings, fetch
 * each registry, and assemble the per-run plugin tree on disk. Returns
 * `null` when the agent has no skills configured (no plugin dir needed).
 *
 * Wraps `resolveAgentSkills` from @mediforce/agent-runtime with the
 * platform-ui repository layer so executeAgentStep stays decoupled from
 * Firestore plumbing.
 */
export async function resolveAgentPluginDir(
  agentId: string,
  deps: ResolveAgentPluginDirDeps,
): Promise<ResolvedAgentSkills | null> {
  const agent = await deps.agentDefinitionRepo.getById(agentId);
  if (agent === null) return null;
  const agentSkills = Array.isArray(agent.skills) ? agent.skills : [];
  if (agentSkills.length === 0) return null;

  const registryIds = Array.from(new Set(agentSkills.map((skill) => skill.registryId)));
  const registries = new Map<string, SkillRegistryRef>();
  for (const registryId of registryIds) {
    const record = await deps.skillRegistryRepo.getById(registryId);
    if (record === null) {
      throw new Error(
        `Agent "${agentId}" references skill registry "${registryId}" which does not exist`,
      );
    }
    registries.set(registryId, toSkillRegistryRef(record));
  }

  return resolveAgentSkills(agentSkills, registries);
}

function toSkillRegistryRef(record: SkillRegistry): SkillRegistryRef {
  if (typeof record.repo.commit !== 'string' || record.repo.commit.length === 0) {
    throw new Error(
      `Skill registry "${record.id}" has no pinned commit — set repo.commit before binding it to an agent`,
    );
  }
  return {
    id: record.id,
    repo: {
      url: record.repo.url,
      commit: record.repo.commit,
      auth: record.repo.auth,
    },
    skillsDir: record.skillsDir,
  };
}
