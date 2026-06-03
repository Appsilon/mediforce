import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  InMemoryCoworkSessionRepository,
  InMemoryProcessInstanceRepository,
  buildCoworkSession,
  buildProcessInstance,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import type { NamespaceSecretsRepository } from '@mediforce/platform-core';
import { chatCoworkSession } from '../chat';
import { HandlerError, NotFoundError, PreconditionFailedError } from '../../../errors';
import {
  createTestScope,
  userCaller,
} from '../../../repositories/__tests__/create-test-scope';

function fixedNamespaceSecrets(values: Record<string, string>): NamespaceSecretsRepository {
  return {
    async getSecrets() {
      return values;
    },
    async getSecretKeys() {
      return Object.keys(values);
    },
    async setSecrets() {
      /* no-op */
    },
    async upsertSecret() {
      /* no-op */
    },
    async deleteSecret() {
      /* no-op */
    },
  };
}

describe('chatCoworkSession handler', () => {
  let instanceRepo: InMemoryProcessInstanceRepository;
  let coworkSessionRepo: InMemoryCoworkSessionRepository;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    resetFactorySequence();
    instanceRepo = new InMemoryProcessInstanceRepository();
    coworkSessionRepo = new InMemoryCoworkSessionRepository(instanceRepo);

    await instanceRepo.create(
      buildProcessInstance({
        id: 'inst-a',
        namespace: 'team-alpha',
        definitionName: 'wf-chat',
      }),
    );
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
  });

  it('runs a single LLM turn (no tool calls), persists human + agent turns', async () => {
    await coworkSessionRepo.create(
      buildCoworkSession({
        id: 'sess-1',
        processInstanceId: 'inst-a',
        status: 'active',
        agent: 'chat',
      }),
    );

    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'Hello back', tool_calls: [] } }],
        }),
        { status: 200 },
      ),
    );

    const scope = createTestScope({
      instanceRepo,
      coworkSessionRepo,
      namespaceSecretsRepo: fixedNamespaceSecrets({ OPENROUTER_API_KEY: 'or-test' }),
      caller: userCaller('u-1', ['team-alpha']),
    });

    const result = await chatCoworkSession(
      { sessionId: 'sess-1', message: 'Hi there' },
      scope,
    );

    expect(result.agentText).toBe('Hello back');
    expect(result.artifact).toBeUndefined();
    expect(result.toolCalls).toEqual([]);

    const session = await coworkSessionRepo.getById('sess-1');
    const turnSummary = (session?.turns ?? []).map((t) => ({
      role: t.role,
      content: t.content,
    }));
    expect(turnSummary).toEqual([
      { role: 'human', content: 'Hi there' },
      { role: 'agent', content: 'Hello back' },
    ]);
    expect(fetchSpy).toHaveBeenCalledOnce();

    // Additive return shape — `session` + `turns` echo server truth so the
    // UI can replace optimistic state without a follow-up GET.
    expect(result.session.id).toBe('sess-1');
    expect(result.session.status).toBe('active');
    expect(result.turns.map((t) => ({ role: t.role, content: t.content }))).toEqual(turnSummary);
  });

  it('persists artifact and exits the tool loop when update_artifact is called', async () => {
    await coworkSessionRepo.create(
      buildCoworkSession({
        id: 'sess-1',
        processInstanceId: 'inst-a',
        status: 'active',
        agent: 'chat',
      }),
    );

    fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: 'Updating artifact',
                  tool_calls: [
                    {
                      id: 'call-1',
                      type: 'function',
                      function: {
                        name: 'update_artifact',
                        arguments: JSON.stringify({ artifact: { title: 'v1' } }),
                      },
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: 'Done', tool_calls: [] } }],
          }),
          { status: 200 },
        ),
      );

    const scope = createTestScope({
      instanceRepo,
      coworkSessionRepo,
      namespaceSecretsRepo: fixedNamespaceSecrets({ OPENROUTER_API_KEY: 'or-test' }),
      caller: userCaller('u-1', ['team-alpha']),
    });

    const result = await chatCoworkSession(
      { sessionId: 'sess-1', message: 'Make it' },
      scope,
    );

    expect(result.artifact).toEqual({ title: 'v1' });
    expect(result.toolCalls).toEqual([]);

    const session = await coworkSessionRepo.getById('sess-1');
    expect(session?.artifact).toEqual({ title: 'v1' });
    // Two OpenRouter calls: first returns update_artifact, second returns no tools (loop exit).
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(result.session.artifact).toEqual({ title: 'v1' });
  });

  it('throws HandlerError when OPENROUTER_API_KEY missing', async () => {
    await coworkSessionRepo.create(
      buildCoworkSession({
        id: 'sess-1',
        processInstanceId: 'inst-a',
        status: 'active',
      }),
    );

    const scope = createTestScope({
      instanceRepo,
      coworkSessionRepo,
      caller: userCaller('u-1', ['team-alpha']),
    });

    const err = await chatCoworkSession(
      { sessionId: 'sess-1', message: 'hi' },
      scope,
    ).catch((e) => e);

    expect(err).toBeInstanceOf(HandlerError);
    expect((err as HandlerError).message).toMatch(/OPENROUTER_API_KEY/);
  });

  it('throws PreconditionFailedError when session not active', async () => {
    await coworkSessionRepo.create(
      buildCoworkSession({
        id: 'sess-1',
        processInstanceId: 'inst-a',
        status: 'finalized',
      }),
    );

    const scope = createTestScope({
      instanceRepo,
      coworkSessionRepo,
      caller: userCaller('u-1', ['team-alpha']),
    });

    await expect(
      chatCoworkSession({ sessionId: 'sess-1', message: 'hi' }, scope),
    ).rejects.toBeInstanceOf(PreconditionFailedError);
  });

  it('throws NotFoundError for foreign-namespace session (anti-enum)', async () => {
    await coworkSessionRepo.create(
      buildCoworkSession({
        id: 'sess-1',
        processInstanceId: 'inst-a',
        status: 'active',
      }),
    );

    const scope = createTestScope({
      instanceRepo,
      coworkSessionRepo,
      caller: userCaller('u-other', ['team-beta']),
    });

    await expect(
      chatCoworkSession({ sessionId: 'sess-1', message: 'hi' }, scope),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
