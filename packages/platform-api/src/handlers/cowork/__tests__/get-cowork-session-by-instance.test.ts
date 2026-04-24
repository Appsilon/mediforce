import { describe, expect, it, beforeEach } from 'vitest';
import {
  InMemoryCoworkSessionRepository,
  buildCoworkSession,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import { getCoworkSessionByInstance } from '../get-cowork-session-by-instance.js';
import { NotFoundError } from '../../../errors.js';

/**
 * Handler tests for `getCoworkSessionByInstance` — returns the most recent
 * *active* session for a process instance. In-memory repo, no mocks.
 */
describe('getCoworkSessionByInstance handler', () => {
  let coworkSessionRepo: InMemoryCoworkSessionRepository;

  beforeEach(() => {
    resetFactorySequence();
    coworkSessionRepo = new InMemoryCoworkSessionRepository();
  });

  it('returns the active session when one exists for the instance', async () => {
    await coworkSessionRepo.create(
      buildCoworkSession({
        id: 'sess-1',
        processInstanceId: 'inst-a',
        status: 'active',
      }),
    );

    const result = await getCoworkSessionByInstance(
      { instanceId: 'inst-a' },
      { coworkSessionRepo },
    );

    expect(result.id).toBe('sess-1');
    expect(result.processInstanceId).toBe('inst-a');
    expect(result.status).toBe('active');
  });

  it('returns the most recent active session when several exist', async () => {
    await coworkSessionRepo.create(
      buildCoworkSession({
        id: 'sess-old',
        processInstanceId: 'inst-a',
        status: 'active',
        createdAt: '2026-02-01T10:00:00Z',
      }),
    );
    await coworkSessionRepo.create(
      buildCoworkSession({
        id: 'sess-new',
        processInstanceId: 'inst-a',
        status: 'active',
        createdAt: '2026-02-02T10:00:00Z',
      }),
    );

    const result = await getCoworkSessionByInstance(
      { instanceId: 'inst-a' },
      { coworkSessionRepo },
    );

    expect(result.id).toBe('sess-new');
  });

  it('ignores finalized sessions even if they are newer', async () => {
    await coworkSessionRepo.create(
      buildCoworkSession({
        id: 'sess-active-old',
        processInstanceId: 'inst-a',
        status: 'active',
        createdAt: '2026-02-01T10:00:00Z',
      }),
    );
    await coworkSessionRepo.create(
      buildCoworkSession({
        id: 'sess-finalized-new',
        processInstanceId: 'inst-a',
        status: 'finalized',
        createdAt: '2026-02-03T10:00:00Z',
      }),
    );

    const result = await getCoworkSessionByInstance(
      { instanceId: 'inst-a' },
      { coworkSessionRepo },
    );

    expect(result.id).toBe('sess-active-old');
  });

  it('throws NotFoundError when the instance has no active session', async () => {
    await coworkSessionRepo.create(
      buildCoworkSession({
        id: 'sess-abandoned',
        processInstanceId: 'inst-a',
        status: 'abandoned',
      }),
    );

    await expect(
      getCoworkSessionByInstance({ instanceId: 'inst-a' }, { coworkSessionRepo }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws NotFoundError when the instance is completely unknown', async () => {
    const err = await getCoworkSessionByInstance(
      { instanceId: 'inst-missing' },
      { coworkSessionRepo },
    ).catch((e) => e);

    expect(err).toBeInstanceOf(NotFoundError);
    expect((err as NotFoundError).statusCode).toBe(404);
    expect((err as NotFoundError).message).toContain('inst-missing');
  });
});
