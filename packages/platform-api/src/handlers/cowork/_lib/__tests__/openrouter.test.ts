import { describe, it, expect, vi, afterEach } from 'vitest';
import { callOpenRouter } from '../openrouter.js';

describe('callOpenRouter', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  afterEach(() => {
    fetchSpy?.mockRestore();
  });

  it('returns content and toolCalls from the model response', async () => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: 'hello',
                tool_calls: [
                  {
                    id: 'call-1',
                    type: 'function',
                    function: { name: 'update_artifact', arguments: '{}' },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );

    const result = await callOpenRouter(
      'model-x',
      [{ role: 'user', content: 'hi' }],
      [],
      'key-abc',
    );

    expect(result.content).toBe('hello');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].function.name).toBe('update_artifact');

    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer key-abc',
    });
  });

  it('returns empty content + empty toolCalls when the model omits them', async () => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: {} }] }), { status: 200 }),
    );

    const result = await callOpenRouter(
      'model-x',
      [{ role: 'user', content: 'hi' }],
      [],
      'key-abc',
    );
    expect(result.content).toBe('');
    expect(result.toolCalls).toEqual([]);
  });

  it('throws when the model API returns non-OK', async () => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('boom', { status: 500 }),
    );

    await expect(
      callOpenRouter('model-x', [{ role: 'user', content: 'hi' }], [], 'key-abc'),
    ).rejects.toThrow(/Model API error 500/);
  });
});
