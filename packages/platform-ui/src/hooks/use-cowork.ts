'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ConversationTurn,
  CoworkSession,
  CoworkSessionStatus,
} from '@mediforce/platform-core';
import { ApiError, mediforce } from '@/lib/mediforce';
import { queryKeys } from '@/lib/query-keys';
import { snapshotCache } from '@/lib/optimistic';
import { stopRetryOn4xx } from '@/lib/retry';

const ACTIVE_POST_INTERVAL_MS = 1000;
const IDLE_INTERVAL_MS = 5000;
const TERMINAL: ReadonlySet<CoworkSessionStatus> = new Set(['finalized', 'abandoned']);

/**
 * Session metadata fetch (`mediforce.cowork.get`) keyed under
 * `['cowork', sessionId]`. CRITICAL LIVE per ADR-0006 §4: 1 s while a chat
 * message is being sent, 5 s otherwise. Polling stops once the session
 * reaches a terminal status (`finalized`, `abandoned`) — operator is no
 * longer driving execution.
 */
export function useCoworkSession(
  sessionId: string | undefined,
  isSending: boolean,
): {
  session: CoworkSession | null;
  loading: boolean;
  error: Error | null;
  notFound: boolean;
} {
  const query = useQuery({
    queryKey: queryKeys.cowork.session(sessionId ?? ''),
    queryFn: () => mediforce.cowork.get({ sessionId: sessionId as string }),
    enabled: sessionId !== undefined,
    retry: stopRetryOn4xx,
    refetchInterval: (q) => {
      if (q.state.error !== null) return false;
      const status = q.state.data?.status;
      if (status !== undefined && TERMINAL.has(status)) return false;
      return isSending ? ACTIVE_POST_INTERVAL_MS : IDLE_INTERVAL_MS;
    },
  });

  const err = sessionId === undefined ? null : (query.error as Error | null) ?? null;
  const notFound = err instanceof ApiError && err.status === 404;
  return {
    session: sessionId === undefined ? null : query.data ?? null,
    loading: query.isLoading && sessionId !== undefined,
    error: notFound ? null : err,
    notFound,
  };
}

const OPTIMISTIC_TURN_ID_PREFIX = 'optimistic-';

function isOptimisticTurn(turn: ConversationTurn): boolean {
  return turn.id.startsWith(OPTIMISTIC_TURN_ID_PREFIX);
}

/**
 * Conversation turns fetch keyed under `['cowork', sessionId, 'turns']`.
 *
 * Separate cache surface from the session-metadata key so the chat mutation
 * can do focused optimistic prepends without churning session-level
 * observers. Polling cadence flips to 1 s while a message is in-flight
 * (`isSending`) so tool-call bubbles surface within the polling tick;
 * 5 s otherwise. Terminal session status stops polling.
 *
 * The queryFn merges any optimistic entries still in the cache that the
 * server has not yet caught up to. `useMutation.onMutate` cancels in-flight
 * polls, but polls scheduled by `refetchInterval` AFTER `onMutate` returns
 * are not in-flight at that moment — without this merge, the next tick
 * would overwrite the optimistic prepend with stale pre-message turns.
 */
export function useCoworkTurns(
  sessionId: string | undefined,
  isSending: boolean,
): {
  turns: ConversationTurn[];
  loading: boolean;
  error: Error | null;
} {
  const qc = useQueryClient();
  const turnsKey = queryKeys.cowork.turns(sessionId ?? '');
  const query = useQuery({
    queryKey: turnsKey,
    queryFn: async () => {
      const session = await mediforce.cowork.get({ sessionId: sessionId as string });
      const serverTurns = session.turns;
      const cached = qc.getQueryData<ConversationTurn[]>(turnsKey) ?? [];
      const stillPending = cached.filter(
        (t) =>
          isOptimisticTurn(t) &&
          !serverTurns.some((s) => s.role === t.role && s.content === t.content),
      );
      return stillPending.length === 0 ? serverTurns : [...serverTurns, ...stillPending];
    },
    enabled: sessionId !== undefined,
    retry: stopRetryOn4xx,
    refetchInterval: (q) => {
      if (q.state.error !== null) return false;
      return isSending ? ACTIVE_POST_INTERVAL_MS : IDLE_INTERVAL_MS;
    },
  });

  return {
    turns: query.data ?? [],
    loading: query.isLoading && sessionId !== undefined,
    error: (query.error as Error | null) ?? null,
  };
}

/**
 * Chat send mutation with optimistic prepend per ADR-0006 §6 and the
 * cowork live-turn strategy in the Phase 4 PRD § 5:
 *
 * - `onMutate` cancels the in-flight turns poll (cancellation-race
 *   protection — without this, a polling response returning before the
 *   POST resolves would overwrite the optimistic prepend with stale data),
 *   snapshots the turns cache, and prepends a synthetic human turn so the
 *   UI feels instant.
 * - `onSuccess` replaces the turns cache with the server's final turns
 *   array (additive return-shape extension) and writes the post-mutation
 *   session into the session cache, so no follow-up GET is required.
 * - `onError` restores the snapshot.
 */
export function useSendCoworkMessage(sessionId: string): {
  send: (message: string) => Promise<unknown>;
  isPending: boolean;
  error: Error | null;
  reset: () => void;
} {
  const qc = useQueryClient();
  const turnsKey = queryKeys.cowork.turns(sessionId);
  const sessionKey = queryKeys.cowork.session(sessionId);

  const mutation = useMutation({
    mutationFn: (message: string) => mediforce.cowork.chat({ sessionId, message }),
    onMutate: async (message) => {
      await qc.cancelQueries({ queryKey: turnsKey });
      const { restore } = snapshotCache(qc, [turnsKey]);
      const optimisticTurn: ConversationTurn = {
        id: `${OPTIMISTIC_TURN_ID_PREFIX}${crypto.randomUUID()}`,
        role: 'human',
        content: message,
        timestamp: new Date().toISOString(),
        artifactDelta: null,
      };
      qc.setQueryData<ConversationTurn[] | undefined>(turnsKey, (old) =>
        old ? [...old, optimisticTurn] : [optimisticTurn],
      );
      return { restore };
    },
    onSuccess: (data) => {
      qc.setQueryData(turnsKey, data.turns);
      qc.setQueryData(sessionKey, data.session);
    },
    onError: (_err, _input, ctx) => {
      ctx?.restore();
    },
  });

  return {
    send: (message: string) => mutation.mutateAsync(message),
    isPending: mutation.isPending,
    error: (mutation.error as Error | null) ?? null,
    reset: () => mutation.reset(),
  };
}
