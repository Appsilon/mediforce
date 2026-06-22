import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ChatCoworkSessionOutput, CoworkSession, ConversationTurn } from '@mediforce/platform-core';
import { buildCoworkSession } from '@mediforce/platform-core/testing';
import { createQueryWrapper } from '@/test/react-query';
import { queryKeys } from '@/lib/query-keys';

const chatMock = vi.fn<(...args: unknown[]) => Promise<ChatCoworkSessionOutput>>();
const getMock = vi.fn<(...args: unknown[]) => Promise<CoworkSession>>();
class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
vi.mock('@/lib/mediforce', () => ({
  mediforce: { cowork: { chat: chatMock, get: getMock } },
  ApiError,
}));

const { useSendCoworkMessage } = await import('../use-cowork');

function turn(id: string, content: string): ConversationTurn {
  return {
    id,
    role: 'human',
    content,
    timestamp: '2026-05-28T00:00:00.000Z',
    artifactDelta: null,
  };
}

function chatReply(session: CoworkSession, turns: ConversationTurn[]): ChatCoworkSessionOutput {
  return {
    turnId: 'srv-agent',
    agentText: 'ok',
    artifact: undefined,
    toolCalls: [],
    session: { ...session, turns },
    turns,
  };
}

describe('useSendCoworkMessage — optimistic prepend template (ADR-0006 §6)', () => {
  beforeEach(() => {
    chatMock.mockReset();
    getMock.mockReset();
  });

  it('prepends an optimistic human turn to the turns cache on mutate', async () => {
    const { wrapper, queryClient } = createQueryWrapper();
    const existing = [turn('t-0', 'earlier')];
    queryClient.setQueryData(queryKeys.cowork.turns('sess-1'), existing);
    let resolveChat: (v: ChatCoworkSessionOutput) => void = () => undefined;
    chatMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveChat = resolve;
        }),
    );

    const { result } = renderHook(() => useSendCoworkMessage('sess-1'), { wrapper });

    await act(async () => {
      void result.current.send('hello');
    });

    const cached = queryClient.getQueryData<ConversationTurn[]>(queryKeys.cowork.turns('sess-1'));
    expect(cached?.length).toBe(2);
    expect(cached?.[0].id).toBe('t-0');
    expect(cached?.[1].content).toBe('hello');
    expect(cached?.[1].role).toBe('human');

    await act(async () => {
      resolveChat(
        chatReply(buildCoworkSession({ id: 'sess-1' }), [
          turn('t-0', 'earlier'),
          turn('srv-h', 'hello'),
          turn('srv-a', 'ok'),
        ]),
      );
    });
    await waitFor(() => expect(result.current.isPending).toBe(false));
  });

  it('replaces turns cache with server-echoed turns on success', async () => {
    const { wrapper, queryClient } = createQueryWrapper();
    queryClient.setQueryData(queryKeys.cowork.turns('sess-1'), [turn('t-0', 'earlier')]);
    const serverTurns = [turn('s-1', 'hello'), turn('s-2', 'ok')];
    const serverSession = buildCoworkSession({ id: 'sess-1' });
    chatMock.mockResolvedValue(chatReply(serverSession, serverTurns));

    const { result } = renderHook(() => useSendCoworkMessage('sess-1'), { wrapper });

    await act(async () => {
      await result.current.send('hello');
    });
    await waitFor(() => expect(result.current.isPending).toBe(false));

    expect(queryClient.getQueryData<ConversationTurn[]>(queryKeys.cowork.turns('sess-1'))).toEqual(serverTurns);
    expect(queryClient.getQueryData<CoworkSession>(queryKeys.cowork.session('sess-1'))?.id).toBe('sess-1');
  });

  it('restores the turns snapshot when chat() throws', async () => {
    const { wrapper, queryClient } = createQueryWrapper();
    const original = [turn('t-0', 'earlier')];
    queryClient.setQueryData(queryKeys.cowork.turns('sess-1'), original);
    chatMock.mockRejectedValue(new Error('precondition_failed'));

    const { result } = renderHook(() => useSendCoworkMessage('sess-1'), { wrapper });

    await act(async () => {
      await result.current.send('hello').catch(() => undefined);
    });
    await waitFor(() => expect(result.current.error).not.toBeNull());

    expect(queryClient.getQueryData<ConversationTurn[]>(queryKeys.cowork.turns('sess-1'))).toEqual(original);
  });

  it('cancels in-flight turns polling so a late response cannot overwrite the optimistic prepend', async () => {
    // Cancellation-race protection — without `qc.cancelQueries` in onMutate,
    // an in-flight `getSession` returning stale (pre-message) turns would
    // overwrite the optimistic prepend, causing the user's turn to flicker.
    const { wrapper, queryClient } = createQueryWrapper();
    queryClient.setQueryData(queryKeys.cowork.turns('sess-1'), [turn('t-0', 'earlier')]);

    let resolveGet: (v: CoworkSession) => void = () => undefined;
    const inflightTurns: Promise<CoworkSession> = new Promise((resolve) => {
      resolveGet = resolve;
    });

    // Start an in-flight turns query (the one polling would have produced).
    void queryClient.fetchQuery({
      queryKey: queryKeys.cowork.turns('sess-1'),
      queryFn: async () => {
        const s = await inflightTurns;
        return s.turns;
      },
    });
    // Yield once so the fetch is registered as in-flight.
    await new Promise<void>((r) => setTimeout(r, 0));

    let resolveChat: (v: ChatCoworkSessionOutput) => void = () => undefined;
    chatMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveChat = resolve;
        }),
    );

    const { result } = renderHook(() => useSendCoworkMessage('sess-1'), { wrapper });

    await act(async () => {
      void result.current.send('hello');
    });

    // Now the stale poll resolves with PRE-message turns. Optimistic prepend
    // must NOT be overwritten — cancellation in onMutate guarantees this.
    await act(async () => {
      resolveGet(buildCoworkSession({ id: 'sess-1' })); // session.turns is [] from factory
    });

    const cached = queryClient.getQueryData<ConversationTurn[]>(queryKeys.cowork.turns('sess-1'));
    // The optimistic human turn must still be present in the cache.
    expect(cached?.some((t) => t.content === 'hello')).toBe(true);

    await act(async () => {
      resolveChat(chatReply(buildCoworkSession({ id: 'sess-1' }), [turn('srv', 'hello')]));
    });
    await waitFor(() => expect(result.current.isPending).toBe(false));
  });
});
