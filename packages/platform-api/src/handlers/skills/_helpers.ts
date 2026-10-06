import { createHash } from 'node:crypto';
import type { AgentDefinition, SkillFile } from '@mediforce/platform-core';
import { ConflictError } from '../../errors';

/** sha256 over a Skill's files, independent of the order they were sent in. */
export function skillContentHash(files: ReadonlyArray<SkillFile>): string {
  const canonical = [...files]
    .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
    .map((file) => [file.path, file.contents]);
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

export interface SkillHolders {
  visible: AgentDefinition[];
  hiddenCount: number;
}

/**
 * The refusal for a Skill write that would break the Agents holding it
 * (ADR-0025 decisions 3 and 7). Names the holders the caller can see and
 * counts the rest, since a public Skill can be held in other workspaces.
 */
export function heldSkillConflict(refusal: string, holders: SkillHolders): ConflictError {
  const named = holders.visible.map((agent) => `'${agent.name}' (${agent.namespace ?? 'built-in'})`);
  if (holders.hiddenCount > 0) {
    named.push(`${holders.hiddenCount} agent${holders.hiddenCount === 1 ? '' : 's'} you cannot see`);
  }
  return new ConflictError(`${refusal}: held by ${named.join(', ')}. Remove it from those agents first.`, {
    agents: holders.visible.map((agent) => ({ id: agent.id, name: agent.name, namespace: agent.namespace ?? null })),
    hiddenCount: holders.hiddenCount,
  });
}

export function hasHolders(holders: SkillHolders): boolean {
  return holders.visible.length > 0 || holders.hiddenCount > 0;
}
