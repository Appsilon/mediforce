import { describe, expect, it, beforeEach } from 'vitest';
import {
  InMemoryCoworkSessionRepository,
  buildCoworkSession,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import { getCoworkSession } from '../get-cowork-session.js';
import { NotFoundError } from '../../../errors.js';

/**
 * Handler tests for `getCoworkSession` — in-memory repo, no mocks.
 */
describe('getCoworkSession handler', () => {
  let coworkSessionRepo: InMemoryCoworkSessionRepository;

  beforeEach(() => {
    resetFactorySequence();
    coworkSessionRepo = new InMemoryCoworkSessionRepository();
  });

  it('returns the session when it exists', async () => {
    await coworkSessionRepo.create(
      buildCoworkSession({ id: 'sess-1', processInstanceId: 'inst-a' }),
    );

    const result = await getCoworkSession(
      { sessionId: 'sess-1' },
      { coworkSessionRepo },
    );

    expect(result.id).toBe('sess-1');
    expect(result.processInstanceId).toBe('inst-a');
  });

  it('returns the conversation turns verbatim', async () => {
    await coworkSessionRepo.create(
      buildCoworkSession({
        id: 'sess-turns',
        turns: [
          {
            id: 'turn-1',
            role: 'human',
            content: 'hello',
            timestamp: '2026-02-01T10:00:00Z',
            artifactDelta: null,
          },
          {
            id: 'turn-2',
            role: 'agent',
            content: 'hi there',
            timestamp: '2026-02-01T10:00:05Z',
            artifactDelta: null,
          },
        ],
      }),
    );

    const result = await getCoworkSession(
      { sessionId: 'sess-turns' },
      { coworkSessionRepo },
    );

    expect(result.turns).toHaveLength(2);
    expect(result.turns[0].id).toBe('turn-1');
    expect(result.turns[1].role).toBe('agent');
  });

  it('throws NotFoundError when no session has the given id', async () => {
    await expect(
      getCoworkSession({ sessionId: 'missing' }, { coworkSessionRepo }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('NotFoundError carries statusCode 404 and names the session id', async () => {
    const err = await getCoworkSession(
      { sessionId: 'missing-x' },
      { coworkSessionRepo },
    ).catch((e) => e);

    expect(err).toBeInstanceOf(NotFoundError);
    expect((err as NotFoundError).statusCode).toBe(404);
    expect((err as NotFoundError).message).toContain('missing-x');
  });
});
