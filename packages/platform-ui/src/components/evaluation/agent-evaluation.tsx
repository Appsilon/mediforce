'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import type { EvaluationSubject } from '@mediforce/platform-core';
import { mediforce } from '@/lib/mediforce';
import { queryKeys } from '@/lib/query-keys';
import { stopRetryOn4xx } from '@/lib/retry';
import { useAgentVersions } from '@/hooks/use-step-evaluation';
import { useAgentEvaluationGates } from '@/hooks/use-evaluation-gates';
import { StepEvaluation } from './evaluation-tab';

/** Which version of the Agent an Eval Run started now would assess. */
function AgentVersionLine({ agentId }: { agentId: string }) {
  const versions = useAgentVersions(agentId);
  if (versions.data === undefined) return null;
  const [newest] = versions.data.versions;
  const current = versions.data.current;
  return (
    <p className="text-sm text-muted-foreground" data-testid="agent-version">
      {current !== null
        ? <>An Eval Run started now assesses <span className="font-medium text-foreground">agent version {current}</span>.</>
        : newest === undefined
          ? 'This agent has no recorded version yet; its first Eval Run records version 1.'
          : `The agent changed since version ${newest.version}; its next Eval Run records version ${newest.version + 1}.`}
      {' '}Saving a change to its runtime, model, system prompt, MCP servers or Skills makes it a new version.
    </p>
  );
}

/**
 * The Agent's own Evaluation (ADR-0029): Evaluators, Eval Cases, Acceptance
 * Criteria and Eval Runs that belong to the Agent, not to any workflow step,
 * beside the Evaluation Assistant. Each Eval Run assesses the Agent version it
 * had when prepared. Only a container agent of this workspace is evaluated.
 */
export function AgentEvaluation({ handle, agentId }: { handle: string; agentId: string }) {
  const agent = useQuery({
    queryKey: queryKeys.agentDefinition(agentId),
    queryFn: () => mediforce.agents.get({ id: agentId }),
    retry: stopRetryOn4xx,
  });
  const gates = useAgentEvaluationGates(handle, agentId);

  if (agent.error instanceof Error) return <p className="text-sm text-destructive">{agent.error.message}</p>;
  if (agent.data === undefined) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const { agent: definition } = agent.data;
  if (definition.namespace !== handle) {
    return <p className="text-sm text-muted-foreground">Only an agent of this workspace is evaluated here; this one belongs to {definition.namespace ?? 'the platform'}.</p>;
  }
  if (definition.kind !== 'plugin') {
    return <p className="text-sm text-muted-foreground">A cowork agent has no single output to grade, so it is not evaluated on its own.</p>;
  }
  if (definition.runtimeId === undefined) {
    return <p className="text-sm text-muted-foreground">This agent names no runtime; set one before evaluating it.</p>;
  }

  const subject: EvaluationSubject = { kind: 'agent', namespace: handle, agentId };
  return (
    <div className="space-y-4">
      <AgentVersionLine agentId={agentId} />
      <StepEvaluation
        step={subject}
        definitionVersion={null}
        outputSchema={undefined}
        mayEdit={gates.mayEdit}
        editReason={gates.editReason}
        mayRun={gates.mayRun}
        runReason={gates.runReason}
      />
    </div>
  );
}
