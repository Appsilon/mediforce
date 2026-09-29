import type { APIRequestContext } from '@playwright/test';
import type { AgentRun } from '@mediforce/platform-core';
import { ListAgentRunsOutputSchema } from '@mediforce/platform-api/contract';
import { expect } from './test-fixtures';
import { TEST_ORG_HANDLE } from './constants';
import { pollUntil } from './poll-until';

const API_KEY = process.env.PLATFORM_API_KEY ?? 'test-api-key';
export const AUTH_HEADERS = { 'X-Api-Key': API_KEY };
export const JSON_HEADERS = { ...AUTH_HEADERS, 'Content-Type': 'application/json' };

/** A one-agent-step workflow: `grade-aes` → done. */
export function agentStepWorkflow(name: string, step: Record<string, unknown>): Record<string, unknown> {
  return {
    name,
    title: name,
    steps: [
      { id: 'grade-aes', name: 'Grade adverse events', type: 'creation', executor: 'agent', ...step },
      { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
    ],
    transitions: [{ from: 'grade-aes', to: 'done' }],
  };
}

/** Registers the workflow in the test workspace and starts a run; returns the run id. */
export async function startRun(
  request: APIRequestContext,
  wd: Record<string, unknown>,
  payload: Record<string, unknown> = {},
): Promise<string> {
  const createWdRes = await request.post(`/api/workflow-definitions?namespace=${TEST_ORG_HANDLE}`, {
    headers: JSON_HEADERS,
    data: wd,
  });
  expect(createWdRes.status(), await createWdRes.text()).toBe(201);

  const triggerRes = await request.post('/api/processes', {
    headers: JSON_HEADERS,
    data: { namespace: TEST_ORG_HANDLE, definitionName: wd.name, triggeredBy: 'e2e-test', triggerName: 'Start', payload },
  });
  expect(triggerRes.status(), await triggerRes.text()).toBe(201);
  const { run } = (await triggerRes.json()) as { run: { id: string } };
  return run.id;
}

export async function listAgentRuns(request: APIRequestContext, runId: string): Promise<AgentRun[] | null> {
  const res = await request.get(`/api/agent-runs?runId=${runId}`, { headers: AUTH_HEADERS });
  if (res.status() !== 200) return null;
  return ListAgentRunsOutputSchema.parse(await res.json()).runs;
}

export async function awaitFinishedAgentRun(request: APIRequestContext, runId: string): Promise<AgentRun> {
  return pollUntil(
    async () => {
      const runs = await listAgentRuns(request, runId);
      if (runs === null) return null;
      return runs.find((agentRun) => agentRun.status !== 'running') ?? null;
    },
    { description: `a finished agent run in ${runId}` },
  );
}
