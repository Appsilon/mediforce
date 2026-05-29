import { describe, it, expect, vi, afterEach } from 'vitest';
import { callOpenRouter } from '../openrouter-client';

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

    const result = await callOpenRouter({
      model: 'model-x',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [],
      apiKey: 'key-abc',
    });

    expect(result.content).toBe('hello');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].function.name).toBe('update_artifact');

    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer key-abc',
    });
  });

  it('omits tools from the request body when not provided', async () => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
        status: 200,
      }),
    );

    await callOpenRouter({
      model: 'model-x',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'key-abc',
    });

    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect('tools' in body).toBe(false);
  });

  it('honors temperature + maxTokens overrides', async () => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
        status: 200,
      }),
    );

    await callOpenRouter({
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'k',
      temperature: 0.3,
      maxTokens: 1024,
    });

    const body = JSON.parse(
      (fetchSpy.mock.calls[0]![1] as RequestInit).body as string,
    ) as Record<string, unknown>;
    expect(body.temperature).toBe(0.3);
    expect(body.max_tokens).toBe(1024);
  });

  it('returns empty content + empty toolCalls when the model omits them', async () => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: {} }] }), { status: 200 }),
    );

    const result = await callOpenRouter({
      model: 'model-x',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'key-abc',
    });
    expect(result.content).toBe('');
    expect(result.toolCalls).toEqual([]);
  });

  it('throws when the model API returns non-OK', async () => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('boom', { status: 500 }),
    );

    await expect(
      callOpenRouter({
        model: 'model-x',
        messages: [{ role: 'user', content: 'hi' }],
        apiKey: 'key-abc',
      }),
    ).rejects.toThrow(/Model API error 500/);
  });
});
