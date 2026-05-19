import { describe, expect, it, beforeEach } from 'vitest';
import {
  InMemoryCoworkSessionRepository,
  InMemoryProcessInstanceRepository,
  buildCoworkSession,
  buildProcessInstance,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import { getCoworkSessionByInstance } from '../get-cowork-session-by-instance.js';
import { NotFoundError } from '../../../errors.js';
import type { CallerIdentity } from '../../../auth.js';

const apiKey: CallerIdentity = { kind: 'apiKey' };

describe('getCoworkSessionByInstance handler', () => {
  let coworkSessionRepo: InMemoryCoworkSessionRepository;
  let instanceRepo: InMemoryProcessInstanceRepository;

  beforeEach(async () => {
    resetFactorySequence();
    coworkSessionRepo = new InMemoryCoworkSessionRepository();
    instanceRepo = new InMemoryProcessInstanceRepository();

    await instanceRepo.create(
      buildProcessInstance({ id: 'inst-a', namespace: 'team-alpha' }),
    );
  });

  it('returns the active session for api-key callers', async () => {
    await coworkSessionRepo.create(
      buildCoworkSession({
        id: 'sess-1',
        processInstanceId: 'inst-a',
        status: 'active',
      }),
    );

    const result = await getCoworkSessionByInstance(
      { instanceId: 'inst-a' },
      { coworkSessionRepo, instanceRepo },
      apiKey,
    );

    expect(result.id).toBe('sess-1');
    expect(result.processInstanceId).toBe('inst-a');
    expect(result.status).toBe('active');
  });

  it('returns the active session for user callers in the namespace', async () => {
    await coworkSessionRepo.create(
      buildCoworkSession({
        id: 'sess-1',
        processInstanceId: 'inst-a',
        status: 'active',
      }),
    );
    const user: CallerIdentity = {
      kind: 'user',
      uid: 'u-1',
      namespaces: new Set(['team-alpha']),
    };

    const result = await getCoworkSessionByInstance(
      { instanceId: 'inst-a' },
      { coworkSessionRepo, instanceRepo },
      user,
    );

    expect(result.id).toBe('sess-1');
  });

  it('throws NotFoundError when the instance is completely unknown', async () => {
    const err = await getCoworkSessionByInstance(
      { instanceId: 'inst-missing' },
      { coworkSessionRepo, instanceRepo },
      apiKey,
    ).catch((e) => e);

    expect(err).toBeInstanceOf(NotFoundError);
    expect((err as NotFoundError).statusCode).toBe(404);
    expect((err as NotFoundError).message).toContain('inst-missing');
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
      getCoworkSessionByInstance(
        { instanceId: 'inst-a' },
        { coworkSessionRepo, instanceRepo },
        apiKey,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws NotFoundError (not ForbiddenError) when a user caller is outside the instance’s namespace (anti-enumeration)', async () => {
    await coworkSessionRepo.create(
      buildCoworkSession({
        id: 'sess-1',
        processInstanceId: 'inst-a',
        status: 'active',
      }),
    );
    const otherUser: CallerIdentity = {
      kind: 'user',
      uid: 'u-2',
      namespaces: new Set(['team-beta']),
    };

    await expect(
      getCoworkSessionByInstance(
        { instanceId: 'inst-a' },
        { coworkSessionRepo, instanceRepo },
        otherUser,
      ),
    ).rejects.toThrow(NotFoundError);
  });

  it('throws NotFoundError when the instance has no namespace', async () => {
    await instanceRepo.create(
      buildProcessInstance({ id: 'inst-orphan', namespace: undefined }),
    );
    await coworkSessionRepo.create(
      buildCoworkSession({
        id: 'sess-orphan',
        processInstanceId: 'inst-orphan',
        status: 'active',
      }),
    );
    const user: CallerIdentity = {
      kind: 'user',
      uid: 'u-3',
      namespaces: new Set(['team-alpha']),
    };

    await expect(
      getCoworkSessionByInstance(
        { instanceId: 'inst-orphan' },
        { coworkSessionRepo, instanceRepo },
        user,
      ),
    ).rejects.toThrow(NotFoundError);
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
      { coworkSessionRepo, instanceRepo },
      apiKey,
    );

    expect(result.id).toBe('sess-new');
  });

  it('cross-namespace caller cannot distinguish "no active session" from "wrong namespace" (anti-probing)', async () => {
    // Instance exists in 'team-alpha', no sessions at all. A user in
    // 'team-beta' must NOT be able to probe "does this instance have an
    // active session?" — both the cross-namespace and the no-session case
    // return the same NotFoundError.
    const otherUser: CallerIdentity = {
      kind: 'user',
      uid: 'u-2',
      namespaces: new Set(['team-beta']),
    };

    await expect(
      getCoworkSessionByInstance(
        { instanceId: 'inst-a' },
        { coworkSessionRepo, instanceRepo },
        otherUser,
      ),
    ).rejects.toThrow(NotFoundError);
  });
});
