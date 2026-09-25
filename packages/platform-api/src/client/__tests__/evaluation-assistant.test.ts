import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Mediforce, ApiError } from '../index';

const step = { namespace: 'acme', workflowName: 'wf', stepId: 'grade-aes' };
const input = { ...step, messages: [{ role: 'user' as const, content: 'What should I check?' }] };
const result = { reply: 'Done.', proposals: [], preparedEvalRuns: [], startedEvalRuns: [] };

function ndjsonResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  }), { headers: { 'Content-Type': 'application/x-ndjson' } });
}

describe('evaluation.askAssistant', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('asks for a progress stream when given onProgress, reports each step and returns the result', async () => {
    const running = JSON.stringify({ progress: { type: 'tool', round: 1, callId: 'c1', tool: 'get_step', status: 'running' } });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(ndjsonResponse([
      `${JSON.stringify({ progress: { type: 'thinking', round: 1 } })}\n${running.slice(0, 20)}`,
      `${running.slice(20)}\n`,
      `${JSON.stringify({ result })}\n`,
    ]));
    const onProgress = vi.fn();

    const answer = await new Mediforce({ apiKey: 'k', baseUrl: 'http://localhost' }).evaluation.askAssistant(input, { onProgress });

    expect(answer).toEqual(result);
    expect(onProgress.mock.calls.map(([event]) => event)).toEqual([
      { type: 'thinking', round: 1 },
      { type: 'tool', round: 1, callId: 'c1', tool: 'get_step', status: 'running' },
    ]);
    expect(new Headers(fetchSpy.mock.calls[0]?.[1]?.headers).get('Accept')).toBe('application/x-ndjson');
  });

  it('throws the streamed error envelope as an ApiError', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(ndjsonResponse([
      `${JSON.stringify({ progress: { type: 'thinking', round: 1 } })}\n`,
      `${JSON.stringify({ error: { code: 'internal', message: 'Internal error' } })}\n`,
    ]));

    const ask = new Mediforce({ apiKey: 'k', baseUrl: 'http://localhost' }).evaluation.askAssistant(input, { onProgress: () => {} });

    await expect(ask).rejects.toBeInstanceOf(ApiError);
    await expect(ask).rejects.toMatchObject({ code: 'internal', message: 'Internal error' });
  });

  it('throws a JSON error returned before the stream opens', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ error: { code: 'forbidden', message: 'No access' } }),
      { status: 403, headers: { 'Content-Type': 'application/json' } },
    ));

    const ask = new Mediforce({ apiKey: 'k', baseUrl: 'http://localhost' }).evaluation.askAssistant(input, { onProgress: () => {} });

    await expect(ask).rejects.toMatchObject({ status: 403, code: 'forbidden' });
  });
});
