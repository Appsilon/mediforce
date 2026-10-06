'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AgentDefinition } from '@mediforce/platform-core';
import { mediforce } from '@/lib/mediforce';
import { queryKeys } from '@/lib/query-keys';
import { stopRetryOn4xx } from '@/lib/retry';

export const skillKey = (namespace: string, id: string): string => `${namespace}/${id}`;

/** The workspace's Skills, then every other workspace's public ones. */
export function useSkills(handle: string) {
  return useQuery({
    queryKey: queryKeys.skills(handle),
    queryFn: async () => (await mediforce.skills.list({ namespace: handle, includePublic: true })).skills,
    retry: stopRetryOn4xx,
  });
}

export function useSkill(namespace: string, id: string) {
  return useQuery({
    queryKey: queryKeys.skill(namespace, id),
    queryFn: async () => (await mediforce.skills.get({ namespace, id })).skill,
    retry: stopRetryOn4xx,
  });
}

/**
 * The agents holding each Skill, keyed by {@link skillKey}. Only agents the
 * caller can see are counted; a delete refused over agents in other
 * workspaces says so itself.
 */
export function useSkillHolders(): Map<string, AgentDefinition[]> {
  const query = useQuery({
    queryKey: queryKeys.agentDefinitions(),
    queryFn: async () => (await mediforce.agents.list()).agents,
    retry: stopRetryOn4xx,
  });
  return useMemo(() => {
    const holders = new Map<string, AgentDefinition[]>();
    for (const agent of query.data ?? []) {
      for (const ref of agent.skills ?? []) {
        const key = skillKey(ref.namespace, ref.id);
        holders.set(key, [...(holders.get(key) ?? []), agent]);
      }
    }
    return holders;
  }, [query.data]);
}
