import { describe, it, expect, afterEach, vi } from 'vitest';
import { z } from 'zod';
import { runProposalToolLoop } from '../tool-loop';

type ScriptedTurn = { content?: string; toolCalls?: Array<{ name: string; arguments: unknown }>; finishReason?: string };

/** Fakes OpenRouter at `fetch`, one scripted turn per request, and keeps each request body. */
function scriptOpenRouter(turns: ScriptedTurn[]) {
  const bodies: Array<{ messages: Array<{ role: string; content: string }> }> = [];
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

  it('refuses a final answer cut off at the token limit rather than returning it as the reply', async () => {
    scriptOpenRouter([
      { toolCalls: [{ name: 'propose_note', arguments: { text: 'Check grade 5 first.' } }] },
      { content: 'The first thing to check is', finishReason: 'length' },
    ]);
    await expect(runProposalToolLoop({
      ...config, messages: [{ role: 'user', content: 'go' }], executePlatformTool: vi.fn(),
    })).rejects.toThrow('truncated');
  });

  it('gives up after the iteration cap', async () => {
    scriptOpenRouter(Array.from({ length: 5 }, () => ({ toolCalls: [{ name: 'read_count', arguments: {} }] })));
    await expect(runProposalToolLoop({
      ...config, messages: [{ role: 'user', content: 'go' }], executePlatformTool: vi.fn().mockResolvedValue({}),
    })).rejects.toThrow('did not finish');
  });
});
