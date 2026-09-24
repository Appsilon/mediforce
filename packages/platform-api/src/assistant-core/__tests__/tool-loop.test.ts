import { describe, it, expect, afterEach, vi } from 'vitest';
import { z } from 'zod';
import { runProposalToolLoop } from '../tool-loop';

type ScriptedTurn = { content?: string; toolCalls?: Array<{ name: string; arguments: unknown }>; finishReason?: string };

/** Fakes OpenRouter at `fetch`, one scripted turn per request, and keeps each request body. */
function scriptOpenRouter(turns: ScriptedTurn[]) {
  const bodies: Array<{ messages: Array<{ role: string; content: string }>; tools?: unknown[] }> = [];
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)));
    const turn = turns.shift() ?? { content: 'done' };
    return new Response(JSON.stringify({
      choices: [{
        message: {
          content: turn.content ?? '',
          tool_calls: (turn.toolCalls ?? []).map((call, index) => ({
            id: `call-${bodies.length}-${index}`,
            type: 'function',
            function: { name: call.name, arguments: typeof call.arguments === 'string' ? call.arguments : JSON.stringify(call.arguments) },
          })),
        },
        finish_reason: turn.finishReason ?? 'stop',
      }],
    }));
  }));
  return bodies;
}

const config = {
  model: 'test/model',
  apiKey: 'sk-test',
  proposalTools: { propose_note: z.object({ text: z.string().min(1) }) },
  platformTools: { read_count: z.object({}) },
  maxIterations: 4,
  maxTokens: 500,
};

describe('runProposalToolLoop', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(['platform', 'proposal'])('stops after three consecutive validation-failing rounds for a %s tool, preserving earlier proposals', async (kind) => {
    const toolName = kind === 'platform' ? 'read_count' : 'propose_note';
    const invalidCalls = Array.from({ length: 3 }, (_, index) => ({
      toolCalls: [{ name: toolName, arguments: { text: index, check: `rewritten script ${index}` } }],
    }));
    const bodies = scriptOpenRouter([
      { toolCalls: [{ name: 'propose_note', arguments: { text: 'Keep this card.' } }] },
      ...invalidCalls,
      { content: 'The remaining check could not be validated.' },
    ]);
    const execute = vi.fn();
    const result = await runProposalToolLoop({
      ...config, maxIterations: 32, platformTools: { read_count: z.object({ check: z.object({ kind: z.string() }) }) },
      messages: [{ role: 'user', content: 'go' }], executePlatformTool: execute,
    });
    expect(result.reply).toContain('3 consecutive rounds');
    expect(result.reply).toContain(toolName);
    expect(result.reply).toContain(kind === 'platform' ? 'expected object' : 'expected string');
    expect(result.reply).not.toContain('tool-use limit');
    expect(result.proposals).toEqual([{ tool: 'propose_note', arguments: { text: 'Keep this card.' } }]);
    expect(bodies).toHaveLength(5);
    expect(bodies[4]!.tools).toBeUndefined();
    expect(execute).not.toHaveBeenCalled();
  });

  it('resets repeated validation failures after a successful call and allows correction', async () => {
    const invalid = { toolCalls: [{ name: 'propose_note', arguments: { text: 1 } }] };
    const bodies = scriptOpenRouter([
      invalid, invalid,
      { toolCalls: [{ name: 'read_count', arguments: {} }] },
      invalid, invalid,
      { toolCalls: [{ name: 'propose_note', arguments: { text: 'Corrected.' } }] },
      { content: 'Done.' },
    ]);
    const result = await runProposalToolLoop({
      ...config, maxIterations: 32, messages: [{ role: 'user', content: 'go' }], executePlatformTool: vi.fn().mockResolvedValue({ count: 1 }),
    });
    expect(result.reply).toBe('Done.');
    expect(result.proposals).toHaveLength(1);
    expect(bodies).toHaveLength(7);
  });

  it('does not count several invalid calls in one round as several failed rounds', async () => {
    const invalid = { name: 'propose_note', arguments: { text: 1 } };
    scriptOpenRouter([
      { toolCalls: [invalid, invalid, invalid] },
      { toolCalls: [{ name: 'propose_note', arguments: { text: 'Corrected.' } }] },
      { content: 'Done.' },
    ]);
    const result = await runProposalToolLoop({ ...config, messages: [], executePlatformTool: vi.fn() });
    expect(result.reply).toBe('Done.');
    expect(result.proposals).toHaveLength(1);
  });

  it('does not treat changing validation failures or runtime errors as the same validation loop', async () => {
    scriptOpenRouter([
      { toolCalls: [{ name: 'propose_note', arguments: { text: 1 } }] },
      { toolCalls: [{ name: 'propose_note', arguments: { text: '' } }] },
      { toolCalls: [{ name: 'propose_note', arguments: {} }] },
      ...Array.from({ length: 3 }, () => ({ toolCalls: [{ name: 'read_count', arguments: {} }] })),
      { content: 'The service is unavailable.' },
    ]);
    const execute = vi.fn().mockRejectedValue(new Error('unavailable'));
    const result = await runProposalToolLoop({ ...config, maxIterations: 32, messages: [], executePlatformTool: execute });
    expect(result.reply).toBe('The service is unavailable.');
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it('runs platform tools, collects proposals, and stops at a turn with no tool calls', async () => {
    const bodies = scriptOpenRouter([
      { toolCalls: [{ name: 'read_count', arguments: {} }] },
      { toolCalls: [{ name: 'propose_note', arguments: { text: 'Check grade 5 first.' } }] },
      { content: 'I proposed a note.' },
    ]);
    const execute = vi.fn().mockResolvedValue({ count: 3 });

    const result = await runProposalToolLoop({ ...config, messages: [{ role: 'user', content: 'go' }], executePlatformTool: execute });

    expect(result).toEqual({
      reply: 'I proposed a note.',
      proposals: [{ tool: 'propose_note', arguments: { text: 'Check grade 5 first.' } }],
      platformCalls: [{ tool: 'read_count', result: { count: 3 } }],
    });
    expect(bodies[1]!.messages.at(-1)).toMatchObject({ role: 'tool', content: JSON.stringify({ count: 3 }) });
    expect(JSON.parse(bodies[2]!.messages.at(-1)!.content)).toMatchObject({ proposed: true });
  });

  it('answers invalid, malformed and unknown calls as tool errors the model can fix', async () => {
    const bodies = scriptOpenRouter([
      { toolCalls: [
        { name: 'propose_note', arguments: { text: '' } },
        { name: 'propose_note', arguments: '{not json' },
        { name: 'sign_qualification', arguments: {} },
      ] },
      { content: 'Sorry.' },
    ]);

    const result = await runProposalToolLoop({ ...config, messages: [{ role: 'user', content: 'go' }], executePlatformTool: vi.fn() });

    expect(result.proposals).toEqual([]);
    const errors = bodies[1]!.messages.filter((message) => message.role === 'tool').map((message) => JSON.parse(message.content).error);
    expect(errors[0]).toContain("Invalid arguments for 'propose_note'");
    expect(errors[1]).toBe("Malformed JSON arguments for 'propose_note'.");
    expect(errors[2]).toBe("Unknown tool 'sign_qualification'. Valid tools: propose_note, read_count.");
  });

  it('reviews each proposal: a refused one goes back as an error, an accepted one carries its evidence', async () => {
    const bodies = scriptOpenRouter([
      { toolCalls: [
        { name: 'propose_note', arguments: { text: 'duplicate' } },
        { name: 'propose_note', arguments: { text: 'broken review' } },
        { name: 'propose_note', arguments: { text: 'Check grade 5 first.' } },
      ] },
      { content: 'One note proposed.' },
    ]);
    const reviewProposal = vi.fn().mockImplementation(async (_tool: string, args: { text: string }) => {
      if (args.text === 'duplicate') return { ok: false, error: 'That note exists already.' };
      if (args.text === 'broken review') throw new Error('Workspace is gone.');
      return { ok: true, evidence: { checkedOn: 2 } };
    });

    const result = await runProposalToolLoop({
      ...config, messages: [{ role: 'user', content: 'go' }], executePlatformTool: vi.fn(), reviewProposal,
    });

    expect(result.proposals).toEqual([{ tool: 'propose_note', arguments: { text: 'Check grade 5 first.' }, evidence: { checkedOn: 2 } }]);
    const answers = bodies[1]!.messages.filter((message) => message.role === 'tool').map((message) => JSON.parse(message.content));
    expect(answers[0]).toEqual({ error: 'That note exists already.' });
    expect(answers[1]).toEqual({ error: 'Workspace is gone.' });
    expect(answers[2]).toMatchObject({ proposed: true, checkedOn: 2 });
  });

  it('treats a tool named after an Object builtin as unknown, not as a tool', async () => {
    const bodies = scriptOpenRouter([
      { toolCalls: [{ name: 'constructor', arguments: {} }, { name: 'toString', arguments: {} }] },
      { content: 'Sorry.' },
    ]);

    const result = await runProposalToolLoop({ ...config, messages: [{ role: 'user', content: 'go' }], executePlatformTool: vi.fn() });

    expect(result).toEqual({ reply: 'Sorry.', proposals: [], platformCalls: [] });
    const errors = bodies[1]!.messages.filter((message) => message.role === 'tool').map((message) => JSON.parse(message.content).error);
    expect(errors).toEqual([
      "Unknown tool 'constructor'. Valid tools: propose_note, read_count.",
      "Unknown tool 'toString'. Valid tools: propose_note, read_count.",
    ]);
  });

  it('summarizes partial progress when the final answer is truncated', async () => {
    scriptOpenRouter([
      { toolCalls: [{ name: 'propose_note', arguments: { text: 'Check grade 5 first.' } }] },
      { content: 'The first thing to check is', finishReason: 'length' },
      { content: 'The grade check is proposed; the rest is unfinished.' },
    ]);
    const result = await runProposalToolLoop({
      ...config, messages: [{ role: 'user', content: 'go' }], executePlatformTool: vi.fn(),
    });
    expect(result.reply).toContain('truncated');
    expect(result.reply).not.toContain('The first thing to check is');
    expect(result.proposals).toHaveLength(1);
  });

  it('returns proposals from the last allowed round and makes a final call without tools', async () => {
    const bodies = scriptOpenRouter([
      { toolCalls: [{ name: 'read_count', arguments: {} }] },
      { toolCalls: [{ name: 'propose_note', arguments: { text: 'Check all files.' } }] },
      { content: 'I previewed the file check. Package usage still needs checking.' },
    ]);
    const execute = vi.fn().mockResolvedValue({ count: 3 });

    const result = await runProposalToolLoop({
      ...config, maxIterations: 2, messages: [{ role: 'user', content: 'go' }], executePlatformTool: execute,
    });

    expect(result.proposals).toEqual([{ tool: 'propose_note', arguments: { text: 'Check all files.' } }]);
    expect(result.platformCalls).toEqual([{ tool: 'read_count', result: { count: 3 } }]);
    expect(result.reply).toContain('Package usage still needs checking.');
    expect(result.reply).toContain('tool-use limit');
    expect(bodies).toHaveLength(3);
    expect(bodies[2]!.tools).toBeUndefined();
    expect(bodies[2]!.messages.some((message) => message.role === 'tool' && message.content.includes('proposed'))).toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it.each([
    { content: '', toolCalls: [{ name: 'read_count', arguments: {} }] },
    { content: 'incomplete answer', finishReason: 'length' },
    { content: '' },
  ])('keeps partial results when the final summary is unusable: %j', async (summary) => {
    scriptOpenRouter([
      { toolCalls: [{ name: 'propose_note', arguments: { text: 'Already proposed.' } }] },
      summary,
    ]);
    const execute = vi.fn();
    const result = await runProposalToolLoop({
      ...config, maxIterations: 1, messages: [{ role: 'user', content: 'go' }], executePlatformTool: execute,
    });
    expect(result.proposals).toHaveLength(1);
    expect(result.reply).toContain('tool-use limit');
    expect(result.reply).not.toContain('incomplete answer');
    expect(execute).not.toHaveBeenCalled();
  });

  it('keeps partial results when the final model request fails', async () => {
    scriptOpenRouter([{ toolCalls: [{ name: 'propose_note', arguments: { text: 'Already proposed.' } }] }]);
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockReset().mockImplementationOnce(original).mockRejectedValueOnce(new Error('provider unavailable'));

    const result = await runProposalToolLoop({
      ...config, maxIterations: 1, messages: [{ role: 'user', content: 'go' }], executePlatformTool: vi.fn(),
    });
    expect(result.proposals).toHaveLength(1);
    expect(result.reply).toContain('tool-use limit');
  });

  it('keeps completed proposals when the connection to the model drops', async () => {
    scriptOpenRouter([{ toolCalls: [{ name: 'propose_note', arguments: { text: 'Already proposed.' } }] }]);
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockReset().mockImplementationOnce(original).mockRejectedValue(new TypeError('fetch failed'));

    const result = await runProposalToolLoop({
      ...config, messages: [{ role: 'user', content: 'go' }], executePlatformTool: vi.fn(),
    });
    expect(result.proposals).toHaveLength(1);
    expect(result.reply).toContain('connection to the model was interrupted');
  });

  it('caps an oversized tool result before sending it back to the model', async () => {
    const bodies = scriptOpenRouter([{ toolCalls: [{ name: 'read_count', arguments: {} }] }, { content: 'Done.' }]);
    const execute = vi.fn().mockResolvedValue({ results: [{ comment: 'x'.repeat(2_000_000) }] });

    await runProposalToolLoop({ ...config, messages: [{ role: 'user', content: 'go' }], executePlatformTool: execute });

    const toolMessage = bodies[1]!.messages.find((message) => message.role === 'tool')!;
    expect(toolMessage.content.length).toBeLessThan(70_000);
    expect(toolMessage.content).toContain('truncated');
  });

  it('tells the model a malformed tool call was truncated so it can retry a smaller check', async () => {
    const bodies = scriptOpenRouter([
      { toolCalls: [{ name: 'propose_note', arguments: '{"text":"cut off' }], finishReason: 'length' },
      { toolCalls: [{ name: 'propose_note', arguments: { text: 'Complete check.' } }] },
      { content: 'Proposed.' },
    ]);
    const result = await runProposalToolLoop({
      ...config, messages: [{ role: 'user', content: 'go' }], executePlatformTool: vi.fn(),
    });
    expect(bodies[1]!.messages.filter((message) => message.role === 'tool')[0]!.content).toContain('truncated');
    expect(result.proposals).toEqual([{ tool: 'propose_note', arguments: { text: 'Complete check.' } }]);
  });

  it('returns an identical proposal once and tells the model it was already proposed', async () => {
    const bodies = scriptOpenRouter([
      { toolCalls: [{ name: 'propose_note', arguments: { text: 'Same card.' } }, { name: 'read_count', arguments: { bad: true } }] },
      { toolCalls: [{ name: 'propose_note', arguments: { text: 'Same card.' } }, { name: 'propose_note', arguments: { text: 'Other card.' } }] },
      { content: 'Proposed.' },
    ]);
    const result = await runProposalToolLoop({
      ...config, messages: [{ role: 'user', content: 'go' }], executePlatformTool: vi.fn().mockResolvedValue({ count: 3 }),
    });
    expect(result.proposals).toEqual([
      { tool: 'propose_note', arguments: { text: 'Same card.' } },
      { tool: 'propose_note', arguments: { text: 'Other card.' } },
    ]);
    const repeated = JSON.parse(bodies[2]!.messages.filter((message) => message.role === 'tool').at(-2)!.content);
    expect(repeated).toMatchObject({ proposed: true, duplicate: true });
  });

  it('reports each model round and each tool call as it happens', async () => {
    scriptOpenRouter([
      { toolCalls: [{ name: 'read_count', arguments: {} }, { name: 'propose_note', arguments: { text: '' } }] },
      { content: 'Done.' },
    ]);
    const onProgress = vi.fn();
    await runProposalToolLoop({
      ...config, messages: [{ role: 'user', content: 'go' }], executePlatformTool: vi.fn().mockResolvedValue({ count: 3 }), onProgress,
    });
    expect(onProgress.mock.calls.map(([event]) => event)).toEqual([
      { type: 'thinking', round: 1 },
      { type: 'tool', round: 1, callId: 'call-1-0', tool: 'read_count', status: 'running' },
      { type: 'tool', round: 1, callId: 'call-1-0', tool: 'read_count', status: 'done' },
      { type: 'tool', round: 1, callId: 'call-1-1', tool: 'propose_note', status: 'running' },
      { type: 'tool', round: 1, callId: 'call-1-1', tool: 'propose_note', status: 'failed', error: expect.stringContaining('text') },
      { type: 'thinking', round: 2 },
    ]);
  });
});
