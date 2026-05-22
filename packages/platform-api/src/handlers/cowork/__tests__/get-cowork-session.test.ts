import { describe, expect, it, beforeEach } from 'vitest';
import {
  InMemoryCoworkSessionRepository,
  InMemoryProcessInstanceRepository,
  buildCoworkSession,
  buildProcessInstance,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import { getCoworkSession } from '../get-cowork-session.js';
import { NotFoundError } from '../../../errors.js';
import { createTestScope, userCaller } from '../../../repositories/__tests__/create-test-scope.js';

describe('getCoworkSession handler', () => {
  let coworkSessionRepo: InMemoryCoworkSessionRepository;
  let instanceRepo: InMemoryProcessInstanceRepository;

  beforeEach(async () => {
    resetFactorySequence();
    instanceRepo = new InMemoryProcessInstanceRepository();
    coworkSessionRepo = new InMemoryCoworkSessionRepository(instanceRepo);

    await instanceRepo.create(
      buildProcessInstance({ id: 'inst-a', namespace: 'team-alpha' }),
    );
    await coworkSessionRepo.create(
      buildCoworkSession({ id: 'sess-1', processInstanceId: 'inst-a' }),
    );
  });

  it('returns the session for api-key callers', async () => {
    const scope = createTestScope({ coworkSessionRepo, instanceRepo });
    const result = await getCoworkSession(
      { sessionId: 'sess-1' },
      scope,
    );
    expect(result.id).toBe('sess-1');
    expect(result.processInstanceId).toBe('inst-a');
  });

  it('returns the session for user callers who are members of the namespace', async () => {
    const scope = createTestScope({
      coworkSessionRepo,
      instanceRepo,
      caller: userCaller('u-1', ['team-alpha']),
    });

    const result = await getCoworkSession(
      { sessionId: 'sess-1' },
      scope,
    );

    expect(result.id).toBe('sess-1');
  });

  it('throws NotFoundError when the session does not exist', async () => {
    const scope = createTestScope({ coworkSessionRepo, instanceRepo });
    await expect(
      getCoworkSession(
        { sessionId: 'missing' },
        scope,
      ),
    ).rejects.toThrow(NotFoundError);
  });

  it('throws NotFoundError (not ForbiddenError) when a user caller is outside the session’s namespace (anti-enumeration)', async () => {
    const scope = createTestScope({
      coworkSessionRepo,
      instanceRepo,
      caller: userCaller('u-2', ['team-beta']),
    });

    await expect(
      getCoworkSession(
        { sessionId: 'sess-1' },
        scope,
      ),
    ).rejects.toThrow(NotFoundError);
  });

  it('throws NotFoundError when the session’s instance has no namespace', async () => {
    await instanceRepo.create(
      buildProcessInstance({ id: 'inst-orphan', namespace: undefined }),
    );
    await coworkSessionRepo.create(
      buildCoworkSession({
        id: 'sess-orphan',
        processInstanceId: 'inst-orphan',
      }),
    );
    const scope = createTestScope({
      coworkSessionRepo,
      instanceRepo,
      caller: userCaller('u-3', ['team-alpha']),
    });

    await expect(
      getCoworkSession(
        { sessionId: 'sess-orphan' },
        scope,
      ),
    ).rejects.toThrow(NotFoundError);
  });

  it('missing id and cross-namespace id are indistinguishable (no enumeration leak)', async () => {
    const scope = createTestScope({
      coworkSessionRepo,
      instanceRepo,
      caller: userCaller('u-x', []), // empty — would 403 anything real
    });

    // A non-existent session still surfaces as 404, never leaks "exists but denied".
    await expect(
      getCoworkSession(
        { sessionId: 'definitely-missing' },
        scope,
      ),
    ).rejects.toThrow(NotFoundError);
  });
});
