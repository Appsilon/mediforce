import { describe, expect, it, beforeEach } from 'vitest';
import {
  InMemoryCoworkSessionRepository,
  InMemoryProcessInstanceRepository,
  buildCoworkSession,
  buildProcessInstance,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import { getCoworkSession } from '../get-cowork-session.js';
import { NotFoundError, ForbiddenError } from '../../../errors.js';
import type { CallerIdentity } from '../../../auth.js';

const apiKey: CallerIdentity = { kind: 'apiKey' };

describe('getCoworkSession handler', () => {
  let coworkSessionRepo: InMemoryCoworkSessionRepository;
  let instanceRepo: InMemoryProcessInstanceRepository;

  beforeEach(async () => {
    resetFactorySequence();
    coworkSessionRepo = new InMemoryCoworkSessionRepository();
    instanceRepo = new InMemoryProcessInstanceRepository();

    await instanceRepo.create(
      buildProcessInstance({ id: 'inst-a', namespace: 'team-alpha' }),
    );
    await coworkSessionRepo.create(
      buildCoworkSession({ id: 'sess-1', processInstanceId: 'inst-a' }),
    );
  });

  it('returns the session for api-key callers', async () => {
    const result = await getCoworkSession(
      { sessionId: 'sess-1' },
      { coworkSessionRepo, instanceRepo },
      apiKey,
    );
    expect(result.id).toBe('sess-1');
    expect(result.processInstanceId).toBe('inst-a');
  });

  it('returns the session for user callers who are members of the namespace', async () => {
    const user: CallerIdentity = {
      kind: 'user',
      uid: 'u-1',
      namespaces: new Set(['team-alpha']),
    };

    const result = await getCoworkSession(
      { sessionId: 'sess-1' },
      { coworkSessionRepo, instanceRepo },
      user,
    );

    expect(result.id).toBe('sess-1');
  });

  it('throws NotFoundError when the session does not exist', async () => {
    await expect(
      getCoworkSession(
        { sessionId: 'missing' },
        { coworkSessionRepo, instanceRepo },
        apiKey,
      ),
    ).rejects.toThrow(NotFoundError);
  });

  it('throws ForbiddenError when a user caller is outside the session’s namespace', async () => {
    const otherUser: CallerIdentity = {
      kind: 'user',
      uid: 'u-2',
      namespaces: new Set(['team-beta']),
    };

    await expect(
      getCoworkSession(
        { sessionId: 'sess-1' },
        { coworkSessionRepo, instanceRepo },
        otherUser,
      ),
    ).rejects.toThrow(ForbiddenError);
  });

  it('throws ForbiddenError when the session’s instance has no namespace', async () => {
    await instanceRepo.create(
      buildProcessInstance({ id: 'inst-orphan', namespace: undefined }),
    );
    await coworkSessionRepo.create(
      buildCoworkSession({
        id: 'sess-orphan',
        processInstanceId: 'inst-orphan',
      }),
    );
    const user: CallerIdentity = {
      kind: 'user',
      uid: 'u-3',
      namespaces: new Set(['team-alpha']),
    };

    await expect(
      getCoworkSession(
        { sessionId: 'sess-orphan' },
        { coworkSessionRepo, instanceRepo },
        user,
      ),
    ).rejects.toThrow(ForbiddenError);
  });

  it('checks namespace AFTER the session is fetched (404 still beats 403 for missing ids)', async () => {
    const user: CallerIdentity = {
      kind: 'user',
      uid: 'u-x',
      namespaces: new Set(), // empty — would 403 anything real
    };

    // A non-existent session still surfaces as 404, never leaks "exists but denied".
    await expect(
      getCoworkSession(
        { sessionId: 'definitely-missing' },
        { coworkSessionRepo, instanceRepo },
        user,
      ),
    ).rejects.toThrow(NotFoundError);
  });
});
