import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import type { APIRequestContext } from '@playwright/test';
import {
  AskEvaluationAssistantOutputSchema,
  EvalRunOutputSchema,
  EvaluationAssistantProgressSchema,
  EvaluatorOutputSchema,
  ListEvaluatorsOutputSchema,
} from '@mediforce/platform-api/contract';
import { test, expect } from '../helpers/test-fixtures';
import { AUTH_HEADERS, JSON_HEADERS, agentStepWorkflow, awaitFinishedAgentRun, startRun } from '../helpers/agent-step-runs';
import { EVALUATION_WORKSPACE, seedEvaluationWorkspace } from '../helpers/evaluation-workspace';
import { openRouterRequests, scriptOpenRouter } from '../helpers/mock-openrouter-server';

/**
 * API E2E for the Evaluation Assistant (ADR-0023 D14, D15): it previews a check
 * on a real production output before proposing it; the proposal creates
 * nothing until the person accepts it; and it can prepare an Eval Run but its
 * own attempt to start one is refused — the start needs the person's
 * confirmation of the budget.
 *
 * The model is the scripted mock OpenRouter; the production run is MOCK_AGENT
 * (result `{ mock, summary }`, so a `required: ['findings']` check fails on it).
 */

async function ask(request: APIRequestContext, step: Record<string, string>, question: string) {
  const res = await request.post('/api/evaluation/assistant', {
    headers: JSON_HEADERS,
    data: { ...step, messages: [{ role: 'user', content: question }] },
  });
  expect(res.status(), await res.text()).toBe(200);
  return AskEvaluationAssistantOutputSchema.parse(await res.json());
}

function lastToolResult(messages: Array<{ role: string; content: string }>): Record<string, unknown> {
  const tool = [...messages].reverse().find((message) => message.role === 'tool');
  return JSON.parse(tool!.content) as Record<string, unknown>;
}

test.describe('Evaluation Assistant — API E2E', () => {
  test.describe.configure({ mode: 'serial' });

  let step: { namespace: string; workflowName: string; stepId: string };
  let agentRunId: string;
  const check = { kind: 'schema', schema: { required: ['findings'] } };

  test.beforeAll(async ({ request }) => {
    await seedEvaluationWorkspace();
    const workflowName = `e2e-eval-assistant-${randomUUID().slice(0, 8)}`;
    const runId = await startRun(request, agentStepWorkflow(workflowName, { autonomyLevel: 'L4', agent: { prompt: 'Grade each AE.' } }), {}, EVALUATION_WORKSPACE);
    agentRunId = (await awaitFinishedAgentRun(request, runId)).id;
    step = { namespace: EVALUATION_WORKSPACE, workflowName, stepId: 'grade-aes' };
  });

  test('previews a check on a real output, proposes it, and accepting it creates the Evaluator', async ({ request }) => {
    const question = `What should I check first? ${randomUUID()}`;
    await scriptOpenRouter(question, [
      { toolCalls: [{ name: 'preview_evaluator', arguments: { check } }] },
      { toolCalls: [{ name: 'propose_evaluator', arguments: { name: 'findings-present', rule: 'The result lists findings.', severity: 'critical', check } }] },
      { content: 'The recent run has no findings key; I proposed a schema check for it.' },
    ]);

    const answer = await ask(request, step, question);
    expect(answer.reply).toBe('The recent run has no findings key; I proposed a schema check for it.');
    expect(answer.proposals).toEqual([{
      tool: 'propose_evaluator',
      arguments: { name: 'findings-present', rule: 'The result lists findings.', severity: 'critical', check },
    }]);

    // The preview ran on the production output before the proposal.
    const requests = await openRouterRequests(question);
    expect(lastToolResult(requests[1]!.messages)).toEqual({
      results: [{ agentRunId, passed: false, value: 0, label: 'fail', comment: 'missing required keys: findings', error: null }],
    });

    // A proposal is not an Evaluator.
    const listUrl = `/api/evaluation/evaluators?namespace=${step.namespace}&workflowName=${step.workflowName}&stepId=${step.stepId}`;
    expect(ListEvaluatorsOutputSchema.parse(await (await request.get(listUrl, { headers: AUTH_HEADERS })).json()).evaluators).toEqual([]);

    // Accepting it is the ordinary create, marked as the assistant's.
    const accepted = await request.post('/api/evaluation/evaluators', {
      headers: JSON_HEADERS,
      data: { ...step, ...answer.proposals[0]!.arguments, origin: 'assistant' },
    });
    expect(accepted.status(), await accepted.text()).toBe(201);
    expect(EvaluatorOutputSchema.parse(await accepted.json()).evaluator).toMatchObject({
      name: 'findings-present', latest: { origin: 'assistant' }, trust: { trusted: true },
    });
  });

  test('streams each round and tool call before the result when asked for NDJSON', async ({ request }) => {
    const question = `Show your work. ${randomUUID()}`;
    await scriptOpenRouter(question, [
      { toolCalls: [{ name: 'get_step', arguments: {} }] },
      { toolCalls: [{ name: 'preview_evaluator', arguments: { check: 'schema check for findings' } }] },
      { content: 'Read the step.' },
    ]);

    const res = await request.post('/api/evaluation/assistant', {
      headers: { ...JSON_HEADERS, Accept: 'application/x-ndjson' },
      data: { ...step, messages: [{ role: 'user', content: question }] },
    });
    expect(res.status(), await res.text()).toBe(200);
    expect(res.headers()['content-type']).toContain('application/x-ndjson');
    const lines = (await res.text()).trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);

    const progress = lines.slice(0, -1).map((line) => EvaluationAssistantProgressSchema.parse(line.progress));
    expect(progress.map((event) => event.type === 'tool' ? `${event.tool}:${event.status}` : `thinking:${event.round}`)).toEqual([
      'thinking:1', 'get_step:running', 'get_step:done',
      'thinking:2', 'preview_evaluator:running', 'preview_evaluator:failed',
      'thinking:3',
    ]);
    expect(progress[5]).toMatchObject({ error: 'check: Invalid input: expected object, received string' });
    expect(AskEvaluationAssistantOutputSchema.parse(lines.at(-1)!.result).reply).toBe('Read the step.');
  });

  test('prepares an Eval Run for the person to confirm; its own start_eval_run call is refused', async ({ request }) => {
    const caseRes = await request.post('/api/evaluation/cases/from-agent-run', { headers: JSON_HEADERS, data: { agentRunId, expectation: 'positive' } });
    expect(caseRes.status(), await caseRes.text()).toBe(201);
    const datasetRes = await request.post('/api/evaluation/datasets', { headers: JSON_HEADERS, data: step });
    expect(datasetRes.status(), await datasetRes.text()).toBe(201);

    const question = `Run the evaluation. ${randomUUID()}`;
    await scriptOpenRouter(question, [
      { toolCalls: [{ name: 'prepare_eval_run', arguments: { trialsPerCase: 1, budgetUsd: 1 } }] },
      { toolCalls: [{ name: 'start_eval_run', arguments: { evalRunId: '$tool:prepared.evalRunId' } }] },
      { content: 'I prepared a run of 1 trial with a $1 budget. Confirm it to start.' },
    ]);

    const answer = await ask(request, step, question);
    expect(answer.preparedEvalRuns).toEqual([{ evalRunId: expect.any(String), budgetUsd: 1, estimatedUsd: null, trials: 1 }]);

    const requests = await openRouterRequests(question);
    expect(String(lastToolResult(requests[2]!.messages).error)).toContain('a person must confirm that budget');

    const runRes = await request.get(`/api/evaluation/runs/${answer.preparedEvalRuns[0]!.evalRunId}`, { headers: AUTH_HEADERS });
    expect(EvalRunOutputSchema.parse(await runRes.json()).evalRun.status).toBe('prepared');
  });

  test('reads complete generated source beyond the first 150 trajectory entries', async ({ request }) => {
    const source = `${'# generated source\n'.repeat(100)}cards::ard_categorical(adsl, variables = ARM)`;
    const entries = Array.from({ length: 203 }, (_, index) => ({
      agent_run_id: agentRunId,
      seq: 1000 + index,
      entry: index === 202
        ? { ts: new Date().toISOString(), type: 'assistant', subtype: 'tool_call', tool: 'Write', input: { file_path: '/workspace/code/driver.R', content: source } }
        : { ts: new Date().toISOString(), type: 'system', subtype: 'thinking_tokens' },
    }));
    const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
    try {
      await sql`INSERT INTO agent_trajectory_entries ${sql(entries, 'agent_run_id', 'seq', 'entry')}`;
    } finally {
      await sql.end();
    }
    const question = `Inspect all generated code. ${randomUUID()}`;
    await scriptOpenRouter(question, [
      { toolCalls: [{ name: 'get_trajectory', arguments: { agentRunId, offset: 0, limit: 150 } }] },
      { toolCalls: [{ name: 'get_trajectory', arguments: { agentRunId, offset: '$tool:nextOffset', limit: 150 } }] },
      { content: 'The driver calls cards::ard_categorical.' },
    ]);

    expect((await ask(request, step, question)).reply).toContain('cards::ard_categorical');
    const requests = await openRouterRequests(question);
    expect(lastToolResult(requests[1]!.messages)).toMatchObject({ nextOffset: 150 });
    expect(lastToolResult(requests[2]!.messages)).toMatchObject({
      nextOffset: null,
      entries: expect.arrayContaining([expect.objectContaining({
        seq: 1202, input: { file_path: '/workspace/code/driver.R', content: source },
      })]),
    });
  });

  test('returns the final proposal and a continuation summary when the tool budget is exhausted', async ({ request }) => {
    const question = `Prepare two checks. ${randomUUID()}`;
    const proposal = { name: 'partial-check', rule: 'The result lists findings.', severity: 'critical', check };
    await scriptOpenRouter(question, [
      ...Array.from({ length: 31 }, () => ({ toolCalls: [{ name: 'list_evaluators', arguments: {} }] })),
      { toolCalls: [{ name: 'propose_evaluator', arguments: proposal }] },
      { content: 'One check is proposed. Package usage still needs investigation.' },
    ]);

    const answer = await ask(request, step, question);
    expect(answer.proposals).toEqual([{ tool: 'propose_evaluator', arguments: proposal }]);
    expect(answer.reply).toContain('32-round tool-use limit');
    expect(answer.reply).toContain('Package usage still needs investigation.');
    const requests = await openRouterRequests(question);
    expect(requests).toHaveLength(33);
    expect(requests[32]).not.toHaveProperty('tools');
    const listUrl = `/api/evaluation/evaluators?namespace=${step.namespace}&workflowName=${step.workflowName}&stepId=${step.stepId}`;
    const evaluators = ListEvaluatorsOutputSchema.parse(await (await request.get(listUrl, { headers: AUTH_HEADERS })).json()).evaluators;
    expect(evaluators.some((evaluator) => evaluator.name === 'partial-check')).toBe(false);
  });

  test('returns actionable validation feedback and previews the corrected object', async ({ request }) => {
    const question = `Recover from a string check. ${randomUUID()}`;
    await scriptOpenRouter(question, [
      { toolCalls: [{ name: 'preview_evaluator', arguments: { check: JSON.stringify(check), agentRunIds: [agentRunId] } }] },
      { toolCalls: [{ name: 'preview_evaluator', arguments: { check, agentRunIds: [agentRunId] } }] },
      { content: 'The corrected check ran; the result is missing findings.' },
    ]);
    expect((await ask(request, step, question)).reply).toContain('corrected check ran');
    const requests = await openRouterRequests(question);
    expect(lastToolResult(requests[1]!.messages)).toMatchObject({
      validationError: 'check: Invalid input: expected object, received string',
      expectedArguments: { properties: { check: {
        description: expect.stringContaining('not a string'),
        examples: expect.arrayContaining([expect.objectContaining({ kind: 'code' })]),
      } } },
    });
    expect(lastToolResult(requests[2]!.messages)).toMatchObject({
      results: [{ agentRunId, passed: false, error: null }],
    });
  });

  test('stops repeated string-check failures before the round cap and keeps completed cards', async ({ request }) => {
    const question = `Stop the invalid-check retry loop. ${randomUUID()}`;
    const proposal = { name: 'keep-check', rule: 'The result lists findings.', severity: 'critical', check };
    await scriptOpenRouter(question, [
      { toolCalls: [{ name: 'preview_evaluator', arguments: { check, agentRunIds: [agentRunId] } }] },
      { toolCalls: [{ name: 'propose_evaluator', arguments: proposal }] },
      ...Array.from({ length: 3 }, (_, index) => ({
        toolCalls: [{ name: 'preview_evaluator', arguments: { check: `rewritten script ${index}`, agentRunIds: [agentRunId] } }],
      })),
      { content: 'The additional check could not be previewed because its arguments were invalid.' },
    ]);
    const answer = await ask(request, step, question);
    expect(answer.reply).toContain('3 consecutive rounds');
    expect(answer.reply).toContain('preview_evaluator');
    expect(answer.reply).toContain('expected object, received string');
    expect(answer.reply).not.toContain('tool-use limit');
    expect(answer.proposals).toEqual([{ tool: 'propose_evaluator', arguments: proposal }]);
    const requests = await openRouterRequests(question);
    expect(requests).toHaveLength(6);
    expect(requests[5]).not.toHaveProperty('tools');
  });
});
