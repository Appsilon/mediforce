import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { WorkflowEngine } from '@mediforce/workflow-engine';
import type { CallerScope } from '../../../repositories/index';
import { createEvaluator } from '../../evaluation/evaluators';
import { createEvalCaseFromAgentRun } from '../../evaluation/eval-cases';
import { freezeEvalDataset } from '../../evaluation/eval-datasets';
import { setEvaluationBrief } from '../../evaluation/briefs';
import { askEvaluationAssistant } from '../ask-evaluation-assistant';
import { evaluationFixture, GRADED_RUN, STEP, UNGRADED_RUN, type EvaluationFixture } from '../../evaluation/__tests__/fixture';

type Request = { messages: Array<{ role: string; content: string }> };
type Turn = (request: Request) => { content?: string; toolCalls?: Array<{ name: string; arguments: unknown }> };

function scriptOpenRouter(turns: Turn[]): Request[] {
  const requests: Request[] = [];
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
    const request = JSON.parse(String(init.body)) as Request;
    requests.push(request);
    const next: Turn = turns.shift() ?? (() => ({ content: 'done' }));
    const turn = next(request);
    return new Response(JSON.stringify({
      choices: [{
        message: {
          content: turn.content ?? '',
          tool_calls: (turn.toolCalls ?? []).map((call, index) => ({
            id: `call-${requests.length}-${index}`, type: 'function',
            function: { name: call.name, arguments: JSON.stringify(call.arguments) },
          })),
        },
        finish_reason: 'stop',
      }],
    }));
  }));
  return requests;
}

function lastToolResult(request: Request): Record<string, unknown> {
  const tool = [...request.messages].reverse().find((message) => message.role === 'tool');
  return JSON.parse(tool!.content) as Record<string, unknown>;
}

describe('askEvaluationAssistant', () => {
  let fixture: EvaluationFixture;
  let scope: CallerScope;

  beforeEach(async () => {
    fixture = await evaluationFixture();
    scope = fixture.scope();
    Object.assign(scope, { workspaceSecrets: { getSecrets: async () => ({ OPENROUTER_API_KEY: 'sk-test' }) } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('previews a check on real outputs, then proposes it — creating nothing', async () => {
    await setEvaluationBrief({ ...STEP, text: 'A missed grade 5 is critical.', origin: 'user' }, scope);
    const check = { kind: 'schema', schema: { required: ['findings'] } };
    const requests = scriptOpenRouter([
      () => ({ toolCalls: [{ name: 'preview_evaluator', arguments: { check } }] }),
      () => ({ toolCalls: [{ name: 'propose_evaluator', arguments: { name: 'findings-present', rule: 'The result lists findings.', severity: 'critical', check } }] }),
      () => ({ content: 'One of two recent runs had no findings; I proposed a schema check.' }),
    ]);

    const result = await askEvaluationAssistant({ ...STEP, messages: [{ role: 'user', content: 'What should I check first?' }] }, scope);

    expect(result).toEqual({
      reply: 'One of two recent runs had no findings; I proposed a schema check.',
      proposals: [{ tool: 'propose_evaluator', arguments: { name: 'findings-present', rule: 'The result lists findings.', severity: 'critical', check } }],
      preparedEvalRuns: [],
    });
    expect(requests[0]!.messages.some((message) => message.content.includes('A missed grade 5 is critical.'))).toBe(true);
    const preview = lastToolResult(requests[1]!) as { results: Array<{ agentRunId: string; passed: boolean }> };
    expect(preview.results.map((outcome) => [outcome.agentRunId, outcome.passed])).toEqual(
      expect.arrayContaining([[GRADED_RUN, true], [UNGRADED_RUN, false]]),
    );
    expect(await fixture.evaluationRepo.listEvaluators(STEP)).toEqual([]);
    const [audit] = await fixture.auditRepo.getByEntity('evaluation_assistant', 'ae-grading/grade-aes');
    expect(audit).toMatchObject({ action: 'evaluation_assistant.prompt', inputSnapshot: { prompt: 'What should I check first?' } });
  });

  it('prepares an Eval Run for the person to confirm; its own start is refused', async () => {
    Object.assign(scope.system, { engine: new WorkflowEngine(fixture.processRepo, fixture.instanceRepo, fixture.auditRepo) });
    await createEvaluator({ ...STEP, name: 'findings-present', rule: 'r', severity: 'critical', check: { kind: 'schema', schema: { required: ['findings'] } }, origin: 'user' }, scope);
    await createEvalCaseFromAgentRun({ agentRunId: GRADED_RUN, expectation: 'positive', split: 'dev', origin: 'user' }, scope);
    await freezeEvalDataset(STEP, scope);
    const requests = scriptOpenRouter([
      () => ({ toolCalls: [{ name: 'prepare_eval_run', arguments: { trialsPerCase: 2, budgetUsd: 2 } }] }),
      (request) => {
        const { prepared } = lastToolResult(request) as { prepared: { evalRunId: string } };
        return { toolCalls: [{ name: 'start_eval_run', arguments: { evalRunId: prepared.evalRunId } }] };
      },
      () => ({ content: 'Prepared a run of 2 trials with a $2 budget — confirm it to start.' }),
    ]);

    const result = await askEvaluationAssistant({ ...STEP, messages: [{ role: 'user', content: 'Run it.' }] }, scope);

    expect(result.preparedEvalRuns).toEqual([{ evalRunId: expect.any(String), budgetUsd: 2, estimatedUsd: null, trials: 2 }]);
    const refusal = lastToolResult(requests[2]!);
    expect(refusal.error).toContain('a person must confirm that budget');
    const run = await fixture.evaluationRepo.getEvalRun(result.preparedEvalRuns[0]!.evalRunId);
    expect(run?.status).toBe('prepared');
  });

  it('allows an investigation to finish beyond the old sixteen-round limit', async () => {
    const requests = scriptOpenRouter([
      ...Array.from({ length: 17 }, () => () => ({ toolCalls: [{ name: 'list_evaluators', arguments: {} }] })),
      () => ({ content: 'I finished reviewing the evaluation setup.' }),
    ]);

    const result = await askEvaluationAssistant({ ...STEP, messages: [{ role: 'user', content: 'Review the evaluation setup.' }] }, scope);

    expect(result.reply).toBe('I finished reviewing the evaluation setup.');
    expect(requests).toHaveLength(18);
  });
});
