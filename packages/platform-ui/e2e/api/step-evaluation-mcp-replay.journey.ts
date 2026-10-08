import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import type { APIRequestContext } from '@playwright/test';
import {
  EvalCaseOutputSchema,
  EvalRunOutputSchema,
  GetAgentTrajectoryOutputSchema,
  GetMcpEvalPolicyOutputSchema,
  type EvalRunOutput,
} from '@mediforce/platform-api/contract';
import { describeMcpReport } from '@mediforce/platform-core';
import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { pollUntil } from '../helpers/poll-until';
import { AUTH_HEADERS, JSON_HEADERS, agentStepWorkflow, awaitFinishedAgentRun, startRun } from '../helpers/agent-step-runs';

/**
 * API E2E for MCP replay in eval trials (ADR-0023 D6): a
 * replayed server runs live for an Eval Case no live trial recorded yet, and
 * the report counts that case as recorded by the run; once a recording exists,
 * a trial runs with it answered from the recording — and the report says no
 * trial made a live MCP call.
 *
 * MOCK_AGENT=true: the mock agent starts no MCP server, so a live trial
 * records nothing and a replayed one is never called. This journey proves the
 * storage, policy, record-first and report path. The recording is written to
 * Postgres as a live trial's recording proxy would leave it; the proxy itself
 * — recording, replaying, and wiring into mcp-config.json — is covered at L1
 * (agent-runtime mcp-tape and mcp-config-integration tests).
 */

async function post(request: APIRequestContext, path: string, data: Record<string, unknown>, status = 200) {
  const res = await request.post(path, { headers: JSON_HEADERS, data });
  expect(res.status(), await res.text()).toBe(status);
  return res.json();
}

async function runToEnd(request: APIRequestContext, step: Record<string, string>): Promise<EvalRunOutput> {
  const prepared = EvalRunOutputSchema.parse(await post(request, '/api/evaluation/runs', {
    ...step, trialsPerCase: 1, concurrency: 1, budgetUsd: 1,
  }, 201));
  await post(request, `/api/evaluation/runs/${prepared.evalRun.id}/start`, { confirmedBudgetUsd: 1 });
  return pollUntil(
    async () => {
      const res = await request.get(`/api/evaluation/runs/${prepared.evalRun.id}`, { headers: AUTH_HEADERS });
      const body = EvalRunOutputSchema.parse(await res.json());
      return body.evalRun.status === 'completed' ? body : null;
    },
    { description: `Eval Run ${prepared.evalRun.id} to complete`, timeoutMs: 90_000 },
  );
}

async function recordedCaseIds(request: APIRequestContext, step: Record<string, string>): Promise<string[]> {
  const res = await request.get(`/api/evaluation/mcp-policy?${new URLSearchParams(step)}`, { headers: AUTH_HEADERS });
  expect(res.status(), await res.text()).toBe(200);
  return GetMcpEvalPolicyOutputSchema.parse(await res.json()).servers.find((server) => server.name === 'meddra')!.recordedCaseIds;
}

test.describe('Step Evaluation MCP replay — API E2E', () => {
  test('a replayed server: run live to record a case with no recording, answered from it without any live MCP call', async ({ request }) => {
    test.setTimeout(180_000);
    const suffix = randomUUID().slice(0, 8);

    // The agent binds HTTP servers from the workspace catalog, so they go there first.
    for (const server of ['meddra', 'email']) {
      await post(request, `/api/admin/tool-catalog?namespace=${TEST_ORG_HANDLE}`, {
        id: `${server}-${suffix}`, type: 'http', url: `https://mcp.example.com/${server}`,
      }, 201);
    }

    const agentRes = await request.post('/api/agents', {
      headers: JSON_HEADERS,
      data: {
        name: `AE coder ${suffix}`,
        iconName: 'Bot',
        description: 'Codes adverse events to MedDRA',
        foundationModel: 'anthropic/claude-sonnet-4',
        systemPrompt: 'You code adverse events to MedDRA preferred terms.',
        inputDescription: 'Extracted AEs',
        outputDescription: 'Coded AEs',
        namespace: TEST_ORG_HANDLE,
        mcpServers: {
          meddra: { type: 'http', catalogId: `meddra-${suffix}` },
          email: { type: 'http', catalogId: `email-${suffix}` },
        },
      },
    });
    expect(agentRes.status(), await agentRes.text()).toBe(201);
    const { agent } = (await agentRes.json()) as { agent: { id: string } };

    const workflowName = `e2e-mcp-replay-${suffix}`;
    const runId = await startRun(request, agentStepWorkflow(workflowName, {
      autonomyLevel: 'L4',
      agentId: agent.id,
      agent: { prompt: 'Code each AE.' },
    }));
    const production = await awaitFinishedAgentRun(request, runId);
    const step = { namespace: TEST_ORG_HANDLE, workflowName, stepId: 'grade-aes' };

    await post(request, '/api/evaluation/evaluators', {
      ...step, name: 'summary-present', rule: 'The result carries a summary.',
      check: { kind: 'schema', schema: { required: ['summary'] } },
    }, 201);
    const { evalCase } = EvalCaseOutputSchema.parse(await post(request, '/api/evaluation/cases/from-agent-run', {
      agentRunId: production.id, expectation: 'positive',
    }, 201));
    await post(request, '/api/evaluation/datasets', step, 201);
    const policyRes = await request.put('/api/evaluation/mcp-policy', {
      headers: JSON_HEADERS, data: { ...step, servers: { email: { mode: 'deny' }, meddra: { mode: 'replay' } } },
    });
    expect(policyRes.status(), await policyRes.text()).toBe(200);
    expect(await recordedCaseIds(request, step)).toEqual([]);

    // No live trial of the case recorded `meddra`: the trial runs it live to record it.
    const unrecorded = await runToEnd(request, step);
    expect(unrecorded.evalRun.mcpPolicy).toEqual({ email: { mode: 'deny' }, meddra: { mode: 'replay' } });
    expect(unrecorded.trials[0]).toMatchObject({ status: 'scored' });

    // What that trial's recording proxy leaves behind.
    const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
    try {
      await sql`INSERT INTO eval_mcp_recordings ${sql([{
        id: randomUUID(), workspace: TEST_ORG_HANDLE, workflow_name: workflowName, step_id: 'grade-aes', case_id: evalCase.id,
        server: 'meddra', eval_run_id: unrecorded.evalRun.id, trial_id: unrecorded.trials[0]!.id,
        tape: sql.json({
          tools: [{ name: 'lookup_term', inputSchema: { type: 'object' } }],
          calls: [{ tool: 'lookup_term', arguments: { term: 'Sepsis' }, result: { content: [{ type: 'text', text: '10040047' }] } }],
        }),
      }])}`;
    } finally {
      await sql.end();
    }
    expect(await recordedCaseIds(request, step)).toEqual([evalCase.id]);
    const recordingRunRes = await request.get(`/api/evaluation/runs/${unrecorded.evalRun.id}`, { headers: AUTH_HEADERS });
    const recordingRun = EvalRunOutputSchema.parse(await recordingRunRes.json());
    expect(recordingRun.report.mcp.recordedFirst).toEqual([{ server: 'meddra', cases: 1 }]);
    expect(describeMcpReport(recordingRun.report.mcp)).not.toContain('No trial made a live MCP call.');

    const replayed = await runToEnd(request, step);
    const [trial] = replayed.trials;
    expect(trial).toMatchObject({ status: 'scored', mcpReplayMisses: [] });
    const trajectoryRes = await request.get(`/api/agent-runs/${trial!.agentRunId}/trajectory`, { headers: AUTH_HEADERS });
    const [first] = GetAgentTrajectoryOutputSchema.parse(await trajectoryRes.json()).entries;
    // The replayed server is kept for the agent; the denied `email` is not.
    expect(first?.text).toContain('with MCP servers: meddra.');
    expect(replayed.report.mcp).toEqual({ live: [], replayed: ['meddra'], denied: ['email'], recordedFirst: [], unrecordedCalls: [] });
    expect(describeMcpReport(replayed.report.mcp)).toContain('No trial made a live MCP call.');
  });
});
