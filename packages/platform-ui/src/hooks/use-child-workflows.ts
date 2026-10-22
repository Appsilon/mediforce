'use client';

import { useCallback, useMemo, useState } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import {
  pickRunnableVersion,
  type InstanceStatus,
  type ProcessInstance,
  type WorkflowDefinition,
} from '@mediforce/platform-core';
import {
  childWorkflowTargetOf,
  latestStepStatus,
  type ChildWorkflowExpansion,
  type ChildWorkflowTarget,
  type ExpandedChildWorkflow,
} from '@/lib/child-workflow';
import { mediforce } from '@/lib/mediforce';
import { queryKeys } from '@/lib/query-keys';
import { stopRetryOn4xx } from '@/lib/retry';
import { routes } from '@/lib/routes';
import {
  CRITICAL_LIVE_INTERVAL_MS,
  STANDARD_LIVE_INTERVAL_MS,
  TERMINAL_STATUSES,
} from '@/lib/polling-cadence';

type QuerySlice<Data> = { data: Data | undefined; error: Error | null; isPending: boolean };

// Module-level so useQueries keeps the combined array stable between renders
// that change nothing — the canvas re-lays itself out whenever it changes.
function combineSlices<Data>(results: Array<QuerySlice<Data>>): Array<QuerySlice<Data>> {
  return results.map(({ data, error, isPending }) => ({ data, error, isPending }));
}

function useOpenSteps(definition: WorkflowDefinition) {
  const targets = useMemo(() => {
    const byStep = new Map<string, ChildWorkflowTarget>();
    for (const step of definition.steps) {
      const target = childWorkflowTargetOf(step);
      if (target !== null) byStep.set(step.id, target);
    }
    return byStep;
  }, [definition]);

  const [openStepIds, setOpenStepIds] = useState<ReadonlySet<string>>(() => new Set());
  const onToggle = useCallback((stepId: string) => {
    setOpenStepIds((previous) => {
      const next = new Set(previous);
      if (next.has(stepId) === true) next.delete(stepId);
      else next.add(stepId);
      return next;
    });
  }, []);

  // A step removed or retargeted while open drops out instead of drawing a stale child.
  const open = useMemo(
    () => [...openStepIds].flatMap((stepId) => {
      const target = targets.get(stepId);
      return target === undefined ? [] : [{ stepId, target }];
    }),
    [openStepIds, targets],
  );
  const expandable = useMemo<ReadonlySet<string>>(() => new Set(targets.keys()), [targets]);
  return { open, expandable, onToggle };
}

const errorMessage = (error: Error) => `Could not load the child workflow: ${error.message}`;

/**
 * Definition view: an open step draws the version of its child a run started
 * now would get — the pinned one, else the child's runnable version (its
 * default when live, the newest live one otherwise).
 */
export function useChildDefinitionExpansion(
  definition: WorkflowDefinition,
  namespace: string | undefined,
): ChildWorkflowExpansion | undefined {
  const { open, expandable, onToggle } = useOpenSteps(definition);
  const handle = namespace ?? '';

  const versionLists = useQueries({
    queries: open.map(({ target }) => ({
      queryKey: queryKeys.workflowVersions(handle, target.definitionName),
      queryFn: () => mediforce.workflows.versions({ name: target.definitionName, namespace: handle }),
      enabled: handle.length > 0 && target.definitionVersion === undefined,
      retry: stopRetryOn4xx,
    })),
    combine: combineSlices,
  });

  // undefined while the version list loads; null when no version is runnable.
  const versions = useMemo(() => open.map(({ target }, index) => {
    if (target.definitionVersion !== undefined) return target.definitionVersion;
    const list = versionLists[index]?.data;
    return list === undefined ? undefined : pickRunnableVersion(list.versions, list.defaultVersion)?.version ?? null;
  }), [open, versionLists]);

  const definitions = useQueries({
    queries: open.map(({ target }, index) => {
      const version = versions[index];
      return {
        queryKey: queryKeys.workflow(handle, target.definitionName, version ?? undefined),
        queryFn: async () => (await mediforce.workflows.get({ name: target.definitionName, namespace: handle, version: version ?? undefined })).definition,
        enabled: handle.length > 0 && typeof version === 'number',
        retry: stopRetryOn4xx,
      };
    }),
    combine: combineSlices,
  });

  const expanded = useMemo(() => {
    const byStep = new Map<string, ExpandedChildWorkflow>();
    open.forEach(({ stepId, target }, index) => {
      const version = versions[index];
      const fetched = definitions[index];
      const listError = versionLists[index]?.error ?? null;
      const error = listError ?? fetched?.error ?? null;
      byStep.set(stepId, {
        definition: fetched?.data ?? null,
        namespace: handle,
        title: typeof version === 'number' ? `${target.definitionName} v${version}` : target.definitionName,
        href: typeof version === 'number' ? routes.workflowDefinition(handle, target.definitionName, version) : undefined,
        badge: target.forEach === true ? '× N at runtime' : undefined,
        message: handle.length === 0
          ? 'No workspace to look the child workflow up in.'
          : error !== null
            ? errorMessage(error)
            : version === null
              ? 'No runnable version of this workflow.'
              : fetched?.data === undefined ? 'Loading…' : undefined,
      });
    });
    return byStep;
  }, [open, versions, versionLists, definitions, handle]);

  return useMemo(
    () => (expandable.size === 0 ? undefined : { expandable, expanded, onToggle }),
    [expandable, expanded, onToggle],
  );
}

const isTerminal = (status: InstanceStatus) => TERMINAL_STATUSES.has(status);

/**
 * Run view: an open step draws the child runs it started — matched by the
 * workflow they run — each at the version it pinned, with its steps' live
 * statuses. One child is drawn at a time; the frame lists the others.
 * A run does not record which step spawned it, so two steps starting the
 * same workflow each list the children of both.
 */
export function useChildRunExpansion(
  definition: WorkflowDefinition,
  run: Pick<ProcessInstance, 'id' | 'status' | 'namespace'>,
): ChildWorkflowExpansion | undefined {
  const { open, expandable, onToggle } = useOpenSteps(definition);
  const [selectedByStep, setSelectedByStep] = useState<ReadonlyMap<string, string>>(() => new Map());

  const childrenQuery = useQuery({
    queryKey: queryKeys.runs.children(run.id),
    queryFn: async () => (await mediforce.runs.list({ parent: run.id, limit: 10000 })).runs,
    enabled: open.length > 0,
    retry: stopRetryOn4xx,
    refetchInterval: (query) => {
      if (query.state.error !== null) return false;
      const settled = isTerminal(run.status) && (query.state.data ?? []).every((child) => isTerminal(child.status));
      return settled ? false : STANDARD_LIVE_INTERVAL_MS;
    },
  });

  const childrenError = (childrenQuery.error as Error | null) ?? null;

  const shown = useMemo(() => {
    const children = childrenQuery.data ?? [];
    return open.map(({ stepId, target }) => {
      const candidates = children.filter((child) => child.definitionName === target.definitionName);
      const selectedId = selectedByStep.get(stepId);
      const selected = candidates.find((child) => child.id === selectedId) ?? candidates[candidates.length - 1];
      return { stepId, target, candidates, selected };
    });
  }, [open, childrenQuery.data, selectedByStep]);

  const definitions = useQueries({
    queries: shown.map(({ selected }) => {
      const namespace = selected?.namespace ?? '';
      const name = selected?.definitionName ?? '';
      const version = selected === undefined ? undefined : Number(selected.definitionVersion);
      return {
        queryKey: queryKeys.workflow(namespace, name, version),
        queryFn: async () => (await mediforce.workflows.get({ name, namespace, version })).definition,
        enabled: selected !== undefined && namespace.length > 0,
        retry: stopRetryOn4xx,
      };
    }),
    combine: combineSlices,
  });

  const steps = useQueries({
    queries: shown.map(({ selected }) => ({
      queryKey: queryKeys.processSteps(selected?.id ?? '__noop__'),
      queryFn: async () => (await mediforce.processes.getSteps({ instanceId: selected?.id ?? '' })).steps,
      enabled: selected !== undefined,
      retry: stopRetryOn4xx,
      refetchInterval: (query: { state: { error: Error | null } }) =>
        query.state.error !== null || (selected !== undefined && isTerminal(selected.status)) ? false : CRITICAL_LIVE_INTERVAL_MS,
    })),
    combine: combineSlices,
  });

  const expanded = useMemo(() => {
    const byStep = new Map<string, ExpandedChildWorkflow>();
    shown.forEach(({ stepId, target, candidates, selected }, index) => {
      const fetched = definitions[index];
      const stepEntries = steps[index]?.data;
      const error = childrenError ?? fetched?.error ?? null;
      const handle = selected?.namespace ?? run.namespace ?? '';
      byStep.set(stepId, {
        definition: fetched?.data ?? null,
        namespace: handle,
        title: selected !== undefined ? `${selected.definitionName} v${selected.definitionVersion}` : target.definitionName,
        href: selected !== undefined ? routes.workflowDefinition(handle, selected.definitionName, selected.definitionVersion) : undefined,
        badge: target.forEach === true ? `× ${candidates.length}` : undefined,
        message: error !== null
          ? errorMessage(error)
          : childrenQuery.isPending || (selected !== undefined && fetched?.data === undefined)
            ? 'Loading…'
            : selected === undefined ? 'This step has not started a child run yet.' : undefined,
        stepStatus: stepEntries === undefined ? undefined : latestStepStatus(stepEntries.flatMap((entry) => entry.executions)),
        runs: candidates.map((child, position) => ({
          id: child.id,
          label: `#${position + 1} ${child.status}`,
          href: routes.workflowRun(child.namespace ?? handle, child.definitionName, child.id),
          selected: child.id === selected?.id,
          onSelect: () => setSelectedByStep((previous) => new Map(previous).set(stepId, child.id)),
        })),
      });
    });
    return byStep;
  }, [shown, definitions, steps, childrenError, childrenQuery.isPending, run.namespace]);

  return useMemo(
    () => (expandable.size === 0 ? undefined : { expandable, expanded, onToggle }),
    [expandable, expanded, onToggle],
  );
}
