import { randomUUID } from 'node:crypto';
import type { APIRequestContext } from '@playwright/test';
import { AskEvaluationAssistantOutputSchema, EvalCaseOutputSchema } from '@mediforce/platform-api/contract';
import { test, expect } from '../helpers/test-fixtures';
import { JSON_HEADERS, agentStepWorkflow, awaitFinishedAgentRun, startRun } from '../helpers/agent-step-runs';
import { EVALUATION_WORKSPACE, seedEvaluationWorkspace } from '../helpers/evaluation-workspace';
import { openRouterRequests, scriptOpenRouter } from '../helpers/mock-openrouter-server';

/**
 * API E2E for an Agent's Evaluation Assistant (ADR-0029): the shared assistant
 * is offered the Agent's own toolset — the Agent instead of a Step, and the
 * production runs of the Steps that use it in place of a Step's own — and
 * proposes a written case from what one of those runs was given.
 *
 * The model is the scripted mock OpenRouter; the production run is MOCK_AGENT.
 */

async function ask(request: APIRequestContext, subject: Record<string, string>, question: string) {
  const res = await request.post('/api/evaluation/assistant', {
    headers: JSON_HEADERS,
    data: { ...subject, messages: [{ role: 'user', content: question }] },
  });
  expect(res.status(), await res.text()).toBe(200);
  return AskEvaluationAssistantOutputSchema.parse(await res.json());
}

function toolResult(messages: Array<{ role: string; content: string }>): Record<string, unknown> {
  const tool = [...messages].reverse().find((message) => message.role === 'tool');
  return JSON.parse(tool!.content) as Record<string, unknown>;
}

test.describe('Agent Evaluation Assistant — API E2E', () => {
  test.describe.configure({ mode: 'serial' });

  let subject: { namespace: string; agentId: string };
  let workflowName: string;
  let productionRunId: string;
  let unrelatedRunId: string;
  const triggerPayload = { studyId: 'CDISCPILOT01' };
  const triggerInput = [{ name: 'studyId', type: 'string', required: false }];

  test.beforeAll(async ({ request }) => {
    test.setTimeout(120_000);
    await seedEvaluationWorkspace();
    const suffix = randomUUID().slice(0, 8);
    const agentRes = await request.post('/api/agents', {
      headers: JSON_HEADERS,
      data: {
        name: `AE grader ${suffix}`,
        iconName: 'Bot',
        description: 'Grades adverse events',
        runtimeId: 'claude-code-agent',
        foundationModel: 'anthropic/claude-sonnet-4',
        systemPrompt: 'You grade adverse events by CTCAE v5.',
        inputDescription: 'Extracted AEs',
        outputDescription: 'Graded AEs',
        namespace: EVALUATION_WORKSPACE,
      },
    });
    expect(agentRes.status(), await agentRes.text()).toBe(201);
    const { agent } = (await agentRes.json()) as { agent: { id: string } };
    subject = { namespace: EVALUATION_WORKSPACE, agentId: agent.id };

    workflowName = `e2e-agent-assistant-${suffix}`;
    const workflow = { ...agentStepWorkflow(workflowName, { autonomyLevel: 'L4', agentId: agent.id, agent: { prompt: 'Grade each AE.' } }), triggerInput };
    const unrelated = { ...agentStepWorkflow(`e2e-agent-assistant-other-${suffix}`, { autonomyLevel: 'L4', agent: { prompt: 'Grade each AE.' } }), triggerInput };
    const [production, other] = await Promise.all([
      startRun(request, workflow, triggerPayload, EVALUATION_WORKSPACE).then((runId) => awaitFinishedAgentRun(request, runId)),
      startRun(request, unrelated, triggerPayload, EVALUATION_WORKSPACE).then((runId) => awaitFinishedAgentRun(request, runId)),
    ]);
    productionRunId = production.id;
    unrelatedRunId = other.id;
  });

  test('is offered the Agent\'s toolset, and reads the Agent instead of a Step', async ({ request }) => {
    const question = `What does this agent do? ${randomUUID()}`;
    await scriptOpenRouter(question, [
      { toolCalls: [{ name: 'get_agent', arguments: {} }] },
      { toolCalls: [{ name: 'get_step', arguments: {} }] },
      { content: 'It grades adverse events.' },
    ]);

    expect((await ask(request, subject, question)).reply).toBe('It grades adverse events.');
    const requests = await openRouterRequests(question);
    const offered = (requests[0]!.tools ?? []).map((tool) => tool.function.name);
    expect(offered).toEqual(expect.arrayContaining(['get_agent', 'list_agent_production_runs', 'get_agent_run', 'list_evaluators', 'propose_eval_case']));
    for (const stepTool of ['get_step', 'list_step_runs', 'preview_evaluator', 'propose_perturbed_case', 'propose_control_settings']) {
      expect(offered).not.toContain(stepTool);
    }
    expect(toolResult(requests[1]!.messages)).toMatchObject({
      agent: { systemPrompt: 'You grade adverse events by CTCAE v5.', inputDescription: 'Extracted AEs', foundationModel: 'anthropic/claude-sonnet-4' },
    });
    expect(String(toolResult(requests[2]!.messages).error)).toContain("Unknown tool 'get_step'");
  });

  test('finds the production runs of the Steps that use the Agent, and reads one of them', async ({ request }) => {
    const question = `Where is this agent used? ${randomUUID()}`;
    await scriptOpenRouter(question, [
      { toolCalls: [{ name: 'list_agent_production_runs', arguments: {} }] },
      { toolCalls: [{ name: 'get_agent_run', arguments: { agentRunId: productionRunId } }] },
      { toolCalls: [{ name: 'get_agent_run', arguments: { agentRunId: unrelatedRunId } }] },
      { content: 'One workflow uses it.' },
    ]);

    await ask(request, subject, question);
    const requests = await openRouterRequests(question);
    expect(toolResult(requests[1]!.messages)).toMatchObject({
      steps: [{ workflowName, stepId: 'grade-aes', stepAgentConfig: { prompt: 'Grade each AE.' } }],
      runs: [{ agentRunId: productionRunId, workflowName, stepId: 'grade-aes', triggerPayload }],
    });
    expect(toolResult(requests[2]!.messages)).toMatchObject({ agentRunId: productionRunId, triggerPayload });
    expect(String(toolResult(requests[3]!.messages).error)).toContain('neither an eval trial of this agent nor a production run of a step that uses it');
  });

  test('proposes a written case from a production run; accepting it flags its production data', async ({ request }) => {
    const question = `Add a case like production. ${randomUUID()}`;
    const proposed = { name: 'Grade 4 neutropenia from production', input: { triggerPayload, previousStepOutputs: {} }, containsProductionData: true };
    await scriptOpenRouter(question, [
      { toolCalls: [{ name: 'propose_eval_case', arguments: { name: 'Harvested', agentRunId: productionRunId } }] },
      { toolCalls: [{ name: 'propose_eval_case', arguments: { ...proposed, input: { triggerPayload, previousStepOutputs: { 'extract-aes': {} } } } }] },
      { toolCalls: [{ name: 'propose_eval_case', arguments: proposed }] },
      { content: 'I proposed a case from the production run.' },
    ]);

    const answer = await ask(request, subject, question);
    const requests = await openRouterRequests(question);
    expect(String(toolResult(requests[1]!.messages).error)).toContain('write its input');
    expect(String(toolResult(requests[2]!.messages).error)).toContain('trigger payload alone');
    expect(answer.proposals).toEqual([{ tool: 'propose_eval_case', arguments: proposed }]);

    const accepted = await request.post('/api/evaluation/cases', {
      headers: JSON_HEADERS,
      data: { ...subject, ...answer.proposals[0]!.arguments, origin: 'assistant' },
    });
    expect(accepted.status(), await accepted.text()).toBe(201);
    expect(EvalCaseOutputSchema.parse(await accepted.json()).evalCase).toMatchObject({
      agentId: subject.agentId, source: 'manual', containsProductionData: true, input: { triggerPayload },
    });
  });
});
