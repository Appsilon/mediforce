import { randomUUID } from 'node:crypto';
import type { APIRequestContext } from '@playwright/test';
import {
  EvalCaseOutputSchema,
  EvalRunOutputSchema,
  GetAgentTrajectoryOutputSchema,
  ListAgentRunsOutputSchema,
  ListRunsPageOutputSchema,
  ListScoresOutputSchema,
  type EvalRunOutput,
} from '@mediforce/platform-api/contract';
import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { pollUntil } from '../helpers/poll-until';
import { AUTH_HEADERS, JSON_HEADERS, agentStepWorkflow, awaitFinishedAgentRun, startRun } from '../helpers/agent-step-runs';

/**
 * API E2E for Eval Runs (ADR-0023 D4, D6, D10, Step Evaluation 1b): Evaluators
 * and an Eval Dataset built from a production run, an Eval Run started only on
 * a confirmed budget, its trials run as real single-step Workflow Runs with
 * the default-deny MCP eval policy applied, and a report whose numbers are the
 * Scores those trials received. Trials stay out of run lists and the Agents
 * history.
 *
 * MOCK_AGENT=true: the mock agent's result is `{ mock, summary }`, and its
 * first trajectory entry names the MCP servers the step ran with.
 */

async function post(request: APIRequestContext, path: string, data: Record<string, unknown>, status = 200) {
  const res = await request.post(path, { headers: JSON_HEADERS, data });
  expect(res.status(), await res.text()).toBe(status);
  return res.json();
}

async function trajectoryText(request: APIRequestContext, agentRunId: string): Promise<string> {
  const res = await request.get(`/api/agent-runs/${agentRunId}/trajectory`, { headers: AUTH_HEADERS });
  expect(res.status(), await res.text()).toBe(200);
  return GetAgentTrajectoryOutputSchema.parse(await res.json()).entries[0]?.text ?? '';
}

test.describe('Step Evaluation Eval Runs — API E2E', () => {
  test('an Eval Run from a production run: trials under the MCP policy, a report that matches the Scores', async ({ request }) => {
    test.setTimeout(120_000);
    const suffix = randomUUID().slice(0, 8);

    // An agent bound to two MCP servers; only `meddra` will be declared safe for trials.
    const agentRes = await request.post('/api/agents', {
      headers: JSON_HEADERS,
      data: {
        name: `AE grader ${suffix}`,
        iconName: 'Bot',
        description: 'Grades adverse events',
        foundationModel: 'anthropic/claude-sonnet-4',
        systemPrompt: 'You grade adverse events by CTCAE v5.',
        inputDescription: 'Extracted AEs',
        outputDescription: 'Graded AEs',
        namespace: TEST_ORG_HANDLE,
        mcpServers: {
          meddra: { type: 'http', url: 'https://mcp.example.com/meddra' },
          email: { type: 'http', url: 'https://mcp.example.com/email' },
        },
      },
    });
    expect(agentRes.status(), await agentRes.text()).toBe(201);
    const { agent } = (await agentRes.json()) as { agent: { id: string } };

    const workflowName = `e2e-eval-runs-${suffix}`;
    const runId = await startRun(request, agentStepWorkflow(workflowName, {
      autonomyLevel: 'L4',
      agentId: agent.id,
      agent: { prompt: 'Grade each AE.' },
    }));
    const production = await awaitFinishedAgentRun(request, runId);
    expect(await trajectoryText(request, production.id)).toContain('MCP servers: email, meddra');
    const step = { namespace: TEST_ORG_HANDLE, workflowName, stepId: 'grade-aes' };

    await post(request, '/api/evaluation/evaluators', {
      ...step, name: 'summary-present', rule: 'The result carries a summary.', severity: 'critical',
      check: { kind: 'schema', schema: { required: ['summary'] } },
    }, 201);
    await post(request, '/api/evaluation/evaluators', {
      ...step, name: 'findings-present', rule: 'The result lists findings.', severity: 'major',
      check: { kind: 'schema', schema: { required: ['findings'] } },
    }, 201);
    await post(request, '/api/evaluation/cases/from-agent-run', { agentRunId: production.id, expectation: 'positive' }, 201);
    await post(request, '/api/evaluation/datasets', step, 201);
    const policyRes = await request.put('/api/evaluation/mcp-policy', {
      headers: JSON_HEADERS, data: { ...step, servers: { meddra: { mode: 'live' } } },
    });
    expect(policyRes.status(), await policyRes.text()).toBe(200);

    const prepared = EvalRunOutputSchema.parse(await post(request, '/api/evaluation/runs', {
      ...step, trialsPerCase: 2, concurrency: 2, budgetUsd: 1,
    }, 201));
    expect(prepared.evalRun).toMatchObject({ status: 'prepared', budgetUsd: 1 });
    expect(prepared.evalRun.mcpPolicy).toEqual({ email: { mode: 'deny' }, meddra: { mode: 'live' } });

    // A start without the person's confirmation of the budget is refused.
    const unconfirmed = await request.post(`/api/evaluation/runs/${prepared.evalRun.id}/start`, { headers: JSON_HEADERS, data: {} });
    expect(unconfirmed.status(), await unconfirmed.text()).toBe(400);
    await post(request, `/api/evaluation/runs/${prepared.evalRun.id}/start`, { confirmedBudgetUsd: 1 });

    const finished: EvalRunOutput = await pollUntil(
      async () => {
        const res = await request.get(`/api/evaluation/runs/${prepared.evalRun.id}`, { headers: AUTH_HEADERS });
        const body = EvalRunOutputSchema.parse(await res.json());
        return body.evalRun.status === 'completed' ? body : null;
      },
      { description: `Eval Run ${prepared.evalRun.id} to complete`, timeoutMs: 90_000 },
    );

    expect(finished.trials).toHaveLength(2);
    for (const trial of finished.trials) {
      expect(trial.status).toBe('scored');
      // A real single-step run at the target step, flagged with its Eval Run.
      const instanceRes = await request.get(`/api/processes/${trial.processInstanceId}`, { headers: AUTH_HEADERS });
      expect(instanceRes.status()).toBe(200);
      expect(await instanceRes.json()).toMatchObject({ evalRunId: prepared.evalRun.id, status: 'completed' });
      // The undeclared `email` server was denied; `meddra` ran live.
      expect(await trajectoryText(request, trial.agentRunId!)).toContain('with MCP servers: meddra.');
    }

    // The report is the Scores.
    const trialScores = await Promise.all(finished.trials.map(async (trial) => {
      const res = await request.get(`/api/scores?runId=${trial.processInstanceId}&stepId=grade-aes`, { headers: AUTH_HEADERS });
      return ListScoresOutputSchema.parse(await res.json()).scores;
    }));
    const [champion] = finished.report.variants;
    for (const evaluator of champion!.evaluators) {
      const scores = trialScores.flat().filter((score) => score.evaluatorId === evaluator.evaluatorId);
      expect(evaluator.passes).toBe(scores.filter((score) => score.value >= 0.5).length);
      expect(evaluator.failures).toBe(scores.filter((score) => score.value < 0.5).length);
    }
    const byName = Object.fromEntries(champion!.evaluators.map((evaluator) => [evaluator.name, evaluator]));
    expect(byName['summary-present']).toMatchObject({ passes: 2, failures: 0, passRate: 1, passAtK: 1, passHatK: 1, flakiness: 0 });
    expect(byName['findings-present']).toMatchObject({ passes: 0, failures: 2, passRate: 0, passAtK: 0, passHatK: 0 });
    expect(byName['summary-present']!.wilsonLower).toBeCloseTo(0.3424, 3);

    // Trials stay out of the run list and the Agents history.
    const runsRes = await request.get(`/api/runs/page?namespace=${TEST_ORG_HANDLE}&workflow=${workflowName}&limit=50`, { headers: AUTH_HEADERS });
    const listed = ListRunsPageOutputSchema.parse(await runsRes.json()).runs.map((run) => run.id);
    expect(listed).toEqual([runId]);
    const agentRunsRes = await request.get(`/api/agent-runs?runId=${finished.trials[0]!.processInstanceId}`, { headers: AUTH_HEADERS });
    expect(ListAgentRunsOutputSchema.parse(await agentRunsRes.json()).runs).toEqual([]);
  });

  test('a challenger\'s few-shot examples leave their case out of the run; holdout cases are never examples (D12)', async ({ request }) => {
    const workflowName = `e2e-eval-examples-${randomUUID().slice(0, 8)}`;
    await post(request, `/api/workflow-definitions?namespace=${TEST_ORG_HANDLE}`, agentStepWorkflow(workflowName, {
      autonomyLevel: 'L4', agent: { prompt: 'Grade each AE.' },
    }), 201);
    const step = { namespace: TEST_ORG_HANDLE, workflowName, stepId: 'grade-aes' };

    await post(request, '/api/evaluation/evaluators', {
      ...step, name: 'summary-present', rule: 'The result carries a summary.', severity: 'critical',
      check: { kind: 'schema', schema: { required: ['summary'] } },
    }, 201);
    const addCase = async (name: string, split: 'dev' | 'holdout'): Promise<string> => {
      const created = EvalCaseOutputSchema.parse(await post(request, '/api/evaluation/cases', {
        ...step, name, split, expectation: 'positive',
        input: { triggerPayload: { studyId: 'CDISCPILOT01' }, previousStepOutputs: { 'extract-aes': { events: [{ term: name }] } } },
      }, 201));
      return created.evalCase.id;
    };
    const sepsis = await addCase('Grade 5 sepsis', 'dev');
    const neutropenia = await addCase('Grade 4 neutropenia', 'dev');
    const rash = await addCase('Grade 3 rash', 'holdout');
    await post(request, '/api/evaluation/datasets', step, 201);

    const prepared = EvalRunOutputSchema.parse(await post(request, '/api/evaluation/runs', {
      ...step, trialsPerCase: 1, concurrency: 1, budgetUsd: 1,
      challengers: [{ label: 'Few-shot', patch: { examples: [{ input: 'Sepsis, fatal', output: '{"grade": 5}', caseId: sepsis }] } }],
    }, 201));
    expect(prepared.evalRun.exampleCaseIds).toEqual([sepsis]);
    expect(new Set(prepared.evalRun.caseIds)).toEqual(new Set([neutropenia, rash]));
    expect(prepared.trials.some((trial) => trial.caseId === sepsis)).toBe(false);

    const leaky = await request.post('/api/evaluation/runs', {
      headers: JSON_HEADERS,
      data: {
        ...step, budgetUsd: 1,
        challengers: [{ label: 'Leaky', patch: { examples: [{ input: 'Rash', output: '{"grade": 3}', caseId: rash }] } }],
      },
    });
    expect(leaky.status(), await leaky.text()).toBe(400);
    expect(await leaky.text()).toContain('holdout cases are never offered as examples');
  });
});
