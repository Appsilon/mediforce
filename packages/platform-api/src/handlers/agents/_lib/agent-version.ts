import { createHash } from 'node:crypto';
import {
  canonicalJson,
  offeredSkill,
  type AgentConfigSnapshot,
  type AgentDefinition,
  type AgentVersion,
} from '@mediforce/platform-core';
import type { CallerScope } from '../../../repositories/index';
import { actorFromCaller } from '../../_helpers';

/** Stands in for the content hash of a Skill an Agent names that no longer resolves. */
const MISSING_SKILL_HASH = 'missing';

/**
 * What shapes the Agent's behaviour (ADR-0029): its runtime, model, system
 * prompt, MCP bindings, and each Skill it holds by content hash, sorted, so a
 * Skill edited in the catalog makes the Agent a new version.
 */
export async function agentConfigOf(scope: CallerScope, agent: AgentDefinition): Promise<AgentConfigSnapshot> {
  const skills = await Promise.all((agent.skills ?? []).map(async (ref) => {
    const contentHash = await scope.skills.heldContentHash(ref.namespace, ref.id);
    return offeredSkill({ ...ref, contentHash: contentHash ?? MISSING_SKILL_HASH });
  }));
  return {
    kind: agent.kind,
    runtimeId: agent.runtimeId ?? null,
    foundationModel: agent.foundationModel,
    systemPrompt: agent.systemPrompt,
    mcpServers: agent.mcpServers ?? {},
    skills: skills.sort((left, right) => `${left.namespace}/${left.id}`.localeCompare(`${right.namespace}/${right.id}`)),
  };
}

export function agentConfigHash(config: AgentConfigSnapshot): string {
  return createHash('sha256').update(canonicalJson(config)).digest('hex');
}

/**
 * The Agent's version for the configuration it has now: its newest version
 * when that has the same hash, otherwise a new one, recorded as the caller.
 * Two callers recording the same new version race on its number; the loser
 * reads the winner's back.
 */
export async function recordAgentVersion(scope: CallerScope, agent: AgentDefinition): Promise<AgentVersion> {
  const config = await agentConfigOf(scope, agent);
  const hash = agentConfigHash(config);
  const [newest] = await scope.agentDefinitions.listVersions(agent.id);
  if (newest !== undefined && newest.hash === hash) return newest;
  const version: AgentVersion = {
    agentId: agent.id,
    version: (newest?.version ?? 0) + 1,
    hash,
    config,
    createdBy: actorFromCaller(scope).actorId,
    createdAt: new Date().toISOString(),
  };
  try {
    return await scope.agentDefinitions.appendVersion(version);
  } catch (error) {
    const [winner] = await scope.agentDefinitions.listVersions(agent.id);
    if (winner !== undefined && winner.hash === hash) return winner;
    throw error;
  }
}

/** The version `recordAgentVersion` would return for the Agent's configuration now, without recording it. */
export async function upcomingAgentVersion(scope: CallerScope, agent: AgentDefinition): Promise<number> {
  const [newest] = await scope.agentDefinitions.listVersions(agent.id);
  if (newest === undefined) return 1;
  return newest.hash === agentConfigHash(await agentConfigOf(scope, agent)) ? newest.version : newest.version + 1;
}

/** The Agent's newest version when it still has that configuration; null when it changed since, or was never recorded. */
export async function currentAgentVersion(scope: CallerScope, agent: AgentDefinition): Promise<AgentVersion | null> {
  const [newest] = await scope.agentDefinitions.listVersions(agent.id);
  if (newest === undefined) return null;
  return newest.hash === agentConfigHash(await agentConfigOf(scope, agent)) ? newest : null;
}
