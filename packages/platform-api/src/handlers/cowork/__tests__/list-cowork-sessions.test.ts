import { describe, expect, it, beforeEach } from 'vitest';
import {
  InMemoryCoworkSessionRepository,
  InMemoryProcessInstanceRepository,
  buildCoworkSession,
  buildProcessInstance,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import { listCoworkSessions } from '../list-cowork-sessions';
import { createTestScope, userCaller } from '../../../repositories/__tests__/create-test-scope';

describe('listCoworkSessions handler', () => {
  let coworkSessionRepo: InMemoryCoworkSessionRepository;
  let instanceRepo: InMemoryProcessInstanceRepository;

  beforeEach(async () => {
    resetFactorySequence();
    instanceRepo = new InMemoryProcessInstanceRepository();
    coworkSessionRepo = new InMemoryCoworkSessionRepository(instanceRepo);

    await instanceRepo.create(
      buildProcessInstance({ id: 'inst-a', namespace: 'team-alpha' }),
    );
    await instanceRepo.create(
      buildProcessInstance({ id: 'inst-b', namespace: 'team-beta' }),
    );
  });

  it('returns all sessions for api-key callers when no filters', async () => {
    await coworkSessionRepo.create(
      buildCoworkSession({ id: 'sess-1', processInstanceId: 'inst-a', status: 'active' }),
    );
    await coworkSessionRepo.create(
      buildCoworkSession({ id: 'sess-2', processInstanceId: 'inst-a', status: 'finalized' }),
    );

    const scope = createTestScope({ coworkSessionRepo, instanceRepo });
    const result = await listCoworkSessions({}, scope);

    expect(result.sessions.map((s) => s.id).sort()).toEqual(['sess-1', 'sess-2']);
  });

  it('narrows to a single assignedRole when `role` is set', async () => {
    await coworkSessionRepo.create(
      buildCoworkSession({
        id: 'sess-analyst',
        processInstanceId: 'inst-a',
        assignedRole: 'analyst',
      }),
    );
    await coworkSessionRepo.create(
      buildCoworkSession({
        id: 'sess-reviewer',
        processInstanceId: 'inst-a',
        assignedRole: 'reviewer',
      }),
    );

    const scope = createTestScope({ coworkSessionRepo, instanceRepo });
    const result = await listCoworkSessions({ role: 'analyst' }, scope);

    expect(result.sessions.map((s) => s.id)).toEqual(['sess-analyst']);
  });

  it('narrows by status[] in-memory after the base read', async () => {
    await coworkSessionRepo.create(
      buildCoworkSession({ id: 'sess-active', processInstanceId: 'inst-a', status: 'active' }),
    );
    await coworkSessionRepo.create(
      buildCoworkSession({ id: 'sess-final', processInstanceId: 'inst-a', status: 'finalized' }),
    );
    await coworkSessionRepo.create(
      buildCoworkSession({ id: 'sess-abandoned', processInstanceId: 'inst-a', status: 'abandoned' }),
    );

    const scope = createTestScope({ coworkSessionRepo, instanceRepo });
    const result = await listCoworkSessions({ status: ['active', 'finalized'] }, scope);

    expect(result.sessions.map((s) => s.id).sort()).toEqual(['sess-active', 'sess-final']);
  });

  it('user callers only see sessions whose parent run is in their namespaces', async () => {
    await coworkSessionRepo.create(
      buildCoworkSession({ id: 'sess-mine', processInstanceId: 'inst-a' }),
    );
    await coworkSessionRepo.create(
      buildCoworkSession({ id: 'sess-foreign', processInstanceId: 'inst-b' }),
    );

    const scope = createTestScope({
      coworkSessionRepo,
      instanceRepo,
      caller: userCaller('u-1', ['team-alpha']),
    });
    const result = await listCoworkSessions({}, scope);

    expect(result.sessions.map((s) => s.id)).toEqual(['sess-mine']);
  });

  it('returns [] (not throw) when no session matches the role filter', async () => {
    await coworkSessionRepo.create(
      buildCoworkSession({
        id: 'sess-analyst',
        processInstanceId: 'inst-a',
        assignedRole: 'analyst',
      }),
    );

    const scope = createTestScope({
      coworkSessionRepo,
      instanceRepo,
      caller: userCaller('u-1', ['team-alpha']),
    });
    const result = await listCoworkSessions({ role: 'nobody' }, scope);

    expect(result.sessions).toEqual([]);
  });

  it('combines role + status[] filters', async () => {
    await coworkSessionRepo.create(
      buildCoworkSession({
        id: 'sess-active',
        processInstanceId: 'inst-a',
        assignedRole: 'analyst',
        status: 'active',
      }),
    );
    await coworkSessionRepo.create(
      buildCoworkSession({
        id: 'sess-final',
        processInstanceId: 'inst-a',
        assignedRole: 'analyst',
        status: 'finalized',
      }),
    );
    await coworkSessionRepo.create(
      buildCoworkSession({
        id: 'sess-other-role',
        processInstanceId: 'inst-a',
        assignedRole: 'reviewer',
        status: 'active',
      }),
    );

    const scope = createTestScope({ coworkSessionRepo, instanceRepo });
    const result = await listCoworkSessions(
      { role: 'analyst', status: ['active'] },
      scope,
    );

    expect(result.sessions.map((s) => s.id)).toEqual(['sess-active']);
  });
});

/**
 * The inbox renders sessions under a workspace handle and links each one
 * beneath it, so an unscoped caller-scope list puts another workspace's
 * sessions on the page and points every one of them at a route that does not
 * resolve there.
 */
describe('listCoworkSessions — namespace axis', () => {
  let coworkSessionRepo: InMemoryCoworkSessionRepository;
  let instanceRepo: InMemoryProcessInstanceRepository;

  beforeEach(async () => {
    resetFactorySequence();
    instanceRepo = new InMemoryProcessInstanceRepository();
    coworkSessionRepo = new InMemoryCoworkSessionRepository(instanceRepo);

    await instanceRepo.create(buildProcessInstance({ id: 'inst-a', namespace: 'team-alpha' }));
    await instanceRepo.create(buildProcessInstance({ id: 'inst-b', namespace: 'team-beta' }));
    await coworkSessionRepo.create(
      buildCoworkSession({ id: 'sess-a', processInstanceId: 'inst-a', status: 'active' }),
    );
    await coworkSessionRepo.create(
      buildCoworkSession({ id: 'sess-b', processInstanceId: 'inst-b', status: 'active' }),
    );
  });

  it('keeps only the named workspace for a member of both', async () => {
    const scope = createTestScope({
      coworkSessionRepo,
      instanceRepo,
      caller: userCaller('uid-1', ['team-alpha', 'team-beta']),
    });

    const both = await listCoworkSessions({}, scope);
    expect(both.sessions.map((s) => s.id).sort()).toEqual(['sess-a', 'sess-b']);

    const scoped = await listCoworkSessions({ namespace: ['team-alpha'] }, scope);
    expect(scoped.sessions.map((s) => s.id)).toEqual(['sess-a']);
  });

  it('reads a workspace the caller is not in as empty, not as a refusal', async () => {
    const scope = createTestScope({
      coworkSessionRepo,
      instanceRepo,
      caller: userCaller('uid-1', ['team-alpha']),
    });

    const result = await listCoworkSessions({ namespace: ['team-beta'] }, scope);
    expect(result.sessions).toEqual([]);
  });

  it('composes with the role and status filters', async () => {
    await coworkSessionRepo.create(
      buildCoworkSession({
        id: 'sess-a2',
        processInstanceId: 'inst-a',
        status: 'finalized',
      }),
    );
    const scope = createTestScope({
      coworkSessionRepo,
      instanceRepo,
      caller: userCaller('uid-1', ['team-alpha', 'team-beta']),
    });

    const result = await listCoworkSessions(
      { namespace: ['team-alpha'], status: ['finalized'] },
      scope,
    );
    expect(result.sessions.map((s) => s.id)).toEqual(['sess-a2']);
  });
});
