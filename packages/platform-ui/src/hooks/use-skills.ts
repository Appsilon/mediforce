'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AgentDefinition } from '@mediforce/platform-core';
import { apiFetch } from '@/lib/api-fetch';
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

export interface SkillWorkflow {
  namespace: string;
  name: string;
  title: string | undefined;
}

interface WorkflowSkillUsage extends SkillWorkflow {
  directSkills: { namespace: string; id: string }[];
  agentIds: string[];
}

/**
 * The live workflows each Skill runs in, keyed by {@link skillKey}: the ones
 * naming it on a step, plus every one whose steps use an agent holding it.
 * `holders` is {@link useSkillHolders}' answer.
 */
export function useSkillWorkflows(holders: Map<string, AgentDefinition[]>): Map<string, SkillWorkflow[]> {
  const query = useQuery({
    queryKey: queryKeys.workflowSkillUsage(),
    queryFn: async () => {
      const res = await apiFetch('/api/workflow-definitions/by-skill');
      if (!res.ok) throw new Error(`Failed to load workflows (${res.status})`);
      return ((await res.json()) as { workflows: WorkflowSkillUsage[] }).workflows;
    },
    retry: stopRetryOn4xx,
  });
  return useMemo(() => {
    const byWorkflow = new Map<string, Map<string, SkillWorkflow>>();
    const add = (key: string, workflow: WorkflowSkillUsage) => {
      const workflows = byWorkflow.get(key) ?? new Map<string, SkillWorkflow>();
      workflows.set(`${workflow.namespace}/${workflow.name}`, {
        namespace: workflow.namespace,
        name: workflow.name,
        title: workflow.title,
      });
      byWorkflow.set(key, workflows);
    };
    const skillsByAgent = new Map<string, string[]>();
    for (const [key, agents] of holders) {
      for (const agent of agents) skillsByAgent.set(agent.id, [...(skillsByAgent.get(agent.id) ?? []), key]);
    }
    for (const workflow of query.data ?? []) {
      for (const ref of workflow.directSkills) add(skillKey(ref.namespace, ref.id), workflow);
      for (const agentId of workflow.agentIds) {
        for (const key of skillsByAgent.get(agentId) ?? []) add(key, workflow);
      }
    }
    return new Map([...byWorkflow].map(([key, workflows]) => [key, [...workflows.values()]]));
  }, [query.data, holders]);
}
